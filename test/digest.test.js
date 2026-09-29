import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../digest/email.js';

const now = new Date('2026-10-05T02:30:00Z'); // Monday 08:00 IST
const fresh = { last_ok: '2026-10-05T00:30:00Z', last_error: null };
const c = (id, over = {}) => ({
  id, title: `C${id}`, host: 'IIM X', tier: 'iim', verdict: { level: 'fits', reasons: [] },
  regn_close: '2026-11-01', comp_end: '2026-11-10', first_seen: '2026-10-04', closed_on: null, pinned: false, is_case: true, url: 'u', ...over,
});

test('new = not in sent_ids, relevant, not out', () => {
  const d = buildDigest({
    competitions: [c(1), c(2), c(3, { tier: 'other' }), c(4, { verdict: { level: 'out', reasons: ['x'] } }), c(5, { tier: 'other', pinned: true })],
    decisions: {}, status: fresh, state: { sent_ids: [1] }, now,
  });
  assert.deepEqual(d.sections.fresh.map(x => x.id), [2, 5]);
  assert.deepEqual(d.nextState.sent_ids, [1, 2, 3, 4, 5]);
});

test('non-case formats never reach the digest unless pinned', () => {
  const d = buildDigest({
    competitions: [c(1, { is_case: false }), c(2, { is_case: false, pinned: true })],
    decisions: {}, status: fresh, state: { sent_ids: [] }, now,
  });
  assert.deepEqual(d.sections.fresh.map(x => x.id), [2]);
});

test('first run counts the last 7 days as new', () => {
  const d = buildDigest({ competitions: [c(1, { first_seen: '2026-09-20' }), c(2)], decisions: {}, status: fresh, state: null, now });
  assert.deepEqual(d.sections.fresh.map(x => x.id), [2]);
});

test('closing within 10 days: watching, or undecided and fits', () => {
  const soon = { regn_close: '2026-10-12' };
  const d = buildDigest({
    competitions: [c(1, soon), c(2, soon), c(3, { ...soon, verdict: { level: 'check', reasons: ['fee'] } }), c(4, { regn_close: '2026-10-20' })],
    decisions: { 2: { status: 'skipped' }, 3: { status: 'watching' } }, status: fresh, state: { sent_ids: [1, 2, 3, 4] }, now,
  });
  assert.deepEqual(d.sections.closing.map(x => x.id), [1, 3]);
});

test('clashes against entering competitions', () => {
  const d = buildDigest({
    competitions: [c(1), c(2, { regn_close: '2026-11-05' }), c(3, { regn_close: '2027-01-01', comp_end: '2027-01-02' })],
    decisions: { 1: { status: 'entering' } }, status: fresh, state: { sent_ids: [1, 2, 3] }, now,
  });
  assert.deepEqual(d.sections.clashing.map(x => [x.c.id, x.with]), [[2, ['C1']]]);
});

test('stale data leads the email', () => {
  const d = buildDigest({ competitions: [], decisions: {}, status: { last_ok: '2026-10-02T00:30:00Z', last_error: 'HTTP 403' }, state: {}, now });
  assert.match(d.subject, /stale/i);
  assert.match(d.text, /HTTP 403/);
});

test('nothing new still sends a one-liner', () => {
  const d = buildDigest({ competitions: [], decisions: {}, status: fresh, state: { sent_ids: [] }, now });
  assert.match(d.subject, /nothing new/i);
  assert.ok(d.text.length > 0);
});
