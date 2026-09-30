// Shared data layer for every page: labels, loading published JSON, and the
// pure rules (filters, committed set, sorting, international text). Browser-
// safe: imports only relative modules. Ids may be numbers (Unstop) or strings
// (intl-*, od-*); every comparison goes through sameId.
import { dayDiff } from '../dates.js';
import { clashes } from '../clash.js';

export const TIERS = {
  iit: 'IIT', iim: 'IIM', national: 'NIT / IIIT / national institutes', bschool: 'B-school / top college',
  corporate: 'Corporate', international: 'International', other: 'Other',
};
export const BOARD_TIERS = ['iit', 'iim', 'national', 'bschool', 'corporate', 'international'];
export const VERDICTS = { fits: 'Fits', check: 'Check', out: 'Out' };
export const STATUSES = ['watching', 'entering', 'skipped'];
export const STATUS_FILTER = { undecided: 'Undecided', watching: 'Watching', entering: 'Entering', skipped: 'Skipped' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WATCH_DAYS = 30;

export const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const decisionOf = (decisions, c) => decisions?.[String(c.id)];
export const statusOf = (decisions, c) => decisionOf(decisions, c)?.status || 'undecided';
export const isRegistered = (decisions, c) => decisionOf(decisions, c)?.registered === true;

// Competitions the team has committed to: these feed the clash check.
export const committedSet = (comps, decisions) =>
  comps.filter(c => statusOf(decisions, c) === 'entering' || isRegistered(decisions, c));

// One committed set across both sections: a hackathon the team is entering
// clashes with a case comp and the other way round.
export const committedAcross = (own, other, decisions) => [
  ...committedSet(Array.isArray(own) ? own : [], decisions),
  ...committedSet(Array.isArray(other) ? other : [], decisions),
];

const SECTION_NOUN = { case: 'case comp', hack: 'hackathon' };

// Titles of committed items within the clash window of `target`; an item
// from the other section says which: "HaritVitt (case comp)".
export function clashLabels(target, committed, today) {
  return (Array.isArray(committed) ? committed : [])
    .filter(e => e && !sameId(e.id, target.id) && clashes(target, [e], today).length)
    .map(e => (recordSection(e) === recordSection(target) ? e.title : `${e.title} (${SECTION_NOUN[recordSection(e)]})`));
}

// ---- cross-source dedupe (hackathons, display only) -------------------------
// The same event listed on Devfolio and MLH (or Devpost): same title once
// years, edition numbers and punctuation are dropped, and a registration,
// start or end date within 3 days (MLH records close registration at the
// start date, so regn_close alone misses them). The kept record is the one
// with a team decision, else curated and Unstop records (they carry the
// verified or course-level eligibility), then Devfolio over MLH over
// Devpost. It takes the most specific tier in its group (an institute tier
// over global over other), so a duplicate never drops off the Board.
const EDITION = /^((19|20)\d{2}|2k\d{2}|\d+(st|nd|rd|th)?|v\d+|edition|season|version|i{1,3}|iv|v|vi{1,3}|ix|x)$/;
export const normTitle = t => String(t ?? '').toLowerCase()
  .replace(/\b\d+\.\d+\b/g, ' ')
  .split(/[^a-z0-9]+/)
  .filter(w => w && !EDITION.test(w))
  .join(' ');

const DEDUPE_DAYS = 3;
const SOURCE_RANK = { curated: 0, unstop: 1, devfolio: 2, mlh: 3, devpost: 4 };
const sourceRank = c => SOURCE_RANK[c.source] ?? 1;
const tierWeight = t => (t === 'other' || !t ? 0 : t === 'global' ? 1 : 2);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const near = (a, b) => ISO_DATE.test(a || '') && ISO_DATE.test(b || '') && Math.abs(dayDiff(a, b)) <= DEDUPE_DAYS;
const sameEvent = (a, b) => near(a.regn_close, b.regn_close) || near(a.comp_start, b.comp_start) || near(a.comp_end, b.comp_end);

export function dedupeAcrossSources(list, decisions) {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  const decided = c => Boolean(decisions?.[String(c.id)]);
  const groups = [];
  for (const c of items) {
    const key = normTitle(c.title);
    const g = key && groups.find(x => x.key === key && x.members.every(m => m.source !== c.source) && x.members.some(m => sameEvent(m, c)));
    if (g) g.members.push(c); else groups.push({ key, members: [c] });
  }
  return groups.map(({ members }) => {
    if (members.length === 1) return members[0];
    const ranked = [...members].sort((a, b) => (decided(b) - decided(a)) || (sourceRank(a) - sourceRank(b)));
    const [keep, ...rest] = ranked;
    const best = rest.reduce((t, r) => (tierWeight(r.tier) > tierWeight(t) ? r.tier : t), keep.tier);
    return best !== keep.tier ? { ...keep, tier: best, main: keep.hack_kind !== 'other' } : keep;
  });
}

export function matchesQuery(c, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return `${c.title ?? ''} ${c.host ?? ''}`.toLowerCase().includes(q);
}

// Hackathon records carry hack_kind; case comps never do.
export const recordSection = c => (c?.hack_kind != null ? 'hack' : 'case');

// An in-person (or hybrid) event outside India: the verdict's stored reason,
// or, when an out verdict kept only its first reason, mode and country.
const INDIA = /^(india|in)$/i;
export function inPersonAbroad(c) {
  if ((Array.isArray(c?.verdict?.reasons) ? c.verdict.reasons : []).some(r => String(r).startsWith('in-person abroad'))) return true;
  return recordSection(c) === 'hack' && c.mode !== 'online' && typeof c.country === 'string' && c.country.trim() !== '' && !INDIA.test(c.country.trim());
}

// f = { tiers, verdicts, statuses (Sets), registeredOnly, showClosed,
// showOtherFormats, startups, query, includeAbroad (hackathons only:
// false hides in-person events abroad; case comps leave it unset) }
export function visible(c, f, decisions) {
  if (c.closed_on && !f.showClosed) return false;
  if (f.includeAbroad === false && inPersonAbroad(c)) return false;
  if (!f.statuses.has(statusOf(decisions, c))) return false;
  if (f.registeredOnly && !isRegistered(decisions, c)) return false;
  if (!c.pinned && !f.tiers.has(c.tier)) return false;
  if (!c.pinned && c.is_case === false) {
    if (c.kind === 'startup') { if (!f.startups) return false; }
    else if (!f.showOtherFormats) return false;
  }
  if (!c.pinned && c.hack_kind === 'other' && !f.showOtherFormats) return false;
  if (!matchesQuery(c, f.query)) return false;
  return f.verdicts.has(c.verdict?.level);
}

export function sortByDeadline(list) {
  return [...list].sort((a, b) => {
    if (a.regn_close !== b.regn_close) {
      if (!a.regn_close) return 1;
      if (!b.regn_close) return -1;
      return a.regn_close < b.regn_close ? -1 : 1;
    }
    return String(a.title ?? '').localeCompare(String(b.title ?? ''));
  });
}

// [9,10,11,12,1,2] -> 'Sep–Feb'; non-consecutive -> 'Jan, May'.
export function monthsText(months) {
  if (!Array.isArray(months) || !months.length) return '';
  const ok = months.filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
  if (!ok.length) return '';
  const run = ok.every((m, i) => i === 0 || m === (ok[i - 1] % 12) + 1);
  if (run && ok.length > 1) return `${MONTHS[ok[0] - 1]}–${MONTHS[ok[ok.length - 1] - 1]}`;
  return ok.map(m => MONTHS[m - 1]).join(', ');
}

// Text for an international record with no confirmed dates.
export function expectedText(c) {
  if (!c.expected) return null;
  const app = monthsText(c.expected.application_months);
  const fin = monthsText(c.expected.finals_months);
  const parts = [app && `applications usually ${app}`, fin && `finals usually ${fin}`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'dates not announced';
}

export function whoAppliesText(c) {
  const w = c.intl?.who_applies;
  if (w === 'team') return 'Your team applies';
  // A curated hackathon entered via the college's own round (e.g. SIH).
  if (w === 'school' && recordSection(c) === 'hack') return 'Enter through your institute’s own round';
  if (w === 'school') return 'IIM Sirmaur must apply for an invitation';
  return null;
}

// The date the watcher saw the official page change, if within 30 days.
export function watchChanged(watch, c, today) {
  const on = watch?.[String(c.id)]?.changed_on;
  if (!on) return null;
  const d = dayDiff(on, today);
  return d >= 0 && d <= WATCH_DAYS ? on : null;
}

// One decision change: empty, undefined and false values are dropped (so
// `registered: false` is removed, not stored) and an empty entry is deleted.
export function applyDecision(all, id, change, today) {
  const key = String(id);
  const next = { ...all };
  const { updated, ...rest } = change(next[key] || {});
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== '' && v !== false));
  if (Object.keys(clean).length) next[key] = { ...clean, updated: today };
  else delete next[key];
  return next;
}

export const decisionView = (decisions, id) => {
  const d = decisions?.[String(id)];
  return { status: d?.status || '', note: d?.note || '', registered: d?.registered === true };
};

// Entering changes clash badges on other cards; skipped hides the card by
// default; registered changes the committed set. Any of these needs the whole
// list redrawn.
const FULL_RENDER = new Set(['entering', 'skipped']);
export const needsFullRender = (a, b) =>
  a.registered !== b.registered || (a.status !== b.status && (FULL_RENDER.has(a.status) || FULL_RENDER.has(b.status)));

export async function pagesJson(name, fallback) {
  try {
    const r = await fetch(`./data/${name}`, { cache: 'no-store' });
    return r.ok ? await r.json() : fallback;
  } catch { return fallback; }
}
