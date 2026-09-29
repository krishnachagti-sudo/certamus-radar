// Read-only access to the Supabase tables for the Actions jobs (fetch, digest).
// Reads are public with the anon key; the jobs never write. getJson is
// injectable for tests: getJson(url, headers) -> parsed JSON.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { decisionsFromRows, intlDatesFromRows, manualFromRows } from '../lib/rows.js';

export async function defaultGetJson(url, headers) {
  const res = await fetch(url, { headers: { ...headers, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const defaultConfig = () => ({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, getJson: defaultGetJson });

export const isConfigured = cfg => Boolean(cfg?.url && cfg?.anonKey);

export async function readTable(cfg, table) {
  if (!isConfigured(cfg)) throw new Error('Supabase not configured');
  const getJson = cfg.getJson || defaultGetJson;
  const rows = await getJson(`${cfg.url.replace(/\/+$/, '')}/rest/v1/${table}?select=*`,
    { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` });
  if (!Array.isArray(rows)) throw new Error(`${table}: unexpected response`);
  return rows;
}

const TABLES = { decisions: ['decisions', decisionsFromRows], manual: ['manual', manualFromRows], intlDates: ['intl_dates', intlDatesFromRows] };

// { configured, decisions, manual, intlDates }, each { value } or { error };
// every error starts with 'Supabase'.
export async function readTables(cfg, names = Object.keys(TABLES)) {
  const out = { configured: isConfigured(cfg) };
  await Promise.all(names.map(async name => {
    const [table, convert] = TABLES[name];
    try { out[name] = { value: convert(await readTable(cfg, table)) }; }
    catch (e) { out[name] = { error: /^Supabase\b/.test(e.message) ? e.message : `Supabase ${e.message}` }; }
  }));
  return out;
}
