// The card-list page shared by Board and All case comps: filters, cards,
// edit mode, decision saves, manual add. Each page passes its defaults.
import { todayIST } from '../dates.js';
import { unstopId } from '../urls.js';
import {
  TIERS, VERDICTS, STATUS_FILTER, sameId, statusOf, committedSet, visible, sortByDeadline,
  needsFullRender, pagesJson,
} from './data.js';
import {
  KeyRejected, KEY_REJECTED, addManual, clearKey, createDecisionSaver, editable, readManual,
} from './store.js';
import { initEditor } from './editor.js';
import { loadDecisions, bannersHtml, editFooterHtml } from './session.js';
import { esc, cardHtml, cardClass, chipsHtml, actionsHtml } from './card.js';
import { cssq, focusSelector, refocus, captureFocus } from './focus.js';
import { mountNav } from './nav.js';
import { newItems, closingItems, inboxHtml, readSeen, writeSeen, seenNow } from './inbox.js';

// opts: { page, tiers: [...], startups, search, allowAdd, sort, inbox }
export function startListPage(opts) {
  const state = {
    comps: [], decisions: {}, manual: [], status: {}, watch: {},
    tiers: new Set(opts.tiers),
    verdicts: new Set(['fits', 'check']),
    statuses: new Set(['undecided', 'watching', 'entering']),
    registeredOnly: false, showClosed: false, showOtherFormats: false, startups: !!opts.startups, query: '',
    error: null, notice: null, seen: opts.inbox ? readSeen() : null,
  };

  // A rejected key is dropped and the page falls back to read-only.
  async function keyRejected() {
    clearKey();
    saver.drop();
    await load();
    state.error = KEY_REJECTED;
  }

  async function load() {
    state.error = null;
    [state.comps, state.status, state.watch] = await Promise.all([
      pagesJson('competitions.json', []), pagesJson('status.json', {}), pagesJson('watch.json', {})]);
    state.manual = [];
    await loadDecisions(state, {
      overlay: d => saver.overlay(d),
      readMore: async () => { if (opts.allowAdd && editable()) state.manual = await readManual(); },
    });
    render();
  }

  const isVisible = c => visible(c, state, state.decisions);
  const ctx = () => ({
    today: todayIST(), committed: committedSet(state.comps, state.decisions),
    decisions: state.decisions, editable: editable(), watch: state.watch,
  });

  const banners = () => bannersHtml(state.status, state.error, state.notice);

  const toggles = (name, map, set) => Object.entries(map)
    .map(([k, label]) => `<button type="button" data-toggle="${name}" data-key="${k}" aria-pressed="${set.has(k)}">${esc(label)}</button>`).join('');

  // The "what needs attention" panel (Board only).
  const inbox = c => (opts.inbox ? inboxHtml({
    fresh: newItems(state.comps, state.decisions, state.seen, c.today),
    closing: closingItems(state.comps, state.decisions, c.today),
    decisions: state.decisions, today: c.today, editable: c.editable,
  }) : '');

  function render() {
    // A control inside the panel may vanish on re-render (a row drops out,
    // "Mark all seen" empties the list): fall back to the panel itself.
    const inPanel = !!document.getElementById('inbox')?.contains(document.activeElement);
    const focus = captureFocus();
    const draftUrl = document.getElementById('add-url')?.value || '';
    const c = ctx();
    let list = state.comps.filter(isVisible);
    if (opts.sort) list = sortByDeadline(list);
    const pending = state.manual.filter(m => !state.comps.some(x => sameId(x.id, unstopId(m?.url))));
    document.getElementById('app').innerHTML = `
    <div id="banners">${banners()}</div>
    ${inbox(c)}
    <section class="controls" aria-label="Filters">
      ${opts.search ? `<div class="row"><input id="q" class="search" type="search" placeholder="Search title or host" aria-label="Search title or host" value="${esc(state.query)}"></div>` : ''}
      <div class="row" role="group" aria-label="Tier">${toggles('tier', TIERS, state.tiers)}</div>
      <div class="row" role="group" aria-label="Verdict">${toggles('verdict', VERDICTS, state.verdicts)}</div>
      <div class="row" role="group" aria-label="Status">${toggles('status', STATUS_FILTER, state.statuses)}
        <button type="button" data-toggle="registered" data-key="only" aria-pressed="${state.registeredOnly}">Registered only</button>
        <label><input type="checkbox" data-flag="showClosed" ${state.showClosed ? 'checked' : ''}> Closed</label>
        <label><input type="checkbox" data-flag="showOtherFormats" ${state.showOtherFormats ? 'checked' : ''}> Quizzes and other formats</label>
      </div>
    </section>
    ${opts.allowAdd && editable() ? `<form class="add" id="add">
        <input id="add-url" name="url" type="url" required placeholder="Paste an Unstop competition link" aria-label="Unstop competition link" value="${esc(draftUrl)}">
        <button id="add-btn">Add</button><span id="add-msg" role="status"></span>
      </form>
      ${pending.length ? `<p class="pending">${pending.length} link${pending.length === 1 ? '' : 's'} added, will appear after the next fetch.</p>` : ''}` : ''}
    <p class="count">${list.length} shown of ${state.comps.length}</p>
    <div class="cards">${list.map(x => cardHtml(x, c)).join('') || '<p class="empty">Nothing matches these filters.</p>'}</div>
    ${editFooterHtml(editable(), state.status.last_ok)}`;
    focus.restore(inPanel ? document.getElementById('inbox') : undefined);
  }

  const cardEl = id => document.querySelector(`[data-card="${cssq(id)}"]`);
  const findComp = id => state.comps.find(x => sameId(x.id, id));

  function renderBanners() {
    const el = document.getElementById('banners');
    if (el) el.innerHTML = banners();
  }

  // Replace one card in place. A card stays on screen after a status change
  // even if the filters would now hide it; the next filter change tidies up.
  function renderCard(id) {
    const el = cardEl(id);
    const c = findComp(id);
    if (!el || !c) return;
    const focusedInside = el.contains(document.activeElement);
    const sel = focusedInside ? focusSelector(document.activeElement) : null;
    el.outerHTML = cardHtml(c, ctx());
    if (focusedInside) refocus(sel, cardEl(id)?.querySelector('.actions button'));
  }

  // Chips, decision buttons and the card's status class, leaving the note
  // input (and anything being typed in it) untouched.
  function renderCardStatus(id) {
    const el = cardEl(id);
    const c = findComp(id);
    if (!el || !c) return;
    const st = statusOf(state.decisions, c);
    el.className = cardClass(c, st);
    const chips = el.querySelector('.chips');
    if (chips) chips.innerHTML = chipsHtml(c, st, ctx());
    const actions = el.querySelector('.actions');
    if (actions) {
      const sel = actions.contains(document.activeElement) ? focusSelector(document.activeElement) : null;
      actions.innerHTML = actionsHtml(c, st);
      if (sel) refocus(sel, actions.querySelector('button'));
    }
  }

  const saver = createDecisionSaver(state, {
    local(id, before, after, { fromNote = false }) {
      // A note's own change never re-renders its card: the user may be typing.
      if (!fromNote) (needsFullRender(before, after) ? render() : renderCard(id));
      else if (needsFullRender(before, after)) render();
      else if (before.status !== after.status) renderCardStatus(id);
    },
    saved(id, shown, now) {
      if (state.error) { state.error = null; renderBanners(); }
      if (needsFullRender(shown, now)) render();
      else if (now.status !== shown.status) renderCardStatus(id);
      if (now.note !== shown.note) {
        const input = cardEl(id)?.querySelector('input.note');
        if (input && document.activeElement !== input) input.value = now.note;
      }
    },
    async keyRejected() { await keyRejected(); render(); },
    failed(err) {
      state.error = `Not saved: ${err.message}`; // the change stays on screen
      renderBanners();
    },
  });

  document.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.toggle === 'registered') {
      state.registeredOnly = !state.registeredOnly;
      render();
    } else if (b.dataset.toggle) {
      const set = { tier: state.tiers, verdict: state.verdicts, status: state.statuses }[b.dataset.toggle];
      if (!set) return;
      if (set.has(b.dataset.key)) set.delete(b.dataset.key); else set.add(b.dataset.key);
      render();
    } else if (b.id === 'inbox-seen') {
      state.seen = seenNow(state.comps, state.decisions, todayIST());
      writeSeen(state.seen);
      render();
    } else if (b.id === 'lock') {
      clearKey(); saver.drop(); state.notice = null; await load();
    } else if ('set' in b.dataset && editable()) {
      await saver.save(b.dataset.id, d => ({ ...d, status: b.dataset.set || undefined }));
    }
  });

  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.dataset.flag) { state[el.dataset.flag] = el.checked; render(); }
    else if (!editable()) { /* read-only */ }
    else if (el.dataset.reg !== undefined || el.dataset.inboxReg !== undefined) {
      const on = el.checked;
      await saver.save(el.dataset.reg ?? el.dataset.inboxReg, d => ({ ...d, registered: on || undefined }));
    } else if (el.dataset.note !== undefined) {
      const value = el.value.trim();
      await saver.save(el.dataset.note, d => ({ ...d, note: value || undefined }), { fromNote: true });
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id !== 'q') return;
    state.query = e.target.value;
    render();
  });

  const manualHas = (list, id) => list.some(m => sameId(unstopId(m?.url), id));

  document.addEventListener('submit', async e => {
    if (e.target.id !== 'add') return;
    e.preventDefault();
    const url = e.target.url.value.trim();
    const msg = document.getElementById('add-msg');
    const btn = document.getElementById('add-btn');
    const id = unstopId(url);
    if (!id) { msg.textContent = 'Only Unstop competition links for now'; return; }
    const onBoard = findComp(id);
    if (onBoard) {
      msg.textContent = isVisible(onBoard) ? 'Already on the board' : 'Already on the board (it may be hidden by filters)';
      return;
    }
    if (manualHas(state.manual, id)) { msg.textContent = 'Already added; it will appear after the next fetch'; return; }
    btn.disabled = true;
    msg.textContent = 'Saving…';
    try {
      // The server ignores a link that is already there (another tab).
      await addManual(url);
      if (!manualHas(state.manual, id)) state.manual = [...state.manual, { url, added: todayIST() }];
      document.getElementById('add-url').value = '';
      render();
      document.getElementById('add-msg').textContent = 'Added';
    } catch (err) {
      if (err instanceof KeyRejected) { await keyRejected(); render(); return; }
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  mountNav(opts.page);
  initEditor().then(notice => { state.notice = notice; return load(); });
}
