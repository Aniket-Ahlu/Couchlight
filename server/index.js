import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Room, generateRoomCode } from './rooms.js';
import { searchMovies, findSimilar } from './search.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const mediaDir = path.join(publicDir, 'media');
const moviesFile = path.join(rootDir, 'data', 'movies.json');

if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

let catalog = [];
try {
  catalog = JSON.parse(fs.readFileSync(moviesFile, 'utf8'));
} catch (err) {
  catalog = [];
}

const playCounts = Object.create(null);
const rooms = new Map();

function recordPlay(itemId) {
  if (!itemId) return;
  playCounts[itemId] = (playCounts[itemId] || 0) + 1;
}

export function start(port = process.env.PORT || 3000) {
  const app = express();
  app.use(express.json());

  // Static files
  app.use(express.static(publicDir));

  // REST endpoints
  app.get('/api/movies', (req, res) => {
    const { q, genre, yearMin, yearMax, ratingMin, maxMinutes, sort } = req.query;
    const results = searchMovies(catalog, {
      q,
      genre,
      yearMin,
      yearMax,
      ratingMin,
      maxMinutes,
      sort,
      playCounts
    });
    res.json(results);
  });

  app.get('/api/movies/:id/similar', (req, res) => {
    const similar = findSimilar(catalog, req.params.id, 4);
    res.json(similar);
  });

  app.get('/api/shelves', (req, res) => {
    const roomCode = req.query.room;
    let watchedMovie = null;
    if (roomCode && rooms.has(roomCode.toUpperCase())) {
      const room = rooms.get(roomCode.toUpperCase());
      if (room.playback && room.playback.itemId) {
        watchedMovie = catalog.find(m => m.id === room.playback.itemId);
      }
    }

    const topPicks = [...catalog].sort((a, b) => b.rating - a.rating).slice(0, 5);
    const artemis = catalog.filter(m => (m.genres || []).includes('Artemis')).slice(0, 5);
    const moonEarth = catalog.filter(m => (m.genres || []).some(g => g === 'Moon' || g === 'Earth')).slice(0, 5);
    const historyAero = catalog.filter(m => (m.genres || []).some(g => g === 'History' || g === 'Aeronautics')).slice(0, 5);
    const quick = catalog.filter(m => m.minutes <= 2).slice(0, 5);
    const popular = [...catalog].sort((a, b) => (playCounts[b.id] || 0) - (playCounts[a.id] || 0) || b.rating - a.rating).slice(0, 5);

    const candidateShelves = [
      { id: 'top', title: 'Top picks', items: topPicks },
      { id: 'artemis', title: 'Artemis', items: artemis },
      { id: 'moon-earth', title: 'Moon & Earth', items: moonEarth },
      { id: 'history-aero', title: 'History & Aeronautics', items: historyAero },
      { id: 'quick', title: 'Quick watches (under 2 min)', items: quick },
      { id: 'popular', title: 'Popular in rooms', items: popular }
    ];

    if (watchedMovie) {
      const because = findSimilar(catalog, watchedMovie.id, 4);
      if (because.length >= 2) {
        candidateShelves.splice(1, 0, {
          id: 'because',
          title: `Because you watched ${watchedMovie.title}`,
          items: because
        });
      }
    }

    const shelves = candidateShelves.filter(shelf => shelf.items && shelf.items.length >= 2);
    res.json(shelves);
  });

  app.get('/api/local-media', (req, res) => {
    try {
      if (!fs.existsSync(mediaDir)) {
        return res.json([]);
      }
      const files = fs.readdirSync(mediaDir);
      const media = files
        .filter(f => f.endsWith('.mp4') || f.endsWith('.webm'))
        .map(f => ({
          title: path.basename(f, path.extname(f)).replace(/[-_]/g, ' '),
          src: `/media/${encodeURIComponent(f)}`
        }));
      res.json(media);
    } catch (_) {
      res.json([]);
    }
  });

  app.post('/api/rooms', (req, res) => {
    const { name } = req.body || {};
    let code = generateRoomCode();
    while (rooms.has(code)) {
      code = generateRoomCode();
    }
    const room = new Room(code, name, catalog, recordPlay);
    room.onEmptyTimeout = (c) => rooms.delete(c);
    rooms.set(code, room);
    res.json({ code, name: room.name });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const code = (req.params.code || '').toUpperCase();
    if (rooms.has(code)) {
      const room = rooms.get(code);
      res.json({ exists: true, code, name: room.name });
    } else {
      res.status(404).json({ exists: false, error: 'Room does not exist' });
    }
  });

  // Client-side routing for /r/:code
  app.get('/r/:code', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Fallback to index.html for root or unknown GET
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = http.createServer(app);

  server.on('connection', (sock) => {
    sock.setNoDelay(true);
  });

  const wss = new WebSocketServer({
    server,
    maxPayload: 16 * 1024,
    perMessageDeflate: false
  });

  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (_) {}
    }
  }, 15000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws, req) => {
    if (req.socket) {
      req.socket.setNoDelay(true);
    }
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    let currentRoom = null;
    let currentClientId = null;

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        try {
          ws.send(JSON.stringify({ t: 'error', message: 'Malformed JSON payload' }));
        } catch (_) {}
        return;
      }

      if (!msg || typeof msg !== 'object' || !msg.t) {
        try {
          ws.send(JSON.stringify({ t: 'error', message: 'Invalid message structure' }));
        } catch (_) {}
        return;
      }

      try {
        switch (msg.t) {
          case 'ping': {
            ws.send(JSON.stringify({ t: 'pong', c: msg.c, s: Date.now() }));
            break;
          }

          case 'join': {
            const code = (msg.code || '').toUpperCase().trim();
            const clientId = (msg.clientId || '').trim();
            const name = (msg.name || 'Guest').trim();

            if (!code || !clientId) {
              ws.send(JSON.stringify({ t: 'error', message: 'Missing room code or client ID' }));
              return;
            }

            let room = rooms.get(code);
            if (!room) {
              ws.send(JSON.stringify({ t: 'room_not_found', code }));
              return;
            }

            const joinResult = room.addMember(clientId, name, ws);
            if (!joinResult.ok) {
              ws.send(JSON.stringify({ t: 'error', message: joinResult.error }));
              return;
            }

            currentRoom = room;
            currentClientId = clientId;
            break;
          }

          case 'ctl': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.applyPlaybackControl(currentClientId, msg, msg.ref);
            break;
          }

          case 'ended': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.handleVideoEnded(currentClientId, msg.itemId);
            break;
          }

          case 'chat': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.addChatMessage(currentClientId, msg.text);
            break;
          }

          case 'reaction': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.addReaction(currentClientId, msg.emoji, msg.videoTime);
            break;
          }

          case 'drift': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.recordDrift(currentClientId, msg.ms, msg.rtt);
            break;
          }

          case 'buffering': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.setBuffering(currentClientId, msg.value);
            break;
          }

          case 'typing': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.notifyTyping(currentClientId);
            break;
          }

          case 'queue_add': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.addToQueue(msg.item, currentClientId);
            break;
          }

          case 'queue_remove': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.removeFromQueue(msg.id, currentClientId);
            break;
          }

          case 'queue_reorder': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.reorderQueue(msg.fromIndex, msg.toIndex);
            break;
          }

          case 'queue_play': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.playQueueItem(msg.id, currentClientId);
            break;
          }

          case 'poll_create': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.createPoll(currentClientId, msg);
            break;
          }

          case 'poll_vote': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.votePoll(currentClientId, msg.pollId, msg.optionIndex);
            break;
          }

          case 'poll_close': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.closePoll(msg.pollId, currentClientId, false);
            break;
          }

          case 'host_transfer': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.setHost(msg.newHostId, currentClientId);
            break;
          }

          case 'control_mode': {
            if (!currentRoom || !currentClientId) return;
            currentRoom.setControlMode(msg.mode, currentClientId);
            break;
          }

          default: {
            ws.send(JSON.stringify({ t: 'error', message: `Unknown message type: ${msg.t}` }));
            break;
          }
        }
      } catch (err) {
        try {
          ws.send(JSON.stringify({ t: 'error', message: 'Internal processing error' }));
        } catch (_) {}
      }
    });

    ws.on('close', () => {
      if (currentRoom && currentClientId) {
        currentRoom.handleDisconnect(currentClientId);
      }
    });

    ws.on('error', () => {
      if (currentRoom && currentClientId) {
        currentRoom.handleDisconnect(currentClientId);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '0.0.0.0', () => {
      resolve({
        server,
        wss,
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            clearInterval(heartbeatInterval);
            for (const client of wss.clients) {
              try { client.terminate(); } catch (_) {}
            }
            wss.close(() => {
              server.close(done);
            });
          })
      });
    });
    server.on('error', reject);
  });
}

// Direct execution entrypoint
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const PORT = process.env.PORT || 3000;
  start(PORT).then(({ port }) => {
    console.log(`Couchlight listening on http://0.0.0.0:${port}`);
  }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
