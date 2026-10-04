import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDecisionSaver, editable, selectAll, recordsFromRows, decisionWrite,
  readListings, readArchive, readStatus, readWatch, readDecisions, readIntlDates, readManual,
  readMembers, readTeams, readTeamMembers, readRounds, saveDecision, setIntlDates, addManual,
} from '../lib/store.js';

// A stand-in for the supabase-js query builder: records every call, answers
// from `respond(call)` where call = { table, ops: [[name, ...args]] }.
function fakeClient(respond) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const b = new Proxy({}, {
        get(_, name) {
          if (name === 'then') {
            return (ok, bad) => Promise.resolve().then(() => respond(call)).then(ok, bad);
          }
          return (...args) => { call.ops.push([name, ...args]); return b; };
        },
      });
      return b;
    },
  };
  return client;
}
const op = (call, name) => call.ops.find(o => o[0] === name);
const ops = (call, name) => call.ops.filter(o => o[0] === name);

// Rows 0..n-1 served `cap` at a time whatever page size was asked for.
const pagedRows = (n, cap, make) => call => {
  const [, from, to] = op(call, 'range');
  const end = Math.min(to + 1, from + cap, n);
  return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => make(from + i)), error: null };
};

test('selectAll pages with .range() until an empty page, even when the server caps pages short', async () => {
  const client = fakeClient(pagedRows(705, 300, i => ({ id: i })));
  const rows = await selectAll(client, 'listings', { eq: { section: 'case' }, order: ['id'], pageSize: 500 });
  assert.equal(rows.length, 705);
  assert.deepEqual(rows.slice(0, 2), [{ id: 0 }, { id: 1 }]);
  // 0-299, 300-599, 600-704, then the empty page that ends it.
  assert.deepEqual(client.calls.map(c => op(c, 'range').slice(1)), [[0, 499], [300, 799], [600, 1099], [705, 1204]]);
  for (const c of client.calls) {
    assert.equal(c.table, 'listings');
    assert.deepEqual(op(c, 'eq'), ['eq', 'section', 'case']);
    assert.deepEqual(op(c, 'order'), ['order', 'id', { ascending: true }]);
  }
});

test('selectAll throws on a read error instead of returning a partial list', async () => {
  let n = 0;
  const client = fakeClient(() => (n++ === 0 ? { data: [{ id: 1 }], error: null } : { data: null, error: { message: 'JWT expired' } }));
  await assert.rejects(selectAll(client, 'listings'), /Could not read listings: JWT expired/);
  await assert.rejects(selectAll(fakeClient(() => ({ data: { x: 1 }, error: null })), 'watch'), /unexpected/);
});

test('recordsFromRows keeps the data objects only', () => {
  assert.deepEqual(recordsFromRows([{ data: { id: 1, title: 'A' } }, { data: null }, null, { data: 'x' }, { data: { id: 'intl-b' } }]),
    [{ id: 1, title: 'A' }, { id: 'intl-b' }]);
  assert.deepEqual(recordsFromRows(undefined), []);
});

test('listings and archive are read by section and mapped to records', async () => {
  const client = fakeClient(call => (op(call, 'range')[1] === 0
    ? { data: [{ data: { id: 7, title: 'Seven' } }, { data: { id: 'df-x', title: 'X' } }], error: null }
    : { data: [], error: null }));
  assert.deepEqual(await readListings('hack', client), [{ id: 7, title: 'Seven' }, { id: 'df-x', title: 'X' }]);
  const first = client.calls[0];
  assert.equal(first.table, 'listings');
  assert.deepEqual(op(first, 'select'), ['select', 'data']);
  assert.deepEqual(op(first, 'eq'), ['eq', 'section', 'hack']);
  const arch = await readArchive('case', client);
  assert.equal(arch.length, 2);
  const a = client.calls.find(c => c.table === 'archive');
  assert.deepEqual(op(a, 'eq'), ['eq', 'section', 'case']);
  assert.deepEqual(ops(a, 'order').map(o => o[1]), ['archived_on', 'archive_key']);
  await assert.rejects(readListings('both', client), /section/);
});

test('source_status: the section row, {} when there is none', async () => {
  const one = fakeClient(() => ({ data: [{ data: { last_ok: '2026-10-04T00:00:00Z', last_error: null } }], error: null }));
  assert.deepEqual(await readStatus('case', one), { last_ok: '2026-10-04T00:00:00Z', last_error: null });
  assert.deepEqual(op(one.calls[0], 'eq'), ['eq', 'section', 'case']);
  assert.deepEqual(await readStatus('hack', fakeClient(() => ({ data: [], error: null }))), {});
  await assert.rejects(readStatus('case', fakeClient(() => ({ data: null, error: { message: 'down' } }))), /down/);
});

const onePage = rows => call => ({ data: op(call, 'range')[1] === 0 ? rows : [], error: null });

test('watch becomes { id: data }', async () => {
  const client = fakeClient(onePage([{ id: 'intl-a', data: { changed_on: '2026-10-01' } }, { id: 'fest-b', data: { last_checked: '2026-10-02' } }]));
  assert.deepEqual(await readWatch(client), { 'intl-a': { changed_on: '2026-10-01' }, 'fest-b': { last_checked: '2026-10-02' } });
});

test('decisions, intl_dates and manual use the shared row converters', async () => {
  const d = fakeClient(onePage([{ id: '17', status: 'entering', registered: false, note: null, updated_at: '2026-09-28T20:00:00Z' }]));
  assert.deepEqual(await readDecisions(d), { 17: { status: 'entering', updated: '2026-09-29' } });
  const i = fakeClient(onePage([{ id: 'intl-z', regn_close: '2026-11-20', comp_end: null, confirmed_on: '2026-09-29' }]));
  assert.deepEqual(await readIntlDates(i), { 'intl-z': { regn_close: '2026-11-20', comp_end: null, confirmed_on: '2026-09-29' } });
  const m = fakeClient(onePage([{ id: '55', url: 'https://unstop.com/c/x-55', added: '2026-09-20' }]));
  assert.deepEqual(await readManual(m), [{ url: 'https://unstop.com/c/x-55', added: '2026-09-20' }]);
});

test('members, teams, team_members and rounds come back as rows', async () => {
  const rows = [{ a: 1 }];
  for (const [fn, table] of [[readMembers, 'members'], [readTeams, 'teams'], [readTeamMembers, 'team_members'], [readRounds, 'rounds']]) {
    const c = fakeClient(onePage(rows));
    assert.deepEqual(await fn(c), rows, table);
    assert.equal(c.calls[0].table, table);
  }
});

// ---- writes -----------------------------------------------------------------

test('decisionWrite: all empty -> delete; otherwise the full row', () => {
  const now = '2026-10-05T10:00:00.000Z';
  assert.deepEqual(decisionWrite(17, undefined, now), { delete: '17' });
  assert.deepEqual(decisionWrite(17, {}, now), { delete: '17' });
  assert.deepEqual(decisionWrite(17, { status: '', registered: false, note: '', updated: '2026-10-05' }, now), { delete: '17' });
  assert.deepEqual(decisionWrite(17, { status: 'watching', updated: '2026-10-05' }, now),
    { upsert: { id: '17', status: 'watching', registered: false, note: null, updated_at: now } });
  assert.deepEqual(decisionWrite('intl-a', { registered: true, note: 'x' }, now),
    { upsert: { id: 'intl-a', status: null, registered: true, note: 'x', updated_at: now } });
});

const ok = () => ({ data: null, error: null });

test('saveDecision upserts on id, or deletes the row when nothing is left', async () => {
  const c = fakeClient(ok);
  await saveDecision(9, { status: 'entering' }, c);
  assert.equal(c.calls[0].table, 'decisions');
  const [, row, opts] = op(c.calls[0], 'upsert');
  assert.equal(row.id, '9');
  assert.equal(row.status, 'entering');
  assert.deepEqual(opts, { onConflict: 'id' });
  await saveDecision(9, {}, c);
  assert.ok(op(c.calls[1], 'delete'));
  assert.deepEqual(op(c.calls[1], 'eq'), ['eq', 'id', '9']);
});

test('a refused write (RLS, network) throws with the server message', async () => {
  const c = fakeClient(() => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "decisions"' } }));
  await assert.rejects(saveDecision(9, { status: 'watching' }, c), /row-level security/);
  await assert.rejects(setIntlDates('intl-a', '2026-11-01', null, c), /row-level security/);
  await assert.rejects(addManual('https://unstop.com/competitions/x-55', c), /row-level security/);
});

test('setIntlDates upserts the dates, or deletes when both are cleared', async () => {
  const c = fakeClient(ok);
  await setIntlDates('intl-a', '2026-11-01', '', c);
  const [, row, opts] = op(c.calls[0], 'upsert');
  assert.equal(c.calls[0].table, 'intl_dates');
  assert.equal(row.id, 'intl-a');
  assert.equal(row.regn_close, '2026-11-01');
  assert.equal(row.comp_end, null);
  assert.match(row.confirmed_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(opts, { onConflict: 'id' });
  await setIntlDates('intl-a', null, null, c);
  assert.ok(op(c.calls[1], 'delete'));
  assert.deepEqual(op(c.calls[1], 'eq'), ['eq', 'id', 'intl-a']);
});

test('addManual inserts { id, url } once, https Unstop links only', async () => {
  const c = fakeClient(ok);
  assert.equal(await addManual('https://unstop.com/competitions/case-challenge-1759741', c), '1759741');
  const [, row, opts] = op(c.calls[0], 'upsert');
  assert.equal(c.calls[0].table, 'manual');
  assert.deepEqual(row, { id: '1759741', url: 'https://unstop.com/competitions/case-challenge-1759741' });
  assert.deepEqual(opts, { onConflict: 'id', ignoreDuplicates: true });
  await assert.rejects(addManual('http://unstop.com/competitions/x-55', c), /Only Unstop/);
  await assert.rejects(addManual('https://example.com/x-55', c), /Only Unstop/);
  assert.equal(c.calls.length, 1);
});

test('not editable before anyone has signed in', () => {
  assert.equal(editable(), false);
});

// ---- the serialised decision saver ------------------------------------------

function harness(send) {
  const state = { decisions: { 7: { note: 'keep', updated: '2026-09-01' } } };
  const log = [];
  const hooks = {
    local: (id, before, after) => log.push(['local', id, after.status]),
    saved: (id, shown, now) => log.push(['saved', id, now.status]),
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

test('a failed save stays on screen and reports; the queue carries on', async () => {
  let n = 0;
  const { state, saver, log } = harness(async () => { if (n++ === 0) throw new Error('offline'); });
  await saver.save(7, d => ({ ...d, status: 'watching' }));
  assert.equal(state.decisions[7].status, 'watching');
  assert.deepEqual(log.at(-1), ['failed', 'offline']);
  await saver.save(7, d => ({ ...d, status: 'entering' }));
  assert.deepEqual(log.at(-1), ['saved', '7', 'entering']);
  assert.deepEqual(saver.overlay({}), {});
});

test('a cleared decision is sent as an empty row (the store deletes it)', async () => {
  const sent = [];
  const { saver } = harness(async (id, d) => { sent.push([id, d]); });
  await saver.save(7, () => ({}));
  assert.deepEqual(sent, [['7', undefined]]);
});
