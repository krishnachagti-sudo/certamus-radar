// The pages' data store: every read and write goes through the supabase-js
// client (lib/auth.js) carrying the signed-in user's session, so RLS decides
// what comes back (members read everything except other teams' invite links;
// only the admin writes decisions, intl_dates and manual). Browser-safe, no
// node: imports. Each function takes the client as an optional last argument
// (tests pass a stand-in); pages use the signed-in one.
import { todayIST } from '../dates.js';
import { unstopId } from '../urls.js';
import { applyDecision, decisionView } from './data.js';
import { decisionsFromRows, intlDatesFromRows, manualFromRows } from './rows.js';
import { getClient, currentMember, roleCan } from './auth.js';

export const PAGE_SIZE = 1000; // PostgREST's default max-rows on Supabase
const SECTIONS = new Set(['case', 'hack']);

// Edit mode: the signed-in member is the admin.
export const editable = () => roleCan(currentMember(), 'edit');

const fail = (what, error) => new Error(`Could not ${what}: ${error.message || error.code || 'unknown error'}`);
const checkSection = section => {
  if (!SECTIONS.has(section)) throw new Error(`section must be case or hack, got ${section}`);
};

// Every row of a table in a stable order, page by page with .range() until
// an empty page. Not "until a short page": the server may cap a page below
// the size asked for, and a short page then is not the end.
export async function selectAll(client, table, { columns = '*', eq = {}, order = [], pageSize = PAGE_SIZE } = {}) {
  const out = [];
  for (;;) {
    let q = client.from(table).select(columns);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    for (const o of order) q = q.order(o, { ascending: true });
    const { data, error } = await q.range(out.length, out.length + pageSize - 1);
    if (error) throw fail(`read ${table}`, error);
    if (!Array.isArray(data)) throw new Error(`Could not read ${table}: unexpected response`);
    if (!data.length) return out;
    out.push(...data);
  }
}

// listings / archive rows -> the records the pages use (the `data` column).
export const recordsFromRows = rows => (Array.isArray(rows) ? rows : [])
  .map(r => r?.data)
  .filter(d => d && typeof d === 'object' && !Array.isArray(d));

// ---- reads -----------------------------------------------------------------

export async function readListings(section, client = getClient()) {
  checkSection(section);
  return recordsFromRows(await selectAll(client, 'listings', { columns: 'data', eq: { section }, order: ['id'] }));
}

// Oldest first, so the newest archived edition of an id is the last one.
export async function readArchive(section, client = getClient()) {
  checkSection(section);
  return recordsFromRows(await selectAll(client, 'archive', { columns: 'data', eq: { section }, order: ['archived_on', 'archive_key'] }));
}

// The section's fetch status ({ last_ok, last_error, sources }), {} if none yet.
export async function readStatus(section, client = getClient()) {
  checkSection(section);
  const { data, error } = await client.from('source_status').select('data').eq('section', section);
  if (error) throw fail('read source_status', error);
  const d = Array.isArray(data) ? data[0]?.data : null;
  return d && typeof d === 'object' ? d : {};
}

// The weekly watcher's flags: { [id]: { changed_on, last_checked, ... } }.
export async function readWatch(client = getClient()) {
  const rows = await selectAll(client, 'watch', { columns: 'id,data', order: ['id'] });
  return Object.fromEntries(rows.filter(r => r?.id != null && r.data).map(r => [String(r.id), r.data]));
}

export const readDecisions = async (client = getClient()) => decisionsFromRows(await selectAll(client, 'decisions', { order: ['id'] }));
export const readIntlDates = async (client = getClient()) => intlDatesFromRows(await selectAll(client, 'intl_dates', { order: ['id'] }));
export const readManual = async (client = getClient()) => manualFromRows(await selectAll(client, 'manual', { order: ['id'] }));

// Raw rows for the team features. teams, team_members and rounds come back
// filtered by RLS: the admin sees all, a member only their own teams.
export const readMembers = (client = getClient()) => selectAll(client, 'members', { columns: 'email,name,role,active', order: ['email'] });
export const readTeams = (client = getClient()) => selectAll(client, 'teams', { order: ['listing_id'] });
export const readTeamMembers = (client = getClient()) => selectAll(client, 'team_members', { order: ['listing_id', 'email'] });
export const readRounds = (client = getClient()) => selectAll(client, 'rounds', { order: ['listing_id', 'id'] });

// ---- writes (admin; RLS refuses anyone else) --------------------------------

// The row a decision change writes: the full row as it is on screen, or a
// delete when status, registered and note are all empty.
export function decisionWrite(id, d, nowIso = new Date().toISOString()) {
  const key = String(id);
  const status = d?.status || null;
  const registered = d?.registered === true;
  const note = typeof d?.note === 'string' && d.note.trim() ? d.note : null;
  if (!status && !registered && !note) return { delete: key };
  return { upsert: { id: key, status, registered, note, updated_at: nowIso } };
}

// The page prefixes "Not saved: ", so the server's own message is enough.
async function run(query) {
  const { error } = await query;
  if (error) throw new Error(error.message || error.code || 'the server refused the change');
}

export async function saveDecision(id, d, client = getClient()) {
  const w = decisionWrite(id, d);
  if (w.delete) return run(client.from('decisions').delete().eq('id', w.delete));
  return run(client.from('decisions').upsert(w.upsert, { onConflict: 'id' }));
}

// Both dates cleared deletes the row (the record falls back to "expected").
export async function setIntlDates(id, regnClose, compEnd, client = getClient()) {
  const key = String(id);
  if (!regnClose && !compEnd) return run(client.from('intl_dates').delete().eq('id', key));
  return run(client.from('intl_dates').upsert(
    { id: key, regn_close: regnClose || null, comp_end: compEnd || null, confirmed_on: todayIST() },
    { onConflict: 'id' }));
}

// An Unstop link added by hand; a link already there is left alone (another
// tab). Returns the Unstop id.
export async function addManual(url, client = getClient()) {
  const id = /^https:\/\//i.test(String(url ?? '')) ? unstopId(url) : null;
  if (!id) throw new Error('Only Unstop competition links (https://unstop.com/…)');
  await run(client.from('manual').upsert({ id: String(id), url }, { onConflict: 'id', ignoreDuplicates: true }));
  return String(id);
}

// ---- team and round RPCs (v3.sql section 6) ---------------------------------
// Each checks the caller inside the database; a refusal or bad input comes
// back as the Postgres message, which the page shows in its banner.

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || error.code || `${name} was refused`);
  return data;
}
const emailList = emails => (Array.isArray(emails) ? emails : []).map(e => String(e).trim().toLowerCase()).filter(Boolean);

export const createTeam = ({ listingId, section, inviteUrl, emails }, client = getClient()) => rpc(client, 'create_team', {
  p_listing_id: String(listingId), p_section: section, p_invite_url: String(inviteUrl ?? '').trim(), p_emails: emailList(emails),
});
export const updateTeam = ({ listingId, inviteUrl, emails }, client = getClient()) => rpc(client, 'update_team', {
  p_listing_id: String(listingId), p_invite_url: String(inviteUrl ?? '').trim(), p_emails: emailList(emails),
});
export const deleteTeam = (listingId, client = getClient()) => rpc(client, 'delete_team', { p_listing_id: String(listingId) });
export const markJoined = (listingId, joined, client = getClient()) =>
  rpc(client, 'mark_joined', { p_listing_id: String(listingId), p_joined: joined === true });
// id null = a new round; returns the round id.
export const upsertRound = ({ id = null, listingId, name, due, owner }, client = getClient()) => rpc(client, 'upsert_round', {
  p_id: id || null, p_listing_id: String(listingId), p_name: String(name ?? '').trim(),
  p_due: due || null, p_owner_email: owner ? String(owner).trim().toLowerCase() : null,
});
export const deleteRound = (id, client = getClient()) => rpc(client, 'delete_round', { p_id: id });
export const setRoundDone = (id, done, client = getClient()) => rpc(client, 'set_round_done', { p_id: id, p_done: done === true });

// Saves run one at a time, one write per change, each sending the full row
// as it is on screen then. Queued changes are kept in `pending` so a reload
// of decisions can be re-overlaid with them (overlay()).
// state.decisions is updated optimistically; hooks let the page redraw:
//   local(id, before, after, opts)  right after the optimistic change
//   saved(id, shown, now)           after the server write lands
//   failed(err)                     the write was refused (RLS) or never
//                                   arrived; the change stays on screen
export function createDecisionSaver(state, hooks, send = saveDecision) {
  let chain = Promise.resolve();
  const pending = [];
  function save(id, change, opts = {}) {
    const k = String(id);
    const entry = { apply: all => applyDecision(all, k, change, todayIST()) };
    const before = decisionView(state.decisions, k);
    state.decisions = entry.apply(state.decisions);
    pending.push(entry);
    hooks.local(k, before, decisionView(state.decisions, k), opts);

    const job = chain.then(async () => {
      const shown = decisionView(state.decisions, k);
      try {
        await send(k, state.decisions[k]);
        pending.splice(pending.indexOf(entry), 1);
        hooks.saved(k, shown, decisionView(state.decisions, k));
      } catch (err) {
        const i = pending.indexOf(entry);
        if (i >= 0) pending.splice(i, 1);
        hooks.failed(err);
      }
    });
    chain = job;
    return job;
  }
  return {
    save,
    overlay: decisions => pending.reduce((d, p) => p.apply(d), decisions),
  };
}
