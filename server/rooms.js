import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '10000', 10);
const MEMBER_GRACE_MS = parseInt(process.env.MEMBER_GRACE_MS || '60000', 10);
const ROOM_CLEANUP_MS = 10 * 60 * 1000;

export function generateRoomCode() {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

export class Room {
  constructor(code, name, catalog = [], playCounter = null) {
    this.code = code;
    this.name = name || `Room ${code}`;
    this.catalog = catalog;
    this.playCounter = playCounter;
    this.createdAt = Date.now();
    this.hostId = null;
    this.controlMode = 'everyone';
    this.members = new Map();
    this.queue = [];
    this.chat = [];
    this.reactions = [];
    this.polls = new Map();

    this.playback = {
      itemId: null,
      src: '',
      title: '',
      status: 'paused',
      position: 0,
      updatedAt: Date.now(),
      version: 0
    };

    this.hostDisconnectTimer = null;
    this.emptyRoomTimer = null;
    this.memberTimers = new Map();
    this.pollTimers = new Map();
    this.lastMembersBroadcast = 0;
    this.membersBroadcastPending = false;
  }

  getCurrentPosition(now = Date.now()) {
    if (this.playback.status === 'playing') {
      return this.playback.position + Math.max(0, (now - this.playback.updatedAt) / 1000);
    }
    return this.playback.position;
  }

  broadcast(message, excludeWs = null) {
    const raw = typeof message === 'string' ? message : JSON.stringify(message);
    for (const member of this.members.values()) {
      if (member.connected && member.ws && member.ws !== excludeWs) {
        if (member.ws.readyState === 1) {
          try {
            member.ws.send(raw);
          } catch (_) {
            // Socket write error handled on close
          }
        }
      }
    }
  }

  getMemberList() {
    return Array.from(this.members.values()).map(m => ({
      clientId: m.clientId,
      name: m.name,
      isHost: m.clientId === this.hostId,
      connected: m.connected,
      driftMs: m.driftMs || 0,
      rtt: m.rtt || 0,
      buffering: !!m.buffering,
      joinedAt: m.joinedAt
    }));
  }

  getPollList() {
    return Array.from(this.polls.values());
  }

  scheduleMembersBroadcast() {
    const now = Date.now();
    if (now - this.lastMembersBroadcast >= 3000) {
      this.lastMembersBroadcast = now;
      this.broadcast({ t: 'members', members: this.getMemberList(), hostId: this.hostId });
      return;
    }

    if (!this.membersBroadcastPending) {
      this.membersBroadcastPending = true;
      const wait = 3000 - (now - this.lastMembersBroadcast);
      setTimeout(() => {
        this.membersBroadcastPending = false;
        this.lastMembersBroadcast = Date.now();
        this.broadcast({ t: 'members', members: this.getMemberList(), hostId: this.hostId });
      }, wait);
    }
  }

  addMember(clientId, name, ws) {
    const connectedCount = Array.from(this.members.values()).filter(m => m.connected).length;
    const existing = this.members.get(clientId);

    if (!existing && connectedCount >= 25) {
      return { ok: false, error: 'Room is full (maximum 25 members)' };
    }

    if (this.emptyRoomTimer) {
      clearTimeout(this.emptyRoomTimer);
      this.emptyRoomTimer = null;
    }

    const sanitizedName = (name || 'Guest').trim().slice(0, 20) || 'Guest';

    if (existing) {
      if (this.memberTimers.has(clientId)) {
        clearTimeout(this.memberTimers.get(clientId));
        this.memberTimers.delete(clientId);
      }
      existing.ws = ws;
      existing.connected = true;
      existing.name = sanitizedName;
      existing.lastSeen = Date.now();

      // If returning host reconnected before grace expired, cancel transfer timer
      if (existing.clientId === this.hostId && this.hostDisconnectTimer) {
        clearTimeout(this.hostDisconnectTimer);
        this.hostDisconnectTimer = null;
      }
    } else {
      const isFirst = this.members.size === 0 || !this.hostId;
      const member = {
        clientId,
        name: sanitizedName,
        joinedAt: Date.now(),
        connected: true,
        lastSeen: Date.now(),
        ws,
        driftMs: 0,
        rtt: 0,
        buffering: false,
        msgTimestamps: [],
        reactTimestamps: [],
        lastTyping: 0
      };
      this.members.set(clientId, member);
      if (isFirst) {
        this.hostId = clientId;
      }
    }

    this.sendSnapshot(clientId, ws);
    this.broadcast({
      t: 'members',
      members: this.getMemberList(),
      hostId: this.hostId
    });

    this.addSystemChat(`${sanitizedName} joined the room`);
    return { ok: true, isHost: this.hostId === clientId };
  }

  sendSnapshot(clientId, ws) {
    if (ws.readyState !== 1) return;
    const snapshot = {
      t: 'snapshot',
      code: this.code,
      name: this.name,
      controlMode: this.controlMode,
      hostId: this.hostId,
      clientId,
      playback: this.playback,
      members: this.getMemberList(),
      queue: this.queue,
      chat: this.chat.slice(-200),
      reactions: this.reactions.slice(-500),
      polls: this.getPollList(),
      serverTime: Date.now()
    };
    ws.send(JSON.stringify(snapshot));
  }

  handleDisconnect(clientId) {
    const member = this.members.get(clientId);
    if (!member) return;

    member.connected = false;
    member.ws = null;
    member.lastSeen = Date.now();

    this.broadcast({
      t: 'members',
      members: this.getMemberList(),
      hostId: this.hostId
    });

    if (this.hostId === clientId) {
      if (this.hostDisconnectTimer) clearTimeout(this.hostDisconnectTimer);
      this.hostDisconnectTimer = setTimeout(() => {
        this.passHostToLongestConnected();
      }, HOST_GRACE_MS);
    }

    const timer = setTimeout(() => {
      this.removeMemberPermanently(clientId);
    }, MEMBER_GRACE_MS);
    this.memberTimers.set(clientId, timer);

    const anyConnected = Array.from(this.members.values()).some(m => m.connected);
    if (!anyConnected && !this.emptyRoomTimer) {
      this.emptyRoomTimer = setTimeout(() => {
        if (this.onEmptyTimeout) this.onEmptyTimeout(this.code);
      }, ROOM_CLEANUP_MS);
    }
  }

  removeMemberPermanently(clientId) {
    const member = this.members.get(clientId);
    if (!member) return;
    this.memberTimers.delete(clientId);
    this.members.delete(clientId);

    this.addSystemChat(`${member.name} left the room`);

    if (this.hostId === clientId) {
      this.passHostToLongestConnected();
    } else {
      this.broadcast({
        t: 'members',
        members: this.getMemberList(),
        hostId: this.hostId
      });
    }
  }

  passHostToLongestConnected() {
    this.hostDisconnectTimer = null;
    const connectedMembers = Array.from(this.members.values()).filter(m => m.connected);
    if (connectedMembers.length === 0) {
      return;
    }

    connectedMembers.sort((a, b) => a.joinedAt - b.joinedAt);
    const newHost = connectedMembers[0];
    this.hostId = newHost.clientId;

    this.addSystemChat(`Host transferred to ${newHost.name}`);
    this.broadcast({
      t: 'host_change',
      hostId: this.hostId,
      hostName: newHost.name,
      members: this.getMemberList()
    });
  }

  setHost(newHostId, requestedByClientId) {
    if (this.hostId !== requestedByClientId) return false;
    const target = this.members.get(newHostId);
    if (!target) return false;

    this.hostId = newHostId;
    this.addSystemChat(`Host transferred to ${target.name}`);
    this.broadcast({
      t: 'host_change',
      hostId: this.hostId,
      hostName: target.name,
      members: this.getMemberList()
    });
    return true;
  }

  setControlMode(mode, requestedByClientId) {
    if (this.hostId !== requestedByClientId) return false;
    if (mode !== 'everyone' && mode !== 'host') return false;
    this.controlMode = mode;
    this.addSystemChat(`Playback control set to ${mode}`);
    this.broadcast({ t: 'control_mode', mode: this.controlMode });
    return true;
  }

  canControl(clientId) {
    if (this.controlMode === 'everyone') return true;
    return this.hostId === clientId;
  }

  applyPlaybackControl(clientId, action, ref) {
    if (!this.canControl(clientId)) {
      const member = this.members.get(clientId);
      if (member && member.ws) {
        member.ws.send(JSON.stringify({ t: 'error', message: 'Only the host can control playback', ref }));
      }
      return false;
    }

    const member = this.members.get(clientId);
    const now = Date.now();
    const currentPos = this.getCurrentPosition(now);

    let changed = false;
    let cause = action.action;

    if (action.action === 'play') {
      if (this.playback.status === 'playing') {
        return false;
      }
      this.playback.position = currentPos;
      this.playback.status = 'playing';
      this.playback.updatedAt = now;
      this.playback.version++;
      changed = true;
    } else if (action.action === 'pause') {
      if (this.playback.status === 'paused') {
        return false;
      }
      this.playback.position = currentPos;
      this.playback.status = 'paused';
      this.playback.updatedAt = now;
      this.playback.version++;
      changed = true;
    } else if (action.action === 'seek') {
      const targetPos = Math.max(0, Number(action.position) || 0);
      if (Math.abs(targetPos - currentPos) < 0.05) {
        return false;
      }
      this.playback.position = targetPos;
      this.playback.updatedAt = now;
      this.playback.version++;
      changed = true;
    } else if (action.action === 'load') {
      this.playback.itemId = action.itemId || null;
      this.playback.src = action.src || '';
      this.playback.title = action.title || 'Untitled';
      this.playback.position = 0;
      this.playback.status = 'playing';
      this.playback.updatedAt = now;
      this.playback.version++;
      changed = true;

      if (this.playback.itemId && this.playCounter) {
        this.playCounter(this.playback.itemId);
      }
      this.addSystemChat(`Now playing: ${this.playback.title}`);
    }

    if (changed) {
      this.broadcast({
        t: 'state',
        playback: this.playback,
        by: member ? member.name : 'Unknown',
        cause,
        ref: ref || null
      });
      return true;
    }
    return false;
  }

  handleVideoEnded(clientId, itemId) {
    if (this.playback.itemId !== itemId) {
      return;
    }

    if (this.queue.length > 0) {
      const nextItem = this.queue.shift();
      this.playback.itemId = nextItem.id;
      this.playback.src = nextItem.src;
      this.playback.title = nextItem.title;
      this.playback.position = 0;
      this.playback.status = 'playing';
      this.playback.updatedAt = Date.now();
      this.playback.version++;

      if (this.playCounter) {
        this.playCounter(nextItem.id);
      }

      this.addSystemChat(`Now playing from queue: ${nextItem.title}`);
      this.broadcast({ t: 'queue', queue: this.queue });
      this.broadcast({
        t: 'state',
        playback: this.playback,
        by: 'Auto-advance',
        cause: 'ended'
      });
    } else {
      this.playback.status = 'paused';
      this.playback.updatedAt = Date.now();
      this.playback.version++;
      this.broadcast({
        t: 'state',
        playback: this.playback,
        by: 'End of queue',
        cause: 'ended'
      });
    }
  }

  addChatMessage(clientId, rawText) {
    const member = this.members.get(clientId);
    if (!member) return;

    const now = Date.now();
    member.msgTimestamps = (member.msgTimestamps || []).filter(ts => now - ts < 3000);
    if (member.msgTimestamps.length >= 5) {
      if (member.ws) {
        member.ws.send(JSON.stringify({ t: 'error', message: 'Chat rate limit reached (5 msgs / 3s)' }));
      }
      return;
    }
    member.msgTimestamps.push(now);

    const text = (rawText || '').trim().slice(0, 500);
    if (!text) return;

    const msg = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(now) + Math.random().toString(36).slice(2, 6),
      name: member.name,
      text,
      time: now,
      system: false
    };

    this.chat.push(msg);
    if (this.chat.length > 200) this.chat.shift();
    this.broadcast({ t: 'chat', message: msg });
  }

  addSystemChat(text) {
    const msg = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2, 6),
      name: 'System',
      text,
      time: Date.now(),
      system: true
    };
    this.chat.push(msg);
    if (this.chat.length > 200) this.chat.shift();
    this.broadcast({ t: 'chat', message: msg });
  }

  addReaction(clientId, emoji, videoTime) {
    const member = this.members.get(clientId);
    if (!member) return;

    const allowed = ['👍', '❤️', '😂', '😮', '👏', '🔥'];
    if (!allowed.includes(emoji)) return;

    const now = Date.now();
    member.reactTimestamps = (member.reactTimestamps || []).filter(ts => now - ts < 2000);
    if (member.reactTimestamps.length >= 10) return;
    member.reactTimestamps.push(now);

    const reaction = {
      id: Math.random().toString(36).slice(2, 9),
      emoji,
      videoTime: typeof videoTime === 'number' ? Math.max(0, videoTime) : this.getCurrentPosition(now),
      name: member.name,
      time: now
    };

    this.reactions.push(reaction);
    if (this.reactions.length > 500) this.reactions.shift();
    this.broadcast({ t: 'reaction', reaction });
  }

  addToQueue(item, requestedBy) {
    if (!item || !item.src) return;
    const member = this.members.get(requestedBy);
    const queueItem = {
      id: item.id || 'custom-' + Date.now().toString(36),
      title: item.title || 'Untitled Video',
      src: item.src,
      duration: item.duration || item.minutes ? (item.minutes * 60) : 0,
      addedBy: member ? member.name : 'Guest'
    };
    this.queue.push(queueItem);
    this.addSystemChat(`${queueItem.addedBy} added "${queueItem.title}" to the queue`);
    this.broadcast({ t: 'queue', queue: this.queue });

    if (!this.playback.src) {
      this.playQueueItem(queueItem.id, requestedBy);
    }
  }

  removeFromQueue(itemId, requestedBy) {
    const idx = this.queue.findIndex(q => q.id === itemId);
    if (idx !== -1) {
      const removed = this.queue.splice(idx, 1)[0];
      const member = this.members.get(requestedBy);
      this.addSystemChat(`${member ? member.name : 'Someone'} removed "${removed.title}" from queue`);
      this.broadcast({ t: 'queue', queue: this.queue });
    }
  }

  reorderQueue(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.queue.length || toIdx < 0 || toIdx >= this.queue.length) {
      return;
    }
    const item = this.queue.splice(fromIdx, 1)[0];
    this.queue.splice(toIdx, 0, item);
    this.broadcast({ t: 'queue', queue: this.queue });
  }

  playQueueItem(itemId, requestedBy) {
    if (!this.canControl(requestedBy)) return;
    const idx = this.queue.findIndex(q => q.id === itemId);
    if (idx === -1) return;

    const item = this.queue.splice(idx, 1)[0];
    this.playback.itemId = item.id;
    this.playback.src = item.src;
    this.playback.title = item.title;
    this.playback.position = 0;
    this.playback.status = 'playing';
    this.playback.updatedAt = Date.now();
    this.playback.version++;

    if (this.playCounter) {
      this.playCounter(item.id);
    }

    this.addSystemChat(`Now playing: ${item.title}`);
    this.broadcast({ t: 'queue', queue: this.queue });
    this.broadcast({
      t: 'state',
      playback: this.playback,
      by: (this.members.get(requestedBy) || {}).name || 'Host',
      cause: 'load'
    });
  }

  createPoll(clientId, { question, options, duration, type }) {
    const member = this.members.get(clientId);
    if (!member) return;

    const cleanQuestion = (question || '').trim().slice(0, 140);
    if (!cleanQuestion) return;

    const cleanOptions = (Array.isArray(options) ? options : [])
      .map(o => (typeof o === 'string' ? o : o.text || '').trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 6);

    if (cleanOptions.length < 2) return;

    const pollId = 'poll-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const validDuration = [30, 60, 120].includes(Number(duration)) ? Number(duration) : null;
    const endsAt = validDuration ? Date.now() + validDuration * 1000 : null;

    const poll = {
      id: pollId,
      question: cleanQuestion,
      options: cleanOptions.map(text => ({ text, votes: [] })),
      creatorId: clientId,
      creatorName: member.name,
      createdAt: Date.now(),
      endsAt,
      closed: false,
      type: type || (cleanQuestion.toLowerCase().includes('watch next') ? 'next-watch' : 'general')
    };

    this.polls.set(pollId, poll);
    this.broadcast({ t: 'poll_update', poll });
    this.addSystemChat(`${member.name} started a poll: "${poll.question}"`);

    if (endsAt) {
      const timer = setTimeout(() => {
        this.closePoll(pollId, null, true);
      }, validDuration * 1000);
      this.pollTimers.set(pollId, timer);
    }
  }

  votePoll(clientId, pollId, optionIndex) {
    const poll = this.polls.get(pollId);
    if (!poll || poll.closed) return;
    if (optionIndex < 0 || optionIndex >= poll.options.length) return;

    // Remove vote from other options
    for (const opt of poll.options) {
      opt.votes = opt.votes.filter(id => id !== clientId);
    }
    // Add vote
    poll.options[optionIndex].votes.push(clientId);

    this.broadcast({ t: 'poll_update', poll });
  }

  closePoll(pollId, requestedBy, isTimeout = false) {
    const poll = this.polls.get(pollId);
    if (!poll || poll.closed) return;

    if (!isTimeout && requestedBy) {
      if (poll.creatorId !== requestedBy && this.hostId !== requestedBy) {
        return;
      }
    }

    if (this.pollTimers.has(pollId)) {
      clearTimeout(this.pollTimers.get(pollId));
      this.pollTimers.delete(pollId);
    }

    poll.closed = true;
    poll.closedAt = Date.now();

    // Determine winner
    let maxVotes = -1;
    let winner = null;
    for (const opt of poll.options) {
      if (opt.votes.length > maxVotes) {
        maxVotes = opt.votes.length;
        winner = opt;
      }
    }

    this.broadcast({ t: 'poll_update', poll });
    this.addSystemChat(`Poll closed: "${poll.question}". Winner: "${winner ? winner.text : 'None'}" (${maxVotes} votes)`);

    // Auto-queue if next-watch
    if (poll.type === 'next-watch' && winner) {
      const match = this.catalog.find(m =>
        m.title.toLowerCase() === winner.text.toLowerCase() ||
        winner.text.toLowerCase().includes(m.title.toLowerCase())
      );
      if (match) {
        this.addToQueue({
          id: match.id,
          title: match.title,
          src: match.src,
          duration: match.minutes * 60
        }, poll.creatorId);
      }
    }
  }

  recordDrift(clientId, ms, rtt) {
    const member = this.members.get(clientId);
    if (!member) return;
    member.driftMs = ms;
    member.rtt = rtt;
    this.scheduleMembersBroadcast();
  }

  setBuffering(clientId, isBuffering) {
    const member = this.members.get(clientId);
    if (!member) return;
    member.buffering = !!isBuffering;
    this.broadcast({
      t: 'members',
      members: this.getMemberList(),
      hostId: this.hostId
    });
  }

  notifyTyping(clientId) {
    const member = this.members.get(clientId);
    if (!member) return;
    const now = Date.now();
    if (now - (member.lastTyping || 0) < 2000) return;
    member.lastTyping = now;
    this.broadcast({ t: 'typing', name: member.name }, member.ws);
  }
}
