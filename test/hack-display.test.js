// Hackathon display rules: filtering, the abroad toggle, cross-section
// clashes and the cross-source dedupe (lib/data.js), the hackathon rule
// table (lib/eligibility.js), the per-section inbox and the hackathon card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  visible, inPersonAbroad, recordSection, committedAcross, clashLabels, normTitle, dedupeAcrossSources,
} from '../lib/data.js';
import { HACK_BOARD_TIERS, HACK_TIERS } from '../lib/section.js';
import { HACK_RULES, hackEligibilityRows } from '../lib/eligibility.js';
import { relevantForInbox, newItems, closingItems, seenKey } from '../lib/inbox.js';
import { cardHtml, linkLabel, hackTeamText, placeText } from '../lib/card.js';

const today = '2026-10-01';
const hack = (over = {}) => ({
  id: 'df-1', source: 'devfolio', title: 'Hack One', host: 'IIT X', tier: 'iit', hack_kind: 'build', main: true,
  mode: 'online', location: 'Online', country: null, verdict: { level: 'fits', reasons: [] }, ...over,
});
const abroad = (over = {}) => hack({
  id: 'mlh-big', source: 'mlh', tier: 'global', mode: 'offline', location: 'Ithaca, New York', country: 'US',
  verdict: { level: 'check', reasons: ['eligibility not stated', 'in-person abroad (US)'] }, ...over,
});
const filters = (over = {}) => ({
  tiers: new Set(HACK_BOARD_TIERS), verdicts: new Set(['fits', 'check']), statuses: new Set(['undecided', 'watching', 'entering']),
  registeredOnly: false, showClosed: false, showOtherFormats: false, startups: false, query: '', includeAbroad: false, ...over,
});

// ---- filtering ---------------------------------------------------------------

test('inPersonAbroad: the stored reason, or an in-person record outside India', () => {
  assert.equal(inPersonAbroad(abroad()), true);
  assert.equal(inPersonAbroad(hack()), false);
  assert.equal(inPersonAbroad(hack({ mode: 'offline', country: 'IN', location: 'Bhilai' })), false);
  assert.equal(inPersonAbroad(hack({ mode: 'offline', country: 'India' })), false);
  assert.equal(inPersonAbroad(hack({ mode: 'hybrid', country: 'GB', verdict: { level: 'out', reasons: ['postgraduate only'] } })), true);
  assert.equal(inPersonAbroad({ id: 1, title: 'Case', tier: 'iim' }), false);
});

test('in-person abroad is hidden unless the toggle is on; India and online stay', () => {
  const online = hack({ id: 'dp-1', source: 'devpost', tier: 'global' });
  const india = hack({ id: 'mlh-in', source: 'mlh', tier: 'global', mode: 'offline', country: 'IN' });
  assert.equal(visible(abroad(), filters(), {}), false);
  assert.equal(visible(abroad(), filters({ includeAbroad: true }), {}), true);
  assert.equal(visible(online, filters(), {}), true);
  assert.equal(visible(india, filters(), {}), true);
});

test('case comps ignore the abroad toggle (their filters never set it)', () => {
  const caseFilters = filters({ tiers: new Set(['international']) });
  delete caseFilters.includeAbroad;
  assert.equal(visible({ id: 7, tier: 'international', is_case: true, verdict: { level: 'fits' }, mode: 'offline', country: 'US' }, caseFilters, {}), true);
});

test('other formats are hidden unless the toggle is on; tier filter still applies', () => {
  const other = hack({ hack_kind: 'other', main: false });
  assert.equal(visible(other, filters(), {}), false);
  assert.equal(visible(other, filters({ showOtherFormats: true }), {}), true);
  const otherTier = hack({ tier: 'other', main: false });
  assert.equal(visible(otherTier, filters(), {}), false);
  assert.equal(visible(otherTier, filters({ tiers: new Set(Object.keys(HACK_TIERS)) }), {}), true);
  assert.equal(visible(hack({ hack_kind: 'ideathon' }), filters(), {}), true);
});

// ---- clashes across sections -------------------------------------------------

test('recordSection: hackathon records carry hack_kind', () => {
  assert.equal(recordSection(hack()), 'hack');
  assert.equal(recordSection({ id: 1, title: 'Case' }), 'case');
});

test('committedAcross: entering or registered from both sections', () => {
  const cases = [{ id: 1, title: 'HaritVitt' }, { id: 2, title: 'Watched' }];
  const hacks = [hack({ id: 'df-a' }), hack({ id: 'df-b' }), hack({ id: 'df-c' })];
  const d = { 1: { status: 'entering' }, 2: { status: 'watching' }, 'df-a': { registered: true }, 'df-c': { status: 'skipped' } };
  assert.deepEqual(committedAcross(hacks, cases, d).map(c => c.id), ['df-a', 1]);
  assert.deepEqual(committedAcross(cases, hacks, d).map(c => c.id), [1, 'df-a']);
  assert.deepEqual(committedAcross(cases, undefined, d).map(c => c.id), [1]);
});

test('clashLabels name the other section; same-section clashes stay plain titles', () => {
  const target = hack({ id: 'df-t', title: 'Build Night', regn_close: '2026-10-10', comp_end: '2026-10-12' });
  const caseComp = { id: 1, title: 'HaritVitt', regn_close: '2026-10-08', comp_end: '2026-10-20' };
  const hackmate = hack({ id: 'df-m', title: 'Other Hack', regn_close: '2026-10-14' });
  const far = { id: 3, title: 'Far', regn_close: '2026-12-01' };
  assert.deepEqual(clashLabels(target, [caseComp, hackmate, far, target], today), ['HaritVitt (case comp)', 'Other Hack']);
  assert.deepEqual(clashLabels(caseComp, [target], today), ['Build Night (hackathon)']);
  assert.deepEqual(clashLabels({ id: 9, title: 'Case B', regn_close: '2026-10-09' }, [caseComp], today), ['HaritVitt']);
});

// ---- dedupe --------------------------------------------------------------------

test('normTitle drops case, punctuation, years and edition tokens', () => {
  assert.equal(normTitle('Innohacks 4.0'), 'innohacks');
  assert.equal(normTitle('HACKBIOS 2K26'), 'hackbios');
  assert.equal(normTitle('HackBIOS'), 'hackbios');
  assert.equal(normTitle('Hack-A-Thon 2026: Season 3'), 'hack a thon');
  assert.equal(normTitle('CodeFest 5th Edition'), 'codefest');
  assert.equal(normTitle('HackMIT v2'), 'hackmit');
});

test('dedupe: same title and a date within 3 days, Devfolio over MLH over Devpost', () => {
  const df = hack({ id: 'df-inno', title: 'Innohacks 4.0', tier: 'other', main: false, regn_close: '2026-10-02', comp_start: '2026-10-10', comp_end: '2026-10-11' });
  const mlh = hack({ id: 'mlh-inno', source: 'mlh', title: 'Innohacks 4.0', tier: 'global', regn_close: '2026-10-10', comp_start: '2026-10-10', comp_end: '2026-10-12' });
  const dp = hack({ id: 'dp-inno', source: 'devpost', title: 'InnoHacks', tier: 'global', regn_close: '2026-10-11' });
  const lone = hack({ id: 'df-lone', title: 'Lone Hack', regn_close: '2026-10-02' });
  const out = dedupeAcrossSources([mlh, lone, dp, df], {});
  assert.deepEqual(out.map(c => c.id), ['df-inno', 'df-lone']);
  // The kept Devfolio record takes the MLH tier when its own is "other".
  assert.equal(out[0].tier, 'global');
  assert.equal(out[0].main, true);
});

test('dedupe: an Unstop listing wins over the platforms and keeps its institute tier', () => {
  const un = hack({ id: 1755408, source: 'unstop', title: 'Multimodal AI Hackathon 2026', tier: 'iit', regn_close: '2026-10-13', comp_end: '2026-10-15' });
  const dp = hack({ id: 'dp-31481', source: 'devpost', title: 'Multimodal AI Hackathon 2026', tier: 'global', regn_close: '2026-10-14', comp_end: '2026-10-14' });
  const out = dedupeAcrossSources([dp, un], {});
  assert.deepEqual(out.map(c => c.id), [1755408]);
  assert.equal(out[0].tier, 'iit');
  // A platform record with only "global" takes an institute tier from its twin.
  const df = hack({ id: 'df-z', title: 'Zeta Hack', tier: 'global', regn_close: '2026-10-05' });
  const mlh = hack({ id: 'mlh-z', source: 'mlh', title: 'Zeta Hack', tier: 'iit', regn_close: '2026-10-06' });
  assert.equal(dedupeAcrossSources([df, mlh], {})[0].tier, 'iit');
});

test('dedupe: different titles, far dates or the same source are kept apart', () => {
  const a = hack({ id: 'df-a', title: 'HackBIOS', regn_close: '2026-10-01' });
  const b = hack({ id: 'mlh-b', source: 'mlh', title: 'HackBIOS', regn_close: '2026-11-20', comp_start: '2026-11-20' });
  const c = hack({ id: 'df-c', title: 'HackBIOS', regn_close: '2026-10-02' });
  const d = hack({ id: 'mlh-d', source: 'mlh', title: 'Another', regn_close: '2026-10-01' });
  assert.deepEqual(dedupeAcrossSources([a, b, c, d], {}).map(x => x.id), ['df-a', 'mlh-b', 'df-c', 'mlh-d']);
});

test('dedupe: an item with a team decision wins over source order', () => {
  const df = hack({ id: 'df-x', title: 'HackBIOS 2K26', regn_close: '2026-09-30', comp_start: '2026-10-09' });
  const mlh = hack({ id: 'mlh-x', source: 'mlh', title: 'HackBIOS', regn_close: '2026-10-09', comp_start: '2026-10-09' });
  assert.deepEqual(dedupeAcrossSources([df, mlh], { 'mlh-x': { status: 'watching' } }).map(x => x.id), ['mlh-x']);
  assert.deepEqual(dedupeAcrossSources([df, mlh], {}).map(x => x.id), ['df-x']);
});

test('dedupe leaves inputs untouched and handles non-arrays', () => {
  const df = hack({ id: 'df-i', title: 'Innohacks', tier: 'other', regn_close: '2026-10-02' });
  const mlh = hack({ id: 'mlh-i', source: 'mlh', title: 'Innohacks', tier: 'global', regn_close: '2026-10-03' });
  dedupeAcrossSources([df, mlh], {});
  assert.equal(df.tier, 'other');
  assert.deepEqual(dedupeAcrossSources(undefined, {}), []);
});

// ---- eligibility rule table ------------------------------------------------------

test('the hackathon rule table follows hack-classify order', () => {
  assert.deepEqual(HACK_RULES.map(r => r.name), [
    'Open to students', 'Undergraduates', 'Course', 'Graduating year', 'Course and year together', 'Team size',
    'Same-college team', 'Entry fee', 'Eligibility stated', 'Location', 'Women only', 'Invite only',
  ]);
});

test('hackathon rows: check reasons land on their rules', () => {
  const rows = hackEligibilityRows(hack({ verdict: { level: 'check', reasons: [
    'only Akshit is eligible by course', 'needs 3 members, recruit', 'form a same-college team', 'eligibility not stated', 'in-person abroad (US)',
  ] } }));
  const at = n => rows.find(r => r.name === n);
  assert.equal(at('Course').state, 'check');
  assert.equal(at('Course').detail, 'only Akshit is eligible by course');
  assert.equal(at('Graduating year').state, 'ok');
  assert.equal(at('Team size').state, 'check');
  assert.equal(at('Same-college team').state, 'check');
  assert.equal(at('Eligibility stated').state, 'check');
  assert.equal(at('Location').state, 'check');
  assert.equal(at('Entry fee').state, 'ok');
  assert.equal(rows.length, HACK_RULES.length);
});

test('hackathon rows: year-only and course-and-year reasons', () => {
  const y = hackEligibilityRows(hack({ verdict: { level: 'check', reasons: ['only Krishna is eligible by year'] } }));
  assert.equal(y.find(r => r.name === 'Graduating year').state, 'check');
  assert.equal(y.find(r => r.name === 'Course').state, 'ok');
  const both = hackEligibilityRows(hack({ verdict: { level: 'check', reasons: ['only Akshit is eligible by course and year'] } }));
  assert.equal(both.find(r => r.name === 'Course and year together').state, 'check');
});

test('hackathon rows: out stops the table at its rule', () => {
  const rows = hackEligibilityRows(hack({ verdict: { level: 'out', reasons: ['graduating 2027 only'] } }));
  assert.deepEqual(rows.map(r => r.state), ['ok', 'ok', 'ok', 'out', ...Array(8).fill('unchecked')]);
  const pg = hackEligibilityRows(hack({ verdict: { level: 'out', reasons: ['postgraduate only'] } }));
  assert.deepEqual(pg.slice(0, 3).map(r => r.state), ['ok', 'out', 'unchecked']);
  const school = hackEligibilityRows(hack({ verdict: { level: 'out', reasons: ['school students only'] } }));
  assert.equal(school[0].state, 'out');
  const team = hackEligibilityRows(hack({ verdict: { level: 'out', reasons: ['needs at least 5 members'] } }));
  assert.equal(team.find(r => r.name === 'Team size').state, 'out');
});

test('hackathon rows: fits passes everything; curated rows show facts instead', () => {
  assert.ok(hackEligibilityRows(hack()).every(r => r.state === 'ok'));
  assert.equal(hackEligibilityRows(hack({ source: 'curated', id: 'hk-sih' })), null);
});

// ---- inbox -------------------------------------------------------------------------

test('inbox: seen keys per section and per signed-in user', () => {
  assert.equal(seenKey('case', 'krishna@example.com'), 'certamus-radar.seen.krishna@example.com');
  assert.equal(seenKey('hack', 'Krishna@Example.com'), 'certamus-radar.seen.hack.krishna@example.com');
  assert.notEqual(seenKey('case', 'a@x.com'), seenKey('case', 'b@x.com'));
});

test('inbox (hackathons): board tiers, no other formats, abroad only when included', () => {
  const opts = { tiers: HACK_BOARD_TIERS, includeAbroad: false };
  assert.equal(relevantForInbox(hack(), {}, opts), true);
  assert.equal(relevantForInbox(hack({ tier: 'global' }), {}, opts), true);
  assert.equal(relevantForInbox(hack({ tier: 'other' }), {}, opts), false);
  assert.equal(relevantForInbox(hack({ hack_kind: 'other' }), {}, opts), false);
  assert.equal(relevantForInbox(abroad(), {}, opts), false);
  assert.equal(relevantForInbox(abroad(), {}, { ...opts, includeAbroad: true }), true);
  const fresh = newItems([hack({ first_seen: today }), abroad({ first_seen: today })], {}, null, today, opts);
  assert.deepEqual(fresh.map(c => c.id), ['df-1']);
  const closing = closingItems([abroad({ regn_close: '2026-10-03' })], {}, today, { ...opts, includeAbroad: true });
  assert.equal(closing.length, 1);
});

// ---- card ----------------------------------------------------------------------------

test('link labels per source', () => {
  assert.equal(linkLabel(hack()), 'Open on Devfolio');
  assert.equal(linkLabel(hack({ source: 'unstop' })), 'Open on Unstop');
  assert.equal(linkLabel(hack({ source: 'devpost' })), 'Open on Devpost');
  assert.equal(linkLabel(hack({ source: 'mlh', url: 'https://mlh.io/events/x' })), 'Open on MLH');
  assert.equal(linkLabel(hack({ source: 'mlh', url: 'https://www.bigredhacks.com/' })), 'Official site (listed on MLH)');
  assert.equal(linkLabel(hack({ source: 'curated' })), 'Official site');
  assert.equal(linkLabel({ id: 5 }), 'Open on Unstop');
  assert.equal(linkLabel({ source: 'oppdesk' }), 'Opportunity Desk post');
});

test('hackathon team and place text', () => {
  assert.equal(hackTeamText({ team_min: 2, team_max: 6 }), 'team of 2–6');
  assert.equal(hackTeamText({ team_min: 1, team_max: 1 }), 'solo');
  assert.equal(hackTeamText({ team_min: 4, team_max: 4 }), 'team of 4');
  assert.equal(hackTeamText({ team_max: 4 }), 'team of 1–4');
  assert.equal(hackTeamText({ team_min: 3 }), 'team of at least 3');
  assert.equal(hackTeamText({}), 'team size not listed');
  assert.equal(placeText(hack()), 'Online');
  assert.equal(placeText(abroad()), 'Ithaca, New York');
  assert.equal(placeText(hack({ mode: 'hybrid', location: 'Pune' })), 'Hybrid: Pune');
  assert.equal(placeText(hack({ mode: 'offline', location: null, country: null })), 'In person, place not listed');
  assert.equal(placeText(hack({ mode: 'offline', location: null, country: 'GB' })), 'GB');
});

test('hackathon card: kind chip, place, team, source label, section link, escaping', () => {
  const c = hack({ id: 'df-"x"', title: '<b>T</b>', host: '<i>H</i>', team_min: 2, team_max: 4, url: 'https://x.devfolio.co/' });
  const html = cardHtml(c, { today, committed: [], decisions: {}, editable: false, watch: {}, section: 'hack' });
  assert.match(html, /<span class="chip kind">Build<\/span>/);
  assert.match(html, /Online · team of 2–4/);
  assert.match(html, /Open on Devfolio ↗/);
  assert.match(html, /href="c\.html\?id=df-%22x%22&amp;s=hack"/);
  assert.ok(!html.includes('<b>T</b>') && !html.includes('<i>H</i>'));
  const idea = cardHtml(hack({ hack_kind: 'ideathon' }), { today, committed: [], decisions: {}, editable: false, watch: {}, section: 'hack' });
  assert.match(idea, /<span class="chip kind">Ideathon<\/span>/);
});

test('hosts: the global tier sorts after the institute tiers, before other', async () => {
  const { hostRows } = await import('../lib/hosts.js');
  const rows = hostRows([
    hack({ id: 'a', host: 'Zed', tier: 'other' }), hack({ id: 'b', host: 'MLH member event', tier: 'global' }), hack({ id: 'c', host: 'IIT X', tier: 'iit' }),
  ], [], []);
  assert.deepEqual(rows.map(r => r.tier), ['iit', 'global', 'other']);
});

test('whoAppliesText: a curated hackathon entered through the institute says so', async () => {
  const { whoAppliesText } = await import('../lib/data.js');
  assert.equal(whoAppliesText(hack({ source: 'curated', intl: { who_applies: 'school' } })), 'Enter through your institute’s own round');
  assert.equal(whoAppliesText({ intl: { who_applies: 'school' } }), 'IIM Sirmaur must apply for an invitation');
});
