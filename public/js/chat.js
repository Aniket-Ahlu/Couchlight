import { getAvatarColor, formatTime } from './util.js';

export class ChatPanel {
  constructor({ container, socket, onUnreadChange, isActiveTab }) {
    this.container = container;
    this.socket = socket;
    this.onUnreadChange = onUnreadChange || (() => {});
    this.isActiveTab = isActiveTab || (() => false);

    this.unreadCount = 0;
    this.typingTimeout = null;

    this.initDOM();
    this.initEvents();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="chat-panel">
        <div class="chat-messages" id="chat-messages">
          <div class="chat-empty">Nobody has said anything yet.</div>
        </div>

        <button class="chat-unread-pill is-hidden" id="chat-unread-pill">
          New messages ↓
        </button>

        <div class="chat-typing is-hidden" id="chat-typing"></div>

        <div class="chat-input-area">
          <textarea class="chat-textarea" id="chat-textarea" placeholder="Say something..." rows="1" maxlength="500"></textarea>
          <button class="chat-send-btn" id="chat-send-btn">Send</button>
        </div>
      </div>
    `;

    this.messagesContainer = this.container.querySelector('#chat-messages');
    this.unreadPill = this.container.querySelector('#chat-unread-pill');
    this.typingIndicator = this.container.querySelector('#chat-typing');
    this.textarea = this.container.querySelector('#chat-textarea');
    this.sendBtn = this.container.querySelector('#chat-send-btn');
  }

  initEvents() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());

    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.textarea.addEventListener('input', () => {
      this.socket.sendTyping();
    });

    this.messagesContainer.addEventListener('scroll', () => {
      if (this.isAtBottom()) {
        this.unreadPill.classList.add('is-hidden');
      }
    });

    this.unreadPill.addEventListener('click', () => {
      this.scrollToBottom();
      this.unreadPill.classList.add('is-hidden');
    });
  }

  isAtBottom() {
    const threshold = 40;
    return (
      this.messagesContainer.scrollHeight -
      this.messagesContainer.scrollTop -
      this.messagesContainer.clientHeight <= threshold
    );
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  sendMessage() {
    const text = this.textarea.value.trim();
    if (!text) return;
    this.socket.sendChat(text);
    this.textarea.value = '';
    this.textarea.focus();
  }

  focusInput() {
    if (this.textarea) {
      this.textarea.focus();
    }
  }

  setMessages(messages) {
    this.messagesContainer.innerHTML = '';
    if (!messages || messages.length === 0) {
      this.messagesContainer.innerHTML = '<div class="chat-empty">Nobody has said anything yet.</div>';
      return;
    }
    for (const msg of messages) {
      this.renderMessageElement(msg, false);
    }
    this.scrollToBottom();
  }

  addMessage(msg) {
    const emptyEl = this.messagesContainer.querySelector('.chat-empty');
    if (emptyEl) emptyEl.remove();

    const wasAtBottom = this.isAtBottom();
    this.renderMessageElement(msg, true);

    if (wasAtBottom) {
      this.scrollToBottom();
    } else {
      this.unreadPill.classList.remove('is-hidden');
    }

    if (!this.isActiveTab()) {
      this.unreadCount++;
      this.onUnreadChange(this.unreadCount);
    }
  }

  markTabActive() {
    this.unreadCount = 0;
    this.onUnreadChange(0);
    this.unreadPill.classList.add('is-hidden');
    this.scrollToBottom();
  }

  renderMessageElement(msg, shouldAnimate = true) {
    const row = document.createElement('div');
    row.className = 'chat-row' + (msg.system ? ' is-system' : '');

    if (msg.system) {
      const textSpan = document.createElement('span');
      textSpan.className = 'chat-system-text';
      textSpan.textContent = msg.text;
      row.appendChild(textSpan);
    } else {
      const meta = document.createElement('div');
      meta.className = 'chat-meta';

      const author = document.createElement('span');
      author.className = 'chat-author';
      author.textContent = msg.name || 'Guest';
      author.style.color = getAvatarColor(msg.name || 'G');

      const time = document.createElement('span');
      time.className = 'chat-time';
      const d = new Date(msg.time);
      time.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

      meta.appendChild(author);
      meta.appendChild(time);

      const body = document.createElement('div');
      body.className = 'chat-body';
      body.textContent = msg.text; // Safe textContent rendering

      row.appendChild(meta);
      row.appendChild(body);
    }

    this.messagesContainer.appendChild(row);
  }

  showTyping(name) {
    if (!name) return;
    this.typingIndicator.textContent = `${name} is typing...`;
    this.typingIndicator.classList.remove('is-hidden');

    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.typingIndicator.classList.add('is-hidden');
    }, 2500);
  }
}
