import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge } from '../fetch/merge.js';

const today = '2026-10-01';
const r = (id, over = {}) => ({ id, title: `C${id}`, regn_close: '2026-10-20', comp_end: '2026-10-30', ...over });

test('first_seen is set once', () => {
  const a = merge([], [r(1)], {}, today);
  assert.equal(a[0].first_seen, today);
  const b = merge(a, [r(1)], {}, '2026-10-05');
  assert.equal(b[0].first_seen, today);
});

test('closed_on when absent or past deadline, cleared on reappearance', () => {
  const start = merge([], [r(1), r(2, { regn_close: '2026-09-30' })], {}, today);
  assert.equal(start.find(x => x.id === 2).closed_on, today);
  const gone = merge(start, [r(2, { regn_close: '2026-09-30' })], {}, '2026-10-02');
  assert.equal(gone.find(x => x.id === 1).closed_on, '2026-10-02');
  const back = merge(gone, [r(1)], {}, '2026-10-03');
  assert.equal(back.find(x => x.id === 1).closed_on, null);
});

test('closed records are pruned after 60 days', () => {
  const closed = [{ ...r(1), first_seen: '2026-07-01', closed_on: '2026-08-01' }];
  assert.equal(merge(closed, [], {}, '2026-09-30').length, 1);
  assert.equal(merge(closed, [], {}, '2026-10-01').length, 0);
});

test('entering records are kept until 60 days after comp_end', () => {
  const closed = [{ ...r(1, { comp_end: '2026-09-15' }), first_seen: '2026-07-01', closed_on: '2026-08-01' }];
  const dec = { 1: { status: 'entering' } };
  assert.equal(merge(closed, [], dec, '2026-11-14').length, 1);
  assert.equal(merge(closed, [], dec, '2026-11-15').length, 0);
});

test('output is sorted by registration close', () => {
  const out = merge([], [r(1, { regn_close: '2026-11-01' }), r(2, { regn_close: '2026-10-05' }), r(3, { regn_close: null })], {}, today);
  assert.deepEqual(out.map(x => x.id), [2, 1, 3]);
});
