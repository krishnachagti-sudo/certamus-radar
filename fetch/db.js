// Supabase REST client for the Actions jobs (fetch/run.js, fetch/hack-run.js,
// fetch/watch.js). Every read and write uses the service key
// (SUPABASE_SERVICE_KEY): the tables have no anon access at all. `fetch` is
// injectable for tests; nothing here touches the network on import.
//
// Key headers: the new `sb_secret_...` keys go in `apikey` only (they are not
// JWTs, and the gateway rejects them as a Bearer token); a legacy JWT
// service_role key goes in both `apikey` and `Authorization: Bearer`.
import { SUPABASE_URL } from '../config.js';
import { decisionsFromRows, intlDatesFromRows, manualFromRows } from '../lib/rows.js';

const SECTIONS = new Set(['case', 'hack']);
const PAGE_SIZE = 1000; // PostgREST's default max-rows on Supabase

export const isJwt = key => /^[^.\s]+\.[^.\s]+\.[^.\s]+$/.test(String(key || ''));

export const authHeaders = key => (isJwt(key) ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key });

const checkSection = section => {
  if (!SECTIONS.has(section)) throw new Error(`Supabase: section must be case or hack, got ${section}`);
};

// A failed response -> 'Supabase <what>: HTTP <status> <code> <message>'.
async function failure(what, res) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = [j.code, j.message, j.details, j.hint].filter(Boolean).join(' ') || text;
    } catch { detail = text; }
  } catch { /* no body */ }
  return new Error(`Supabase ${what}: HTTP ${res.status}${detail ? ` ${String(detail).slice(0, 500)}` : ''}`);
}

export function createDb({ env = process.env, url = env.SUPABASE_URL || SUPABASE_URL, key = env.SUPABASE_SERVICE_KEY,
  fetch: fetchFn = globalThis.fetch, pageSize = PAGE_SIZE, timeoutMs = 30000 } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const configured = Boolean(base && key);

  async function request(what, path, { method = 'GET', body, prefer } = {}) {
    if (!configured) throw new Error('Supabase not configured (SUPABASE_SERVICE_KEY missing)');
    const headers = { ...authHeaders(key), Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    let res;
    try {
      res = await fetchFn(`${base}${path}`, {
        method, headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(`Supabase ${what}: ${e.message}`);
    }
    if (!res.ok) throw await failure(what, res);
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { throw new Error(`Supabase ${what}: unparseable response`); }
  }

  // Every row of a table/query in a stable order, page by page until an
  // empty page. Not "until a short page": if the server caps rows below
  // pageSize (PostgREST max-rows), a short page is not the end, and a
  // truncated read would make the fetcher close and delete real records.
  async function readAll(what, table, params) {
    const out = [];
    for (;;) {
      const q = new URLSearchParams({ ...params, limit: String(pageSize), offset: String(out.length) });
      const rows = await request(what, `/rest/v1/${table}?${q}`);
      if (!Array.isArray(rows)) throw new Error(`Supabase ${what}: unexpected response`);
      if (!rows.length) return out;
      out.push(...rows);
    }
  }

  return {
    configured,

    // A section's live records (the `data` of each listings row).
    async readListings(section) {
      checkSection(section);
      const rows = await readAll(`listings (${section})`, 'listings', { select: 'data', section: `eq.${section}`, order: 'id.asc' });
      return rows.map(r => r.data);
    },

    // Raw rows of a whole table (decisions, manual, intl_dates...).
    readTable(name, { order = 'id.asc' } = {}) {
      return readAll(name, name, { select: '*', order });
    },

    // The section's last recorded status object, or null if none.
    async readStatus(section) {
      checkSection(section);
      const rows = await request(`source_status (${section})`, `/rest/v1/source_status?${new URLSearchParams({ select: 'data', section: `eq.${section}` })}`);
      if (!Array.isArray(rows)) throw new Error(`Supabase source_status (${section}): unexpected response`);
      return rows[0]?.data ?? null;
    },

    // The one write of a successful run (see sync_section in supabase/v3.sql):
    // archive entries, upsert rows, delete the section's rows not in `rows`,
    // record the status, in one transaction.
    syncSection(section, rows, archive, status) {
      checkSection(section);
      return request(`sync_section (${section})`, '/rest/v1/rpc/sync_section',
        { method: 'POST', body: { p_section: section, p_rows: rows, p_archive: archive, p_status: status } });
    },

    async setStatus(section, status) {
      checkSection(section);
      await request(`set_status (${section})`, '/rest/v1/rpc/set_status',
        { method: 'POST', body: { p_section: section, p_status: status } });
    },

    // { [id]: data } for every watch row.
    async readWatch() {
      const rows = await readAll('watch', 'watch', { select: 'id,data', order: 'id.asc' });
      return Object.fromEntries(rows.map(r => [r.id, r.data]));
    },

    // rows: [{ id, data }]; inserts new ids, overwrites existing ones.
    async upsertWatch(rows) {
      if (!rows.length) return;
      const stamp = new Date().toISOString();
      await request('watch upsert', '/rest/v1/watch', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: rows.map(({ id, data }) => ({ id, data, updated_at: stamp })),
      });
    },
  };
}

const TABLES = { decisions: ['decisions', decisionsFromRows], manual: ['manual', manualFromRows], intlDates: ['intl_dates', intlDatesFromRows] };

// { decisions, manual, intlDates }, each { value } (the in-memory shape the
// jobs and pages use) or { error } (always starting 'Supabase').
export async function readTables(db, names = Object.keys(TABLES)) {
  const out = {};
  await Promise.all(names.map(async name => {
    const [table, convert] = TABLES[name];
    try { out[name] = { value: convert(await db.readTable(table)) }; }
    catch (e) { out[name] = { error: /^Supabase\b/.test(e.message) ? e.message : `Supabase ${e.message}` }; }
  }));
  return out;
}
