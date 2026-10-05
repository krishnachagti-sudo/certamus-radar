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
// the current one. Nothing is printed that could leak it.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// exec(sql): run a multi-statement script; query(sql, params) -> { rows }.
export async function apply({ exec, query, schema = SCHEMA, password = null, log = console.log }) {
  if (password != null && String(password).length < 24) throw new Error('RADAR_API_PASSWORD must be at least 24 characters');
  await exec('begin');
  try {
    await exec(schema);
    if (password != null) {
      // ALTER ROLE takes no bind parameters: quote the literal server-side.
      const { rows } = await query('select format($1, $2::text) as sql', ['alter role radar_api password %L', String(password)]);
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
