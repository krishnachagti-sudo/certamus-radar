import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seed } from '../supabase/seed-from-json.mjs';

function seedDir(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-seed-'));
  const files = {
    'competitions.json': [{ id: 1, title: 'A', first_seen: '2026-09-01', closed_on: null, details_text: 'call 9876543210' }],
    'status.json': { last_ok: 'T1', last_error: null, warnings: [] },
    'archive.json': [{ archive_key: '7', id: 7, title: 'Old' }, { id: 8, title: 'No key' }],
    'hackathons.json': [{ id: 'df-x', title: 'H', first_seen: '2026-09-02', closed_on: '2026-09-20' }],
    'hack-status.json': { last_ok: 'T2', sources: { unstop: { ok: true, count: 1 } } },
    'hack-archive.json': [],
    'watch.json': { 'intl-a': { hash: 'h', changed_on: null, last_checked: '2026-09-30' } },
    ...over,
  };
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  return dir;
}
function fakeDb(existing = {}) {
  return {
    syncs: [], watch: [],
    async readListings(section) { return existing[section] || []; },
    async syncSection(section, rows, archive, status) { this.syncs.push({ section, rows, archive, status }); },
    async upsertWatch(rows) { this.watch.push(...rows); },
  };
}

test('seed pushes each section through one syncSection, keeping first_seen, closed_on and the archive', async () => {
  const db = fakeDb();
  await seed({ db, dir: seedDir(), log: () => {} });
  assert.deepEqual(db.syncs.map(s => s.section), ['case', 'hack']);
  const [c, h] = db.syncs;
  assert.deepEqual(c.rows, [{ id: 1, title: 'A', first_seen: '2026-09-01', closed_on: null }]);
  assert.deepEqual(c.archive.map(a => a.archive_key), ['7', '8']);
  assert.deepEqual(c.status, { last_ok: 'T1', last_error: null, warnings: [] });
  assert.equal(h.rows[0].closed_on, '2026-09-20');
  assert.deepEqual(h.status.sources, { unstop: { ok: true, count: 1 } });
  assert.deepEqual(db.watch, [{ id: 'intl-a', data: { hash: 'h', changed_on: null, last_checked: '2026-09-30' } }]);
});

test('seed refuses a section that already has listings unless forced', async () => {
  const db = fakeDb({ hack: [{ id: 'x' }] });
  await assert.rejects(seed({ db, dir: seedDir(), log: () => {} }), /hack already has 1 listings/);
  assert.equal(db.syncs.length, 0);
  await seed({ db, dir: seedDir(), force: true, log: () => {} });
  assert.equal(db.syncs.length, 2);
});

test('seed refuses a seed file that is not the expected shape', async () => {
  await assert.rejects(seed({ db: fakeDb(), dir: seedDir({ 'competitions.json': { a: 1 } }), log: () => {} }), /competitions\.json/);
});

test('dry run reads and checks everything but writes nothing', async () => {
  const db = fakeDb();
  await seed({ db, dir: seedDir(), dryRun: true, log: () => {} });
  assert.equal(db.syncs.length, 0);
  assert.equal(db.watch.length, 0);
});
