// One-off cutover seeding: moves the history into the new database, from
// files exported locally to db/seed/ (git-ignored: never commit it).
//
//  1. Listings, archive, run status and watch hashes: the last committed
//     data files from origin/main (competitions.json, hackathons.json, the
//     two status files, the two archives, watch.json), pushed through the
//     API with the service token by the same sync_section path the
//     fetchers use, so first_seen, closed_on and the archive carry over.
//  2. The admin's own rows, if their files are there: decisions.json,
//     intl_dates.json and manual.json, exported from the old database as
//     JSON arrays of rows (HANDOFF.md has the commands). The jobs' role may
//     not write those tables, so they go in over a direct owner connection
//     (DATABASE_URL), each row only if its id is not there yet.
//
// Run ONCE, after db/schema.sql is applied and the API is up, BEFORE the
// first live fetch:
//
//   RADAR_API_URL=... RADAR_SERVICE_TOKEN=... DATABASE_URL=<owner URL> node db/seed.mjs --dry-run
//   RADAR_API_URL=... RADAR_SERVICE_TOKEN=... DATABASE_URL=<owner URL> node db/seed.mjs
//
// It refuses a section that already has listings (the fetchers have run, and
// seeding would roll their data back) unless --force is given.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDb } from '../fetch/db.js';
import { publishable, isObject } from '../fetch/pipeline.js';

const SEED_DIR = fileURLToPath(new URL('./seed/', import.meta.url));

const SECTIONS = [
  { section: 'case', items: 'competitions.json', status: 'status.json', archive: 'archive.json' },
  { section: 'hack', items: 'hackathons.json', status: 'hack-status.json', archive: 'hack-archive.json' },
];

// The admin-written tables and the columns carried over.
export const ADMIN_TABLES = {
  decisions: ['id', 'status', 'registered', 'note', 'updated_at'],
  intl_dates: ['id', 'regn_close', 'comp_end', 'confirmed_on'],
  manual: ['id', 'url', 'added'],
};

function load(dir, f, check, what) {
  let v;
  try { v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error(`${f}: ${e.message}`); }
  if (!check(v)) throw new Error(`${f} is not ${what}`);
  return v;
}

// The owner connection's import: rows shaped by the table itself
// (json_populate_recordset), existing ids left alone. Rows are grouped by
// the columns they carry, so a column a row leaves out gets its default
// rather than null. query(sql, params) -> { rows }. Returns the rows added.
export function ownerImporter(query) {
  return {
    async importRows(table, rows) {
      const known = ADMIN_TABLES[table];
      if (!known) throw new Error(`not an admin table: ${table}`);
      const groups = new Map();
      for (const r of rows) {
        const cols = known.filter(c => c in r);
        const key = cols.join(',');
        if (!groups.has(key)) groups.set(key, { cols, rows: [] });
        groups.get(key).rows.push(Object.fromEntries(cols.map(c => [c, r[c]])));
      }
      let added = 0;
      for (const { cols, rows: group } of groups.values()) {
        const list = cols.map(c => `"${c}"`).join(', ');
        const { rows: out } = await query(
          `with ins as (insert into public."${table}" (${list}) select ${list} from json_populate_recordset(null::public."${table}", $1::json)
           on conflict (id) do nothing returning 1) select count(*)::int as n from ins`,
          [JSON.stringify(group)]);
        added += out[0].n;
      }
      return added;
    },
  };
}

export async function seed({ db = createDb(), owner = null, dir = SEED_DIR, force = false, dryRun = false, log = console.log } = {}) {
  // Read and check every file before writing anything.
  const plan = SECTIONS.map(s => ({
    section: s.section,
    rows: load(dir, s.items, Array.isArray, 'an array').map(publishable),
    archive: load(dir, s.archive, Array.isArray, 'an array')
      .map(a => ({ ...a, archive_key: a.archive_key ?? String(a.id) })),
    status: load(dir, s.status, isObject, 'an object'),
  }));
  const watch = Object.entries(load(dir, 'watch.json', isObject, 'an object')).map(([id, data]) => ({ id, data }));
  const admin = Object.keys(ADMIN_TABLES)
    .filter(t => fs.existsSync(path.join(dir, `${t}.json`)))
    .map(t => ({ table: t, rows: load(dir, `${t}.json`, v => Array.isArray(v) && v.every(isObject), 'an array of rows') }));
  if (admin.length && !owner && !dryRun) throw new Error(`${admin.map(a => a.table).join(', ')}: set DATABASE_URL (the owner connection) to import them`);

  if (!db.configured && db.configured !== undefined) throw new Error('RADAR_API_URL and RADAR_SERVICE_TOKEN are required');
  for (const p of plan) {
    if (!p.rows.length) throw new Error(`${p.section}: seed has no rows`);
    const have = await db.readListings(p.section);
    if (have.length && !force) throw new Error(`${p.section} already has ${have.length} listings; pass --force to overwrite`);
  }
  for (const p of plan) {
    log(`${p.section}: ${p.rows.length} rows, ${p.archive.length} archive entries${dryRun ? ' (dry run)' : ''}`);
    if (!dryRun) log(`  ${JSON.stringify(await db.syncSection(p.section, p.rows, p.archive, p.status))}`);
  }
  log(`watch: ${watch.length} rows${dryRun ? ' (dry run)' : ''}`);
  if (!dryRun) await db.upsertWatch(watch);
  for (const a of admin) {
    log(`${a.table}: ${a.rows.length} rows${dryRun ? ' (dry run)' : ''}`);
    if (!dryRun) log(`  ${await owner.importRows(a.table, a.rows)} new`);
  }
  if (!admin.length) log('decisions, intl_dates, manual: no export files, skipped');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  let client = null;
  try {
    if (process.env.DATABASE_URL) {
      const { default: pg } = await import('pg');
      client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
    }
    await seed({
      owner: client ? ownerImporter((sql, params) => client.query(sql, params)) : null,
      force: args.has('--force'), dryRun: args.has('--dry-run'),
    });
  } catch (e) {
    console.error(`seed failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await client?.end();
  }
}
