import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, authHeaders, isJwt, readTables } from '../fetch/db.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln';
const SECRET = 'sb_secret_abcDEF123';

// Fake fetch: `answer(url, init)` returns { status, body } (body is JSON-encoded
// unless it is a string). Every call is recorded.
function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, body = [] } = (await answer(url, init)) ?? {};
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  fn.calls = calls;
  return fn;
}
// A table read honouring limit/offset (reads page until an empty page).
const page = (url, rows) => {
  const u = new URL(url);
  const off = Number(u.searchParams.get('offset') || 0);
  return rows.slice(off, off + Number(u.searchParams.get('limit') || rows.length));
};
const db = (fetch, over = {}) => createDb({ url: 'https://abc.supabase.co/', key: SECRET, fetch, ...over });

test('isJwt: three dot-separated segments', () => {
  assert.equal(isJwt(JWT), true);
  assert.equal(isJwt(SECRET), false);
  assert.equal(isJwt('a.b'), false);
  assert.equal(isJwt(''), false);
});

test('an sb_secret_ key goes in apikey only; a JWT also goes in Authorization', () => {
  assert.deepEqual(authHeaders(SECRET), { apikey: SECRET });
  assert.deepEqual(authHeaders(JWT), { apikey: JWT, Authorization: `Bearer ${JWT}` });
});

test('requests carry the key headers', async () => {
  for (const key of [SECRET, JWT]) {
    const f = fakeFetch(() => ({ body: [] }));
    await db(f, { key }).readTable('decisions');
    const h = f.calls[0].init.headers;
    assert.equal(h.apikey, key);
    assert.equal(h.Authorization, isJwt(key) ? `Bearer ${key}` : undefined);
  }
});

test('config comes from the environment, URL falling back to config.js', async () => {
  const f = fakeFetch(() => ({ body: [] }));
  const d = createDb({ env: { SUPABASE_SERVICE_KEY: SECRET }, fetch: f });
  assert.equal(d.configured, true);
  await d.readTable('manual');
  assert.match(f.calls[0].url, /^https:\/\/hjgfowgswqafrhlqbuse\.supabase\.co\/rest\/v1\/manual\?/);
  const d2 = createDb({ env: { SUPABASE_URL: 'https://other.supabase.co', SUPABASE_SERVICE_KEY: SECRET }, fetch: f });
  await d2.readTable('manual');
  assert.match(f.calls[1].url, /^https:\/\/other\.supabase\.co\/rest\/v1\/manual\?/);
});

test('no service key: not configured, every call throws without fetching', async () => {
  const f = fakeFetch(() => ({ body: [] }));
  const d = createDb({ env: {}, fetch: f });
  assert.equal(d.configured, false);
  await assert.rejects(d.readListings('case'), /Supabase not configured/);
  await assert.rejects(d.syncSection('case', [{ id: 1 }], [], {}), /Supabase not configured/);
  assert.equal(f.calls.length, 0);
});

test('readListings pages with limit/offset until an empty page, filtered by section', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ data: { id: i + 1 } }));
  const f = fakeFetch(url => {
    const u = new URL(url);
    const off = Number(u.searchParams.get('offset'));
    const lim = Number(u.searchParams.get('limit'));
    return { body: rows.slice(off, off + lim) };
  });
  const got = await db(f, { pageSize: 2 }).readListings('hack');
  assert.deepEqual(got, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
  assert.equal(f.calls.length, 4);
  for (const c of f.calls) {
    const u = new URL(c.url);
    assert.equal(u.pathname, '/rest/v1/listings');
    assert.equal(u.searchParams.get('section'), 'eq.hack');
    assert.equal(u.searchParams.get('select'), 'data');
    assert.equal(u.searchParams.get('order'), 'id.asc');
  }
  assert.deepEqual(f.calls.map(c => new URL(c.url).searchParams.get('offset')), ['0', '2', '4', '5']);
});

test('readListings: a server cap below the page size does not truncate the read', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ data: { id: i + 1 } }));
  const f = fakeFetch(url => {
    const off = Number(new URL(url).searchParams.get('offset'));
    return { body: rows.slice(off, off + 3) }; // max-rows 3, though we ask for 1000
  });
  assert.equal((await db(f).readListings('case')).length, 7);
});

test('readListings rejects a bad section without fetching', async () => {
  const f = fakeFetch(() => ({ body: [] }));
  await assert.rejects(db(f).readListings('x'), /section/);
  assert.equal(f.calls.length, 0);
});

test('errors throw with the HTTP status and the Postgres message', async () => {
  const f = fakeFetch(() => ({ status: 400, body: { code: '22023', message: 'refusing to empty section case' } }));
  await assert.rejects(db(f).syncSection('case', [], [], {}), e => /400/.test(e.message) && /refusing to empty section case/.test(e.message) && /22023/.test(e.message));
  const g = fakeFetch(() => ({ status: 503, body: 'upstream down' }));
  await assert.rejects(db(g).readListings('case'), /503.*upstream down/);
  const h = fakeFetch(() => ({ body: { not: 'an array' } }));
  await assert.rejects(db(h).readTable('decisions'), /decisions.*unexpected/);
});

test('a network error is rethrown as a Supabase error', async () => {
  const d = db(async () => { throw new Error('ECONNRESET'); });
  await assert.rejects(d.readTable('decisions'), /Supabase.*ECONNRESET/);
});

test('syncSection posts one RPC call with section, rows, archive and status', async () => {
  const f = fakeFetch(() => ({ body: { archived: 1, upserted: 2, deleted: 1 } }));
  const out = await db(f).syncSection('case', [{ id: 1 }, { id: 2 }], [{ archive_key: '9', id: 9 }], { last_ok: 'x' });
  assert.deepEqual(out, { archived: 1, upserted: 2, deleted: 1 });
  assert.equal(f.calls.length, 1);
  const c = f.calls[0];
  assert.equal(c.url, 'https://abc.supabase.co/rest/v1/rpc/sync_section');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(c.body, { p_section: 'case', p_rows: [{ id: 1 }, { id: 2 }], p_archive: [{ archive_key: '9', id: 9 }], p_status: { last_ok: 'x' } });
});

test('setStatus posts the set_status RPC and tolerates an empty answer', async () => {
  const f = fakeFetch(() => ({ status: 204, body: '' }));
  await db(f).setStatus('hack', { last_error: 'boom' });
  assert.equal(f.calls[0].url, 'https://abc.supabase.co/rest/v1/rpc/set_status');
  assert.deepEqual(f.calls[0].body, { p_section: 'hack', p_status: { last_error: 'boom' } });
});

test('readStatus returns the section row data, or null when there is none', async () => {
  const f = fakeFetch(url => ({ body: url.includes('eq.case') ? [{ data: { last_ok: 'T' } }] : [] }));
  assert.deepEqual(await db(f).readStatus('case'), { last_ok: 'T' });
  assert.equal(await db(f).readStatus('hack'), null);
  assert.equal(new URL(f.calls[0].url).pathname, '/rest/v1/source_status');
});

test('readWatch returns the { id: data } map; upsertWatch merges duplicates', async () => {
  const f = fakeFetch((url, init) => (init.method === 'POST' ? { status: 201, body: '' } : { body: page(url, [{ id: 'intl-a', data: { hash: 'h' } }]) }));
  const d = db(f);
  assert.deepEqual(await d.readWatch(), { 'intl-a': { hash: 'h' } });
  await d.upsertWatch([{ id: 'intl-a', data: { hash: 'h2' } }]);
  const post = f.calls.at(-1);
  assert.equal(new URL(post.url).pathname, '/rest/v1/watch');
  assert.match(post.init.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(post.body[0].id, 'intl-a');
  assert.deepEqual(post.body[0].data, { hash: 'h2' });
  assert.ok(post.body[0].updated_at);
});

test('upsertWatch with no rows sends nothing', async () => {
  const f = fakeFetch(() => ({ body: '' }));
  await db(f).upsertWatch([]);
  assert.equal(f.calls.length, 0);
});

test('readTables converts each table to the in-memory shapes and reports failures per table', async () => {
  const f = fakeFetch(url => {
    if (url.includes('/decisions')) return { body: page(url, [{ id: '7', status: 'entering', registered: true, note: null, updated_at: '2026-09-29T00:00:00Z' }]) };
    if (url.includes('/manual')) return { body: page(url, [{ id: '55', url: 'https://unstop.com/c/kept-55', added: '2026-09-20' }]) };
    return { status: 503, body: 'down' };
  });
  const r = await readTables(db(f));
  assert.deepEqual(r.decisions, { value: { 7: { status: 'entering', registered: true, updated: '2026-09-29' } } });
  assert.deepEqual(r.manual, { value: [{ url: 'https://unstop.com/c/kept-55', added: '2026-09-20' }] });
  assert.match(r.intlDates.error, /^Supabase .*503/);
});

test('readTables without a key never fetches', async () => {
  const f = fakeFetch(() => ({ body: [] }));
  const r = await readTables(createDb({ env: {}, fetch: f }));
  assert.equal(f.calls.length, 0);
  for (const k of ['decisions', 'manual', 'intlDates']) assert.match(r[k].error, /not configured/);
});
