// Daily job for case comps: read the live records from Supabase → fetch →
// classify → merge → one sync_section write. If the live records cannot be
// read, or any search fails, nothing but the status is written, so a bad day
// never blanks the board. Listing body text (details_text) and the raw
// eligibility blob are used only for classification and never stored: the
// body text carries organisers' personal phone numbers and emails.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAll } from './unstop.js';
import { tier, verdict } from './classify.js';
import { oppdeskRecords } from './intl.js';
import { fetchOppDesk } from './oppdesk.js';
import { fetchInsideIim, parseInsideIim, insideiimRecords } from './insideiim.js';
import { createDb, readTables } from './db.js';
import { configStore, fromRemote, readDecisions, curatedFromLists, commit, recordFailure } from './pipeline.js';
import { dayDiff, todayIST } from '../dates.js';
import { unstopId } from '../urls.js';

const DEFAULT_DIR = fileURLToPath(new URL('../data/', import.meta.url));

export async function main({ dataDir = DEFAULT_DIR, now = new Date(), deps = {} } = {}) {
  const store = configStore(dataDir);
  const { read } = store;
  const { db = createDb(), ...fetchDeps } = deps;
  const team = read('team.json');
  const lists = { national: read('national.json', []), bschools: read('bschools.json', []), corporates: read('corporates.json', []) };
  const stamp = now.toISOString();
  const fail = async (message, warnings) => {
    await recordFailure(db, 'case', { stamp, message, warnings });
    console.error(`fetch failed: ${message}`);
    return 1;
  };

  // The live records. Unreadable is never "empty": abort, only the status is written.
  let existing;
  try { existing = await db.readListings('case'); } catch (e) { return fail(`live records unreadable (${e.message}); nothing written`, []); }

  // Decisions, hand-added links and confirmed international dates (service
  // key). A failed read is a warning: decisions are then empty and nothing
  // is pruned, links are skipped, curated records keep yesterday's dates.
  const remote = await readTables(db);
  const remoteWarnings = [];
  const decisions = readDecisions(remote, remoteWarnings);
  const manualRaw = fromRemote(remote, 'manual', [], remoteWarnings);
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
    await commit(db, 'case', {
      existing, records, decisions, today,
      prune: remote.decisions.value !== undefined,
      status: { last_run: stamp, last_ok: stamp, last_error: null, warnings },
    });
    console.log(`ok: ${records.length} fetched, ${warnings.length} warnings`);
    return 0;
  } catch (e) {
    return fail(e.message, remoteWarnings);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
