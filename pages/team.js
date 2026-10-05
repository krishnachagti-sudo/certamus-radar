// Team page (team.html).
// Teammates (role 'member'): their one screen. "To join" lists the teams
// they are in but have not joined (plain title, Case comp / Hackathon,
// registration deadline, invite link with Copy and Open, a big I've joined);
// "Joined" lists the rest with the date and a small Undo. Its only read is
// the my_joins() RPC; no radar data, rounds, notes or other people's status.
// Admin: "Waiting on teammates" by person, then "All teams" with join
// progress, next round and overdue count; plus their own joins and rounds
// when they have any. Both sections at once; ?s=hack only keeps the admin
// nav in the hackathon section. A team whose listing was pruned shows under
// its archived title.
import { todayIST } from '../dates.js';
import { requireMember, currentMember, roleCan } from '../lib/auth.js';
import {
  readListings, readArchive, readTeams, readTeamMembers, readRounds, readMembers, markJoined, setRoundDone, readMyJoins,
} from '../lib/store.js';
import { listingIndex, compOf, myJoins, myRounds, pendingByPerson, teamSummaries, splitJoins } from '../lib/teams.js';
import { joinRowHtml, myRoundRowHtml, waitingHtml, allTeamsHtml, memberScreenHtml } from '../lib/teamview.js';
import { esc } from '../lib/card.js';
import { copyFromField } from '../lib/copy.js';
import { captureFocus } from '../lib/focus.js';
import { mountNav, mountMemberNav } from '../lib/nav.js';
import { guardLoad, bannersHtml } from '../lib/session.js';

const state = {
  admin: false, index: new Map(), teams: [], teamMembers: [], rounds: [], members: [], myJoins: [],
  error: null, msg: '', busy: false,
};

async function readTeamRows() {
  if (!state.admin) {
    state.myJoins = await readMyJoins();
    return;
  }
  const [teams, teamMembers, rounds, members] = await Promise.all([readTeams(), readTeamMembers(), readRounds(), readMembers()]);
  Object.assign(state, { teams, teamMembers, rounds, members });
}

async function load() {
  await guardLoad(state, async () => {
    if (!state.admin) { await readTeamRows(); return; }
    const [liveCase, liveHack, archCase, archHack] = await Promise.all([
      readListings('case'), readListings('hack'), readArchive('case'), readArchive('hack'), readTeamRows()]);
    state.index = listingIndex({ case: liveCase, hack: liveHack }, { case: archCase, hack: archHack });
  });
  render();
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function joinsSection(joins) {
  if (!joins.length) return '';
  return `<section class="team-sec" aria-labelledby="h-joins">
      <h2 id="h-joins">My joins (${joins.length})</h2>
      <p class="muted small">Open the invite link, join the team on the competition’s site, then tick “I’ve joined”.</p>
      <ul class="join-list">${joins.map(j => joinRowHtml(j)).join('')}</ul>
    </section>`;
}

function roundsSection(mine, today) {
  if (!mine.length) return '';
  const teamOf = id => state.teams.find(t => String(t.listing_id) === String(id));
  const comp = r => {
    const team = teamOf(r.listing_id);
    const c = compOf(state.index, team || { listing_id: r.listing_id });
    return { listing_id: String(r.listing_id), section: team?.section === 'hack' ? 'hack' : 'case', title: c.title, archived: c.archived };
  };
  const overdue = mine.filter(r => r.overdue).length;
  return `<section class="team-sec" aria-labelledby="h-rounds">
      <h2 id="h-rounds">My rounds (${mine.length})${overdue ? ` <span class="team-overdue">${plural(overdue, 'overdue')}</span>` : ''}</h2>
      <ul class="rd-list">${mine.map(r => myRoundRowHtml(r, comp(r), today)).join('')}</ul>
    </section>`;
}

function adminBody(today) {
  const me = currentMember();
  const joins = myJoins(me?.email, state.teams, state.teamMembers, state.index);
  const mine = myRounds(me?.email, state.teams, state.teamMembers, state.rounds, today);
  const waiting = pendingByPerson(state.teams, state.teamMembers, state.index, { except: me?.email });
  const summaries = teamSummaries(state.teams, state.teamMembers, state.rounds, state.index, today);
  return `<div class="teampage">
      <h1 tabindex="-1">Team</h1>
      <p class="team-msg" role="status">${esc(state.msg)}</p>
      <section class="team-sec" aria-labelledby="h-waiting">
        ${waiting.length ? waitingHtml(waiting, state.members, 'h-waiting')
          : '<h2 id="h-waiting">Waiting on teammates (0)</h2><p class="empty">Nobody to chase: everyone has joined their teams.</p>'}
      </section>
      <section class="team-sec" aria-labelledby="h-all">
        <h2 id="h-all">All teams (${summaries.length})</h2>
        ${allTeamsHtml(summaries, today)}
      </section>
      ${joinsSection(joins)}
      ${roundsSection(mine, today)}
    </div>`;
}

function render() {
  const focus = captureFocus();
  const today = todayIST();
  const body = state.admin
    ? adminBody(today)
    : memberScreenHtml({ ...splitJoins(state.myJoins), today, msg: state.msg });
  document.getElementById('app').innerHTML = `<div id="banners">${bannersHtml(null, state.error)}</div>${body}`;
  focus.restore(document.querySelector('#app h1'));
}

async function act(fn, done) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
    state.error = null;
    state.msg = done;
  } catch (err) {
    state.error = `Not saved: ${err.message}`;
    state.msg = '';
  }
  try { await readTeamRows(); } catch (err) { state.error = `Could not reload teams: ${err.message}`; }
  state.busy = false;
  render();
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.copy) await copyFromField(b);
  else if (b.dataset.join) {
    const joined = b.dataset.joined === '1';
    await act(() => markJoined(b.dataset.join, joined), joined ? 'Marked as joined' : 'Moved back to To join');
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (!state.admin || el.dataset.roundDone === undefined) return;
  const on = el.checked;
  await act(() => setRoundDone(el.dataset.roundDone, on), on ? 'Round done' : 'Round reopened');
});

requireMember({ memberScreen: true }).then(who => {
  if (!who) return null;
  state.admin = roleCan(who.member, 'manage_teams');
  if (state.admin) mountNav('team', who.member);
  else {
    mountMemberNav(who.member);
    document.title = 'Your teams · Certamus Radar';
  }
  return load();
});
