import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clashes } from '../clash.js';

const today = '2026-10-01';
const entering = [{ id: 1, title: 'Ops-Essentia', regn_close: '2026-10-10', comp_end: '2026-11-09' }];

test('7 days apart clashes, 8 does not', () => {
  assert.deepEqual(clashes({ id: 2, regn_close: '2026-11-16' }, entering, today), ['Ops-Essentia']);
  assert.deepEqual(clashes({ id: 2, regn_close: '2026-11-17' }, entering, today), []);
});

test('any date of either side counts', () => {
  assert.deepEqual(clashes({ id: 2, comp_end: '2026-10-04' }, entering, today), ['Ops-Essentia']);
});

test('no dates, no clash', () => {
  assert.deepEqual(clashes({ id: 2 }, entering, today), []);
});

test('never clashes with itself', () => {
  assert.deepEqual(clashes(entering[0], entering, today), []);
});

test('an entering competition stops counting after its end', () => {
  assert.deepEqual(clashes({ id: 2, regn_close: '2026-11-12' }, entering, '2026-11-09'), ['Ops-Essentia']);
  assert.deepEqual(clashes({ id: 2, regn_close: '2026-11-12' }, entering, '2026-11-10'), []);
});
