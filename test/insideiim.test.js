import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseInsideIim, insideiimRecords, fetchInsideIim, INSIDEIIM_URL } from '../fetch/insideiim.js';

const fixture = fs.readFileSync(new URL('./fixtures/insideiim.html', import.meta.url), 'utf8');
const today = '2026-09-29';

// A minimal Next.js page carrying one flight row with the given competitions,
// plus a text row that one of them can point its description at.
function page(comps, textRows = {}) {
  let payload = '';
  for (const [id, text] of Object.entries(textRows)) payload += `${id}:T${Buffer.byteLength(text).toString(16)},${text}`;
  payload += `5:${JSON.stringify(['$', 'div', null, { competitions: comps }])}\n`;
  return `<html><body><script>self.__next_f.push(${JSON.stringify([1, payload])})</script></body></html>`;
}
const comp = (over = {}) => ({
  _id: 'abc123', slug: 'x-case-2026', title: 'X Challenge 2026', description: '<p>Build a plan.</p>',
  registrationEnd: '2026-10-20T18:29:00.000Z', externalLink: '', type: 'ONAPP', eligibility: '<p>Students.</p>',
  status: 'ACTIVE', organization: { _id: 'o1', name: 'Xco', contactUs: { email: 'a@b.com', phone: '9876543210' } },
  campuses: [], ...over,
});

// ---- parser ---------------------------------------------------------------

test('fixture: parses every ACTIVE competition from the flight payload', () => {
  const items = parseInsideIim(fixture);
  assert.equal(items.length, 20);
  assert.ok(items.every(i => i.status === 'ACTIVE'));
  const cummins = items.find(i => i.slug === 'cummins-redefine-2026');
  assert.equal(cummins.id, '6a955d1e110d4314a62ed69e');
  assert.equal(cummins.title, 'Cummins Redefine 2026');
  assert.equal(cummins.host, 'Cummins');
  assert.equal(cummins.deadline, '2026-10-05T12:30:00.000Z');
  assert.equal(cummins.url, 'https://insidekampus.com/competition/cummins-redefine-2026');
  assert.equal(cummins.campuses.length, 13);
  assert.ok(cummins.campuses.includes('DoMS IIT Delhi'));
});

test('fixture: per-campus rounds carry their campuses; EXTERNAL listings keep their insideiim.com link', () => {
  const items = parseInsideIim(fixture);
  const blr = items.find(i => i.slug === 'reckitt-dare-2026-iim-bangalore');
  assert.equal(blr.title, 'Reckitt DARE 2026 - IIM Bangalore');
  assert.equal(blr.host, 'Reckitt');
  assert.deepEqual(blr.campuses, ['Indian Institute of Management, Bangalore (IIM)']);
  const ext = items.find(i => i.slug === 'emergevictorious-with-invictas');
  assert.equal(ext.url, 'https://insideiim.com/invictas');
});

test('fixture: descriptions are read through text-row references but never returned', () => {
  const items = parseInsideIim(fixture);
  for (const i of items) {
    assert.deepEqual(Object.keys(i).sort(), ['campuses', 'deadline', 'host', 'id', 'open_to_all', 'says_case', 'slug', 'status', 'title', 'url']);
  }
  // Cummins' description is a "$37"-style reference to a text row.
  assert.equal(typeof items.find(i => i.slug === 'cummins-redefine-2026').says_case, 'boolean');
});

test('parser keeps only ACTIVE items', () => {
  const items = parseInsideIim(page([comp(), comp({ _id: 'b', slug: 'b', status: 'INACTIVE' }), comp({ _id: 'c', slug: 'c', status: 'COMPLETED' })]));
  assert.deepEqual(items.map(i => i.id), ['abc123']);
});

test('parser resolves a description reference to decide says_case', () => {
  const items = parseInsideIim(page([comp({ description: '$a' })], { a: '<p>Solve a real case study from our\nsupply chain.</p>' }));
  assert.equal(items[0].says_case, true);
  assert.equal(parseInsideIim(page([comp()]))[0].says_case, false);
});

test('parser reads "open to all" from eligibility, and campus names', () => {
  const [a] = parseInsideIim(page([comp({ eligibility: '<p>This competition is open to all students.</p>' })]));
  assert.equal(a.open_to_all, true);
  const [b] = parseInsideIim(page([comp({ campuses: [{ campus: { name: 'Indian Institute of Management, Sirmaur (IIM)' } }] })]));
  assert.deepEqual(b.campuses, ['Indian Institute of Management, Sirmaur (IIM)']);
  assert.equal(b.open_to_all, false);
});

test('parser also reads a __NEXT_DATA__ page', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { list: [comp()] } } })}</script>`;
  assert.deepEqual(parseInsideIim(html).map(i => i.id), ['abc123']);
});

test('parser throws when the page carries no competitions at all', () => {
  assert.throws(() => parseInsideIim('<html>maintenance</html>'), /shape/);
  assert.throws(() => parseInsideIim(page([])), /shape/);
});

test('parser drops a non-https link to the canonical competition page', () => {
  const [i] = parseInsideIim(page([comp({ type: 'EXTERNAL', externalLink: 'javascript:alert(1)' })]));
  assert.equal(i.url, 'https://insidekampus.com/competition/x-case-2026');
  const [j] = parseInsideIim(page([comp({ type: 'EXTERNAL', externalLink: 'https://evil.example/x' })]));
  assert.equal(j.url, 'https://insidekampus.com/competition/x-case-2026');
});

// ---- mapping --------------------------------------------------------------

const item = (over = {}) => ({
  id: 'abc123', slug: 'x-case-2026', title: 'X Challenge 2026', host: 'Xco', status: 'ACTIVE',
  deadline: '2026-10-20T18:29:00.000Z', url: 'https://insidekampus.com/competition/x-case-2026',
  campuses: [], says_case: false, open_to_all: false, ...over,
});

test('mapping: fields, corporate tier, IST deadline, business by default', () => {
  const [r] = insideiimRecords([item()], today);
  assert.deepEqual(r, {
    id: 'iim-abc123', source: 'insideiim', pinned: false, title: 'X Challenge 2026', host: 'Xco', tier: 'corporate',
    url: 'https://insidekampus.com/competition/x-case-2026', format: 'insideiim', format_kind: 'business', is_case: true,
    kind: 'business', team_max: null, regn_close: '2026-10-20', comp_end: null,
    verdict: { level: 'check', reasons: ['Eligibility on InsideIIM'] },
  });
});

test('mapping: case when the title or the description says case', () => {
  assert.equal(insideiimRecords([item({ title: 'Y Case Challenge' })], today)[0].format_kind, 'case');
  assert.equal(insideiimRecords([item({ says_case: true })], today)[0].format_kind, 'case');
});

test('mapping: a per-campus round names the campus in the host', () => {
  const [r] = insideiimRecords([item({ title: 'Reckitt DARE 2026 - IIM Bangalore', host: 'Reckitt',
    campuses: ['Indian Institute of Management, Bangalore (IIM)'] })], today);
  assert.equal(r.host, 'Reckitt – IIM Bangalore');
  const [s] = insideiimRecords([item({ title: 'Z Round', host: 'Zco', campuses: ['Faculty of Management Studies, Delhi (FMS)'] })], today);
  assert.equal(s.host, 'Zco – Faculty of Management Studies, Delhi (FMS)');
  // A trailing segment with no campus list is not a campus.
  const [t] = insideiimRecords([item({ title: 'Best MBA - 2027 | Season 13', host: 'InsideIIM' })], today);
  assert.equal(t.host, 'InsideIIM');
});

test('mapping: verdicts', () => {
  const v = over => insideiimRecords([item(over)], today)[0].verdict;
  assert.deepEqual(v({ campuses: ['Indian Institute of Management, Bangalore (IIM)'] }),
    { level: 'check', reasons: ['Campus-restricted: check whether IIM Sirmaur is an eligible campus'] });
  assert.deepEqual(v({ campuses: ['IIM Bangalore', 'Indian Institute of Management, Sirmaur (IIM)'] }), { level: 'fits', reasons: [] });
  assert.deepEqual(v({ open_to_all: true }), { level: 'fits', reasons: [] });
  assert.deepEqual(v({}), { level: 'check', reasons: ['Eligibility on InsideIIM'] });
});

test('mapping: skips items whose deadline has passed, keeps undated ones and today', () => {
  const recs = insideiimRecords([
    item({ id: 'old', deadline: '2026-07-14T19:30:00.000Z' }),
    item({ id: 'today', deadline: '2026-09-29T10:00:00.000Z' }),
    item({ id: 'nodate', deadline: null }),
  ], today);
  assert.deepEqual(recs.map(r => [r.id, r.regn_close]), [['iim-today', '2026-09-29'], ['iim-nodate', null]]);
});

test('mapping: drops items with no id, no title or a non-https url', () => {
  const recs = insideiimRecords([item({ id: '' }), item({ title: '' }), item({ url: 'http://insideiim.com/x' }), null], today);
  assert.equal(recs.length, 0);
});

test('fixture end to end: no body text or contact details on records', () => {
  const recs = insideiimRecords(parseInsideIim(fixture), today);
  assert.deepEqual(recs.map(r => r.id).sort(), ['iim-6a955d1e110d4314a62ed69e', 'iim-6aacf58c9f46739d7b37bd6f', 'iim-6ab2385364b0579d4cc3ad47'].sort());
  const allowed = ['id', 'source', 'pinned', 'title', 'host', 'tier', 'url', 'format', 'format_kind', 'is_case', 'kind', 'team_max', 'regn_close', 'comp_end', 'verdict'];
  for (const r of recs) assert.deepEqual(Object.keys(r), allowed);
  const json = JSON.stringify(recs);
  assert.doesNotMatch(json, /"description"|"eligibility"|<p>|contactUs/i);
  assert.doesNotMatch(json, /\b[6-9][0-9]{9}\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/);
  const synthetic = JSON.stringify(insideiimRecords(parseInsideIim(page([comp()])), today));
  assert.doesNotMatch(synthetic, /a@b\.com|9876543210|Build a plan/);
});

// ---- fetch ----------------------------------------------------------------

test('fetch: one request, to the competitions page only, then a pause', async () => {
  const urls = [];
  let pauses = 0;
  const html = await fetchInsideIim({ getText: async u => { urls.push(u); return 'x'; }, pause: async () => { pauses++; } });
  assert.equal(html, 'x');
  assert.deepEqual(urls, ['https://insideiim.com/competitions']);
  assert.equal(INSIDEIIM_URL, 'https://insideiim.com/competitions');
  assert.doesNotMatch(urls[0], /\/api\//);
  assert.equal(pauses, 1);
});

test('fetch: an error propagates (run.js turns it into a warning)', async () => {
  await assert.rejects(fetchInsideIim({ getText: async () => { throw new Error('HTTP 503 for x'); }, pause: async () => {} }), /503/);
});
