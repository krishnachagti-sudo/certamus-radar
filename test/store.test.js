import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restGet, rpcCall, KeyRejected, createDecisionSaver, configured, editable } from '../lib/store.js';

const cfg = { url: 'https://abc.supabase.co', anon: 'anon-1' };
const res = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
  json: async () => body,
});

test('configured from config.js; not editable without a key', () => {
  assert.equal(configured(), true);
  assert.equal(editable(), false);
});

test('restGet sends the anon key and returns rows', async () => {
  const calls = [];
  const rows = await restGet(cfg, 'manual', async (url, init) => { calls.push({ url, init }); return res(200, [{ id: '1' }]); });
  assert.deepEqual(rows, [{ id: '1' }]);
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/manual?select=*');
  assert.deepEqual(calls[0].init.headers, { apikey: 'anon-1', Authorization: 'Bearer anon-1' });
});

test('restGet throws on HTTP errors and non-arrays', async () => {
  await assert.rejects(restGet(cfg, 'decisions', async () => res(500, { message: 'boom' })), /boom/);
  await assert.rejects(restGet(cfg, 'decisions', async () => res(200, { x: 1 })), /unexpected/);
  await assert.rejects(restGet({ url: '', anon: '' }, 'decisions', async () => res(200, [])), /not configured/);
});

test('rpcCall POSTs JSON and parses the result (empty body is null)', async () => {
  let seen;
  const out = await rpcCall(cfg, 'add_manual', { k: 'x', p_url: 'u' }, async (url, init) => { seen = { url, init }; return res(200, '55'); });
  assert.equal(out, '55');
  assert.equal(seen.url, 'https://abc.supabase.co/rest/v1/rpc/add_manual');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.equal(seen.init.headers.apikey, 'anon-1');
  assert.deepEqual(JSON.parse(seen.init.body), { k: 'x', p_url: 'u' });
  assert.equal(await rpcCall(cfg, 'set_decision', {}, async () => res(204)), null);
});

test('rpcCall: 401, 403 and 42501 raise KeyRejected; other errors carry the server message', async () => {
  for (const r of [res(401, {}), res(403, { code: '42501', message: 'forbidden' }), res(400, { code: '42501', message: 'forbidden' })]) {
    await assert.rejects(rpcCall(cfg, 'set_decision', {}, async () => r), KeyRejected);
  }
  await assert.rejects(rpcCall(cfg, 'add_manual', {}, async () => res(400, { code: '22023', message: 'Only Unstop competition links' })),
    e => !(e instanceof KeyRejected) && e.message === 'Only Unstop competition links');
  await assert.rejects(rpcCall(cfg, 'add_manual', {}, async () => res(502)), /HTTP 502/);
});

// ---- the serialised decision saver ------------------------------------------

function harness(send) {
  const state = { decisions: { 7: { note: 'keep', updated: '2026-09-01' } } };
  const log = [];
  const hooks = {
    local: (id, before, after) => log.push(['local', id, after.status]),
    saved: (id, shown, now) => log.push(['saved', id, now.status]),
    keyRejected: async () => log.push(['rejected']),
    failed: err => log.push(['failed', err.message]),
  };
  return { state, log, saver: createDecisionSaver(state, hooks, send) };
}

test('each save sends the full row, merged with the change, one at a time', async () => {
  const sent = [];
  let inFlight = 0;
  const { state, saver, log } = harness(async (id, d) => {
    inFlight++; assert.equal(inFlight, 1); sent.push([id, { ...d }]);
    await new Promise(r => setTimeout(r, 5)); inFlight--;
  });
  const a = saver.save(7, d => ({ ...d, status: 'watching' }));
  const b = saver.save(7, d => ({ ...d, registered: true }));
  assert.equal(state.decisions[7].status, 'watching'); // optimistic
  await Promise.all([a, b]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0][0], '7');
  assert.equal(sent[0][1].note, 'keep');
  assert.equal(sent[0][1].status, 'watching');
  assert.equal(sent[1][1].registered, true);
  assert.equal(sent[1][1].status, 'watching');
  assert.deepEqual(log.filter(l => l[0] === 'saved').length, 2);
});

test('pending changes survive a reload of decisions (overlay)', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { state, saver } = harness(async () => { await gate; });
  const job = saver.save(9, d => ({ ...d, status: 'entering' }));
  const fresh = { 7: { status: 'skipped' } };
  const merged = saver.overlay(fresh);
  assert.equal(merged[9].status, 'entering');
  assert.equal(merged[7].status, 'skipped');
  release();
  await job;
  assert.deepEqual(saver.overlay({}), {}); // nothing pending once saved
  assert.equal(state.decisions[9].status, 'entering');
});

test('a failed save stays on screen and reports; a rejected key drops the queue', async () => {
  const { state, saver, log } = harness(async () => { throw new Error('offline'); });
  await saver.save(7, d => ({ ...d, status: 'watching' }));
  assert.equal(state.decisions[7].status, 'watching');
  assert.deepEqual(log.at(-1), ['failed', 'offline']);

  let calls = 0;
  const h2 = harness(async () => { calls++; throw new KeyRejected('forbidden'); });
  const first = h2.saver.save(7, d => ({ ...d, status: 'watching' }));
  const second = h2.saver.save(7, d => ({ ...d, status: 'entering' }));
  h2.saver.drop(); // what keyRejected does, simulated before the queue runs
  await Promise.all([first, second]);
  assert.equal(calls, 0);

  const h3 = harness(async () => { throw new KeyRejected('forbidden'); });
  await h3.saver.save(7, d => ({ ...d, status: 'watching' }));
  assert.deepEqual(h3.log.at(-1), ['rejected']);
});
