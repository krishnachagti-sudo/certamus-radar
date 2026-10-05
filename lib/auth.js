// Sign-in for every page, against the Radar API (api/, Resolution 22):
// "Sign in with Google" sends the browser to API_URL/auth/google with this
// page as the return address; the API runs Google's sign-in, checks the
// account is an active row in `members`, and comes back here with a
// one-time ?radar_code= (or ?radar_error=<reason>). The page swaps the code
// for a 30-day session token (POST /auth/exchange), kept in localStorage,
// and reads its own members row from GET /auth/me. Every API request
// carries the token; the database decides what it may see (db/schema.sql).
//
// requireMember() resolves to { user, member } for a member, or to null after
// rendering one of: the github.io notice, the login screen (with a failed
// sign-in's reason), "Could not check the team list". Pages stop on null.
//
// Teammates (role 'member') have one screen only, team.html: every other
// page sends them there with location.replace() before loading anything
// (requireMember() then resolves to null). team.html passes
// { memberScreen: true } to let them in. The database refuses them the
// radar data anyway; this only spares them a broken page.
//
// The pure helpers (cleanUrl, signInUrl, authError, isGithubIo, radarUrl,
// roleCan, memberHome) are tested in Node; nothing here touches window or
// document on import.
import { API_URL } from '../config.js';
import { esc, safeHref } from './card.js';
import { createClient } from './api.js';

export const RADAR_HOME = 'https://conyso.com/certamus/radar/';
// What the API appends on the way back from Google.
const AUTH_PARAMS = ['radar_code', 'radar_error'];
const PAGES = new Set(['', 'index.html', 'all.html', 'c.html', 'calendar.html', 'hosts.html', 'team.html']);
export const SESSION_KEY = 'certamus-radar.session';

const hrefOf = loc => (typeof loc === 'string' ? loc : loc?.href);

// The current URL minus the sign-in result (radar_code, radar_error);
// everything else (id, s, the hash) stays, so a deep link survives sign-in.
export function cleanUrl(loc) {
  const u = new URL(hrefOf(loc));
  for (const p of AUTH_PARAMS) u.searchParams.delete(p);
  return u.toString();
}

export function hasAuthParams(loc) {
  try {
    const u = new URL(hrefOf(loc));
    return AUTH_PARAMS.some(p => u.searchParams.has(p));
  } catch { return false; }
}

// The one-time code the API sent back, or null.
export function authCode(loc) {
  try { return new URL(hrefOf(loc)).searchParams.get('radar_code') || null; } catch { return null; }
}

// The API sends a reason code, never free text; this is what each means.
const REASONS = {
  not_member: 'Not on the team list. Ask Krishna to add the Google account you used, or sign in with the one on the list.',
  cancelled: 'Google sign-in was cancelled.',
  expired: 'The sign-in took too long. Try again.',
  failed: 'Google sign-in did not complete. Try again.',
};
// A failed sign-in's message, or null.
export function authError(loc) {
  try {
    const why = new URL(hrefOf(loc)).searchParams.get('radar_error');
    if (!why) return null;
    return Object.prototype.hasOwnProperty.call(REASONS, why) ? REASONS[why] : REASONS.failed;
  } catch { return null; }
}

// Where "Sign in with Google" goes: the API, with this page (cleaned) as
// the way back (the API accepts only the radar's own pages) and the hash of
// this tab's sign-in binding.
export function signInUrl(loc, bindHash, apiUrl = API_URL) {
  return `${String(apiUrl).replace(/\/+$/, '')}/auth/google?return=${encodeURIComponent(cleanUrl(loc))}&bind=${encodeURIComponent(bindHash)}`;
}

// Login CSRF guard: a random value this tab keeps in sessionStorage while it
// signs in. The API gets only its sha256 (hex) at the start and wants the
// value itself with the one-time code, so a code made in someone else's
// browser and planted in a link cannot sign this one in.
export const BINDING_KEY = 'certamus-radar.signin';
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function newBinding(cryptoImpl = globalThis.crypto) {
  const value = b64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return { value, hash: [...digest].map(b => b.toString(16).padStart(2, '0')).join('') };
}
function takeBinding() {
  try {
    const v = globalThis.sessionStorage.getItem(BINDING_KEY);
    globalThis.sessionStorage.removeItem(BINDING_KEY);
    return v;
  } catch { return null; }
}

export const isGithubIo = host => {
  const h = String(host ?? '').toLowerCase();
  return h === 'github.io' || h.endsWith('.github.io');
};

// The same radar page on conyso.com (for the github.io notice): known page
// files keep their query (minus the sign-in result); anything else goes home.
export function radarUrl(loc) {
  try {
    const u = new URL(cleanUrl(loc));
    const file = u.pathname.split('/').pop();
    if (!PAGES.has(file)) return RADAR_HOME;
    return `${RADAR_HOME}${file}${u.search}`;
  } catch { return RADAR_HOME; }
}

// What a role may do. The database enforces all of this again (RLS and the
// RPCs); this only decides which controls a page shows. A teammate only
// ticks their own joins; reading the radar, rounds and editing are the admin's.
const CAN = {
  member: new Set(['mark_joined']),
  admin: new Set(['read', 'mark_joined', 'round_done', 'edit', 'manage_teams']),
};
export function roleCan(member, action) {
  if (!member || member.active === false) return false;
  const set = Object.prototype.hasOwnProperty.call(CAN, member.role) ? CAN[member.role] : null;
  return !!set && set.has(action);
}

// The teammates' only page, next to the current one; no query or hash is
// carried over (the member screen shows both sections at once).
export const MEMBER_PAGE = 'team.html';
export function memberHome(loc) {
  try { return new URL(MEMBER_PAGE, hrefOf(loc)).toString(); } catch { return MEMBER_PAGE; }
}

// ---- the session, the client and the signed-in member ------------------------

let current = null;
let client = null;
let signedIn = false;

// { token, expires_at } from localStorage, or null (absent, expired, unreadable).
export function readSession(storage = globalThis.localStorage, nowMs = Date.now()) {
  try {
    const s = JSON.parse(storage?.getItem(SESSION_KEY) || 'null');
    if (!s || typeof s.token !== 'string' || !s.token) return null;
    if (s.expires_at && Date.parse(s.expires_at) <= nowMs) return null;
    return s;
  } catch { return null; }
}
// When localStorage is blocked the session lives in this page only.
let memory = null;
const session = () => readSession() || (memory && readSession({ getItem: () => JSON.stringify(memory) }));
function writeSession(s) {
  memory = null;
  try {
    if (s) globalThis.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else globalThis.localStorage.removeItem(SESSION_KEY);
  } catch {
    memory = s;
  }
}

export function getClient() {
  if (client) return client;
  client = createClient({
    url: API_URL,
    getToken: () => session()?.token || null,
    // The session ended (expired, signed out elsewhere, member removed):
    // back to the login screen. Before sign-in completes, requireMember
    // handles a 401 itself.
    onUnauthorized: () => {
      if (!signedIn) return;
      signedIn = false;
      writeSession(null);
      location.reload();
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
      try {
        const binding = await newBinding();
        globalThis.sessionStorage.setItem(BINDING_KEY, binding.value);
        location.assign(signInUrl(location, binding.hash));
      } catch (err) {
        b.disabled = false;
        if (msg) msg.textContent = `Could not start sign-in: ${err.message}`;
      }
    } else if (b.id === 'signout') {
      b.disabled = true;
      // Ends the session on the server too; the local copy goes regardless.
      try { if (session()) await getClient().request('/auth/signout', { method: 'POST' }); } catch { /* ignore */ }
      signedIn = false;
      writeSession(null);
      location.reload();
    }
  });
  // Signed out in another tab: this one follows.
  window.addEventListener('storage', e => {
    if (e.key === SESSION_KEY && !e.newValue && signedIn) location.reload();
  });
}

// ---- the gate -------------------------------------------------------------------

export async function requireMember({ memberScreen = false } = {}) {
  if (isGithubIo(location.hostname)) { githubIoScreen(); return null; }
  listen();
  // Read the sign-in result before the URL is cleaned.
  const failure = authError(location);
  const code = authCode(location);
  if (hasAuthParams(location)) {
    try { history.replaceState(history.state, '', cleanUrl(location)); } catch { /* ignore */ }
  }
  const api = getClient();

  // Always spent, so a stale binding never outlives one sign-in attempt.
  const binding = code || failure ? takeBinding() : null;
  if (code && !binding) {
    loginScreen('Sign-in did not complete: it was started in another tab or browser. Sign in again here.', failure);
    return null;
  }
  if (code) {
    const { data, error } = await api.request('/auth/exchange', { method: 'POST', body: { code, binding } });
    if (error || !data?.token) {
      loginScreen(`Sign-in did not complete: ${error?.message || 'no session'}`, failure);
      return null;
    }
    writeSession({ token: data.token, expires_at: data.expires_at || null });
  }
  if (!session()) {
    writeSession(null);
    loginScreen('', failure);
    return null;
  }

  const { data: row, error } = await api.request('/auth/me');
  if (error?.status === 401) {
    writeSession(null);
    loginScreen('Your session has ended. Sign in again.', failure);
    return null;
  }
  if (error || !row?.email) {
    refusedScreen('Could not check the team list', `${error?.message || 'no answer'}. Reload to try again, or sign out.`);
    return null;
  }
  if (row.active === false) {
    refusedScreen(`Not on the team list (${row.email})`, 'Ask Krishna to add this Google account, or sign out and use the one on the list.');
    return null;
  }
  current = { email: row.email, name: row.name, role: row.role };
  if (current.role !== 'admin' && !memberScreen) {
    location.replace(memberHome(location));
    return null;
  }
  signedIn = true;
  return { user: { email: row.email }, member: current };
}
