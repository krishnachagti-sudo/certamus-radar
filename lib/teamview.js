// HTML for the team features: the competition page's Team section, the
// Team page's lists and the Board inbox's team rows. Pure string builders
// (tested in Node for escaping): every value goes through esc(), every
// invite link through safeHref(). Controls carry data-focus keys so focus
// survives a redraw (lib/focus.js), and data-* actions the pages listen for:
//   data-join="<id>" data-joined="1|0"   I've joined / Undo (mark_joined)
//   data-copy="<input id>"               copy the invite link in that input
//   data-round-done="<round id>"         done checkbox (set_round_done)
//   data-round-edit / data-round-del     admin round actions
import { dayDiff } from '../dates.js';
import { esc, safeHref, compHref } from './card.js';
import { memberName, istDay, isOverdue } from './teams.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_NOUN = { case: 'Case comp', hack: 'Hackathon' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const low = e => String(e ?? '').trim().toLowerCase();

// '10 Oct', with the year when it is not this year.
export function shortDay(d, today) {
  if (typeof d !== 'string' || !ISO.test(d)) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MON[m - 1]}${today && String(y) !== String(today).slice(0, 4) ? ` ${y}` : ''}`;
}

export function dueText(round, today) {
  if (!round?.due || !ISO.test(round.due)) return 'no due date';
  const d = dayDiff(today, round.due);
  if (round.done) return `due ${shortDay(round.due, today)}`;
  if (d < 0) return `overdue since ${shortDay(round.due, today)}`;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  return `due ${shortDay(round.due, today)}`;
}

// A focusable key safe for any id or email.
const fk = (...parts) => parts.map(p => String(p ?? '')).join(':');

// The invite link as a read-only field (selectable when the clipboard is
// blocked), Copy, and Open. Only an https link is ever shown.
export function inviteHtml(url, fieldId, label = 'Invite link') {
  const href = safeHref(url);
  if (href === '#') return '<p class="invite-bad">The saved invite link is not an https link; ask Krishna to fix it.</p>';
  return `<div class="invite">
      <input type="text" readonly id="${esc(fieldId)}" value="${esc(href)}" aria-label="${esc(label)}">
      <button type="button" data-copy="${esc(fieldId)}" data-focus="${esc(fk('copy', fieldId))}">Copy</button>
      <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open ↗</a>
    </div>`;
}

const joinButton = (listingId, joined, title) => (joined
  ? `<button type="button" class="ghost" data-join="${esc(listingId)}" data-joined="0" data-focus="${esc(fk('join', listingId))}" aria-label="Undo joined for ${esc(title)}">Undo</button>`
  : `<button type="button" class="primary sm" data-join="${esc(listingId)}" data-joined="1" data-focus="${esc(fk('join', listingId))}" aria-label="I've joined ${esc(title)}">I’ve joined</button>`);

// ---- competition page: Team section ------------------------------------------

function memberRowsHtml(v) {
  return v.teamMembers.map(r => {
    const mine = low(r.email) === low(v.viewer);
    const when = r.joined_at ? shortDay(istDay(r.joined_at), v.today) : '';
    const state = r.joined_at
      ? `<span class="tm-ok">✓ joined${when ? ` ${esc(when)}` : ''}</span>`
      : '<span class="tm-pending">pending</span>';
    return `<li class="tm-row${mine ? ' mine' : ''}">
        <span class="tm-name">${esc(memberName(r.email, v.members))}${mine ? ' <span class="muted">(you)</span>' : ''}</span>
        ${state}
        ${mine ? joinButton(v.team.listing_id, !!r.joined_at, v.title) : ''}
      </li>`;
  }).join('');
}

function teamFormHtml(v) {
  const f = v.teamForm;
  const active = v.members.filter(m => m && m.active !== false);
  const boxes = active.map(m => {
    const e = low(m.email);
    return `<label class="tm-pick"><input type="checkbox" name="email" value="${esc(e)}" data-focus="${esc(fk('pick', e))}"${f.emails.has(e) ? ' checked' : ''}> ${esc(memberName(e, v.members))}</label>`;
  }).join('');
  return `<form class="team-form" id="team-form">
      <fieldset><legend>Team members</legend>${boxes || '<p class="muted">No active members.</p>'}</fieldset>
      <label for="team-url">Invite link (https)</label>
      <input type="url" id="team-url" name="url" required placeholder="Paste the Unstop “invite teammates” link" value="${esc(f.url)}">
      <div class="form-btns">
        <button type="submit" class="primary" id="team-save"${v.busy ? ' disabled' : ''}>${f.mode === 'edit' ? 'Save team' : 'Create team'}</button>
        <button type="button" class="ghost" id="team-cancel">Cancel</button>
      </div>
      ${f.mode === 'create' ? '<p class="muted small">Creating the team also ticks Registered.</p>' : ''}
    </form>`;
}

function roundRowHtml(r, v) {
  const overdue = isOverdue(r, v.today);
  const owner = r.owner_email ? memberName(r.owner_email, v.members) : 'Team';
  const admin = v.isAdmin
    ? `<span class="rd-acts"><button type="button" class="ghost" data-round-edit="${esc(r.id)}" data-focus="${esc(fk('redit', r.id))}" aria-label="Edit round ${esc(r.name)}">Edit</button>
        <button type="button" class="ghost" data-round-del="${esc(r.id)}" data-focus="${esc(fk('rdel', r.id))}" aria-label="Delete round ${esc(r.name)}">Delete</button></span>`
    : '';
  return `<li class="rd-row${overdue ? ' overdue' : ''}${r.done ? ' done' : ''}">
      <label class="rd-done"><input type="checkbox" data-round-done="${esc(r.id)}" data-focus="${esc(fk('rdone', r.id))}"${r.done ? ' checked' : ''}> <span class="rd-name">${esc(r.name)}</span></label>
      <span class="rd-meta">${esc(dueText(r, v.today))} · ${esc(owner)}${overdue ? '<span class="sr"> (overdue)</span>' : ''}</span>
      ${admin}
    </li>`;
}

function roundFormHtml(v) {
  const f = v.roundForm;
  const opts = [['', 'Team']].concat(v.teamMembers.map(r => [low(r.email), memberName(r.email, v.members)]))
    .map(([val, label]) => `<option value="${esc(val)}"${low(f.owner) === val ? ' selected' : ''}>${esc(label)}</option>`).join('');
  return `<form class="round-form" id="round-form">
      <h4>${f.id ? 'Edit round' : 'Add a round'}</h4>
      <label>Name <input type="text" id="round-name" name="name" required maxlength="200" value="${esc(f.name)}" placeholder="e.g. Prelims deck"></label>
      <label>Due <input type="date" id="round-due" name="due" value="${esc(f.due)}"></label>
      <label>Owner <select id="round-owner" name="owner">${opts}</select></label>
      <div class="form-btns">
        <button type="submit" class="primary" id="round-save"${v.busy ? ' disabled' : ''}>${f.id ? 'Save round' : 'Add round'}</button>
        ${f.id || f.open ? '<button type="button" class="ghost" id="round-cancel">Cancel</button>' : ''}
      </div>
    </form>`;
}

function roundsHtml(v) {
  const list = [...v.rounds].sort((a, b) => {
    const da = a.due || '9999';
    const db = b.due || '9999';
    return da === db ? String(a.name).localeCompare(String(b.name)) : (da < db ? -1 : 1);
  });
  const add = v.isAdmin
    ? (v.roundForm ? roundFormHtml(v) : '<p><button type="button" id="round-add">Add a round</button></p>')
    : '';
  return `<div class="rounds">
      <h3 id="h-rounds">Rounds</h3>
      ${list.length ? `<ul class="rd-list" aria-labelledby="h-rounds">${list.map(r => roundRowHtml(r, v)).join('')}</ul>`
        : `<p class="muted">No rounds yet.${v.isAdmin ? ' Add the first deadline below.' : ''}</p>`}
      ${add}
    </div>`;
}

// v: { team | null, teamMembers (this team), rounds (this team), members,
//      viewer (email), isAdmin, today, title, teamForm, roundForm, busy, msg }
// Returns '' for a member when there is no team.
export function teamSectionHtml(v) {
  const msg = `<p class="team-msg" id="team-msg" role="status">${esc(v.msg || '')}</p>`;
  if (!v.team) {
    if (!v.isAdmin) return '';
    return `<section class="sec team" aria-labelledby="h-team"><h2 id="h-team">Team</h2>
      ${v.teamForm ? teamFormHtml(v) : `<p class="muted">No team recorded yet.</p>
        <p><button type="button" class="primary" id="team-create">Create team</button></p>`}
      ${msg}
    </section>`;
  }
  const joined = v.teamMembers.filter(r => r.joined_at).length;
  const admin = v.isAdmin && !v.teamForm
    ? `<div class="team-admin"><button type="button" id="team-edit">Edit team</button>
        <button type="button" class="ghost danger" id="team-delete">Delete team</button></div>`
    : '';
  return `<section class="sec team" aria-labelledby="h-team">
      <h2 id="h-team">Team <span class="muted small">${joined}/${v.teamMembers.length} joined</span></h2>
      ${v.teamForm ? teamFormHtml(v) : `<ul class="tm-list">${memberRowsHtml(v)}</ul>
        ${inviteHtml(v.team.invite_url, 'invite-url')}`}
      ${admin}
      ${msg}
      ${roundsHtml(v)}
    </section>`;
}

// ---- Team page and Board inbox -------------------------------------------------

const compLink = item => `<a href="${esc(compHref(item.listing_id, item.section))}">${esc(item.title)}</a>${item.archived ? ' <span class="chip archived">Archived</span>' : ''}`;

// One "join this team" row: title, invite link, Copy, I've joined.
export function joinRowHtml(item, prefix = 'join') {
  const field = `${prefix}-url-${String(item.listing_id).replace(/[^A-Za-z0-9_-]/g, '_')}`;
  return `<li class="join-row">
      <span class="join-title">${compLink(item)} <span class="muted small">${esc(SECTION_NOUN[item.section] || '')}</span></span>
      ${inviteHtml(item.invite_url, field, `Invite link for ${item.title}`)}
      ${joinButton(item.listing_id, false, item.title)}
    </li>`;
}

// rounds: myRounds() rows; titleOf(round) -> { title, section, listing_id, archived }.
export function myRoundRowHtml(r, comp, today) {
  return `<li class="rd-row${r.overdue ? ' overdue' : ''}">
      <label class="rd-done"><input type="checkbox" data-round-done="${esc(r.id)}" data-focus="${esc(fk('rdone', r.id))}"${r.done ? ' checked' : ''}> <span class="rd-name">${esc(r.name)}</span></label>
      <span class="rd-meta">${compLink(comp)} · ${esc(dueText(r, today))}${r.owner_email ? '' : ' · team'}${r.overdue ? '<span class="sr"> (overdue)</span>' : ''}</span>
    </li>`;
}

// waiting: pendingByPerson() rows.
export function waitingHtml(waiting, members, headingId = 'h-waiting', { withHeading = true } = {}) {
  const n = waiting.reduce((s, p) => s + p.items.length, 0);
  const rows = waiting.map(p => `<li class="wait-row">
      <span class="wait-name">${esc(memberName(p.email, members))}</span>
      <ul class="wait-comps">${p.items.map(i => `<li>${compLink(i)}</li>`).join('')}</ul>
    </li>`).join('');
  return `${withHeading ? `<h2 id="${esc(headingId)}">Waiting on teammates (${n})</h2>` : ''}
    <ul class="wait-list" aria-labelledby="${esc(headingId)}">${rows}</ul>`;
}

// summaries: teamSummaries() rows.
export function allTeamsHtml(summaries, today) {
  if (!summaries.length) return '<p class="empty">No teams yet. Create one from a competition page’s Team section.</p>';
  return `<ul class="teams-list">${summaries.map(s => {
    const next = s.next ? `${esc(s.next.name)}, ${esc(dueText(s.next, today))}` : 'no upcoming round';
    return `<li class="team-row">
        <span class="team-title">${compLink(s)}</span>
        <span class="muted small">${esc(SECTION_NOUN[s.section] || '')}</span>
        <span class="team-prog${s.joined < s.total ? ' partial' : ''}">${s.joined}/${s.total} joined</span>
        <span class="team-next">Next: ${next}</span>
        ${s.overdue ? `<span class="team-overdue">${esc(plural(s.overdue, 'overdue round'))}</span>` : ''}
      </li>`;
  }).join('')}</ul>`;
}

// The Board inbox's top panel. v: { joins, waiting, members, isAdmin }.
// '' when nothing applies.
export function teamInboxHtml(v) {
  const parts = [];
  if (v.joins.length) {
    parts.push(`<section class="inbox-sec" aria-labelledby="inbox-join-h">
      <div class="inbox-head"><h2 id="inbox-join-h">Join these teams (${v.joins.length})</h2></div>
      <ul class="inbox-list">${v.joins.map(j => joinRowHtml(j, 'inbox')).join('')}</ul>
    </section>`);
  }
  if (v.isAdmin && v.waiting.length) {
    const n = v.waiting.reduce((s, p) => s + p.items.length, 0);
    parts.push(`<section class="inbox-sec" aria-labelledby="inbox-wait-h">
      <div class="inbox-head"><h2 id="inbox-wait-h">Waiting on teammates (${n})</h2><a href="team.html">Team page</a></div>
      ${waitingHtml(v.waiting, v.members, 'inbox-wait-h', { withHeading: false })}
    </section>`);
  }
  if (!parts.length) return '';
  return `<div class="inbox team-inbox" id="team-inbox" tabindex="-1" role="region" aria-label="Teams">${parts.join('')}</div>`;
}
