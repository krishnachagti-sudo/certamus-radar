// The browser's client for the Radar API (api/ on Railway). It offers the
// small query chain lib/store.js was written against (the shape of the
// supabase-js builder the platform started on), so the store stayed as it was:
//
//   client.from('listings').select('data').eq('section', 'case').order('id', { ascending: true }).range(0, 999)
//   client.from('decisions').upsert(row, { onConflict: 'id', ignoreDuplicates: false })
//   client.from('decisions').delete().eq('id', '123')
//   client.rpc('create_team', { p_listing_id: ... })
//
// Every call resolves to { data, error } and never throws; error is
// { message, code, status }. The upsert conflict target is always the
// table's primary key (the API decides; onConflict is accepted and unused).
// Requests carry `Authorization: Bearer <session token>` from getToken().
// A 401 calls onUnauthorized() (the session ended: lib/auth.js goes back to
// the login screen). Browser-safe, no node: imports; `fetch` is injectable.

const asError = (message, code, status = 0) => ({ message, code, status });

export function createClient({ url, getToken = () => null, onUnauthorized = () => {}, fetch: fetchFn } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));

  // Any API path -> { data, error }.
  async function request(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await doFetch(`${base}${path}`, {
        method, headers, cache: 'no-store', credentials: 'omit',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      return { data: null, error: asError(`the server could not be reached (${e.message})`, 'network') };
    }
    let text = '';
    try { text = await res.text(); } catch { /* empty body */ }
    let json = null;
    let unreadable = false;
    if (text) {
      try { json = JSON.parse(text); } catch { unreadable = true; }
    }
    if (!res.ok) {
      if (res.status === 401) {
        try { onUnauthorized(); } catch { /* the caller's problem, not this request's */ }
      }
      const message = json?.message || `HTTP ${res.status}`;
      return { data: null, error: asError(message, json?.code || String(res.status), res.status) };
    }
    if (unreadable) return { data: null, error: asError('unreadable response from the server', 'bad_response', res.status) };
    return { data: json, error: null };
  }

  function from(table) {
    const s = { method: 'GET', columns: '*', filters: [], order: [], range: null, body: undefined, ignore: false };
    const builder = {
      select(columns = '*') { s.columns = columns; return builder; },
      eq(column, value) { s.filters.push([column, value]); return builder; },
      order(column, { ascending = true } = {}) { s.order.push(`${column}.${ascending ? 'asc' : 'desc'}`); return builder; },
      range(fromRow, toRow) { s.range = [fromRow, toRow]; return builder; },
      upsert(rows, { ignoreDuplicates = false } = {}) { s.method = 'POST'; s.body = rows; s.ignore = ignoreDuplicates === true; return builder; },
      delete() { s.method = 'DELETE'; return builder; },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    function run() {
      const p = new URLSearchParams();
      if (s.method === 'GET') {
        p.set('select', s.columns);
        if (s.order.length) p.set('order', s.order.join(','));
        if (s.range) {
          p.set('offset', String(s.range[0]));
          p.set('limit', String(s.range[1] - s.range[0] + 1));
        }
      }
      if (s.method !== 'POST') for (const [c, v] of s.filters) p.append(c, `eq.${v}`);
      if (s.method === 'POST' && s.ignore) p.set('ignore_duplicates', 'true');
      const q = p.toString();
      return request(`/db/${encodeURIComponent(table)}${q ? `?${q}` : ''}`, { method: s.method, body: s.body });
    }
    return builder;
  }

  return {
    from,
    rpc: (name, args = {}) => request(`/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: args ?? {} }),
    request,
  };
}
