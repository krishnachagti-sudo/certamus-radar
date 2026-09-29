// Shared data layer for every page: labels, loading published JSON, and the
// pure rules (filters, committed set, sorting, international text). Browser-
// safe: imports only relative modules. Ids may be numbers (Unstop) or strings
// (intl-*, od-*); every comparison goes through sameId.
import { dayDiff } from '../dates.js';

export const TIERS = { iit: 'IIT', iim: 'IIM', bschool: 'B-school', corporate: 'Corporate', international: 'International', other: 'Other' };
export const BOARD_TIERS = ['iit', 'iim', 'bschool', 'corporate', 'international'];
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

export function matchesQuery(c, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return `${c.title ?? ''} ${c.host ?? ''}`.toLowerCase().includes(q);
}

// f = { tiers, verdicts, statuses (Sets), registeredOnly, showClosed,
// showOtherFormats, startups, query }
export function visible(c, f, decisions) {
  if (c.closed_on && !f.showClosed) return false;
  if (!f.statuses.has(statusOf(decisions, c))) return false;
  if (f.registeredOnly && !isRegistered(decisions, c)) return false;
  if (!c.pinned && !f.tiers.has(c.tier)) return false;
  if (!c.pinned && c.is_case === false) {
    if (c.kind === 'startup') { if (!f.startups) return false; }
    else if (!f.showOtherFormats) return false;
  }
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
