import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seed, ownerImporter } from '../db/seed.mjs';
import { freshDb } from './helpers/pg.js';

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

test('the admin\'s rows: imported over the owner connection when their files are there', async () => {
  const dir = seedDir({ 'decisions.json': [{ id: '7', status: 'entering', registered: true, note: 'n', updated_at: '2026-09-29T00:00:00+00:00' }], 'manual.json': [{ id: '55', url: 'https://unstop.com/c/x-55', added: '2026-09-20' }] });
  const imported = [];
  const owner = { async importRows(t, rows) { imported.push([t, rows.length]); return rows.length; } };
  await seed({ db: fakeDb(), owner, dir, log: () => {} });
  assert.deepEqual(imported, [['decisions', 1], ['manual', 1]]);
  await assert.rejects(seed({ db: fakeDb(), dir, log: () => {} }), /DATABASE_URL/, 'no owner connection, no silent skip');
  const db = fakeDb();
  await seed({ db, dir: seedDir(), log: () => {} });
  assert.equal(db.syncs.length, 2, 'no export files: the rest still seeds');
});

test('ownerImporter against the real schema: typed rows in, existing ids kept, unknown columns dropped', async () => {
  const pg = await freshDb();
  const imp = ownerImporter((sql, params) => pg.query(sql, params));
  assert.equal(await imp.importRows('decisions', [{ id: '7', status: 'entering', registered: true, note: 'n', updated_at: '2026-09-29T00:00:00+00:00', extra: 1 }, { id: '8', status: null, registered: false, note: 'x' }]), 2);
  assert.equal(await imp.importRows('decisions', [{ id: '7', status: 'skipped' }]), 0);
  assert.deepEqual((await pg.query(`select id, status, registered from public.decisions order by id`)).rows,
    [{ id: '7', status: 'entering', registered: true }, { id: '8', status: null, registered: false }]);
  assert.equal(await imp.importRows('intl_dates', [{ id: 'intl-a', regn_close: '2026-11-01', comp_end: null, confirmed_on: '2026-09-30' }]), 1);
  assert.equal(await imp.importRows('manual', [{ id: '55', url: 'https://unstop.com/c/x-55', added: '2026-09-20' }]), 1);
  await assert.rejects(imp.importRows('manual', [{ id: '56', url: 'https://evil.com/56' }]), /manual_url_unstop/);
  await assert.rejects(imp.importRows('members', []), /not an admin table/);
});
