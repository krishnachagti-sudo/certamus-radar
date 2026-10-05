// The Radar API's request handler (Resolution 22). node:http only, no
// framework. Everything it talks to is injected, so the tests run it
// against PGlite and a fake Google:
//   db      { tx(fn) }: runs fn({ query(sql, params) -> { rows } }) in one
//           transaction on a connection logged in as radar_api
//   google  { authUrl({ redirectUri, state, nonce, challenge }),
//             emailFor({ code, verifier, redirectUri, nonce }) -> email }
//   config  from api/config.js
//
// Routes:
//   GET  /healthz
//   GET  /auth/google?return=<page url>   -> Google (PKCE + state + nonce)
//   GET  /auth/callback                   -> <page url>?radar_code=... (or ?radar_error=...)
//   POST /auth/exchange {code}            -> { token, expires_at }
//   GET  /auth/me                         -> the caller's members row
//   POST /auth/signout                    -> 204, session deleted
//   GET|POST|DELETE /db/<table>           -> api/rest.js
//   POST /rpc/<fn>                        -> api/rest.js
//
// Who a request runs as: `Authorization: Bearer <token>`. The service token
// (RADAR_SERVICE_TOKEN, compared in constant time) runs as radar_service.
// Any other token is looked up by its sha256 in private.sessions; a live
// session of an active member runs as radar_member with app.email set to
// that session's email, all inside one transaction. Postgres then decides
// every row (db/schema.sql).
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequest, selectSql, upsertSql, deleteSql, rpcSql } from './rest.js';

const STATE_COOKIE = 'radar_oauth';
const STATE_TTL_S = 600;
const MEMBER_BODY_LIMIT = 1024 * 1024;
const SERVICE_BODY_LIMIT = 16 * 1024 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
// The page reads these back (lib/auth.js); no free text goes in a URL.
export const SIGN_IN_ERRORS = ['not_member', 'cancelled', 'expired', 'failed'];

export const sha256 = s => createHash('sha256').update(String(s)).digest('hex');
const b64url = buf => Buffer.from(buf).toString('base64url');
export const newToken = () => b64url(randomBytes(32));

function sameSecret(a, b) {
  // Hash both sides first: equal lengths for timingSafeEqual, and the
  // comparison time says nothing about the secret's length.
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Postgres error -> HTTP. Refusals and bad input keep their message (it is
// what the page shows); anything else is logged and reported generically.
export function fromPg(e) {
  const code = String(e?.code || '');
  if (code === '42501') return new HttpError(403, e.message, code);
  if (/^(22|23)/.test(code) || code === 'P0001') return new HttpError(400, e.message, code);
  if (code === '57014') return new HttpError(503, 'The database took too long', code);
  return new HttpError(500, 'Database error', code || 'internal');
}

// A return URL on one of the site's origins, minus any old sign-in result.
export function safeReturn(value, allowedOrigins) {
  let u;
  try { u = new URL(String(value)); } catch { return null; }
  if (!allowedOrigins.includes(u.origin) || u.username || u.password) return null;
  u.searchParams.delete('radar_code');
  u.searchParams.delete('radar_error');
  return u.toString();
}

export function withParam(url, name, value) {
  const u = new URL(url);
  u.searchParams.set(name, value);
  return u.toString();
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function createApp({ db, google, config, now = () => Date.now(), log = console }) {
  const allowed = config.allowedOrigins;
  const redirectUri = `${config.apiOrigin}/auth/callback`;
  const secureCookie = config.apiOrigin.startsWith('https:');
  // The state cookie (state, nonce, PKCE verifier, return URL, expiry) is
  // sealed with AES-256-GCM: unreadable and tamper-evident in the browser.
  // Its key is derived from a secret the API already has, so there is no
  // extra variable to manage, and is used for nothing else.
  const stateKey = Buffer.from(hkdfSync('sha256', config.googleClientSecret, 'certamus-radar', 'oauth state cookie v1', 32));

  const seal = payload => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', stateKey, iv);
    const body = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
    return [iv, body, c.getAuthTag()].map(b64url).join('.');
  };
  const unseal = cookie => {
    try {
      const [iv, body, tag] = String(cookie || '').split('.').map(p => Buffer.from(p, 'base64url'));
      if (!iv || iv.length !== 12 || !tag || tag.length !== 16) return null;
      const d = createDecipheriv('aes-256-gcm', stateKey, iv);
      d.setAuthTag(tag);
      const p = JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
      return p && typeof p.e === 'number' && p.e > now() / 1000 ? p : null;
    } catch { return null; }
  };
  const stateCookie = (value, maxAge) => [
    `${STATE_COOKIE}=${value}`, 'Path=/auth/callback', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax',
    ...(secureCookie ? ['Secure'] : []),
  ].join('; ');

  // ---- responses -------------------------------------------------------------

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }
  function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (body === undefined) return res.end();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(body));
  }
  function redirect(res, location, cookie) {
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.end();
  }
  function page(res, status, text, cookie) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.end(text);
  }

  async function readJson(req, limit) {
    const type = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(type)) throw new HttpError(415, 'Content-Type must be application/json', 'unsupported_media_type');
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, 'Request body too large', 'too_large');
      chunks.push(c);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return null;
    try { return JSON.parse(text); } catch { throw new HttpError(400, 'Request body is not valid JSON', 'bad_json'); }
  }

  // ---- who is calling --------------------------------------------------------

  function bearer(req) {
    const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
    return m ? m[1] : null;
  }
  // { service: true } | { hash } ; throws 401 without a usable token.
  function caller(req) {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Not signed in', 'unauthenticated');
    if (sameSecret(token, config.serviceToken)) return { service: true };
    if (!TOKEN_RE.test(token)) throw new HttpError(401, 'Not signed in', 'unauthenticated');
    return { hash: sha256(token) };
  }

  // Runs fn(query, who) in one transaction as the caller's database role.
  function asCaller(who, fn) {
    return db.tx(async tx => {
      await tx.query("set local statement_timeout = '20s'");
      if (who.service) {
        await tx.query('set local role radar_service');
        return fn(tx, who);
      }
      const { rows } = await tx.query('select private.session_email($1) as email', [who.hash]);
      const email = rows[0]?.email;
      if (!email) throw new HttpError(401, 'Not signed in', 'unauthenticated');
      await tx.query('set local role radar_member');
      await tx.query("select set_config('app.email', $1, true)", [email]);
      return fn(tx, { ...who, email });
    });
  }

  // ---- sign-in ---------------------------------------------------------------

  function startSignIn(req, res, url) {
    const ret = safeReturn(url.searchParams.get('return'), allowed);
    if (!ret) return page(res, 400, 'This sign-in link is not valid. Go back to Certamus Radar and press "Sign in with Google" again.');
    const state = b64url(randomBytes(16));
    const nonce = b64url(randomBytes(16));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const cookie = seal({ s: state, n: nonce, v: verifier, r: ret, e: Math.floor(now() / 1000) + STATE_TTL_S });
    return redirect(res, google.authUrl({ redirectUri, state, nonce, challenge }), stateCookie(cookie, STATE_TTL_S));
  }

  async function finishSignIn(req, res, url) {
    const clear = stateCookie('', 0);
    const st = unseal(parseCookies(req.headers.cookie)[STATE_COOKIE]);
    // No valid cookie: we do not know where to send them back, and must not guess.
    if (!st || !safeReturn(st.r, allowed)) {
      return page(res, 400, 'This sign-in took too long or was started elsewhere. Go back to Certamus Radar and sign in again.', clear);
    }
    const back = reason => redirect(res, withParam(st.r, 'radar_error', reason), clear);
    const state = url.searchParams.get('state');
    if (!state || !sameSecret(state, st.s)) return back('failed');
    const gErr = url.searchParams.get('error');
    if (gErr) return back(gErr === 'access_denied' ? 'cancelled' : 'failed');
    const code = url.searchParams.get('code');
    if (!code) return back('failed');

    let email;
    try {
      email = await google.emailFor({ code, verifier: st.v, redirectUri, nonce: st.n });
    } catch (e) {
      log.warn(`sign-in: Google step failed: ${e.message}`);
      return back('failed');
    }
    const loginCode = newToken();
    let issued;
    try {
      const { rows } = await db.tx(tx => tx.query('select private.issue_login_code($1, $2) as ok', [email, sha256(loginCode)]));
      issued = rows[0]?.ok === true;
    } catch (e) {
      log.error(`sign-in: could not issue a login code: ${e.code || ''} ${e.message}`);
      return back('failed');
    }
    if (!issued) return back('not_member');
    return redirect(res, withParam(st.r, 'radar_code', loginCode), clear);
  }

  async function exchange(req, res) {
    const body = await readJson(req, 4096);
    const code = body?.code;
    if (typeof code !== 'string' || !TOKEN_RE.test(code)) throw new HttpError(400, 'Missing or malformed sign-in code', 'bad_request');
    const token = newToken();
    const { rows } = await db.tx(tx => tx.query('select email, expires_at from private.exchange_login_code($1, $2)', [sha256(code), sha256(token)]));
    if (!rows.length) throw new HttpError(401, 'This sign-in code has expired or was already used. Sign in again.', 'expired');
    const exp = rows[0].expires_at;
    return send(res, 200, { token, expires_at: exp instanceof Date ? exp.toISOString() : String(exp) });
  }

  async function me(req, res) {
    const who = caller(req);
    if (who.service) throw new HttpError(400, 'The service token has no member row', 'bad_request');
    const row = await asCaller(who, async (tx, w) => {
      const { rows } = await tx.query(
        "select json_build_object('email', email, 'name', name, 'role', role, 'active', active) as r from public.members where email = $1",
        [w.email]);
      return rows[0]?.r ?? null;
    });
    if (!row) throw new HttpError(401, 'Not signed in', 'unauthenticated');
    return send(res, 200, row);
  }

  async function signOut(req, res) {
    const token = bearer(req);
    if (token && TOKEN_RE.test(token) && !sameSecret(token, config.serviceToken)) {
      await db.tx(tx => tx.query('select private.end_session($1)', [sha256(token)]));
    }
    return send(res, 204);
  }

  // ---- data ------------------------------------------------------------------

  async function data(req, res, url, table) {
    const who = caller(req);
    const params = url.searchParams;
    if (req.method === 'GET') {
      const { sql, values } = selectSql(table, params);
      const rows = await asCaller(who, tx => tx.query(sql, values).then(r => r.rows));
      return send(res, 200, rows.map(r => r.r));
    }
    if (req.method === 'POST') {
      const body = await readJson(req, who.service ? SERVICE_BODY_LIMIT : MEMBER_BODY_LIMIT);
      const { sql, values } = upsertSql(table, params, body);
      await asCaller(who, tx => tx.query(sql, values));
      return send(res, 201);
    }
    if (req.method === 'DELETE') {
      const { sql, values } = deleteSql(table, params);
      await asCaller(who, tx => tx.query(sql, values));
      return send(res, 204);
    }
    throw new HttpError(405, 'Method not allowed', 'method_not_allowed');
  }

  async function rpc(req, res, name) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed', 'method_not_allowed');
    const who = caller(req);
    const body = await readJson(req, who.service ? SERVICE_BODY_LIMIT : MEMBER_BODY_LIMIT);
    const { sql, values, returns } = rpcSql(name, body);
    const rows = await asCaller(who, tx => tx.query(sql, values).then(r => r.rows));
    if (returns === 'set') return send(res, 200, rows.map(r => r.r));
    if (returns === 'scalar') return send(res, 200, rows[0]?.r ?? null);
    return send(res, 200, null);
  }

  // ---- routing ---------------------------------------------------------------

  return async function handle(req, res) {
    let url;
    try { url = new URL(req.url, config.apiOrigin); } catch { return send(res, 400, { message: 'Bad URL', code: 'bad_request' }); }
    const path = url.pathname;
    try {
      cors(req, res);
      const origin = req.headers.origin;
      const apiCall = path.startsWith('/db/') || path.startsWith('/rpc/') || ['/auth/exchange', '/auth/me', '/auth/signout'].includes(path);
      if (apiCall && origin && !allowed.includes(origin)) throw new HttpError(403, 'Origin not allowed', 'origin_not_allowed');
      if (req.method === 'OPTIONS') {
        if (!apiCall || !origin) return send(res, 204);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        return send(res, 204);
      }
      if (path === '/healthz' && req.method === 'GET') {
        await db.tx(tx => tx.query('select 1'));
        return send(res, 200, { ok: true });
      }
      if (path === '/auth/google' && req.method === 'GET') return startSignIn(req, res, url);
      if (path === '/auth/callback' && req.method === 'GET') return await finishSignIn(req, res, url);
      if (path === '/auth/exchange' && req.method === 'POST') return await exchange(req, res);
      if (path === '/auth/me' && req.method === 'GET') return await me(req, res);
      if (path === '/auth/signout' && req.method === 'POST') return await signOut(req, res);
      let m = /^\/db\/([a-z_]+)$/.exec(path);
      if (m) return await data(req, res, url, m[1]);
      m = /^\/rpc\/([a-z_]+)$/.exec(path);
      if (m) return await rpc(req, res, m[1]);
      throw new HttpError(404, 'Not found', 'not_found');
    } catch (e) {
      const err = e instanceof HttpError || e instanceof BadRequest ? e : e?.code ? fromPg(e) : new HttpError(500, 'Internal error', 'internal');
      if (err.status >= 500) log.error(`${req.method} ${path}: ${e?.code || ''} ${e?.message || e}`);
      if (res.headersSent) return res.end();
      if (path === '/healthz') return send(res, 503, { ok: false });
      return send(res, err.status, { message: err.message, code: err.code });
    }
  };
}
