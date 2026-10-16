export class SocketClient {
  constructor({ roomCode, clientId, nickname, onState, onSnapshot, onMembers, onChat, onReaction, onQueue, onPollUpdate, onHostChange, onControlMode, onError, onRoomNotFound, onTyping, onStatusChange }) {
    this.roomCode = roomCode;
    this.clientId = clientId;
    this.nickname = nickname;

    this.onState = onState || (() => {});
    this.onSnapshot = onSnapshot || (() => {});
    this.onMembers = onMembers || (() => {});
    this.onChat = onChat || (() => {});
    this.onReaction = onReaction || (() => {});
    this.onQueue = onQueue || (() => {});
    this.onPollUpdate = onPollUpdate || (() => {});
    this.onHostChange = onHostChange || (() => {});
    this.onControlMode = onControlMode || (() => {});
    this.onError = onError || (() => {});
    this.onRoomNotFound = onRoomNotFound || (() => {});
    this.onTyping = onTyping || (() => {});
    this.onStatusChange = onStatusChange || (() => {});

    this.ws = null;
    this.closedExplicitly = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.clockSyncTimer = null;

    this.clockOffset = 0;
    this.bestRtt = Infinity;
    this.recentClockSamples = []; // Keep best of last 5 samples

    this.pendingChatQueue = []; // Cap at 5 while offline
  }

  connect() {
    this.closedExplicitly = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;

    this.onStatusChange('connecting');

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatusChange('connected');

      // Join room
      this.sendRaw({
        t: 'join',
        code: this.roomCode,
        clientId: this.clientId,
        name: this.nickname
      });

      // Flush offline chats (up to 5)
      while (this.pendingChatQueue.length > 0) {
        const text = this.pendingChatQueue.shift();
        this.sendRaw({ t: 'chat', text });
      }

      // Initial clock sync: 8 pings spaced 100ms apart
      this.runClockSyncBurst(8, 100);

      // Periodic re-sync every 20s
      if (this.clockSyncTimer) clearInterval(this.clockSyncTimer);
      this.clockSyncTimer = setInterval(() => {
        this.runClockSyncBurst(3, 150);
      }, 20000);
    };

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (msg.t === 'pong') {
        this.handlePong(msg);
        return;
      }

      switch (msg.t) {
        case 'snapshot':
          this.onSnapshot(msg);
          break;
        case 'state':
          this.onState(msg);
          break;
        case 'members':
          this.onMembers(msg);
          break;
        case 'chat':
          this.onChat(msg);
          break;
        case 'reaction':
          this.onReaction(msg);
          break;
        case 'queue':
          this.onQueue(msg);
          break;
        case 'poll_update':
          this.onPollUpdate(msg);
          break;
        case 'host_change':
          this.onHostChange(msg);
          break;
        case 'control_mode':
          this.onControlMode(msg);
          break;
        case 'typing':
          this.onTyping(msg);
          break;
        case 'room_not_found':
          this.onRoomNotFound(msg);
          break;
        case 'error':
          this.onError(msg);
          break;
      }
    };

    this.ws.onclose = () => {
      if (this.clockSyncTimer) {
        clearInterval(this.clockSyncTimer);
        this.clockSyncTimer = null;
      }
      if (!this.closedExplicitly) {
        this.onStatusChange('reconnecting');
        this.scheduleReconnect();
      } else {
        this.onStatusChange('disconnected');
      }
    };

    this.ws.onerror = () => {
      // ws close handles reconnect
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Exponential backoff: starting at 500ms, mult 1.6, cap 5s, with jitter
    const base = Math.min(5000, 500 * Math.pow(1.6, this.reconnectAttempts));
    const jitter = Math.random() * 250;
    const delay = base + jitter;
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  runClockSyncBurst(count, intervalMs) {
    let sent = 0;
    const sendPing = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw({ t: 'ping', c: Date.now() });
        sent++;
        if (sent < count) {
          setTimeout(sendPing, intervalMs);
        }
      }
    };
    sendPing();
  }

  handlePong({ c, s }) {
    const now = Date.now();
    const rtt = Math.max(0, now - c);
    const offset = s - (c + rtt / 2);

    this.recentClockSamples.push({ rtt, offset });
    if (this.recentClockSamples.length > 5) {
      this.recentClockSamples.shift();
    }

    // Keep offset from sample with minimum rtt
    let best = this.recentClockSamples[0];
    for (const sample of this.recentClockSamples) {
      if (sample.rtt < best.rtt) {
        best = sample;
      }
    }

    this.bestRtt = best.rtt;
    this.clockOffset = best.offset;
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  sendRaw(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  sendChat(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw({ t: 'chat', text: trimmed });
    } else {
      if (this.pendingChatQueue.length >= 5) {
        this.pendingChatQueue.shift();
      }
      this.pendingChatQueue.push(trimmed);
    }
  }

  sendControl(action, details = {}) {
    // Drop control actions while offline
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.sendRaw({
      t: 'ctl',
      action,
      ...details
    });
  }

  sendReaction(emoji, videoTime) {
    this.sendRaw({ t: 'reaction', emoji, videoTime });
  }

  sendDrift(ms) {
    this.sendRaw({ t: 'drift', ms, rtt: this.bestRtt === Infinity ? 0 : this.bestRtt });
  }

  sendBuffering(isBuffering) {
    this.sendRaw({ t: 'buffering', value: isBuffering });
  }

  sendTyping() {
    this.sendRaw({ t: 'typing' });
  }

  sendEnded(itemId) {
    this.sendRaw({ t: 'ended', itemId });
  }

  sendQueueAdd(item) {
    this.sendRaw({ t: 'queue_add', item });
  }

  sendQueueRemove(id) {
    this.sendRaw({ t: 'queue_remove', id });
  }

  sendQueueReorder(fromIndex, toIndex) {
    this.sendRaw({ t: 'queue_reorder', fromIndex, toIndex });
  }

  sendQueuePlay(id) {
    this.sendRaw({ t: 'queue_play', id });
  }

  sendPollCreate({ question, options, duration }) {
    this.sendRaw({ t: 'poll_create', question, options, duration });
  }

  sendPollVote(pollId, optionIndex) {
    this.sendRaw({ t: 'poll_vote', pollId, optionIndex });
  }

  sendPollClose(pollId) {
    this.sendRaw({ t: 'poll_close', pollId });
  }

  sendHostTransfer(newHostId) {
    this.sendRaw({ t: 'host_transfer', newHostId });
  }

  sendControlMode(mode) {
    this.sendRaw({ t: 'control_mode', mode });
  }

  close() {
    this.closedExplicitly = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.clockSyncTimer) clearInterval(this.clockSyncTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
