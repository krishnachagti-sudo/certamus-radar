// The API end to end: a real node:http server over the real schema (PGlite
// logged in as radar_api, see test/helpers/pg.js) with a fake Google.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb, apiDb } from './helpers/pg.js';
import { createApp, safeReturn, sha256 } from '../api/app.js';

const SITE = 'https://conyso.com';
const PAGE = `${SITE}/certamus/radar/c.html?id=555&s=hack`;
const API = 'https://api.radar.test';
const SERVICE = 'service-token-0123456789abcdef0123456789';
const K = 'krishnachagti@gmail.com', M = 'mate@gmail.com', X = 'stranger@gmail.com';

let pg, server, base, clock = Date.now();
const googleCalls = [];
// The fake Google: a code is the email it signs in, or 'boom'.
const google = {
  authUrl: p => `https://accounts.google.test/auth?${new URLSearchParams(p)}`,
  async emailFor(p) {
    googleCalls.push(p);
    if (p.code === 'boom') throw new Error('token endpoint refused');
    return p.code;
  },
};
const quiet = { warn() {}, error() {}, log() {} };

before(async () => {
  pg = await freshDb();
  await pg.exec(`insert into public.members (email, name, role) values ('${M}', 'Mate', 'member'), ('akshit@gmail.com', 'Akshit', 'member')`);
  const handler = createApp({
    db: apiDb(pg), google, log: quiet, now: () => clock,
    config: { apiOrigin: API, allowedOrigins: [SITE, 'http://localhost:8080'], googleClientSecret: 'g-secret', serviceToken: SERVICE },
  });
  server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));

async function call(path, { method = 'GET', token, body, origin, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (origin) h.Origin = origin;
  if (body !== undefined) h['Content-Type'] = h['Content-Type'] || 'application/json';
  const res = await fetch(`${base}${path}`, {
    method, headers: h, redirect: 'manual',
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

// The whole browser sign-in for `email`: -> { location, token }.
async function signIn(email, page = PAGE) {
  const start = await call(`/auth/google?return=${encodeURIComponent(page)}`);
  assert.equal(start.status, 302);
  const g = new URL(start.headers.get('location'));
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const cb = await call(`/auth/callback?state=${g.searchParams.get('state')}&code=${encodeURIComponent(email)}`, { headers: { Cookie: cookie } });
  assert.equal(cb.status, 302);
  const location = new URL(cb.headers.get('location'));
  const code = location.searchParams.get('radar_code');
  if (!code) return { location };
  const ex = await call('/auth/exchange', { method: 'POST', body: { code }, origin: SITE });
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  return { location, code, token: ex.body.token, expires: ex.body.expires_at };
}

let admin, mate;

// ---- sign-in -----------------------------------------------------------------

test('healthz', async () => {
  assert.deepEqual((await call('/healthz')).body, { ok: true });
});

test('/auth/google refuses a return URL off the allow-list', async () => {
  for (const r of ['https://evil.com/certamus/radar/', 'https://conyso.com.evil.com/', 'javascript:alert(1)', '', 'https://user:pw@conyso.com/']) {
    const res = await call(`/auth/google?return=${encodeURIComponent(r)}`);
    assert.equal(res.status, 400, r);
    assert.equal(res.headers.get('location'), null);
  }
});

test('/auth/google: PKCE S256, state, nonce, and a sealed HttpOnly state cookie for the callback only', async () => {
  const res = await call(`/auth/google?return=${encodeURIComponent(PAGE)}`);
  const g = new URL(res.headers.get('location'));
  assert.equal(g.origin, 'https://accounts.google.test');
  assert.equal(g.searchParams.get('redirectUri'), `${API}/auth/callback`);
  assert.match(g.searchParams.get('state'), /^[A-Za-z0-9_-]{22}$/);
  assert.match(g.searchParams.get('nonce'), /^[A-Za-z0-9_-]{22}$/);
  assert.match(g.searchParams.get('challenge'), /^[A-Za-z0-9_-]{43}$/);
  const c = res.headers.get('set-cookie');
  for (const part of ['radar_oauth=', 'Path=/auth/callback', 'Max-Age=600', 'HttpOnly', 'SameSite=Lax', 'Secure']) assert.ok(c.includes(part), part);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  // Sealed: neither the verifier nor the return URL can be read from it.
  assert.ok(!Buffer.from(c.split(';')[0].split('.')[1], 'base64url').toString().includes('conyso'));
});

test('sign-in: the admin gets a one-time code on the same page (id and s kept), then a 30-day session', async () => {
  googleCalls.length = 0;
  admin = await signIn(K);
  assert.equal(admin.location.origin + admin.location.pathname, `${SITE}/certamus/radar/c.html`);
  assert.equal(admin.location.searchParams.get('id'), '555');
  assert.equal(admin.location.searchParams.get('s'), 'hack');
  assert.match(admin.token, /^[A-Za-z0-9_-]{43}$/);
  const days = (Date.parse(admin.expires) - Date.now()) / 864e5;
  assert.ok(days > 29.9 && days <= 30.01, String(days));
  // Google got the PKCE verifier matching the challenge, and the redirect URI.
  const [gc] = googleCalls;
  assert.equal(gc.redirectUri, `${API}/auth/callback`);
  assert.match(gc.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(gc.nonce);
  mate = await signIn(M);
});

test('the login code works once', async () => {
  const again = await call('/auth/exchange', { method: 'POST', body: { code: admin.code }, origin: SITE });
  assert.equal(again.status, 401);
  assert.equal(again.body.code, 'expired');
  assert.equal((await call('/auth/exchange', { method: 'POST', body: { code: 'x' } })).status, 400);
  assert.equal((await call('/auth/exchange', { method: 'POST', body: {} })).status, 400);
});

test('only hashes are stored', async () => {
  const { rows } = await pg.query('select token_hash from private.sessions');
  assert.ok(rows.some(r => r.token_hash === sha256(admin.token)));
  assert.ok(!rows.some(r => r.token_hash === admin.token));
});

test('a stranger is sent back with radar_error=not_member and no code', async () => {
  const { location } = await signIn(X);
  assert.equal(location.searchParams.get('radar_error'), 'not_member');
  assert.equal(location.searchParams.get('radar_code'), null);
  assert.equal(location.searchParams.get('id'), '555');
});

test('callback: a Google failure, a cancel, or a wrong state comes back as radar_error', async () => {
  const start = await call(`/auth/google?return=${encodeURIComponent(PAGE)}`);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const Cookie = start.headers.get('set-cookie').split(';')[0];
  const err = async q => new URL((await call(`/auth/callback?${q}`, { headers: { Cookie } })).headers.get('location')).searchParams.get('radar_error');
  assert.equal(await err(`state=${state}&code=boom`), 'failed');
  assert.equal(await err(`state=${state}&error=access_denied`), 'cancelled');
  assert.equal(await err(`state=${state}&error=server_error`), 'failed');
  assert.equal(await err(`state=wrong&code=${K}`), 'failed');
  assert.equal(await err(`state=${state}`), 'failed');
  const res = await call(`/auth/callback?state=${state}&code=${K}`, { headers: { Cookie } });
  assert.match(res.headers.get('set-cookie'), /radar_oauth=; Path=\/auth\/callback; Max-Age=0/);
});

test('callback: no cookie, a tampered cookie or an expired one is a plain 400, never a redirect', async () => {
  const start = await call(`/auth/google?return=${encodeURIComponent(PAGE)}`);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const [iv, body, tag] = cookie.slice('radar_oauth='.length).split('.');
  const flipped = Buffer.from(body, 'base64url');
  flipped[0] ^= 1;
  const forged = `${iv}.${flipped.toString('base64url')}.${tag}`;
  for (const c of [undefined, `radar_oauth=${forged}`, 'radar_oauth=junk', 'radar_oauth=a.b.c']) {
    const res = await call(`/auth/callback?state=${state}&code=${K}`, { headers: c ? { Cookie: c } : {} });
    assert.equal(res.status, 400, c);
    assert.equal(res.headers.get('location'), null);
  }
  clock += 601e3;
  try {
    const res = await call(`/auth/callback?state=${state}&code=${K}`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 400, 'expired');
  } finally { clock -= 601e3; }
});

test('safeReturn: allow-listed origins only; old sign-in results dropped', () => {
  const ok = [SITE];
  assert.equal(safeReturn(`${SITE}/certamus/radar/?radar_code=abc&s=hack&radar_error=x#top`, ok), `${SITE}/certamus/radar/?s=hack#top`);
  assert.equal(safeReturn('http://conyso.com/', ok), null);
  assert.equal(safeReturn('not a url', ok), null);
});

test('/auth/me: the caller\'s own row; nothing without a live session', async () => {
  assert.deepEqual((await call('/auth/me', { token: admin.token, origin: SITE })).body, { email: K, name: 'Krishna', role: 'admin', active: true });
  assert.deepEqual((await call('/auth/me', { token: mate.token })).body, { email: M, name: 'Mate', role: 'member', active: true });
  for (const token of [undefined, 'short', 'x'.repeat(43), SERVICE]) {
    const res = await call('/auth/me', { token });
    assert.ok([400, 401].includes(res.status), `${token}: ${res.status}`);
  }
});

// ---- data -------------------------------------------------------------------------

test('PostgREST-lite reads: RLS decides; dates read as dates', async () => {
  const sync = await call('/rpc/sync_section', { method: 'POST', token: SERVICE, body: {
    p_section: 'case', p_rows: [{ id: 555, title: 'Five', regn_close: '2026-10-30' }, { id: 7, title: 'Seven' }], p_archive: [], p_status: { last_ok: 'T' } } });
  assert.deepEqual(sync.body, { archived: 0, upserted: 2, deleted: 0 });
  const rows = await call('/db/listings?select=id,regn_close,data&section=eq.case&order=id.desc', { token: admin.token, origin: SITE });
  assert.equal(rows.status, 200);
  assert.deepEqual(rows.body, [{ id: '7', regn_close: null, data: { id: 7, title: 'Seven' } }, { id: '555', regn_close: '2026-10-30', data: { id: 555, title: 'Five', regn_close: '2026-10-30' } }]);
  assert.equal(rows.headers.get('access-control-allow-origin'), SITE);
  assert.deepEqual((await call('/db/listings', { token: mate.token })).body, [], 'a teammate reads no listings');
  assert.deepEqual((await call('/db/members?select=email&order=email.asc', { token: mate.token })).body, [{ email: M }]);
  assert.equal((await call('/db/members', { token: admin.token })).body.length, 3);
});

test('reads page with offset and limit (limit capped at 1000)', async () => {
  const one = await call('/db/listings?select=id&order=id.asc&offset=1&limit=1', { token: admin.token });
  assert.deepEqual(one.body, [{ id: '7' }]);
  assert.equal((await call('/db/listings?limit=5000', { token: admin.token })).status, 200);
  assert.equal((await call('/db/listings?limit=-1', { token: admin.token })).status, 400);
});

test('reads refuse what is not on the whitelist', async () => {
  const bad = async (path, status = 400) => assert.equal((await call(path, { token: admin.token })).status, status, path);
  await bad('/db/listings?select=data,secret');
  await bad('/db/listings?section=like.c%25');
  await bad('/db/listings?nope=eq.1');
  await bad('/db/listings?order=id.sideways');
  await bad('/db/listings?select=id;drop table x');
  await bad('/db/pg_authid', 404);
  await bad('/db/sessions', 404);
  assert.equal((await call('/rpc/is_admin', { method: 'POST', token: admin.token, body: {} })).status, 404);
  assert.equal((await call('/rpc/replace_team_members', { method: 'POST', token: admin.token, body: {} })).status, 404);
});

test('admin writes decisions: upsert, update, delete', async () => {
  const w = await call('/db/decisions', { method: 'POST', token: admin.token, origin: SITE, body: { id: '555', status: 'entering', registered: true, note: 'go', updated_at: '2026-10-05T00:00:00Z' } });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  await call('/db/decisions', { method: 'POST', token: admin.token, body: { id: '555', status: 'watching', registered: true, note: null } });
  assert.deepEqual((await call('/db/decisions?select=id,status,note&id=eq.555', { token: admin.token })).body, [{ id: '555', status: 'watching', note: null }]);
  assert.equal((await call('/db/decisions?id=eq.555', { method: 'DELETE', token: admin.token })).status, 204);
  assert.deepEqual((await call('/db/decisions?id=eq.555', { token: admin.token })).body, []);
});

test('ignore_duplicates keeps the row that is there', async () => {
  const add = url => call('/db/manual?ignore_duplicates=true', { method: 'POST', token: admin.token, body: { id: '99', url } });
  assert.equal((await add('https://unstop.com/a-99')).status, 201);
  assert.equal((await add('https://unstop.com/b-99')).status, 201);
  assert.deepEqual((await call('/db/manual?select=url', { token: admin.token })).body, [{ url: 'https://unstop.com/a-99' }]);
});

test('a teammate\'s writes are refused by Postgres (403, code 42501)', async () => {
  const w = await call('/db/decisions', { method: 'POST', token: mate.token, body: { id: '1', status: 'watching' } });
  assert.equal(w.status, 403);
  assert.equal(w.body.code, '42501');
  const d = await call('/db/intl_dates?id=eq.intl-a', { method: 'DELETE', token: mate.token });
  assert.equal(d.status, 204, 'RLS: deletes nothing, not an error');
});

test('writes refuse what is not on the whitelist', async () => {
  const post = (path, body) => call(path, { method: 'POST', token: admin.token, body });
  assert.equal((await post('/db/teams', { listing_id: '1', section: 'case', invite_url: 'https://x' })).status, 405);
  assert.equal((await post('/db/decisions', { id: '1', evil: 1 })).status, 400);
  assert.equal((await post('/db/decisions', { status: 'watching' })).status, 400, 'key required');
  assert.equal((await post('/db/decisions', [])).status, 400);
  assert.equal((await post('/db/decisions?on_conflict=note', { id: '1' })).status, 400);
  assert.equal((await call('/db/decisions', { method: 'DELETE', token: admin.token })).status, 400, 'no unfiltered delete');
  assert.equal((await call('/db/listings?id=eq.1', { method: 'DELETE', token: admin.token })).status, 405);
  const check = await post('/db/manual', { id: '5', url: 'https://evil.com/5' });
  assert.equal(check.status, 400);
  assert.equal(check.body.code, '23514');
});

test('RPCs: admin team flow, teammate my_joins and mark_joined; messages pass through', async () => {
  const r = (fn, token, body) => call(`/rpc/${fn}`, { method: 'POST', token, body });
  const bad = await r('create_team', admin.token, { p_listing_id: '555', p_section: 'case', p_invite_url: 'http://x', p_emails: [M] });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { message: 'invite link must be an https:// URL', code: '22023' });
  const ok = await r('create_team', admin.token, { p_listing_id: '555', p_section: 'case', p_invite_url: 'https://unstop.com/i/abc', p_emails: [M, K] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body, null);
  assert.equal((await r('create_team', mate.token, { p_listing_id: '7', p_section: 'case', p_invite_url: 'https://x', p_emails: [M] })).status, 403);
  const rid = await r('upsert_round', admin.token, { p_id: null, p_listing_id: '555', p_name: 'Prelims', p_due: '2026-11-01', p_owner_email: null });
  assert.match(rid.body, /^[0-9a-f-]{36}$/);
  const joins = await r('my_joins', mate.token, {});
  assert.deepEqual(joins.body, [{ listing_id: '555', section: 'case', title: 'Five', regn_close: '2026-10-30', invite_url: 'https://unstop.com/i/abc', joined_at: null }]);
  assert.equal((await r('mark_joined', mate.token, { p_listing_id: '555', p_joined: true })).status, 200);
  assert.ok((await r('my_joins', mate.token, {})).body[0].joined_at);
  assert.equal((await r('set_round_done', mate.token, { p_id: rid.body, p_done: true })).status, 403);
  assert.equal((await r('create_team', admin.token, { p_listing_id: '1', nope: 1 })).status, 400, 'unknown argument');
  assert.equal((await r('mark_joined', mate.token, { p_listing_id: '555', p_joined: 'yes' })).status, 400, 'type');
});

test('the service token: the jobs\' tables and RPCs only', async () => {
  assert.equal((await call('/db/listings?select=id', { token: SERVICE })).body.length, 2);
  for (const t of ['members', 'teams', 'team_members', 'rounds']) {
    const res = await call(`/db/${t}`, { token: SERVICE });
    assert.equal(res.status, 403, t);
  }
  assert.equal((await call('/rpc/create_team', { method: 'POST', token: SERVICE, body: { p_listing_id: '9', p_section: 'case', p_invite_url: 'https://x', p_emails: [K] } })).status, 403);
  assert.equal((await call('/rpc/my_joins', { method: 'POST', token: SERVICE, body: {} })).status, 403);
  assert.equal((await call('/rpc/set_status', { method: 'POST', token: admin.token, body: { p_section: 'case', p_status: {} } })).status, 403, 'not for members');
  const w = await call('/db/watch', { method: 'POST', token: SERVICE, body: [{ id: 'intl-a', data: { hash: 'h' }, updated_at: '2026-10-05T00:00:00Z' }] });
  assert.equal(w.status, 201);
  assert.deepEqual((await call('/db/watch?select=id,data', { token: SERVICE })).body, [{ id: 'intl-a', data: { hash: 'h' } }]);
});

test('no token, or a bogus one, gets 401 everywhere', async () => {
  for (const token of [undefined, 'bogus-token-bogus-token-bogus-token-xx', `${SERVICE}x`]) {
    for (const [path, method, body] of [['/db/listings', 'GET'], ['/db/decisions?id=eq.1', 'DELETE'], ['/rpc/my_joins', 'POST', {}], ['/rpc/sync_section', 'POST', {}]]) {
      const res = await call(path, { token, method, body });
      assert.equal(res.status, 401, `${token} ${method} ${path}`);
      assert.equal(res.body.code, 'unauthenticated');
    }
  }
});

test('CORS: preflight for the site; other origins refused before anything runs', async () => {
  const pre = await call('/db/decisions', { method: 'OPTIONS', origin: SITE, headers: { 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  const evil = await call('/db/decisions', { method: 'OPTIONS', origin: 'https://evil.com' });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const get = await call('/db/listings', { token: admin.token, origin: 'https://evil.com' });
  assert.equal(get.status, 403);
});

test('bodies: JSON only, size-capped', async () => {
  const notJson = await call('/rpc/my_joins', { method: 'POST', token: mate.token, body: 'x', raw: true, headers: { 'Content-Type': 'text/plain' } });
  assert.equal(notJson.status, 415);
  const big = await call('/db/decisions', { method: 'POST', token: admin.token, body: { id: '1', note: 'x'.repeat(1100 * 1024) } });
  assert.equal(big.status, 413);
  const broken = await call('/rpc/my_joins', { method: 'POST', token: mate.token, body: '{', raw: true });
  assert.equal(broken.status, 400);
});

test('an inactive member\'s session stops working at once; sign-out ends a session', async () => {
  await pg.query(`update public.members set active = false where email = $1`, [M]);
  assert.equal((await call('/auth/me', { token: mate.token })).status, 401);
  await pg.query(`update public.members set active = true where email = $1`, [M]);
  assert.equal((await call('/auth/me', { token: mate.token })).status, 200);
  assert.equal((await call('/auth/signout', { method: 'POST', token: mate.token, origin: SITE })).status, 204);
  assert.equal((await call('/auth/me', { token: mate.token })).status, 401);
  assert.equal((await call('/auth/signout', { method: 'POST' })).status, 204, 'no token: nothing to do');
});

test('unknown routes are 404', async () => {
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/db/')).status, 404);
});

