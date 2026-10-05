import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthCells, addMonths, weekStart, calendarEvents, eventsByDay, clashDays, agendaGroups,
  expectedItems, expectedMarkers, toneOf, statusLabel, monthTitle, groupByDay,
} from '../lib/calendar.js';

const today = '2026-09-29'; // a Tuesday

test('monthCells: 42 days from the Monday on or before the 1st', () => {
  const oct = monthCells(2026, 10); // Oct 1 2026 is a Thursday
  assert.equal(oct.length, 42);
  assert.equal(oct[0], '2026-09-28');
  assert.equal(oct[3], '2026-10-01');
  assert.equal(oct[41], '2026-11-08');
});

test('monthCells: a month starting on a Sunday starts six days back', () => {
  const nov = monthCells(2026, 11); // Nov 1 2026 is a Sunday
  assert.equal(nov[0], '2026-10-26');
  assert.equal(nov[6], '2026-11-01');
  assert.equal(nov[41], '2026-12-06');
});

test('monthCells: February 2027 starts on its Monday and runs into March', () => {
  const feb = monthCells(2027, 2);
  assert.equal(feb[0], '2027-02-01');
  assert.equal(feb[27], '2027-02-28');
  assert.equal(feb[28], '2027-03-01');
  assert.equal(feb[41], '2027-03-14');
  assert.equal(feb.filter(d => d.startsWith('2027-02')).length, 28);
});

test('monthCells: every row starts on a Monday', () => {
  for (const [y, m] of [[2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2]]) {
    const cells = monthCells(y, m);
    for (let i = 0; i < 42; i += 7) assert.equal(new Date(`${cells[i]}T00:00:00Z`).getUTCDay(), 1);
  }
});

test('addMonths steps across the year both ways', () => {
  assert.deepEqual(addMonths(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths(2027, 1, -1), { year: 2026, month: 12 });
  assert.deepEqual(addMonths(2026, 10, 0), { year: 2026, month: 10 });
  assert.deepEqual(addMonths(2026, 11, 14), { year: 2028, month: 1 });
  assert.equal(monthCells(2027, 1)[0], '2026-12-28'); // Jan 1 2027 is a Friday
});

test('monthTitle', () => {
  assert.equal(monthTitle(2027, 2), 'February 2027');
});

test('weekStart is the Monday of the week', () => {
  assert.equal(weekStart('2026-09-29'), '2026-09-28');
  assert.equal(weekStart('2026-09-28'), '2026-09-28');
  assert.equal(weekStart('2026-10-04'), '2026-09-28'); // Sunday
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
});

const recs = [
  { id: 1, title: 'Alpha', host: 'IIM A', regn_close: '2026-10-05', comp_end: '2026-10-20' },
  { id: 2, title: 'Beta', host: 'IIT B', regn_close: '2026-10-06', comp_end: '2026-10-06' },
  { id: 'intl-x', title: 'Gamma', host: 'Queens', regn_close: null, comp_end: '2026-10-30' },
  { id: 4, title: 'Skipped', regn_close: '2026-10-05' },
  { id: 5, title: 'Undecided', regn_close: '2026-10-05' },
  { id: 6, title: 'Skipped but registered', regn_close: '2026-12-01' },
];
const dec = {
  1: { status: 'entering' },
  2: { status: 'watching', registered: true },
  'intl-x': { status: 'watching' },
  4: { status: 'skipped' },
  6: { status: 'skipped', registered: true },
};

test('toneOf and statusLabel: registered wins, then entering, else watching', () => {
  assert.equal(toneOf(dec, recs[0]), 'ent');
  assert.equal(toneOf(dec, recs[1]), 'reg');
  assert.equal(toneOf(dec, recs[2]), 'wat');
  assert.equal(statusLabel(dec, recs[1]), 'Registered');
  assert.equal(statusLabel(dec, recs[0]), 'Entering');
  assert.equal(statusLabel(dec, recs[2]), 'Watching');
});

test('calendarEvents: watching, entering or registered; ⏰ close and 🏁 end only when different', () => {
  const ev = calendarEvents(recs, dec);
  assert.deepEqual(ev.map(e => [e.date, e.kind, String(e.id)]), [
    ['2026-10-05', 'close', '1'],
    ['2026-10-06', 'close', '2'],
    ['2026-10-20', 'end', '1'],
    ['2026-10-30', 'end', 'intl-x'],
    ['2026-12-01', 'close', '6'],
  ]);
  assert.equal(ev[0].tone, 'ent');
  assert.equal(ev[4].tone, 'reg');
});

test('eventsByDay groups by date', () => {
  const m = eventsByDay(recs, dec);
  assert.equal(m.get('2026-10-05').length, 1);
  assert.equal(m.get('2026-10-06')[0].title, 'Beta');
  assert.equal(m.has('2026-10-07'), false);
});

test('eventsByDay ignores malformed dates', () => {
  const m = eventsByDay([{ id: 9, title: 'Bad', regn_close: 'soon' }], { 9: { status: 'watching' } });
  assert.equal(m.size, 0);
});

test('clashDays: both dates of a committed pair within 7 days are marked, with the pair and the gap', () => {
  const committed = [recs[0], recs[1]]; // Alpha 10-05/10-20, Beta 10-06
  const { days, pairs } = clashDays(committed, today);
  assert.deepEqual([...days].sort(), ['2026-10-05', '2026-10-06']);
  assert.deepEqual(pairs.get('2026-10-05'), [{ id: 1, title: 'Alpha', otherId: 2, other: 'Beta', apart: 1 }]);
  assert.deepEqual(pairs.get('2026-10-06'), [{ id: 2, title: 'Beta', otherId: 1, other: 'Alpha', apart: 1 }]);
});

test('clashDays: exactly 7 days is a clash, 8 is not', () => {
  const a = { id: 'a', title: 'A', regn_close: '2026-10-01' };
  assert.equal(clashDays([a, { id: 'b', title: 'B', regn_close: '2026-10-08' }], today).days.size, 2);
  assert.equal(clashDays([a, { id: 'b', title: 'B', regn_close: '2026-10-09' }], today).days.size, 0);
});

test('clashDays: an item whose last date has passed no longer clashes', () => {
  const past = { id: 'p', title: 'Past', regn_close: '2026-09-20' };
  const live = { id: 'l', title: 'Live', regn_close: '2026-09-26', comp_end: '2026-10-10' };
  assert.equal(clashDays([past, live], today).days.size, 0);
});

test('clashDays: string and number ids of the same item are one item', () => {
  const r = { id: 7, title: 'Same', regn_close: '2026-10-05' };
  assert.equal(clashDays([r, { ...r, id: '7' }], today).days.size, 0);
});

test('agendaGroups: today onward, Monday weeks, This week / Next week / Week of', () => {
  const ev = calendarEvents([
    { id: 1, title: 'Old', regn_close: '2026-09-28' },
    { id: 2, title: 'Today', regn_close: '2026-09-29' },
    { id: 3, title: 'Sunday', regn_close: '2026-10-04' },
    { id: 4, title: 'Next Mon', regn_close: '2026-10-05' },
    { id: 5, title: 'Later', regn_close: '2026-10-21' },
    { id: 6, title: 'New year', regn_close: '2027-01-02' },
  ], Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [i, { status: 'watching' }])));
  const g = agendaGroups(ev, today);
  assert.deepEqual(g.map(x => x.label), ['This week', 'Next week', 'Week of 19 Oct', 'Week of 28 Dec']);
  assert.deepEqual(g[0].events.map(e => e.title), ['Today', 'Sunday']);
  assert.equal(g[3].week, '2026-12-28');
});

test('agendaGroups: a week in another year names the year', () => {
  const ev = calendarEvents([{ id: 1, title: 'Far', regn_close: '2027-01-12' }], { 1: { status: 'watching' } });
  assert.equal(agendaGroups(ev, today)[0].label, 'Week of 11 Jan 2027');
});

test('agendaGroups: nothing ahead gives no groups', () => {
  assert.deepEqual(agendaGroups([], today), []);
});

const curated = (id, extra) => ({
  id, title: id.toUpperCase(), host: 'H', source: 'curated', regn_close: null, comp_end: null,
  intl: { who_applies: 'school', indian_ug: 'unclear' }, ...extra,
});

test('expectedItems: status or registered, or directly enterable; no confirmed dates; not skipped', () => {
  const list = [
    curated('intl-open', { intl: { who_applies: 'team', indian_ug: 'yes' }, expected: { application_months: [10], finals_months: [1] } }),
    curated('intl-school', { expected: { application_months: [9], finals_months: [2] } }),
    curated('intl-watched', { expected: { application_months: null, finals_months: [3] } }),
    curated('intl-dated', { intl: { who_applies: 'team', indian_ug: 'yes' }, regn_close: '2026-11-01', expected: { application_months: [10], finals_months: null } }),
    curated('intl-none', { intl: { who_applies: 'team', indian_ug: 'yes' }, expected: { application_months: null, finals_months: null } }),
    curated('intl-skip', { intl: { who_applies: 'team', indian_ug: 'yes' }, expected: { application_months: [10], finals_months: null } }),
    { id: 99, title: 'Unstop', regn_close: null, expected: { application_months: [10] } },
  ];
  const d = { 'intl-watched': { status: 'watching' }, 'intl-skip': { status: 'skipped' } };
  assert.deepEqual(expectedItems(list, d).map(c => c.id), ['intl-open', 'intl-watched']);
});

test('expectedMarkers: on the 1st of the displayed month only; null months give none', () => {
  const list = [
    curated('intl-a', { intl: { who_applies: 'team', indian_ug: 'yes' }, expected: { application_months: [10, 11], finals_months: [1] } }),
    curated('intl-b', { expected: { application_months: null, finals_months: [10] } }),
  ];
  const d = { 'intl-b': { registered: true } };
  assert.deepEqual(expectedMarkers(list, d, 2026, 10).map(m => [m.date, m.kind, m.id, m.label, m.tone]), [
    ['2026-10-01', 'applications', 'intl-a', 'Applications usually open: INTL-A', 'exp'],
    ['2026-10-01', 'finals', 'intl-b', 'Finals usually: INTL-B', 'reg'],
  ]);
  assert.deepEqual(expectedMarkers(list, d, 2027, 1).map(m => [m.date, m.kind]), [['2027-01-01', 'finals']]);
  assert.deepEqual(expectedMarkers(list, d, 2026, 12), []);
});

test('clashDays: items sharing team_of (a round and its competition) never clash with each other', () => {
  const comp = { id: 101, title: 'Alpha', regn_close: '2026-10-10' };
  const own = { id: 'round-r1', title: 'Deck (Alpha)', regn_close: '2026-10-09', team_of: '101' };
  const sib = { id: 'round-r2', title: 'Video (Alpha)', regn_close: '2026-10-11', team_of: '101' };
  assert.equal(clashDays([comp, own, sib], today).days.size, 0);
  const other = { id: 202, title: 'Beta', regn_close: '2026-10-12' };
  const { days, pairs } = clashDays([comp, own, other], today);
  assert.ok(days.has('2026-10-09'));
  assert.deepEqual(pairs.get('2026-10-09').map(p => [p.id, p.otherId]), [['round-r1', 202]]);
});

test('groupByDay groups any dated events', () => {
  const m = groupByDay([{ date: '2026-10-01', t: 1 }, { date: '2026-10-01', t: 2 }, { date: '2026-10-02', t: 3 }]);
  assert.deepEqual([...m.keys()], ['2026-10-01', '2026-10-02']);
  assert.equal(m.get('2026-10-01').length, 2);
});
