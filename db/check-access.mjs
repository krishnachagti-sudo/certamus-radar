// Access check against the deployed API: proves that a caller without a
// session gets nothing. Run after the API is deployed and db/schema.sql is
// applied (HANDOFF.md):
//
//   RADAR_API_URL=https://<api origin> node db/check-access.mjs
//
// For every whitelisted table (GET /db/<t>) and function (POST /rpc/<fn>,
// with dummy arguments under their real names), twice: with no token, and
// with a made-up bearer token. Also /auth/me.
//
// Pass:  401 (or 403) every time.
// Fail:  anything else. A 2xx is a leak; a 404 means the route or the
//        deployment is not what this repo says, so nothing was proven.
// Exits 1 on any failure.
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { TABLES as TABLE_SPEC, RPCS as RPC_SPEC } from '../api/rest.js';

export const TABLES = Object.keys(TABLE_SPEC);

const NOBODY = 'nobody@example.com';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const DUMMY = { text: '1', uuid: ZERO_UUID, date: '2026-01-01', boolean: true, 'text[]': [NOBODY], jsonb: {} };
const dummyArgs = args => Object.fromEntries(Object.entries(args).map(([k, t]) => [k, DUMMY[t]]));
export const RPCS = Object.fromEntries(Object.entries(RPC_SPEC).map(([name, { args }]) => [name, dummyArgs(args)]));

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

export function judge({ status, body }) {
  if (REFUSED.has(status)) return { ok: true, why: `refused ${status}${body?.code ? ` ${body.code}` : ''}` };
  if (status === 404) return { ok: false, why: `missing (404): is this deployment the current api/?` };
  if (status >= 200 && status < 300) return { ok: false, why: `LEAK: ${status} ${short(body)}` };
  return { ok: false, why: `unexpected ${status}: ${short(body)}` };
}

export async function checkAccess({ url, fetchImpl = fetch, bogus = randomBytes(32).toString('base64url') }) {
  const base = url.replace(/\/+$/, '');
  const results = [];
  for (const [who, token] of [['no token', null], ['bogus token', bogus]]) {
    const headers = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    for (const t of TABLES) {
      results.push({ who, kind: 'table', name: t, ...judge(await call(fetchImpl, `${base}/db/${t}?limit=1`, { headers })) });
    }
    for (const [name, args] of Object.entries(RPCS)) {
      const r = await call(fetchImpl, `${base}/rpc/${name}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
      });
      results.push({ who, kind: 'rpc', name, ...judge(r) });
    }
    results.push({ who, kind: 'auth', name: 'me', ...judge(await call(fetchImpl, `${base}/auth/me`, { headers })) });
  }
  return results;
}

export function formatTable(results) {
  const w = Math.max(...results.map(r => r.name.length));
  const lines = ['Access check (no session)', ''];
  for (const r of results) lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${r.who.padEnd(11)}  ${r.kind.padEnd(5)}  ${r.name.padEnd(w)}  ${r.why}`);
  const bad = results.filter(r => !r.ok).length;
  lines.push('', bad ? `${bad} of ${results.length} checks FAILED` : `all ${results.length} checks passed`);
  return lines.join('\n');
}

async function main() {
  const url = process.env.RADAR_API_URL;
  if (!url) {
    console.error('check-access: set RADAR_API_URL to the API origin');
    return 1;
  }
  const results = await checkAccess({ url });
  console.log(formatTable(results));
  return results.every(r => r.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
