// Access check for the v3 platform schema: proves that a caller who is not a
// member gets nothing. Run after applying supabase/v3.sql (Phase 5):
//
//   node supabase/check-access.mjs
//
// By default it calls the API as the anonymous role, with the URL and
// publishable key from config.js (override with SUPABASE_URL /
// SUPABASE_KEY). Set SUPABASE_USER_JWT to the access token of a signed-in
// Google account that is NOT in public.members to repeat every check as an
// authenticated non-member.
//
// Pass:  every table read is refused (401/403) or returns [] (RLS hides
//        every row); every RPC is refused (HTTP 401/403 or code 42501). The
//        RLS helpers may also answer `false` to a non-member.
// Fail:  anything else. A missing table or function (404, PGRST202) is a
//        failure: it means v3.sql is not applied, so nothing was proven.
// Exits 1 on any failure.
import { pathToFileURL } from 'node:url';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const TABLES = ['members', 'listings', 'archive', 'source_status', 'watch',
  'decisions', 'intl_dates', 'manual', 'teams', 'team_members', 'rounds'];

const NOBODY = 'nobody@example.com';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Every function v3.sql creates, with dummy arguments under its real
// parameter names (so a refusal is about privileges, not a name mismatch).
export const RPCS = {
  is_member: {},
  is_admin: {},
  google_emails: {},
  in_team: { p_listing_id: '1' },
  is_self: { p_email: NOBODY },
  replace_team_members: { p_listing_id: '1', p_emails: [NOBODY] },
  create_team: { p_listing_id: '1', p_section: 'case', p_invite_url: 'https://example.com/x', p_emails: [NOBODY] },
  update_team: { p_listing_id: '1', p_invite_url: 'https://example.com/x', p_emails: [NOBODY] },
  delete_team: { p_listing_id: '1' },
  mark_joined: { p_listing_id: '1', p_joined: true },
  upsert_round: { p_id: ZERO_UUID, p_listing_id: '1', p_name: 'x', p_due: '2026-01-01', p_owner_email: null },
  delete_round: { p_id: ZERO_UUID },
  set_round_done: { p_id: ZERO_UUID, p_done: true },
  my_joins: {},
  sync_section: { p_section: 'case', p_rows: [], p_archive: [], p_status: {} },
  set_status: { p_section: 'case', p_status: {} },
};

// A non-member asking "am I a member/admin/in this team/this person?" may get `false`.
const HELPERS = new Set(['is_member', 'is_admin', 'in_team', 'is_self']);

const REFUSED = new Set([401, 403]);

async function call(fetchImpl, url, init) {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: e.message };
  }
}

const short = body => {
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  return s.length > 70 ? `${s.slice(0, 67)}...` : s;
};

export function judgeTable({ status, body }) {
  if (REFUSED.has(status)) return { ok: true, why: `refused ${status}${body?.code ? ` ${body.code}` : ''}` };
  if (status === 200 && Array.isArray(body) && body.length === 0) return { ok: true, why: 'no rows' };
  if (status === 200 && Array.isArray(body)) return { ok: false, why: `LEAK: ${body.length} row(s)` };
  return { ok: false, why: `unexpected ${status}: ${short(body)}` };
}

export function judgeRpc(name, { status, body }) {
  if (body && body.code === '42501') return { ok: true, why: `refused ${status} 42501` };
  if (REFUSED.has(status)) return { ok: true, why: `refused ${status}${body?.code ? ` ${body.code}` : ''}` };
  if (status === 404 || body?.code === 'PGRST202') return { ok: false, why: `missing (${status}${body?.code ? ` ${body.code}` : ''}): is v3.sql applied?` };
  if (HELPERS.has(name) && status === 200 && body === false) return { ok: true, why: 'false' };
  if (status >= 200 && status < 300) return { ok: false, why: `LEAK: ran (${status}) ${short(body)}` };
  return { ok: false, why: `unexpected ${status}: ${short(body)}` };
}

export async function checkAccess({ url, key, jwt = null, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, '');
  const headers = { apikey: key, Accept: 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) };
  const results = [];
  for (const t of TABLES) {
    const r = await call(fetchImpl, `${base}/rest/v1/${t}?select=*&limit=1`, { headers });
    results.push({ kind: 'table', name: t, ...judgeTable(r) });
  }
  for (const [name, args] of Object.entries(RPCS)) {
    const r = await call(fetchImpl, `${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    });
    results.push({ kind: 'rpc', name, ...judgeRpc(name, r) });
  }
  return results;
}

export function formatTable(results, who) {
  const w = Math.max(...results.map(r => r.name.length));
  const lines = [`Access check as ${who}`, ''];
  for (const r of results) lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${r.kind.padEnd(5)}  ${r.name.padEnd(w)}  ${r.why}`);
  const bad = results.filter(r => !r.ok).length;
  lines.push('', bad ? `${bad} of ${results.length} checks FAILED` : `all ${results.length} checks passed`);
  return lines.join('\n');
}

async function main() {
  const url = process.env.SUPABASE_URL || SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || SUPABASE_ANON_KEY;
  const jwt = process.env.SUPABASE_USER_JWT || null;
  if (!url || !key) {
    console.error('check-access: no Supabase URL or publishable key (config.js or SUPABASE_URL / SUPABASE_KEY)');
    return 1;
  }
  const results = await checkAccess({ url, key, jwt });
  console.log(formatTable(results, jwt ? 'an authenticated non-member' : 'anonymous'));
  return results.every(r => r.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
