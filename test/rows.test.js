import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionsFromRows, intlDatesFromRows, manualFromRows } from '../lib/rows.js';

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
