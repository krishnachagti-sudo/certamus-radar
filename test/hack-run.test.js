import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../fetch/hack-run.js';

const TEAM = {
  members: [
    { name: 'Krishna', level: 'ug', streams: ['management', 'science'], year: 2029 },
    { name: 'Akshit', level: 'ug', streams: ['engineering'], year: 2028 },
  ],
  can_grow: true,
};
const curatedRow = (over = {}) => ({
  id: 'hk-sih', name: 'Smart India Hackathon', url: 'https://sih.gov.in/', watch_url: 'https://sih.gov.in/', host: 'MoE Innovation Cell and AICTE',
  tier: 'national', country: 'India', kind: 'build', entry: 'institute', entry_note: null, who_applies: 'school', indian_ug: 'unclear',
  indian_ug_note: 'enter through your institute', application_months: null, finals_months: [12], team_size: null, fee: null, last_edition: null, verified: true, ...over,
});

// In-memory stand-in for fetch/db.js (same contract as sync_section).
function fakeDb({ listings = [], status = null, tables = {}, fail = {} } = {}) {
  const db = {
    configured: true, listings, status, archive: new Map(), syncs: [], statusWrites: [],
    async readListings(section) {
      assert.equal(section, 'hack');
      if (fail.listings) throw fail.listings;
      return structuredClone(db.listings);
    },
    async readTable(name) {
      if (tables[name] instanceof Error) throw tables[name];
      return tables[name] ?? [];
    },
    async readStatus() { return db.status; },
    async syncSection(section, rows, archive, st) {
      if (!rows.length && db.listings.length) throw new Error('refusing to empty section hack');
      db.syncs.push(structuredClone({ section, rows, archive, status: st }));
      for (const a of archive) if (!db.archive.has(a.archive_key)) db.archive.set(a.archive_key, a);
      db.listings = structuredClone(rows);
      db.status = st;
    },
    async setStatus(section, st) { db.statusWrites.push({ section, status: st }); db.status = st; },
  };
  return db;
}

function setup(over = {}, { listings = [], status = { last_ok: '2026-09-28T00:30:00.000Z' }, tables = {}, fail = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-hack-'));
  const files = {
    'hack-team.json': TEAM,
    'national.json': [{ name: 'NIT', host: '\\bNITs?\\b|National Institute of Technology' }],
    'bschools.json': [],
    'hack-corporates.json': [{ name: 'Flipkart', host: '\\bFlipkart\\b' }],
    'hack-curated.json': [curatedRow()],
    ...over,
  };
  for (const [f, v] of Object.entries(files)) {
    if (v === undefined) continue;
    fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return { dir, db: fakeDb({ listings, status, tables, fail }) };
}
const now = new Date('2026-09-30T00:30:00Z');

const unstopItem = (id, over = {}) => ({
  id, title: 'Hack On Campus', type: 'hackathons', subtype: 'online_coding_challenge', end_date: '2026-11-09T21:25:00+05:30',
  organisation: { name: 'National Institute of Technology (NIT), Delhi' },
  regnRequirements: { min_team_size: 2, max_team_size: 4, end_regn_dt: '2026-10-20T21:25:00+05:30', eligibility: '{"sector":["students"],"others":["all"],"studentPassoutYearsSelected":["all"]}' },
  filters: [{ name: 'All', type: 'eligible' }], prizes: [{ cash: 5000 }], isPaid: false, region: 'online',
  details: '<p>Questions? Mail head@nit.example.in or call 9876543210.</p>', ...over,
});
const dfHit = (over = {}) => ({ _source: {
  uuid: 'aaaabbbbccccddddeeeeffff00001111', slug: 'hack-on-hills', name: 'Hack On Hills 8.0', location: 'NIT Hamirpur, NIT, Hamirpur, Himachal Pradesh, India',
  city: 'Hamirpur', country: 'India', is_online: false, starts_at: '2026-10-31T06:30:00+00:00', ends_at: '2026-11-01T20:00:00+00:00', team_min: 2, team_size: 4,
  hackathon_setting: { reg_ends_at: '2026-10-15T18:29:00+00:00', contact_email: 'x@y.com' },
  hackathon_faqs: [{ question: 'Who can participate?', answer: 'Any college student.' }], ...over } });
const mlhEvent = (over = {}) => ({ slug: 'bigred-hacks-2026', name: 'BigRed//Hacks 2026', startsAt: '2026-10-02T20:30:00Z', endsAt: '2026-10-04T17:00:00Z',
  url: '/events/bigred-hacks-2026/prizes', location: 'Ithaca, New York', formatType: 'physical', websiteUrl: 'https://www.bigredhacks.com/',
  customFields: { underserved_types: [] }, venueAddress: { country: 'US' }, ...over });
const mlhPage = events => `<script data-page="app" type="application/json">${JSON.stringify({ props: { upcomingEvents: events } })}</script>`;
const dpItem = (over = {}) => ({ id: 29969, title: 'RevenueCat Shipaton 2026', displayed_location: { icon: 'globe', location: 'Online' },
  url: 'https://revenuecat-shipaton-2026.devpost.com/', submission_period_dates: 'Jul 31 - Oct 20, 2026', organization_name: 'RevenueCat', invite_only: false, ...over });

// Stubs for all four sources; `fail` names sources that throw.
function deps(db, { unstop = [unstopItem(1)], devfolio = [dfHit()], mlh = [mlhEvent()], devpost = [dpItem()], fail = [] } = {}) {
  const boom = name => { throw new Error(`${name} down`); };
  return {
    db,
    pause: async () => {},
    backoff: 0,
    getJson: async url => {
      if (url.includes('unstop.com')) return fail.includes('unstop') ? boom('unstop') : { data: { data: unstop, last_page: 1 } };
      if (url.includes('devpost.com')) return fail.includes('devpost') ? boom('devpost') : { hackathons: devpost, meta: { total_count: devpost.length } };
      throw new Error(`unrouted ${url}`);
    },
    postJson: async () => (fail.includes('devfolio') ? boom('devfolio') : { hits: { total: { value: devfolio.length }, hits: devfolio } }),
    getText: async () => (fail.includes('mlh') ? boom('mlh') : mlhPage(mlh)),
  };
}

const go = (dir, db, opts) => main({ dataDir: dir, now, deps: deps(db, opts) });

test('success: all sources land in one hack sync with source, kind, tier, verdict and main', async () => {
  const { dir, db } = setup();
  assert.equal(await go(dir, db), 0);
  assert.equal(db.syncs.length, 1);
  assert.equal(db.syncs[0].section, 'hack');
  const recs = db.listings;
  const by = id => recs.find(r => r.id === id);
  assert.deepEqual(recs.map(r => r.source).sort(), ['curated', 'devfolio', 'devpost', 'mlh', 'unstop']);
  const u = by(1);
  assert.equal(u.tier, 'national');
  assert.equal(u.hack_kind, 'build');
  assert.deepEqual(u.verdict, { level: 'fits', reasons: [] });
  assert.equal(u.main, true);
  assert.equal('format_kind' in u, false);
  assert.equal('is_case' in u, false);
  const d = by('df-aaaabbbbccccddddeeeeffff00001111');
  assert.equal(d.tier, 'national');
  assert.equal(d.url, 'https://hack-on-hills.devfolio.co/');
  const m = by('mlh-bigred-hacks-2026');
  assert.equal(m.tier, 'global');
  assert.equal(m.verdict.level, 'check');
  assert.ok(m.verdict.reasons.includes('in-person abroad (US)'));
  const p = by('dp-29969');
  assert.equal(p.tier, 'global');
  const c = by('hk-sih');
  assert.equal(c.tier, 'national');
  assert.equal(c.hack_kind, 'build');
  assert.deepEqual(c.verdict, { level: 'check', reasons: ['enter through your institute'] });
  const st = db.status;
  assert.equal(st.last_ok, now.toISOString());
  assert.equal(st.last_error, null);
  assert.deepEqual(st.warnings, []);
  assert.deepEqual(Object.keys(st.sources).sort(), ['curated', 'devfolio', 'devpost', 'mlh', 'unstop']);
  assert.ok(Object.values(st.sources).every(s => s.ok));
});

test('privacy: no body text, FAQ answers, facts, raw eligibility or contact details are stored', async () => {
  const { dir, db } = setup();
  await go(dir, db);
  const raw = JSON.stringify(db.syncs[0]);
  assert.doesNotMatch(raw, /\b[6-9][0-9]{9}\b/);
  assert.doesNotMatch(raw, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/);
  for (const r of db.syncs[0].rows) {
    for (const k of ['details_text', 'eligibility', 'facts', 'carried_over']) assert.equal(k in r, false, `${r.id} has ${k}`);
  }
});

test('kinds: excluded formats stay as hack_kind other, off the main list; ideathons are kept', async () => {
  const { dir, db } = setup();
  const unstop = [unstopItem(1), unstopItem(2, { title: 'Capture The Flag (CTF)' }), unstopItem(3, { title: 'Junior Ideathon' })];
  await go(dir, db, { unstop });
  const ctf = db.listings.find(r => r.id === 2);
  assert.equal(ctf.hack_kind, 'other');
  assert.equal(ctf.main, false);
  assert.equal(db.listings.find(r => r.id === 3).hack_kind, 'ideathon');
});

test('tiers: an unlisted host is tier other and off the main list', async () => {
  const { dir, db } = setup();
  await go(dir, db, { unstop: [unstopItem(4, { organisation: { name: 'WeCodeCoders' } })] });
  const r = db.listings.find(x => x.id === 4);
  assert.equal(r.tier, 'other');
  assert.equal(r.main, false);
});

for (const source of ['unstop', 'devfolio', 'mlh', 'devpost']) {
  test(`a failing ${source} is a warning: its previous records pass through, the run succeeds`, async () => {
    const prev = { id: `prev-${source}`, source, title: 'Yesterday', tier: 'global', hack_kind: 'build', main: true,
      verdict: { level: 'fits', reasons: [] }, regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null };
    const { dir, db } = setup({}, { listings: [prev] });
    assert.equal(await go(dir, db, { fail: [source] }), 0);
    const kept = db.listings.find(r => r.id === prev.id);
    assert.equal(kept.closed_on, null);
    assert.equal(kept.tier, 'global');
    const st = db.status;
    assert.equal(st.last_error, null);
    assert.ok(st.warnings.some(w => w.includes(`${source} down`)));
    assert.equal(st.sources[source].ok, false);
  });
}

test('every fetched source failing fails the run: no sync, status carries last_ok and sources', async () => {
  const prev = [{ id: 9, source: 'unstop', title: 'x' }];
  const { dir, db } = setup({}, { listings: prev, status: { last_ok: '2026-09-28T00:30:00.000Z', sources: { unstop: { ok: true, count: 1 } } } });
  assert.equal(await go(dir, db, { fail: ['unstop', 'devfolio', 'mlh', 'devpost'] }), 1);
  assert.equal(db.syncs.length, 0);
  assert.deepEqual(db.listings, prev);
  assert.equal(db.statusWrites.length, 1);
  const { section, status: st } = db.statusWrites[0];
  assert.equal(section, 'hack');
  assert.equal(st.last_ok, '2026-09-28T00:30:00.000Z');
  assert.deepEqual(st.sources, { unstop: { ok: true, count: 1 } });
  assert.match(st.last_error, /every hackathon source failed/);
});

test('unreadable live records: the run fails before fetching, no sync, error status', async () => {
  const { dir, db } = setup({}, { fail: { listings: new Error('Supabase listings (hack): HTTP 503') } });
  let fetched = false;
  const d = deps(db);
  const code = await main({ dataDir: dir, now, deps: { ...d, getJson: async u => { fetched = true; return d.getJson(u); } } });
  assert.equal(code, 1);
  assert.equal(fetched, false);
  assert.equal(db.syncs.length, 0);
  assert.match(db.statusWrites[0].status.last_error, /live records unreadable.*503/);
  assert.deepEqual(db.statusWrites[0].status.sources, {});
});

test('an empty section starts from nothing', async () => {
  const { dir, db } = setup();
  assert.equal(await go(dir, db), 0);
  assert.ok(db.listings.length > 0);
});

const oldClosed = { id: 55, source: 'unstop', title: 'Old hack', tier: 'national', hack_kind: 'build', main: true,
  regn_close: '2026-06-01', comp_end: '2026-06-10', first_seen: '2026-05-01', closed_on: '2026-06-02', verdict: { level: 'fits', reasons: [] } };

test('prune: a record closed over 60 days ago leaves the rows and rides the same sync into the archive with hack_kind', async () => {
  const { dir, db } = setup({}, { listings: [oldClosed] });
  await go(dir, db);
  const { rows, archive } = db.syncs[0];
  assert.equal(rows.some(r => r.id === 55), false);
  assert.equal(archive.length, 1);
  assert.equal(archive[0].archive_key, '55');
  assert.equal(archive[0].id, 55);
  assert.equal(archive[0].hack_kind, 'build');
  assert.equal('is_case' in archive[0], false);
  assert.equal('verdict' in archive[0], false);
});

test('decisions from Supabase keep a committed hackathon past the prune', async () => {
  const { dir, db } = setup({}, { listings: [{ ...oldClosed, comp_end: '2026-09-01' }], tables: { decisions: [{ id: '55', status: 'entering', registered: false }] } });
  await go(dir, db);
  assert.ok(db.listings.some(r => r.id === 55));
});

test('Supabase decisions unreadable: nothing is pruned, with a warning', async () => {
  const { dir, db } = setup({}, { listings: [oldClosed], tables: { decisions: new Error('HTTP 503') } });
  assert.equal(await go(dir, db), 0);
  assert.ok(db.listings.some(r => r.id === 55));
  assert.deepEqual(db.syncs[0].archive, []);
  assert.ok(db.status.warnings.some(w => w.startsWith('decisions:')));
});

test('a broken hack-curated.json warns and keeps the previous hk- records', async () => {
  const prev = { id: 'hk-sih', source: 'curated', title: 'Smart India Hackathon', tier: 'national', hack_kind: 'build', main: true, regn_close: null, first_seen: '2026-09-01', closed_on: null };
  const { dir, db } = setup({ 'hack-curated.json': '{bad' }, { listings: [prev] });
  assert.equal(await go(dir, db), 0);
  assert.ok(db.listings.some(r => r.id === 'hk-sih'));
  assert.ok(db.status.warnings.some(w => w.includes('hack-curated.json')));
});

test('unverified curated rows are left out', async () => {
  const { dir, db } = setup({ 'hack-curated.json': [curatedRow({ id: 'hk-x', verified: false })] });
  await go(dir, db);
  assert.equal(db.listings.some(r => r.id === 'hk-x'), false);
});

test('data/hack-curated.json rows are well-formed (hk- ids, build/ideathon, corporate/national, https urls)', () => {
  const rows = JSON.parse(fs.readFileSync(new URL('../data/hack-curated.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(rows) && rows.length > 0);
  const ids = new Set();
  for (const r of rows) {
    assert.match(r.id, /^hk-[a-z0-9-]+$/);
    assert.equal(ids.has(r.id), false, `duplicate ${r.id}`);
    ids.add(r.id);
    assert.ok(['build', 'ideathon'].includes(r.kind), r.id);
    assert.ok(['corporate', 'national'].includes(r.tier), r.id);
    assert.match(r.url, /^https:\/\//);
    assert.ok(r.watch_url === null || /^https:\/\//.test(r.watch_url), r.id);
    assert.equal(typeof r.verified, 'boolean');
    for (const k of ['application_months', 'finals_months']) {
      assert.ok(r[k] === null || (Array.isArray(r[k]) && r[k].every(m => Number.isInteger(m) && m >= 1 && m <= 12)), `${r.id} ${k}`);
    }
  }
});

test('data/hack-team.json is the two-member growable team', () => {
  const t = JSON.parse(fs.readFileSync(new URL('../data/hack-team.json', import.meta.url), 'utf8'));
  assert.equal(t.can_grow, true);
  assert.deepEqual(t.members.map(m => [m.name, m.level, m.year]), [['Krishna', 'ug', 2029], ['Akshit', 'ug', 2028]]);
});
