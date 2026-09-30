// "What needs attention" panel at the top of the Board: what is new since
// this device last looked, and what closes within 10 days without a
// registration. The list rules are pure; the seen set lives in this browser's
// localStorage (memory only when storage is unavailable). Browser-safe.
import { dayDiff } from '../dates.js';
import { BOARD_TIERS, sortByDeadline, statusOf, isRegistered, inPersonAbroad } from './data.js';
import { esc, recordHref, verdictChipHtml } from './card.js';

const FIRST_VISIT_DAYS = 7;
const CLOSING_DAYS = 10;
const SEEN_STORAGE = 'certamus-radar.seen';
// Each section keeps its own seen set; case comps keep the original key.
export const seenKey = section => (section === 'hack' ? `${SEEN_STORAGE}.hack` : SEEN_STORAGE);

// opts (per section): { tiers: the Board's tiers (default: case comps'),
// includeAbroad: false hides in-person events abroad (hackathons' toggle) }.
export function relevantForInbox(c, decisions, opts = {}) {
  const tiers = opts.tiers || BOARD_TIERS;
  return tiers.includes(c.tier)
    && c.is_case !== false
    && c.hack_kind !== 'other'
    && (opts.includeAbroad !== false || !inPersonAbroad(c))
    && c.verdict?.level !== 'out'
    && !c.closed_on
    && statusOf(decisions, c) !== 'skipped'
    && !isRegistered(decisions, c);
}

// seen: null on this device's first visit, else { ids: [...], at }.
export function newItems(comps, decisions, seen, today, opts) {
  const seenIds = seen ? new Set((Array.isArray(seen.ids) ? seen.ids : []).map(String)) : null;
  const isNew = c => (seenIds
    ? !seenIds.has(String(c.id))
    : Boolean(c.first_seen) && dayDiff(c.first_seen, today) >= 0 && dayDiff(c.first_seen, today) <= FIRST_VISIT_DAYS);
  return sortByDeadline(comps.filter(c => relevantForInbox(c, decisions, opts) && isNew(c)));
}

export function closingItems(comps, decisions, today, opts) {
  return sortByDeadline(comps.filter(c => {
    if (!c.regn_close || !relevantForInbox(c, decisions, opts)) return false;
    const d = dayDiff(today, c.regn_close);
    return d >= 0 && d <= CLOSING_DAYS;
  }));
}

// ---- seen set --------------------------------------------------------------

export function seenFrom(raw) {
  try {
    const v = JSON.parse(raw);
    if (!v || !Array.isArray(v.ids)) return null;
    return { ids: v.ids.map(String), at: typeof v.at === 'string' ? v.at : null };
  } catch { return null; }
}

const memorySeen = new Map();
export function readSeen(key = SEEN_STORAGE) {
  if (memorySeen.has(key)) return memorySeen.get(key);
  try { return seenFrom(globalThis.localStorage?.getItem(key) ?? null); } catch { return null; }
}
export function writeSeen(seen, key = SEEN_STORAGE) {
  memorySeen.set(key, seen);
  try { globalThis.localStorage?.setItem(key, JSON.stringify(seen)); } catch { /* memory only */ }
}
export const seenNow = (comps, decisions, today, opts) =>
  ({ ids: comps.filter(c => relevantForInbox(c, decisions, opts)).map(c => String(c.id)), at: today });

// ---- HTML ------------------------------------------------------------------

function whenText(c, today) {
  if (!c.regn_close) return 'no deadline listed';
  const d = dayDiff(today, c.regn_close);
  if (d < 0) return 'registration closed';
  if (d === 0) return 'closes today';
  if (d <= CLOSING_DAYS) return `closes in ${d} day${d === 1 ? '' : 's'}`;
  return `closes ${c.regn_close}`;
}

function rowHtml(c, list, v) {
  const st = statusOf(v.decisions, c);
  const reg = v.editable
    ? `<label class="inbox-reg"><input type="checkbox" data-inbox-reg="${esc(c.id)}" data-inbox-list="${list}" aria-label="Registered for ${esc(c.title)}"> Registered</label>`
    : '';
  return `<li class="inbox-row">
        <a href="${esc(recordHref(c))}">${esc(c.title)}</a>
        <span class="inbox-meta">${esc(c.host)} · ${esc(whenText(c, v.today))}</span>
        <span class="inbox-chips">${verdictChipHtml(c)}${st === 'watching' || st === 'entering' ? `<span class="chip status">${esc(st)}</span>` : ''}</span>
        ${reg}
      </li>`;
}

// v: { fresh, closing, decisions, today, editable }
export function inboxHtml(v) {
  if (!v.fresh.length && !v.closing.length) {
    return `<div class="inbox inbox-quiet" id="inbox" tabindex="-1"><p>All caught up: nothing new, and everything closing soon is registered.</p></div>`;
  }
  return `<div class="inbox" id="inbox" tabindex="-1" role="region" aria-label="What needs attention">
    <section class="inbox-sec" aria-labelledby="inbox-new-h">
      <div class="inbox-head">
        <h2 id="inbox-new-h">New since your last visit (${v.fresh.length})</h2>
        ${v.fresh.length ? '<button type="button" id="inbox-seen">Mark all seen</button>' : ''}
      </div>
      ${v.fresh.length
        ? `<ul class="inbox-list">${v.fresh.map(c => rowHtml(c, 'new', v)).join('')}</ul>`
        : '<p class="inbox-none">Nothing new.</p>'}
    </section>
    <section class="inbox-sec" aria-labelledby="inbox-closing-h">
      <div class="inbox-head"><h2 id="inbox-closing-h">Closing within 10 days, not registered yet (${v.closing.length})</h2></div>
      ${v.closing.length
        ? `<ul class="inbox-list">${v.closing.map(c => rowHtml(c, 'closing', v)).join('')}</ul>`
        : '<p class="inbox-none">Nothing closing soon without a registration.</p>'}
    </section>
  </div>`;
}
