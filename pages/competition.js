// Competition page, c.html?id=<id>: one listing in two columns (mock B).
// Left: chips, title, eligibility rule by rule (or the curated facts), dates,
// team note. Right, sticky: countdown, team/format/fee/prizes, status, the
// Registered tick, clash warnings, the watcher flag and the outbound link;
// in edit mode a curated record also gets "Set dates". Ids are strings.
import { clashes } from '../clash.js';
import { dayDiff, todayIST } from '../dates.js';
import {
  STATUSES, sameId, statusOf, isRegistered, committedSet, expectedText, whoAppliesText, watchChanged,
  needsFullRender, pagesJson,
} from '../lib/data.js';
import { AuthError, TOKEN_REJECTED, apiUpdate, createDecisionSaver, getToken, setToken } from '../lib/gh.js';
import { esc, safeHref, teamText, linkLabel, tierChipHtml, verdictChipHtml, startupChipHtml } from '../lib/card.js';
import { eligibilityRows } from '../lib/eligibility.js';
import { captureFocus } from '../lib/focus.js';
import { mountNav } from '../lib/nav.js';
import { loadDecisions, bannersHtml, askToken, editFooterHtml } from '../lib/session.js';

const ID = new URLSearchParams(location.search).get('id') ?? '';
const SITE = 'Certamus Radar';

const state = { comps: [], archive: [], intl: [], watch: {}, status: {}, decisions: {}, error: null, datesMsg: '' };
const editable = () => !!getToken();

const ENTRY = { open: 'Open entry', invite: 'By invitation', qualifier: 'Qualifier round', unclear: 'Entry route unclear' };
const INDIAN_UG = { yes: 'Open to Indian undergraduates', no: 'Not open to Indian undergraduates', unclear: 'Unclear for Indian undergraduates' };
const ICON = { ok: '✅', check: '⚠️', out: '❌', unchecked: '–' };
const ICON_LABEL = { ok: 'Passed', check: 'Check', out: 'Fails', unchecked: 'Not checked' };

const fmtDate = d => (d
  ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : null);
const dateOr = (d, missing) => esc(fmtDate(d) || missing);

async function tokenRejected() {
  setToken(null);
  saver.drop();
  state.decisions = await pagesJson('decisions.json', {});
  state.error = TOKEN_REJECTED;
}

async function load() {
  state.error = null;
  [state.comps, state.archive, state.intl, state.watch, state.status] = await Promise.all([
    pagesJson('competitions.json', []), pagesJson('archive.json', []), pagesJson('international.json', []),
    pagesJson('watch.json', {}), pagesJson('status.json', {})]);
  await loadDecisions(state, tokenRejected);
  render();
}

const findComp = () => (Array.isArray(state.comps) ? state.comps : []).find(c => sameId(c.id, ID));
// A curated id can be archived once per edition: the newest entry wins.
const findArchived = () => (Array.isArray(state.archive) ? state.archive : []).filter(a => sameId(a?.id, ID)).at(-1);
const curatedRow = c => (Array.isArray(state.intl) ? state.intl : []).find(r => sameId(r?.id, c.id));

// ---- left column --------------------------------------------------------

function eligibilityHtml(c) {
  const rows = eligibilityRows(c);
  if (rows) {
    return `<section class="sec" aria-labelledby="h-elig"><h2 id="h-elig">Eligibility, rule by rule</h2>
      ${rows.map(r => `<div class="rule r-${esc(r.state)}"><span class="ico" aria-hidden="true">${ICON[r.state]}</span><div><b>${esc(r.name)}</b><span class="sr"> ${ICON_LABEL[r.state]}:</span><small>${esc(r.detail)}</small></div></div>`).join('')}
    </section>`;
  }
  const facts = [];
  if (c.source === 'curated') {
    const i = c.intl || {};
    const entry = [ENTRY[i.entry], i.entry_note].filter(Boolean).join(': ');
    if (entry) facts.push(['Entry route', entry]);
    const who = whoAppliesText(c);
    if (who) facts.push(['Who applies', who]);
    const ug = [INDIAN_UG[i.indian_ug], i.indian_ug_note].filter(Boolean).join('. ');
    if (ug) facts.push(['Indian undergraduates', ug]);
    if (i.last_edition) facts.push(['Last edition', i.last_edition]);
    const w = state.watch?.[String(c.id)];
    if (w?.last_checked) facts.push(['Official page', `checked ${w.last_checked}${w.last_error ? ` (last check failed: ${w.last_error})` : ''}`]);
  } else {
    facts.push(['Source', 'Opportunity Desk listing']);
  }
  const reasons = (c.verdict?.reasons || []).filter(r => r !== whoAppliesText(c));
  return `<section class="sec" aria-labelledby="h-elig"><h2 id="h-elig">Eligibility and entry</h2>
    <dl class="dl">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${reasons.length ? `<ul class="reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function datesHtml(c, missing) {
  return `<section class="sec" aria-labelledby="h-dates"><h2 id="h-dates">Dates</h2><dl class="dl">
    <dt>Registration closes</dt><dd>${dateOr(c.regn_close, missing)}</dd>
    <dt>Competition ends</dt><dd>${dateOr(c.comp_end, missing)}</dd>
    <dt>First seen</dt><dd>${dateOr(c.first_seen, 'not recorded')}</dd>
    ${c.closed_on ? `<dt>Closed on</dt><dd>${dateOr(c.closed_on, '')}</dd>` : ''}
  </dl></section>`;
}

function noteHtml(c) {
  const note = state.decisions?.[String(c.id)]?.note || '';
  const body = editable()
    ? `<textarea data-note="${esc(c.id)}" aria-labelledby="h-note" placeholder="Who is on it, what to prepare">${esc(note)}</textarea>`
    : `<p class="note-text">${note ? esc(note) : '<span class="muted">No note yet.</span>'}</p>`;
  return `<section class="sec" aria-labelledby="h-note"><h2 id="h-note">Team note</h2>${body}</section>`;
}

// ---- right panel ----------------------------------------------------------

function countdownHtml(c, today) {
  if (c.regn_close) {
    const d = dayDiff(today, c.regn_close);
    if (d < 0) return `<div class="countdown">Closed<small>registration closed ${esc(fmtDate(c.regn_close))}</small></div>`;
    if (d === 0) return '<div class="countdown">Today<small>registration closes today</small></div>';
    return `<div class="countdown">${d} day${d === 1 ? '' : 's'}<small>until registration closes</small></div>`;
  }
  const exp = c.source === 'curated' && expectedText(c);
  if (exp && exp !== 'dates not announced') return `<div class="countdown">Expected<small>${esc(exp)}</small></div>`;
  return '<div class="countdown">Dates<small>dates not confirmed</small></div>';
}

function factsHtml(c) {
  let team = teamText(c);
  let format = c.mode || 'not listed';
  let fee = c.fee ? 'paid entry' : 'free';
  if (c.source === 'curated') {
    const size = curatedRow(c)?.team_size;
    if (size) team = String(size);
    format = ENTRY[c.intl?.entry] || 'not listed';
    fee = c.intl?.fee || 'not listed';
  } else if (c.source === 'oppdesk') {
    format = 'see the post';
    fee = 'see the post';
  } else if (c.team_max) {
    team = `${c.team_min || 1}–${c.team_max} (${team})`;
  }
  const prizes = c.prize_total ? `₹${Number(c.prize_total).toLocaleString('en-IN')}` : 'not listed';
  return `<dl class="dl"><dt>Team</dt><dd>${esc(team)}</dd><dt>Format</dt><dd>${esc(format)}</dd>
    <dt>Fee</dt><dd>${esc(fee)}</dd><dt>Prizes</dt><dd>${esc(prizes)}</dd></dl>`;
}

const label = s => s[0].toUpperCase() + s.slice(1);

function statusHtml(c) {
  const st = statusOf(state.decisions, c);
  const reg = isRegistered(state.decisions, c);
  if (!editable()) {
    return `<h3>Status</h3><div class="seg" aria-hidden="true">${STATUSES.map(s => `<span${s === st ? ' class="on"' : ''}>${label(s)}</span>`).join('')}</div>
      <p class="sr">Status: ${esc(st)}</p>
      ${reg ? '<div class="regrow"><span class="box" aria-hidden="true">✓</span> Registered</div>' : ''}`;
  }
  return `<h3 id="h-status">Status</h3>
    <div class="seg" role="group" aria-labelledby="h-status">${STATUSES.map(s => `<button type="button" data-set="${s}" data-id="${esc(c.id)}" aria-pressed="${st === s}">${label(s)}</button>`).join('')}</div>
    ${st !== 'undecided' ? `<p class="clear-row"><button type="button" class="ghost" data-set="" data-id="${esc(c.id)}">Clear status</button></p>` : ''}
    <label class="regrow${reg ? ' on' : ''}"><input type="checkbox" data-reg="${esc(c.id)}" ${reg ? 'checked' : ''}> Registered</label>`;
}

function datesFormHtml(c) {
  if (c.source !== 'curated' || !editable()) return '';
  return `<form class="setdates" id="setdates">
      <h3>Set dates</h3>
      <label>Registration closes <input type="date" name="regn_close" value="${esc(c.regn_close || '')}"></label>
      <label>Competition ends <input type="date" name="comp_end" value="${esc(c.comp_end || '')}"></label>
      <button type="submit" id="dates-btn">Save dates</button>
      <p id="dates-msg" role="status">${esc(state.datesMsg)}</p>
    </form>`;
}

function panelHtml(c, today) {
  const clash = clashes(c, committedSet(state.comps, state.decisions), today);
  const changed = c.source === 'curated' ? watchChanged(state.watch, c, today) : null;
  return `<aside class="panel" aria-label="Decision">
    ${countdownHtml(c, today)}
    ${factsHtml(c)}
    ${statusHtml(c)}
    ${clash.length ? `<div class="warn" role="note">⚠ Within a week of ${clash.map(esc).join(', ')}, which the team is entering or registered for.</div>` : ''}
    ${changed ? `<div class="watchnote">Official page changed on ${esc(changed)}, new edition?</div>` : ''}
    <a class="big" href="${esc(safeHref(c.url))}" target="_blank" rel="noopener">${esc(linkLabel(c))} ↗</a>
    ${datesFormHtml(c)}
  </aside>`;
}

// ---- views ----------------------------------------------------------------

function liveHtml(c) {
  const today = todayIST();
  const missing = c.source === 'curated' ? 'not confirmed' : 'not listed';
  return `<div class="cols">
    <div class="main">
      <div class="chips">${tierChipHtml(c)} ${verdictChipHtml(c)} ${startupChipHtml(c)}</div>
      <h1>${esc(c.title)}</h1>
      <p class="host">${esc(c.host)}</p>
      ${eligibilityHtml(c)}
      ${datesHtml(c, missing)}
      ${noteHtml(c)}
    </div>
    ${panelHtml(c, today)}
  </div>`;
}

function archivedHtml(a) {
  return `<div class="cols">
    <div class="main">
      <div class="chips">${tierChipHtml(a)} <span class="chip archived">Archived</span></div>
      <h1>${esc(a.title)}</h1>
      <p class="host">${esc(a.host)}</p>
      ${datesHtml(a, 'not listed')}
    </div>
    <aside class="panel" aria-label="Archived">
      <div class="countdown">Closed<small>${a.closed_on ? `closed on ${esc(fmtDate(a.closed_on))}` : 'no longer listed'}</small></div>
      <a class="big" href="${esc(safeHref(a.url))}" target="_blank" rel="noopener">${esc(linkLabel(a))} ↗</a>
    </aside>
  </div>`;
}

const notFoundHtml = () => `<section class="sec notfound"><h1>Not found, it may have been archived</h1>
  <p>No competition with this id is on the radar now. <a href="hosts.html">See Hosts &amp; archive</a>.</p></section>`;

function render() {
  const focus = captureFocus();
  // A note being typed survives a redraw (a save landing mid-typing).
  const typing = document.activeElement?.tagName === 'TEXTAREA'
    ? { value: document.activeElement.value, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  const c = findComp();
  const a = c ? null : findArchived();
  let body;
  if (c) { body = liveHtml(c); document.title = `${c.title} · ${SITE}`; }
  else if (a) { body = archivedHtml(a); document.title = `${a.title} · ${SITE}`; }
  else { body = notFoundHtml(); document.title = `Not found · ${SITE}`; }
  document.getElementById('app').innerHTML = `<div id="banners">${banners()}</div>
    <div class="comp">${body}</div>
    ${c ? editFooterHtml(editable(), state.status.last_ok) : ''}`;
  focus.restore();
  if (typing) {
    const t = document.querySelector('textarea[data-note]');
    if (t) { t.value = typing.value; t.focus(); try { t.setSelectionRange(typing.start, typing.end); } catch { /* ignore */ } }
  }
}

const banners = () => bannersHtml(state.status, state.error);
function renderBanners() {
  const el = document.getElementById('banners');
  if (el) el.innerHTML = banners();
}

// On this page everything but the note is one small panel, so any status or
// Registered change redraws the page; a note's own save never does.
const saver = createDecisionSaver(state, {
  local(id, before, after, { fromNote = false }) {
    if (!fromNote || needsFullRender(before, after) || before.status !== after.status) render();
  },
  saved(id, shown, now) {
    if (state.error) { state.error = null; renderBanners(); }
    if (needsFullRender(shown, now) || now.status !== shown.status) render();
    if (now.note !== shown.note) {
      const t = document.querySelector('textarea[data-note]');
      if (t && document.activeElement !== t) t.value = now.note;
    }
  },
  async authRejected() { await tokenRejected(); render(); },
  failed(err) {
    state.error = `Not saved: ${err.message}`; // the change stays on screen
    renderBanners();
  },
});

document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'unlock') {
    if (askToken()) await load();
  } else if (b.id === 'lock') {
    setToken(null); await load();
  } else if ('set' in b.dataset && editable()) {
    await saver.save(b.dataset.id, d => ({ ...d, status: b.dataset.set || undefined }));
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (!editable()) return;
  if (el.dataset.reg !== undefined) {
    const on = el.checked;
    await saver.save(el.dataset.reg, d => ({ ...d, registered: on || undefined }));
  } else if (el.dataset.note !== undefined) {
    const value = el.value.trim();
    await saver.save(el.dataset.note, d => ({ ...d, note: value || undefined }), { fromNote: true });
  }
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;

document.addEventListener('submit', async e => {
  if (e.target.id !== 'setdates') return;
  e.preventDefault();
  const c = findComp();
  if (!c || c.source !== 'curated') return;
  const msg = document.getElementById('dates-msg');
  const btn = document.getElementById('dates-btn');
  const regn = e.target.regn_close.value;
  const end = e.target.comp_end.value;
  if ((regn && !ISO.test(regn)) || (end && !ISO.test(end))) { msg.textContent = 'Use the date pickers'; return; }
  if (regn && end && end < regn) { msg.textContent = 'The competition cannot end before registration closes'; return; }
  const key = String(c.id);
  btn.disabled = true;
  msg.textContent = 'Saving…';
  try {
    await apiUpdate('data/intl-dates.json', data => {
      const next = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
      if (!regn && !end) delete next[key];
      else next[key] = { regn_close: regn || null, comp_end: end || null, confirmed_on: todayIST() };
      return next;
    }, `dates: ${key}`);
    state.datesMsg = !regn && !end ? 'Cleared; the calendar updates after the next fetch' : 'Saved; the calendar updates after the next fetch';
    msg.textContent = state.datesMsg;
  } catch (err) {
    if (err instanceof AuthError) { await tokenRejected(); render(); return; }
    msg.textContent = err.message;
  } finally {
    const b = document.getElementById('dates-btn');
    if (b) b.disabled = false;
  }
});

mountNav(null);
load();
