// Daily job: fetch → classify → merge → write. On any search failure the
// competitions file is left alone, so a bad day never blanks the board.
// Listing body text (details_text) and the raw eligibility blob are used only
// for classification here and never written: the body text carries
// organisers' personal phone numbers and emails, and the file is public.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAll } from './unstop.js';
import { tier, verdict } from './classify.js';
import { merge } from './merge.js';
import { todayIST } from '../dates.js';
import { unstopId } from '../urls.js';

const PRIVATE_FIELDS = ['details_text', 'eligibility', 'carried_over'];
const publishable = r => {
  const out = { ...r };
  for (const k of PRIVATE_FIELDS) delete out[k];
  return out;
};

const DEFAULT_DIR = fileURLToPath(new URL('../data/', import.meta.url));

export async function main({ dataDir = DEFAULT_DIR, now = new Date(), deps = {} } = {}) {
  const file = f => path.join(dataDir, f);
  const read = (f, fallback) => {
    try { return JSON.parse(fs.readFileSync(file(f), 'utf8')); } catch { return fallback; }
  };
  const write = (f, v) => fs.writeFileSync(file(f), JSON.stringify(v, null, 2) + '\n');

  const team = read('team.json');
  const lists = { bschools: read('bschools.json', []), corporates: read('corporates.json', []) };
  const existing = read('competitions.json', []);
  const decisions = read('decisions.json', {});
  const manualRaw = read('manual.json', []);
  const manualIds = (Array.isArray(manualRaw) ? manualRaw : []).map(m => unstopId(m?.url ?? '')).filter(Boolean);
  const status = read('status.json', {});
  const stamp = now.toISOString();

  try {
    const { records, warnings } = await fetchAll(new Map(existing.map(r => [r.id, r])), manualIds, {
      keywords: read('keywords.json', []),
      ...deps,
    });
    for (const r of records) {
      if (r.carried_over) continue; // stored tier and verdict kept as-is
      try {
        r.tier = tier(r, lists);
        r.verdict = verdict(r, team);
      } catch (e) {
        r.tier = 'other';
        r.verdict = { level: 'check', reasons: [`could not classify: ${e.message}`] };
        warnings.push(`classify ${r.id}: ${e.message}`);
      }
    }
    write('competitions.json', merge(existing.map(publishable), records.map(publishable), decisions, todayIST(now)));
    write('status.json', { last_run: stamp, last_ok: stamp, last_error: null, warnings });
    console.log(`ok: ${records.length} fetched, ${warnings.length} warnings`);
    return 0;
  } catch (e) {
    write('status.json', { last_run: stamp, last_ok: status.last_ok || null, last_error: e.message, warnings: [] });
    console.error(`fetch failed: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
