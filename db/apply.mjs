// Applies db/schema.sql (idempotent) to the Railway Postgres, as the
// database owner, in one transaction; optionally sets the API login role's
// password in the same go.
//
//   DATABASE_URL=<owner URL, Railway's Postgres DATABASE_PUBLIC_URL> \
//   RADAR_API_PASSWORD=<new random password, optional> \
//   node db/apply.mjs
//
// RADAR_API_PASSWORD is the password the API service's own DATABASE_URL
// uses for radar_api (README "Railway"). Leave it out on later runs to keep
// the current one. The password itself never reaches the server: this
// script sends a SCRAM-SHA-256 verifier (what Postgres would store anyway),
// with statement logging off for that transaction, and prints nothing that
// could leak it.
import fs from 'node:fs';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Postgres's stored form of a password (RFC 5802 / 7677, as Postgres writes
// it): SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>. Given in
// ALTER ROLE ... PASSWORD, Postgres stores it as is.
export function scramVerifier(password, { salt = randomBytes(16), iterations = 4096 } = {}) {
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

// exec(sql): run a multi-statement script; query(sql, params) -> { rows }.
export async function apply({ exec, query, schema = SCHEMA, password = null, log = console.log }) {
  if (password != null) {
    const p = String(password);
    if (p.length < 24) throw new Error('RADAR_API_PASSWORD must be at least 24 characters');
    // Printable ASCII only: then SASLprep leaves it unchanged, so the
    // verifier computed here is the one a client's SCRAM login will match.
    if (!/^[\x21-\x7e]+$/.test(p)) throw new Error('RADAR_API_PASSWORD must be printable ASCII without spaces');
  }
  await exec('begin');
  try {
    await exec(schema);
    if (password != null) {
      // Belt and braces: nothing in this transaction goes to the server log
      // (these are superuser settings; the owner on Railway is one).
      await exec("set local log_statement = 'none'; set local log_min_duration_statement = -1; set local log_min_error_statement = 'panic'");
      // ALTER ROLE takes no bind parameters: quote the literal server-side.
      const { rows } = await query('select format($1, $2::text) as sql', ['alter role radar_api password %L', scramVerifier(String(password))]);
      await exec(rows[0].sql);
    }
    await exec('commit');
  } catch (e) {
    await exec('rollback').catch(() => {});
    throw e;
  }
  log(`schema applied${password != null ? '; radar_api password set' : ''}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('apply: DATABASE_URL (the owner connection) is required'); return 1; }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await apply({
      exec: sql => client.query(sql),
      query: (sql, params) => client.query(sql, params),
      password: process.env.RADAR_API_PASSWORD || null,
    });
    return 0;
  } catch (e) {
    console.error(`apply failed: ${e.message}`);
    return 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
