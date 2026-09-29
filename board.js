import { clashes } from './clash.js';
import { dayDiff, todayIST } from './dates.js';
import { unstopId } from './urls.js';

const REPO = 'krishnachagti-sudo/certamus-radar';
const TOKEN_KEY = 'certamus-radar.token';
const TIERS = { iit: 'IIT', iim: 'IIM', bschool: 'B-school', corporate: 'Corporate', other: 'Other' };
const VERDICTS = { fits: 'Fits', check: 'Check', out: 'Out' };
const STATUSES = ['watching', 'entering', 'skipped'];
const STATUS_FILTER = { undecided: 'Undecided', watching: 'Watching', entering: 'Entering', skipped: 'Skipped' };

function readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function writeToken(t) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* memory only */ }
}

const state = {
  comps: [], decisions: {}, manual: [], status: {},
  tiers: new Set(['iit', 'iim', 'bschool', 'corporate']),
  verdicts: new Set(['fits', 'check']),
  statuses: new Set(['undecided', 'watching', 'entering']),
  showClosed: false, showOtherFormats: false,
  token: readToken(), error: null,
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHref = u => /^https:\/\/(www\.)?unstop\.com\//.test(u) ? u : '#';
const istTime = iso => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'never');

function b64encode(str) {
  let bin = '';
  for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function api(path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/vnd.github+json', ...init.headers },
  });
}
async function apiRead(path) {
  const r = await api(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Could not read ${path} (${r.status})`);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(b64decode(j.content)) };
}
// Read file + sha, apply the change, write. Workflows never write these two
// files, so a 409 means another tab wrote first: re-read once, then give up.
async function apiUpdate(path, mutate, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, data } = await apiRead(path);
    const next = mutate(data);
    const r = await api(path, { method: 'PUT', body: JSON.stringify({ message, sha, content: b64encode(JSON.stringify(next, null, 2) + '\n') }) });
    if (r.ok) return next;
    if (r.status !== 409) throw new Error(`Could not save ${path} (${r.status})`);
  }
  throw new Error(`${path} kept changing; reload and try again`);
}

async function pagesJson(name, fallback) {
  try {
    const r = await fetch(`./data/${name}`, { cache: 'no-store' });
    return r.ok ? await r.json() : fallback;
  } catch { return fallback; }
}

async function load() {
  state.error = null;
  [state.comps, state.status] = await Promise.all([pagesJson('competitions.json', []), pagesJson('status.json', {})]);
  if (state.token) {
    try {
      // Pages lags ~1 minute behind a commit; in edit mode read the live files.
      state.decisions = (await apiRead('data/decisions.json')).data;
      state.manual = (await apiRead('data/manual.json')).data;
    } catch (e) {
      state.error = `${e.message}. Check the token.`;
      state.decisions = await pagesJson('decisions.json', {});
    }
  } else {
    state.decisions = await pagesJson('decisions.json', {});
    state.manual = [];
  }
  render();
}

const statusOf = c => state.decisions[c.id]?.status || 'undecided';

function visible(c) {
  if (c.closed_on && !state.showClosed) return false;
  if (!state.statuses.has(statusOf(c))) return false;
  if (!c.pinned && !state.tiers.has(c.tier)) return false;
  if (!c.pinned && c.is_case === false && !state.showOtherFormats) return false;
  return state.verdicts.has(c.verdict?.level);
}

function closesText(c, today) {
  if (!c.regn_close) return 'no deadline listed';
  const d = dayDiff(today, c.regn_close);
  if (d < 0) return 'registration closed';
  if (d === 0) return 'closes today';
  return `closes in ${d} day${d === 1 ? '' : 's'}`;
}

function teamText(c) {
  if (!c.team_max) return 'team size not listed';
  if (c.team_max === 1) return 'solo';
  return c.team_max >= 4 ? `teams up to ${c.team_max}` : `max ${c.team_max}, send the subset`;
}

function card(c, today, entering) {
  const st = statusOf(c);
  const clash = clashes(c, entering, today);
  const note = state.decisions[c.id]?.note || '';
  const facts = [closesText(c, today), teamText(c), c.mode, c.fee ? 'entry fee' : 'free',
    c.prize_total ? `prizes ₹${c.prize_total.toLocaleString('en-IN')}` : null].filter(Boolean);
  const edit = state.token
    ? `<div class="actions" role="group" aria-label="Decision for ${esc(c.title)}">
        ${STATUSES.map(s => `<button type="button" data-set="${s}" data-id="${esc(c.id)}" aria-pressed="${st === s}">${s[0].toUpperCase()}${s.slice(1)}</button>`).join('')}
        ${st !== 'undecided' ? `<button type="button" class="ghost" data-set="" data-id="${esc(c.id)}">Clear</button>` : ''}
      </div>
      <input class="note" data-note="${esc(c.id)}" value="${esc(note)}" placeholder="Note" aria-label="Note for ${esc(c.title)}">`
    : (note ? `<p class="note-ro">${esc(note)}</p>` : '');
  return `<article class="card v-${esc(c.verdict?.level)} s-${esc(st)}">
    <div class="chips">
      <span class="chip">${esc(TIERS[c.tier] || c.tier)}</span>
      <span class="chip ${esc(c.verdict?.level)}">${esc(VERDICTS[c.verdict?.level] || '?')}</span>
      ${st !== 'undecided' ? `<span class="chip status">${esc(st)}</span>` : ''}
      ${c.pinned ? '<span class="chip">added by hand</span>' : ''}
    </div>
    <h2><a href="${esc(safeHref(c.url))}" target="_blank" rel="noopener">${esc(c.title)}</a></h2>
    <p class="host">${esc(c.host)}</p>
    <p class="facts">${facts.map(esc).join(' · ')}</p>
    ${c.verdict?.reasons?.length ? `<ul class="reasons">${c.verdict.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${clash.length ? `<p class="clash">Clashes with ${clash.map(esc).join(', ')}</p>` : ''}
    ${edit}
  </article>`;
}

function banners() {
  const s = state.status;
  const ageHours = s.last_ok ? (Date.now() - Date.parse(s.last_ok)) / 3.6e6 : Infinity;
  const msgs = [];
  if (s.last_error || ageHours > 36) msgs.push(`Data stale since ${istTime(s.last_ok)}${s.last_error ? `: ${s.last_error}` : ''}`);
  if (state.error) msgs.push(state.error);
  return msgs.map(m => `<p class="banner" role="alert">${esc(m)}</p>`).join('');
}

const toggles = (name, map, set) => Object.entries(map)
  .map(([k, label]) => `<button type="button" data-toggle="${name}" data-key="${k}" aria-pressed="${set.has(k)}">${label}</button>`).join('');

function render() {
  const today = todayIST();
  const entering = state.comps.filter(c => statusOf(c) === 'entering');
  const list = state.comps.filter(visible);
  const pending = state.manual.filter(m => !state.comps.some(c => c.id === unstopId(m.url)));
  document.getElementById('app').innerHTML = `
    ${banners()}
    <section class="controls" aria-label="Filters">
      <div class="row">${toggles('tier', TIERS, state.tiers)}</div>
      <div class="row">${toggles('verdict', VERDICTS, state.verdicts)}</div>
      <div class="row">${toggles('status', STATUS_FILTER, state.statuses)}
        <label><input type="checkbox" data-flag="showClosed" ${state.showClosed ? 'checked' : ''}> Closed</label>
        <label><input type="checkbox" data-flag="showOtherFormats" ${state.showOtherFormats ? 'checked' : ''}> Quizzes and other formats</label>
      </div>
    </section>
    ${state.token ? `<form class="add" id="add">
        <input name="url" type="url" required placeholder="Paste an Unstop competition link" aria-label="Unstop competition link">
        <button>Add</button><span id="add-msg" role="status"></span>
      </form>
      ${pending.length ? `<p class="pending">${pending.length} link${pending.length === 1 ? '' : 's'} added, will appear after the next fetch.</p>` : ''}` : ''}
    <p class="count">${list.length} shown of ${state.comps.length}</p>
    <div class="cards">${list.map(c => card(c, today, entering)).join('') || '<p class="empty">Nothing matches these filters.</p>'}</div>
    <footer>
      ${state.token ? '<button type="button" class="ghost" id="lock">Lock editing</button>' : '<button type="button" class="ghost" id="unlock">Edit</button>'}
      <span>Updated ${esc(istTime(state.status.last_ok))}</span>
    </footer>`;
}

async function saveDecision(id, change) {
  const apply = all => {
    const next = { ...all };
    const { updated, ...rest } = change(next[id] || {});
    const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ''));
    if (Object.keys(clean).length) next[id] = { ...clean, updated: todayIST() };
    else delete next[id];
    return next;
  };
  state.decisions = apply(state.decisions);
  render();
  try {
    state.decisions = await apiUpdate('data/decisions.json', apply, `decision: ${id}`);
    state.error = null;
  } catch (err) {
    state.error = `Not saved: ${err.message}`; // the change stays on screen
  }
  render();
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.toggle) {
    const set = { tier: state.tiers, verdict: state.verdicts, status: state.statuses }[b.dataset.toggle];
    if (set.has(b.dataset.key)) set.delete(b.dataset.key); else set.add(b.dataset.key);
    render();
  } else if (b.id === 'unlock') {
    const tok = prompt('Paste a fine-grained GitHub token (Contents: read and write, certamus-radar only). It stays in this browser.');
    if (tok) { state.token = tok.trim(); writeToken(state.token); await load(); }
  } else if (b.id === 'lock') {
    state.token = null; writeToken(null); await load();
  } else if ('set' in b.dataset) {
    await saveDecision(Number(b.dataset.id), d => ({ ...d, status: b.dataset.set || undefined }));
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.flag) { state[el.dataset.flag] = el.checked; render(); }
  else if (el.dataset.note) await saveDecision(Number(el.dataset.note), d => ({ ...d, note: el.value.trim() || undefined }));
});

document.addEventListener('submit', async e => {
  if (e.target.id !== 'add') return;
  e.preventDefault();
  const url = e.target.url.value.trim();
  const msg = document.getElementById('add-msg');
  const id = unstopId(url);
  if (!id) { msg.textContent = 'Only Unstop competition links for now'; return; }
  if (state.comps.some(c => c.id === id) || state.manual.some(m => unstopId(m.url) === id)) { msg.textContent = 'Already on the board'; return; }
  try {
    state.manual = await apiUpdate('data/manual.json', list => [...list, { url, added: todayIST() }], `manual: add ${id}`);
    render();
  } catch (err) { msg.textContent = err.message; }
});

load();
