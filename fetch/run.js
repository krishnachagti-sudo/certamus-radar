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
import { merge, appendArchive } from './merge.js';
import { curatedRecords, oppdeskRecords } from './intl.js';
import { fetchOppDesk } from './oppdesk.js';
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
    const today = todayIST(now);
    records.push(...curatedRecords(read('international.json', []), read('intl-dates.json', {}), today));
    try {
      const posts = await fetchOppDesk({ getJson: deps.getJson, pause: deps.pause, today });
      records.push(...oppdeskRecords(posts, today));
    } catch (e) {
      // Optional source: keep what we had so merge does not close it.
      warnings.push(`Opportunity Desk: ${e.message}`);
      records.push(...existing.filter(r => r.source === 'oppdesk'));
    }
    for (const r of records) {
      // Carried-over, curated and Opportunity Desk records keep their own tier and verdict.
      if (r.carried_over || r.source) continue;
      try {
        r.tier = tier(r, lists);
        r.verdict = verdict(r, team);
      } catch (e) {
        r.tier = 'other';
        r.verdict = { level: 'check', reasons: [`could not classify: ${e.message}`] };
        warnings.push(`classify ${r.id}: ${e.message}`);
      }
    }
    const { next, pruned } = merge(existing.map(publishable), records.map(publishable), decisions, today);
    const archive = read('archive.json', []);
    write('competitions.json', next);
    if (pruned.length) write('archive.json', appendArchive(Array.isArray(archive) ? archive : [], pruned));
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
