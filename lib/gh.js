// GitHub contents API: the token, reads and read-modify-write updates with
// 409 retry, 401 handling, and the serialised decision saver shared by every
// page that edits decisions.json.
import { todayIST } from '../dates.js';
import { applyDecision, decisionView } from './data.js';

export const REPO = 'krishnachagti-sudo/certamus-radar';
const TOKEN_KEY = 'certamus-radar.token';
export const TOKEN_REJECTED = 'Token rejected or expired. Press Edit to enter a new one.';
export class AuthError extends Error {}

function readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
let token = readToken();
export const getToken = () => token;
export function setToken(t) {
  token = t || null;
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* memory only */ }
}

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
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...init.headers },
  });
}

export async function apiRead(path) {
  const r = await api(path, { cache: 'no-store' });
  if (r.status === 401) throw new AuthError(TOKEN_REJECTED);
  if (!r.ok) throw new Error(`Could not read ${path} (${r.status})`);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(b64decode(j.content)) };
}

// Read file + sha, apply the change, write. Workflows never write the board's
// files, so a 409 means another tab wrote first: re-read and retry, 3 tries.
export async function apiUpdate(path, mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await apiRead(path);
    const next = mutate(data);
    const r = await api(path, { method: 'PUT', body: JSON.stringify({ message, sha, content: b64encode(JSON.stringify(next, null, 2) + '\n') }) });
    if (r.ok) return next;
    if (r.status === 401) throw new AuthError(TOKEN_REJECTED);
    if (r.status !== 409) throw new Error(`Could not save ${path} (${r.status})`);
  }
  throw new Error(`${path} kept changing; reload and try again`);
}

// Saves run one at a time. Each queued change is also kept in `pending` so a
// server result can be re-overlaid with the changes still waiting to save.
// state.decisions is updated optimistically; hooks let the page redraw:
//   local(id, before, after, opts)  right after the optimistic change
//   saved(id, shown, now)           after the server write lands
//   authRejected()                  401: caller drops the token (await-ed)
//   failed(err)                     any other error; the change stays on screen
export function createDecisionSaver(state, hooks) {
  let chain = Promise.resolve();
  const pending = [];
  function save(id, change, opts = {}) {
    const key = String(id);
    const apply = all => applyDecision(all, key, change, todayIST());
    const entry = { apply };
    const before = decisionView(state.decisions, key);
    state.decisions = apply(state.decisions);
    pending.push(entry);
    hooks.local(key, before, decisionView(state.decisions, key), opts);

    const job = chain.then(async () => {
      if (!pending.includes(entry)) return; // dropped (token rejected)
      const shown = decisionView(state.decisions, key);
      try {
        const server = await apiUpdate('data/decisions.json', apply, `decision: ${key}`);
        pending.splice(pending.indexOf(entry), 1);
        state.decisions = pending.reduce((d, p) => p.apply(d), server);
        hooks.saved(key, shown, decisionView(state.decisions, key));
      } catch (err) {
        const i = pending.indexOf(entry);
        if (i >= 0) pending.splice(i, 1);
        if (err instanceof AuthError) { await hooks.authRejected(); return; }
        hooks.failed(err);
      }
    });
    chain = job;
    return job;
  }
  return { save, drop: () => { pending.length = 0; } };
}
