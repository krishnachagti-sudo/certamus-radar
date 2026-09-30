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
const opts = (http, over = {}) => ({ getJson: http.getJson, pause: async () => {}, ...over });

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
    ['&page=1', { data: { data: [item(1)], last_page: 2 } }],
    ['&page=2', { data: { data: [item(2)], last_page: 2 } }],
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

test('the MAX_PAGES warning is pushed once and paging stops at 60', async () => {
  const http = fakeHttp([
    ['&page=1', { data: { data: [item(1)], last_page: 99 } }],
    ['page=', { data: { data: [item(2)], last_page: 99 } }],
  ]);
  const { warnings } = await fetchAll(new Map(), [], opts(http));
  const maxPageWarnings = warnings.filter(w => w.includes('exceeds MAX_PAGES'));
  assert.equal(maxPageWarnings.length, 1);
  assert.equal(http.calls.filter(u => u.includes('search-result')).length, 60);
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

test('is_case: case_competition subtype is true', () => {
  const r = normalise(item(1, { subtype: 'case_competition', title: 'Anything' }));
  assert.equal(r.is_case, true);
  assert.equal(r.format, 'case_competition');
});

test('is_case: "CaseBlitz 2026" with no subtype is true', () => {
  const r = normalise(item(1, { title: 'CaseBlitz 2026', subtype: undefined }));
  assert.equal(r.is_case, true);
});

test('is_case: type quizzes is false', () => {
  const r = normalise(item(1, { type: 'quizzes', title: 'Case Quiz 2026' }));
  assert.equal(r.is_case, false);
  assert.equal(r.format, 'quizzes');
});

test('is_case: "Call for Articles: X" is false', () => {
  const r = normalise(item(1, { title: 'Call for Articles: X', subtype: undefined }));
  assert.equal(r.is_case, false);
});

test('is_case: "Consulting Consortium 2026" with subtype general_competition is true', () => {
  const r = normalise(item(1, { title: 'Consulting Consortium 2026', subtype: 'general_competition' }));
  assert.equal(r.is_case, true);
  assert.equal(r.format, 'general_competition');
});

test('is_case: subtype online_coding_challenge is false', () => {
  const r = normalise(item(1, { subtype: 'online_coding_challenge', title: 'Strategy Hack' }));
  assert.equal(r.is_case, false);
});

test('is_case: subtype case_competition with "Call for Articles" title is false', () => {
  const r = normalise(item(1, { subtype: 'case_competition', title: 'Call for Articles: X' }));
  assert.equal(r.is_case, false);
});

test('a search that fails once and then succeeds gives records', async () => {
  let calls = 0;
  const getJson = async url => {
    if (url.includes('search-result')) {
      calls++;
      if (calls === 1) throw new Error('fail once');
      return { data: { data: [item(1)], last_page: 1 } };
    }
    throw new Error(`unrouted ${url}`);
  };
  const { records } = await fetchAll(new Map(), [], { getJson, pause: async () => {}, backoff: 0 });
  assert.deepEqual(records.map(r => r.id), [1]);
  assert.equal(calls, 2);
});

test('a search that fails twice rejects', async () => {
  const getJson = async () => { throw new Error('down'); };
  await assert.rejects(
    fetchAll(new Map(), [], { getJson, pause: async () => {}, backoff: 0 }),
    /down/
  );
});

test('a javascript: seo_url falls back to the canonical Unstop url', () => {
  const r = normalise(item(5, { seo_url: 'javascript:alert(1)' }));
  assert.equal(r.url, 'https://unstop.com/competitions/5');
});

test('seo_url on another host or over http falls back', () => {
  assert.equal(normalise(item(5, { seo_url: 'https://unstop.com.evil.test/x-5' })).url, 'https://unstop.com/competitions/5');
  assert.equal(normalise(item(5, { seo_url: 'http://unstop.com/x-5' })).url, 'https://unstop.com/competitions/5');
  assert.equal(normalise(item(5, { seo_url: 'not a url' })).url, 'https://unstop.com/competitions/5');
  assert.equal(normalise(item(5, { seo_url: 'https://www.unstop.com/x-5' })).url, 'https://www.unstop.com/x-5');
});

test('an item with a non-integer id is skipped as malformed', async () => {
  const bad = item('1" onmouseover="x');
  const http = fakeHttp([['search-result', { data: { data: [item(1), bad, item(2.5)], last_page: 1 } }]]);
  const { records, warnings } = await fetchAll(new Map(), [], opts(http));
  assert.deepEqual(records.map(r => r.id), [1]);
  assert.equal(warnings.filter(w => w.startsWith('skipped malformed')).length, 2);
});

// ---- full scan -------------------------------------------------------------

test('full scan: one unfiltered search of all open competitions, no search term', async () => {
  const http = fakeHttp([['search-result', { data: { data: [item(1)], last_page: 1 } }]]);
  await fetchAll(new Map(), [], opts(http));
  const url = new URL(http.calls[0]);
  assert.equal(url.origin + url.pathname, 'https://unstop.com/api/public/opportunity/search-result');
  assert.equal(url.searchParams.get('opportunity'), 'competitions');
  assert.equal(url.searchParams.get('oppstatus'), 'open');
  assert.equal(url.searchParams.get('per_page'), '30');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.has('searchTerm'), false);
});

test('full scan: walks every page up to last_page (23 pages today), pausing after each', async () => {
  let pauses = 0;
  const http = fakeHttp([['search-result', null]]);
  const getJson = async u => {
    http.calls.push(u);
    const page = Number(new URL(u).searchParams.get('page'));
    return { data: { data: [item(page)], last_page: 23 } };
  };
  const { records } = await fetchAll(new Map(), [], { getJson, pause: async () => { pauses++; } });
  assert.equal(http.calls.length, 23);
  assert.equal(records.length, 23);
  assert.equal(pauses, 23);
  assert.deepEqual(http.calls.map(u => new URL(u).searchParams.get('page')), Array.from({ length: 23 }, (_, i) => String(i + 1)));
});

test('full scan: an item repeated on two pages is one record', async () => {
  const http = fakeHttp([
    ['&page=1', { data: { data: [item(1), item(2)], last_page: 2 } }],
    ['&page=2', { data: { data: [item(2), item(3)], last_page: 2 } }],
  ]);
  const { records } = await fetchAll(new Map(), [], opts(http));
  assert.deepEqual(records.map(r => r.id).sort(), [1, 2, 3]);
});

test('full scan: a keywords option is ignored (one scan, not one per term)', async () => {
  const http = fakeHttp([['search-result', { data: { data: [item(1)], last_page: 1 } }]]);
  await fetchAll(new Map(), [], opts(http, { keywords: ['case', 'strategy'] }));
  assert.equal(http.calls.length, 1);
});

// ---- format_kind -----------------------------------------------------------

const kind = over => normalise(item(1, { type: 'competitions', subtype: 'general_competition', ...over }));
const kindOf = over => kind({ ...IITB, ...over }).format_kind;
const XLRI = { organisation: { name: 'Xavier School of Management (XLRI)' } };
const NITU = { organisation: { name: 'National Institute of Technology (NIT), Uttarakhand' } };
const IITB = { organisation: { name: 'Indian Institute of Technology (IIT), Bombay' } };

test('format_kind case: case_competition subtype, whatever the title', () => {
  assert.equal(kindOf({ subtype: 'case_competition', title: 'Thrive - The Sustainability Solutions Challenge' }), 'case');
  assert.equal(kindOf({ subtype: 'case_competition', title: 'Strike or Yield - Industrial Relations Flagship Event 2026', ...XLRI }), 'case');
});

test('format_kind case: case/consult/strategy/teardown/war room/LIME/crucible titles', () => {
  for (const title of ['CaseWave - Beyond the Case', 'Strategikon - Consulting Flagship Event 2026', 'Strategy-Wiz',
    'Product Teardown 2026', 'The War Room 2026', 'HUL L.I.M.E. Season 17', 'Tata Crucible 2026']) {
    assert.equal(kindOf({ title }), 'case', title);
  }
});

test('format_kind business: business-event titles', () => {
  for (const title of ['B-Plan', 'Elevator Pitch Night', 'The Grand Pitch Season 5', 'Sankalp Ideathon', 'Bid & Build',
    'Bid It Like Beckham 2026', 'BrandStorm Marketing Mela', 'Pirates of the Portfolio: A Finance & Investment Competition',
    'War of Wits - HR Flagship', 'Ops Olympus: Operations Challenge', 'Policy Dilemma', 'Product Management Sprint',
    'Analytics Challenge 2026', 'Stock Analysis - October 2026', 'Trading Arena', 'EraPreneur: Building Beyond Time',
    'Entrepreneurship Summit Challenge', 'Thrive - The Sustainability Solutions Challenge', 'The M&A Championship 4.0',
    'Venture Vortex', 'Biz-Wars', 'Equity Auction', 'Business & People Challenge', 'Impact Tank', 'Monopoly Moves']) {
    assert.equal(kindOf({ title }), 'business', title);
  }
});

test('format_kind business: a flagship event at a B-school, not at a tech fest', () => {
  assert.equal(kindOf({ title: 'Helios: Flagship Operations Event-2026', ...XLRI }), 'business');
  assert.equal(kindOf({ title: 'Genesis Flagship', ...XLRI }), 'business');
  assert.equal(kindOf({ title: 'Genesis Flagship', ...IITB }), 'other');
});

test('format_kind business: any other competition at a management school leans in', () => {
  assert.equal(kindOf({ title: "Tycoon's Gambit 2026", ...XLRI }), 'business');
  assert.equal(kindOf({ title: 'Time Turner 2026', organisation: { name: 'Indian Institute of Management (IIM), Indore' } }), 'business');
  assert.equal(kindOf({ title: 'Time Turner 2026', ...IITB }), 'other');
});

test('format_kind business: innovation_challenge only when the title is business-flavoured', () => {
  assert.equal(kindOf({ subtype: 'innovation_challenge', title: 'B-Plan', ...IITB }), 'business');
  assert.equal(kindOf({ subtype: 'innovation_challenge', title: 'Maze Runner', ...IITB }), 'other');
  assert.equal(kindOf({ subtype: 'innovation_challenge', title: 'TinkerCase 4.0', ...IITB }), 'other');
});

test('format_kind other: quizzes, hackathons and coding challenges by type/subtype', () => {
  assert.equal(kindOf({ type: 'quizzes', subtype: null, title: 'Business Quiz' }), 'other');
  assert.equal(kindOf({ type: 'quizzes', subtype: 'general_competition', title: 'Back To The Roots-2026', ...XLRI }), 'other');
  assert.equal(kindOf({ type: 'hackathons', subtype: 'online_coding_challenge', title: 'FinTech Pitch Hack' }), 'other');
  assert.equal(kindOf({ type: 'hackathons', subtype: 'general_competition', title: 'Marketing Hack', ...XLRI }), 'other');
  assert.equal(kindOf({ subtype: 'online_coding_challenge', title: 'Strategy Hack' }), 'other');
});

test('format_kind other: tech-fest and non-business titles, even at a B-school', () => {
  for (const title of ['Robo Soccer - Flagship', 'RoboWars', 'Steel War - ROBOWARS', 'OLL Robotics Championship',
    'Hackathon - Flagship', 'The Golden Hour - A Voice AI Hackathon', 'Code Auditor', 'Cipher Chase — Capture the Flag',
    "Tenet'26 CTF", 'Game Jam', 'Gold Pass', 'General Event Pass', 'School Student Pass', 'Platinum Pass',
    'Commercio Artikel - Article Writing Competition', 'Dhyuti - Call for Articles', 'Essay Writing on Finance',
    'Pandemonium - 2026 (Quiz on Empowerment)', 'Annual International Mathematics Olympiad (AIMO) 2026',
    'Ignite - Startup Discovery & Entrepreneurship Bootcamp', 'From Tokens to Transformers : A Course on GenAI',
    'Dance Battle', 'Photography Contest', 'Cricket League', 'BGMI Esports Showdown', 'Research Poster Presentation Competition',
    'Students\' Research Conclave 4.0', 'Udaan RC Plane Challenge', 'Nirmiti CADathon', 'ThetaShift: Spherical Bot Making Competition']) {
    assert.equal(kindOf({ title, ...XLRI }), 'other', title);
  }
  assert.equal(kindOf({ title: 'Robo Soccer - Flagship', ...NITU }), 'other');
});

test('format_kind other: a plain tech title at an IIT', () => {
  assert.equal(kindOf({ title: 'Eggstravaganza', ...IITB }), 'other');
  assert.equal(kindOf({ title: 'UAV-X: Resilient BVLOS Swarm Challenge', ...IITB }), 'other');
});

test('format_kind other: an article-writing title beats the case_competition subtype', () => {
  assert.equal(kindOf({ subtype: 'case_competition', title: 'Fintellect 2026 - An Article Writing Competition' }), 'other');
});

test('is_case means "belongs on the main list": case and business are true, other false', () => {
  assert.equal(kind({ subtype: 'case_competition', title: 'X' }).is_case, true);
  assert.equal(kind({ title: 'B-Plan' }).is_case, true);
  assert.equal(kind({ title: 'Gold Pass' }).is_case, false);
});

test('opportunity option: a hackathons scan pages opportunity=hackathons the same way', async () => {
  const http = fakeHttp([['search-result', { data: { data: [item(1)], last_page: 1 } }]]);
  const { records } = await fetchAll(new Map(), [], opts(http, { opportunity: 'hackathons' }));
  const url = new URL(http.calls[0]);
  assert.equal(url.searchParams.get('opportunity'), 'hackathons');
  assert.equal(url.searchParams.get('oppstatus'), 'open');
  assert.equal(records.length, 1);
});

test('opportunity option: an empty hackathons scan names hackathons in the error', async () => {
  const http = fakeHttp([['search-result', { data: { data: [], last_page: 1 } }]]);
  await assert.rejects(fetchAll(new Map(), [], opts(http, { opportunity: 'hackathons' })), /no hackathons/);
});
