// One competition card. Every value that reaches HTML goes through esc();
// every link through safeHref (https only, else '#').
import { clashes } from '../clash.js';
import { dayDiff } from '../dates.js';
import { httpsUrl } from '../urls.js';
import {
  TIERS, VERDICTS, STATUSES, statusOf, isRegistered, expectedText, whoAppliesText, watchChanged,
} from './data.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeHref = u => httpsUrl(u) || '#';
export const compHref = id => `c.html?id=${encodeURIComponent(String(id))}`;

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

export function linkLabel(c) {
  if (c.source === 'curated') return 'Official site';
  if (c.source === 'oppdesk') return 'Opportunity Desk post';
  return 'Open on Unstop';
}

export const cardClass = (c, st) => `card v-${esc(c.verdict?.level)} s-${esc(st)}`;

export const tierChipHtml = c => `<span class="chip">${esc(TIERS[c.tier] || c.tier)}</span>`;
export const verdictChipHtml = c => `<span class="chip ${esc(c.verdict?.level)}">${esc(VERDICTS[c.verdict?.level] || '?')}</span>`;
// 'case' needs no chip; a business event (B-plan, pitch, flagship...) says so.
export const formatChipHtml = c => (c.format_kind === 'business' ? '<span class="chip business">Business event</span>' : '');
export const startupChipHtml = c => (c.kind === 'startup' ? '<span class="chip startup">Startup contest, not a case</span>' : '');

// ctx: { decisions, editable }
export function chipsHtml(c, st, ctx) {
  return `${tierChipHtml(c)}
      ${verdictChipHtml(c)}
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

// ctx: { today, committed, decisions, editable, watch }
export function cardHtml(c, ctx) {
  const st = statusOf(ctx.decisions, c);
  const clash = clashes(c, ctx.committed, ctx.today);
  const note = ctx.decisions[String(c.id)]?.note || '';
  const facts = [closesText(c, ctx.today), teamText(c), c.mode, feeText(c),
    c.prize_total ? `prizes ₹${c.prize_total.toLocaleString('en-IN')}` : null].filter(Boolean);
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
    <h2><a href="${esc(compHref(c.id))}">${esc(c.title)}</a></h2>
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
