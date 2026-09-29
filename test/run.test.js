import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../fetch/run.js';

function dataDir(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
  const files = {
    'team.json': { size: 4, passout_years: [2029] },
    'keywords.json': ['case'],
    'bschools.json': [],
    'corporates.json': [],
    'competitions.json': [{ id: 77, title: 'Old', regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null }],
    'decisions.json': {},
    'manual.json': [],
    'status.json': { last_ok: '2026-09-28T00:30:00.000Z' },
    'international.json': [],
    'intl-dates.json': {},
    ...over,
  };
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  return dir;
}
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f)));
const item = {
  id: 1, title: 'Ops', updated_at: 'x', end_date: '2026-11-09T21:25:00+05:30',
  organisation: { name: 'Indian Institute of Management (IIM), Raipur' },
  regnRequirements: { min_team_size: 2, max_team_size: 3, end_regn_dt: '2026-11-09T21:25:00+05:30', eligibility: '{"sector":["students"],"others":["all"]}' },
  filters: [{ name: 'All', type: 'eligible' }], prizes: [], isPaid: false, region: 'online',
  details: '<p>All students.</p>',
};
const now = new Date('2026-09-29T00:30:00Z');
// Older tests are about Unstop: Opportunity Desk answers with no posts.
const noOd = getJson => async url => (url.startsWith('https://opportunitydesk.org/') ? [] : getJson(url));

test('success writes classified competitions and a clean status', async () => {
  const dir = dataDir();
  const getJson = async url => ({ data: { data: [item], last_page: 1 } });
  const code = await main({ dataDir: dir, now, deps: { getJson: noOd(getJson), pause: async () => {} } });
  assert.equal(code, 0);
  const comps = read(dir, 'competitions.json');
  const ops = comps.find(c => c.id === 1);
  assert.equal(ops.tier, 'iim');
  assert.equal(ops.verdict.level, 'fits');
  assert.equal(comps.find(c => c.id === 77).closed_on, '2026-09-29');
  const st = read(dir, 'status.json');
  assert.equal(st.last_ok, now.toISOString());
  assert.equal(st.last_error, null);
  assert.deepEqual(st.warnings, []);
});

test('a record that fails classification does not fail the run', async () => {
  const dir = dataDir({ 'bschools.json': [{ host: '(' }] });
  const badHostItem = { ...item, organisation: { name: 'Acme Corp' } };
  const getJson = async url => ({ data: { data: [badHostItem], last_page: 1 } });
  const code = await main({ dataDir: dir, now, deps: { getJson: noOd(getJson), pause: async () => {} } });
  assert.equal(code, 0);
  const comps = read(dir, 'competitions.json');
  assert.ok(comps.find(c => c.id === 1));
  const st = read(dir, 'status.json');
  assert.ok(st.warnings.some(w => w.includes('classify')));
});

test('a non-array manual.json is treated as empty', async () => {
  const dir = dataDir({ 'manual.json': {} });
  const getJson = async url => ({ data: { data: [item], last_page: 1 } });
  const code = await main({ dataDir: dir, now, deps: { getJson: noOd(getJson), pause: async () => {} } });
  assert.equal(code, 0);
});

test('manual.json entries without a string url are skipped', async () => {
  const dir = dataDir({ 'manual.json': [null, { url: 5 }] });
  const getJson = async url => ({ data: { data: [item], last_page: 1 } });
  const code = await main({ dataDir: dir, now, deps: { getJson: noOd(getJson), pause: async () => {} } });
  assert.equal(code, 0);
});

test('failure leaves competitions untouched and records the error', async () => {
  const dir = dataDir();
  const before = fs.readFileSync(path.join(dir, 'competitions.json'), 'utf8');
  const code = await main({ dataDir: dir, now, deps: { getJson: noOd(async () => ({ data: {} })), pause: async () => {} } });
  assert.equal(code, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'competitions.json'), 'utf8'), before);
  const st = read(dir, 'status.json');
  assert.equal(st.last_ok, '2026-09-28T00:30:00.000Z');
  assert.equal(st.last_run, now.toISOString());
  assert.match(st.last_error, /shape/);
});

test('published competitions.json carries no listing body text or contact details', async () => {
  const dir = dataDir({
    'competitions.json': [{ id: 77, title: 'Old', regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null,
      details_text: 'Old body, mail old@example.org or 9123456789', eligibility: { others: ['all'] } }],
  });
  const leaky = { ...item, details: '<p>All students. Call Riya 9876543210 or riya@example.edu</p>' };
  const getJson = async url => ({ data: { data: [leaky], last_page: 1 } });
  const code = await main({ dataDir: dir, now, deps: { getJson: noOd(getJson), pause: async () => {} } });
  assert.equal(code, 0);
  const raw = fs.readFileSync(path.join(dir, 'competitions.json'), 'utf8');
  const comps = JSON.parse(raw);
  for (const c of comps) {
    assert.equal('details_text' in c, false);
    assert.equal('eligibility' in c, false);
  }
  assert.doesNotMatch(raw, /\b[6-9]\d{9}\b/);
  assert.doesNotMatch(raw, /[\w.+-]+@[\w-]+\.[\w.]+/);
  // classification still ran on the body before it was dropped
  assert.equal(comps.find(c => c.id === 1).verdict.level, 'fits');
});

test('a carried-over manual record keeps its stored tier and verdict', async () => {
  const stored = { id: 55, title: 'Kept', host: 'Acme', tier: 'iim', pinned: true, details_fetched: true,
    verdict: { level: 'fits', reasons: [] }, regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null };
  const dir = dataDir({ 'competitions.json': [stored], 'manual.json': [{ url: 'https://unstop.com/competitions/kept-55' }] });
  const getJson = async url => {
    if (url.includes('/competition/55')) throw new Error('HTTP 500');
    return { data: { data: [item], last_page: 1 } };
  };
  const code = await main({ dataDir: dir, now, deps: { getJson: noOd(getJson), pause: async () => {} } });
  assert.equal(code, 0);
  const kept = read(dir, 'competitions.json').find(c => c.id === 55);
  assert.equal(kept.tier, 'iim');
  assert.deepEqual(kept.verdict, { level: 'fits', reasons: [] });
  assert.equal(kept.pinned, true);
  assert.equal('carried_over' in kept, false);
});

test('a pruned record lands in archive.json once, slim', async () => {
  const old = { id: 88, title: 'Gone', host: 'IIM X', tier: 'iim', url: 'https://unstop.com/gone-88', regn_close: '2026-06-01',
    comp_end: '2026-06-10', first_seen: '2026-05-01', closed_on: '2026-06-02', format: 'case_competition', is_case: true,
    verdict: { level: 'fits', reasons: [] } };
  const dir = dataDir({ 'competitions.json': [old] });
  const getJson = async url => ({ data: { data: [item], last_page: 1 } });
  assert.equal(await main({ dataDir: dir, now, deps: { getJson: noOd(getJson), pause: async () => {} } }), 0);
  assert.equal(read(dir, 'competitions.json').some(c => c.id === 88), false);
  const arch = read(dir, 'archive.json');
  assert.deepEqual(arch.map(a => a.id), [88]);
  assert.equal('verdict' in arch[0], false);
  // a second run does not duplicate it
  fs.writeFileSync(path.join(dir, 'competitions.json'), JSON.stringify([old]));
  assert.equal(await main({ dataDir: dir, now, deps: { getJson: noOd(getJson), pause: async () => {} } }), 0);
  assert.equal(read(dir, 'archive.json').length, 1);
});

const intlRow = { id: 'intl-z', name: 'Z Case Cup', url: 'https://z.example/', watch_url: 'https://z.example/', host: 'Z School',
  kind: 'case', entry: 'invite', who_applies: 'school', indian_ug: 'unclear', indian_ug_note: 'n', application_months: null,
  finals_months: [3], team_size: '4', fee: null, last_edition: null, verified: true };
const odPost = { id: 901, link: 'https://opportunitydesk.org/2026/09/20/z-case/', title: { rendered: 'Z Global Case Competition' },
  content: { rendered: '<p>Mail a@b.org</p><p>Deadline: December 1, 2026</p>' }, date: '2026-09-20T00:00:00' };
const router = ({ od = async () => [odPost] } = {}) => async url =>
  (url.startsWith('https://opportunitydesk.org/') ? od(url) : { data: { data: [item], last_page: 1 } });

test('curated and Opportunity Desk records are added as international, unclassified', async () => {
  const dir = dataDir({ 'international.json': [intlRow], 'intl-dates.json': { 'intl-z': { regn_close: '2026-11-20', comp_end: '2027-03-10', confirmed_on: '2026-09-29' } } });
  const code = await main({ dataDir: dir, now, deps: { getJson: router(), pause: async () => {} } });
  assert.equal(code, 0);
  const comps = read(dir, 'competitions.json');
  const z = comps.find(c => c.id === 'intl-z');
  assert.equal(z.tier, 'international');
  assert.equal(z.source, 'curated');
  assert.deepEqual(z.verdict, { level: 'check', reasons: ['IIM Sirmaur must apply for an invitation'] });
  assert.equal(z.regn_close, '2026-11-20');
  assert.equal(z.first_seen, '2026-09-29');
  const od = comps.find(c => c.id === 'od-901');
  assert.equal(od.tier, 'international');
  assert.equal(od.verdict.level, 'check');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'competitions.json'), 'utf8'), /a@b\.org/);
  assert.deepEqual(read(dir, 'status.json').warnings, []);
});

test('an Opportunity Desk failure is a warning and keeps the previous od- records', async () => {
  const prevOd = { id: 'od-5', source: 'oppdesk', title: 'Prev Case', host: 'Opportunity Desk listing', tier: 'international',
    url: 'https://opportunitydesk.org/p/5/', regn_close: '2026-12-01', verdict: { level: 'check', reasons: ['verify eligibility on the post'] },
    first_seen: '2026-09-01', closed_on: null, is_case: true };
  const dir = dataDir({ 'competitions.json': [prevOd] });
  const getJson = router({ od: async () => { throw new Error('HTTP 503 for od'); } });
  const code = await main({ dataDir: dir, now, deps: { getJson, pause: async () => {} } });
  assert.equal(code, 0);
  const kept = read(dir, 'competitions.json').find(c => c.id === 'od-5');
  assert.equal(kept.closed_on, null);
  assert.equal(kept.tier, 'international');
  assert.equal(kept.first_seen, '2026-09-01');
  assert.ok(read(dir, 'status.json').warnings.some(w => /Opportunity Desk/.test(w) && /503/.test(w)));
});

const prevCurated = { id: 'intl-z', source: 'curated', title: 'Z Case Cup', host: 'Z School', tier: 'international',
  url: 'https://z.example/', regn_close: '2026-11-20', comp_end: '2027-03-10', first_seen: '2026-09-01', closed_on: null,
  verdict: { level: 'check', reasons: ['IIM Sirmaur must apply for an invitation'] }, is_case: true };

for (const [label, files] of [
  ['a non-array international.json', { 'international.json': { nope: 1 } }],
  ['an unparseable international.json', { 'international.json': '{not json' }],
  ['a non-object intl-dates.json', { 'international.json': [intlRow], 'intl-dates.json': [1, 2] }],
  ['an unparseable intl-dates.json', { 'international.json': [intlRow], 'intl-dates.json': '{oops' }],
]) {
  test(`${label} warns and passes previous curated records through unchanged`, async () => {
    const dir = dataDir({ 'competitions.json': [prevCurated], ...files });
    assert.equal(await main({ dataDir: dir, now, deps: { getJson: router(), pause: async () => {} } }), 0);
    const z = read(dir, 'competitions.json').find(c => c.id === 'intl-z');
    assert.equal(z.closed_on, null);
    assert.equal(z.regn_close, '2026-11-20');
    assert.equal(z.first_seen, '2026-09-01');
    assert.ok(read(dir, 'status.json').warnings.some(w => /curated/i.test(w)));
  });
}

test('a corrupt archive.json is never overwritten: warn and skip the archive write', async () => {
  const old = { id: 88, title: 'Gone', regn_close: '2026-06-01', first_seen: '2026-05-01', closed_on: '2026-06-02' };
  for (const bad of ['[{broken', '{"a":1}']) {
    const dir = dataDir({ 'competitions.json': [old], 'archive.json': bad });
    assert.equal(await main({ dataDir: dir, now, deps: { getJson: router(), pause: async () => {} } }), 0);
    assert.equal(fs.readFileSync(path.join(dir, 'archive.json'), 'utf8'), bad);
    assert.ok(read(dir, 'status.json').warnings.some(w => /archive/.test(w)));
  }
});

test('a missing archive.json starts a new one', async () => {
  const old = { id: 88, title: 'Gone', regn_close: '2026-06-01', first_seen: '2026-05-01', closed_on: '2026-06-02' };
  const dir = dataDir({ 'competitions.json': [old] });
  assert.equal(await main({ dataDir: dir, now, deps: { getJson: router(), pause: async () => {} } }), 0);
  assert.deepEqual(read(dir, 'archive.json').map(a => a.id), [88]);
});

test('previous Opportunity Desk records missing from the fetch window pass through while still open', async () => {
  const od = (id, regn_close) => ({ id, source: 'oppdesk', title: 'Case', host: 'Opportunity Desk listing', tier: 'international',
    url: `https://opportunitydesk.org/p/${id}/`, regn_close, first_seen: '2026-05-01', closed_on: null, is_case: true,
    verdict: { level: 'check', reasons: ['verify eligibility on the post'] } });
  const dir = dataDir({ 'competitions.json': [od('od-1', '2026-10-15'), od('od-2', '2026-09-29'), od('od-3', '2026-09-20')] });
  assert.equal(await main({ dataDir: dir, now, deps: { getJson: router({ od: async () => [] }), pause: async () => {} } }), 0);
  const comps = read(dir, 'competitions.json');
  assert.equal(comps.find(c => c.id === 'od-1').closed_on, null);
  assert.equal(comps.find(c => c.id === 'od-2').closed_on, null);
  assert.equal(comps.find(c => c.id === 'od-3').closed_on, '2026-09-29');
});

test('a curated edition is archived once when its confirmed regn_close passes, and the record stays', async () => {
  const dir = dataDir({ 'international.json': [intlRow], 'intl-dates.json': { 'intl-z': { regn_close: '2026-09-01', comp_end: '2026-09-10', confirmed_on: '2026-08-01' } } });
  for (const at of ['2026-09-29T00:30:00Z', '2026-11-05T00:30:00Z', '2026-12-01T00:30:00Z']) {
    assert.equal(await main({ dataDir: dir, now: new Date(at), deps: { getJson: router({ od: async () => [] }), pause: async () => {} } }), 0);
  }
  assert.ok(read(dir, 'competitions.json').some(c => c.id === 'intl-z'));
  const arch = read(dir, 'archive.json');
  assert.deepEqual(arch.filter(a => String(a.id).startsWith('intl-')).map(a => a.archive_key), ['intl-z@2026-09-01']);
});
