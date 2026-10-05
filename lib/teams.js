// Pure rules for teams, invite-link joins and rounds (the submission
// tracker). Inputs are the raw Supabase rows, already scoped by RLS to what
// the viewer may see (admin: every team; member: their own teams):
//   teams        { listing_id, section, invite_url, note, created_at }
//   team_members { listing_id, email, joined_at }
//   rounds       { id, listing_id, name, due, owner_email, done, done_at }
//   members      { email, name, role, active }
// Listing titles come from an index built by listingIndex() over the live
// listings of both sections and the archive (a team outlives its listing).
// Dates are IST calendar dates ('YYYY-MM-DD'). Browser-safe, no DOM.
import { dayDiff, istDate } from '../dates.js';
import { httpsUrl } from '../urls.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const arr = a => (Array.isArray(a) ? a : []);
const low = e => String(e ?? '').trim().toLowerCase();
const key = (section, id) => `${section}:${String(id)}`;
const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''));
const validDate = d => typeof d === 'string' && ISO.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

// A person as shown: their name in members, else the email's local part.
export function memberName(email, members) {
  const e = low(email);
  if (!e) return '';
  const m = arr(members).find(x => low(x?.email) === e);
  return (m?.name && String(m.name).trim()) || e.split('@')[0];
}

export const istDay = iso => istDate(iso);

// { case: [records], hack: [records] } live, and the same shape for the
// archive. Live wins over archived; the newest archived edition wins.
export function listingIndex(live = {}, archive = {}) {
  const ix = new Map();
  for (const section of ['case', 'hack']) {
    for (const a of arr(archive?.[section])) {
      if (a?.id != null) ix.set(key(section, a.id), { title: a.title, host: a.host, archived: true, record: a, section });
    }
    for (const c of arr(live?.[section])) {
      if (c?.id != null) ix.set(key(section, c.id), { title: c.title, host: c.host, archived: false, record: c, section });
    }
  }
  return ix;
}

// The listing behind a team: its own section first, then the other one
// (decisions and teams are keyed by id alone).
export function compOf(index, team) {
  const id = String(team?.listing_id ?? '');
  const own = team?.section === 'hack' ? 'hack' : 'case';
  const other = own === 'hack' ? 'case' : 'hack';
  const hit = index?.get?.(key(own, id)) || index?.get?.(key(other, id));
  if (hit) return { ...hit, title: hit.title || `Listing ${id}`, missing: false };
  return { title: `Listing ${id}`, host: '', archived: false, record: null, section: own, missing: true };
}

export const membersOf = (listingId, teamMembers) => arr(teamMembers).filter(r => String(r?.listing_id) === String(listingId));
export const roundsOf = (listingId, rounds) => arr(rounds).filter(r => String(r?.listing_id) === String(listingId));

export function teamProgress(team, teamMembers) {
  const rows = membersOf(team?.listing_id, teamMembers);
  const pending = rows.filter(r => !r.joined_at).map(r => low(r.email)).sort();
  return { joined: rows.length - pending.length, total: rows.length, pending };
}

const teamItem = (team, index) => {
  const comp = compOf(index, team);
  return {
    listing_id: String(team.listing_id), section: team.section === 'hack' ? 'hack' : 'case',
    title: comp.title, archived: comp.archived, invite_url: team.invite_url, team,
  };
};

// [{ email, items: [{ listing_id, section, title, ... }] }], by email; each
// person's items by title. opts.except leaves one email out (the viewer).
export function pendingByPerson(teams, teamMembers, index, opts = {}) {
  const except = low(opts.except);
  const people = new Map();
  for (const team of arr(teams)) {
    for (const email of teamProgress(team, teamMembers).pending) {
      if (except && email === except) continue;
      if (!people.has(email)) people.set(email, []);
      people.get(email).push(teamItem(team, index));
    }
  }
  return [...people.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([email, items]) => ({ email, items: items.sort((a, b) => byText(a.title, b.title)) }));
}

// Teams with at least one pending join: [{ ...item, pending, joined, total }].
export function pendingByComp(teams, teamMembers, index) {
  return arr(teams)
    .map(team => ({ ...teamItem(team, index), ...teamProgress(team, teamMembers) }))
    .filter(x => x.pending.length)
    .sort((a, b) => byText(a.title, b.title));
}

// The viewer's teams they have not marked joined yet, by title.
export function myJoins(email, teams, teamMembers, index) {
  const me = low(email);
  if (!me) return [];
  return arr(teams)
    .filter(team => membersOf(team.listing_id, teamMembers).some(r => low(r.email) === me && !r.joined_at))
    .map(team => teamItem(team, index))
    .sort((a, b) => byText(a.title, b.title));
}

export function isOverdue(round, today) {
  if (!round || round.done || !validDate(round.due)) return false;
  return dayDiff(today, round.due) < 0;
}

// Dated first by due date, undated last, then by name.
const byDue = (a, b) => {
  const da = validDate(a.due) ? a.due : null;
  const db = validDate(b.due) ? b.due : null;
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : 1;
  }
  return byText(a.name, b.name);
};

// Undone rounds the viewer owns, or that no one owns in a team they are in.
export function myRounds(email, teams, teamMembers, rounds, today) {
  const me = low(email);
  if (!me) return [];
  const visible = new Set(arr(teams).map(t => String(t.listing_id)));
  const mine = new Set(arr(teamMembers).filter(r => low(r.email) === me).map(r => String(r.listing_id)));
  return arr(rounds)
    .filter(r => r && !r.done && visible.has(String(r.listing_id)))
    .filter(r => (r.owner_email ? low(r.owner_email) === me : mine.has(String(r.listing_id))))
    .map(r => ({ ...r, overdue: isOverdue(r, today) }))
    .sort(byDue);
}

const teamMap = teams => new Map(arr(teams).map(t => [String(t.listing_id), t]));

// Calendar 📝 events: one per dated round of a visible team, by date.
export function roundEvents(teams, rounds, index) {
  const tmap = teamMap(teams);
  const out = [];
  for (const r of arr(rounds)) {
    const team = r && tmap.get(String(r.listing_id));
    if (!team || !validDate(r.due)) continue;
    const comp = compOf(index, team);
    out.push({
      kind: 'round', date: r.due, id: `round-${r.id}`, listing_id: String(team.listing_id),
      section: team.section === 'hack' ? 'hack' : 'case', title: `${r.name}: ${comp.title}`,
      name: r.name, comp: comp.title, done: !!r.done, round: r, c: comp.record,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? byText(a.title, b.title) : a.date < b.date ? -1 : 1));
}

// Undone dated rounds as committed dates for the calendar's clash days.
// team_of groups a round with its own competition (and sibling rounds), so
// a round never "clashes" with the event it belongs to.
export function roundClashItems(teams, rounds, index) {
  return roundEvents(teams, rounds, index)
    .filter(e => !e.done)
    .map(e => ({ id: e.id, title: `${e.name} (${e.comp})`, regn_close: e.date, team_of: e.listing_id }));
}

// "All teams" rows: progress, the next undone round due today or later, and
// how many undone rounds are overdue. Sorted by next due, then title.
export function teamSummaries(teams, teamMembers, rounds, index, today) {
  return arr(teams).map(team => {
    const own = roundsOf(team.listing_id, rounds).filter(r => !r.done);
    const next = own.filter(r => validDate(r.due) && dayDiff(today, r.due) >= 0).sort(byDue)[0] || null;
    return {
      ...teamItem(team, index), ...teamProgress(team, teamMembers),
      next, overdue: own.filter(r => isOverdue(r, today)).length,
    };
  }).sort((a, b) => {
    const da = a.next?.due || null;
    const db = b.next?.due || null;
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -1 : 1;
    }
    return byText(a.title, b.title);
  });
}

// Who "Create team" ticks by default. Case comps: the case roster, i.e.
// every active member except Akshit (the hackathon teammate). Hackathons:
// Krishna and Akshit, each only if they are active members.
const firstName = m => String(m?.name ?? '').trim().split(/\s+/)[0].toLowerCase();
export function defaultTeamEmails(section, members) {
  const active = arr(members).filter(m => m && m.active !== false && m.email);
  const picked = section === 'hack'
    ? active.filter(m => ['krishna', 'akshit'].includes(firstName(m)))
    : active.filter(m => firstName(m) !== 'akshit');
  return picked.map(m => low(m.email)).sort();
}

// The same rule as the create_team / update_team RPCs.
export function validInviteUrl(url) {
  const u = String(url ?? '').trim();
  if (!/^https:\/\/\S+$/.test(u) || u.length > 1000) return null;
  return httpsUrl(u) ? u : null;
}

// ---- the member screen ------------------------------------------------------

// my_joins() rows -> { toJoin, joined }. toJoin: not joined yet, by
// registration deadline (undated last), then title. joined: newest first.
// Ids become strings, an unknown section is 'case', a blank title falls back
// to "Listing <id>", an invalid deadline is null; rows without an id are dropped.
export function splitJoins(rows) {
  const items = arr(rows)
    .filter(r => r && typeof r === 'object' && r.listing_id != null && String(r.listing_id) !== '')
    .map(r => {
      const id = String(r.listing_id);
      const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : `Listing ${id}`;
      return {
        listing_id: id, section: r.section === 'hack' ? 'hack' : 'case', title,
        regn_close: validDate(r.regn_close) ? r.regn_close : null,
        invite_url: r.invite_url, joined_at: r.joined_at || null,
      };
    });
  const toJoin = items.filter(x => !x.joined_at).sort((a, b) => {
    if (a.regn_close !== b.regn_close) {
      if (!a.regn_close) return 1;
      if (!b.regn_close) return -1;
      return a.regn_close < b.regn_close ? -1 : 1;
    }
    return byText(a.title, b.title);
  });
  const at = x => Date.parse(x.joined_at) || 0;
  const joined = items.filter(x => x.joined_at)
    .sort((a, b) => (at(a) === at(b) ? byText(a.title, b.title) : at(b) - at(a)));
  return { toJoin, joined };
}
