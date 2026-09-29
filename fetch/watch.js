// Weekly watcher: hashes each curated competition's official page so a
// changed page surfaces on the card and in the digest, without storing the
// page content itself. Runs in its own Action, before the Monday digest.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultGetText, defaultPause } from './unstop.js';
import { todayIST } from '../dates.js';

// Strips <script>/<style> blocks (content and all), then every remaining
// tag, then collapses whitespace, so cosmetic markup/script/css churn never
// changes the hash of otherwise-identical visible text.
export function visibleText(html) {
  return String(html || '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// `list` is data/international.json plus data/fests.json; `prev` is the previous data/watch.json
// (`{ [id]: { hash, changed_on, last_checked, last_error } }`). Only rows
// with `verified !== false`, a string `id` and a string `watch_url` are
// checked. A fetch error keeps the previous hash and changed_on, records
// `last_error`, and never throws; a success clears `last_error`. `now` may
// be a Date or an already-IST 'YYYY-MM-DD' string.
export async function watchAll(list, prev, { getText = defaultGetText, pause = defaultPause, now = new Date() } = {}) {
  const today = typeof now === 'string' ? now : todayIST(now);
  const before = prev && typeof prev === 'object' ? prev : {};
  const next = {};

  for (const row of Array.isArray(list) ? list : []) {
    if (!row || row.verified === false) continue;
    const id = row.id;
    const url = row.watch_url;
    if (typeof id !== 'string' || !id || typeof url !== 'string' || !url) continue;

    const prior = before[id];
    try {
      const text = visibleText(await getText(url));
      const hash = hashText(text);
      const changed = prior && prior.hash !== undefined && prior.hash !== hash;
      next[id] = {
        hash,
        changed_on: changed ? today : (prior?.changed_on ?? null),
        last_checked: today,
      };
    } catch (e) {
      next[id] = {
        ...(prior?.hash !== undefined ? { hash: prior.hash } : {}),
        changed_on: prior?.changed_on ?? null,
        last_checked: today,
        last_error: e.message,
      };
    } finally {
      await pause();
    }
  }
  return next;
}

const DEFAULT_DIR = fileURLToPath(new URL('../data/', import.meta.url));

// Tells "missing" apart from "there but broken", for a file we must not
// silently treat as empty: a bad international.json must never blank
// watch.json for every already-watched row.
function readList(dataDir, f) {
  let raw;
  try { raw = fs.readFileSync(path.join(dataDir, f), 'utf8'); } catch { return { missing: true }; }
  let value;
  try { value = JSON.parse(raw); } catch (e) { return { error: `unparseable (${e.message})` }; }
  if (!Array.isArray(value)) return { error: 'is not an array' };
  return { value };
}

export async function main({ dataDir = DEFAULT_DIR, now = new Date(), deps = {} } = {}) {
  const file = f => path.join(dataDir, f);
  const read = (f, fallback) => {
    try { return JSON.parse(fs.readFileSync(file(f), 'utf8')); } catch { return fallback; }
  };
  const listFile = readList(dataDir, 'international.json');
  if (listFile.missing || listFile.error) {
    console.error(`watch: international.json ${listFile.missing ? 'missing' : listFile.error}; watch.json not written`);
    return 1;
  }
  const prev = read('watch.json', {});
  // The fest watchlist is optional (missing = no rows). If it is broken, its
  // previous entries are kept as they were instead of dropped.
  const festFile = readList(dataDir, 'fests.json');
  const fests = festFile.value || [];
  const next = await watchAll([...listFile.value, ...fests], prev, { now, ...deps });
  if (festFile.error) {
    console.error(`watch: fests.json ${festFile.error}; previous fest- entries kept`);
    for (const [id, v] of Object.entries(prev && typeof prev === 'object' ? prev : {})) {
      if (id.startsWith('fest-') && !(id in next)) next[id] = v;
    }
  }
  fs.writeFileSync(file('watch.json'), JSON.stringify(next, null, 2) + '\n');
  const errors = Object.entries(next).filter(([, v]) => v.last_error);
  console.log(`watch: ${Object.keys(next).length} checked, ${errors.length} errors`);
  for (const [id, v] of errors) console.log(`  ${id}: ${v.last_error}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
