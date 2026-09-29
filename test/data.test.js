import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameId, statusOf, isRegistered, committedSet, visible, sortByDeadline,
  monthsText, expectedText, whoAppliesText, watchChanged, applyDecision,
  decisionView, needsFullRender, matchesQuery, BOARD_TIERS, TIERS,
} from '../lib/data.js';

const today = '2026-10-01';

test('sameId compares numbers and strings as strings', () => {
  assert.equal(sameId(1759741, '1759741'), true);
  assert.equal(sameId('intl-icbc', 'intl-icbc'), true);
  assert.equal(sameId('intl-icbc', 'intl-gcch'), false);
  assert.equal(sameId(null, 'null'), false);
});

test('statusOf and isRegistered read decisions by string key', () => {
  const d = { 17: { status: 'entering' }, 'intl-icbc': { registered: true } };
  assert.equal(statusOf(d, { id: 17 }), 'entering');
  assert.equal(statusOf(d, { id: 'intl-icbc' }), 'undecided');
  assert.equal(isRegistered(d, { id: 'intl-icbc' }), true);
  assert.equal(isRegistered(d, { id: 17 }), false);
});

test('committed set = entering OR registered', () => {
  const comps = [{ id: 1 }, { id: 2 }, { id: 'intl-a' }, { id: 4 }];
  const d = { 1: { status: 'entering' }, 2: { status: 'watching' }, 'intl-a': { status: 'skipped', registered: true } };
  assert.deepEqual(committedSet(comps, d).map(c => c.id), [1, 'intl-a']);
});

const base = {
  tiers: new Set(BOARD_TIERS), verdicts: new Set(['fits', 'check']),
  statuses: new Set(['undecided', 'watching', 'entering']),
  registeredOnly: false, showClosed: false, showOtherFormats: false, startups: false, query: '',
};
const comp = (over = {}) => ({ id: 1, title: 'Ops Case', host: 'IIM A', tier: 'iim', is_case: true, verdict: { level: 'fits' }, ...over });

test('board tiers include international, not other', () => {
  assert.deepEqual(BOARD_TIERS, ['iit', 'iim', 'national', 'bschool', 'corporate', 'international']);
  assert.equal(visible(comp({ tier: 'international' }), base, {}), true);
  assert.equal(visible(comp({ tier: 'other' }), base, {}), false);
  assert.equal(visible(comp({ tier: 'other', pinned: true }), base, {}), true);
});

test('closed, status and verdict filters', () => {
  assert.equal(visible(comp({ closed_on: '2026-09-01' }), base, {}), false);
  assert.equal(visible(comp({ closed_on: '2026-09-01' }), { ...base, showClosed: true }, {}), true);
  assert.equal(visible(comp(), base, { 1: { status: 'skipped' } }), false);
  assert.equal(visible(comp({ verdict: { level: 'out' } }), base, {}), false);
});

test('registered only narrows to registered', () => {
  const f = { ...base, registeredOnly: true };
  assert.equal(visible(comp(), f, {}), false);
  assert.equal(visible(comp(), f, { 1: { registered: true } }), true);
});

test('non-case formats hidden unless asked; startups follow their own flag', () => {
  assert.equal(visible(comp({ is_case: false }), base, {}), false);
  assert.equal(visible(comp({ is_case: false }), { ...base, showOtherFormats: true }, {}), true);
  const startup = comp({ is_case: false, kind: 'startup', tier: 'international' });
  assert.equal(visible(startup, { ...base, showOtherFormats: true }, {}), false);
  assert.equal(visible(startup, { ...base, startups: true }, {}), true);
});

test('query matches title or host, case-insensitive', () => {
  assert.equal(matchesQuery(comp(), 'ops'), true);
  assert.equal(matchesQuery(comp(), 'iim a'), true);
  assert.equal(matchesQuery(comp(), 'xyz'), false);
  assert.equal(matchesQuery(comp(), '  '), true);
  assert.equal(visible(comp(), { ...base, query: 'xyz' }, {}), false);
});

test('sortByDeadline: earliest first, no deadline last, ties by title, input untouched', () => {
  const list = [
    { id: 1, title: 'B', regn_close: null },
    { id: 2, title: 'Z', regn_close: '2026-10-05' },
    { id: 3, title: 'A', regn_close: '2026-10-05' },
    { id: 4, title: 'C', regn_close: '2026-10-02' },
  ];
  assert.deepEqual(sortByDeadline(list).map(c => c.id), [4, 3, 2, 1]);
  assert.equal(list[0].id, 1);
});

test('monthsText compresses consecutive runs, including over the year end', () => {
  assert.equal(monthsText([10]), 'Oct');
  assert.equal(monthsText([9, 10, 11, 12, 1, 2]), 'Sep–Feb');
  assert.equal(monthsText([2, 3]), 'Feb–Mar');
  assert.equal(monthsText([1, 5]), 'Jan, May');
  assert.equal(monthsText(null), '');
  assert.equal(monthsText([]), '');
});

test('expectedText', () => {
  assert.equal(expectedText({ expected: { application_months: [10], finals_months: [1] } }), 'applications usually Oct, finals usually Jan');
  assert.equal(expectedText({ expected: { application_months: null, finals_months: [2, 3] } }), 'finals usually Feb–Mar');
  assert.equal(expectedText({ expected: { application_months: null, finals_months: null } }), 'dates not announced');
  assert.equal(expectedText({}), null);
});

test('whoAppliesText', () => {
  assert.equal(whoAppliesText({ intl: { who_applies: 'team' } }), 'Your team applies');
  assert.equal(whoAppliesText({ intl: { who_applies: 'school' } }), 'IIM Sirmaur must apply for an invitation');
  assert.equal(whoAppliesText({}), null);
});

test('watchChanged: changed_on within 30 days', () => {
  const w = { a: { changed_on: '2026-09-01' }, b: { changed_on: '2026-08-31' }, c: { changed_on: null } };
  assert.equal(watchChanged(w, { id: 'a' }, today), '2026-09-01');
  assert.equal(watchChanged(w, { id: 'b' }, today), null);
  assert.equal(watchChanged(w, { id: 'c' }, today), null);
  assert.equal(watchChanged(w, { id: 'zzz' }, today), null);
  assert.equal(watchChanged(null, { id: 'a' }, today), null);
  assert.equal(watchChanged({ a: { changed_on: '2026-10-05' } }, { id: 'a' }, today), null);
});

test('applyDecision drops empty, undefined and false values; removes empty entries', () => {
  const all = { 7: { status: 'watching', registered: true, updated: '2026-01-01' } };
  const off = applyDecision(all, '7', d => ({ ...d, registered: false }), today);
  assert.deepEqual(off, { 7: { status: 'watching', updated: today } });
  const cleared = applyDecision(off, '7', d => ({ ...d, status: undefined }), today);
  assert.deepEqual(cleared, {});
  const on = applyDecision({}, 'intl-a', d => ({ ...d, registered: true }), today);
  assert.deepEqual(on, { 'intl-a': { registered: true, updated: today } });
  assert.deepEqual(all, { 7: { status: 'watching', registered: true, updated: '2026-01-01' } });
});

test('needsFullRender: entering/skipped transitions or registered change', () => {
  const v = (status = '', registered = false) => ({ status, note: '', registered });
  assert.equal(needsFullRender(v(''), v('watching')), false);
  assert.equal(needsFullRender(v('watching'), v('entering')), true);
  assert.equal(needsFullRender(v('skipped'), v('')), true);
  assert.equal(needsFullRender(v('watching', false), v('watching', true)), true);
  assert.equal(needsFullRender(v('entering'), v('entering')), false);
  assert.deepEqual(decisionView({ 3: { status: 'watching', note: 'x', registered: true } }, 3), { status: 'watching', note: 'x', registered: true });
  assert.deepEqual(decisionView({}, 3), { status: '', note: '', registered: false });
});

test('tier labels: national institutes, and the relabelled B-school / top college', () => {
  assert.equal(TIERS.national, 'NIT / IIIT / national institutes');
  assert.equal(TIERS.bschool, 'B-school / top college');
  assert.deepEqual(Object.keys(TIERS), ['iit', 'iim', 'national', 'bschool', 'corporate', 'international', 'other']);
});

test('visible: a national-tier business event is on the Board by default', () => {
  const f = { tiers: new Set(BOARD_TIERS), verdicts: new Set(['fits', 'check']), statuses: new Set(['undecided', 'watching', 'entering']),
    registeredOnly: false, showClosed: false, showOtherFormats: false, startups: false, query: '' };
  assert.equal(visible({ id: 1, tier: 'national', is_case: true, format_kind: 'business', verdict: { level: 'fits' } }, f, {}), true);
  assert.equal(visible({ id: 2, tier: 'national', is_case: false, format_kind: 'other', verdict: { level: 'fits' } }, f, {}), false);
});
