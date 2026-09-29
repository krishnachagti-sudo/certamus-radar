// Supabase data store for the pages: public reads of decisions, manual links
// and confirmed international dates, and key-checked writes through RPC
// functions. The editor key comes from a private edit link (lib/editor.js)
// and is kept in this browser's localStorage. Browser-safe, no node: imports.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { todayIST } from '../dates.js';
import { applyDecision, decisionView } from './data.js';
import { decisionsFromRows, intlDatesFromRows, manualFromRows, decisionRpcBody, isKeyRejection } from './rows.js';

const CFG = { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY };
const KEY_STORAGE = 'certamus-radar.key';
export const KEY_REJECTED = 'This device’s edit link was rejected. Open the private edit link again to edit.';
export class KeyRejected extends Error {}

export const configured = () => Boolean(CFG.url && CFG.anon);

// ---- editor key ------------------------------------------------------------

function readKey() { try { return globalThis.localStorage?.getItem(KEY_STORAGE) || null; } catch { return null; } }
let key = readKey();
export const getKey = () => key;
export function setKey(k) {
  key = k || null;
  try {
    if (key) globalThis.localStorage?.setItem(KEY_STORAGE, key);
    else globalThis.localStorage?.removeItem(KEY_STORAGE);
  } catch { /* memory only */ }
}
export const clearKey = () => setKey(null);
// Edit mode: a key is stored and there is a project to write to.
export const editable = () => configured() && !!key;

// ---- HTTP (cfg and fetchImpl injectable for tests) -------------------------

const base = cfg => cfg.url.replace(/\/+$/, '');
const headers = cfg => ({ apikey: cfg.anon, Authorization: `Bearer ${cfg.anon}` });
const notConfigured = () => new Error('Editing not configured yet');

async function bodyOf(r) {
  let text = '';
  try { text = await r.text(); } catch { /* no body */ }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function restGet(cfg, table, fetchImpl = globalThis.fetch) {
  if (!cfg.url || !cfg.anon) throw notConfigured();
  const r = await fetchImpl(`${base(cfg)}/rest/v1/${table}?select=*`, { headers: headers(cfg), cache: 'no-store' });
  const body = await bodyOf(r);
  if (!r.ok) throw new Error(body?.message || `Could not read ${table} (HTTP ${r.status})`);
  if (!Array.isArray(body)) throw new Error(`Could not read ${table} (unexpected response)`);
  return body;
}

export async function rpcCall(cfg, fn, args, fetchImpl = globalThis.fetch) {
  if (!cfg.url || !cfg.anon) throw notConfigured();
  const r = await fetchImpl(`${base(cfg)}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await bodyOf(r);
  if (r.ok) return body;
  if (isKeyRejection(r.status, body)) throw new KeyRejected(KEY_REJECTED);
  throw new Error(body?.message || `HTTP ${r.status}`);
}

// ---- reads -----------------------------------------------------------------

export const readDecisions = async () => decisionsFromRows(await restGet(CFG, 'decisions'));
export const readManual = async () => manualFromRows(await restGet(CFG, 'manual'));
export const readIntlDates = async () => intlDatesFromRows(await restGet(CFG, 'intl_dates'));

// ---- writes ----------------------------------------------------------------

export const checkEditor = async k => (await rpcCall(CFG, 'check_editor', { k })) === true;
export const saveDecision = (id, d) => rpcCall(CFG, 'set_decision', decisionRpcBody(key, id, d));
export const addManual = url => rpcCall(CFG, 'add_manual', { k: key, p_url: url });
export const setIntlDates = (id, regnClose, compEnd) =>
  rpcCall(CFG, 'set_intl_dates', { k: key, p_id: String(id), p_regn_close: regnClose || null, p_comp_end: compEnd || null });

// Saves run one at a time, one set_decision per change, each sending the full
// row as it is on screen then. Queued changes are kept in `pending` so a
// reload of decisions can be re-overlaid with them (overlay()).
// state.decisions is updated optimistically; hooks let the page redraw:
//   local(id, before, after, opts)  right after the optimistic change
//   saved(id, shown, now)           after the server write lands
//   keyRejected()                   the key was refused (await-ed)
//   failed(err)                     any other error; the change stays on screen
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
      if (!pending.includes(entry)) return; // dropped (key rejected)
      const shown = decisionView(state.decisions, k);
      try {
        await send(k, state.decisions[k]);
        pending.splice(pending.indexOf(entry), 1);
        hooks.saved(k, shown, decisionView(state.decisions, k));
      } catch (err) {
        const i = pending.indexOf(entry);
        if (i >= 0) pending.splice(i, 1);
        if (err instanceof KeyRejected) { await hooks.keyRejected(); return; }
        hooks.failed(err);
      }
    });
    chain = job;
    return job;
  }
  return {
    save,
    drop: () => { pending.length = 0; },
    overlay: decisions => pending.reduce((d, p) => p.apply(d), decisions),
  };
}
