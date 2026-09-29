import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostRows, archiveList } from '../lib/hosts.js';

const live = (over = {}) => ({
  id: 1, title: 'Case Comp', host: 'IIM Rohtak', tier: 'iim',
  regn_close: '2026-10-15', first_seen: '2026-09-01', comp_end: '2026-10-25',
  url: 'https://unstop.com/x', format: 'case_competition', is_case: true, closed_on: null,
  ...over,
});

const curatedRow = (over = {}) => ({
  id: 'intl-icbc', name: 'ICBC', host: 'Queen’s University', kind: 'case',
  application_months: [10], finals_months: [1], verified: true,
  ...over,
});

// ---- hostRows ---------------------------------------------------------

test('hostRows: one row per host, deduped across live, archive and curated', () => {
  const rows = hostRows(
    [live({ id: 1 }), live({ id: 2, title: 'Case Comp 2', regn_close: '2026-11-01' })],
    [{ id: 3, title: 'Old Comp', host: 'IIM Rohtak', tier: 'iim', regn_close: '2026-01-10', closed_on: '2026-01-20' }],
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].host, 'IIM Rohtak');
  assert.equal(rows[0].count, 3);
});

test('hostRows: host names differing only in case or whitespace are normalised', () => {
  const rows = hostRows(
    [live({ id: 1, host: '  IIM   Rohtak ' }), live({ id: 2, host: 'iim rohtak', title: 'Second' })],
    [],
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
});

test('hostRows: months come from regn_close, falling back to first_seen', () => {
  const rows = hostRows(
    [live({ id: 1, regn_close: '2026-10-15', first_seen: '2026-09-01' }),
      live({ id: 2, host: 'IIM Rohtak', title: 'No deadline', regn_close: null, first_seen: '2026-05-01' })],
    [],
    [],
  );
  assert.deepEqual(rows[0].months, [5, 10]);
});

test('hostRows: curated records take their months from finals_months', () => {
  const rows = hostRows([], [], [curatedRow()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, 'international');
  assert.deepEqual(rows[0].months, [1]);
  assert.equal(rows[0].latestTitle, 'ICBC');
  assert.equal(rows[0].latestId, 'intl-icbc');
});

test('hostRows: a curated record already merged into competitions.json is not double-counted against the curated list', () => {
  const mergedCurated = {
    id: 'intl-icbc', source: 'curated', format: 'curated', title: 'ICBC', host: 'Queen’s University',
    tier: 'international', regn_close: null, comp_end: null, first_seen: '2026-09-29', closed_on: null,
    expected: { application_months: [10], finals_months: [1] },
  };
  const rows = hostRows([mergedCurated], [], [curatedRow({ host: 'Queen’s University' })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 1);
  assert.deepEqual(rows[0].months, [1]);
});

test('hostRows: unverified curated rows are skipped', () => {
  const rows = hostRows([], [], [curatedRow({ verified: false })]);
  assert.equal(rows.length, 0);
});

test('hostRows: default sort is tier order then name', () => {
  const rows = hostRows(
    [
      live({ id: 1, host: 'Zeta Corp', tier: 'corporate' }),
      live({ id: 2, host: 'Alpha IIT', tier: 'iit' }),
      live({ id: 3, host: 'Beta IIT', tier: 'iit' }),
      live({ id: 4, host: 'Random Host', tier: 'other' }),
    ],
    [], [],
  );
  assert.deepEqual(rows.map(r => r.host), ['Alpha IIT', 'Beta IIT', 'Zeta Corp', 'Random Host']);
});

test('hostRows: latest title is the most recent by regn_close/first_seen', () => {
  const rows = hostRows(
    [live({ id: 1, title: 'Older', regn_close: '2026-09-01' }),
      live({ id: 2, host: 'IIM Rohtak', title: 'Newer', regn_close: '2026-11-01' })],
    [], [],
  );
  assert.equal(rows[0].latestTitle, 'Newer');
  assert.equal(rows[0].latestId, 2);
});

test('hostRows: empty inputs produce no rows', () => {
  assert.deepEqual(hostRows([], [], []), []);
  assert.deepEqual(hostRows(undefined, undefined, undefined), []);
});

// ---- archiveList --------------------------------------------------------

test('archiveList: live closed records and archive.json records combine', () => {
  const list = archiveList(
    [live({ id: 1, closed_on: '2026-09-10' }), live({ id: 2, closed_on: null })],
    [{ archive_key: '5', id: 5, title: 'Old One', host: 'IIT B', tier: 'iit', url: null, regn_close: null, comp_end: null, first_seen: '2026-01-01', closed_on: '2026-01-15', format: null, is_case: true }],
  );
  assert.equal(list.length, 2);
  assert.ok(list.some(r => r.id === 1));
  assert.ok(list.some(r => r.id === 5));
  assert.ok(!list.some(r => r.id === 2)); // not closed, not archived
});

test('archiveList: sorted newest closed_on first', () => {
  const list = archiveList(
    [live({ id: 1, closed_on: '2026-08-01' }), live({ id: 2, closed_on: '2026-09-20' })],
    [],
  );
  assert.deepEqual(list.map(r => r.id), [2, 1]);
});

test('archiveList: dedupes by id when the same record appears in both sources', () => {
  const list = archiveList(
    [live({ id: 1, closed_on: '2026-09-10' })],
    [{ archive_key: '1', id: 1, title: 'Case Comp', host: 'IIM Rohtak', tier: 'iim', url: null, regn_close: null, comp_end: null, first_seen: null, closed_on: '2026-09-10', format: null, is_case: true }],
  );
  assert.equal(list.length, 1);
});

test('archiveList: curated edition entries dedupe by archive_key, not bare id', () => {
  const archived = { archive_key: 'intl-icbc@2026-01-05', id: 'intl-icbc', title: 'ICBC', host: 'Queen’s', tier: 'international', url: null, regn_close: '2026-01-05', comp_end: null, first_seen: null, closed_on: '2026-01-06', format: 'curated', is_case: true };
  const liveClosed = { ...live({ id: 'intl-icbc', title: 'ICBC', host: 'Queen’s', tier: 'international' }), source: 'curated', regn_close: '2026-06-01', closed_on: '2026-06-02', format: 'curated' };
  const list = archiveList([liveClosed], [archived]);
  // Different editions (different regn_close) keep separate archive_key rows.
  assert.equal(list.length, 2);
  assert.ok(list.every(r => r.archive_key));
});

test('archiveList: empty inputs produce an empty list', () => {
  assert.deepEqual(archiveList([], []), []);
  assert.deepEqual(archiveList(undefined, undefined), []);
});

test('hostRows: tier order is iit, iim, national, bschool, corporate, international, other', () => {
  const tiers = ['other', 'international', 'corporate', 'bschool', 'national', 'iim', 'iit'];
  const rows = hostRows(tiers.map((tier, i) => live({ id: i + 1, host: `H${i}`, tier })), [], []);
  assert.deepEqual(rows.map(r => r.tier), ['iit', 'iim', 'national', 'bschool', 'corporate', 'international', 'other']);
});
