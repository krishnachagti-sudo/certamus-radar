// Pure conversions between Supabase rows and the in-memory shapes every page
// and job already uses. Browser-safe and shared with the Node jobs
// (fetch/db.js) and the pages' store (lib/store.js).
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
