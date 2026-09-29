import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, eligibilityRows } from '../lib/eligibility.js';

const states = rows => rows.map(r => r.state);

test('the rule table follows classify order', () => {
  assert.deepEqual(RULES.map(r => r.name), [
    'Team size', 'Open to students', 'Graduating year', 'Course list', 'Filters (UG/management)',
    'BBA/IPM wording', 'Restrictive wording in brief', 'Entry fee', 'Eligibility stated', 'Details fetched',
  ]);
});

test('fits: every rule passes', () => {
  const rows = eligibilityRows({ verdict: { level: 'fits', reasons: [] } });
  assert.equal(rows.length, RULES.length);
  assert.ok(rows.every(r => r.state === 'ok'));
});

test('check: the stored reasons warn on their rules, all others pass', () => {
  const rows = eligibilityRows({ verdict: { level: 'check', reasons: ['entry fee', 'eligibility not stated'] } });
  assert.deepEqual(states(rows), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'check', 'check', 'ok']);
  assert.equal(rows[7].detail, 'entry fee');
  assert.equal(rows[8].detail, 'eligibility not stated');
});

test('out on the first rule: nothing after it was checked', () => {
  const rows = eligibilityRows({ verdict: { level: 'out', reasons: ['needs at least 5 members'] } });
  assert.equal(rows[0].state, 'out');
  assert.equal(rows[0].detail, 'needs at least 5 members');
  assert.ok(rows.slice(1).every(r => r.state === 'unchecked'));
});

test('out in the middle: earlier rules pass, later rules not checked', () => {
  const rows = eligibilityRows({ verdict: { level: 'out', reasons: ['graduating 2027 only'] } });
  assert.deepEqual(states(rows).slice(0, 4), ['ok', 'ok', 'out', 'unchecked']);
  assert.ok(rows.slice(3).every(r => r.state === 'unchecked'));
});

test('"open to X only" goes to Filters when X is the stored filter list, else Course list', () => {
  const filters = eligibilityRows({ eligible_filters: ['Postgraduate', 'Medical'], verdict: { level: 'out', reasons: ['open to Postgraduate, Medical only'] } });
  assert.equal(filters[4].state, 'out');
  assert.equal(filters[3].state, 'ok');
  const course = eligibilityRows({ eligible_filters: ['Undergraduate'], verdict: { level: 'out', reasons: ['open to MBA/PGDM only'] } });
  assert.equal(course[3].state, 'out');
  assert.equal(course[4].state, 'unchecked');
  assert.equal(eligibilityRows({ verdict: { level: 'out', reasons: ['postgraduate only'] } })[4].state, 'out');
});

test('check reasons for wording and details map to their rules', () => {
  const rows = eligibilityRows({ verdict: { level: 'check', reasons: [
    'listed for BBA/IPM/B.Com; BMS usually counts, confirm', 'details say "MBA only"', 'details not fetched'] } });
  assert.deepEqual(states(rows), ['ok', 'ok', 'ok', 'ok', 'ok', 'check', 'check', 'ok', 'ok', 'check']);
});

test('a reason no rule recognises is kept as an extra row', () => {
  const check = eligibilityRows({ verdict: { level: 'check', reasons: ['something new'] } });
  assert.equal(check.length, RULES.length + 1);
  assert.deepEqual(check.at(-1), { name: 'Other', state: 'check', detail: 'something new' });
  const out = eligibilityRows({ verdict: { level: 'out', reasons: ['something new'] } });
  assert.ok(out.slice(0, RULES.length).every(r => r.state === 'unchecked'));
  assert.equal(out.at(-1).state, 'out');
});

test('curated and Opportunity Desk records have no rule table', () => {
  assert.equal(eligibilityRows({ source: 'curated', verdict: { level: 'fits', reasons: [] } }), null);
  assert.equal(eligibilityRows({ source: 'oppdesk', verdict: { level: 'check', reasons: ['x'] } }), null);
});

test('a record with no verdict marks every rule not checked', () => {
  assert.ok(eligibilityRows({}).every(r => r.state === 'unchecked'));
});
