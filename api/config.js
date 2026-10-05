// The API's configuration, from the environment (Railway variables). Every
// problem is reported at start-up, by name only: values are never printed.

const isLocal = host => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

// An origin exactly as a browser sends it: https (or http on localhost for
// development), no path, no trailing slash.
export function parseOrigin(value) {
  try {
    const u = new URL(String(value).trim());
    const ok = u.protocol === 'https:' || (u.protocol === 'http:' && isLocal(u.hostname));
    if (!ok || u.origin !== String(value).trim()) return null;
    return u.origin;
  } catch { return null; }
}

export function loadConfig(env = process.env) {
  const problems = [];
  const need = name => {
    const v = String(env[name] ?? '').trim();
    if (!v) problems.push(`${name} is missing`);
    return v;
  };
  const databaseUrl = need('DATABASE_URL');
  const googleClientId = need('GOOGLE_CLIENT_ID');
  const googleClientSecret = need('GOOGLE_CLIENT_SECRET');
  const serviceToken = need('RADAR_SERVICE_TOKEN');
  if (serviceToken && serviceToken.length < 32) problems.push('RADAR_SERVICE_TOKEN must be at least 32 characters');
  const apiOrigin = parseOrigin(need('API_ORIGIN'));
  if (env.API_ORIGIN && !apiOrigin) problems.push('API_ORIGIN must be an origin like https://certamus-radar-api.up.railway.app');
  const rawOrigins = need('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean);
  const allowedOrigins = rawOrigins.map(parseOrigin);
  if (allowedOrigins.some(o => !o)) problems.push('ALLOWED_ORIGINS must be comma-separated origins like https://conyso.com');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) problems.push('PORT must be a port number');
  if (problems.length) throw new Error(`API configuration: ${problems.join('; ')}`);
  return {
    databaseUrl, googleClientId, googleClientSecret, serviceToken,
    apiOrigin, allowedOrigins: [...new Set(allowedOrigins)], port,
  };
}
