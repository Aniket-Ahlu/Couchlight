import { generatePosterSvg } from './poster.js';
import { ICONS, showToast } from './util.js';

function formatRuntime(minutes) {
  if (minutes == null || isNaN(minutes) || minutes === '') return '';
  return minutes < 1 ? 'under 1 min' : `${Math.round(minutes)} min`;
}

export class BrowsePanel {
  constructor({ container, socket, roomCode, canControl, onPlayMovie }) {
    this.container = container;
    this.socket = socket;
    this.roomCode = roomCode;
    this.canControl = canControl || (() => true);
    this.onPlayMovie = onPlayMovie || (() => {});

    this.allGenres = [];
    this.selectedGenre = '';
    this.searchQuery = '';
    this.debounceTimer = null;

    this.filters = {
      yearMin: '',
      yearMax: '',
      ratingMin: '',
      maxMinutes: '',
      sort: 'rating'
    };

    this.initDOM();
    this.initEvents();
    this.loadGenres();
    this.loadShelves();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="browse-panel">
        <div class="browse-search-bar">
          <input type="text" class="text-input" id="browse-search-input" placeholder="Search title, genre, keyword...">
          <button class="btn btn-subtle" id="browse-filter-toggle">Filters</button>
        </div>

        <div class="browse-genre-chips" id="browse-genre-chips">
          <button class="genre-chip is-active" data-genre="">All</button>
        </div>

        <div class="browse-filter-row is-hidden" id="browse-filter-row">
          <div class="filter-col">
            <label>Year min</label>
            <input type="number" class="text-input" id="filter-year-min" placeholder="2000">
          </div>
          <div class="filter-col">
            <label>Year max</label>
            <input type="number" class="text-input" id="filter-year-max" placeholder="2025">
          </div>
          <div class="filter-col">
            <label>Min rating</label>
            <input type="number" class="text-input" id="filter-rating-min" step="0.5" placeholder="7.0">
          </div>
          <div class="filter-col">
            <label>Max min</label>
            <input type="number" class="text-input" id="filter-max-min" placeholder="15">
          </div>
          <div class="filter-col">
            <label>Sort by</label>
            <select class="select-input" id="filter-sort">
              <option value="rating">Rating</option>
              <option value="year">Year</option>
              <option value="title">Title</option>
              <option value="runtime">Runtime</option>
              <option value="popular">Popular</option>
            </select>
          </div>
        </div>

        <div class="browse-content" id="browse-content">
          <div class="browse-loading">Loading catalog...</div>
        </div>

        <div class="movie-drawer is-hidden" id="movie-drawer">
          <div class="drawer-backdrop" id="drawer-backdrop"></div>
          <div class="drawer-sheet" id="drawer-sheet">
            <button class="drawer-close-btn" id="drawer-close-btn" aria-label="Close drawer">${ICONS.close}</button>
            <div class="drawer-body" id="drawer-body"></div>
          </div>
        </div>
      </div>
    `;

    this.searchInput = this.container.querySelector('#browse-search-input');
    this.filterToggle = this.container.querySelector('#browse-filter-toggle');
    this.filterRow = this.container.querySelector('#browse-filter-row');
    this.genreChips = this.container.querySelector('#browse-genre-chips');
    this.content = this.container.querySelector('#browse-content');

    this.yearMinInput = this.container.querySelector('#filter-year-min');
    this.yearMaxInput = this.container.querySelector('#filter-year-max');
    this.ratingMinInput = this.container.querySelector('#filter-rating-min');
    this.maxMinInput = this.container.querySelector('#filter-max-min');
    this.sortSelect = this.container.querySelector('#filter-sort');

    this.drawer = this.container.querySelector('#movie-drawer');
    this.drawerBackdrop = this.container.querySelector('#drawer-backdrop');
    this.drawerCloseBtn = this.container.querySelector('#drawer-close-btn');
    this.drawerBody = this.container.querySelector('#drawer-body');
  }

  initEvents() {
    this.searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim();
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.applyBrowseQuery();
      }, 150);
    });

    this.filterToggle.addEventListener('click', () => {
      this.filterRow.classList.toggle('is-hidden');
    });

    this.genreChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.genre-chip');
      if (!chip) return;
      this.genreChips.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      this.selectedGenre = chip.dataset.genre || '';
      this.applyBrowseQuery();
    });

    const onFilterChange = () => {
      this.filters.yearMin = this.yearMinInput.value;
      this.filters.yearMax = this.yearMaxInput.value;
      this.filters.ratingMin = this.ratingMinInput.value;
      this.filters.maxMinutes = this.maxMinInput.value;
      this.filters.sort = this.sortSelect.value;
      this.applyBrowseQuery();
    };

    this.yearMinInput.addEventListener('change', onFilterChange);
    this.yearMaxInput.addEventListener('change', onFilterChange);
    this.ratingMinInput.addEventListener('change', onFilterChange);
    this.maxMinInput.addEventListener('change', onFilterChange);
    this.sortSelect.addEventListener('change', onFilterChange);

    this.drawerBackdrop.addEventListener('click', () => this.closeDrawer());
    this.drawerCloseBtn.addEventListener('click', () => this.closeDrawer());
  }

  async loadGenres() {
    try {
      const res = await fetch('/api/movies');
      const movies = await res.json();
      const set = new Set();
      movies.forEach(m => (m.genres || []).forEach(g => set.add(g)));
      this.allGenres = Array.from(set).sort();
      this.renderGenreChips();
    } catch (_) {}
  }

  renderGenreChips() {
    this.genreChips.innerHTML = `
      <button class="genre-chip ${!this.selectedGenre ? 'is-active' : ''}" data-genre="">All</button>
      ${this.allGenres.map(g => `<button class="genre-chip ${this.selectedGenre === g ? 'is-active' : ''}" data-genre="${g}">${g}</button>`).join('')}
    `;
  }

  isFilterActive() {
    return Boolean(
      this.searchQuery ||
      this.selectedGenre ||
      this.filters.yearMin ||
      this.filters.yearMax ||
      this.filters.ratingMin ||
      this.filters.maxMinutes ||
      this.filters.sort !== 'rating'
    );
  }

  async applyBrowseQuery() {
    if (!this.isFilterActive()) {
      this.loadShelves();
      return;
    }

    const params = new URLSearchParams();
    if (this.searchQuery) params.set('q', this.searchQuery);
    if (this.selectedGenre) params.set('genre', this.selectedGenre);
    if (this.filters.yearMin) params.set('yearMin', this.filters.yearMin);
    if (this.filters.yearMax) params.set('yearMax', this.filters.yearMax);
    if (this.filters.ratingMin) params.set('ratingMin', this.filters.ratingMin);
    if (this.filters.maxMinutes) params.set('maxMinutes', this.filters.maxMinutes);
    if (this.filters.sort) params.set('sort', this.filters.sort);

    try {
      const res = await fetch(`/api/movies?${params.toString()}`);
      const movies = await res.json();
      this.renderGrid(movies);
    } catch (_) {
      this.content.innerHTML = '<div class="browse-empty">Failed to load movies.</div>';
    }
  }

  async loadShelves() {
    this.content.innerHTML = '<div class="browse-loading">Loading shelves...</div>';
    try {
      const res = await fetch(`/api/shelves?room=${encodeURIComponent(this.roomCode || '')}`);
      const shelves = await res.json();
      this.renderShelves(shelves);
    } catch (_) {
      this.content.innerHTML = '<div class="browse-empty">Failed to load shelves.</div>';
    }
  }

  renderShelves(shelves) {
    this.content.innerHTML = '';
    if (!shelves || shelves.length === 0) {
      this.content.innerHTML = '<div class="browse-empty">No shelves available.</div>';
      return;
    }

    shelves.forEach(shelf => {
      if (!shelf.items || shelf.items.length === 0) return;
      const section = document.createElement('div');
      section.className = 'shelf-section';

      const title = document.createElement('h3');
      title.className = 'shelf-title';
      title.textContent = shelf.title;
      section.appendChild(title);

      const row = document.createElement('div');
      row.className = 'shelf-scroll-row';

      shelf.items.forEach(movie => {
        row.appendChild(this.createMovieCard(movie));
      });

      section.appendChild(row);
      this.content.appendChild(section);
    });
  }

  renderGrid(movies) {
    this.content.innerHTML = '';
    if (!movies || movies.length === 0) {
      this.content.innerHTML = '<div class="browse-empty">No matching movies found.</div>';
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'browse-grid';

    movies.forEach(movie => {
      grid.appendChild(this.createMovieCard(movie));
    });

    this.content.appendChild(grid);
  }

  createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';

    const posterWrap = document.createElement('div');
    posterWrap.className = 'movie-card-poster';
    posterWrap.innerHTML = generatePosterSvg(movie, 140, 210);

    const overlay = document.createElement('div');
    overlay.className = 'movie-card-overlay';

    const playBtn = document.createElement('button');
    playBtn.className = 'card-action-btn play-action';
    playBtn.innerHTML = `${ICONS.play} <span>Play</span>`;
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.canControl()) {
        showToast('Only the host can control playback', 'error');
        return;
      }
      this.onPlayMovie(movie);
    });

    const queueBtn = document.createElement('button');
    queueBtn.className = 'card-action-btn queue-action';
    queueBtn.innerHTML = `${ICONS.plus} <span>Queue</span>`;
    queueBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.socket.sendQueueAdd({
        id: movie.id,
        title: movie.title,
        src: movie.src,
        duration: movie.minutes * 60
      });
      showToast(`Added "${movie.title}" to queue`);
    });

    overlay.appendChild(playBtn);
    overlay.appendChild(queueBtn);
    posterWrap.appendChild(overlay);

    const info = document.createElement('div');
    info.className = 'movie-card-info';

    const title = document.createElement('div');
    title.className = 'movie-card-title';
    title.textContent = movie.title;

    const meta = document.createElement('div');
    meta.className = 'movie-card-meta';
    const runtimeStr = formatRuntime(movie.minutes);
    meta.textContent = [movie.year, runtimeStr, `★ ${movie.rating}`].filter(Boolean).join(' · ');

    info.appendChild(title);
    info.appendChild(meta);

    card.appendChild(posterWrap);
    card.appendChild(info);

    card.addEventListener('click', () => {
      this.openDrawer(movie);
    });

    return card;
  }

  async openDrawer(movie) {
    const runtimeStr = formatRuntime(movie.minutes);
    this.drawerBody.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-poster">${generatePosterSvg(movie, 120, 180)}</div>
        <div class="drawer-summary">
          <h2 class="drawer-title">${movie.title}</h2>
          <div class="drawer-meta">${[movie.year, runtimeStr, `★ ${movie.rating}`].filter(Boolean).join(' · ')}</div>
          <div class="drawer-credit">Credit: ${movie.credit || 'NASA'}</div>
          <div class="drawer-genres">${(movie.genres || []).map(g => `<span class="tag-chip">${g}</span>`).join('')}</div>
          <div class="drawer-actions">
            <button class="btn btn-primary" id="drawer-play-btn">${ICONS.play} Play now</button>
            <button class="btn btn-secondary" id="drawer-queue-btn">${ICONS.plus} Add to queue</button>
          </div>
        </div>
      </div>
      <div class="drawer-desc">${movie.description || ''}</div>
      <div class="drawer-tags">
        ${(movie.tags || []).map(t => `<span class="tag-subtle">#${t}</span>`).join(' ')}
      </div>
      <div class="drawer-similar-section">
        <h4 class="drawer-similar-title">More like this</h4>
        <div class="drawer-similar-row" id="drawer-similar-row">
          <div class="browse-loading">Loading similar...</div>
        </div>
      </div>
    `;

    this.drawer.querySelector('#drawer-play-btn').addEventListener('click', () => {
      if (!this.canControl()) {
        showToast('Only host can control playback', 'error');
        return;
      }
      this.onPlayMovie(movie);
      this.closeDrawer();
    });

    this.drawer.querySelector('#drawer-queue-btn').addEventListener('click', () => {
      this.socket.sendQueueAdd({
        id: movie.id,
        title: movie.title,
        src: movie.src,
        duration: movie.minutes * 60
      });
      showToast(`Added "${movie.title}" to queue`);
      this.closeDrawer();
    });

    this.drawer.classList.remove('is-hidden');

    try {
      const res = await fetch(`/api/movies/${movie.id}/similar`);
      const similar = await res.json();
      const row = this.drawerBody.querySelector('#drawer-similar-row');
      row.innerHTML = '';
      if (!similar || similar.length === 0) {
        row.innerHTML = '<span class="text-muted">No similar movies found.</span>';
        return;
      }
      similar.forEach(sim => {
        row.appendChild(this.createMovieCard(sim));
      });
    } catch (_) {}
  }

  closeDrawer() {
    this.drawer.classList.add('is-hidden');
  }
}
