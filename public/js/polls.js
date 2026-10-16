import { ICONS, showToast } from './util.js';

export class PollsPanel {
  constructor({ container, socket, clientId, isHost, catalog, onOpenPollsCountChange }) {
    this.container = container;
    this.socket = socket;
    this.clientId = clientId;
    this.isHost = isHost || (() => false);
    this.catalog = catalog || [];
    this.onOpenPollsCountChange = onOpenPollsCountChange || (() => {});

    this.polls = [];
    this.membersMap = new Map();
    this.timerInterval = null;

    this.initDOM();
    this.initEvents();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="polls-panel">
        <div class="polls-top-bar">
          <button class="btn btn-secondary" id="poll-toggle-create-btn">Create poll</button>
          <button class="btn btn-subtle" id="poll-template-btn">Template: Watch next</button>
        </div>

        <div class="poll-create-box is-hidden" id="poll-create-box">
          <div class="poll-create-title">New group poll</div>
          <input type="text" class="text-input" id="poll-question-input" placeholder="Question or topic..." maxlength="140">
          <div class="poll-options-inputs" id="poll-options-inputs">
            <input type="text" class="text-input poll-option-input" placeholder="Option 1">
            <input type="text" class="text-input poll-option-input" placeholder="Option 2">
          </div>
          <div class="poll-create-row">
            <button class="btn btn-subtle" id="poll-add-opt-btn">+ Add option</button>
            <div class="poll-timer-select-wrap">
              <label for="poll-timer-select">Timer:</label>
              <select class="select-input" id="poll-timer-select">
                <option value="">No timer</option>
                <option value="30">30 seconds</option>
                <option value="60">60 seconds</option>
                <option value="120">2 minutes</option>
              </select>
            </div>
          </div>
          <div class="poll-actions">
            <button class="btn btn-primary" id="poll-submit-btn">Launch poll</button>
            <button class="btn btn-subtle" id="poll-cancel-btn">Cancel</button>
          </div>
        </div>

        <div class="polls-list" id="polls-list">
          <div class="polls-empty">No active polls. Create one above.</div>
        </div>
      </div>
    `;

    this.toggleCreateBtn = this.container.querySelector('#poll-toggle-create-btn');
    this.templateBtn = this.container.querySelector('#poll-template-btn');
    this.createBox = this.container.querySelector('#poll-create-box');
    this.questionInput = this.container.querySelector('#poll-question-input');
    this.optionsInputsContainer = this.container.querySelector('#poll-options-inputs');
    this.addOptBtn = this.container.querySelector('#poll-add-opt-btn');
    this.timerSelect = this.container.querySelector('#poll-timer-select');
    this.submitBtn = this.container.querySelector('#poll-submit-btn');
    this.cancelBtn = this.container.querySelector('#poll-cancel-btn');
    this.pollsList = this.container.querySelector('#polls-list');
  }

  initEvents() {
    this.toggleCreateBtn.addEventListener('click', () => {
      this.createBox.classList.toggle('is-hidden');
    });

    this.cancelBtn.addEventListener('click', () => {
      this.createBox.classList.add('is-hidden');
    });

    this.addOptBtn.addEventListener('click', () => {
      const current = this.optionsInputsContainer.querySelectorAll('.poll-option-input');
      if (current.length >= 6) {
        showToast('Maximum 6 options allowed', 'info');
        return;
      }
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input poll-option-input';
      input.placeholder = `Option ${current.length + 1}`;
      this.optionsInputsContainer.appendChild(input);
    });

    this.templateBtn.addEventListener('click', () => {
      this.createBox.classList.remove('is-hidden');
      this.questionInput.value = 'What should we watch next?';

      const shuffled = [...this.catalog].sort(() => 0.5 - Math.random()).slice(0, 4);
      this.optionsInputsContainer.innerHTML = '';
      shuffled.forEach((m) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'text-input poll-option-input';
        input.value = m.title;
        this.optionsInputsContainer.appendChild(input);
      });
      this.timerSelect.value = '60';
    });

    this.submitBtn.addEventListener('click', () => {
      const question = (this.questionInput.value || '').trim();
      const optionInputs = this.optionsInputsContainer.querySelectorAll('.poll-option-input');
      const options = Array.from(optionInputs)
        .map(i => i.value.trim())
        .filter(Boolean);

      if (!question) {
        showToast('Please enter a poll question', 'error');
        return;
      }

      if (options.length < 2) {
        showToast('At least two options are required', 'error');
        return;
      }

      const duration = this.timerSelect.value ? Number(this.timerSelect.value) : null;

      this.socket.sendPollCreate({ question, options, duration });

      this.createBox.classList.add('is-hidden');
      this.questionInput.value = '';
      this.optionsInputsContainer.innerHTML = `
        <input type="text" class="text-input poll-option-input" placeholder="Option 1">
        <input type="text" class="text-input poll-option-input" placeholder="Option 2">
      `;
    });

    // Update countdown timers every second
    this.timerInterval = setInterval(() => {
      this.updateTimers();
    }, 1000);
  }

  setMembers(members) {
    this.membersMap.clear();
    for (const m of members) {
      this.membersMap.set(m.clientId, m.name);
    }
  }

  setPolls(polls) {
    this.polls = polls || [];
    this.render();
    this.notifyOpenCount();
  }

  updatePoll(poll) {
    const idx = this.polls.findIndex(p => p.id === poll.id);
    if (idx !== -1) {
      this.polls[idx] = poll;
    } else {
      this.polls.unshift(poll);
    }
    this.render();
    this.notifyOpenCount();
  }

  notifyOpenCount() {
    const openCount = this.polls.filter(p => !p.closed).length;
    this.onOpenPollsCountChange(openCount);
  }

  render() {
    this.pollsList.innerHTML = '';
    if (this.polls.length === 0) {
      this.pollsList.innerHTML = '<div class="polls-empty">No active polls. Create one above.</div>';
      return;
    }

    const hostStatus = this.isHost();

    this.polls.forEach(poll => {
      const card = document.createElement('div');
      card.className = 'poll-card' + (poll.closed ? ' is-closed' : '');

      const head = document.createElement('div');
      head.className = 'poll-head';

      const q = document.createElement('div');
      q.className = 'poll-question';
      q.textContent = poll.question;

      const meta = document.createElement('div');
      meta.className = 'poll-meta';

      let timeText = '';
      if (!poll.closed && poll.endsAt) {
        const secLeft = Math.max(0, Math.ceil((poll.endsAt - Date.now()) / 1000));
        timeText = `${secLeft}s left`;
      } else if (poll.closed) {
        timeText = 'Closed';
      }

      meta.textContent = [poll.creatorName ? `by ${poll.creatorName}` : '', timeText].filter(Boolean).join(' · ');

      head.appendChild(q);
      head.appendChild(meta);
      card.appendChild(head);

      const totalVotes = poll.options.reduce((sum, opt) => sum + (opt.votes || []).length, 0);

      const optionsList = document.createElement('div');
      optionsList.className = 'poll-options-list';

      poll.options.forEach((opt, optIdx) => {
        const count = (opt.votes || []).length;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const userVoted = (opt.votes || []).includes(this.clientId);

        const btn = document.createElement('button');
        btn.className = 'poll-option-btn' + (userVoted ? ' is-selected' : '');
        btn.disabled = poll.closed;

        const voterNames = (opt.votes || [])
          .map(id => this.membersMap.get(id) || (id === this.clientId ? 'You' : 'Guest'))
          .join(', ');

        btn.title = voterNames ? `Voted by: ${voterNames}` : 'No votes yet';

        const bar = document.createElement('div');
        bar.className = 'poll-bar-fill';
        bar.style.width = `${pct}%`;

        const labelRow = document.createElement('div');
        labelRow.className = 'poll-option-content';

        const textSpan = document.createElement('span');
        textSpan.className = 'poll-option-text';
        textSpan.textContent = opt.text;

        const statSpan = document.createElement('span');
        statSpan.className = 'poll-option-stat';
        statSpan.textContent = `${count} (${pct}%)`;

        labelRow.appendChild(textSpan);
        labelRow.appendChild(statSpan);

        btn.appendChild(bar);
        btn.appendChild(labelRow);

        btn.addEventListener('click', () => {
          if (!poll.closed) {
            this.socket.sendPollVote(poll.id, optIdx);
          }
        });

        optionsList.appendChild(btn);
      });

      card.appendChild(optionsList);

      if (!poll.closed && (poll.creatorId === this.clientId || hostStatus)) {
        const foot = document.createElement('div');
        foot.className = 'poll-foot';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn btn-subtle';
        closeBtn.textContent = 'Close poll';
        closeBtn.addEventListener('click', () => {
          this.socket.sendPollClose(poll.id);
        });
        foot.appendChild(closeBtn);
        card.appendChild(foot);
      }

      this.pollsList.appendChild(card);
    });
  }

  updateTimers() {
    let hasActiveEnds = false;
    for (const poll of this.polls) {
      if (!poll.closed && poll.endsAt) {
        hasActiveEnds = true;
        break;
      }
    }
    if (hasActiveEnds) {
      this.render();
    }
  }

  destroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }
}
