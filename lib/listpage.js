// The card-list page shared by Board and All (either section): filters,
// cards, edit mode (the admin), decision saves, manual add (case comps only).
// Each page passes its defaults; the section (?s=hack) picks the listings,
// tiers, wording and the hackathon-only abroad toggle and dedupe. Everything
// is read from Supabase after requireMember() (lib/auth.js).
import { todayIST } from '../dates.js';
import { unstopId } from '../urls.js';
import {
  VERDICTS, STATUS_FILTER, sameId, statusOf, committedAcross, visible, sortByDeadline,
  needsFullRender, dedupeAcrossSources,
} from './data.js';
import { currentSection, otherSection, sectionOf } from './section.js';
import {
  addManual, createDecisionSaver, editable, readManual, readListings, readStatus, readWatch, readDecisions,
  readTeams, readTeamMembers, readMembers, markJoined,
} from './store.js';
import { requireMember, currentMember, roleCan } from './auth.js';
import { listingIndex, myJoins, pendingByPerson } from './teams.js';
import { teamInboxHtml } from './teamview.js';
import { copyFromField } from './copy.js';
import { guardLoad, bannersHtml, footerHtml } from './session.js';
import { esc, cardHtml, cardClass, chipsHtml, actionsHtml } from './card.js';
import { cssq, focusSelector, refocus, captureFocus } from './focus.js';
import { mountNav } from './nav.js';
import { newItems, closingItems, inboxHtml, readSeen, writeSeen, seenNow, seenKey } from './inbox.js';

// opts: { page, tiers: [...], startups, search, allowAdd, sort, inbox }
export function startListPage(opts) {
  const sec = sectionOf(currentSection());
  const other = sectionOf(otherSection(sec.key));
  const allowAdd = opts.allowAdd && sec.allowAdd;
  const state = {
    comps: [], otherItems: [], decisions: {}, manual: [], status: null, watch: {},
    tiers: new Set(opts.tiers),
    verdicts: new Set(['fits', 'check']),
    statuses: new Set(['undecided', 'watching', 'entering']),
    registeredOnly: false, showClosed: false, showOtherFormats: false, startups: !!opts.startups, query: '',
    // Hackathons only: in-person events abroad stay hidden until asked for.
    includeAbroad: sec.abroadToggle ? false : undefined,
    error: null, seen: null, seenKey: null,
    // Board only: the team rows behind "Join these teams" / "Waiting on teammates".
    teams: [], teamMembers: [], members: [],
  };

  async function load() {
    await guardLoad(state, async () => {
      // The other section's items only feed the clash check.
      const [comps, status, watch, otherItems, decisions, manual] = await Promise.all([
        readListings(sec.key), readStatus(sec.key), readWatch(), readListings(other.key), readDecisions(),
        allowAdd && editable() ? readManual() : [],
      ]);
      Object.assign(state, { comps, status, watch, otherItems, manual });
      state.decisions = saver.overlay(decisions);
      if (opts.inbox) await readTeamRows();
    });
    render();
  }

  async function readTeamRows() {
    const [teams, teamMembers, members] = await Promise.all([readTeams(), readTeamMembers(), readMembers()]);
    Object.assign(state, { teams, teamMembers, members });
  }

  const isVisible = c => visible(c, state, state.decisions);
  // Hackathons listed on more than one source show once (display only).
  const items = () => (sec.key === 'hack' ? dedupeAcrossSources(state.comps, state.decisions) : state.comps);
  const ctx = () => ({
    today: todayIST(), committed: committedAcross(state.comps, state.otherItems, state.decisions),
    decisions: state.decisions, editable: editable(), watch: state.watch,
  });
  const inboxOpts = () => ({ tiers: sec.boardTiers, includeAbroad: state.includeAbroad });

  const banners = () => bannersHtml(state.status, state.error);

  const toggles = (name, map, set) => Object.entries(map)
    .map(([k, label]) => `<button type="button" data-toggle="${name}" data-key="${k}" aria-pressed="${set.has(k)}">${esc(label)}</button>`).join('');

  // Board only, above "what needs attention": the viewer's teams to join
  // and, for the admin, everyone else's pending joins.
  const teamInbox = () => {
    if (!opts.inbox) return '';
    const me = currentMember();
    const index = listingIndex({ [sec.key]: state.comps, [other.key]: state.otherItems });
    const admin = roleCan(me, 'manage_teams');
    return teamInboxHtml({
      joins: myJoins(me?.email, state.teams, state.teamMembers, index),
      waiting: admin ? pendingByPerson(state.teams, state.teamMembers, index, { except: me?.email }) : [],
      members: state.members, isAdmin: admin,
    });
  };

  // The "what needs attention" panel (Board only).
  const inbox = (c, all) => (opts.inbox ? inboxHtml({
    fresh: newItems(all, state.decisions, state.seen, c.today, inboxOpts()),
    closing: closingItems(all, state.decisions, c.today, inboxOpts()),
    decisions: state.decisions, today: c.today, editable: c.editable,
  }) : '');

  function render() {
    // A control inside the panel may vanish on re-render (a row drops out,
    // "Mark all seen" empties the list): fall back to the panel itself.
    const inPanel = !!document.getElementById('inbox')?.contains(document.activeElement);
    const inTeams = !!document.getElementById('team-inbox')?.contains(document.activeElement);
    const focus = captureFocus();
    const draftUrl = document.getElementById('add-url')?.value || '';
    const c = ctx();
    const all = items();
    let list = all.filter(isVisible);
    if (opts.sort) list = sortByDeadline(list);
    const abroadHidden = state.includeAbroad === false
      ? all.filter(x => !isVisible(x) && visible(x, { ...state, includeAbroad: true }, state.decisions)).length : 0;
    const pending = state.manual.filter(m => !state.comps.some(x => sameId(x.id, unstopId(m?.url))));
    document.getElementById('app').innerHTML = `
    <div id="banners">${banners()}</div>
    ${teamInbox()}
    ${inbox(c, all)}
    <section class="controls" aria-label="Filters">
      ${opts.search ? `<div class="row"><input id="q" class="search" type="search" placeholder="Search title or host" aria-label="Search title or host" value="${esc(state.query)}"></div>` : ''}
      <div class="row" role="group" aria-label="Tier">${toggles('tier', sec.tiers, state.tiers)}</div>
      <div class="row" role="group" aria-label="Verdict">${toggles('verdict', VERDICTS, state.verdicts)}</div>
      <div class="row" role="group" aria-label="Status">${toggles('status', STATUS_FILTER, state.statuses)}
        <button type="button" data-toggle="registered" data-key="only" aria-pressed="${state.registeredOnly}">Registered only</button>
        <label><input type="checkbox" data-flag="showClosed" ${state.showClosed ? 'checked' : ''}> Closed</label>
        <label><input type="checkbox" data-flag="showOtherFormats" ${state.showOtherFormats ? 'checked' : ''}> ${esc(sec.otherFormatsLabel)}</label>
        ${sec.abroadToggle ? `<label><input type="checkbox" data-flag="includeAbroad" ${state.includeAbroad ? 'checked' : ''}> Include in-person abroad</label>` : ''}
      </div>
    </section>
    ${allowAdd && editable() ? `<form class="add" id="add">
        <input id="add-url" name="url" type="url" required placeholder="Paste an Unstop competition link" aria-label="Unstop competition link" value="${esc(draftUrl)}">
        <button id="add-btn">Add</button><span id="add-msg" role="status"></span>
      </form>
      ${pending.length ? `<p class="pending">${pending.length} link${pending.length === 1 ? '' : 's'} added, will appear after the next fetch.</p>` : ''}` : ''}
    <p class="count">${list.length} shown of ${all.length}${abroadHidden ? ` · ${abroadHidden} in-person abroad hidden` : ''}</p>
    <div class="cards">${list.map(x => cardHtml(x, c)).join('') || '<p class="empty">Nothing matches these filters.</p>'}</div>
    ${footerHtml(state.status?.last_ok)}`;
    // A joined row leaves the team panel (or the panel goes): fall back to
    // it, else to the attention panel below.
    const fallback = inTeams ? (document.getElementById('team-inbox') || document.getElementById('inbox'))
      : inPanel ? document.getElementById('inbox') : undefined;
    focus.restore(fallback);
  }

  const cardEl = id => document.querySelector(`[data-card="${cssq(id)}"]`);
  const findComp = id => items().find(x => sameId(x.id, id));

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
    } else if (b.dataset.copy) {
      await copyFromField(b);
    } else if (b.dataset.join) {
      b.disabled = true;
      try {
        await markJoined(b.dataset.join, b.dataset.joined === '1');
        if (state.error) state.error = null;
      } catch (err) {
        state.error = `Not saved: ${err.message}`;
      }
      try { await readTeamRows(); } catch (err) { state.error = `Could not reload teams: ${err.message}`; }
      render();
    } else if (b.id === 'inbox-seen') {
      state.seen = seenNow(items(), state.decisions, todayIST(), inboxOpts());
      writeSeen(state.seen, state.seenKey);
      render();
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
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  requireMember().then(who => {
    if (!who) return null;
    mountNav(opts.page, who.member);
    if (opts.inbox) {
      state.seenKey = seenKey(sec.key, who.member.email);
      state.seen = readSeen(state.seenKey);
    }
    return load();
  });
}
