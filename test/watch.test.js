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

test('main writes watch.json when international.json is a valid array', async () => {
  const dir = tmpDataDir({ 'international.json': [row('intl-a')] });
  const code = await main({ dataDir: dir, now: '2026-09-29', deps: { getText: async () => 'text', pause: async () => {} } });
  assert.equal(code, 0);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'watch.json'), 'utf8'));
  assert.ok(written['intl-a']);
});

test('main errors and does not write watch.json when international.json is missing', async () => {
  const dir = tmpDataDir({});
  fs.writeFileSync(path.join(dir, 'watch.json'), JSON.stringify({ old: true }));
  const code = await main({ dataDir: dir, now: '2026-09-29', deps: { getText: async () => 'text', pause: async () => {} } });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'watch.json'), 'utf8')), { old: true });
});

test('main errors and does not write watch.json when international.json is unparseable', async () => {
  const dir = tmpDataDir({ 'international.json': '{not json' });
  fs.writeFileSync(path.join(dir, 'watch.json'), JSON.stringify({ old: true }));
  const code = await main({ dataDir: dir, now: '2026-09-29', deps: { getText: async () => 'text', pause: async () => {} } });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'watch.json'), 'utf8')), { old: true });
});

test('main errors and does not write watch.json when international.json is not an array', async () => {
  const dir = tmpDataDir({ 'international.json': { not: 'an array' } });
  fs.writeFileSync(path.join(dir, 'watch.json'), JSON.stringify({ old: true }));
  const code = await main({ dataDir: dir, now: '2026-09-29', deps: { getText: async () => 'text', pause: async () => {} } });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'watch.json'), 'utf8')), { old: true });
});
