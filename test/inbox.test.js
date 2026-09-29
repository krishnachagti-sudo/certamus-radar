import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevantForInbox, newItems, closingItems, seenFrom, inboxHtml } from '../lib/inbox.js';

const today = '2026-09-30';
const base = { tier: 'iim', is_case: true, verdict: { level: 'fits' }, first_seen: '2026-09-29' };
const comp = (id, extra = {}) => ({ ...base, id, title: `T${id}`, host: `H${id}`, ...extra });
const ids = list => list.map(c => c.id);

test('relevantForInbox keeps a top-tier open case that is not out, skipped or registered', () => {
  assert.equal(relevantForInbox(comp(1), {}), true);
  for (const tier of ['iit', 'iim', 'bschool', 'corporate', 'international']) {
    assert.equal(relevantForInbox(comp(1, { tier }), {}), true, tier);
  }
  assert.equal(relevantForInbox(comp(1, { verdict: { level: 'check' } }), {}), true);
  assert.equal(relevantForInbox(comp(1, { is_case: undefined }), {}), true);
});

test('relevantForInbox excludes other tier, non-case, out, closed, skipped, registered', () => {
  assert.equal(relevantForInbox(comp(1, { tier: 'other' }), {}), false);
  assert.equal(relevantForInbox(comp(1, { is_case: false }), {}), false);
  assert.equal(relevantForInbox(comp(1, { verdict: { level: 'out' } }), {}), false);
  assert.equal(relevantForInbox(comp(1, { closed_on: '2026-09-29' }), {}), false);
  assert.equal(relevantForInbox(comp(1), { 1: { status: 'skipped' } }), false);
  assert.equal(relevantForInbox(comp(1), { 1: { registered: true } }), false);
  assert.equal(relevantForInbox(comp('intl-a'), { 'intl-a': { registered: true } }), false);
  // watching and entering stay in
  assert.equal(relevantForInbox(comp(1), { 1: { status: 'watching' } }), true);
  assert.equal(relevantForInbox(comp(1), { 1: { status: 'entering' } }), true);
});

test('newItems on first visit: first_seen within the last 7 days', () => {
  const comps = [
    comp(1, { first_seen: '2026-09-30' }),
    comp(2, { first_seen: '2026-09-23' }), // 7 days: in
    comp(3, { first_seen: '2026-09-22' }), // 8 days: out
    comp(4, { first_seen: undefined }),
  ];
  assert.deepEqual(ids(newItems(comps, {}, null, today)), [1, 2]);
});

test('newItems with a seen set: ids not yet seen, numbers and strings compared as strings', () => {
  const comps = [comp(1, { first_seen: '2026-01-01' }), comp(2), comp('intl-a'), comp('intl-b')];
  const seen = { ids: ['1', 'intl-a'], at: '2026-09-29' };
  assert.deepEqual(ids(newItems(comps, {}, seen, today)).sort(), [2, 'intl-b'].sort());
  // number ids in the stored set still match string or number comp ids
  assert.deepEqual(ids(newItems([comp('7'), comp(8)], {}, { ids: [7, '8'] }, today)), []);
});

test('newItems excludes irrelevant items and sorts by regn_close, nulls last', () => {
  const comps = [
    comp(1, { regn_close: '2026-10-20' }),
    comp(2),
    comp(3, { regn_close: '2026-10-02' }),
    comp(4, { regn_close: '2026-10-01', tier: 'other' }),
    comp(5, { regn_close: '2026-10-01', verdict: { level: 'out' } }),
    comp(6, { regn_close: '2026-10-01' }),
  ];
  const d = { 6: { status: 'skipped' } };
  assert.deepEqual(ids(newItems(comps, d, { ids: [] }, today)), [3, 1, 2]);
});

test('closingItems: 0 to 10 days out, soonest first, relevant only', () => {
  const comps = [
    comp(1, { regn_close: '2026-10-10' }), // 10: in
    comp(2, { regn_close: '2026-10-11' }), // 11: out
    comp(3, { regn_close: '2026-09-30' }), // 0: in
    comp(4, { regn_close: '2026-09-29' }), // -1: out
    comp(5, { regn_close: '2026-10-03' }),
    comp(6),                                // no date
    comp(7, { regn_close: '2026-10-03' }),  // registered
    comp('intl-x', { regn_close: '2026-10-05', tier: 'international' }),
  ];
  const d = { 7: { registered: true } };
  assert.deepEqual(ids(closingItems(comps, d, today)), [3, 5, 'intl-x', 1]);
});

test('seenFrom accepts only a well-formed record', () => {
  assert.equal(seenFrom(null), null);
  assert.equal(seenFrom('nope'), null);
  assert.equal(seenFrom('{"ids":"x"}'), null);
  assert.deepEqual(seenFrom('{"ids":[1,"a"],"at":"2026-09-30"}'), { ids: ['1', 'a'], at: '2026-09-30' });
});

test('inboxHtml escapes titles, hosts and ids', () => {
  const evil = comp('"><img src=x onerror=alert(1)>', {
    title: '<script>alert(1)</script>', host: '<b onmouseover=x>h</b>', regn_close: '2026-10-01',
  });
  const html = inboxHtml({ fresh: [evil], closing: [evil], decisions: {}, today, editable: true });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b '));
  assert.ok(html.includes('c.html?id=%22%3E%3Cimg'));
});

test('inboxHtml collapses to one line when both lists are empty', () => {
  const html = inboxHtml({ fresh: [], closing: [], decisions: {}, today, editable: false });
  assert.ok(html.includes('All caught up: nothing new, and everything closing soon is registered.'));
  assert.ok(!html.includes('<section'));
});
