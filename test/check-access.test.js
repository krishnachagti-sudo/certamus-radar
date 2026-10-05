// db/check-access.mjs: its verdicts, and a full run against the real API
// over PGlite, which must refuse every table and function without a session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb, apiDb } from './helpers/pg.js';
import { createApp } from '../api/app.js';
import { TABLES as TABLE_SPEC, RPCS as RPC_SPEC } from '../api/rest.js';
import { checkAccess, judge, TABLES, RPCS, formatTable } from '../db/check-access.mjs';

test('probes every whitelisted table and function, with their real argument names', () => {
  assert.deepEqual(TABLES, Object.keys(TABLE_SPEC));
  for (const [name, { args }] of Object.entries(RPC_SPEC)) assert.deepEqual(Object.keys(RPCS[name]), Object.keys(args), name);
});

test('judge: refusals pass; a 2xx is a leak; a 404 means nothing was proven', () => {
  assert.equal(judge({ status: 401, body: { code: 'unauthenticated' } }).ok, true);
  assert.equal(judge({ status: 403, body: {} }).ok, true);
  assert.match(judge({ status: 200, body: [] }).why, /LEAK/);
  assert.equal(judge({ status: 204, body: '' }).ok, false);
  assert.match(judge({ status: 404, body: {} }).why, /missing/);
  assert.equal(judge({ status: 0, body: 'ECONNREFUSED' }).ok, false);
});

test('the real API refuses every probe without a session', async () => {
  const pg = await freshDb();
  const server = http.createServer(createApp({
    db: apiDb(pg), google: { authUrl: () => 'x', emailFor: async () => 'x' }, log: { warn() {}, error() {} },
    config: { apiOrigin: 'https://api.test', allowedOrigins: ['https://conyso.com'], googleClientSecret: 's', serviceToken: 'x'.repeat(40) },
  }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const results = await checkAccess({ url: `http://127.0.0.1:${server.address().port}/` });
    assert.equal(results.length, 2 * (TABLES.length + Object.keys(RPCS).length + 1));
    assert.deepEqual(results.filter(r => !r.ok), [], formatTable(results));
  } finally {
    await new Promise(r => server.close(r));
  }
});
