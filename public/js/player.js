import { computeExpectedPosition, computeCorrection } from './syncMath.js';
import { formatTime, ICONS } from './util.js';

export class VideoPlayer {
  constructor({ container, socket, onCinemaToggle }) {
    this.container = container;
    this.socket = socket;
    this.onCinemaToggle = onCinemaToggle;

    this.video = null;
    this.currentPlayback = null;
    this.lastAppliedVersion = -1;
    this.userUnlockedPlayback = false;

    this.isDraggingSeek = false;
    this.hideControlsTimer = null;
    this.driftInterval = null;
    this.driftReportInterval = null;

    this.reactions = [];

    this.initDOM();
    this.initEvents();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="video-wrapper">
        <video class="video-element" playsinline preload="auto"></video>
        
        <div class="autoplay-overlay" id="autoplay-overlay">
          <div class="autoplay-card">
            <span class="autoplay-icon">${ICONS.play}</span>
            <div class="autoplay-text">Click to join the screening</div>
          </div>
        </div>

        <div class="unmute-hint is-hidden" id="unmute-hint">
          Audio muted for autoplay. Tap here to unmute.
        </div>

        <div class="reactions-overlay" id="reactions-overlay"></div>

        <div class="custom-controls" id="custom-controls">
          <div class="seek-bar-container">
            <div class="seek-heat-layer" id="seek-heat-layer"></div>
            <div class="seek-progress" id="seek-progress"></div>
            <input type="range" class="seek-slider" id="seek-slider" min="0" max="100" step="0.1" value="0" aria-label="Seek video">
          </div>

          <div class="controls-row">
            <div class="controls-left">
              <button class="ctrl-btn" id="play-pause-btn" aria-label="Play or Pause">
                ${ICONS.play}
              </button>
              <div class="time-display" id="time-display">00:00 / 00:00</div>
            </div>

            <div class="controls-right">
              <div class="volume-container">
                <button class="ctrl-btn" id="mute-btn" aria-label="Mute or Unmute">
                  ${ICONS.volume}
                </button>
                <input type="range" class="volume-slider" id="volume-slider" min="0" max="1" step="0.05" value="1" aria-label="Volume">
              </div>

              <button class="ctrl-btn" id="cinema-btn" aria-label="Cinema mode">
                ${ICONS.cinema}
              </button>

              <button class="ctrl-btn" id="fs-btn" aria-label="Fullscreen">
                ${ICONS.fullscreen}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.video = this.container.querySelector('.video-element');
    this.autoplayOverlay = this.container.querySelector('#autoplay-overlay');
    this.unmuteHint = this.container.querySelector('#unmute-hint');
    this.reactionsOverlay = this.container.querySelector('#reactions-overlay');
    this.controls = this.container.querySelector('#custom-controls');
    this.playPauseBtn = this.container.querySelector('#play-pause-btn');
    this.timeDisplay = this.container.querySelector('#time-display');
    this.seekSlider = this.container.querySelector('#seek-slider');
    this.seekProgress = this.container.querySelector('#seek-progress');
    this.seekHeatLayer = this.container.querySelector('#seek-heat-layer');
    this.muteBtn = this.container.querySelector('#mute-btn');
    this.volumeSlider = this.container.querySelector('#volume-slider');
    this.cinemaBtn = this.container.querySelector('#cinema-btn');
    this.fsBtn = this.container.querySelector('#fs-btn');
    this.wrapper = this.container.querySelector('.video-wrapper');
  }

  initEvents() {
    this.autoplayOverlay.addEventListener('click', () => {
      this.userUnlockedPlayback = true;
      this.autoplayOverlay.classList.add('is-hidden');
      if (this.currentPlayback && this.currentPlayback.status === 'playing') {
        this.attemptPlay();
      }
    });

    this.unmuteHint.addEventListener('click', () => {
      this.video.muted = false;
      this.unmuteHint.classList.add('is-hidden');
      this.updateVolumeUI();
    });

    // Custom controls only send actions to server
    this.playPauseBtn.addEventListener('click', () => {
      this.userUnlockedPlayback = true;
      this.autoplayOverlay.classList.add('is-hidden');

      if (!this.currentPlayback || !this.currentPlayback.src) return;

      const nextAction = this.currentPlayback.status === 'playing' ? 'pause' : 'play';
      this.socket.sendControl(nextAction, { ref: this.createRef() });
    });

    this.seekSlider.addEventListener('mousedown', () => { this.isDraggingSeek = true; });
    this.seekSlider.addEventListener('touchstart', () => { this.isDraggingSeek = true; }, { passive: true });

    this.seekSlider.addEventListener('input', (e) => {
      const dur = this.video.duration || 0;
      const targetSec = (Number(e.target.value) / 100) * dur;
      this.updateTimeDisplay(targetSec, dur);
      this.seekProgress.style.width = `${e.target.value}%`;
    });

    const finishSeek = (e) => {
      if (!this.isDraggingSeek) return;
      this.isDraggingSeek = false;
      const dur = this.video.duration || 0;
      if (dur > 0) {
        const targetSec = (Number(this.seekSlider.value) / 100) * dur;
        this.socket.sendControl('seek', { position: targetSec, ref: this.createRef() });
      }
    };

    this.seekSlider.addEventListener('mouseup', finishSeek);
    this.seekSlider.addEventListener('touchend', finishSeek);
    this.seekSlider.addEventListener('change', finishSeek);

    this.volumeSlider.addEventListener('input', (e) => {
      this.video.volume = Number(e.target.value);
      this.video.muted = this.video.volume === 0;
      this.updateVolumeUI();
    });

    this.muteBtn.addEventListener('click', () => {
      this.video.muted = !this.video.muted;
      this.updateVolumeUI();
    });

    this.cinemaBtn.addEventListener('click', () => {
      if (this.onCinemaToggle) this.onCinemaToggle();
    });

    this.fsBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    // Activity tracking for control bar auto-hide
    const resetHideTimer = () => {
      this.controls.classList.remove('is-faded');
      if (this.hideControlsTimer) clearTimeout(this.hideControlsTimer);
      if (this.currentPlayback && this.currentPlayback.status === 'playing' && !this.isDraggingSeek) {
        this.hideControlsTimer = setTimeout(() => {
          this.controls.classList.add('is-faded');
        }, 2500);
      }
    };

    this.wrapper.addEventListener('mousemove', resetHideTimer);
    this.wrapper.addEventListener('mouseenter', resetHideTimer);
    this.wrapper.addEventListener('mouseleave', () => {
      if (this.currentPlayback && this.currentPlayback.status === 'playing' && !this.isDraggingSeek) {
        this.controls.classList.add('is-faded');
      }
    });

    // Native video events used only for telemetry, buffering, ended (NEVER echo controls)
    this.video.addEventListener('timeupdate', () => {
      if (!this.isDraggingSeek) {
        const cur = this.video.currentTime || 0;
        const dur = this.video.duration || 0;
        this.updateTimeDisplay(cur, dur);
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        this.seekSlider.value = pct;
        this.seekProgress.style.width = `${pct}%`;
      }
    });

    this.video.addEventListener('waiting', () => {
      this.socket.sendBuffering(true);
    });

    this.video.addEventListener('playing', () => {
      this.socket.sendBuffering(false);
    });

    this.video.addEventListener('stalled', () => {
      this.socket.sendBuffering(true);
    });

    this.video.addEventListener('canplay', () => {
      this.socket.sendBuffering(false);
    });

    this.video.addEventListener('ended', () => {
      if (this.currentPlayback && this.currentPlayback.itemId) {
        this.socket.sendEnded(this.currentPlayback.itemId);
      }
    });

    // Start drift check loop (every 1000ms)
    this.driftInterval = setInterval(() => this.runDriftCheck(), 1000);

    // Periodic drift reporting to server (every 3000ms)
    this.driftReportInterval = setInterval(() => {
      if (this.currentPlayback && this.video.src && !this.video.paused) {
        const expected = computeExpectedPosition(this.currentPlayback, this.socket.serverNow());
        const driftSec = (this.video.currentTime || 0) - expected;
        this.socket.sendDrift(Math.round(driftSec * 1000));
      }
    }, 3000);
  }

  createRef() {
    return 'ref_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  applyRemoteState(playback) {
    if (!playback) return;
    if (playback.version <= this.lastAppliedVersion) {
      return;
    }
    this.lastAppliedVersion = playback.version;
    this.currentPlayback = playback;

    this.updatePlayPauseIcon(playback.status === 'playing');

    if (!playback.src) {
      this.video.removeAttribute('src');
      this.video.load();
      this.updateTimeDisplay(0, 0);
      return;
    }

    const needsSourceChange = this.video.src !== playback.src && !this.video.src.endsWith(playback.src);

    if (needsSourceChange) {
      this.video.src = playback.src;
      this.video.load();

      const onLoaded = () => {
        this.video.removeEventListener('loadedmetadata', onLoaded);
        this.renderReactionHeat();
        this.syncToCurrentPlayback();
      };
      this.video.addEventListener('loadedmetadata', onLoaded);
    } else {
      this.syncToCurrentPlayback();
    }
  }

  syncToCurrentPlayback() {
    if (!this.currentPlayback) return;
    const expected = computeExpectedPosition(this.currentPlayback, this.socket.serverNow());

    if (this.currentPlayback.status === 'playing') {
      if (Math.abs(this.video.currentTime - expected) > 0.3) {
        this.video.currentTime = Math.max(0, expected);
      }
      this.attemptPlay();
    } else {
      if (Math.abs(this.video.currentTime - this.currentPlayback.position) > 0.2) {
        this.video.currentTime = Math.max(0, this.currentPlayback.position);
      }
      this.video.pause();
    }
  }

  attemptPlay() {
    if (!this.userUnlockedPlayback) {
      this.autoplayOverlay.classList.remove('is-hidden');
      return;
    }

    const playPromise = this.video.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        // Autoplay policy rejected: retry muted
        this.video.muted = true;
        this.unmuteHint.classList.remove('is-hidden');
        this.updateVolumeUI();
        this.video.play().catch(() => {
          this.autoplayOverlay.classList.remove('is-hidden');
        });
      });
    }
  }

  runDriftCheck() {
    if (!this.currentPlayback || !this.video.src || isNaN(this.video.duration)) {
      return;
    }

    const expected = computeExpectedPosition(this.currentPlayback, this.socket.serverNow());
    const current = this.video.currentTime || 0;
    const isPlaying = !this.video.paused && this.currentPlayback.status === 'playing';

    const correction = computeCorrection({
      playing: isPlaying,
      current,
      expected,
      rate: this.video.playbackRate
    });

    if (correction.action === 'seek') {
      this.video.currentTime = Math.max(0, correction.target);
      this.video.playbackRate = 1.0;
    } else if (correction.action === 'nudge') {
      this.video.playbackRate = correction.rate;
    } else {
      if (this.video.playbackRate !== 1.0) {
        this.video.playbackRate = 1.0;
      }
    }
  }

  updateTimeDisplay(current, duration) {
    this.timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
  }

  updatePlayPauseIcon(isPlaying) {
    this.playPauseBtn.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
  }

  updateVolumeUI() {
    this.muteBtn.innerHTML = this.video.muted || this.video.volume === 0 ? ICONS.mute : ICONS.volume;
    this.volumeSlider.value = this.video.muted ? 0 : this.video.volume;
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.wrapper.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  setReactions(reactions) {
    this.reactions = reactions || [];
    this.renderReactionHeat();
  }

  addReaction(reaction) {
    this.reactions.push(reaction);
    if (this.reactions.length > 500) this.reactions.shift();
    this.renderReactionHeat();
    this.spawnFloatingReaction(reaction.emoji);
  }

  spawnFloatingReaction(emoji) {
    if (!this.reactionsOverlay) return;

    // Cap active floating reactions to 30
    const active = this.reactionsOverlay.querySelectorAll('.floating-emoji');
    if (active.length >= 30) {
      active[0].remove();
    }

    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;

    // Slight horizontal randomness (20% to 80%)
    const leftPct = 15 + Math.random() * 70;
    el.style.left = `${leftPct}%`;

    this.reactionsOverlay.appendChild(el);

    el.addEventListener('animationend', () => {
      el.remove();
    });
  }

  renderReactionHeat() {
    const dur = this.video.duration;
    if (!dur || dur <= 0 || !this.reactions.length) {
      this.seekHeatLayer.innerHTML = '';
      return;
    }

    // 10s buckets
    const bucketSize = 10;
    const bucketCount = Math.ceil(dur / bucketSize);
    const buckets = new Array(bucketCount).fill(0).map(() => ({ count: 0, emojis: {} }));

    let maxCount = 0;
    for (const r of this.reactions) {
      const bIdx = Math.min(bucketCount - 1, Math.floor(r.videoTime / bucketSize));
      if (bIdx >= 0) {
        buckets[bIdx].count++;
        buckets[bIdx].emojis[r.emoji] = (buckets[bIdx].emojis[r.emoji] || 0) + 1;
        if (buckets[bIdx].count > maxCount) {
          maxCount = buckets[bIdx].count;
        }
      }
    }

    if (maxCount === 0) {
      this.seekHeatLayer.innerHTML = '';
      return;
    }

    this.seekHeatLayer.innerHTML = '';
    buckets.forEach((b, idx) => {
      if (b.count === 0) return;
      const leftPct = ((idx * bucketSize) / dur) * 100;
      const widthPct = Math.max(0.5, (bucketSize / dur) * 100);
      const heightPct = Math.min(100, Math.max(25, (b.count / maxCount) * 100));

      let topEmoji = '🔥';
      let topNum = 0;
      for (const [em, cnt] of Object.entries(b.emojis)) {
        if (cnt > topNum) {
          topNum = cnt;
          topEmoji = em;
        }
      }

      const mark = document.createElement('div');
      mark.className = 'heat-mark';
      mark.style.left = `${leftPct}%`;
      mark.style.width = `${widthPct}%`;
      mark.style.height = `${heightPct}%`;
      mark.title = `${topEmoji} (${b.count} reactions)`;

      this.seekHeatLayer.appendChild(mark);
    });
  }

  destroy() {
    if (this.driftInterval) clearInterval(this.driftInterval);
    if (this.driftReportInterval) clearInterval(this.driftReportInterval);
    if (this.hideControlsTimer) clearTimeout(this.hideControlsTimer);
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
  }
}
