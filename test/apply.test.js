// db/apply.mjs against PGlite: applies the schema twice, sets the API
// password only when given, and rolls back on failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { apply, scramVerifier } from '../db/apply.mjs';

const handle = db => ({ exec: sql => db.exec(sql), query: (sql, params) => db.query(sql, params), log: () => {} });
const stored = async db => (await db.query(`select rolpassword from pg_authid where rolname = 'radar_api'`)).rows[0].rolpassword;
const hasPassword = async db => (await stored(db)) != null;

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

test('the password reaches the server only as a SCRAM verifier, stored as sent', async () => {
  const db = new PGlite();
  const sent = [];
  const pw = 'Abc-def_0123456789+/=xyzXYZ';
  await apply({ exec: sql => { sent.push(sql); return db.exec(sql); }, query: (sql, params) => { sent.push(JSON.stringify(params)); return db.query(sql, params); }, log: () => {}, password: pw });
  assert.ok(!sent.some(x => x.includes(pw)), 'plaintext never sent');
  assert.ok(sent.some(x => /log_statement = 'none'/.test(x)), 'logging off first');
  const v = await stored(db);
  assert.match(v, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
  assert.ok(sent.some(x => x.includes(v)), 'Postgres kept the verifier as sent (it recognised the format)');
  await assert.rejects(apply({ ...handle(db), password: 'with space 0123456789012345' }), /printable ASCII/);
});

test('scramVerifier matches what a real SCRAM client (node-postgres) proves at login', async () => {
  const sasl = createRequire(import.meta.url)('pg/lib/crypto/sasl.js');
  const pw = 'Xk9_long-random-password-0123456789';
  const salt = Buffer.from('0123456789abcdef');
  const v = scramVerifier(pw, { salt });
  const [storedB64, serverB64] = v.split('$')[2].split(':');
  const storedKey = Buffer.from(storedB64, 'base64');
  const serverKey = Buffer.from(serverB64, 'base64');
  // Play the server's side of the exchange with only the stored verifier.
  const session = sasl.startSession(['SCRAM-SHA-256'], {});
  const serverFirst = `r=${session.clientNonce}srv-nonce,s=${salt.toString('base64')},i=4096`;
  await sasl.continueSession(session, pw, serverFirst, {});
  const finalNoProof = session.response.replace(/,p=[^,]+$/, '');
  const proof = Buffer.from(/,p=([^,]+)$/.exec(session.response)[1], 'base64');
  const authMessage = `n=*,r=${session.clientNonce},${serverFirst},${finalNoProof}`;
  const clientSig = createHmac('sha256', storedKey).update(authMessage).digest();
  const clientKey = Buffer.from(proof.map((b, i) => b ^ clientSig[i]));
  assert.deepEqual(createHash('sha256').update(clientKey).digest(), storedKey, 'the client proof checks out against StoredKey');
  assert.equal(createHmac('sha256', serverKey).update(authMessage).digest('base64'), session.serverSignature, 'and ServerKey signs what the client expects');
});
