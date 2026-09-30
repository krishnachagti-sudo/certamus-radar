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

function dataDir(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-hack-'));
  const files = {
    'hack-team.json': TEAM,
    'national.json': [{ name: 'NIT', host: '\\bNITs?\\b|National Institute of Technology' }],
    'bschools.json': [],
    'hack-corporates.json': [{ name: 'Flipkart', host: '\\bFlipkart\\b' }],
    'hackathons.json': [],
    'hack-status.json': { last_ok: '2026-09-28T00:30:00.000Z' },
    'hack-curated.json': [curatedRow()],
    ...over,
  };
  for (const [f, v] of Object.entries(files)) {
    if (v === undefined) continue;
    fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return dir;
}
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const sb = (tables = {}) => ({
  url: 'https://test.supabase.co', anonKey: 'anon',
  getJson: async url => {
    const t = new URL(url).pathname.split('/').pop();
    if (tables[t] instanceof Error) throw tables[t];
    return tables[t] ?? [];
  },
});
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
function deps({ unstop = [unstopItem(1)], devfolio = [dfHit()], mlh = [mlhEvent()], devpost = [dpItem()], fail = [], supabase = sb() } = {}) {
  const boom = name => { throw new Error(`${name} down`); };
  return {
    supabase,
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

test('success: all sources land in hackathons.json with source, kind, tier, verdict and main', async () => {
  const dir = dataDir();
  const code = await main({ dataDir: dir, now, deps: deps() });
  assert.equal(code, 0);
  const recs = read(dir, 'hackathons.json');
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
  const st = read(dir, 'hack-status.json');
  assert.equal(st.last_ok, now.toISOString());
  assert.equal(st.last_error, null);
  assert.deepEqual(st.warnings, []);
  assert.deepEqual(Object.keys(st.sources).sort(), ['curated', 'devfolio', 'devpost', 'mlh', 'unstop']);
  assert.ok(Object.values(st.sources).every(s => s.ok));
});

test('privacy: no body text, FAQ answers, facts, raw eligibility or contact details are written', async () => {
  const dir = dataDir();
  await main({ dataDir: dir, now, deps: deps() });
  const raw = fs.readFileSync(path.join(dir, 'hackathons.json'), 'utf8');
  assert.doesNotMatch(raw, /\b[6-9][0-9]{9}\b/);
  assert.doesNotMatch(raw, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/);
  for (const r of JSON.parse(raw)) {
    for (const k of ['details_text', 'eligibility', 'facts', 'carried_over']) assert.equal(k in r, false, `${r.id} has ${k}`);
  }
});

test('kinds: excluded formats stay in the file as hack_kind other, off the main list; ideathons are kept', async () => {
  const dir = dataDir();
  const unstop = [unstopItem(1), unstopItem(2, { title: 'Capture The Flag (CTF)' }), unstopItem(3, { title: 'Junior Ideathon' })];
  await main({ dataDir: dir, now, deps: deps({ unstop }) });
  const recs = read(dir, 'hackathons.json');
  const ctf = recs.find(r => r.id === 2);
  assert.equal(ctf.hack_kind, 'other');
  assert.equal(ctf.main, false);
  assert.equal(recs.find(r => r.id === 3).hack_kind, 'ideathon');
});

test('tiers: an unlisted host is tier other and off the main list', async () => {
  const dir = dataDir();
  await main({ dataDir: dir, now, deps: deps({ unstop: [unstopItem(4, { organisation: { name: 'WeCodeCoders' } })] }) });
  const r = read(dir, 'hackathons.json').find(x => x.id === 4);
  assert.equal(r.tier, 'other');
  assert.equal(r.main, false);
});

for (const source of ['unstop', 'devfolio', 'mlh', 'devpost']) {
  test(`a failing ${source} is a warning: its previous records pass through, the run succeeds`, async () => {
    const prev = { id: `prev-${source}`, source, title: 'Yesterday', tier: 'global', hack_kind: 'build', main: true,
      verdict: { level: 'fits', reasons: [] }, regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null };
    const dir = dataDir({ 'hackathons.json': [prev] });
    const code = await main({ dataDir: dir, now, deps: deps({ fail: [source] }) });
    assert.equal(code, 0);
    const kept = read(dir, 'hackathons.json').find(r => r.id === prev.id);
    assert.equal(kept.closed_on, null);
    assert.equal(kept.tier, 'global');
    const st = read(dir, 'hack-status.json');
    assert.equal(st.last_error, null);
    assert.ok(st.warnings.some(w => w.includes(`${source} down`)));
    assert.equal(st.sources[source].ok, false);
  });
}

test('every fetched source failing fails the run and leaves hackathons.json untouched', async () => {
  const dir = dataDir({ 'hackathons.json': [{ id: 9, source: 'unstop', title: 'x' }] });
  const before = fs.readFileSync(path.join(dir, 'hackathons.json'), 'utf8');
  const code = await main({ dataDir: dir, now, deps: deps({ fail: ['unstop', 'devfolio', 'mlh', 'devpost'] }) });
  assert.equal(code, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'hackathons.json'), 'utf8'), before);
  const st = read(dir, 'hack-status.json');
  assert.equal(st.last_ok, '2026-09-28T00:30:00.000Z');
  assert.match(st.last_error, /every hackathon source failed/);
});

test('a corrupt hackathons.json is never overwritten: the run fails', async () => {
  const dir = dataDir({ 'hackathons.json': '{not json' });
  const code = await main({ dataDir: dir, now, deps: deps() });
  assert.equal(code, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'hackathons.json'), 'utf8'), '{not json');
  assert.match(read(dir, 'hack-status.json').last_error, /hackathons\.json/);
});

test('a missing hackathons.json starts a new one', async () => {
  const dir = dataDir({ 'hackathons.json': undefined });
  assert.equal(await main({ dataDir: dir, now, deps: deps() }), 0);
  assert.ok(read(dir, 'hackathons.json').length > 0);
});

const oldClosed = { id: 55, source: 'unstop', title: 'Old hack', tier: 'national', hack_kind: 'build', main: true,
  regn_close: '2026-06-01', comp_end: '2026-06-10', first_seen: '2026-05-01', closed_on: '2026-06-02', verdict: { level: 'fits', reasons: [] } };

test('prune: a record closed over 60 days ago moves to hack-archive.json with hack_kind', async () => {
  const dir = dataDir({ 'hackathons.json': [oldClosed] });
  await main({ dataDir: dir, now, deps: deps() });
  assert.equal(read(dir, 'hackathons.json').some(r => r.id === 55), false);
  const arch = read(dir, 'hack-archive.json');
  assert.equal(arch.length, 1);
  assert.equal(arch[0].id, 55);
  assert.equal(arch[0].hack_kind, 'build');
  assert.equal('is_case' in arch[0], false);
  assert.equal('verdict' in arch[0], false);
});

test('decisions from Supabase keep a committed hackathon past the prune', async () => {
  const dir = dataDir({ 'hackathons.json': [{ ...oldClosed, comp_end: '2026-09-01' }] });
  await main({ dataDir: dir, now, deps: deps({ supabase: sb({ decisions: [{ id: '55', status: 'entering', registered: false }] }) }) });
  assert.ok(read(dir, 'hackathons.json').some(r => r.id === 55));
});

test('Supabase decisions unreadable: nothing is pruned, with a warning', async () => {
  const dir = dataDir({ 'hackathons.json': [oldClosed] });
  const code = await main({ dataDir: dir, now, deps: deps({ supabase: sb({ decisions: new Error('HTTP 503') }) }) });
  assert.equal(code, 0);
  assert.ok(read(dir, 'hackathons.json').some(r => r.id === 55));
  assert.ok(read(dir, 'hack-status.json').warnings.some(w => w.startsWith('decisions:')));
});

test('a broken hack-curated.json warns and keeps the previous hk- records', async () => {
  const prev = { id: 'hk-sih', source: 'curated', title: 'Smart India Hackathon', tier: 'national', hack_kind: 'build', main: true, regn_close: null, first_seen: '2026-09-01', closed_on: null };
  const dir = dataDir({ 'hack-curated.json': '{bad', 'hackathons.json': [prev] });
  assert.equal(await main({ dataDir: dir, now, deps: deps() }), 0);
  assert.ok(read(dir, 'hackathons.json').some(r => r.id === 'hk-sih'));
  assert.ok(read(dir, 'hack-status.json').warnings.some(w => w.includes('hack-curated.json')));
});

test('unverified curated rows are left out', async () => {
  const dir = dataDir({ 'hack-curated.json': [curatedRow({ id: 'hk-x', verified: false })] });
  await main({ dataDir: dir, now, deps: deps() });
  assert.equal(read(dir, 'hackathons.json').some(r => r.id === 'hk-x'), false);
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
