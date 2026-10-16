const POSTER_PALETTE = [
  '#3d4739',
  '#543f34',
  '#36444d',
  '#4c3a42',
  '#4f4535',
  '#3d464a',
  '#594336',
  '#37453f'
];

function hashTitle(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function wrapText(text, maxCharsPerLine = 14, maxLines = 4) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxCharsPerLine) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

export function generatePosterSvg(movie, width = 200, height = 300) {
  const bg = movie.color || POSTER_PALETTE[hashTitle(movie.title || '') % POSTER_PALETTE.length];
  const lines = wrapText(movie.title || 'Untitled', 14, 4);

  const tspans = lines.map((line, i) =>
    `<tspan x="24" dy="${i === 0 ? 0 : 26}">${escapeXml(line)}</tspan>`
  ).join('');

  const year = movie.year || '';
  const runtime = movie.minutes != null && movie.minutes !== ''
    ? (movie.minutes < 1 ? 'UNDER 1 MIN' : `${Math.round(movie.minutes)} MIN`)
    : '';
  const footer = [year, runtime].filter(Boolean).join(' · ');

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice">
  <rect width="200" height="300" fill="${bg}"/>
  <rect x="12" y="12" width="176" height="276" fill="none" stroke="rgba(236, 229, 220, 0.22)" stroke-width="1"/>
  <text x="24" y="60" fill="#ece5dc" font-family="'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" font-size="20" font-weight="600" letter-spacing="-0.3">
    ${tspans}
  </text>
  <text x="24" y="270" fill="rgba(236, 229, 220, 0.55)" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" letter-spacing="1.5">
    ${escapeXml(footer)}
  </text>
</svg>
`.trim();
}

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}
