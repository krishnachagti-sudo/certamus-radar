import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../fetch/run.js';
import { createDb } from '../fetch/db.js';

// In-memory stand-in for fetch/db.js that behaves like sync_section: archive
// insert-ignore by archive_key, rows replace the section, empty rows refused
// while the section has listings. `tables` maps a table name to rows or an
// Error; `fail` makes listings / status / sync / setStatus throw.
function fakeDb({ listings = [], status = null, tables = {}, fail = {} } = {}) {
  const db = {
    configured: true, listings, status, archive: new Map(), syncs: [], statusWrites: [],
    async readListings(section) {
      assert.equal(section, 'case');
      if (fail.listings) throw fail.listings;
      return structuredClone(db.listings);
    },
    async readTable(name) {
      if (tables[name] instanceof Error) throw tables[name];
      return tables[name] ?? [];
    },
    async readStatus() {
      if (fail.status) throw fail.status;
      return db.status;
    },
    async syncSection(section, rows, archive, st) {
      if (fail.sync) throw fail.sync;
      if (!rows.length && db.listings.length) throw new Error('Supabase sync_section (case): HTTP 400 refusing to empty section case');
      db.syncs.push(structuredClone({ section, rows, archive, status: st }));
      for (const a of archive) if (!db.archive.has(a.archive_key)) db.archive.set(a.archive_key, a);
      db.listings = structuredClone(rows);
      db.status = st;
    },
    async setStatus(section, st) {
      if (fail.setStatus) throw fail.setStatus;
      db.statusWrites.push({ section, status: st });
      db.status = st;
    },
  };
  return db;
}

// Config files in a temp data/ dir; live records, status and Supabase tables
// in the fake db.
function setup(over = {}, { listings, status = { last_ok: '2026-09-28T00:30:00.000Z' }, tables = {}, fail = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
  const files = {
    'team.json': { size: 4, passout_years: [2029] },
    'national.json': [{ name: 'NIT', host: '\\bNIT\\b|National Institute of Technology' }],
    'bschools.json': [],
    'corporates.json': [],
    'international.json': [],
    ...over,
  };
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  const db = fakeDb({
    listings: listings ?? [{ id: 77, title: 'Old', regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null }],
    status, tables, fail,
  });
  return { dir, db };
}
const archived = db => [...db.archive.values()];
const item = {
  id: 1, title: 'Ops', updated_at: 'x', end_date: '2026-11-09T21:25:00+05:30',
  organisation: { name: 'Indian Institute of Management (IIM), Raipur' },
  regnRequirements: { min_team_size: 2, max_team_size: 3, end_regn_dt: '2026-11-09T21:25:00+05:30', eligibility: '{"sector":["students"],"others":["all"]}' },
  filters: [{ name: 'All', type: 'eligible' }], prizes: [], isPaid: false, region: 'online',
  details: '<p>All students.</p>',
};
const now = new Date('2026-09-29T00:30:00Z');
// InsideIIM page stub: one competition, not ACTIVE, so no records and no warning.
const iimPage = comps => `<script>self.__next_f.push(${JSON.stringify([1, `5:${JSON.stringify({ competitions: comps })}\n`])})</script>`;
const iimComp = (over = {}) => ({ _id: 'c1', slug: 'x-case', title: 'X Case Challenge', status: 'ACTIVE', type: 'ONAPP', externalLink: '',
  registrationEnd: '2026-10-20T18:29:00.000Z', description: '<p>Write to x@y.com or 9876543210.</p>', eligibility: '<p>Students.</p>',
  organization: { name: 'Xco', contactUs: { email: 'x@y.com', phone: '9876543210' } }, campuses: [], ...over });
const noIim = async () => iimPage([iimComp({ status: 'INACTIVE' })]);
// Older tests are about Unstop: Opportunity Desk answers with no posts.
const noOd = getJson => async url => (url.startsWith('https://opportunitydesk.org/') ? [] : getJson(url));

const go = (dir, db, over = {}) => main({ dataDir: dir, now, deps: { getText: noIim, getJson: router(), pause: async () => {}, db, ...over } });
const unstopOnly = getJson => ({ getJson: noOd(getJson) });
const oneItem = async () => ({ data: { data: [item], last_page: 1 } });

test('success syncs classified competitions and a clean status in one call', async () => {
  const { dir, db } = setup();
  const code = await go(dir, db, unstopOnly(oneItem));
  assert.equal(code, 0);
  assert.equal(db.syncs.length, 1);
  assert.equal(db.statusWrites.length, 0);
  const comps = db.listings;
  const ops = comps.find(c => c.id === 1);
  assert.equal(ops.tier, 'iim');
  assert.equal(ops.verdict.level, 'fits');
  assert.equal(comps.find(c => c.id === 77).closed_on, '2026-09-29');
  const st = db.status;
  assert.equal(st.last_ok, now.toISOString());
  assert.equal(st.last_run, now.toISOString());
  assert.equal(st.last_error, null);
  assert.deepEqual(st.warnings, []);
});

test('full scan: no keywords.json needed, one unfiltered search request, national tier and format_kind written', async () => {
  const { dir, db } = setup();
  const nit = { ...item, id: 2, title: 'Sankalp Ideathon', type: 'competitions', subtype: 'general_competition',
    organisation: { name: 'National Institute of Technology (NIT), Delhi' } };
  const calls = [];
  const getJson = async url => { calls.push(url); return { data: { data: [item, nit], last_page: 1 } }; };
  assert.equal(await go(dir, db, unstopOnly(getJson)), 0);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /searchTerm/);
  const r2 = db.listings.find(c => c.id === 2);
  assert.equal(r2.tier, 'national');
  assert.equal(r2.format_kind, 'business');
  assert.equal(r2.is_case, true);
  assert.equal('details_text' in r2, false);
  assert.equal('eligibility' in r2, false);
});

test('a record that fails classification does not fail the run', async () => {
  const { dir, db } = setup({ 'bschools.json': [{ host: '(' }] });
  const getJson = async () => ({ data: { data: [{ ...item, organisation: { name: 'Acme Corp' } }], last_page: 1 } });
  assert.equal(await go(dir, db, unstopOnly(getJson)), 0);
  assert.ok(db.listings.find(c => c.id === 1));
  assert.ok(db.status.warnings.some(w => w.includes('classify')));
});

test('a manual read failure is a warning and the run goes on without hand-added links', async () => {
  const { dir, db } = setup({}, { tables: { manual: new Error('HTTP 503') } });
  assert.equal(await go(dir, db, unstopOnly(oneItem)), 0);
  assert.ok(db.status.warnings.some(w => /^manual: /.test(w) && /503/.test(w) && /none/.test(w)));
});

test('a search failure syncs nothing and records the error with the previous last_ok', async () => {
  const { dir, db } = setup();
  const before = structuredClone(db.listings);
  assert.equal(await go(dir, db, unstopOnly(async () => ({ data: {} }))), 1);
  assert.equal(db.syncs.length, 0);
  assert.deepEqual(db.listings, before);
  assert.equal(db.statusWrites.length, 1);
  const st = db.statusWrites[0].status;
  assert.equal(db.statusWrites[0].section, 'case');
  assert.equal(st.last_ok, '2026-09-28T00:30:00.000Z');
  assert.equal(st.last_run, now.toISOString());
  assert.match(st.last_error, /shape/);
});

test('unreadable live records: no sync at all, only a status with the error', async () => {
  const { dir, db } = setup({}, { fail: { listings: new Error('Supabase listings (case): HTTP 503 down') } });
  let searched = false;
  const code = await go(dir, db, unstopOnly(async () => { searched = true; return oneItem(); }));
  assert.equal(code, 1);
  assert.equal(searched, false);
  assert.equal(db.syncs.length, 0);
  assert.equal(db.statusWrites.length, 1);
  const st = db.statusWrites[0].status;
  assert.match(st.last_error, /live records unreadable.*503/);
  assert.equal(st.last_ok, '2026-09-28T00:30:00.000Z');
});

test('no service key: the real client refuses, the run fails without fetching anything', async () => {
  const { dir } = setup();
  let called = false;
  const db = createDb({ env: {}, fetch: async () => { called = true; throw new Error('no'); } });
  assert.equal(await go(dir, db), 1);
  assert.equal(called, false);
});

test('a failed sync records the error, carrying last_ok and sources from the previous status', async () => {
  const { dir, db } = setup({}, { status: { last_ok: 'PREV', sources: { x: 1 } }, fail: { sync: new Error('Supabase sync_section (case): HTTP 500 boom') } });
  assert.equal(await go(dir, db), 1);
  const st = db.statusWrites[0].status;
  assert.equal(st.last_ok, 'PREV');
  assert.deepEqual(st.sources, { x: 1 });
  assert.match(st.last_error, /boom/);
});

test('an unreadable previous status gives last_ok null, and the run still records its error', async () => {
  const { dir, db } = setup({}, { fail: { status: new Error('HTTP 503'), sync: new Error('boom') } });
  assert.equal(await go(dir, db), 1);
  const st = db.statusWrites[0].status;
  assert.equal(st.last_ok, null);
  assert.match(st.last_error, /boom/);
});

test('a failing setStatus does not crash the run', async () => {
  const { dir, db } = setup({}, { fail: { listings: new Error('down'), setStatus: new Error('also down') } });
  assert.equal(await go(dir, db), 1);
});

test('stored records carry no listing body text or contact details', async () => {
  const { dir, db } = setup({}, { listings: [{ id: 77, title: 'Old', regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null,
    details_text: 'Old body, mail old@example.org or 9123456789', eligibility: { others: ['all'] } }] });
  const leaky = { ...item, details: '<p>All students. Call Riya 9876543210 or riya@example.edu</p>' };
  assert.equal(await go(dir, db, unstopOnly(async () => ({ data: { data: [leaky], last_page: 1 } }))), 0);
  const raw = JSON.stringify(db.syncs[0]);
  for (const c of db.syncs[0].rows) {
    assert.equal('details_text' in c, false);
    assert.equal('eligibility' in c, false);
  }
  assert.doesNotMatch(raw, /\b[6-9]\d{9}\b/);
  assert.doesNotMatch(raw, /[\w.+-]+@[\w-]+\.[\w.]+/);
  // classification still ran on the body before it was dropped
  assert.equal(db.listings.find(c => c.id === 1).verdict.level, 'fits');
});

test('a carried-over manual record keeps its stored tier and verdict', async () => {
  const stored = { id: 55, title: 'Kept', host: 'Acme', tier: 'iim', pinned: true, details_fetched: true,
    verdict: { level: 'fits', reasons: [] }, regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null };
  const manual = [{ id: '55', url: 'https://unstop.com/competitions/kept-55', added: '2026-09-01' }];
  const { dir, db } = setup({}, { listings: [stored], tables: { manual } });
  const getJson = async url => {
    if (url.includes('/competition/55')) throw new Error('HTTP 500');
    return oneItem();
  };
  assert.equal(await go(dir, db, unstopOnly(getJson)), 0);
  const kept = db.listings.find(c => c.id === 55);
  assert.equal(kept.tier, 'iim');
  assert.deepEqual(kept.verdict, { level: 'fits', reasons: [] });
  assert.equal(kept.pinned, true);
  assert.equal('carried_over' in kept, false);
});

const old88 = { id: 88, title: 'Gone', host: 'IIM X', tier: 'iim', url: 'https://unstop.com/gone-88', regn_close: '2026-06-01',
  comp_end: '2026-06-10', first_seen: '2026-05-01', closed_on: '2026-06-02', format: 'case_competition', is_case: true,
  verdict: { level: 'fits', reasons: [] } };

test('decisions readable with the service key: an expired record is pruned and its slim archive entry rides the same sync', async () => {
  const { dir, db } = setup({}, { listings: [old88], tables: { decisions: [] } });
  assert.equal(await go(dir, db, unstopOnly(oneItem)), 0);
  assert.equal(db.syncs.length, 1);
  const { section, rows, archive } = db.syncs[0];
  assert.equal(section, 'case');
  assert.equal(rows.some(c => c.id === 88), false);
  assert.deepEqual(archive.map(a => a.archive_key), ['88']);
  assert.equal(archive[0].id, 88);
  assert.equal(archive[0].title, 'Gone');
  assert.equal('verdict' in archive[0], false);
  assert.deepEqual(db.status.warnings, []);
});

test('the archive entry is inserted once across runs', async () => {
  const { dir, db } = setup({}, { listings: [old88] });
  assert.equal(await go(dir, db, unstopOnly(oneItem)), 0);
  db.listings.push(structuredClone(old88));
  assert.equal(await go(dir, db, unstopOnly(oneItem)), 0);
  assert.equal(archived(db).length, 1);
});

test('decisions unreadable: nothing is pruned, with a warning', async () => {
  const { dir, db } = setup({}, { listings: [old88], tables: { decisions: new Error('HTTP 503') } });
  assert.equal(await go(dir, db, unstopOnly(oneItem)), 0);
  assert.ok(db.syncs[0].rows.some(c => c.id === 88));
  assert.deepEqual(db.syncs[0].archive, []);
  assert.ok(db.status.warnings.some(w => /^decisions: /.test(w) && /503/.test(w)));
});

const intlRow = { id: 'intl-z', name: 'Z Case Cup', url: 'https://z.example/', watch_url: 'https://z.example/', host: 'Z School',
  kind: 'case', entry: 'invite', who_applies: 'school', indian_ug: 'unclear', indian_ug_note: 'n', application_months: null,
  finals_months: [3], team_size: '4', fee: null, last_edition: null, verified: true };
const odPost = { id: 901, link: 'https://opportunitydesk.org/2026/09/20/z-case/', title: { rendered: 'Z Global Case Competition' },
  content: { rendered: '<p>Mail a@b.org</p><p>Deadline: December 1, 2026</p>' }, date: '2026-09-20T00:00:00' };
function router({ od = async () => [odPost] } = {}) {
  return async url => (url.startsWith('https://opportunitydesk.org/') ? od(url) : { data: { data: [item], last_page: 1 } });
}

test('curated and Opportunity Desk records are added as international, unclassified', async () => {
  const intl_dates = [{ id: 'intl-z', regn_close: '2026-11-20', comp_end: '2027-03-10', confirmed_on: '2026-09-29' }];
  const { dir, db } = setup({ 'international.json': [intlRow] }, { tables: { intl_dates } });
  assert.equal(await go(dir, db), 0);
  const comps = db.listings;
  const z = comps.find(c => c.id === 'intl-z');
  assert.equal(z.tier, 'international');
  assert.equal(z.source, 'curated');
  assert.deepEqual(z.verdict, { level: 'check', reasons: ['IIM Sirmaur must apply for an invitation'] });
  assert.equal(z.regn_close, '2026-11-20');
  assert.equal(z.first_seen, '2026-09-29');
  const od = comps.find(c => c.id === 'od-901');
  assert.equal(od.tier, 'international');
  assert.equal(od.verdict.level, 'check');
  assert.doesNotMatch(JSON.stringify(comps), /a@b\.org/);
  assert.deepEqual(db.status.warnings, []);
});

test('an Opportunity Desk failure is a warning and keeps the previous od- records', async () => {
  const prevOd = { id: 'od-5', source: 'oppdesk', title: 'Prev Case', host: 'Opportunity Desk listing', tier: 'international',
    url: 'https://opportunitydesk.org/p/5/', regn_close: '2026-12-01', verdict: { level: 'check', reasons: ['verify eligibility on the post'] },
    first_seen: '2026-09-01', closed_on: null, is_case: true };
  const { dir, db } = setup({}, { listings: [prevOd] });
  assert.equal(await go(dir, db, { getJson: router({ od: async () => { throw new Error('HTTP 503 for od'); } }) }), 0);
  const kept = db.listings.find(c => c.id === 'od-5');
  assert.equal(kept.closed_on, null);
  assert.equal(kept.tier, 'international');
  assert.equal(kept.first_seen, '2026-09-01');
  assert.ok(db.status.warnings.some(w => /Opportunity Desk/.test(w) && /503/.test(w)));
});

const prevCurated = { id: 'intl-z', source: 'curated', title: 'Z Case Cup', host: 'Z School', tier: 'international',
  url: 'https://z.example/', regn_close: '2026-11-20', comp_end: '2027-03-10', first_seen: '2026-09-01', closed_on: null,
  verdict: { level: 'check', reasons: ['IIM Sirmaur must apply for an invitation'] }, is_case: true };

for (const [label, files, tables] of [
  ['a non-array international.json', { 'international.json': { nope: 1 } }, {}],
  ['an unparseable international.json', { 'international.json': '{not json' }, {}],
  ['a failed intl_dates read', { 'international.json': [intlRow] }, { intl_dates: new Error('HTTP 503') }],
]) {
  test(`${label} warns and passes previous curated records through unchanged`, async () => {
    const { dir, db } = setup(files, { listings: [prevCurated], tables });
    assert.equal(await go(dir, db), 0);
    const z = db.listings.find(c => c.id === 'intl-z');
    assert.equal(z.closed_on, null);
    assert.equal(z.regn_close, '2026-11-20');
    assert.equal(z.first_seen, '2026-09-01');
    assert.ok(db.status.warnings.some(w => /curated/i.test(w)));
  });
}

test('previous Opportunity Desk records missing from the fetch window pass through while still open', async () => {
  const od = (id, regn_close) => ({ id, source: 'oppdesk', title: 'Case', host: 'Opportunity Desk listing', tier: 'international',
    url: `https://opportunitydesk.org/p/${id}/`, regn_close, first_seen: '2026-05-01', closed_on: null, is_case: true,
    verdict: { level: 'check', reasons: ['verify eligibility on the post'] } });
  const { dir, db } = setup({}, { listings: [od('od-1', '2026-10-15'), od('od-2', '2026-09-29'), od('od-3', '2026-09-20')] });
  assert.equal(await go(dir, db, { getJson: router({ od: async () => [] }) }), 0);
  const comps = db.listings;
  assert.equal(comps.find(c => c.id === 'od-1').closed_on, null);
  assert.equal(comps.find(c => c.id === 'od-2').closed_on, null);
  assert.equal(comps.find(c => c.id === 'od-3').closed_on, '2026-09-29');
});

test('a curated edition is archived once when its confirmed regn_close passes, and the record stays', async () => {
  const intl_dates = [{ id: 'intl-z', regn_close: '2026-09-01', comp_end: '2026-09-10', confirmed_on: '2026-08-01' }];
  const { dir, db } = setup({ 'international.json': [intlRow] }, { tables: { intl_dates } });
  for (const at of ['2026-09-29T00:30:00Z', '2026-11-05T00:30:00Z', '2026-12-01T00:30:00Z']) {
    assert.equal(await main({ dataDir: dir, now: new Date(at), deps: { getText: noIim, getJson: router({ od: async () => [] }), pause: async () => {}, db } }), 0);
  }
  assert.ok(db.listings.some(c => c.id === 'intl-z'));
  assert.deepEqual(archived(db).filter(a => String(a.id).startsWith('intl-')).map(a => a.archive_key), ['intl-z@2026-09-01']);
});

test('decisions keep a committed record past the 60-day prune', async () => {
  const old = { id: 88, title: 'Entered', regn_close: '2026-06-01', comp_end: '2026-09-01', first_seen: '2026-05-01', closed_on: '2026-06-02' };
  const decisions = [{ id: '88', status: 'entering', registered: false, note: null, updated_at: '2026-06-01T00:00:00Z' }];
  const { dir, db } = setup({}, { listings: [old], tables: { decisions } });
  assert.equal(await go(dir, db), 0);
  assert.ok(db.listings.some(c => c.id === 88));
  assert.deepEqual(db.status.warnings, []);
});

test('every Supabase table down: empty decisions and links, warnings, run still succeeds', async () => {
  const err = new Error('HTTP 503');
  const { dir, db } = setup({}, { tables: { decisions: err, manual: err, intl_dates: err } });
  assert.equal(await go(dir, db), 0);
  const w = db.status.warnings;
  assert.ok(w.some(x => /decisions/.test(x) && /none/.test(x)));
  assert.ok(w.some(x => /manual/.test(x) && /none/.test(x)));
  assert.ok(db.listings.some(c => c.id === 1));
});

// ---- InsideIIM and the fest watchlist ---------------------------------------

test('InsideIIM records are added as corporate, unclassified, with no body text', async () => {
  const { dir, db } = setup();
  const urls = [];
  const getText = async u => { urls.push(u); return iimPage([iimComp()]); };
  assert.equal(await go(dir, db, { getText }), 0);
  assert.deepEqual(urls, ['https://insideiim.com/competitions']);
  const r = db.listings.find(c => c.id === 'iim-c1');
  assert.equal(r.source, 'insideiim');
  assert.equal(r.tier, 'corporate');
  assert.equal(r.format_kind, 'case');
  assert.equal(r.regn_close, '2026-10-20');
  assert.deepEqual(r.verdict, { level: 'check', reasons: ['Eligibility on InsideIIM'] });
  assert.doesNotMatch(JSON.stringify(db.listings), /x@y\.com|9876543210|Write to/);
  assert.deepEqual(db.status.warnings, []);
});

const prevIim = { id: 'iim-p1', source: 'insideiim', title: 'Prev Case', host: 'Pco', tier: 'corporate',
  url: 'https://insidekampus.com/competition/prev', regn_close: '2026-10-30', verdict: { level: 'check', reasons: ['Eligibility on InsideIIM'] },
  first_seen: '2026-09-01', closed_on: null, is_case: true, format_kind: 'business' };

for (const [label, getText] of [
  ['an HTTP error', async () => { throw new Error('HTTP 503 for https://insideiim.com/competitions'); }],
  ['a changed page shape', async () => '<html>no payload</html>'],
]) {
  test(`InsideIIM ${label} is a warning and passes the previous iim- records through unchanged`, async () => {
    const { dir, db } = setup({}, { listings: [prevIim] });
    assert.equal(await go(dir, db, { getText }), 0);
    const kept = db.listings.find(c => c.id === 'iim-p1');
    assert.equal(kept.closed_on, null);
    assert.equal(kept.first_seen, '2026-09-01');
    assert.deepEqual(kept.verdict, prevIim.verdict);
    assert.ok(db.status.warnings.some(w => /^InsideIIM: /.test(w)));
  });
}

const festRow = { id: 'fest-ktj', name: 'Kshitij', url: 'https://ktj.in/', watch_url: 'https://ktj.in/', host: 'IIT Kharagpur', tier: 'iit',
  kind: 'case', entry: 'open', who_applies: 'team', indian_ug: 'unclear', indian_ug_note: 'Check the fest page for undergraduate eligibility',
  application_months: null, finals_months: null, verified: true };

test('fests.json rows are added as curated records with their own tier', async () => {
  const { dir, db } = setup({ 'international.json': [intlRow], 'fests.json': [festRow] });
  assert.equal(await go(dir, db), 0);
  const k = db.listings.find(c => c.id === 'fest-ktj');
  assert.equal(k.tier, 'iit');
  assert.equal(k.source, 'curated');
  assert.equal(k.verdict.level, 'check');
  assert.equal(db.listings.find(c => c.id === 'intl-z').tier, 'international');
  assert.deepEqual(db.status.warnings, []);
});

test('a broken fests.json warns and keeps the previous fest- records, international unaffected', async () => {
  const prevFest = { id: 'fest-ktj', source: 'curated', title: 'Kshitij', host: 'IIT Kharagpur', tier: 'iit', url: 'https://ktj.in/',
    regn_close: null, comp_end: null, first_seen: '2026-09-01', closed_on: null, verdict: { level: 'check', reasons: ['x'] }, is_case: true };
  const { dir, db } = setup({ 'international.json': [intlRow], 'fests.json': '{broken' }, { listings: [prevFest] });
  assert.equal(await go(dir, db), 0);
  const comps = db.listings;
  assert.deepEqual(comps.find(c => c.id === 'fest-ktj').verdict, { level: 'check', reasons: ['x'] });
  assert.equal(comps.find(c => c.id === 'fest-ktj').first_seen, '2026-09-01');
  assert.ok(comps.some(c => c.id === 'intl-z'));
  const w = db.status.warnings;
  assert.ok(w.some(x => /fests\.json/.test(x)));
  assert.ok(!w.some(x => /international\.json/.test(x)));
});

test('a broken international.json keeps previous intl- records and still reads fests.json', async () => {
  const { dir, db } = setup({ 'international.json': '{broken', 'fests.json': [festRow] }, { listings: [prevCurated] });
  assert.equal(await go(dir, db), 0);
  assert.equal(db.listings.find(c => c.id === 'intl-z').regn_close, '2026-11-20');
  assert.equal(db.listings.find(c => c.id === 'fest-ktj').tier, 'iit');
});

test('main never writes generated files into data/', async () => {
  const { dir, db } = setup();
  const before = fs.readdirSync(dir).sort();
  assert.equal(await go(dir, db), 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});
