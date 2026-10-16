import { ICONS, formatTime, showToast } from './util.js';

export class QueuePanel {
  constructor({ container, socket, canControl }) {
    this.container = container;
    this.socket = socket;
    this.canControl = canControl || (() => true);
    this.queue = [];

    this.initDOM();
    this.initEvents();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="queue-panel">
        <div class="queue-add-box">
          <div class="queue-add-title">Add custom video</div>
          <div class="queue-inputs">
            <input type="url" class="text-input" id="queue-url" placeholder="Direct video URL (https://...mp4)">
            <input type="text" class="text-input" id="queue-custom-title" placeholder="Title (optional)">
          </div>
          <div class="queue-add-actions">
            <button class="btn btn-secondary" id="queue-add-btn">Add to queue</button>
            <button class="btn btn-subtle" id="queue-local-btn">Pick local file</button>
          </div>
          <div class="local-media-dropdown is-hidden" id="local-media-dropdown"></div>
        </div>

        <div class="queue-list" id="queue-list">
          <div class="queue-empty">Queue's empty. Add something from Browse.</div>
        </div>
      </div>
    `;

    this.urlInput = this.container.querySelector('#queue-url');
    this.titleInput = this.container.querySelector('#queue-custom-title');
    this.addBtn = this.container.querySelector('#queue-add-btn');
    this.localBtn = this.container.querySelector('#queue-local-btn');
    this.localDropdown = this.container.querySelector('#local-media-dropdown');
    this.queueList = this.container.querySelector('#queue-list');
  }

  initEvents() {
    this.addBtn.addEventListener('click', () => {
      const url = (this.urlInput.value || '').trim();
      const title = (this.titleInput.value || '').trim();

      if (!url) {
        showToast('Please enter a valid video URL', 'error');
        return;
      }

      if (!/^https?:\/\//i.test(url)) {
        showToast('URL must start with http:// or https://', 'error');
        return;
      }

      this.socket.sendQueueAdd({
        id: 'custom-' + Date.now().toString(36),
        title: title || 'Custom Video',
        src: url,
        duration: 0
      });

      this.urlInput.value = '';
      this.titleInput.value = '';
    });

    this.localBtn.addEventListener('click', async () => {
      if (!this.localDropdown.classList.contains('is-hidden')) {
        this.localDropdown.classList.add('is-hidden');
        return;
      }

      try {
        const res = await fetch('/api/local-media');
        const media = await res.json();
        if (!media || media.length === 0) {
          showToast('No local media found in public/media/', 'info');
          return;
        }

        this.localDropdown.innerHTML = '';
        for (const item of media) {
          const btn = document.createElement('button');
          btn.className = 'local-media-item';
          btn.textContent = item.title;
          btn.addEventListener('click', () => {
            this.socket.sendQueueAdd({
              id: 'local-' + Date.now().toString(36),
              title: item.title,
              src: item.src,
              duration: 0
            });
            this.localDropdown.classList.add('is-hidden');
          });
          this.localDropdown.appendChild(btn);
        }
        this.localDropdown.classList.remove('is-hidden');
      } catch (err) {
        showToast('Failed to load local media', 'error');
      }
    });
  }

  setQueue(queue) {
    this.queue = queue || [];
    this.render();
  }

  render() {
    this.queueList.innerHTML = '';
    if (this.queue.length === 0) {
      this.queueList.innerHTML = '<div class="queue-empty">Queue\'s empty. Add something from Browse.</div>';
      return;
    }

    const permitted = this.canControl();

    this.queue.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'queue-item';

      const num = document.createElement('div');
      num.className = 'queue-item-index';
      num.textContent = index + 1;

      const info = document.createElement('div');
      info.className = 'queue-item-info';

      const title = document.createElement('div');
      title.className = 'queue-item-title';
      title.textContent = item.title;

      const meta = document.createElement('div');
      meta.className = 'queue-item-meta';
      const dur = item.duration ? formatTime(item.duration) : '';
      meta.textContent = [item.addedBy ? `by ${item.addedBy}` : '', dur].filter(Boolean).join(' · ');

      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'queue-item-actions';

      if (permitted) {
        const playBtn = document.createElement('button');
        playBtn.className = 'btn-icon';
        playBtn.title = 'Play now';
        playBtn.setAttribute('aria-label', 'Play now');
        playBtn.innerHTML = ICONS.play;
        playBtn.addEventListener('click', () => {
          this.socket.sendQueuePlay(item.id);
        });
        actions.appendChild(playBtn);
      }

      if (index > 0) {
        const upBtn = document.createElement('button');
        upBtn.className = 'btn-icon';
        upBtn.title = 'Move up';
        upBtn.setAttribute('aria-label', 'Move up');
        upBtn.innerHTML = ICONS.up;
        upBtn.addEventListener('click', () => {
          this.socket.sendQueueReorder(index, index - 1);
        });
        actions.appendChild(upBtn);
      }

      if (index < this.queue.length - 1) {
        const downBtn = document.createElement('button');
        downBtn.className = 'btn-icon';
        downBtn.title = 'Move down';
        downBtn.setAttribute('aria-label', 'Move down');
        downBtn.innerHTML = ICONS.down;
        downBtn.addEventListener('click', () => {
          this.socket.sendQueueReorder(index, index + 1);
        });
        actions.appendChild(downBtn);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-icon btn-danger';
      removeBtn.title = 'Remove';
      removeBtn.setAttribute('aria-label', 'Remove from queue');
      removeBtn.innerHTML = ICONS.trash;
      removeBtn.addEventListener('click', () => {
        this.socket.sendQueueRemove(item.id);
      });
      actions.appendChild(removeBtn);

      row.appendChild(num);
      row.appendChild(info);
      row.appendChild(actions);

      this.queueList.appendChild(row);
    });
  }
}
