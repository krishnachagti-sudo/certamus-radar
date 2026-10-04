// Sign-in for every page: Google through Supabase Auth (PKCE), then the
// signed-in email must be an active row in `members` (RLS lets only members
// read it, so anyone else simply finds nothing). The supabase-js client comes
// from vendor/supabase.js, a classic script that sets window.supabase; each
// page loads it before its module. The session lives in localStorage.
//
// requireMember() resolves to { user, member } for a member, or to null after
// rendering one of: the github.io notice, the login screen, "Not on the team
// list". Pages stop on null.
//
// The pure helpers (cleanUrl, isGithubIo, radarUrl, roleCan) are tested in
// Node; nothing here touches window or document on import.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { esc, safeHref } from './card.js';

export const RADAR_HOME = 'https://conyso.com/certamus/radar/';
const AUTH_PARAMS = ['code', 'state'];
// A failed sign-in comes back with these (in the query, or in the hash).
const ERROR_PARAMS = ['error', 'error_code', 'error_description'];
const PAGES = new Set(['', 'index.html', 'all.html', 'c.html', 'calendar.html', 'hosts.html', 'team.html']);

const hrefOf = loc => (typeof loc === 'string' ? loc : loc?.href);

const hashParams = u => new URLSearchParams(u.hash.replace(/^#/, ''));
const hashHasError = u => ERROR_PARAMS.some(p => hashParams(u).has(p));

// The current URL minus the OAuth `code` and `state` parameters and a failed
// sign-in's error parameters; everything else (id, s, an ordinary hash)
// stays, so a deep link survives sign-in.
export function cleanUrl(loc) {
  const u = new URL(hrefOf(loc));
  for (const p of [...AUTH_PARAMS, ...ERROR_PARAMS]) u.searchParams.delete(p);
  if (hashHasError(u)) u.hash = '';
  return u.toString();
}

export function hasAuthParams(loc) {
  try {
    const u = new URL(hrefOf(loc));
    return [...AUTH_PARAMS, ...ERROR_PARAMS].some(p => u.searchParams.has(p)) || hashHasError(u);
  } catch { return false; }
}

// A failed sign-in's message (error_description, else error), or null.
export function authError(loc) {
  try {
    const u = new URL(hrefOf(loc));
    for (const params of [u.searchParams, hashParams(u)]) {
      const msg = params.get('error_description') || params.get('error');
      if (msg) return msg;
    }
    return null;
  } catch { return null; }
}

export const isGithubIo = host => {
  const h = String(host ?? '').toLowerCase();
  return h === 'github.io' || h.endsWith('.github.io');
};

// The same radar page on conyso.com (for the github.io notice): known page
// files keep their query (minus code/state); anything else goes home.
export function radarUrl(loc) {
  try {
    const u = new URL(cleanUrl(loc));
    const file = u.pathname.split('/').pop();
    if (!PAGES.has(file)) return RADAR_HOME;
    return `${RADAR_HOME}${file}${u.search}`;
  } catch { return RADAR_HOME; }
}

// What a role may do. The database enforces all of this again (RLS and the
// RPCs); this only decides which controls a page shows.
const MEMBER_CAN = ['read', 'mark_joined', 'round_done'];
const CAN = {
  member: new Set(MEMBER_CAN),
  admin: new Set([...MEMBER_CAN, 'edit', 'manage_teams']),
};
export function roleCan(member, action) {
  if (!member || member.active === false) return false;
  const set = Object.prototype.hasOwnProperty.call(CAN, member.role) ? CAN[member.role] : null;
  return !!set && set.has(action);
}

// ---- the client and the signed-in member -----------------------------------

let client = null;
let current = null;

export function getClient() {
  if (client) return client;
  const lib = globalThis.supabase;
  if (!lib?.createClient) throw new Error('vendor/supabase.js did not load');
  client = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      storage: globalThis.localStorage,
    },
  });
  return client;
}

export const currentMember = () => current;

// ---- screens ------------------------------------------------------------------

function showGate(html, { nav = '<strong>Certamus Radar</strong>' } = {}) {
  const navEl = document.getElementById('nav');
  if (navEl) navEl.innerHTML = nav;
  document.querySelector('.top')?.setAttribute('hidden', '');
  document.getElementById('app').innerHTML = `<section class="gate" aria-labelledby="gate-h">${html}</section>`;
  document.title = 'Sign in · Certamus Radar';
}

function githubIoScreen() {
  const href = radarUrl(location);
  showGate(`<h1 id="gate-h">Certamus Radar has moved</h1>
    <p>Radar now lives at <a href="${esc(safeHref(href))}">${esc(RADAR_HOME)}</a></p>`);
  document.title = 'Certamus Radar has moved';
}

function loginScreen(message, failure = null) {
  showGate(`<h1 id="gate-h">Certamus Radar</h1>
    ${failure ? `<p class="gate-error" role="alert">Sign-in failed: ${esc(failure)}</p>` : ''}
    <p>Case competitions and hackathons for the Certamus team. Sign in with the Google account on the team list.</p>
    <button type="button" class="primary" id="signin">Sign in with Google</button>
    <p class="gate-msg" id="gate-msg" role="status">${message ? esc(message) : ''}</p>`);
}

function refusedScreen(title, detail) {
  showGate(`<h1 id="gate-h">${esc(title)}</h1>
    ${detail ? `<p>${esc(detail)}</p>` : ''}
    <button type="button" class="primary" id="signout">Sign out</button>`);
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'signin') {
      b.disabled = true;
      const msg = document.getElementById('gate-msg');
      if (msg) msg.textContent = 'Opening Google…';
      const { error } = await getClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: cleanUrl(location) } });
      if (error) {
        b.disabled = false;
        if (msg) msg.textContent = `Could not start sign-in: ${error.message}`;
      }
    } else if (b.id === 'signout') {
      b.disabled = true;
      try { await getClient().auth.signOut({ scope: 'local' }); } catch { /* the local session is dropped anyway */ }
      location.reload();
    }
  });
}

// ---- the gate -------------------------------------------------------------------

export async function requireMember() {
  if (isGithubIo(location.hostname)) { githubIoScreen(); return null; }
  listen();
  // Read a failed sign-in's message before anything cleans the URL.
  const failure = authError(location);
  let sb;
  try { sb = getClient(); } catch (e) { loginScreen(e.message, failure); return null; }

  // initialize() is the client's own start-up (it exchanges a ?code= for a
  // session); awaiting it again returns the same result.
  const { error: initError } = await sb.auth.initialize();
  if (hasAuthParams(location)) {
    try { history.replaceState(history.state, '', cleanUrl(location)); } catch { /* ignore */ }
  }
  const { data, error } = await sb.auth.getSession();
  const session = data?.session;
  if (!session) {
    const why = initError || error;
    loginScreen(why && !failure ? `Sign-in did not complete: ${why.message}` : '', failure);
    return null;
  }

  const user = session.user;
  const email = String(user?.email || '').toLowerCase();
  const { data: row, error: readError } = await sb.from('members')
    .select('email,name,role,active').eq('email', email).maybeSingle();
  if (readError) {
    refusedScreen('Could not check the team list', `${readError.message}. Reload to try again, or sign out.`);
    return null;
  }
  if (!row || row.active === false) {
    refusedScreen(`Not on the team list (${email})`, 'Ask Krishna to add this Google account, or sign out and use the one on the list.');
    return null;
  }
  current = { email: row.email, name: row.name, role: row.role };
  // Signed out in another tab, or the refresh failed: back to the login screen.
  sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') location.reload(); });
  return { user, member: current };
}
