// One competition card. Every value that reaches HTML goes through esc();
// every link through safeHref (https only, else '#').
import { dayDiff } from '../dates.js';
import { httpsUrl } from '../urls.js';
import {
  VERDICTS, STATUSES, statusOf, isRegistered, expectedText, whoAppliesText, watchChanged, clashLabels, recordSection,
} from './data.js';
import { currentSection, tierLabel } from './section.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeHref = u => httpsUrl(u) || '#';
// The competition page link keeps the section: c.html?id=…&s=hack.
export const compHref = (id, section = currentSection()) =>
  `c.html?id=${encodeURIComponent(String(id))}${section === 'hack' ? '&s=hack' : ''}`;
// A record's own link: its section follows from the record.
export const recordHref = c => compHref(c.id, recordSection(c));

export function closesText(c, today) {
  if (!c.regn_close) return (!c.comp_end && expectedText(c)) || 'no deadline listed';
  const d = dayDiff(today, c.regn_close);
  if (d < 0) return 'registration closed';
  if (d === 0) return 'closes today';
  return `closes in ${d} day${d === 1 ? '' : 's'}`;
}

export function teamText(c) {
  if (!c.team_max) return 'team size not listed';
  if (c.team_max === 1) return 'solo';
  return c.team_max >= 4 ? `teams up to ${c.team_max}` : `max ${c.team_max}, send the subset`;
}

function feeText(c) {
  if (c.intl) return c.intl.fee ? `fee: ${c.intl.fee}` : null;
  return c.fee ? 'entry fee' : 'free';
}

const hostOf = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const onMlh = u => /(^|\.)mlh\.(io|com)$/.test(hostOf(u));

export function linkLabel(c) {
  if (c.source === 'curated') return 'Official site';
  if (c.source === 'oppdesk') return 'Opportunity Desk post';
  if (c.source === 'devfolio') return 'Open on Devfolio';
  if (c.source === 'devpost') return 'Open on Devpost';
  // MLH lists the event's own site; say so rather than claim it is MLH's page.
  if (c.source === 'mlh') return onMlh(c.url) ? 'Open on MLH' : 'Official site (listed on MLH)';
  return 'Open on Unstop';
}

// ---- hackathon facts ------------------------------------------------------

export const KIND_LABEL = { build: 'Build', ideathon: 'Ideathon', other: 'Other format' };

export function hackTeamText(c) {
  const min = Number.isInteger(c.team_min) && c.team_min > 0 ? c.team_min : null;
  const max = Number.isInteger(c.team_max) && c.team_max > 0 ? c.team_max : null;
  if (max === 1) return 'solo';
  if (max) return min === max ? `team of ${max}` : `team of ${min || 1}–${max}`;
  if (min) return `team of at least ${min}`;
  return 'team size not listed';
}

export function placeText(c) {
  if (c.mode === 'online') return 'Online';
  const where = (typeof c.location === 'string' && c.location.trim()) || (typeof c.country === 'string' && c.country.trim()) || '';
  if (c.mode === 'hybrid') return where ? `Hybrid: ${where}` : 'Hybrid';
  return where || 'In person, place not listed';
}

export const cardClass = (c, st) => `card v-${esc(c.verdict?.level)} s-${esc(st)}`;

export const tierChipHtml = c => `<span class="chip">${esc(tierLabel(c.tier))}</span>`;
export const kindChipHtml = c => (c.hack_kind ? `<span class="chip kind">${esc(KIND_LABEL[c.hack_kind] || c.hack_kind)}</span>` : '');
export const verdictChipHtml = c => `<span class="chip ${esc(c.verdict?.level)}">${esc(VERDICTS[c.verdict?.level] || '?')}</span>`;
// 'case' needs no chip; a business event (B-plan, pitch, flagship...) says so.
export const formatChipHtml = c => (c.format_kind === 'business' ? '<span class="chip business">Business event</span>' : '');
export const startupChipHtml = c => (c.kind === 'startup' ? '<span class="chip startup">Startup contest, not a case</span>' : '');

// ctx: { decisions, editable }
export function chipsHtml(c, st, ctx) {
  return `${tierChipHtml(c)}
      ${verdictChipHtml(c)}
      ${kindChipHtml(c)}
      ${st !== 'undecided' ? `<span class="chip status">${esc(st)}</span>` : ''}
      ${!ctx.editable && isRegistered(ctx.decisions, c) ? '<span class="chip registered">✓ Registered</span>' : ''}
      ${formatChipHtml(c)}
      ${startupChipHtml(c)}
      ${c.pinned ? '<span class="chip">added by hand</span>' : ''}`;
}

export function actionsHtml(c, st) {
  return `${STATUSES.map(s => `<button type="button" data-set="${s}" data-id="${esc(c.id)}" aria-pressed="${st === s}">${s[0].toUpperCase()}${s.slice(1)}</button>`).join('')}
        ${st !== 'undecided' ? `<button type="button" class="ghost" data-set="" data-id="${esc(c.id)}">Clear</button>` : ''}`;
}

const prizeText = c => (c.prize_total ? `prizes ₹${Number(c.prize_total).toLocaleString('en-IN')}` : null);

// ctx: { today, committed (both sections), decisions, editable, watch }
export function cardHtml(c, ctx) {
  const st = statusOf(ctx.decisions, c);
  const clash = clashLabels(c, ctx.committed, ctx.today);
  const note = ctx.decisions[String(c.id)]?.note || '';
  const facts = (recordSection(c) === 'hack'
    ? [closesText(c, ctx.today), placeText(c), hackTeamText(c), feeText(c), prizeText(c)]
    : [closesText(c, ctx.today), teamText(c), c.mode, feeText(c), prizeText(c)]).filter(Boolean);
  const who = whoAppliesText(c);
  const changed = watchChanged(ctx.watch, c, ctx.today);
  // The who-applies line already says it; don't repeat it as a reason.
  const reasons = (c.verdict?.reasons || []).filter(r => r !== who);
  const edit = ctx.editable
    ? `<div class="actions" role="group" aria-label="Decision for ${esc(c.title)}">
        ${actionsHtml(c, st)}
      </div>
      <label class="reg-toggle"><input type="checkbox" data-reg="${esc(c.id)}" aria-label="Registered for ${esc(c.title)}" ${isRegistered(ctx.decisions, c) ? 'checked' : ''}> Registered</label>
      <input class="note" data-note="${esc(c.id)}" value="${esc(note)}" placeholder="Note" aria-label="Note for ${esc(c.title)}">`
    : (note ? `<p class="note-ro">${esc(note)}</p>` : '');
  return `<article class="${cardClass(c, st)}" data-card="${esc(c.id)}">
    <div class="chips">
      ${chipsHtml(c, st, ctx)}
    </div>
    <h2><a href="${esc(recordHref(c))}">${esc(c.title)}</a></h2>
    <p class="host">${esc(c.host)}</p>
    <p class="facts">${facts.map(esc).join(' · ')}</p>
    ${who ? `<p class="who">${esc(who)}</p>` : ''}
    ${changed ? `<p class="watchflag">Official page changed on ${esc(changed)}, new edition?</p>` : ''}
    ${reasons.length ? `<ul class="reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${clash.length ? `<p class="clash">Clashes with ${clash.map(esc).join(', ')}</p>` : ''}
    <p class="ext"><a href="${esc(safeHref(c.url))}" target="_blank" rel="noopener">${esc(linkLabel(c))} ↗</a></p>
    ${edit}
  </article>`;
}
