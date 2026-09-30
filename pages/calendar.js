// Calendar page (calendar.html): a month grid (mock A) with an Agenda toggle
// (mock C). Read-only. Shows competitions that are Watching, Entering or
// Registered: ⏰ registration closes, 🏁 competition ends, clash days tinted,
// and dashed "expected" markers for curated international items (§9.10).
// Decisions load like the Board: live from the store (public reads).
// Section (?s=hack): this section's Watching items, plus the Entering and
// Registered items of BOTH sections (one committed set, one clash rule);
// the other section's items carry a small section marker.
import { todayIST } from '../dates.js';
import { committedSet, expectedText, monthsText, pagesJson, sameId, recordSection } from '../lib/data.js';
import { initEditor } from '../lib/editor.js';
import { esc, recordHref } from '../lib/card.js';
import { SECTIONS, currentSection, otherSection, pageHref, sectionOf } from '../lib/section.js';
import { captureFocus } from '../lib/focus.js';
import { mountNav } from '../lib/nav.js';
import { loadDecisions, bannersHtml, istTime } from '../lib/session.js';
import {
  monthCells, addMonths, monthTitle, calendarEvents, eventsByDay, clashDays, agendaGroups,
  expectedItems, expectedMarkers, onCalendar, toneOf, statusLabel,
} from '../lib/calendar.js';

const VIEW_KEY = 'certamus-radar.calview';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KIND = { close: ['⏰', 'Registration closes'], end: ['🏁', 'Competition ends'] };

function storedView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'grid' || v === 'agenda') return v;
  } catch { /* storage blocked */ }
  try { return matchMedia('(max-width: 760px)').matches ? 'agenda' : 'grid'; } catch { return 'grid'; }
}
function storeView(v) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
}

const startMonth = () => {
  const t = todayIST();
  return { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) };
};

const sec = sectionOf(currentSection());
const other = sectionOf(otherSection(sec.key));

const state = { comps: [], own: [], otherItems: [], status: {}, decisions: {}, error: null, notice: null, view: storedView(), ...startMonth() };

async function load() {
  state.error = null;
  [state.own, state.status, state.otherItems] = await Promise.all([
    pagesJson(sec.files.items, []), pagesJson(sec.files.status, {}), pagesJson(other.files.items, [])]);
  if (!Array.isArray(state.own)) state.own = [];
  if (!Array.isArray(state.otherItems)) state.otherItems = [];
  await loadDecisions(state);
  // The other section contributes only what the team is entering or registered for.
  state.comps = [...state.own, ...committedSet(state.otherItems, state.decisions)];
  render();
}

// A marker for items from the other section: "Hack" on the case-comp
// calendar, "Case" on the hackathon one.
const foreign = c => !!c && recordSection(c) !== sec.key;
const SHORT = { case: 'Case', hack: 'Hack' };
const secMark = c => (foreign(c)
  ? `<span class="secmark" aria-hidden="true">${SHORT[recordSection(c)]}</span><span class="sr"> (${esc(SECTIONS[recordSection(c)].noun)})</span>` : '');
const titleWithSection = (c, title) => (foreign(c) ? `${title} (${SECTIONS[recordSection(c)].noun})` : title);

const dayParts = d => {
  const t = new Date(`${d}T00:00:00Z`);
  return { day: t.getUTCDate(), mon: MON[t.getUTCMonth()], weekday: WEEKDAY[t.getUTCDay()] };
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// "Alpha and Beta, 1 day apart" for every pair on a day (each pair once).
function clashTitle(pairs) {
  const seen = new Set();
  const out = [];
  for (const p of pairs) {
    const key = [String(p.id), String(p.otherId)].sort().join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${titleWithSection(compById(p.id), p.title)} and ${titleWithSection(compById(p.otherId), p.other)}, ${plural(p.apart, 'day')} apart`);
  }
  return out.join('; ');
}

const compById = id => state.comps.find(c => sameId(c.id, id));
const statusOfId = id => { const c = compById(id); return c ? statusLabel(state.decisions, c) : 'committed'; };

// ---- month grid -----------------------------------------------------------

function eventLink(e) {
  const [icon, kind] = KIND[e.kind];
  const tip = `${kind}: ${titleWithSection(e.c, e.title)} (${e.status})`;
  return `<a class="ev tag ${e.tone}${e.kind === 'close' ? ' deadline' : ''}" href="${esc(recordHref(e.c))}" title="${esc(tip)}"><span aria-hidden="true">${icon}</span> <span class="sr">${esc(kind)}: </span>${secMark(e.c)}<span class="t">${esc(e.title)}</span><span class="sr"> (${esc(e.status)})</span></a>`;
}

const expectedLink = m => `<a class="ev tag exp x-${m.tone}" href="${esc(recordHref(m.c))}" title="${esc(m.label)}"><span aria-hidden="true">◇</span> ${secMark(m.c)}<span class="t">${esc(m.label)}</span></a>`;

const clashLabel = pairs => {
  const t = clashTitle(pairs);
  return `<span class="ev tag clashc" title="${esc(t)}"><span aria-hidden="true">⚠</span> <span class="t">clash</span><span class="sr">: ${esc(t)}</span></span>`;
};

function gridHtml(today) {
  const { year, month } = state;
  const byDay = eventsByDay(state.comps, state.decisions);
  const { pairs } = clashDays(committedSet(state.comps, state.decisions), today);
  const expected = expectedMarkers(state.comps, state.decisions, year, month);
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const cells = monthCells(year, month).map(d => {
    const inMonth = d.startsWith(prefix);
    const clash = pairs.get(d);
    const p = dayParts(d);
    const cls = ['day', inMonth ? '' : 'out', d === today ? 'today' : '', clash ? 'clash' : ''].filter(Boolean).join(' ');
    const items = [
      ...(inMonth ? expected.filter(m => m.date === d).map(expectedLink) : []),
      ...(byDay.get(d) || []).map(eventLink),
      clash ? clashLabel(clash) : '',
    ].join('');
    return `<div class="${cls}" role="listitem"${d === today ? ' aria-current="date"' : ''}><span class="n"><span class="sr">${p.weekday} </span>${p.day}<span class="sr"> ${p.mon}${d === today ? ', today' : ''}</span></span>${items}</div>`;
  }).join('');
  return `<div class="legend" aria-hidden="true"><span class="tag reg">✓ Registered</span><span class="tag ent">Entering</span><span class="tag wat">Watching</span><span class="tag exp">Expected (international)</span><span class="tag clashc">⚠ Clash</span><span><span class="secmark">${SHORT[other.key]}</span> = ${esc(other.noun)}, entering or registered</span><span>⏰ registration closes · 🏁 competition ends</span></div>
    <div class="grid" role="list" aria-label="${esc(monthTitle(year, month))}">${DOW.map(d => `<div class="dow" aria-hidden="true">${d}</div>`).join('')}${cells}</div>`;
}

// ---- agenda ---------------------------------------------------------------

const chip = tone => (tone === 'reg' ? '<span class="tag reg">✓ Registered</span>'
  : tone === 'ent' ? '<span class="tag ent">Entering</span>'
    : tone === 'wat' ? '<span class="tag wat">Watching</span>' : '<span class="tag exp">Expected</span>');

function clashText(e, pairs) {
  const mine = (pairs.get(e.date) || []).filter(p => sameId(p.id, e.id));
  return mine.map(p => `⚠ Clashes with ${titleWithSection(compById(p.otherId), p.other)} (${plural(p.apart, 'day')} apart). ${p.other} is ${statusOfId(p.otherId)}, ${p.title} is ${e.status}.`);
}

function agendaRow(e, pairs) {
  const p = dayParts(e.date);
  const warns = clashText(e, pairs);
  return `<li class="item">
      <div class="date">${p.day} ${p.mon}<small>${p.weekday}</small></div>
      <div class="what"><a href="${esc(recordHref(e.c))}">${secMark(e.c)}${esc(e.title)}</a><small>${esc(KIND[e.kind][1])}${e.host ? ` · ${esc(e.host)}` : ''}</small></div>
      ${chip(e.tone)}
      ${warns.map(w => `<p class="warn">${esc(w)}</p>`).join('')}
    </li>`;
}

function expectedRow(c) {
  const app = monthsText(c.expected?.application_months);
  const tone = onCalendar(state.decisions, c) ? toneOf(state.decisions, c) : 'exp';
  const text = (expectedText(c) || '').replace(/^./, s => s.toUpperCase());
  return `<li class="item exp">
      <div class="date">${esc(app || monthsText(c.expected?.finals_months) || '')}<small>${app ? 'applications' : 'finals'}</small></div>
      <div class="what"><a href="${esc(recordHref(c))}">${secMark(c)}${esc(c.title)}</a><small>${esc(text)}${c.host ? ` · ${esc(c.host)}` : ''}</small></div>
      ${chip(tone)}
    </li>`;
}

// `marked` says whether anything is Watching/Entering/Registered. When
// nothing is marked, the page-level "Nothing on the calendar yet…" message
// (emptyHtml) already covers it, so this must not also print its own
// "Nothing dated from today onward." line — that pairing is the two-message
// empty state bug.
function agendaHtml(today, marked) {
  const pairs = clashDays(committedSet(state.comps, state.decisions), today).pairs;
  const groups = agendaGroups(calendarEvents(state.comps, state.decisions), today);
  const expected = expectedItems(state.comps, state.decisions);
  const weeks = groups.map(g => `<section class="wk" aria-label="${esc(g.label)}"><h2>${esc(g.label)}</h2>
    <ul>${g.events.map(e => agendaRow(e, pairs)).join('')}</ul></section>`).join('');
  return `${weeks || (marked ? '<p class="empty">Nothing dated from today onward.</p>' : '')}
    ${expected.length ? `<section class="wk" aria-label="Expected, dates not confirmed"><h2>Expected, dates not confirmed</h2>
      <ul>${expected.map(expectedRow).join('')}</ul></section>` : ''}`;
}

// ---- page -----------------------------------------------------------------

const boardHref = pageHref('index.html', sec.key);
const emptyHtml = () => `<p class="empty cal-empty">Nothing on the calendar yet. Mark ${sec.key === 'hack' ? 'hackathons' : 'competitions'} Watching, Entering or Registered on the <a href="${boardHref}">Board</a>.</p>`;

function render() {
  const focus = captureFocus();
  const today = todayIST();
  const grid = state.view === 'grid';
  const marked = state.comps.some(c => c && onCalendar(state.decisions, c));
  const anything = calendarEvents(state.comps, state.decisions).length || expectedItems(state.comps, state.decisions).length;
  const monthNav = grid ? `<div class="monthnav" role="group" aria-label="Month">
        <button type="button" id="prev" aria-label="Previous month">‹</button>
        <button type="button" id="today">Today</button>
        <button type="button" id="next" aria-label="Next month">›</button>
      </div>` : '';
  document.getElementById('app').innerHTML = `<div id="banners">${bannersHtml(state.status, state.error, state.notice)}</div>
    <div class="cal">
      <div class="cal-bar">
        <h1>${grid ? esc(monthTitle(state.year, state.month)) : 'Coming up'}</h1>
        ${monthNav}
        <div class="viewtoggle" role="group" aria-label="View">
          <button type="button" id="view-grid" aria-pressed="${grid}">Grid</button>
          <button type="button" id="view-agenda" aria-pressed="${!grid}">Agenda</button>
        </div>
      </div>
      ${marked ? '' : emptyHtml()}
      ${anything ? (grid ? gridHtml(today) : agendaHtml(today, marked)) : ''}
    </div>
    <footer><span>Read-only. Change statuses on the <a href="${boardHref}">Board</a>.</span><span>Updated ${esc(istTime(state.status?.last_ok))}</span></footer>`;
  focus.restore();
}

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'prev' || b.id === 'next') Object.assign(state, addMonths(state.year, state.month, b.id === 'next' ? 1 : -1));
  else if (b.id === 'today') Object.assign(state, startMonth());
  else if (b.id === 'view-grid' || b.id === 'view-agenda') { state.view = b.id === 'view-grid' ? 'grid' : 'agenda'; storeView(state.view); }
  else return;
  render();
});

mountNav('calendar');
initEditor().then(notice => { state.notice = notice; return load(); });
