import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, loadDecisions } from '../digest/email.js';

const now = new Date('2026-10-05T02:30:00Z'); // Monday 08:00 IST
const fresh = { last_ok: '2026-10-05T00:30:00Z', last_error: null };
const c = (id, over = {}) => ({
  id, title: `C${id}`, host: 'IIM X', tier: 'iim', verdict: { level: 'fits', reasons: [] },
  regn_close: '2026-11-01', comp_end: '2026-11-10', first_seen: '2026-10-04', closed_on: null, pinned: false, is_case: true, url: 'u', ...over,
});

test('new = not in sent_ids, relevant, not out', () => {
  const d = buildDigest({
    competitions: [c(1), c(2), c(3, { tier: 'other' }), c(4, { verdict: { level: 'out', reasons: ['x'] } }), c(5, { tier: 'other', pinned: true })],
    decisions: {}, status: fresh, state: { sent_ids: [1] }, now,
  });
  assert.deepEqual(d.sections.fresh.map(x => x.id), [2, 5]);
  assert.deepEqual(d.nextState.sent_ids, [1, 2, 3, 4, 5]);
});

test('non-case formats never reach the digest unless pinned', () => {
  const d = buildDigest({
    competitions: [c(1, { is_case: false }), c(2, { is_case: false, pinned: true })],
    decisions: {}, status: fresh, state: { sent_ids: [] }, now,
  });
  assert.deepEqual(d.sections.fresh.map(x => x.id), [2]);
});

test('first run counts the last 7 days as new', () => {
  const d = buildDigest({ competitions: [c(1, { first_seen: '2026-09-20' }), c(2)], decisions: {}, status: fresh, state: null, now });
  assert.deepEqual(d.sections.fresh.map(x => x.id), [2]);
});

test('closing within 10 days: watching, or undecided and fits', () => {
  const soon = { regn_close: '2026-10-12' };
  const d = buildDigest({
    competitions: [c(1, soon), c(2, soon), c(3, { ...soon, verdict: { level: 'check', reasons: ['fee'] } }), c(4, { regn_close: '2026-10-20' })],
    decisions: { 2: { status: 'skipped' }, 3: { status: 'watching' } }, status: fresh, state: { sent_ids: [1, 2, 3, 4] }, now,
  });
  assert.deepEqual(d.sections.closing.map(x => x.id), [1, 3]);
});

test('closing section respects relevance: undecided must pass relevant(), watching does not', () => {
  const soon = { regn_close: '2026-10-12' };
  const d = buildDigest({
    competitions: [
      c(1, { ...soon, tier: 'other' }),
      c(2, { ...soon, is_case: false }),
      c(3, { ...soon, tier: 'other' }),
    ],
    decisions: { 3: { status: 'watching' } }, status: fresh, state: { sent_ids: [1, 2, 3] }, now,
  });
  assert.deepEqual(d.sections.closing.map(x => x.id), [3]);
});

test('clashes against entering competitions', () => {
  const d = buildDigest({
    competitions: [c(1), c(2, { regn_close: '2026-11-05' }), c(3, { regn_close: '2027-01-01', comp_end: '2027-01-02' })],
    decisions: { 1: { status: 'entering' } }, status: fresh, state: { sent_ids: [1, 2, 3] }, now,
  });
  assert.deepEqual(d.sections.clashing.map(x => [x.c.id, x.with]), [[2, ['C1']]]);
});

test('stale data leads the email', () => {
  const d = buildDigest({ competitions: [], decisions: {}, status: { last_ok: '2026-10-02T00:30:00Z', last_error: 'HTTP 403' }, state: {}, now });
  assert.match(d.subject, /stale/i);
  assert.match(d.text, /HTTP 403/);
});

test('nothing new still sends a one-liner', () => {
  const d = buildDigest({ competitions: [], decisions: {}, status: fresh, state: { sent_ids: [] }, now });
  assert.match(d.subject, /nothing new/i);
  assert.ok(d.text.length > 0);
});

test('clashes count registered competitions as committed', () => {
  const d = buildDigest({
    competitions: [c(1), c(2, { regn_close: '2026-11-05' })],
    decisions: { 1: { status: 'watching', registered: true } }, status: fresh, state: { sent_ids: [1, 2] }, now,
  });
  assert.deepEqual(d.sections.clashing.map(x => [x.c.id, x.with]), [[2, ['C1']]]);
});

test('Registered: coming up = registered with a date in the next 14 days, not already closing', () => {
  const d = buildDigest({
    competitions: [
      c(1, { regn_close: '2026-10-12' }),                       // registered, fits, closing -> in Closing only
      c(2, { regn_close: '2026-10-01', comp_end: '2026-10-18' }), // registered, comp_end in 13 days
      c(3, { regn_close: '2026-10-30', comp_end: '2026-11-10' }), // registered, too far
      c(4, { regn_close: '2026-10-15' }),                       // not registered
      c(5, { regn_close: '2026-10-19', verdict: { level: 'check', reasons: ['x'] } }), // registered, day 14
    ],
    decisions: { 1: { registered: true }, 2: { registered: true }, 3: { registered: true }, 5: { status: 'skipped', registered: true } },
    status: fresh, state: { sent_ids: [1, 2, 3, 4, 5] }, now,
  });
  assert.deepEqual(d.sections.closing.map(x => x.id), [1, 4]);
  assert.deepEqual(d.sections.registered.map(x => x.id), [2, 5]);
  assert.match(d.text, /Registered: coming up/);
});

const intl = (id, over = {}) => c(id, {
  tier: 'international', source: 'curated', regn_close: null, comp_end: null, host: 'Abroad U',
  expected: { application_months: [10], finals_months: [2] },
  intl: { who_applies: 'school', indian_ug: 'unclear' }, verdict: { level: 'check', reasons: ['IIM Sirmaur must apply for an invitation'] }, ...over,
});

test('International: curated items applying this or next month, directly enterable first', () => {
  const d = buildDigest({
    competitions: [
      intl('intl-a'),
      intl('intl-b', { expected: { application_months: [11], finals_months: null }, intl: { who_applies: 'team', indian_ug: 'yes' }, verdict: { level: 'fits', reasons: [] } }),
      intl('intl-c', { expected: { application_months: [3], finals_months: null } }),
      intl('intl-d', { expected: { application_months: null, finals_months: [10] } }),
      intl('intl-e', { verdict: { level: 'out', reasons: ['x'] } }),
      intl('intl-f'),
    ],
    decisions: { 'intl-f': { status: 'skipped' } }, status: fresh, state: { sent_ids: [] }, now,
  });
  assert.deepEqual(d.sections.international.map(x => x.id), ['intl-b', 'intl-a']);
  assert.match(d.text, /International/);
  assert.match(d.text, /Your team applies/);
  assert.match(d.text, /IIM Sirmaur must apply/);
});

test('curated items are not listed as new (they have their own section)', () => {
  const d = buildDigest({ competitions: [intl('intl-a'), c(2, { tier: 'international', source: 'oppdesk', id: 'od-2' })],
    decisions: {}, status: fresh, state: { sent_ids: [] }, now });
  assert.deepEqual(d.sections.fresh.map(x => x.id), ['od-2']);
});

test('International also lists watched pages changed since the last digest', () => {
  const d = buildDigest({
    competitions: [intl('intl-a', { expected: { application_months: [5], finals_months: null } }), intl('intl-b', { expected: { application_months: [5], finals_months: null } })],
    decisions: {}, status: fresh, state: { sent_ids: [], last_sent: '2026-09-28T02:30:00Z' }, now,
    watch: { 'intl-a': { changed_on: '2026-10-05' }, 'intl-b': { changed_on: '2026-09-28' }, 'intl-gone': { changed_on: '2026-10-05' } },
  });
  assert.deepEqual(d.sections.watchChanged.map(x => x.id), ['intl-a']);
  assert.match(d.text, /Official page changed on 2026-10-05, new edition\?/);
});

test('digest labels the international tier', () => {
  const d = buildDigest({ competitions: [c('od-9', { tier: 'international', source: 'oppdesk' })], decisions: {}, status: fresh, state: { sent_ids: [] }, now });
  assert.match(d.text, /\(International, /);
});

test('International leaves out startup contests (not cases), as the rest of the digest does', () => {
  const d = buildDigest({ competitions: [intl('intl-a'), intl('intl-s', { is_case: false, kind: 'startup' })],
    decisions: {}, status: fresh, state: { sent_ids: [] }, now });
  assert.deepEqual(d.sections.international.map(x => x.id), ['intl-a']);
});

test('subject counts International and Registered when non-zero', () => {
  const d = buildDigest({
    competitions: [c(1), intl('intl-a'), c(3, { regn_close: '2026-10-18', comp_end: '2026-12-31' })],
    decisions: { 3: { registered: true } }, status: fresh, state: { sent_ids: [3] }, now,
  });
  assert.equal(d.subject, 'Certamus Radar: 1 new, 0 closing, 0 clashes, 1 international, 1 registered');
  const only = buildDigest({ competitions: [intl('intl-a')], decisions: {}, status: fresh, state: { sent_ids: [] }, now });
  assert.equal(only.subject, 'Certamus Radar: 0 new, 0 closing, 0 clashes, 1 international');
  const none = buildDigest({ competitions: [], decisions: {}, status: fresh, state: { sent_ids: [] }, now });
  assert.match(none.subject, /nothing new this week/);
});

// ---- decisions from Supabase ------------------------------------------------

test('a warning goes at the very top of the text and the html', () => {
  const d = buildDigest({ competitions: [], decisions: {}, status: fresh, state: { sent_ids: [] }, now,
    warnings: ['Team decisions unavailable (Supabase HTTP 503); statuses below may be missing.'] });
  assert.match(d.text.split('\n\n')[0], /^Team decisions unavailable \(Supabase HTTP 503\)/);
  assert.match(d.html.split('\n')[0], /Team decisions unavailable/);
});

test('no warnings, no warning line', () => {
  const d = buildDigest({ competitions: [], decisions: {}, status: fresh, state: { sent_ids: [] }, now });
  assert.doesNotMatch(d.text, /unavailable/);
});

const sbCfg = getJson => ({ url: 'https://abc.supabase.co', anonKey: 'anon', getJson });

test('loadDecisions reads Supabase and converts rows', async () => {
  const r = await loadDecisions(sbCfg(async () => [{ id: '1', status: 'watching', registered: true, note: null, updated_at: '2026-10-05T00:00:00Z' }]), () => ({ 9: { status: 'entering' } }));
  assert.deepEqual(r, { decisions: { 1: { status: 'watching', registered: true, updated: '2026-10-05' } }, warning: null });
});

test('loadDecisions falls back to the file, else empty, with a warning; never throws', async () => {
  const down = sbCfg(async () => { throw new Error('HTTP 503'); });
  const withFile = await loadDecisions(down, () => ({ 9: { status: 'entering' } }));
  assert.deepEqual(withFile.decisions, { 9: { status: 'entering' } });
  assert.match(withFile.warning, /HTTP 503/);
  const none = await loadDecisions(down, () => undefined);
  assert.deepEqual(none.decisions, {});
  assert.match(none.warning, /unavailable/);
  const unset = await loadDecisions({ url: '', anonKey: '' }, () => undefined);
  assert.match(unset.warning, /not configured/);
});
