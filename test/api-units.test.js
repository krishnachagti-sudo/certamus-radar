// The API's pure parts: the SQL builders, Google's claim checks and token
// exchange (fake fetch), configuration, and the pg Pool adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSql, upsertSql, deleteSql, rpcSql, TABLES, RPCS, MAX_LIMIT } from '../api/rest.js';
import { checkClaims, createGoogle, decodeJwtPayload, authUrl, SignInError, TOKEN_URL } from '../api/google.js';
import { loadConfig, parseOrigin } from '../api/config.js';
import { fromPg } from '../api/app.js';
import { poolDb } from '../api/pg.js';

const P = s => new URLSearchParams(s);

test('selectSql: whitelisted columns, eq filters as parameters, order, capped limit', () => {
  const { sql, values } = selectSql('listings', P('select=data&section=eq.hack&order=id.asc,section.desc&offset=2000&limit=5000'));
  assert.equal(sql, `select json_build_object('data', "data") as r from public."listings" where "section" = $1 order by "id" asc, "section" desc limit $2 offset $3`);
  assert.deepEqual(values, ['hack', MAX_LIMIT, 2000]);
  const all = selectSql('members', P(''));
  assert.match(all.sql, /json_build_object\('email', "email", 'name', "name", 'role', "role", 'active', "active"\)/);
  assert.deepEqual(all.values, [1000, 0]);
  assert.deepEqual(selectSql('decisions', P('id=eq.a.b,c')).values[0], 'a.b,c', 'only the first eq. is the operator');
});

test('selectSql refuses anything off the whitelist', () => {
  const bad = (t, q, status = 400) => assert.throws(() => selectSql(t, P(q)), e => e.status === status, `${t}?${q}`);
  bad('nope', '', 404);
  bad('listings', 'select=id,"x"');
  bad('listings', 'select=id) from x--');
  bad('listings', 'id=neq.1');
  bad('listings', 'order=id.asc.nullsfirst');
  bad('listings', 'order=nope.asc');
  bad('listings', 'limit=1e3');
  bad('listings', 'offset=-1');
});

test('upsertSql: the rows\' columns, json cast, update or nothing on the key', () => {
  const { sql, values } = upsertSql('watch', P(''), [{ id: 'a', data: { h: 1 }, updated_at: 'S' }, { updated_at: 'T', id: 'b', data: [1] }]);
  assert.equal(sql, 'insert into public."watch" ("id", "data", "updated_at") values ($1, $2::jsonb, $3), ($4, $5::jsonb, $6)'
    + ' on conflict ("id") do update set "data" = excluded."data", "updated_at" = excluded."updated_at"');
  assert.deepEqual(values, ['a', '{"h":1}', 'S', 'b', '[1]', 'T']);
  for (const rows of [[{ id: 'a', data: {} }, { id: 'b', data: [], updated_at: 'T' }], [{ id: 'a', data: {}, updated_at: 'T' }, { id: 'b', data: [] }], [{ id: 'a', data: {} }, { id: 'b', updated_at: 'T' }]]) {
    assert.throws(() => upsertSql('watch', P(''), rows), e => e.status === 400 && /same columns/.test(e.message), JSON.stringify(rows));
  }
  assert.match(upsertSql('manual', P('ignore_duplicates=true'), { id: '1', url: 'u' }).sql, /on conflict \("id"\) do nothing$/);
  assert.match(upsertSql('decisions', P(''), { id: '1' }).sql, /do nothing$/, 'nothing to update');
  assert.throws(() => upsertSql('decisions', P(''), { id: '1', note: { x: 1 } }), /plain value/);
  assert.throws(() => upsertSql('decisions', P(''), Array.from({ length: 1001 }, (_, i) => ({ id: String(i) }))), /at most 1000/);
  assert.throws(() => upsertSql('decisions', P('ignore_duplicates=yes'), { id: '1' }), /true or false/);
  assert.throws(() => upsertSql('listings', P(''), { section: 'case', id: '1' }), e => e.status === 405);
});

test('deleteSql needs a filter and an allowed table', () => {
  assert.deepEqual(deleteSql('decisions', P('id=eq.7')), { sql: 'delete from public."decisions" where "id" = $1', values: ['7'] });
  assert.throws(() => deleteSql('decisions', P('')), /needs a filter/);
  assert.throws(() => deleteSql('manual', P('id=eq.1')), e => e.status === 405);
});

test('rpcSql: named, typed arguments; missing ones are null; the result shape per function', () => {
  const c = rpcSql('create_team', { p_listing_id: 5, p_section: 'case', p_invite_url: 'https://x', p_emails: ['a@b.c'] });
  assert.equal(c.sql, 'select public."create_team"(p_listing_id => $1::text, p_section => $2::text, p_invite_url => $3::text, p_emails => $4::text[])');
  assert.deepEqual(c.values, ['5', 'case', 'https://x', ['a@b.c']]);
  assert.equal(rpcSql('my_joins', {}).sql, 'select to_json(f) as r from public."my_joins"() f');
  assert.equal(rpcSql('upsert_round', {}).sql.startsWith('select to_json(public."upsert_round"('), true);
  assert.deepEqual(rpcSql('upsert_round', {}).values, [null, null, null, null, null]);
  assert.deepEqual(rpcSql('sync_section', { p_section: 'case', p_rows: [{ id: 1 }], p_archive: [], p_status: {} }).values, ['case', '[{"id":1}]', '[]', '{}']);
  assert.throws(() => rpcSql('is_admin', {}), e => e.status === 404);
  assert.throws(() => rpcSql('mark_joined', { p_joined: 'true' }), /boolean/);
  assert.throws(() => rpcSql('create_team', { p_emails: [1] }), /text\[\]/);
  assert.throws(() => rpcSql('my_joins', []), /object/);
});

test('every whitelisted function exists in db/schema.sql with the same argument names, in order', async () => {
  const fs = await import('node:fs');
  const sql = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  for (const [name, { args }] of Object.entries(RPCS)) {
    const m = new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`).exec(sql);
    assert.ok(m, name);
    const declared = m[1].trim() ? m[1].split(',').map(a => a.trim().split(/\s+/)) : [];
    assert.deepEqual(declared.map(([n, t]) => [n, t]), Object.entries(args), name);
  }
  for (const [name, t] of Object.entries(TABLES)) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${name} \\(`), name);
    for (const c of t.columns) assert.match(sql, new RegExp(`create table if not exists public\\.${name} \\([^;]*\\b${c}\\b`), `${name}.${c}`);
  }
});

// ---- Google -------------------------------------------------------------------------

const NOW = 1_800_000_000;
const good = { iss: 'https://accounts.google.com', aud: 'cid', azp: 'cid', exp: NOW + 3600, iat: NOW, nonce: 'n1', email: 'Krishna@Gmail.com', email_verified: true };
const jwt = claims => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

test('checkClaims: issuer, audience, expiry, nonce and a verified email', () => {
  const ok = c => checkClaims({ ...good, ...c }, { clientId: 'cid', nonce: 'n1', nowS: NOW });
  assert.equal(ok({}), 'krishna@gmail.com');
  assert.equal(ok({ iss: 'accounts.google.com', email_verified: 'true' }), 'krishna@gmail.com');
  for (const [c, why] of [[{ iss: 'https://evil.com' }, /issuer/], [{ aud: 'other' }, /audience/], [{ azp: 'other' }, /authorized party/],
    [{ aud: ['cid', 'x'], azp: undefined }, /authorized party/], [{ exp: NOW }, /expired/], [{ iat: NOW + 3600 }, /future/],
    [{ nonce: 'n2' }, /nonce/], [{ nonce: undefined }, /nonce/], [{ email_verified: false }, /not verified/], [{ email: '' }, /no email/]]) {
    assert.throws(() => ok(c), e => e instanceof SignInError && why.test(e.message), JSON.stringify(c));
  }
  assert.throws(() => checkClaims(good, { clientId: 'cid', nonce: '', nowS: NOW }), /nonce/);
});

test('decodeJwtPayload reads the middle part only', () => {
  assert.deepEqual(decodeJwtPayload(jwt({ a: 1 })), { a: 1 });
  assert.throws(() => decodeJwtPayload('x.y'), SignInError);
  assert.throws(() => decodeJwtPayload('a.!!!.c'), SignInError);
});

test('authUrl: code flow, openid email, S256, select_account', () => {
  const u = new URL(authUrl({ clientId: 'cid', redirectUri: 'https://api/auth/callback', state: 's', nonce: 'n', challenge: 'c' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    client_id: 'cid', redirect_uri: 'https://api/auth/callback', response_type: 'code', scope: 'openid email',
    state: 's', nonce: 'n', code_challenge: 'c', code_challenge_method: 'S256', prompt: 'select_account',
  });
});

test('emailFor posts the code, verifier and secret to the token endpoint and checks the ID token', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id_token: jwt(good) }), { status: 200 }); };
  const g = createGoogle({ clientId: 'cid', clientSecret: 'sec', fetch, now: () => NOW * 1000 });
  assert.equal(await g.emailFor({ code: 'c', verifier: 'v', redirectUri: 'https://api/auth/callback', nonce: 'n1' }), 'krishna@gmail.com');
  assert.equal(calls[0].url, TOKEN_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].init.body)), {
    code: 'c', code_verifier: 'v', client_id: 'cid', client_secret: 'sec', redirect_uri: 'https://api/auth/callback', grant_type: 'authorization_code',
  });
  await assert.rejects(g.emailFor({ code: 'c', verifier: 'v', redirectUri: 'r', nonce: 'other' }), /nonce/);
  const refused = createGoogle({ clientId: 'cid', clientSecret: 'sec', fetch: async () => new Response('{"error":"invalid_grant"}', { status: 400 }) });
  await assert.rejects(refused.emailFor({ code: 'c', verifier: 'v', redirectUri: 'r', nonce: 'n1' }), /invalid_grant/);
  const down = createGoogle({ clientId: 'cid', clientSecret: 'sec', fetch: async () => { throw new Error('ENOTFOUND'); } });
  await assert.rejects(down.emailFor({ code: 'c', verifier: 'v', redirectUri: 'r', nonce: 'n1' }), /unreachable/);
});

// ---- config, errors, pool -------------------------------------------------------------

const ENV = {
  DATABASE_URL: 'postgresql://radar_api:pw@postgres.railway.internal:5432/railway', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec',
  RADAR_SERVICE_TOKEN: 'x'.repeat(40), ALLOWED_ORIGINS: 'https://conyso.com', API_ORIGIN: 'https://certamus-radar-api.up.railway.app',
};

test('loadConfig: everything present and well-formed', () => {
  const c = loadConfig(ENV);
  assert.deepEqual(c.allowedOrigins, ['https://conyso.com']);
  assert.deepEqual(c.returnPathPrefixes, ['/certamus/radar/']);
  assert.deepEqual(loadConfig({ ...ENV, RETURN_PATH_PREFIXES: '/certamus/radar/, /' }).returnPathPrefixes, ['/certamus/radar/', '/']);
  assert.equal(c.apiOrigin, 'https://certamus-radar-api.up.railway.app');
  assert.equal(c.port, 8080);
  assert.equal(loadConfig({ ...ENV, PORT: '3000' }).port, 3000);
});

test('loadConfig names every problem and never prints a value', () => {
  assert.throws(() => loadConfig({}), e => ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RADAR_SERVICE_TOKEN', 'ALLOWED_ORIGINS', 'API_ORIGIN'].every(n => e.message.includes(n)));
  assert.throws(() => loadConfig({ ...ENV, RADAR_SERVICE_TOKEN: 'short-secret-value' }), e => /32 characters/.test(e.message) && !e.message.includes('short-secret-value'));
  assert.throws(() => loadConfig({ ...ENV, ALLOWED_ORIGINS: 'https://conyso.com/certamus/' }), /ALLOWED_ORIGINS/);
  assert.throws(() => loadConfig({ ...ENV, API_ORIGIN: 'http://api.example.com' }), /API_ORIGIN/);
});

test('http origins next to an https API need the explicit dev flag', () => {
  const env = { ...ENV, ALLOWED_ORIGINS: 'https://conyso.com, http://localhost:8080' };
  assert.throws(() => loadConfig(env), /RADAR_DEV_ALLOW_HTTP/);
  assert.deepEqual(loadConfig({ ...env, RADAR_DEV_ALLOW_HTTP: '1' }).allowedOrigins, ['https://conyso.com', 'http://localhost:8080']);
  assert.throws(() => loadConfig({ ...env, RADAR_DEV_ALLOW_HTTP: 'true' }), /RADAR_DEV_ALLOW_HTTP/, 'only 1 counts');
  // A wholly local setup (http API) is development by definition.
  assert.equal(loadConfig({ ...env, API_ORIGIN: 'http://localhost:8099' }).apiOrigin, 'http://localhost:8099');
});

test('RETURN_PATH_PREFIXES: paths that start and end with /, no dot segments', () => {
  for (const bad of ['certamus/', '/certamus', '/a/../b/', '/./', 'https://x/', '/a b/']) {
    assert.throws(() => loadConfig({ ...ENV, RETURN_PATH_PREFIXES: bad }), /RETURN_PATH_PREFIXES/, bad);
  }
});

test('parseOrigin: https, or http on localhost; no paths', () => {
  assert.equal(parseOrigin('https://conyso.com'), 'https://conyso.com');
  assert.equal(parseOrigin('http://localhost:8080'), 'http://localhost:8080');
  assert.equal(parseOrigin('http://conyso.com'), null);
  assert.equal(parseOrigin('https://conyso.com/'), null);
  assert.equal(parseOrigin('nope'), null);
});

test('fromPg: refusals 403, bad input 400 with the message, the rest generic 500', () => {
  assert.deepEqual({ ...fromPg({ code: '42501', message: 'forbidden' }), message: fromPg({ code: '42501', message: 'forbidden' }).message }, { status: 403, code: '42501', message: 'forbidden' });
  assert.equal(fromPg({ code: '22023', message: 'x' }).status, 400);
  assert.equal(fromPg({ code: '23505', message: 'x' }).status, 400);
  assert.equal(fromPg({ code: 'P0001', message: 'x' }).status, 400);
  assert.equal(fromPg({ code: '57014', message: 'x' }).status, 503);
  const e = fromPg({ code: '08006', message: 'connection to 10.0.0.1 failed' });
  assert.equal(e.status, 500);
  assert.equal(e.message, 'Database error');
});

test('poolDb: begin/commit around the work, rollback and drop a broken connection on failure', async () => {
  const log = [];
  let released;
  const client = (failRollback = false) => ({
    query: async sql => { log.push(sql); if (sql === 'boom') throw new Error('boom'); if (sql === 'rollback' && failRollback) throw new Error('gone'); return { rows: [{ ok: 1 }] }; },
    release: arg => { released = arg; },
  });
  let c = client();
  const db = poolDb({ connect: async () => c });
  assert.deepEqual(await db.tx(tx => tx.query('select 1').then(r => r.rows)), [{ ok: 1 }]);
  assert.deepEqual(log, ['begin', 'select 1', 'commit']);
  assert.equal(released, undefined);
  log.length = 0;
  await assert.rejects(db.tx(tx => tx.query('boom')), /boom/);
  assert.deepEqual(log, ['begin', 'boom', 'rollback']);
  c = client(true);
  await assert.rejects(db.tx(tx => tx.query('boom')), /boom/);
  assert.equal(released, true);
});
