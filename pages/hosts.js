// Hosts & archive (hosts.html). Read-only: a row per host (live + archive +
// curated international and fest watchlist), and a searchable list of closed competitions.
import { dayDiff, todayIST } from '../dates.js';
import { TIERS, pagesJson } from '../lib/data.js';
import { esc, compHref } from '../lib/card.js';
import { hostRows, archiveList } from '../lib/hosts.js';
import { captureFocus } from '../lib/focus.js';
import { mountNav } from '../lib/nav.js';
import { bannersHtml, istTime } from '../lib/session.js';
import { initEditor } from '../lib/editor.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ARCHIVE_STARTED = '2026-09-29';
const ARCHIVE_HISTORY_DAYS = 30;

const state = {
  comps: [], archive: [], curated: [], status: {}, error: null, notice: null,
  hostTiers: new Set(Object.keys(TIERS)), hostQuery: '', archiveQuery: '',
};

async function load() {
  state.error = null;
  let intl, fests;
  [state.comps, state.archive, intl, fests, state.status] = await Promise.all([
    pagesJson('competitions.json', []),
    pagesJson('archive.json', []),
    pagesJson('international.json', []),
    pagesJson('fests.json', []),
    pagesJson('status.json', {}),
  ]);
  if (!Array.isArray(state.comps)) state.comps = [];
  if (!Array.isArray(state.archive)) state.archive = [];
  state.curated = [...(Array.isArray(intl) ? intl : []), ...(Array.isArray(fests) ? fests : [])];
  render();
}

const matches = (text, q) => String(text ?? '').toLowerCase().includes(q);

function monthStripHtml(months) {
  const set = new Set(months);
  const label = months.length ? `Months seen: ${months.map(m => MONTHS[m - 1]).join(', ')}` : 'No months recorded';
  const cells = MONTHS.map((m, i) => `<span class="mcell${set.has(i + 1) ? ' on' : ''}" aria-hidden="true">${m[0]}</span>`).join('');
  return `<span class="mstrip" role="img" aria-label="${esc(label)}">${cells}</span>`;
}

function hostRowHtml(r) {
  return `<tr>
      <td data-label="Host">${esc(r.host)}</td>
      <td data-label="Tier"><span class="chip">${esc(TIERS[r.tier] || r.tier)}</span></td>
      <td data-label="Seen">${r.count}</td>
      <td data-label="Months">${monthStripHtml(r.months)}</td>
      <td data-label="Latest">${r.latestId != null ? `<a href="${esc(compHref(r.latestId))}">${esc(r.latestTitle)}</a>` : esc(r.latestTitle || '')}</td>
    </tr>`;
}

function hostsSectionHtml() {
  const q = state.hostQuery.trim().toLowerCase();
  const rows = hostRows(state.comps, state.archive, state.curated)
    .filter(r => state.hostTiers.has(r.tier))
    .filter(r => !q || matches(r.host, q) || matches(r.latestTitle, q));
  const toggles = Object.entries(TIERS)
    .map(([k, label]) => `<button type="button" data-tier="${k}" aria-pressed="${state.hostTiers.has(k)}">${esc(label)}</button>`).join('');
  return `<section class="hosts-sec" aria-label="Hosts">
      <h2>Hosts</h2>
      <div class="row"><input id="host-q" class="search" type="search" placeholder="Search host or title" aria-label="Search host or title" value="${esc(state.hostQuery)}"></div>
      <div class="row" role="group" aria-label="Tier">${toggles}</div>
      <p class="count">${rows.length} host${rows.length === 1 ? '' : 's'}</p>
      <div class="hosts-table" role="table" aria-label="Hosts">
        <table>
          <thead><tr><th>Host</th><th>Tier</th><th>Seen</th><th>Months</th><th>Latest</th></tr></thead>
          <tbody>${rows.map(hostRowHtml).join('') || '<tr><td colspan="5" class="empty">No hosts match.</td></tr>'}</tbody>
        </table>
      </div>
    </section>`;
}

function archiveRowHtml(r) {
  return `<li class="arow">
      <span class="chip">${esc(TIERS[r.tier] || r.tier)}</span>
      <a href="${esc(compHref(r.id))}">${esc(r.title)}</a>
      <span class="ahost">${esc(r.host)}</span>
      <span class="aclosed">${r.closed_on ? `Closed ${esc(r.closed_on)}` : ''}</span>
    </li>`;
}

function archiveSectionHtml(today) {
  const q = state.archiveQuery.trim().toLowerCase();
  const list = archiveList(state.comps, state.archive)
    .filter(r => !q || matches(r.title, q) || matches(r.host, q));
  const young = dayDiff(ARCHIVE_STARTED, today) < ARCHIVE_HISTORY_DAYS;
  return `<section class="archive-sec" aria-label="Archive">
      <h2>Archive</h2>
      ${young ? '<p class="archive-note">The archive started on 29 Sep 2026; it fills as competitions close.</p>' : ''}
      <div class="row"><input id="archive-q" class="search" type="search" placeholder="Search closed competitions" aria-label="Search closed competitions" value="${esc(state.archiveQuery)}"></div>
      <p class="count">${list.length} closed</p>
      <ul class="alist">${list.map(archiveRowHtml).join('') || '<li class="empty">Nothing archived yet.</li>'}</ul>
    </section>`;
}

function render() {
  const focus = captureFocus();
  document.getElementById('app').innerHTML = `<div id="banners">${bannersHtml(state.status, state.error, state.notice)}</div>
    ${hostsSectionHtml()}
    ${archiveSectionHtml(todayIST())}
    <footer><span>Read-only.</span><span>Updated ${esc(istTime(state.status?.last_ok))}</span></footer>`;
  focus.restore();
}

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !b.dataset.tier) return;
  if (state.hostTiers.has(b.dataset.tier)) state.hostTiers.delete(b.dataset.tier);
  else state.hostTiers.add(b.dataset.tier);
  render();
});

document.addEventListener('input', e => {
  if (e.target.id === 'host-q') { state.hostQuery = e.target.value; render(); }
  else if (e.target.id === 'archive-q') { state.archiveQuery = e.target.value; render(); }
});

mountNav('hosts');
initEditor().then(notice => { state.notice = notice; return load(); });
