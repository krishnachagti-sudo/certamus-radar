// Google sign-in (OpenID Connect authorization-code flow with PKCE), run
// by the API. `fetch` is injectable; nothing touches the network on import.
//
// How the ID token is trusted: the API receives it directly from Google's
// token endpoint (https://oauth2.googleapis.com/token, a TLS connection the
// API opened itself), in exchange for a one-time code plus the client
// secret and the PKCE verifier. OpenID Connect Core 3.1.3.7 allows TLS
// server validation in place of checking the token's signature for exactly
// this case, and Google's own guide says the same. So there is no JWKS
// fetch or JWT library: the payload is decoded and its claims checked (iss,
// aud, azp, exp, iat, nonce, email_verified). A token that arrived any
// other way (from a browser, a URL) is never accepted.

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SKEW_S = 300;

export class SignInError extends Error {}

export function authUrl({ clientId, redirectUri, state, nonce, challenge }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Lets someone signed in to several Google accounts pick the one on the
    // team list (and switch after "Not on the team list").
    prompt: 'select_account',
  }).toString();
  return u.toString();
}

export function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new SignInError('ID token is not a JWT');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new SignInError('ID token payload is unreadable');
  }
}

// The claims of an ID token received straight from the token endpoint ->
// the verified, lowercased email. Throws SignInError otherwise.
export function checkClaims(claims, { clientId, nonce, nowS }) {
  const c = claims && typeof claims === 'object' ? claims : {};
  if (!ISSUERS.has(c.iss)) throw new SignInError('wrong issuer');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(clientId)) throw new SignInError('wrong audience');
  if (aud.length > 1 && c.azp !== clientId) throw new SignInError('wrong authorized party');
  if (c.azp != null && c.azp !== clientId) throw new SignInError('wrong authorized party');
  if (typeof c.exp !== 'number' || c.exp <= nowS) throw new SignInError('ID token expired');
  if (typeof c.iat !== 'number' || c.iat > nowS + SKEW_S) throw new SignInError('ID token issued in the future');
  if (!nonce || c.nonce !== nonce) throw new SignInError('nonce mismatch');
  if (c.email_verified !== true && c.email_verified !== 'true') throw new SignInError('email not verified by Google');
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) throw new SignInError('no email in ID token');
  return email;
}

export function createGoogle({ clientId, clientSecret, fetch: fetchFn = globalThis.fetch, now = () => Date.now(), timeoutMs = 15000 }) {
  return {
    authUrl: ({ redirectUri, state, nonce, challenge }) => authUrl({ clientId, redirectUri, state, nonce, challenge }),

    // The one-time code from the callback -> the verified email.
    async emailFor({ code, verifier, redirectUri, nonce }) {
      let res;
      try {
        res = await fetchFn(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({
            code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret,
            redirect_uri: redirectUri, grant_type: 'authorization_code',
          }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new SignInError(`token endpoint unreachable: ${e.message}`);
      }
      let body = null;
      try { body = await res.json(); } catch { /* checked below */ }
      if (!res.ok) throw new SignInError(`token endpoint refused: ${res.status} ${body?.error || ''}`.trim());
      if (!body?.id_token) throw new SignInError('no ID token in the token response');
      return checkClaims(decodeJwtPayload(body.id_token), { clientId, nonce, nowS: Math.floor(now() / 1000) });
    },
  };
}
