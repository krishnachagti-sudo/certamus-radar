import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { curatedRecords, oppdeskRecords, parseDeadline } from '../fetch/intl.js';
import { isCaseTitle } from '../fetch/unstop.js';
import { httpsUrl } from '../urls.js';

const today = '2026-09-29';
const row = (over = {}) => ({
  id: 'intl-x', name: 'X Case Cup', url: 'https://x.example/', watch_url: 'https://x.example/rules', host: 'X School',
  country: 'Canada', level: 'undergrad', kind: 'case', entry: 'open', entry_note: 'Open application',
  who_applies: 'team', indian_ug: 'yes', indian_ug_note: 'Open to all undergraduates',
  application_months: [10], finals_months: [1], team_size: '3–4', fee: null, last_edition: 'Jan 2026', verified: true, ...over,
});

test('curated mapping: fields, tier, source, string id, expected months, intl block', () => {
  const [r] = curatedRecords([row()], {}, today);
  assert.equal(r.id, 'intl-x');
  assert.equal(typeof r.id, 'string');
  assert.equal(r.title, 'X Case Cup');
  assert.equal(r.tier, 'international');
  assert.equal(r.source, 'curated');
  assert.equal(r.format, 'curated');
  assert.equal(r.url, 'https://x.example/');
  assert.equal(r.host, 'X School');
  assert.equal(r.is_case, true);
  assert.equal(r.kind, 'case');
  assert.equal(r.team_max, 4);
  assert.equal(r.regn_close, null);
  assert.equal(r.comp_end, null);
  assert.deepEqual(r.expected, { application_months: [10], finals_months: [1] });
  assert.deepEqual(r.intl, {
    entry: 'open', entry_note: 'Open application', who_applies: 'team', indian_ug: 'yes',
    indian_ug_note: 'Open to all undergraduates', fee: null, last_edition: 'Jan 2026', watch_url: 'https://x.example/rules',
  });
  assert.deepEqual(r.verdict, { level: 'fits', reasons: [] });
});

test('team_max is the largest integer in team_size, else null', () => {
  const tm = ts => curatedRecords([row({ team_size: ts })], {}, today)[0].team_max;
  assert.equal(tm('Max 2 per stream; 3 in Business Policy'), 3);
  assert.equal(tm('4 + faculty advisor'), 4);
  assert.equal(tm('2–5, same university'), 5);
  assert.equal(tm('No restriction'), null);
  assert.equal(tm(null), null);
});

test('verdict: indian_ug no -> out with the note', () => {
  const [r] = curatedRecords([row({ indian_ug: 'no', indian_ug_note: 'Only CEMS members', who_applies: 'school' })], {}, today);
  assert.deepEqual(r.verdict, { level: 'out', reasons: ['Only CEMS members'] });
});

test('verdict: school applies -> check', () => {
  const [r] = curatedRecords([row({ who_applies: 'school', indian_ug: 'unclear' })], {}, today);
  assert.deepEqual(r.verdict, { level: 'check', reasons: ['IIM Sirmaur must apply for an invitation'] });
});

test('verdict: indian_ug unclear -> check with the note', () => {
  const [r] = curatedRecords([row({ indian_ug: 'unclear', indian_ug_note: 'Rules silent on Indian UG' })], {}, today);
  assert.deepEqual(r.verdict, { level: 'check', reasons: ['Rules silent on Indian UG'] });
});

test('unverified rows are skipped', () => {
  const out = curatedRecords([row(), row({ id: 'intl-y', verified: false })], {}, today);
  assert.deepEqual(out.map(r => r.id), ['intl-x']);
});

test('confirmed dates are applied; malformed dates are ignored', () => {
  const [r] = curatedRecords([row()], { 'intl-x': { regn_close: '2026-10-26', comp_end: '2027-01-11', confirmed_on: '2026-09-29' } }, today);
  assert.equal(r.regn_close, '2026-10-26');
  assert.equal(r.comp_end, '2027-01-11');
  const [bad] = curatedRecords([row()], { 'intl-x': { regn_close: 'soon', comp_end: 5 } }, today);
  assert.equal(bad.regn_close, null);
  assert.equal(bad.comp_end, null);
});

test('startup contests are not cases', () => {
  const [r] = curatedRecords([row({ kind: 'startup' })], {}, today);
  assert.equal(r.is_case, false);
  assert.equal(r.kind, 'startup');
});

test('non-https curated urls are dropped', () => {
  const [r] = curatedRecords([row({ url: 'javascript:alert(1)', watch_url: 'http://x.example/' })], {}, today);
  assert.equal(r.url, null);
  assert.equal(r.intl.watch_url, null);
});

test('the shipped international.json maps cleanly and carries no emails', () => {
  const raw = fs.readFileSync(new URL('../data/international.json', import.meta.url), 'utf8');
  assert.doesNotMatch(raw, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/);
  const list = JSON.parse(raw);
  const out = curatedRecords(list, {}, today);
  assert.equal(out.length, list.filter(r => r.verified !== false).length);
  for (const r of out) {
    assert.match(r.id, /^intl-/);
    assert.ok(r.url.startsWith('https://'));
  }
});

test('httpsUrl accepts any https url and nothing else', () => {
  assert.equal(httpsUrl('https://a.example/x?y=1'), 'https://a.example/x?y=1');
  assert.equal(httpsUrl('http://a.example/'), null);
  assert.equal(httpsUrl('javascript:alert(1)'), null);
  assert.equal(httpsUrl('data:text/html,hi'), null);
  assert.equal(httpsUrl(null), null);
});

test('isCaseTitle is the Unstop title rule', () => {
  assert.equal(isCaseTitle('Global Case Competition 2027'), true);
  assert.equal(isCaseTitle('Strategy Challenge'), true);
  assert.equal(isCaseTitle('Case Essay Contest'), false);
  assert.equal(isCaseTitle('Photography Contest'), false);
});

test('parseDeadline reads both date orders', () => {
  assert.equal(parseDeadline('Blah.\nDeadline: July 20, 2026\nMore'), '2026-07-20');
  assert.equal(parseDeadline('Deadline: 20 July 2026'), '2026-07-20');
  assert.equal(parseDeadline('Application Deadline: November 3rd, 2026'), '2026-11-03');
  assert.equal(parseDeadline('Deadline: Sept 5, 2026'), '2026-09-05');
  assert.equal(parseDeadline('Deadline: February 30, 2026'), null);
  assert.equal(parseDeadline('Deadline: Ongoing'), null);
  assert.equal(parseDeadline('no deadline here'), null);
});

const post = (over = {}) => ({
  id: 12345,
  link: 'https://opportunitydesk.org/2026/09/10/global-case-competition/',
  title: { rendered: 'Global Case Competition 2026 &#8211; Win $5,000' },
  content: { rendered: '<p>Open to students. Contact jane@example.org or 9876543210.</p><p><strong>Deadline:</strong> November 15, 2026</p>' },
  date: '2026-09-10T08:00:00',
  ...over,
});

test('oppdesk: a case post becomes a record without body text', () => {
  const [r] = oppdeskRecords([post()], today);
  assert.equal(r.id, 'od-12345');
  assert.equal(r.source, 'oppdesk');
  assert.equal(r.tier, 'international');
  assert.equal(r.title, 'Global Case Competition 2026 – Win $5,000');
  assert.equal(r.url, 'https://opportunitydesk.org/2026/09/10/global-case-competition/');
  assert.equal(r.regn_close, '2026-11-15');
  assert.equal(r.is_case, true);
  assert.deepEqual(r.verdict, { level: 'check', reasons: ['verify eligibility on the post'] });
  const raw = JSON.stringify(r);
  assert.doesNotMatch(raw, /jane@|9876543210|Open to students/);
  assert.equal('content' in r, false);
  assert.equal('details_text' in r, false);
});

test('oppdesk: non-case titles, missing or old deadlines, bad links and bad ids are skipped', () => {
  const out = oppdeskRecords([
    post({ id: 1, title: { rendered: 'Photography Contest 2026' } }),
    post({ id: 2, content: { rendered: '<p>No date given.</p>' } }),
    post({ id: 3, content: { rendered: '<p>Deadline: March 1, 2026</p>' } }),
    post({ id: 4, link: 'http://opportunitydesk.org/x/' }),
    post({ id: 5, link: 'javascript:alert(1)' }),
    post({ id: 'x' }),
    post({ id: 6, title: { rendered: 'Case Essay Competition' } }),
    null,
    post({ id: 7 }),
  ], today);
  assert.deepEqual(out.map(r => r.id), ['od-7']);
});

test('oppdesk: a deadline within the last 30 days is kept (merge closes it)', () => {
  const out = oppdeskRecords([post({ content: { rendered: '<p>Deadline: 10 September 2026</p>' } })], today);
  assert.equal(out[0].regn_close, '2026-09-10');
});

test('format_kind: curated case rows are case, other kinds other; Opportunity Desk posts are case', () => {
  const [a, b] = curatedRecords([row(), row({ id: 'intl-y', kind: 'startup' })], {}, today);
  assert.equal(a.format_kind, 'case');
  assert.equal(b.format_kind, 'other');
  const [od] = oppdeskRecords([{ id: 5, link: 'https://opportunitydesk.org/x', title: { rendered: 'Global Case Challenge' },
    content: { rendered: '<p>Deadline: October 10, 2026</p>' } }], today);
  assert.equal(od.format_kind, 'case');
});

// ---- fest watchlist rows (data/fests.json) --------------------------------

const fest = (over = {}) => row({
  id: 'fest-esummit', name: 'IIT Bombay E-Summit', url: 'https://www.ecell.in/esummit', watch_url: 'https://www.ecell.in/esummit',
  host: 'E-Cell, IIT Bombay', tier: 'iit', kind: 'case', entry: 'open', entry_note: null, who_applies: 'team',
  indian_ug: 'unclear', indian_ug_note: 'Check the fest page for undergraduate eligibility',
  application_months: null, finals_months: null, team_size: null, verified: true, ...over,
});

test('a curated row carries its own tier: fest rows land as iit/iim curated records', () => {
  const [r] = curatedRecords([fest()], {}, today);
  assert.equal(r.id, 'fest-esummit');
  assert.equal(r.tier, 'iit');
  assert.equal(r.source, 'curated');
  assert.equal(r.format, 'curated');
  assert.equal(r.is_case, true);
  assert.equal(r.format_kind, 'case');
  assert.deepEqual(r.expected, { application_months: null, finals_months: null });
  assert.equal(r.intl.watch_url, 'https://www.ecell.in/esummit');
  assert.deepEqual(r.verdict, { level: 'check', reasons: ['Check the fest page for undergraduate eligibility'] });
  assert.equal(curatedRecords([fest({ id: 'fest-intaglio', tier: 'iim' })], {}, today)[0].tier, 'iim');
});

test('a missing or unknown row tier falls back to international', () => {
  assert.equal(curatedRecords([row()], {}, today)[0].tier, 'international');
  assert.equal(curatedRecords([row({ tier: 'other' })], {}, today)[0].tier, 'international');
  assert.equal(curatedRecords([row({ tier: 'bogus' })], {}, today)[0].tier, 'international');
});

test('curated ids must start intl- or fest-; unverified fest rows are hidden', () => {
  assert.equal(curatedRecords([row({ id: 'x-1' })], {}, today).length, 0);
  assert.equal(curatedRecords([fest({ verified: false })], {}, today).length, 0);
});

test('confirmed dates apply to fest rows too', () => {
  const [r] = curatedRecords([fest()], { 'fest-esummit': { regn_close: '2026-12-01', comp_end: '2027-01-20' } }, today);
  assert.equal(r.regn_close, '2026-12-01');
  assert.equal(r.comp_end, '2027-01-20');
});
