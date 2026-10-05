// A real Postgres (PGlite, in-process WASM) with db/schema.sql applied, for
// the SQL and API tests. No network, no server.
//
// Known gap: PGlite has one session and its session user is a superuser.
// Postgres checks SET ROLE against the session user, so here any role can
// be switched to; on Railway the API logs in as radar_api and can only
// switch to radar_member / radar_service. Tests therefore check that
// membership with pg_has_role() instead. Everything else (grants, RLS,
// security definer, current_user) is enforced under `set local role` exactly
// as on a server.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const SCHEMA = fs.readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8');

export async function freshDb({ applyTwice = false } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  if (applyTwice) await db.exec(SCHEMA);
  // A role with no grants at all: what PUBLIC gets.
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'nobody') then create role nobody nologin; end if; end $$;`);
  return db;
}

// The API's database handle over PGlite: every transaction starts as the
// API's login role, radar_api, like a pg Pool connection would.
export function apiDb(db) {
  return {
    tx: fn => db.transaction(async tx => {
      await tx.exec('set local role radar_api');
      return fn({ query: (sql, params) => tx.query(sql, params) });
    }),
  };
}
