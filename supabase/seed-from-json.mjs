// One-off cutover seeding (Phase 5): pushes the last committed data files,
// exported to supabase/seed/ from origin/main, into Supabase through the same
// sync_section path the fetchers use, so first_seen, closed_on and the
// archive history carry over. Run ONCE, after supabase/v3.sql is applied and
// BEFORE the first live fetch:
//
//   SUPABASE_SERVICE_KEY=sb_secret_... node supabase/seed-from-json.mjs --dry-run
//   SUPABASE_SERVICE_KEY=sb_secret_... node supabase/seed-from-json.mjs
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

function load(dir, f, check, what) {
  let v;
  try { v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error(`${f}: ${e.message}`); }
  if (!check(v)) throw new Error(`${f} is not ${what}`);
  return v;
}

export async function seed({ db = createDb(), dir = SEED_DIR, force = false, dryRun = false, log = console.log } = {}) {
  // Read and check every file before writing anything.
  const plan = SECTIONS.map(s => ({
    section: s.section,
    rows: load(dir, s.items, Array.isArray, 'an array').map(publishable),
    archive: load(dir, s.archive, Array.isArray, 'an array')
      .map(a => ({ ...a, archive_key: a.archive_key ?? String(a.id) })),
    status: load(dir, s.status, isObject, 'an object'),
  }));
  const watch = Object.entries(load(dir, 'watch.json', isObject, 'an object')).map(([id, data]) => ({ id, data }));

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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  try {
    await seed({ force: args.has('--force'), dryRun: args.has('--dry-run') });
  } catch (e) {
    console.error(`seed failed: ${e.message}`);
    process.exitCode = 1;
  }
}
