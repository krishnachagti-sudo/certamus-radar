// The scheduled jobs' client for the Radar API (fetch/run.js, fetch/hack-run.js,
// fetch/watch.js via fetch/job.js on the Railway cron services, and
// db/seed.mjs). Every read and write carries the service token
// (RADAR_SERVICE_TOKEN, a variable on each cron service with the same value
// as the API service's) as a Bearer token, and the API runs it as the
// radar_service database role. The API's address comes from RADAR_API_URL.
// `fetch` is injectable for tests; nothing here touches the network on import.
import { decisionsFromRows, intlDatesFromRows, manualFromRows } from '../lib/rows.js';

const SECTIONS = new Set(['case', 'hack']);
const PAGE_SIZE = 1000; // the API's largest page (api/rest.js MAX_LIMIT)

const checkSection = section => {
  if (!SECTIONS.has(section)) throw new Error(`API: section must be case or hack, got ${section}`);
};

// A failed response -> 'API <what>: HTTP <status> <code> <message>'.
async function failure(what, res) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = [j.code, j.message].filter(Boolean).join(' ') || text;
    } catch { detail = text; }
  } catch { /* no body */ }
  return new Error(`API ${what}: HTTP ${res.status}${detail ? ` ${String(detail).slice(0, 500)}` : ''}`);
}

export function createDb({ env = process.env, url = env.RADAR_API_URL, key = env.RADAR_SERVICE_TOKEN,
  fetch: fetchFn = globalThis.fetch, pageSize = PAGE_SIZE, timeoutMs = 30000 } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const configured = Boolean(base && key);

  async function request(what, path, { method = 'GET', body } = {}) {
    if (!configured) throw new Error('API not configured (RADAR_API_URL or RADAR_SERVICE_TOKEN missing)');
    const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchFn(`${base}${path}`, {
        method, headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(`API ${what}: ${e.message}`);
    }
    if (!res.ok) throw await failure(what, res);
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { throw new Error(`API ${what}: unparseable response`); }
  }

  // Every row of a table/query in a stable order, page by page until an
  // empty page. Not "until a short page": if the server caps rows below
  // pageSize (the API's cap), a short page is not the end, and a
  // truncated read would make the fetcher close and delete real records.
  async function readAll(what, table, params) {
    const out = [];
    for (;;) {
      const q = new URLSearchParams({ ...params, limit: String(pageSize), offset: String(out.length) });
      const rows = await request(what, `/db/${table}?${q}`);
      if (!Array.isArray(rows)) throw new Error(`API ${what}: unexpected response`);
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
      const rows = await request(`source_status (${section})`, `/db/source_status?${new URLSearchParams({ select: 'data', section: `eq.${section}` })}`);
      if (!Array.isArray(rows)) throw new Error(`API source_status (${section}): unexpected response`);
      return rows[0]?.data ?? null;
    },

    // The one write of a successful run (see sync_section in db/schema.sql):
    // archive entries, upsert rows, delete the section's rows not in `rows`,
    // record the status, in one transaction.
    syncSection(section, rows, archive, status) {
      checkSection(section);
      return request(`sync_section (${section})`, '/rpc/sync_section',
        { method: 'POST', body: { p_section: section, p_rows: rows, p_archive: archive, p_status: status } });
    },

    async setStatus(section, status) {
      checkSection(section);
      await request(`set_status (${section})`, '/rpc/set_status',
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
      await request('watch upsert', '/db/watch', {
        method: 'POST',
        body: rows.map(({ id, data }) => ({ id, data, updated_at: stamp })),
      });
    },
  };
}

const TABLES = { decisions: ['decisions', decisionsFromRows], manual: ['manual', manualFromRows], intlDates: ['intl_dates', intlDatesFromRows] };

// { decisions, manual, intlDates }, each { value } (the in-memory shape the
// jobs and pages use) or { error } (always starting 'API').
export async function readTables(db, names = Object.keys(TABLES)) {
  const out = {};
  await Promise.all(names.map(async name => {
    const [table, convert] = TABLES[name];
    try { out[name] = { value: convert(await db.readTable(table)) }; }
    catch (e) { out[name] = { error: /^API\b/.test(e.message) ? e.message : `API ${e.message}` }; }
  }));
  return out;
}
