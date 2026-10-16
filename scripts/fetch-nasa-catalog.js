import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputFile = path.join(rootDir, 'data', 'movies.json');

const SEED_ENTRIES = [
  {
    id: "nasa-history-montage",
    title: "Moments From NASA History",
    year: 2025,
    genres: ["Documentary", "History"],
    tags: ["moon landing", "earthrise", "shuttle", "aeronautics", "nebula"],
    rating: 7.5,
    minutes: 1,
    description: "A fast montage of NASA milestones, from the lunar surface to experimental aircraft and distant nebulae.",
    src: "https://nasa.gov/wp-content/uploads/2025/06/history-montage-2.mp4",
    credit: "NASA",
    color: "#404c59"
  },
  {
    id: "nasa-lunar-base-concept",
    title: "Lunar Base, Zoom Out",
    year: 2026,
    genres: ["Moon", "Concept"],
    tags: ["moon base", "artist concept", "habitat", "crescent earth"],
    rating: 7,
    minutes: 1,
    description: "An artist's concept of a modular moon base, pulling back to reveal vehicles, craters and a crescent Earth.",
    src: "https://nasa.gov/wp-content/uploads/2026/05/moon-base-v-1-1-5-22-26.mp4",
    credit: "NASA",
    color: "#544e45"
  },
  {
    id: "nasa-icps-separation",
    title: "Upper Stage Separation",
    year: 2026,
    genres: ["Artemis", "Spaceflight"],
    tags: ["artemis ii", "icps", "orbit", "separation"],
    rating: 8,
    minutes: 1,
    description: "Artemis II footage of the upper stage drifting away and shedding particles as the sun flares into frame.",
    src: "https://nasa.gov/wp-content/uploads/2026/04/art002m1200920156-icps-separation-2orig.mp4",
    credit: "NASA",
    color: "#3a4752"
  },
  {
    id: "nasa-tli-burn",
    title: "The Burn Toward the Moon",
    year: 2026,
    genres: ["Artemis", "Spaceflight"],
    tags: ["artemis ii", "trans-lunar injection", "orbit", "earth"],
    rating: 8.5,
    minutes: 1,
    description: "A fixed camera view from orbit during the Artemis II trans-lunar injection burn, with Earth and a solar array in frame.",
    src: "https://nasa.gov/wp-content/uploads/2026/04/art002m1200922349-tli-burn-1.mp4",
    credit: "NASA",
    color: "#384a56"
  },
  {
    id: "nasa-moon-near-far",
    title: "Moon, Near and Far",
    year: 2026,
    genres: ["Moon", "Visualization"],
    tags: ["moon phases", "earth", "milky way", "craters"],
    rating: 7.5,
    minutes: 1,
    description: "A slowly rotating close-up of the Moon, then a wide view of the Moon and Earth against the Milky Way.",
    src: "https://nasa.gov/wp-content/uploads/2026/09/moon-phases-near-far-waxing-1080.mp4",
    credit: "NASA",
    color: "#4f4942"
  },
  {
    id: "nasa-crescent-moon",
    title: "Crescent Moon From the Spacecraft",
    year: 2026,
    genres: ["Moon", "Artemis"],
    tags: ["crescent", "deep space", "engine nozzles"],
    rating: 6.5,
    minutes: 0.5,
    description: "A short, still shot of a thin crescent moon with spacecraft engine nozzles in the foreground.",
    src: "https://nasa.gov/wp-content/uploads/2026/04/output-progressive-182a999f-2b54-4fef-8636-def580cd3469.mp4",
    credit: "NASA",
    color: "#383f47"
  }
];

const API_QUERIES = [
  {
    q: "Apollo 11 moon landing",
    meta: {
      title: "Apollo 11 Lunar Landing",
      genres: ["Moon", "History"],
      tags: ["apollo 11", "lunar module", "moon", "landing"],
      rating: 8.9,
      minutes: 3,
      description: "Archival footage and telemetry showing the Apollo 11 Lunar Module descending to the lunar surface.",
      color: "#4a453f"
    }
  },
  {
    q: "Perseverance Mars landing",
    meta: {
      title: "Perseverance Mars Landing",
      genres: ["Mars", "Spaceflight"],
      tags: ["mars 2020", "perseverance", "parachute", "jezero"],
      rating: 8.8,
      minutes: 3.5,
      description: "Cameras document the entry, descent, and touchdown of the Perseverance rover on the Martian surface.",
      color: "#6b4334"
    }
  },
  {
    q: "International Space Station tour",
    meta: {
      title: "Station Orbital Tour",
      genres: ["Spaceflight", "Documentary"],
      tags: ["iss", "space station", "cupola", "microgravity"],
      rating: 8.2,
      minutes: 5,
      description: "A wide-angle tour through laboratory modules and the cupola observatory aboard the International Space Station.",
      color: "#384752"
    }
  },
  {
    q: "Earth from space timelapse",
    meta: {
      title: "Earth Orbital Night Timelapse",
      genres: ["Earth", "Visualization"],
      tags: ["earth", "timelapse", "aurora", "orbit"],
      rating: 8.6,
      minutes: 2,
      description: "Time-lapse sequence of high-resolution orbital frames showing night lights and atmospheric auroras across Earth.",
      color: "#364d59"
    }
  },
  {
    q: "James Webb Space Telescope",
    meta: {
      title: "Webb Telescope Deep Field",
      genres: ["Astronomy", "Visualization"],
      tags: ["jwst", "deep field", "cosmic cliffs", "galaxies"],
      rating: 8.7,
      minutes: 2.5,
      description: "Infrared imagery reveals distant galaxy clusters and stellar nurseries observed by the James Webb Space Telescope.",
      color: "#4e3b4a"
    }
  },
  {
    q: "X-59 quiet supersonic",
    meta: {
      title: "Quiet Supersonic Technology Flight",
      genres: ["Aeronautics", "Concept"],
      tags: ["x-59", "supersonic", "quesst", "flight test"],
      rating: 7.8,
      minutes: 2,
      description: "Flight test imagery of the experimental X-59 aircraft designed to reduce sonic booms over populated areas.",
      color: "#424b52"
    }
  },
  {
    q: "space shuttle launch",
    meta: {
      title: "Space Shuttle Ascent",
      genres: ["Spaceflight", "History"],
      tags: ["space shuttle", "solid rocket booster", "launch", "ascent"],
      rating: 8.4,
      minutes: 3,
      description: "Tracking cameras capture ignition, liftoff, and solid rocket booster separation during a space shuttle launch.",
      color: "#544339"
    }
  },
  {
    q: "Artemis I launch",
    meta: {
      title: "Artemis I Maiden Launch",
      genres: ["Artemis", "Spaceflight"],
      tags: ["artemis 1", "sls", "orion", "moon"],
      rating: 8.7,
      minutes: 2.5,
      description: "The Space Launch System rocket lifts off from Kennedy Space Center on its uncrewed mission around the Moon.",
      color: "#394852"
    }
  },
  {
    q: "Hubble telescope",
    meta: {
      title: "Hubble Cosmic Views",
      genres: ["Astronomy", "History"],
      tags: ["hubble", "nebula", "pillars of creation", "space"],
      rating: 8.1,
      minutes: 3,
      description: "A showcase of star-forming nebulae and interacting galaxies imaged over decades of Hubble observations.",
      color: "#44394f"
    }
  }
];

async function verifyUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Range': 'bytes=0-1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Couchlight/1.0'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);

    const status = res.status;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    try { await res.body?.cancel(); } catch (_) {}

    const isValid = (status === 200 || status === 206) && contentType.startsWith('video/');
    return { ok: isValid, status, contentType };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

async function fetchAssetHref(nasaId) {
  try {
    const res = await fetch(`https://images-api.nasa.gov/asset/${encodeURIComponent(nasaId)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.collection?.items || [];
    const hrefs = items.map(it => it.href).filter(Boolean);

    // Prefer ~medium.mp4, else ~large.mp4, else ~small.mp4, else ~orig.mp4
    let chosen = hrefs.find(h => h.endsWith('~medium.mp4'));
    if (!chosen) chosen = hrefs.find(h => h.endsWith('~large.mp4'));
    if (!chosen) chosen = hrefs.find(h => h.endsWith('~small.mp4'));
    if (!chosen) chosen = hrefs.find(h => h.endsWith('~orig.mp4'));
    if (!chosen) chosen = hrefs.find(h => h.endsWith('.mp4'));

    if (chosen) {
      // URL-encode spaces in href
      return chosen.replace(/\s/g, '%20');
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function main() {
  console.log('--- Verifying NASA Catalog Entries ---');
  const catalog = [];
  const failedList = [];

  // 1. Verify seed entries
  for (const seed of SEED_ENTRIES) {
    process.stdout.write(`Checking seed: "${seed.title}"... `);
    const check = await verifyUrl(seed.src);
    if (check.ok) {
      console.log(`[PASS] (${check.status}, ${check.contentType})`);
      catalog.push(seed);
    } else {
      console.log(`[FAIL] (${check.status || check.error})`);
      failedList.push({ title: seed.title, src: seed.src, reason: check.error || `HTTP ${check.status} (${check.contentType})` });
    }
  }

  // 2. Fetch from NASA images API
  console.log(`\n--- Fetching clips from NASA Public API (Current catalog: ${catalog.length}) ---`);
  for (const query of API_QUERIES) {
    if (catalog.length >= 14) break;

    process.stdout.write(`Querying API for "${query.q}"... `);
    try {
      const searchUrl = `https://images-api.nasa.gov/search?media_type=video&page_size=20&q=${encodeURIComponent(query.q)}`;
      const res = await fetch(searchUrl);
      if (!res.ok) {
        console.log(`[API HTTP ${res.status}]`);
        continue;
      }
      const data = await res.json();
      const items = data?.collection?.items || [];

      let picked = false;
      for (const item of items) {
        if (picked || catalog.length >= 14) break;
        const itemData = item.data?.[0];
        if (!itemData || !itemData.nasa_id) continue;

        // Skip items that look like long educational broadcasts (>15 min or 1hr)
        const descLower = (itemData.description || '').toLowerCase();
        const titleLower = (itemData.title || '').toLowerCase();
        if (descLower.includes('full broadcast') || titleLower.includes('press briefing') || titleLower.includes('broadcast coverage')) {
          continue;
        }

        const href = await fetchAssetHref(itemData.nasa_id);
        if (!href) continue;

        const check = await verifyUrl(href);
        if (check.ok) {
          const year = itemData.date_created ? new Date(itemData.date_created).getFullYear() : 2022;
          const entry = {
            id: 'nasa-' + slugify(query.meta.title),
            title: query.meta.title,
            year: isNaN(year) ? 2022 : year,
            genres: query.meta.genres,
            tags: query.meta.tags,
            rating: query.meta.rating,
            minutes: query.meta.minutes,
            description: query.meta.description,
            src: href,
            credit: "NASA",
            color: query.meta.color
          };
          catalog.push(entry);
          picked = true;
          console.log(`[ADDED] "${entry.title}" -> ${href}`);
        }
      }

      if (!picked) {
        console.log(`[NO QUALIFYING VIDEO]`);
      }
    } catch (err) {
      console.log(`[ERROR: ${err.message}]`);
    }
  }

  console.log(`\nVerified catalog size: ${catalog.length}`);
  if (failedList.length > 0) {
    console.log(`Failed verifications (${failedList.length}):`);
    for (const f of failedList) {
      console.log(` - ${f.title}: ${f.reason} [${f.src}]`);
    }
  }

  // Sort by rating descending
  catalog.sort((a, b) => b.rating - a.rating);

  fs.writeFileSync(outputFile, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`\nSuccessfully wrote ${catalog.length} entries to ${outputFile}`);

  // Write verification summary for reference
  const summaryFile = path.join(rootDir, 'data', 'fetch-summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({ count: catalog.length, failed: failedList }, null, 2), 'utf8');
}

main().catch(err => {
  console.error('Fatal fetch error:', err);
  process.exit(1);
});
