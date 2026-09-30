// Daily job: fetch → classify → merge → write. On any search failure the
// competitions file is left alone, so a bad day never blanks the board.
// Listing body text (details_text) and the raw eligibility blob are used only
// for classification here and never written: the body text carries
// organisers' personal phone numbers and emails, and the file is public.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAll } from './unstop.js';
import { tier, verdict } from './classify.js';
import { oppdeskRecords } from './intl.js';
import { fetchOppDesk } from './oppdesk.js';
import { fetchInsideIim, parseInsideIim, insideiimRecords } from './insideiim.js';
import { defaultConfig, readTables } from './supabase.js';
import { dataStore, fromRemote, readDecisions, curatedFromLists, commit } from './pipeline.js';
import { dayDiff, todayIST } from '../dates.js';
import { unstopId } from '../urls.js';

const DEFAULT_DIR = fileURLToPath(new URL('../data/', import.meta.url));

export async function main({ dataDir = DEFAULT_DIR, now = new Date(), deps = {} } = {}) {
  const store = dataStore(dataDir);
  const { read, write } = store;

  const { supabase = defaultConfig(), ...fetchDeps } = deps;
  const team = read('team.json');
  const lists = { national: read('national.json', []), bschools: read('bschools.json', []), corporates: read('corporates.json', []) };
  const existing = read('competitions.json', []);
  const status = read('status.json', {});
  const stamp = now.toISOString();

  // Decisions, hand-added links and confirmed international dates live in
  // Supabase. If it is not configured or a read fails, decisions and links
  // fall back to the old data/ files when present (else empty) and the
  // curated records keep yesterday's dates; each case is a warning.
  const remote = await readTables(supabase);
  const remoteWarnings = [];
  const decisions = readDecisions(remote, store, remoteWarnings);
  const manualRaw = fromRemote(remote, 'manual', store, 'manual.json', [], remoteWarnings);
  const manualIds = (Array.isArray(manualRaw) ? manualRaw : []).map(m => unstopId(m?.url ?? '')).filter(Boolean);

  try {
    const { records, warnings } = await fetchAll(new Map(existing.map(r => [r.id, r])), manualIds, fetchDeps);
    warnings.unshift(...remoteWarnings);
    const today = todayIST(now);
    // Two curated lists, same row shape: international (required) and the
    // domestic fest watchlist (optional: missing means no rows).
    records.push(...curatedFromLists([
      { f: 'international.json', prefix: 'intl-', label: 'curated list' },
      { f: 'fests.json', prefix: 'fest-', label: 'fest watchlist', optional: true },
    ], { store, remote, existing, today, warnings }));
    try {
      const posts = await fetchOppDesk({ getJson: deps.getJson, pause: deps.pause, today });
      const fresh = oppdeskRecords(posts, today);
      const ids = new Set(fresh.map(r => r.id));
      // A post older than the fetch window is still open until its deadline.
      const stillOpen = existing.filter(r => r.source === 'oppdesk' && !ids.has(r.id)
        && r.regn_close && dayDiff(today, r.regn_close) >= 0);
      records.push(...fresh, ...stillOpen);
    } catch (e) {
      // Optional source: keep what we had so merge does not close it.
      warnings.push(`Opportunity Desk: ${e.message}`);
      records.push(...existing.filter(r => r.source === 'oppdesk'));
    }
    try {
      const html = await fetchInsideIim({ getText: deps.getText, pause: deps.pause });
      records.push(...insideiimRecords(parseInsideIim(html), today));
    } catch (e) {
      // Optional source: keep what we had, unchanged, so merge does not close it.
      warnings.push(`InsideIIM: ${e.message}`);
      records.push(...existing.filter(r => r.source === 'insideiim'));
    }
    for (const r of records) {
      // Carried-over, curated, Opportunity Desk and InsideIIM records keep their own tier and verdict.
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
    commit(store, {
      existing, records, decisions, today, warnings,
      prune: remote.decisions.value !== undefined,
      liveFile: 'competitions.json', archiveFile: 'archive.json',
    });
    write('status.json', { last_run: stamp, last_ok: stamp, last_error: null, warnings });
    console.log(`ok: ${records.length} fetched, ${warnings.length} warnings`);
    return 0;
  } catch (e) {
    write('status.json', { last_run: stamp, last_ok: status.last_ok || null, last_error: e.message, warnings: remoteWarnings });
    console.error(`fetch failed: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
