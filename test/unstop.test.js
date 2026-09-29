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
  seo_url: `https://unstop.com/competitions/comp--${id}`, details: '<p>Open to all.</p>', ...over,
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
const opts = (http, over = {}) => ({ keywords: ['case'], getJson: http.getJson, pause: async () => {}, ...over });

test('stripHtml keeps text and line breaks', () => {
  assert.equal(stripHtml('<p>Open&nbsp;to <b>all</b></p><p>Teams &amp; solo</p>'), 'Open to all\nTeams & solo');
});

test('stripHtml decodes numeric entities', () => {
  assert.equal(stripHtml('&#8377;100 &#x20B9;200'), '₹100 ₹200');
});

test('stripHtml does not throw on an out-of-range numeric entity', () => {
  assert.doesNotThrow(() => stripHtml('x &#99999999; y'));
});

test('stripHtml decodes named punctuation entities, and amp last', () => {
  assert.equal(stripHtml('A &ndash; B'), 'A – B');
  assert.equal(stripHtml('&amp;lt;'), '&lt;');
});

test('normalise builds a record from the real detail payload alone', () => {
  const c = detailFixture.data.competition;
  const r = normalise(c);
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

test('search items build their own record with zero detail calls', async () => {
  const it = item(1);
  const http = fakeHttp([['search-result', { data: { data: [it], last_page: 1 } }]]);
  const { records } = await fetchAll(new Map(), [], opts(http));
  assert.equal(records[0].details_text, 'Open to all.');
  assert.equal(records[0].details_fetched, true);
  assert.equal(http.calls.filter(u => u.includes('competition/')).length, 0);
});

test('hybrid region maps to mode hybrid', async () => {
  const it = item(1, { region: 'hybrid' });
  const http = fakeHttp([['search-result', { data: { data: [it], last_page: 1 } }]]);
  const { records } = await fetchAll(new Map(), [], opts(http));
  assert.equal(records[0].mode, 'hybrid');
});

test('eligibility given as an object passes through', async () => {
  const elig = { others: ['all'] };
  const base = item(1);
  const it = { ...base, regnRequirements: { ...base.regnRequirements, eligibility: elig } };
  const http = fakeHttp([['search-result', { data: { data: [it], last_page: 1 } }]]);
  const { records } = await fetchAll(new Map(), [], opts(http));
  assert.deepEqual(records[0].eligibility, elig);
});

test('manual id present in search is pinned and makes no detail call', async () => {
  const it = item(1);
  const http = fakeHttp([['search-result', { data: { data: [it], last_page: 1 } }]]);
  const { records } = await fetchAll(new Map(), [1], opts(http));
  assert.equal(records[0].pinned, true);
  assert.equal(http.calls.filter(u => u.includes('competition/')).length, 0);
});

test('duplicate manual ids produce one record and one detail call', async () => {
  const m = item(9);
  const http = fakeHttp([['search-result', { data: { data: [item(1)], last_page: 1 } }], ['competition/9', detailOf(m)]]);
  const { records } = await fetchAll(new Map(), [9, 9], opts(http));
  assert.equal(records.filter(r => r.id === 9).length, 1);
  assert.equal(http.calls.filter(u => u.includes('competition/9')).length, 1);
});

test('pages by last_page, not by a short page', async () => {
  const http = fakeHttp([
    ['page=1&', { data: { data: [item(1)], last_page: 2 } }],
    ['page=2&', { data: { data: [item(2)], last_page: 2 } }],
  ]);
  const { records } = await fetchAll(new Map(), [], opts(http));
  assert.deepEqual(records.map(r => r.id).sort(), [1, 2]);
  assert.equal(http.calls.filter(u => u.includes('search-result')).length, 2);
});

test('a page missing last_page warns and stops paging', async () => {
  const http = fakeHttp([['search-result', { data: { data: [item(1)] } }]]);
  const { records, warnings } = await fetchAll(new Map(), [], opts(http));
  assert.deepEqual(records.map(r => r.id), [1]);
  assert.match(warnings.join(' '), /no last_page/);
  assert.equal(http.calls.filter(u => u.includes('search-result')).length, 1);
});

test('a search item without details gives details_fetched false', async () => {
  const base = item(1);
  delete base.details;
  const http = fakeHttp([['search-result', { data: { data: [base], last_page: 1 } }]]);
  const { records } = await fetchAll(new Map(), [], opts(http));
  assert.equal(records[0].details_fetched, false);
});

test('the MAX_PAGES warning is pushed at most once per term', async () => {
  const http = fakeHttp([
    ['page=1&', { data: { data: [item(1)], last_page: 99 } }],
    ['page=', { data: { data: [item(2)], last_page: 99 } }],
  ]);
  const { warnings } = await fetchAll(new Map(), [], opts(http));
  const maxPageWarnings = warnings.filter(w => w.includes('exceeds MAX_PAGES'));
  assert.equal(maxPageWarnings.length, 1);
});

test('manual ids missing from search are built from detail and pinned', async () => {
  const m = item(9);
  const http = fakeHttp([['search-result', { data: { data: [item(1)], last_page: 1 } }], ['competition/9', detailOf(m)]]);
  const { records } = await fetchAll(new Map(), [9], opts(http));
  const r9 = records.find(r => r.id === 9);
  assert.equal(r9.pinned, true);
  assert.equal(r9.host, 'Indian Institute of Management (IIM), Raipur');
  assert.equal(records.find(r => r.id === 1).pinned, false);
});

test('a failing manual detail keeps the stored record and warns', async () => {
  const stored = { id: 9, title: 'Kept', pinned: true };
  const http = fakeHttp([['search-result', { data: { data: [item(1)], last_page: 1 } }], ['competition/9', new Error('404')]]);
  const { records, warnings } = await fetchAll(new Map([[9, stored]]), [9], opts(http));
  const r9 = records.find(r => r.id === 9);
  assert.equal(r9.title, 'Kept');
  assert.notEqual(r9, stored, 'pushes a copy, not the stored object itself');
  assert.match(warnings.join(' '), /9/);
});

test('search shape change and empty results throw', async () => {
  await assert.rejects(fetchAll(new Map(), [], opts(fakeHttp([['search-result', { data: {} }]]))), /shape/);
  await assert.rejects(fetchAll(new Map(), [], opts(fakeHttp([['search-result', { data: { data: [] } }]]))), /no competitions/);
});

test('a malformed item is skipped with a warning', async () => {
  const http = fakeHttp([['search-result', { data: { data: [item(1), { id: 2 }], last_page: 1 } }]]);
  const { records, warnings } = await fetchAll(new Map(), [], opts(http));
  assert.deepEqual(records.map(r => r.id), [1]);
  assert.equal(warnings.length, 1);
});
