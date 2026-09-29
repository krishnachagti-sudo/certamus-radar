// Pure conversions between Supabase rows and the in-memory shapes every page
// and job already uses, plus the edit-link parsing. Browser-safe and shared
// with the Node jobs (fetch/supabase.js).
import { istDate } from '../dates.js';

const rowsOf = rows => (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object' && r.id != null && r.id !== '');

// decisions: { [id]: { status?, registered?, note?, updated } }; null and
// false are omitted, and a row with nothing left is dropped.
export function decisionsFromRows(rows) {
  const out = {};
  for (const r of rowsOf(rows)) {
    const d = {};
    if (r.status) d.status = r.status;
    if (r.registered === true) d.registered = true;
    if (typeof r.note === 'string' && r.note.trim()) d.note = r.note;
    if (!Object.keys(d).length) continue;
    const updated = istDate(r.updated_at);
    if (updated) d.updated = updated;
    out[String(r.id)] = d;
  }
  return out;
}

// intlDates: { [id]: { regn_close, comp_end, confirmed_on } }
export function intlDatesFromRows(rows) {
  const out = {};
  for (const r of rowsOf(rows)) {
    out[String(r.id)] = { regn_close: r.regn_close ?? null, comp_end: r.comp_end ?? null, confirmed_on: r.confirmed_on ?? null };
  }
  return out;
}

// manual: [{ url, added }]
export const manualFromRows = rows => rowsOf(rows)
  .filter(r => typeof r.url === 'string')
  .map(r => ({ url: r.url, added: r.added ?? null }));

// set_decision always gets the full row, so the server copy is exactly what
// is on screen for that id.
export const decisionRpcBody = (k, id, d) => ({
  k,
  p_id: String(id),
  p_status: d?.status || null,
  p_registered: d?.registered === true,
  p_note: d?.note || null,
});

// '#key=<64 hex>' (possibly among other hash params) -> { key, rest }, where
// rest is the hash without the key ('' when nothing is left).
export function parseKeyHash(hash) {
  const parts = String(hash ?? '').replace(/^#/, '').split('&').filter(Boolean);
  let key = null;
  const rest = [];
  for (const p of parts) {
    const m = /^key=([0-9a-fA-F]{64})$/.exec(p);
    if (m && !key) key = m[1].toLowerCase();
    else if (!/^key=/.test(p)) rest.push(p);
  }
  return { key, rest: rest.length ? `#${rest.join('&')}` : '' };
}

// A write refused for the key: HTTP 401/403, or Postgres 42501 ("forbidden").
export const isKeyRejection = (status, body) => status === 401 || status === 403 || body?.code === '42501';
