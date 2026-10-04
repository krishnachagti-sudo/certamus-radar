// Daily job for the Hackathons section: Unstop (hackathons) + Devfolio + MLH
// + Devpost + the curated list → kind, tier, verdict → merge → one
// sync_section write of the 'hack' section in Supabase. Same merge, archive,
// decision and privacy rules as run.js (fetch/pipeline.js).
//
// Every source is optional: a failing one is a warning and its previous
// records pass through unchanged, so merge does not close them. The run fails
// (only the status written, with last_error) when every fetched source fails
// or the live records cannot be read.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAll } from './unstop.js';
import { fetchDevfolio, devfolioRecords } from './devfolio.js';
import { fetchMlh, parseMlh, mlhRecords } from './mlh.js';
import { fetchDevpost, devpostRecords } from './devpost.js';
import { hackKind, hackTier, hackVerdict, unstopFacts, curatedHackVerdict } from './hack-classify.js';
import { ARCHIVE_FIELDS } from './merge.js';
import { createDb, readTables } from './db.js';
import { configStore, readDecisions, curatedFromLists, commit, recordFailure } from './pipeline.js';
import { todayIST } from '../dates.js';

const DEFAULT_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const FETCHED = ['unstop', 'devfolio', 'mlh', 'devpost'];
export const HACK_ARCHIVE_FIELDS = [...ARCHIVE_FIELDS.filter(k => k !== 'is_case'), 'hack_kind'];
const HACK_KINDS = new Set(['build', 'ideathon']);

// An Unstop hackathon listing, in the hackathon record shape. format_kind and
// is_case are case-comp fields; hack_kind replaces them.
function unstopHack(r) {
  const { format_kind, is_case, ...rest } = r; // eslint-disable-line no-unused-vars
  return { ...rest, source: 'unstop', location: r.mode === 'online' ? 'Online' : null, country: null, comp_start: null, facts: unstopFacts(r) };
}

function curatedHack(r) {
  const { format_kind, is_case, kind, ...rest } = r; // eslint-disable-line no-unused-vars
  const hack_kind = HACK_KINDS.has(kind) ? kind : 'other';
  const tier = r.tier === 'international' ? 'other' : r.tier;
  return {
    ...rest,
    tier,
    hack_kind,
    verdict: curatedHackVerdict({ indian_ug: r.intl?.indian_ug, indian_ug_note: r.intl?.indian_ug_note }),
    main: tier !== 'other' && hack_kind !== 'other',
  };
}

export async function main({ dataDir = DEFAULT_DIR, now = new Date(), deps = {} } = {}) {
  const store = configStore(dataDir);
  const { read } = store;
  const { db = createDb(), getJson, getText, postJson, pause, backoff } = deps;
  const stamp = now.toISOString();
  const fail = async (message, warnings = []) => {
    await recordFailure(db, 'hack', { stamp, message, warnings, sources: {} });
    console.error(`hackathons fetch failed: ${message}`);
    return 1;
  };

  // The live records. Unreadable is never "empty": abort, only the status is written.
  let existing;
  try { existing = await db.readListings('hack'); } catch (e) { return fail(`live records unreadable (${e.message}); nothing written`); }
  const team = read('hack-team.json', { members: [], can_grow: true });
  const lists = { national: read('national.json', []), bschools: read('bschools.json', []), corporates: read('hack-corporates.json', []) };

  const remote = await readTables(db, ['decisions', 'intlDates']);
  const remoteWarnings = [];
  const decisions = readDecisions(remote, remoteWarnings);

  try {
    const today = todayIST(now);
    const warnings = [...remoteWarnings];
    const sources = {};
    const records = [];
    const run = async (name, label, fetchRecords) => {
      try {
        const got = await fetchRecords();
        records.push(...got);
        sources[name] = { ok: true, count: got.length };
      } catch (e) {
        const prev = existing.filter(r => r.source === name);
        warnings.push(`${label}: ${e.message}; ${prev.length} previous records kept`);
        records.push(...prev);
        sources[name] = { ok: false, count: prev.length, error: e.message };
      }
    };

    await run('unstop', 'Unstop', async () => {
      const opts = { getJson, pause, opportunity: 'hackathons', ...(backoff !== undefined ? { backoff } : {}) };
      const { records: got, warnings: w } = await fetchAll(new Map(), [], opts);
      warnings.push(...w.map(x => `Unstop: ${x}`));
      return got.map(unstopHack);
    });
    await run('devfolio', 'Devfolio', async () => devfolioRecords(await fetchDevfolio({ postJson, pause })));
    await run('mlh', 'MLH', async () => mlhRecords(parseMlh(await fetchMlh({ getText, pause, now }))));
    await run('devpost', 'Devpost', async () => devpostRecords(await fetchDevpost({ getJson, pause })));
    if (FETCHED.every(s => !sources[s].ok)) {
      return fail('every hackathon source failed', warnings);
    }

    const curatedWarnings = warnings.length;
    const curated = curatedFromLists([{ f: 'hack-curated.json', prefix: 'hk-', label: 'hackathon curated list', optional: true }],
      { store, remote, existing, today, warnings });
    records.push(...curated.map(r => (r.hack_kind ? r : curatedHack(r))));
    sources.curated = { ok: warnings.length === curatedWarnings, count: curated.length };

    for (const r of records) {
      // Only fresh records carry facts; passed-through ones keep their own classification.
      if (!r.facts) continue;
      try {
        r.hack_kind = hackKind({ title: r.title, body: r.details_text, source: r.source });
        r.tier = hackTier(r, lists);
        r.verdict = hackVerdict(r, team);
      } catch (e) {
        r.hack_kind = r.hack_kind || 'other';
        r.tier = 'other';
        r.verdict = { level: 'check', reasons: [`could not classify: ${e.message}`] };
        warnings.push(`classify ${r.id}: ${e.message}`);
      }
      r.main = r.tier !== 'other' && r.hack_kind !== 'other';
    }

    await commit(db, 'hack', {
      existing, records, decisions, today,
      prune: remote.decisions.value !== undefined,
      archiveFields: HACK_ARCHIVE_FIELDS,
      status: { last_run: stamp, last_ok: stamp, last_error: null, warnings, sources },
    });
    console.log(`hackathons ok: ${records.length} records, ${warnings.length} warnings`);
    return 0;
  } catch (e) {
    return fail(e.message, remoteWarnings);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
