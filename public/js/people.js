import { createAvatarElement, ICONS } from './util.js';

export class PeoplePanel {
  constructor({ container, socket, clientId, isHost, getControlMode }) {
    this.container = container;
    this.socket = socket;
    this.clientId = clientId;
    this.isHost = isHost || (() => false);
    this.getControlMode = getControlMode || (() => 'everyone');

    this.members = [];
    this.hostId = null;

    this.initDOM();
    this.initEvents();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="people-panel">
        <div class="people-controls-bar is-hidden" id="host-controls-bar">
          <div class="control-mode-group">
            <span class="control-mode-label">Playback control:</span>
            <div class="btn-group">
              <button class="btn btn-subtle is-active" id="mode-everyone-btn">Everyone</button>
              <button class="btn btn-subtle" id="mode-host-btn">Host only</button>
            </div>
          </div>
        </div>

        <div class="people-list-title">Members in room</div>
        <div class="people-list" id="people-list"></div>
      </div>
    `;

    this.hostControlsBar = this.container.querySelector('#host-controls-bar');
    this.modeEveryoneBtn = this.container.querySelector('#mode-everyone-btn');
    this.modeHostBtn = this.container.querySelector('#mode-host-btn');
    this.list = this.container.querySelector('#people-list');
  }

  initEvents() {
    this.modeEveryoneBtn.addEventListener('click', () => {
      this.socket.sendControlMode('everyone');
    });

    this.modeHostBtn.addEventListener('click', () => {
      this.socket.sendControlMode('host');
    });
  }

  setMembers(members, hostId) {
    this.members = members || [];
    this.hostId = hostId;
    this.render();
  }

  setControlMode(mode) {
    if (mode === 'host') {
      this.modeHostBtn.classList.add('is-active');
      this.modeEveryoneBtn.classList.remove('is-active');
    } else {
      this.modeEveryoneBtn.classList.add('is-active');
      this.modeHostBtn.classList.remove('is-active');
    }
  }

  render() {
    const isCurrentUserHost = this.isHost();
    if (isCurrentUserHost) {
      this.hostControlsBar.classList.remove('is-hidden');
    } else {
      this.hostControlsBar.classList.add('is-hidden');
    }

    const currentMode = this.getControlMode();
    this.setControlMode(currentMode);

    this.list.innerHTML = '';

    this.members.forEach(member => {
      const row = document.createElement('div');
      row.className = 'people-row' + (!member.connected ? ' is-reconnecting' : '');

      const left = document.createElement('div');
      left.className = 'people-left';

      left.appendChild(createAvatarElement(member));

      const info = document.createElement('div');
      info.className = 'people-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'people-name-row';

      const name = document.createElement('span');
      name.className = 'people-name';
      name.textContent = member.name;

      nameRow.appendChild(name);

      if (member.clientId === this.clientId) {
        const youTag = document.createElement('span');
        youTag.className = 'tag-pill';
        youTag.textContent = 'You';
        nameRow.appendChild(youTag);
      }

      if (member.isHost) {
        const hostTag = document.createElement('span');
        hostTag.className = 'tag-pill tag-accent';
        hostTag.textContent = 'Host';
        nameRow.appendChild(hostTag);
      }

      const statusRow = document.createElement('div');
      statusRow.className = 'people-status-row';

      if (!member.connected) {
        statusRow.textContent = 'Reconnecting...';
      } else if (member.buffering) {
        statusRow.innerHTML = `<span class="health-dot health-bad"></span> Buffering...`;
      } else {
        const absDrift = Math.abs(member.driftMs || 0);
        let dotClass = 'health-good';
        if (absDrift >= 500) {
          dotClass = 'health-bad';
        } else if (absDrift >= 150) {
          dotClass = 'health-warn';
        }

        const sign = (member.driftMs || 0) >= 0 ? '+' : '';
        statusRow.innerHTML = `
          <span class="health-dot ${dotClass}"></span>
          <span class="sync-metric">${sign}${member.driftMs || 0}ms drift</span>
          <span class="sync-sep">·</span>
          <span class="sync-metric">${member.rtt || 0}ms rtt</span>
        `;
      }

      info.appendChild(nameRow);
      info.appendChild(statusRow);
      left.appendChild(info);

      row.appendChild(left);

      // Host transfer button
      if (isCurrentUserHost && member.clientId !== this.clientId && member.connected) {
        const right = document.createElement('div');
        right.className = 'people-right';

        const transferBtn = document.createElement('button');
        transferBtn.className = 'btn btn-subtle btn-sm';
        transferBtn.textContent = 'Make host';
        transferBtn.title = 'Transfer host to this member';
        transferBtn.addEventListener('click', () => {
          this.socket.sendHostTransfer(member.clientId);
        });

        right.appendChild(transferBtn);
        row.appendChild(right);
      }

      this.list.appendChild(row);
    });
  }
}
