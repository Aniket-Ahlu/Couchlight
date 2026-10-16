export class ReactionsBar {
  constructor({ container, socket, getCurrentTime }) {
    this.container = container;
    this.socket = socket;
    this.getCurrentTime = getCurrentTime || (() => 0);

    this.emojis = ['👍', '❤️', '😂', '😮', '👏', '🔥'];

    this.initDOM();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="reactions-bar">
        ${this.emojis.map(em => `
          <button class="reaction-btn" data-emoji="${em}" aria-label="React with ${em}">
            ${em}
          </button>
        `).join('')}
      </div>
    `;

    this.container.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        const cur = this.getCurrentTime();
        this.socket.sendReaction(emoji, cur);
      });
    });
  }
}
