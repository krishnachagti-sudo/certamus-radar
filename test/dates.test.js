import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istDate, dayDiff, todayIST } from '../dates.js';

test('istDate gives the calendar date in IST', () => {
  assert.equal(istDate('2026-11-09T21:25:00+05:30'), '2026-11-09');
  assert.equal(istDate('2026-11-09T20:00:00Z'), '2026-11-10'); // 01:30 IST next day
  assert.equal(istDate(null), null);
  assert.equal(istDate('not a date'), null);
});

test('dayDiff is b minus a in whole days', () => {
  assert.equal(dayDiff('2026-10-01', '2026-10-08'), 7);
  assert.equal(dayDiff('2026-10-08', '2026-10-01'), -7);
});

test('todayIST rolls over at IST midnight, not UTC', () => {
  assert.equal(todayIST(new Date('2026-09-29T19:00:00Z')), '2026-09-30');
});
