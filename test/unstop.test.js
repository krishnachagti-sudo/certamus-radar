import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchAll, normalise, stripHtml } from '../fetch/unstop.js';

const detailFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/detail-1759741.json', import.meta.url)));

const item = (id, over = {}) => ({
  id, title: `Comp ${id}`, updated_at: '2026-09-25T10:00:00+05:30', end_date: '2026-11-09T21:25:00+05:30',
  organisation: { name: 'Indian Institute of Management (IIM), Raipur' },
  regnRequirements: { min_team_size: 2, max_team_size: 4, end_regn_dt: '2026-11-09T21:25:00+05:30', eligibility: '{"others":["all"]}' },
  filters: [{ name: 'All', type: 'eligible' }], prizes: [{ cash: 1000 }], isPaid: false, region: 'online',
  seo_url: `https://unstop.com/competitions/comp--${id}`, ...over,
});
const detailOf = (it, html = '<p>Open to all.</p>') => ({ data: { competition: { ...it, isPaid: undefined, paid: 0, details: html } } });

function fakeHttp(routes) {
  const calls = [];
  return {
    calls,
    getJson: async url => {
      calls.push(url);
      for (const [needle, body] of routes) {
        if (url.includes(needle)) {
          if (body instanceof Error) throw body;
          return body;
        }
      }
      throw new Error(`unrouted ${url}`);
    },
  };
}
const opts = (http, over = {}) => ({ keywords: ['case'], getJson: http.getJson, pause: async () => {}, wantDetail: () => true, ...over });

test('stripHtml keeps text and line breaks', () => {
  assert.equal(stripHtml('<p>Open&nbsp;to <b>all</b></p><p>Teams &amp; solo</p>'), 'Open to all\nTeams & solo');
});

test('normalise builds a record from the real detail payload alone', () => {
  const c = detailFixture.data.competition;
  const r = normalise(c, c);
  assert.equal(r.id, 1759741);
  assert.match(r.title, /Ops-Essentia/);
  assert.equal(r.host, 'Indian Institute of Management (IIM), Raipur');
  assert.equal(r.team_min, 2);
  assert.equal(r.team_max, 3);
  assert.equal(r.regn_close, '2026-11-09');
  assert.equal(r.prize_total, 20000);
  assert.equal(r.fee, false);
  assert.equal(r.mode, 'online');
  assert.equal(r.details_fetched, true);
  assert.ok(r.details_text.length > 20);
  assert.ok(r.eligibility && typeof r.eligibility === 'object');
});

test('new ids get a detail call, unchanged ones carry forward', async () => {
  const it = item(1);
  const http = fakeHttp([['search-result', { data: { data: [it] } }], ['competition/1', detailOf(it)]]);
  const first = await fetchAll(new Map(), [], opts(http));
  assert.equal(first.records[0].details_text, 'Open to all.');
  assert.equal(http.calls.filter(u => u.includes('competition/1')).length, 1);

  const prev = new Map([[1, first.records[0]]]);
  const again = await fetchAll(prev, [], opts(http));
  assert.equal(http.calls.filter(u => u.includes('competition/1')).length, 1, 'no second detail call');
  assert.equal(again.records[0].details_text, 'Open to all.');

  const moved = item(1, { regnRequirements: { ...it.regnRequirements, end_regn_dt: '2026-11-20T21:25:00+05:30' } });
  const http2 = fakeHttp([['search-result', { data: { data: [moved] } }], ['competition/1', detailOf(moved)]]);
  await fetchAll(prev, [], opts(http2));
  assert.equal(http2.calls.filter(u => u.includes('competition/1')).length, 1, 'deadline change refetches');

  for (const over of [{ updated_at: '2026-09-27T10:00:00+05:30' }, { end_date: '2026-11-30T21:25:00+05:30' }]) {
    const edited = item(1, over);
    const h = fakeHttp([['search-result', { data: { data: [edited] } }], ['competition/1', detailOf(edited)]]);
    await fetchAll(prev, [], opts(h));
    assert.equal(h.calls.filter(u => u.includes('competition/1')).length, 1, `${Object.keys(over)[0]} change refetches`);
  }
});

test('pages by last_page, not by a short page', async () => {
  const http = fakeHttp([
    ['page=1&', { data: { data: [item(1)], last_page: 2 } }],
    ['page=2&', { data: { data: [item(2)], last_page: 2 } }],
    ['competition/', { data: { competition: { id: 1, details: '' } } }],
  ]);
  const { records } = await fetchAll(new Map(), [], opts(http, { wantDetail: () => false }));
  assert.deepEqual(records.map(r => r.id).sort(), [1, 2]);
  assert.equal(http.calls.filter(u => u.includes('search-result')).length, 2);
});

test('wantDetail=false skips the detail call', async () => {
  const http = fakeHttp([['search-result', { data: { data: [item(1)] } }]]);
  const { records } = await fetchAll(new Map(), [], opts(http, { wantDetail: () => false }));
  assert.equal(records[0].details_fetched, false);
});

test('manual ids missing from search are built from detail and pinned', async () => {
  const m = item(9);
  const http = fakeHttp([['search-result', { data: { data: [item(1)] } }], ['competition/1', detailOf(item(1))], ['competition/9', detailOf(m)]]);
  const { records } = await fetchAll(new Map(), [9], opts(http));
  const r9 = records.find(r => r.id === 9);
  assert.equal(r9.pinned, true);
  assert.equal(r9.host, 'Indian Institute of Management (IIM), Raipur');
  assert.equal(records.find(r => r.id === 1).pinned, false);
});

test('a failing manual detail keeps the stored record and warns', async () => {
  const stored = { id: 9, title: 'Kept', pinned: true };
  const http = fakeHttp([['search-result', { data: { data: [item(1)] } }], ['competition/1', detailOf(item(1))], ['competition/9', new Error('404')]]);
  const { records, warnings } = await fetchAll(new Map([[9, stored]]), [9], opts(http));
  assert.equal(records.find(r => r.id === 9).title, 'Kept');
  assert.match(warnings.join(' '), /9/);
});

test('a failing detail call does not throw', async () => {
  const http = fakeHttp([['search-result', { data: { data: [item(1)] } }], ['competition/1', new Error('500')]]);
  const { records, warnings } = await fetchAll(new Map(), [], opts(http));
  assert.equal(records[0].details_fetched, false);
  assert.equal(warnings.length, 1);
});

test('search shape change and empty results throw', async () => {
  await assert.rejects(fetchAll(new Map(), [], opts(fakeHttp([['search-result', { data: {} }]]))), /shape/);
  await assert.rejects(fetchAll(new Map(), [], opts(fakeHttp([['search-result', { data: { data: [] } }]]))), /no competitions/);
});

test('a malformed item is skipped with a warning', async () => {
  const http = fakeHttp([['search-result', { data: { data: [item(1), { id: 2 }] } }], ['competition/1', detailOf(item(1))]]);
  const { records, warnings } = await fetchAll(new Map(), [], opts(http));
  assert.deepEqual(records.map(r => r.id), [1]);
  assert.equal(warnings.length, 1);
});
