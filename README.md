# Couchlight

A real-time, low-light watch party web application for synchronized video screenings with friends.

## Getting Started

```bash
# 1. Install dependencies (express and ws only)
npm install

# 2. Start the server
npm start
```

The application starts on `http://0.0.0.0:3000` (or `PORT` environment variable).

### Joining From Another Device on Your LAN
Find your computer's local IP address (`ipconfig` on Windows or `ifconfig` / `ip addr` on macOS/Linux), e.g. `192.168.1.100`.
Any device on your local network can join by opening `http://192.168.1.100:3000` and entering the 6-character room code.

## Running Tests

```bash
npm run loadtest
```
This runs `scripts/loadtest.js`, measuring send-to-receive propagation across 12 clients, simulating clock skews and stalls for drift recovery, validating failure tolerance and concurrency, and generating `LATENCY_REPORT.md`.

## Project Layout

```text
├── package.json
├── data/
│   └── movies.json         # 14 curated open sample films with metadata
├── server/
│   ├── index.js            # Express app, REST API, WebSocket server, start() export
│   ├── rooms.js            # Room class, server-authoritative sync, state, members, chat, polls
│   └── search.js           # Fuzzy search, token Levenshtein, trigram Jaccard, similarity
├── public/
│   ├── index.html          # Shell HTML with inline SVG favicon
│   ├── css/
│   │   └── style.css       # Screening-room theme, color tokens, responsive layout
│   ├── js/
│   │   ├── app.js          # SPA router, home view, room view, keyboard shortcuts
│   │   ├── socket.js       # WebSocket client, clock synchronization, exponential reconnect
│   │   ├── player.js       # Video element manager, custom controls, reaction heat overlay
│   │   ├── syncMath.js     # Pure functions for drift correction and expected position
│   │   ├── chat.js         # Real-time chat with textContent rendering and auto-scroll
│   │   ├── queue.js        # Shared playlist with custom URLs and local media
│   │   ├── polls.js        # Group voting, countdown timers, auto-queue winners
│   │   ├── browse.js       # Movie discovery, horizontal shelves, search, detail drawer
│   │   ├── people.js       # Members list, sync health metrics, host controls
│   │   ├── reactions.js    # 6-emoji reaction bar
│   │   ├── poster.js       # SVG print poster generator
│   │   └── util.js         # Inline SVG icons, avatars, time formatting, toasts
│   └── media/              # Directory for local .mp4 and .webm files
├── scripts/
│   └── loadtest.js         # Comprehensive load, drift, and failure test suite
└── LATENCY_REPORT.md       # Generated latency and sync performance report
```

## Sync Architecture

1. **Server-Authoritative State**: The server maintains `{ itemId, src, title, status, position, updatedAt, version }`.
2. **Deterministic Time**: Expected playback position at time $T$ is calculated as `status === "playing" ? position + (T - updatedAt)/1000 : position`.
3. **No Optimistic Controls**: Client actions (play, pause, seek, load) are sent to the server. The server verifies permissions, increments the version, and broadcasts the updated state to all connected room members.
4. **Version Gating**: Clients reject states where `version <= lastAppliedVersion`, preventing out-of-order race conditions.
5. **Clock Synchronization**: Clients perform an 8-ping burst on connect, selecting the minimum round-trip time (RTT) sample to compute clock offset, re-syncing every 20 seconds.
6. **Smooth Drift Correction**: Clients run a drift check every second:
   - $|\text{drift}| > 0.5\text{s}$: Hard seek directly to expected position.
   - $0.08\text{s} \le |\text{drift}| \le 0.5\text{s}$: Nudge `playbackRate` by $\pm 6\%$ to smoothly eliminate drift.
   - $|\text{drift}| < 0.08\text{s}$: Standard playback rate (1.0x).
   - Paused: Seek if drift exceeds 0.25s.
7. **Telemetry**: Clients report drift in ms and RTT every 3 seconds, visualized live in the People tab.

## Protocol Messages

| Message `t` | Direction | Description |
| :--- | :--- | :--- |
| `ping` / `pong` | Both | Clock offset and RTT measurement |
| `join` | Client -> Server | Join a room with code, client ID, and nickname |
| `snapshot` | Server -> Client | Full initial state (playback, queue, chat, members, polls, reactions) |
| `ctl` | Client -> Server | Request play, pause, seek, or load |
| `state` | Server -> Client | Authoritative playback state broadcast with version and ref |
| `ended` | Client -> Server | Notify that video has ended (server advances queue once) |
| `drift` | Client -> Server | Report measured drift in ms and RTT |
| `buffering` | Client -> Server | Report video buffering status |
| `chat` | Both | Live chat messages with sender name and timestamp |
| `typing` | Both | Throttled typing indicator notification |
| `reaction` | Both | Emoji reactions with video timestamp for seek heat |
| `queue_add` / `queue_remove` / `queue_reorder` / `queue_play` | Both | Playlist management |
| `poll_create` / `poll_vote` / `poll_close` / `poll_update` | Both | Group voting and auto-queue resolution |
| `host_transfer` / `control_mode` | Both | Host assignment and everyone vs host permissions |
| `error` | Server -> Client | Validation errors, rate limit warnings, or capacity limits |

## Media Sources & Known Limitations

- **NASA Media Catalog**: The sample catalog consists exclusively of NASA media clips. Clips stream live from `nasa.gov` and `images-assets.nasa.gov`, requiring internet access. The `scripts/fetch-nasa-catalog.js` script was used to build and verify `data/movies.json` via HTTP Range checks. NASA media is generally free to use, but individual clip usage guidelines should always be checked.
- **Local Media Fallback**: If offline or using custom footage, drop your own `.mp4` or `.webm` files directly into `public/media/` and add them via the Queue tab.
- **In-memory storage**: Rooms and chat histories live in Node memory and reset on server restart. Empty rooms expire 10 minutes after all members leave.
