function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;

  const row = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) row[j] = j;

  for (let i = 1; i <= al; i++) {
    let prev = i - 1;
    row[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const temp = row[j];
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, prev + 1, prev + cost);
      prev = temp;
    }
  }
  return row[bl];
}

function getTrigrams(str) {
  const set = new Set();
  const s = ' ' + str + ' ';
  for (let i = 0; i <= s.length - 3; i++) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}

function trigramJaccard(a, b) {
  const setA = getTrigrams(a);
  const setB = getTrigrams(b);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const tri of setA) {
    if (setB.has(tri)) inter++;
  }
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

function scoreMovie(movie, query) {
  const normQ = normalize(query);
  if (!normQ) return { score: 0, movie };

  const normTitle = normalize(movie.title);
  const qTokens = normQ.split(' ').filter(Boolean);
  const titleTokens = normTitle.split(' ').filter(Boolean);

  let titleScore = 0;
  if (normTitle === normQ) {
    titleScore = 100;
  } else if (normTitle.startsWith(normQ)) {
    titleScore = 80;
  } else if (normTitle.includes(normQ)) {
    titleScore = 60;
  } else {
    let tokenScoreSum = 0;
    for (const qt of qTokens) {
      let bestTokenScore = 0;
      const allowedDist = Math.min(2, Math.floor(qt.length / 4));

      for (const tt of titleTokens) {
        if (tt === qt) {
          bestTokenScore = Math.max(bestTokenScore, 50);
        } else if (tt.startsWith(qt)) {
          bestTokenScore = Math.max(bestTokenScore, 45);
        } else {
          const dist = levenshtein(qt, tt);
          if (dist <= allowedDist) {
            bestTokenScore = Math.max(bestTokenScore, 50 - 10 * dist);
          }
        }
      }

      if (bestTokenScore === 0) {
        const fallback = trigramJaccard(qt, normTitle) * 40;
        bestTokenScore = Math.max(bestTokenScore, fallback);
      }

      tokenScoreSum += bestTokenScore;
    }
    titleScore = qTokens.length > 0 ? tokenScoreSum / qTokens.length : 0;
  }

  let secondary = 0;
  const genresStr = (movie.genres || []).map(normalize).join(' ');
  const tagsStr = (movie.tags || []).map(normalize).join(' ');
  const descStr = normalize(movie.description || '');

  for (const qt of qTokens) {
    if (genresStr.includes(qt)) secondary += 12;
    if (tagsStr.includes(qt)) secondary += 8;
    if (descStr.includes(qt)) secondary += 4;
  }

  const finalScore = titleScore + Math.min(25, secondary);
  return { score: finalScore, movie };
}

export function searchMovies(catalog, options = {}) {
  const {
    q = '',
    genre = '',
    yearMin,
    yearMax,
    ratingMin,
    maxMinutes,
    sort = 'rating',
    playCounts = {}
  } = options;

  let results = catalog.slice();

  if (genre) {
    const targetGenre = genre.toLowerCase();
    results = results.filter(m =>
      m.genres && m.genres.some(g => g.toLowerCase() === targetGenre)
    );
  }

  if (yearMin !== undefined && yearMin !== '') {
    const yMin = Number(yearMin);
    results = results.filter(m => m.year >= yMin);
  }

  if (yearMax !== undefined && yearMax !== '') {
    const yMax = Number(yearMax);
    results = results.filter(m => m.year <= yMax);
  }

  if (ratingMin !== undefined && ratingMin !== '') {
    const rMin = Number(ratingMin);
    results = results.filter(m => m.rating >= rMin);
  }

  if (maxMinutes !== undefined && maxMinutes !== '') {
    const mMax = Number(maxMinutes);
    results = results.filter(m => m.minutes <= mMax);
  }

  const queryTrimmed = q ? q.trim() : '';

  if (queryTrimmed) {
    const scored = results
      .map(m => scoreMovie(m, queryTrimmed))
      .filter(item => item.score >= 18);

    scored.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 2) {
        return b.score - a.score;
      }
      return (b.movie.rating || 0) - (a.movie.rating || 0);
    });

    results = scored.map(item => item.movie);
  } else {
    results.sort((a, b) => {
      if (sort === 'year') return b.year - a.year;
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'runtime') return a.minutes - b.minutes;
      if (sort === 'popular') {
        const countA = playCounts[a.id] || 0;
        const countB = playCounts[b.id] || 0;
        return countB - countA || b.rating - a.rating;
      }
      return b.rating - a.rating;
    });
  }

  return results;
}

export function findSimilar(catalog, movieId, limit = 4) {
  const current = catalog.find(m => m.id === movieId);
  if (!current) return [];

  const currentAttrs = new Set([
    ...(current.genres || []).map(g => g.toLowerCase()),
    ...(current.tags || []).map(t => t.toLowerCase())
  ]);

  const candidates = catalog.filter(m => m.id !== movieId);

  const scored = candidates.map(other => {
    const otherAttrs = new Set([
      ...(other.genres || []).map(g => g.toLowerCase()),
      ...(other.tags || []).map(t => t.toLowerCase())
    ]);

    let inter = 0;
    for (const a of currentAttrs) {
      if (otherAttrs.has(a)) inter++;
    }
    const union = currentAttrs.size + otherAttrs.size - inter;
    const jaccard = union > 0 ? inter / union : 0;
    return { movie: other, jaccard };
  });

  scored.sort((a, b) => b.jaccard - a.jaccard || b.movie.rating - a.movie.rating);
  return scored.slice(0, limit).map(s => s.movie);
}
