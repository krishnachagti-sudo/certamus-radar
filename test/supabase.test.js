import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConfigured, readTable, readTables } from '../fetch/supabase.js';

const cfg = (getJson, over = {}) => ({ url: 'https://abc.supabase.co', anonKey: 'anon-123', getJson, ...over });

test('isConfigured needs both the URL and the anon key', () => {
  assert.equal(isConfigured(cfg(null)), true);
  assert.equal(isConfigured(cfg(null, { url: '' })), false);
  assert.equal(isConfigured(cfg(null, { anonKey: '' })), false);
  assert.equal(isConfigured(undefined), false);
});

test('readTable asks the REST endpoint with the anon key in both headers', async () => {
  const calls = [];
  const rows = [{ id: '1', status: 'watching' }];
  const got = await readTable(cfg(async (url, headers) => { calls.push({ url, headers }); return rows; }), 'decisions');
  assert.deepEqual(got, rows);
  assert.deepEqual(calls, [{
    url: 'https://abc.supabase.co/rest/v1/decisions?select=*',
    headers: { apikey: 'anon-123', Authorization: 'Bearer anon-123' },
  }]);
});

test('readTable tolerates a trailing slash on the URL', async () => {
  let seen;
  await readTable(cfg(async url => { seen = url; return []; }, { url: 'https://abc.supabase.co/' }), 'manual');
  assert.equal(seen, 'https://abc.supabase.co/rest/v1/manual?select=*');
});

test('readTable throws when not configured or the answer is not an array', async () => {
  await assert.rejects(readTable(cfg(async () => [], { url: '' }), 'decisions'), /not configured/);
  await assert.rejects(readTable(cfg(async () => ({ message: 'x' })), 'decisions'), /decisions.*unexpected/);
});

test('readTables converts each table and reports failures per table', async () => {
  const getJson = async url => {
    if (url.includes('/decisions')) return [{ id: '7', status: 'entering', registered: true, note: null, updated_at: '2026-09-29T00:00:00Z' }];
    if (url.includes('/manual')) return [{ id: '55', url: 'https://unstop.com/c/kept-55', added: '2026-09-20' }];
    throw new Error('HTTP 503');
  };
  const r = await readTables(cfg(getJson));
  assert.equal(r.configured, true);
  assert.deepEqual(r.decisions, { value: { 7: { status: 'entering', registered: true, updated: '2026-09-29' } } });
  assert.deepEqual(r.manual, { value: [{ url: 'https://unstop.com/c/kept-55', added: '2026-09-20' }] });
  assert.deepEqual(r.intlDates, { error: 'Supabase HTTP 503' });
});

test('readTables without config never calls getJson', async () => {
  let called = false;
  const r = await readTables(cfg(async () => { called = true; return []; }, { anonKey: '' }));
  assert.equal(called, false);
  assert.equal(r.configured, false);
  for (const k of ['decisions', 'manual', 'intlDates']) assert.match(r[k].error, /not configured/);
});
