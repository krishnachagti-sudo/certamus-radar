import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unstopId } from '../urls.js';

test('reads the trailing id from an Unstop competition link', () => {
  assert.equal(unstopId('https://unstop.com/competitions/ops-essentia-operations-case-study-challenge--1759741'), 1759741);
  assert.equal(unstopId('https://unstop.com/competitions/x-1759741/'), 1759741);
  assert.equal(unstopId('https://www.unstop.com/competitions/x-1759741?ref=abc'), 1759741);
});

test('rejects anything else', () => {
  assert.equal(unstopId('https://example.com/competitions/x-1759741'), null);
  assert.equal(unstopId('https://unstop.com/competitions/no-id-here'), null);
  assert.equal(unstopId('not a url'), null);
});
