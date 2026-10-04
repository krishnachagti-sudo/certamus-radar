import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchAll, main } from '../fetch/watch.js';

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

const row = (id, watch_url = `https://example.com/${id}`, verified = true) => ({ id, watch_url, verified });

test('first sighting records the hash with changed_on null', async () => {
  const list = [row('intl-a')];
  const getText = async () => '<html><body>Hello world</body></html>';
  const next = await watchAll(list, {}, { getText, pause: async () => {}, now: '2026-09-29' });
  assert.equal(next['intl-a'].changed_on, null);
  assert.equal(next['intl-a'].last_checked, '2026-09-29');
  assert.equal(next['intl-a'].last_error, undefined);
  assert.equal(next['intl-a'].hash, sha256('Hello world'));
});

test('unchanged text keeps the same hash and changed_on', async () => {
  const list = [row('intl-a')];
  const getText = async () => '<html><body>Hello world</body></html>';
  const first = await watchAll(list, {}, { getText, pause: async () => {}, now: '2026-09-29' });
  const second = await watchAll(list, first, { getText, pause: async () => {}, now: '2026-10-06' });
  assert.equal(second['intl-a'].hash, first['intl-a'].hash);
  assert.equal(second['intl-a'].changed_on, null);
  assert.equal(second['intl-a'].last_checked, '2026-10-06');
});

test('changed text sets changed_on to today', async () => {
  const list = [row('intl-a')];
  const first = await watchAll(list, {}, { getText: async () => 'version one', pause: async () => {}, now: '2026-09-29' });
  const second = await watchAll(list, first, { getText: async () => 'version two', pause: async () => {}, now: '2026-10-06' });
  assert.notEqual(second['intl-a'].hash, first['intl-a'].hash);
  assert.equal(second['intl-a'].changed_on, '2026-10-06');
});

test('a changed_on already set is preserved across a later unchanged check', async () => {
  const list = [row('intl-a')];
  const first = await watchAll(list, {}, { getText: async () => 'version one', pause: async () => {}, now: '2026-09-29' });
  const second = await watchAll(list, first, { getText: async () => 'version two', pause: async () => {}, now: '2026-10-06' });
  const third = await watchAll(list, second, { getText: async () => 'version two', pause: async () => {}, now: '2026-10-13' });
  assert.equal(third['intl-a'].changed_on, '2026-10-06');
  assert.equal(third['intl-a'].last_checked, '2026-10-13');
});

test('a fetch error keeps the previous hash and changed_on, sets last_error, never throws', async () => {
  const list = [row('intl-a')];
  const first = await watchAll(list, {}, { getText: async () => 'version one', pause: async () => {}, now: '2026-09-29' });
  const second = await watchAll(list, first, { getText: async () => { throw new Error('HTTP 503 for x'); }, pause: async () => {}, now: '2026-10-06' });
  assert.equal(second['intl-a'].hash, first['intl-a'].hash);
  assert.equal(second['intl-a'].changed_on, null);
  assert.equal(second['intl-a'].last_checked, '2026-10-06');
  assert.equal(second['intl-a'].last_error, 'HTTP 503 for x');
});

test('a successful check after an error clears last_error', async () => {
  const list = [row('intl-a')];
  const first = await watchAll(list, {}, { getText: async () => { throw new Error('HTTP 503 for x'); }, pause: async () => {}, now: '2026-09-29' });
  assert.equal(first['intl-a'].last_error, 'HTTP 503 for x');
  assert.equal(first['intl-a'].hash, undefined);
  const second = await watchAll(list, first, { getText: async () => 'body text', pause: async () => {}, now: '2026-10-06' });
  assert.equal(second['intl-a'].last_error, undefined);
  assert.equal(second['intl-a'].hash, sha256('body text'));
});

test('script and style blocks are stripped, so cosmetic script/css noise does not change the hash', async () => {
  const list = [row('intl-a')];
  const a = '<html><head><style>.x{color:red}</style></head><body>Hello <script>var x=1;</script>world</body></html>';
  const b = '<html><head><style>.x{color:blue}</style></head><body>Hello <script>var x=2;</script>world</body></html>';
  const first = await watchAll(list, {}, { getText: async () => a, pause: async () => {}, now: '2026-09-29' });
  const second = await watchAll(list, first, { getText: async () => b, pause: async () => {}, now: '2026-10-06' });
  assert.equal(second['intl-a'].hash, first['intl-a'].hash);
  assert.equal(second['intl-a'].changed_on, null);
});

test('tags are stripped and whitespace collapsed, so the same visible text produces the same hash regardless of markup', async () => {
  const list = [row('intl-a')];
  const a = '<div><p>Hello   world</p></div>';
  const b = '<span>Hello\n\nworld</span>';
  const out = await watchAll(list, {}, { getText: async () => a, pause: async () => {}, now: '2026-09-29' });
  assert.equal(out['intl-a'].hash, sha256('Hello world'));
  const other = await watchAll([row('intl-b')], {}, { getText: async () => b, pause: async () => {}, now: '2026-09-29' });
  assert.equal(other['intl-b'].hash, sha256('Hello world'));
});

test('unverified rows are skipped entirely', async () => {
  const list = [row('intl-a', 'https://example.com/a', false), row('intl-b')];
  let calls = 0;
  const getText = async () => { calls++; return 'text'; };
  const next = await watchAll(list, {}, { getText, pause: async () => {}, now: '2026-09-29' });
  assert.equal(calls, 1);
  assert.equal(next['intl-a'], undefined);
  assert.ok(next['intl-b']);
});

test('rows missing an id or watch_url are skipped', async () => {
  const list = [{ id: 'intl-a', verified: true }, { watch_url: 'https://example.com/x', verified: true }];
  const next = await watchAll(list, {}, { getText: async () => 'text', pause: async () => {}, now: '2026-09-29' });
  assert.deepEqual(next, {});
});

test('ids removed from the list are dropped from the next map', async () => {
  const first = await watchAll([row('intl-a'), row('intl-b')], {}, { getText: async () => 'text', pause: async () => {}, now: '2026-09-29' });
  const second = await watchAll([row('intl-a')], first, { getText: async () => 'text', pause: async () => {}, now: '2026-10-06' });
  assert.ok(second['intl-a']);
  assert.equal(second['intl-b'], undefined);
});

// ---- main() ---------------------------------------------------------------

function tmpDataDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-watch-'));
  for (const [f, v] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return dir;
}
// Stand-in for fetch/db.js's watch functions.
function fakeDb(prev = {}, { readFails, writeFails } = {}) {
  const db = {
    rows: structuredClone(prev), upserts: [],
    async readWatch() { if (readFails) throw readFails; return structuredClone(db.rows); },
    async upsertWatch(rows) {
      if (writeFails) throw writeFails;
      db.upserts.push(rows);
      for (const { id, data } of rows) db.rows[id] = data;
    },
  };
  return db;
}
const run = (dir, db, getText = async () => 'text') => main({ dataDir: dir, now: '2026-09-29', deps: { getText, pause: async () => {}, db } });
const written = db => Object.fromEntries((db.upserts.at(-1) || []).map(({ id, data }) => [id, data]));

test('main upserts watch rows when international.json is a valid array', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')] });
  const db = fakeDb();
  assert.equal(await run(dir, db), 0);
  assert.equal(db.upserts.length, 1);
  assert.equal(written(db)['intl-a'].hash, sha256('text'));
  assert.equal(fs.existsSync(path.join(dir, 'watch.json')), false);
});

test('main carries the previous hash from the watch table, so a change is dated', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')] });
  const db = fakeDb({ 'intl-a': { hash: 'old', changed_on: null, last_checked: '2026-09-22' } });
  assert.equal(await run(dir, db), 0);
  assert.equal(written(db)['intl-a'].changed_on, '2026-09-29');
});

test('main: an unreadable watch table means nothing is fetched or written', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')] });
  const db = fakeDb({}, { readFails: new Error('Supabase watch: HTTP 503') });
  let fetched = false;
  assert.equal(await run(dir, db, async () => { fetched = true; return 'text'; }), 1);
  assert.equal(fetched, false);
  assert.equal(db.upserts.length, 0);
});

test('main: a failed upsert fails the run', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')] });
  assert.equal(await run(dir, fakeDb({}, { writeFails: new Error('HTTP 500') })), 1);
});

for (const [label, files] of [
  ['missing', {}],
  ['unparseable', { 'international.json': '{not json' }],
  ['not an array', { 'international.json': { not: 'an array' } }],
]) {
  test(`main errors and writes nothing when international.json is ${label}`, async () => {
    const dir = tmpDataDir(files);
    const db = fakeDb({ old: { hash: 'h' } });
    assert.equal(await run(dir, db), 1);
    assert.equal(db.upserts.length, 0);
  });
}

// ---- fest watchlist (data/fests.json) --------------------------------------

test('main watches fests.json rows alongside international.json', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')], 'fests.json': [row('fest-a'), row('fest-b', 'https://example.com/b', false)] });
  const seen = [];
  const db = fakeDb();
  assert.equal(await run(dir, db, async u => { seen.push(u); return 'text'; }), 0);
  assert.deepEqual(Object.keys(written(db)).sort(), ['fest-a', 'intl-a']);
  assert.deepEqual(seen, ['https://example.com/intl-a', 'https://example.com/fest-a']);
});

test('main: a missing fests.json just means no fest rows', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')] });
  const db = fakeDb();
  assert.equal(await run(dir, db), 0);
  assert.deepEqual(Object.keys(written(db)), ['intl-a']);
});

test('main: a broken fests.json keeps the previous fest- entries and still watches international', async () => {
  for (const bad of ['{not json', '{"a":1}']) {
    const dir = tmpDataDir({ 'international.json': [row('intl-a')], 'fests.json': bad });
    const db = fakeDb({ 'fest-a': { hash: 'h1', changed_on: '2026-09-01', last_checked: '2026-09-22' }, 'intl-a': { hash: 'old', changed_on: null, last_checked: '2026-09-22' } });
    assert.equal(await run(dir, db), 0);
    assert.deepEqual(written(db)['fest-a'], { hash: 'h1', changed_on: '2026-09-01', last_checked: '2026-09-22' });
    assert.equal(written(db)['intl-a'].hash, sha256('text'));
  }
});

// ---- hackathon curated list (data/hack-curated.json) --------------------------

test('main watches hack-curated.json rows too, skipping unverified rows and rows with no watch_url', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')], 'fests.json': [row('fest-a')],
    'hack-curated.json': [row('hk-a'), row('hk-b', 'https://example.com/hk-b', false), { id: 'hk-c', watch_url: null, verified: true }] });
  const seen = [];
  const db = fakeDb();
  assert.equal(await run(dir, db, async u => { seen.push(u); return 'text'; }), 0);
  assert.deepEqual(Object.keys(written(db)).sort(), ['fest-a', 'hk-a', 'intl-a']);
  assert.deepEqual(seen, ['https://example.com/intl-a', 'https://example.com/fest-a', 'https://example.com/hk-a']);
});

test('main: a broken hack-curated.json keeps the previous hk- entries; fests and international still watched', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')], 'fests.json': [row('fest-a')], 'hack-curated.json': '{bad' });
  const db = fakeDb({ 'hk-a': { hash: 'h1', changed_on: null, last_checked: '2026-09-22' } });
  assert.equal(await run(dir, db), 0);
  assert.deepEqual(written(db)['hk-a'], { hash: 'h1', changed_on: null, last_checked: '2026-09-22' });
  assert.ok(written(db)['fest-a'] && written(db)['intl-a']);
});
