import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tier, verdict } from '../fetch/classify.js';

const team = { size: 4, passout_years: [2029] };
const lists = {
  bschools: [{ name: 'XLRI', host: 'XLRI|Xavier School of Management' }],
  corporates: [{ name: 'HUL LIME', host: 'Hindustan Unilever', title: '\\bLIME\\b' }],
};
const open = { sector: ['students'], others: ['all'], studentPassoutYearsSelected: ['all'] };
const rec = over => ({
  title: 'A case', host: 'Somewhere', team_min: 1, team_max: 4, fee: false,
  eligible_filters: ['All'], eligibility: open,
  details_text: 'A case competition.', details_fetched: true, ...over,
});
const v = over => verdict(rec(over), team);

test('tiers', () => {
  assert.equal(tier(rec({ host: 'Indian Institute of Technology (IIT), Delhi' }), lists), 'iit');
  assert.equal(tier(rec({ host: 'Indian Institute of Management (IIM), Raipur' }), lists), 'iim');
  assert.equal(tier(rec({ host: 'IIIT Hyderabad' }), lists), 'other');
  assert.equal(tier(rec({ host: 'Xavier School of Management (XLRI)' }), lists), 'bschool');
  assert.equal(tier(rec({ host: 'Hindustan Unilever Limited' }), lists), 'corporate');
  assert.equal(tier(rec({ host: 'Unilever Careers', title: 'LIME Season 17' }), lists), 'corporate');
  assert.equal(tier(rec({ host: 'Some College' }), lists), 'other');
});

// One case per rule row, in rule order.
test('out: minimum team larger than ours', () => {
  assert.deepEqual(v({ team_min: 5 }), { level: 'out', reasons: ['needs at least 5 members'] });
});
test('out: not open to students', () => {
  assert.equal(v({ eligibility: { ...open, sector: ['corporates'] } }).level, 'out');
});
test('out: graduating years exclude ours', () => {
  assert.deepEqual(v({ eligibility: { ...open, studentPassoutYearsSelected: [2026, 2027] } }),
    { level: 'out', reasons: ['graduating 2026, 2027 only'] });
  assert.equal(v({ eligibility: { ...open, studentPassoutYearsSelected: [2028, 2029] } }).level, 'fits');
});
test('out: MBA/PGDM course list only', () => {
  const el = { sector: ['students'], others: [], bSchools: [{ course: 'mba1' }, { course: 'mba2' }, { course: 'pgdm' }] };
  assert.deepEqual(v({ eligibility: el }), { level: 'out', reasons: ['open to MBA/PGDM only'] });
});
test('out: postgraduate only filters', () => {
  assert.deepEqual(v({ eligible_filters: ['Management', 'Postgraduate'] }), { level: 'out', reasons: ['postgraduate only'] });
});
test('out: filters name neither UG nor management', () => {
  assert.equal(v({ eligible_filters: ['Engineering Students'] }).level, 'out');
});
test('check: listed for BBA only', () => {
  const r = v({ eligibility: { sector: ['students'], others: [], bSchools: [{ course: 'bba' }] } });
  assert.equal(r.level, 'check');
  assert.match(r.reasons[0], /BBA/);
});
test('check: details say MBA only', () => {
  const r = v({ details_text: 'This competition is open to MBA students only.' });
  assert.equal(r.level, 'check');
  assert.match(r.reasons[0], /MBA students only/);
});
test('check: details restrict to the host', () => {
  assert.equal(v({ details_text: 'Open only for students of IIM Raipur.' }).level, 'check');
});
test('check: entry fee', () => {
  assert.deepEqual(v({ fee: true }), { level: 'check', reasons: ['entry fee'] });
});
test('check: eligibility missing', () => {
  assert.deepEqual(v({ eligibility: null }), { level: 'check', reasons: ['eligibility not stated'] });
});
test('check: details not fetched', () => {
  assert.deepEqual(v({ details_fetched: false, details_text: '' }), { level: 'check', reasons: ['details not fetched'] });
});
test('fits: open to everyone', () => {
  assert.deepEqual(v({}), { level: 'fits', reasons: [] });
});
