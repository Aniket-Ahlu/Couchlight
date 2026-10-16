import { getStoredClientId, getStoredNickname, setStoredNickname, showToast, ICONS, createAvatarElement } from './util.js';
import { generatePosterSvg } from './poster.js';
import { SocketClient } from './socket.js';
import { VideoPlayer } from './player.js';
import { ChatPanel } from './chat.js';
import { QueuePanel } from './queue.js';
import { PollsPanel } from './polls.js';
import { BrowsePanel } from './browse.js';
import { PeoplePanel } from './people.js';
import { ReactionsBar } from './reactions.js';

class App {
  constructor() {
    this.clientId = getStoredClientId();
    this.nickname = getStoredNickname();
    this.roomCode = null;
    this.roomData = null;
    this.catalog = [];

    this.socket = null;
    this.player = null;
    this.chatPanel = null;
    this.queuePanel = null;
    this.pollsPanel = null;
    this.browsePanel = null;
    this.peoplePanel = null;
    this.reactionsBar = null;

    this.activeTab = 'chat';
    this.isCinemaMode = false;
    this.lastPlaybackTitle = '';
    this.lastPlaybackBy = '';

    this.root = document.getElementById('app-root');
    this.init();
  }

  async init() {
    try {
      const res = await fetch('/api/movies');
      this.catalog = await res.json();
    } catch (_) {
      this.catalog = [];
    }

    this.initGlobalShortcuts();
    this.route();

    window.addEventListener('popstate', () => this.route());
  }

  route() {
    const path = window.location.pathname;
    const match = path.match(/^\/r\/([A-Za-z0-9]{4,8})$/);

    if (match) {
      this.roomCode = match[1].toUpperCase();
      this.handleRoomRoute();
    } else {
      this.roomCode = null;
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.renderHome();
    }
  }

  navigate(url) {
    window.history.pushState(null, '', url);
    this.route();
  }

  // ----------------------------------------------------
  // Home View
  // ----------------------------------------------------
  renderHome() {
    document.title = 'Couchlight — Press play together.';

    const samplePosters = this.catalog.slice(0, 5);

    this.root.innerHTML = `
      <div class="home-page">
        <header class="home-header">
          <div class="brand">Couchlight</div>
        </header>

        <main class="home-main">
          <section class="home-left">
            <h1 class="home-headline">Press play together.</h1>
            <p class="home-subhead">Synchronized screenings, quiet theater acoustics, zero accounts.</p>

            <div class="home-cards">
              <form class="home-card" id="form-create-room">
                <h2 class="card-title">Start a room</h2>
                <div class="form-group">
                  <label for="create-nick">Your nickname</label>
                  <input type="text" class="text-input" id="create-nick" placeholder="e.g. Maya" maxlength="20" required value="${this.nickname}">
                </div>
                <div class="form-group">
                  <label for="create-name">Room name <span class="label-opt">(optional)</span></label>
                  <input type="text" class="text-input" id="create-name" placeholder="e.g. Friday Late Screening" maxlength="32">
                </div>
                <button type="submit" class="btn btn-primary btn-block">Create screening room</button>
              </form>

              <form class="home-card" id="form-join-code">
                <h2 class="card-title">Have a code?</h2>
                <div class="form-group">
                  <label for="join-code">Room code</label>
                  <input type="text" class="text-input code-input" id="join-code" placeholder="ABCDEF" maxlength="8" required autocomplete="off" spellcheck="false">
                </div>
                <button type="submit" class="btn btn-secondary btn-block">Join room</button>
              </form>
            </div>
          </section>

          <aside class="home-right">
            <div class="tonight-label">On tonight</div>
            <div class="tonight-staggered">
              ${samplePosters.map((m, i) => `
                <div class="tonight-poster tonight-offset-${i}">
                  ${generatePosterSvg(m, 140, 210)}
                </div>
              `).join('')}
            </div>
          </aside>
        </main>

        <footer class="home-footer">
          <span>Self-hosted real-time cinema. No tracking, in-memory rooms.</span>
        </footer>
      </div>
    `;

    const createForm = this.root.querySelector('#form-create-room');
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nick = this.root.querySelector('#create-nick').value.trim();
      const roomName = this.root.querySelector('#create-name').value.trim();
      if (!nick) return;

      this.nickname = nick;
      setStoredNickname(nick);

      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: roomName })
        });
        const data = await res.json();
        this.navigate(`/r/${data.code}`);
      } catch (err) {
        showToast('Failed to create room', 'error');
      }
    });

    const joinForm = this.root.querySelector('#form-join-code');
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = this.root.querySelector('#join-code').value.trim().toUpperCase();
      if (code) {
        this.navigate(`/r/${code}`);
      }
    });
  }

  // ----------------------------------------------------
  // Room Route Handling
  // ----------------------------------------------------
  handleRoomRoute() {
    this.nickname = getStoredNickname();
    if (!this.nickname) {
      this.renderNicknamePrompt();
      return;
    }
    this.enterRoom();
  }

  renderNicknamePrompt() {
    this.root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card">
          <h2 class="modal-title">Join screening</h2>
          <p class="modal-desc">Choose a nickname for Room <strong>${this.roomCode}</strong>.</p>
          <form id="form-nick-prompt">
            <div class="form-group">
              <input type="text" class="text-input" id="prompt-nick-input" placeholder="Your name" maxlength="20" autofocus required>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Join room</button>
          </form>
        </div>
      </div>
    `;

    const form = this.root.querySelector('#form-nick-prompt');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nick = this.root.querySelector('#prompt-nick-input').value.trim();
      if (nick) {
        this.nickname = nick;
        setStoredNickname(nick);
        this.enterRoom();
      }
    });
  }

  renderNotFound() {
    this.root.innerHTML = `
      <div class="error-page">
        <h1 class="error-title">Room not found</h1>
        <p class="error-desc">That room doesn't exist (any more) or may have expired.</p>
        <button class="btn btn-primary" id="btn-back-home">Create a new room</button>
      </div>
    `;
    this.root.querySelector('#btn-back-home').addEventListener('click', () => {
      this.navigate('/');
    });
  }

  enterRoom() {
    document.title = `Couchlight — Room ${this.roomCode}`;

    this.root.innerHTML = `
      <div class="room-page" id="room-page">
        <div class="reconnect-banner is-hidden" id="reconnect-banner">
          Reconnecting to screening room...
        </div>

        <header class="room-header">
          <div class="header-left">
            <span class="header-brand" id="header-brand">Couchlight</span>
            <span class="header-sep">/</span>
            <span class="header-room-name" id="header-room-name">Room ${this.roomCode}</span>
            <div class="code-chip" id="code-chip" title="Click to copy invite link">
              <span class="code-text">${this.roomCode}</span>
              ${ICONS.copy}
            </div>
          </div>

          <div class="header-right">
            <div class="member-avatars-stack" id="member-avatars-stack"></div>
            <div class="status-indicator is-online" id="status-indicator" title="Connected"></div>
            <button class="btn-icon" id="header-cinema-btn" aria-label="Cinema mode" title="Cinema mode (c)">
              ${ICONS.cinema}
            </button>
            <button class="btn-icon" id="header-help-btn" aria-label="Shortcuts" title="Keyboard shortcuts (?)">
              ${ICONS.help}
            </button>
            <button class="btn-icon" id="header-leave-btn" aria-label="Leave room" title="Leave room">
              ${ICONS.leave}
            </button>
          </div>
        </header>

        <div class="room-layout">
          <main class="room-main">
            <div class="player-container" id="player-container"></div>
            
            <div class="player-subbar">
              <div class="now-playing-line" id="now-playing-line">
                <span class="now-playing-label">Now playing:</span>
                <span class="now-playing-title" id="now-playing-title">No video selected</span>
              </div>
              <div class="reactions-bar-container" id="reactions-bar-container"></div>
            </div>
          </main>

          <aside class="room-sidebar" id="room-sidebar">
            <div class="sidebar-tabs">
              <button class="tab-btn is-active" data-tab="chat">
                Chat <span class="tab-badge is-hidden" id="chat-badge">0</span>
              </button>
              <button class="tab-btn" data-tab="queue">Queue</button>
              <button class="tab-btn" data-tab="polls">
                Polls <span class="tab-badge is-hidden" id="polls-badge">0</span>
              </button>
              <button class="tab-btn" data-tab="browse">Browse</button>
              <button class="tab-btn" data-tab="people">People</button>
            </div>

            <div class="sidebar-tab-content" id="tab-content-chat"></div>
            <div class="sidebar-tab-content is-hidden" id="tab-content-queue"></div>
            <div class="sidebar-tab-content is-hidden" id="tab-content-polls"></div>
            <div class="sidebar-tab-content is-hidden" id="tab-content-browse"></div>
            <div class="sidebar-tab-content is-hidden" id="tab-content-people"></div>
          </aside>
        </div>

        <div class="shortcuts-popover is-hidden" id="shortcuts-popover">
          <div class="shortcuts-card">
            <div class="shortcuts-head">
              <h3>Keyboard shortcuts</h3>
              <button class="btn-icon btn-sm" id="close-shortcuts-btn">${ICONS.close}</button>
            </div>
            <ul class="shortcuts-list">
              <li><kbd>Space</kbd> <span>Play / Pause</span></li>
              <li><kbd>F</kbd> <span>Fullscreen</span></li>
              <li><kbd>M</kbd> <span>Mute / Unmute</span></li>
              <li><kbd>C</kbd> <span>Cinema mode</span></li>
              <li><kbd>/</kbd> <span>Focus chat</span></li>
              <li><kbd>?</kbd> <span>This shortcuts dialog</span></li>
            </ul>
          </div>
        </div>
      </div>
    `;

    this.bindRoomEvents();
    this.initSocket();
  }

  bindRoomEvents() {
    const page = this.root.querySelector('#room-page');

    this.root.querySelector('#header-brand').addEventListener('click', () => {
      this.navigate('/');
    });

    this.root.querySelector('#code-chip').addEventListener('click', () => {
      const code = this.roomCode;
      navigator.clipboard.writeText(code).then(() => {
        showToast('Room code copied to clipboard');
      }).catch(() => {
        showToast(`Code: ${code}`);
      });
    });

    this.root.querySelector('#header-cinema-btn').addEventListener('click', () => {
      this.toggleCinemaMode();
    });

    const popover = this.root.querySelector('#shortcuts-popover');
    this.root.querySelector('#header-help-btn').addEventListener('click', () => {
      popover.classList.toggle('is-hidden');
    });
    this.root.querySelector('#close-shortcuts-btn').addEventListener('click', () => {
      popover.classList.add('is-hidden');
    });

    this.root.querySelector('#header-leave-btn').addEventListener('click', () => {
      this.navigate('/');
    });

    // Tab switching
    const tabBtns = this.root.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });
  }

  switchTab(tab) {
    this.activeTab = tab;
    const tabBtns = this.root.querySelectorAll('.tab-btn');
    tabBtns.forEach(b => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
    });

    const contents = this.root.querySelectorAll('.sidebar-tab-content');
    contents.forEach(c => {
      c.classList.toggle('is-hidden', c.id !== `tab-content-${tab}`);
    });

    if (tab === 'chat' && this.chatPanel) {
      this.chatPanel.markTabActive();
    }
  }

  initSocket() {
    this.socket = new SocketClient({
      roomCode: this.roomCode,
      clientId: this.clientId,
      nickname: this.nickname,

      onStatusChange: (status) => {
        const indicator = this.root.querySelector('#status-indicator');
        const banner = this.root.querySelector('#reconnect-banner');
        if (!indicator) return;

        indicator.className = `status-indicator is-${status}`;
        if (status === 'reconnecting') {
          if (banner) banner.classList.remove('is-hidden');
        } else {
          if (banner) banner.classList.add('is-hidden');
        }
      },

      onSnapshot: (snap) => {
        this.roomData = snap;
        this.root.querySelector('#header-room-name').textContent = snap.name || `Room ${this.roomCode}`;
        document.title = `${snap.name || 'Room ' + this.roomCode} — Couchlight`;

        this.initPanels();

        this.player.applyRemoteState(snap.playback);
        this.player.setReactions(snap.reactions);

        this.chatPanel.setMessages(snap.chat);
        this.queuePanel.setQueue(snap.queue);
        this.pollsPanel.setMembers(snap.members);
        this.pollsPanel.setPolls(snap.polls);
        this.peoplePanel.setMembers(snap.members, snap.hostId);
        this.peoplePanel.setControlMode(snap.controlMode);

        this.updateHeaderAvatars(snap.members);
        this.updateNowPlayingLine(snap.playback);
      },

      onState: (msg) => {
        if (this.player) {
          this.player.applyRemoteState(msg.playback);
        }
        this.updateNowPlayingLine(msg.playback, msg.by);
      },

      onMembers: (msg) => {
        if (this.roomData) {
          this.roomData.members = msg.members;
          this.roomData.hostId = msg.hostId;
        }
        if (this.peoplePanel) {
          this.peoplePanel.setMembers(msg.members, msg.hostId);
        }
        if (this.pollsPanel) {
          this.pollsPanel.setMembers(msg.members);
        }
        this.updateHeaderAvatars(msg.members);
      },

      onChat: (msg) => {
        if (this.chatPanel) {
          this.chatPanel.addMessage(msg.message);
        }
      },

      onReaction: (msg) => {
        if (this.player && msg.reaction) {
          this.player.addReaction(msg.reaction);
        }
      },

      onQueue: (msg) => {
        if (this.queuePanel) {
          this.queuePanel.setQueue(msg.queue);
        }
      },

      onPollUpdate: (msg) => {
        if (this.pollsPanel) {
          this.pollsPanel.updatePoll(msg.poll);
        }
      },

      onHostChange: (msg) => {
        if (this.roomData) {
          this.roomData.hostId = msg.hostId;
        }
        if (this.peoplePanel) {
          this.peoplePanel.setMembers(msg.members, msg.hostId);
        }
        this.updateHeaderAvatars(msg.members);
        showToast(`Host transferred to ${msg.hostName}`);
      },

      onControlMode: (msg) => {
        if (this.roomData) {
          this.roomData.controlMode = msg.mode;
        }
        if (this.peoplePanel) {
          this.peoplePanel.setControlMode(msg.mode);
        }
        if (this.queuePanel) {
          this.queuePanel.render();
        }
      },

      onTyping: (msg) => {
        if (this.chatPanel) {
          this.chatPanel.showTyping(msg.name);
        }
      },

      onRoomNotFound: () => {
        this.renderNotFound();
      },

      onError: (err) => {
        showToast(err.message || 'An error occurred', 'error');
      }
    });

    this.socket.connect();
  }

  initPanels() {
    if (this.player) return;

    // Player
    const playerContainer = this.root.querySelector('#player-container');
    this.player = new VideoPlayer({
      container: playerContainer,
      socket: this.socket,
      onCinemaToggle: () => this.toggleCinemaMode()
    });

    // Reactions Bar
    const reactionsContainer = this.root.querySelector('#reactions-bar-container');
    this.reactionsBar = new ReactionsBar({
      container: reactionsContainer,
      socket: this.socket,
      getCurrentTime: () => this.player.video ? this.player.video.currentTime : 0
    });

    // Chat
    const chatContainer = this.root.querySelector('#tab-content-chat');
    this.chatPanel = new ChatPanel({
      container: chatContainer,
      socket: this.socket,
      isActiveTab: () => this.activeTab === 'chat',
      onUnreadChange: (count) => {
        const badge = this.root.querySelector('#chat-badge');
        if (badge) {
          badge.textContent = count;
          badge.classList.toggle('is-hidden', count === 0);
        }
      }
    });

    // Queue
    const queueContainer = this.root.querySelector('#tab-content-queue');
    this.queuePanel = new QueuePanel({
      container: queueContainer,
      socket: this.socket,
      canControl: () => this.canControl()
    });

    // Polls
    const pollsContainer = this.root.querySelector('#tab-content-polls');
    this.pollsPanel = new PollsPanel({
      container: pollsContainer,
      socket: this.socket,
      clientId: this.clientId,
      catalog: this.catalog,
      isHost: () => this.isHost(),
      onOpenPollsCountChange: (count) => {
        const badge = this.root.querySelector('#polls-badge');
        if (badge) {
          badge.textContent = count;
          badge.classList.toggle('is-hidden', count === 0);
        }
      }
    });

    // Browse
    const browseContainer = this.root.querySelector('#tab-content-browse');
    this.browsePanel = new BrowsePanel({
      container: browseContainer,
      socket: this.socket,
      roomCode: this.roomCode,
      canControl: () => this.canControl(),
      onPlayMovie: (movie) => {
        this.socket.sendControl('load', {
          itemId: movie.id,
          src: movie.src,
          title: movie.title
        });
      }
    });

    // People
    const peopleContainer = this.root.querySelector('#tab-content-people');
    this.peoplePanel = new PeoplePanel({
      container: peopleContainer,
      socket: this.socket,
      clientId: this.clientId,
      isHost: () => this.isHost(),
      getControlMode: () => (this.roomData ? this.roomData.controlMode : 'everyone')
    });
  }

  isHost() {
    return Boolean(this.roomData && this.roomData.hostId === this.clientId);
  }

  canControl() {
    if (!this.roomData) return true;
    if (this.roomData.controlMode === 'everyone') return true;
    return this.isHost();
  }

  updateHeaderAvatars(members) {
    const stack = this.root.querySelector('#member-avatars-stack');
    if (!stack || !members) return;
    stack.innerHTML = '';
    const visible = members.filter(m => m.connected).slice(0, 5);
    visible.forEach(m => {
      stack.appendChild(createAvatarElement(m));
    });
    if (members.length > 5) {
      const extra = document.createElement('div');
      extra.className = 'avatar avatar-overflow';
      extra.textContent = `+${members.length - 5}`;
      stack.appendChild(extra);
    }
  }

  updateNowPlayingLine(playback, by) {
    const titleEl = this.root.querySelector('#now-playing-title');
    if (!titleEl) return;
    if (!playback || !playback.src) {
      titleEl.textContent = 'No video selected';
      return;
    }
    const byText = by ? ` (started by ${by})` : '';
    titleEl.textContent = `${playback.title || 'Untitled'}${byText}`;
  }

  toggleCinemaMode() {
    this.isCinemaMode = !this.isCinemaMode;
    const page = this.root.querySelector('#room-page');
    if (page) {
      page.classList.toggle('is-cinema-mode', this.isCinemaMode);
    }
  }

  initGlobalShortcuts() {
    window.addEventListener('keydown', (e) => {
      const target = e.target;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        this.switchTab('chat');
        if (this.chatPanel) this.chatPanel.focusInput();
        return;
      }

      if (e.key === '?' && !isInput) {
        e.preventDefault();
        const popover = this.root.querySelector('#shortcuts-popover');
        if (popover) popover.classList.toggle('is-hidden');
        return;
      }

      if (isInput) return;

      if (e.key === 'c' || e.key === 'C') {
        this.toggleCinemaMode();
      } else if (e.key === 'f' || e.key === 'F') {
        if (this.player) this.player.toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        if (this.player && this.player.video) {
          this.player.video.muted = !this.player.video.muted;
          this.player.updateVolumeUI();
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        if (this.player && this.canControl() && this.player.currentPlayback && this.player.currentPlayback.src) {
          const next = this.player.currentPlayback.status === 'playing' ? 'pause' : 'play';
          this.socket.sendControl(next, { ref: this.player.createRef() });
        }
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
