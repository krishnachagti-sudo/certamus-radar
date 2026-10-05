// db/apply.mjs against PGlite: applies the schema twice, sets the API
// password only when given, and rolls back on failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { apply } from '../db/apply.mjs';

const handle = db => ({ exec: sql => db.exec(sql), query: (sql, params) => db.query(sql, params), log: () => {} });
const hasPassword = async db => (await db.query(`select rolpassword is not null as p from pg_authid where rolname = 'radar_api'`)).rows[0].p;

test('applies twice; the password is set only when given, with quotes intact', async () => {
  const db = new PGlite();
  await apply(handle(db));
  assert.equal(await hasPassword(db), false);
  await apply({ ...handle(db), password: "it's-a-long-random-password-0123456789" });
  assert.equal(await hasPassword(db), true);
  await apply(handle(db));
  assert.equal(await hasPassword(db), true, 'a later run keeps it');
  assert.equal((await db.query(`select count(*)::int n from public.members`)).rows[0].n, 1);
});

test('a short password is refused before anything runs', async () => {
  const db = new PGlite();
  await assert.rejects(apply({ ...handle(db), password: 'short' }), /at least 24/);
  assert.equal((await db.query(`select count(*)::int n from pg_roles where rolname = 'radar_api'`)).rows[0].n, 0);
});

test('a failing schema rolls everything back', async () => {
  const db = new PGlite();
  await assert.rejects(apply({ ...handle(db), schema: 'create table public.t (x int); select 1/0;' }));
  assert.equal((await db.query(`select to_regclass('public.t') is null as gone`)).rows[0].gone, true);
});
