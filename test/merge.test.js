import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge as mergeFull, appendArchive } from '../fetch/merge.js';

const merge = (...a) => mergeFull(...a).next;

const today = '2026-10-01';
const r = (id, over = {}) => ({ id, title: `C${id}`, regn_close: '2026-10-20', comp_end: '2026-10-30', ...over });

test('first_seen is set once', () => {
  const a = merge([], [r(1)], {}, today);
  assert.equal(a[0].first_seen, today);
  const b = merge(a, [r(1)], {}, '2026-10-05');
  assert.equal(b[0].first_seen, today);
});

test('closed_on when absent or past deadline, cleared on reappearance', () => {
  const start = merge([], [r(1), r(2, { regn_close: '2026-09-30' })], {}, today);
  assert.equal(start.find(x => x.id === 2).closed_on, today);
  const gone = merge(start, [r(2, { regn_close: '2026-09-30' })], {}, '2026-10-02');
  assert.equal(gone.find(x => x.id === 1).closed_on, '2026-10-02');
  const back = merge(gone, [r(1)], {}, '2026-10-03');
  assert.equal(back.find(x => x.id === 1).closed_on, null);
});

test('closed records are pruned after 60 days', () => {
  const closed = [{ ...r(1), first_seen: '2026-07-01', closed_on: '2026-08-01' }];
  assert.equal(merge(closed, [], {}, '2026-09-30').length, 1);
  assert.equal(merge(closed, [], {}, '2026-10-01').length, 0);
});

test('entering records are kept until 60 days after comp_end', () => {
  const closed = [{ ...r(1, { comp_end: '2026-09-15' }), first_seen: '2026-07-01', closed_on: '2026-08-01' }];
  const dec = { 1: { status: 'entering' } };
  assert.equal(merge(closed, [], dec, '2026-11-14').length, 1);
  assert.equal(merge(closed, [], dec, '2026-11-15').length, 0);
});

test('output is sorted by registration close', () => {
  const out = merge([], [r(1, { regn_close: '2026-11-01' }), r(2, { regn_close: '2026-10-05' }), r(3, { regn_close: null })], {}, today);
  assert.deepEqual(out.map(x => x.id), [2, 1, 3]);
});

test('registered (not entering) records are kept until 60 days after comp_end', () => {
  const closed = [{ ...r(1, { comp_end: '2026-09-15' }), first_seen: '2026-07-01', closed_on: '2026-08-01' }];
  const dec = { 1: { registered: true } };
  assert.equal(merge(closed, [], dec, '2026-11-14').length, 1);
  assert.equal(merge(closed, [], dec, '2026-11-15').length, 0);
});

test('merge returns the pruned records separately', () => {
  const closed = [{ ...r(1), first_seen: '2026-07-01', closed_on: '2026-08-01' }, { ...r(2), first_seen: '2026-09-01', closed_on: null }];
  const { next, pruned } = mergeFull(closed, [r(2)], {}, '2026-10-01');
  assert.deepEqual(next.map(x => x.id), [2]);
  assert.deepEqual(pruned.map(x => x.id), [1]);
  assert.equal(pruned[0].closed_on, '2026-08-01');
});

test('committed anchor falls back to regn_close then closed_on', () => {
  const closed = [{ ...r(1, { comp_end: null, regn_close: '2026-09-01' }), first_seen: '2026-07-01', closed_on: '2026-08-01' }];
  const dec = { 1: { status: 'watching', registered: true } };
  assert.equal(merge(closed, [], dec, '2026-10-31').length, 1);
  assert.equal(merge(closed, [], dec, '2026-11-01').length, 0);
});

test('appendArchive keeps only slim fields and dedupes by id', () => {
  const rec = { ...r(1), host: 'H', tier: 'iim', url: 'https://unstop.com/x-1', first_seen: '2026-07-01', closed_on: '2026-08-01',
    format: 'case_competition', is_case: true, verdict: { level: 'fits', reasons: [] }, details_text: 'body', eligibility: {}, team_max: 4 };
  const once = appendArchive([], [rec]);
  assert.deepEqual(Object.keys(once[0]).sort(),
    ['archive_key', 'closed_on', 'comp_end', 'first_seen', 'format', 'host', 'id', 'is_case', 'regn_close', 'tier', 'title', 'url']);
  const twice = appendArchive(once, [rec, { ...rec, id: 2 }]);
  assert.deepEqual(twice.map(x => x.id), [1, 2]);
  assert.equal(appendArchive(twice, []), twice);
});

test('appendArchive dedupes across number and string ids', () => {
  const a = appendArchive([{ id: 1, title: 'x' }], [{ id: '1', title: 'x' }]);
  assert.equal(a.length, 1);
});

test('curated records are never pruned; each closed edition is returned for the archive', () => {
  const cur = { ...r('intl-a', { regn_close: '2026-08-01', comp_end: '2026-08-10' }), source: 'curated', first_seen: '2026-07-01', closed_on: '2026-08-02' };
  const { next, pruned } = mergeFull([cur], [{ ...cur }], {}, '2026-10-01'); // 61 days after closed_on
  assert.deepEqual(next.map(x => x.id), ['intl-a']);
  assert.deepEqual(pruned.map(x => x.id), ['intl-a']);
  const open = mergeFull([], [{ ...r('intl-b', { regn_close: '2026-12-01' }), source: 'curated' }], {}, today);
  assert.deepEqual(open.pruned, []);
  const undated = mergeFull([], [{ ...r('intl-c', { regn_close: null }), source: 'curated' }], {}, today);
  assert.deepEqual(undated.pruned, []);
});

test('appendArchive keys curated editions by id@regn_close and archives each once', () => {
  const ed = (regn_close) => ({ id: 'intl-a', source: 'curated', title: 'A', regn_close, closed_on: regn_close });
  let a = appendArchive([], [ed('2026-08-01')]);
  a = appendArchive(a, [ed('2026-08-01')]);
  a = appendArchive(a, [ed('2027-08-01')]);
  assert.deepEqual(a.map(x => x.archive_key), ['intl-a@2026-08-01', 'intl-a@2027-08-01']);
  const u = appendArchive([{ id: 5, title: 'old entry without key' }], [{ id: 5, title: 'x' }, { id: 6, title: 'y' }]);
  assert.deepEqual(u.map(x => x.id), [5, 6]);
  assert.equal(u[1].archive_key, '6');
});
