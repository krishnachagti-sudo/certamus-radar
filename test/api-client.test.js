// lib/api.js: the supabase-js-shaped chain over the Radar API's URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../lib/api.js';

function fakeFetch(answer = () => ({ status: 200, body: [] })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, body } = answer(url, init) ?? {};
    return new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
}
const client = (fetch, over = {}) => createClient({ url: 'https://api.test/', getToken: () => 'tok', fetch, ...over });

test('select/eq/order/range -> GET /db/<table> with PostgREST-style parameters', async () => {
  const f = fakeFetch(() => ({ body: [{ data: { id: 1 } }] }));
  const r = await client(f).from('listings').select('data').eq('section', 'hack').order('id', { ascending: true }).order('x', { ascending: false }).range(1000, 1999);
  assert.deepEqual(r, { data: [{ data: { id: 1 } }], error: null });
  const { url, init } = f.calls[0];
  assert.equal(url.origin + url.pathname, 'https://api.test/db/listings');
  assert.deepEqual(Object.fromEntries(url.searchParams), { select: 'data', order: 'id.asc,x.desc', offset: '1000', limit: '1000', section: 'eq.hack' });
  assert.equal(init.method, 'GET');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.equal(init.credentials, 'omit');
});

test('upsert -> POST with the rows; ignoreDuplicates -> ignore_duplicates=true', async () => {
  const f = fakeFetch(() => ({ status: 201 }));
  assert.deepEqual(await client(f).from('decisions').upsert({ id: '1', status: 'watching' }, { onConflict: 'id' }), { data: null, error: null });
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].url.search, '');
  assert.deepEqual(f.calls[0].body, { id: '1', status: 'watching' });
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');
  await client(f).from('manual').upsert({ id: '2', url: 'u' }, { onConflict: 'id', ignoreDuplicates: true });
  assert.equal(f.calls[1].url.searchParams.get('ignore_duplicates'), 'true');
});

test('delete().eq() -> DELETE /db/<table>?col=eq.value', async () => {
  const f = fakeFetch(() => ({ status: 204 }));
  assert.deepEqual(await client(f).from('decisions').delete().eq('id', 'a&b'), { data: null, error: null });
  assert.equal(f.calls[0].init.method, 'DELETE');
  assert.equal(f.calls[0].url.searchParams.get('id'), 'eq.a&b');
  assert.equal(f.calls[0].url.searchParams.get('select'), null);
});

test('rpc -> POST /rpc/<fn> with named arguments; a value comes back as data', async () => {
  const f = fakeFetch(() => ({ body: '"5b0c-uuid"' }));
  const r = await client(f).rpc('upsert_round', { p_id: null, p_name: 'R' });
  assert.deepEqual(r, { data: '5b0c-uuid', error: null });
  assert.equal(f.calls[0].url.pathname, '/rpc/upsert_round');
  assert.deepEqual(f.calls[0].body, { p_id: null, p_name: 'R' });
  const v = await client(fakeFetch(() => ({ body: null }))).rpc('mark_joined', {});
  assert.deepEqual(v, { data: null, error: null });
});

test('errors: the server\'s message and code, a 401 calls onUnauthorized, a network failure never throws', async () => {
  const f = fakeFetch(() => ({ status: 403, body: { message: 'forbidden', code: '42501' } }));
  assert.deepEqual((await client(f).rpc('create_team', {})).error, { message: 'forbidden', code: '42501', status: 403 });
  let ended = 0;
  const u = await client(fakeFetch(() => ({ status: 401, body: { message: 'Not signed in', code: 'unauthenticated' } })), { onUnauthorized: () => { ended++; } }).from('x').select();
  assert.equal(u.error.status, 401);
  assert.equal(ended, 1);
  const down = await client(async () => { throw new Error('offline'); }).from('x').select();
  assert.equal(down.error.code, 'network');
  assert.match(down.error.message, /offline/);
  const html = await client(fakeFetch(() => ({ status: 502, body: '<html>bad gateway</html>' }))).from('x').select();
  assert.deepEqual(html.error, { message: 'HTTP 502', code: '502', status: 502 });
  const junk = await client(fakeFetch(() => ({ status: 200, body: '<html>' }))).from('x').select();
  assert.equal(junk.error.code, 'bad_response');
});

test('no token: no Authorization header', async () => {
  const f = fakeFetch();
  await createClient({ url: 'https://api.test', fetch: f }).from('x').select();
  assert.equal(f.calls[0].init.headers.Authorization, undefined);
});

test('the chain works against the real API handlers too (store-style paging)', async () => {
  const { selectAll } = await import('../lib/store.js');
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  const f = fakeFetch(url => {
    const u = new URL(url);
    const off = Number(u.searchParams.get('offset'));
    return { body: rows.slice(off, off + 2) };
  });
  assert.deepEqual(await selectAll(client(f), 'watch', { order: ['id'], pageSize: 2 }), rows);
});
