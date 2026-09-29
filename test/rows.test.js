import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionsFromRows, intlDatesFromRows, manualFromRows, decisionRpcBody, parseKeyHash, isKeyRejection,
} from '../lib/rows.js';

const KEY = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

test('decision rows become the in-memory shape, omitting nulls and false', () => {
  const rows = [
    { id: '17', status: 'entering', registered: false, note: null, updated_at: '2026-09-28T20:00:00+00:00' },
    { id: 'intl-icbc', status: null, registered: true, note: 'Ask Riya', updated_at: '2026-09-29T03:00:00Z' },
    { id: '5', status: null, registered: false, note: '', updated_at: '2026-09-29T03:00:00Z' },
  ];
  assert.deepEqual(decisionsFromRows(rows), {
    17: { status: 'entering', updated: '2026-09-29' }, // IST date
    'intl-icbc': { registered: true, note: 'Ask Riya', updated: '2026-09-29' },
  });
});

test('decisionsFromRows tolerates junk', () => {
  assert.deepEqual(decisionsFromRows(null), {});
  assert.deepEqual(decisionsFromRows([null, { status: 'watching' }, { id: '', status: 'watching' }]), {});
  assert.deepEqual(decisionsFromRows([{ id: '9', status: 'watching' }]), { 9: { status: 'watching' } });
});

test('intl_dates rows keep nulls', () => {
  assert.deepEqual(intlDatesFromRows([
    { id: 'intl-z', regn_close: '2026-11-20', comp_end: null, confirmed_on: '2026-09-29' },
    { regn_close: '2026-01-01' },
  ]), { 'intl-z': { regn_close: '2026-11-20', comp_end: null, confirmed_on: '2026-09-29' } });
  assert.deepEqual(intlDatesFromRows('nope'), {});
});

test('manual rows become [{ url, added }]', () => {
  assert.deepEqual(manualFromRows([
    { id: '55', url: 'https://unstop.com/competitions/kept-55', added: '2026-09-20' },
    { id: '56' },
  ]), [{ url: 'https://unstop.com/competitions/kept-55', added: '2026-09-20' }]);
  assert.deepEqual(manualFromRows(undefined), []);
});

test('decisionRpcBody sends the full row every time', () => {
  assert.deepEqual(decisionRpcBody(KEY, 17, { status: 'watching', updated: '2026-09-29' }),
    { k: KEY, p_id: '17', p_status: 'watching', p_registered: false, p_note: null });
  assert.deepEqual(decisionRpcBody(KEY, 'intl-a', { registered: true, note: 'x' }),
    { k: KEY, p_id: 'intl-a', p_status: null, p_registered: true, p_note: 'x' });
  assert.deepEqual(decisionRpcBody(KEY, 3, undefined),
    { k: KEY, p_id: '3', p_status: null, p_registered: false, p_note: null });
});

test('parseKeyHash finds a 64-hex key and keeps the rest of the hash', () => {
  assert.deepEqual(parseKeyHash(`#key=${KEY}`), { key: KEY, rest: '' });
  assert.deepEqual(parseKeyHash(`#key=${KEY.toUpperCase()}`), { key: KEY, rest: '' });
  assert.deepEqual(parseKeyHash(`#view=agenda&key=${KEY}`), { key: KEY, rest: '#view=agenda' });
  assert.deepEqual(parseKeyHash(`#key=${KEY}&x=1`), { key: KEY, rest: '#x=1' });
});

test('parseKeyHash ignores anything that is not exactly 64 hex', () => {
  for (const h of ['', '#', '#key=', `#key=${KEY.slice(1)}`, `#key=${KEY}0`, `#key=${KEY.slice(1)}g`, `#monkey=${KEY}`, null, undefined]) {
    assert.equal(parseKeyHash(h).key, null, String(h));
  }
  assert.equal(parseKeyHash('#top').rest, '#top');
});

test('isKeyRejection: 401, 403 or Postgres 42501', () => {
  assert.equal(isKeyRejection(401, null), true);
  assert.equal(isKeyRejection(403, {}), true);
  assert.equal(isKeyRejection(400, { code: '42501', message: 'forbidden' }), true);
  assert.equal(isKeyRejection(400, { code: '22023', message: 'Only Unstop competition links' }), false);
  assert.equal(isKeyRejection(500, null), false);
});
