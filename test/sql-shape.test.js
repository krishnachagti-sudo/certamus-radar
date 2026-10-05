// Static checks on db/schema.sql. test/schema.test.js runs the schema for
// real; these pin the shapes the spec's Resolutions require in the text
// itself (idempotent, RLS everywhere, explicit revokes, no Supabase-only
// objects, every security definer function pinned), so a later edit cannot
// quietly drop one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAW = fs.readFileSync(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8');
// Comments out, whitespace collapsed, lowercased: the shape, not the layout.
const SQL = RAW.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();

const tables = [...SQL.matchAll(/create table if not exists (public|private)\.(\w+)/g)].map(m => `${m[1]}.${m[2]}`);
const functions = new Map();
for (const m of SQL.matchAll(/create or replace function ((?:public|private)\.\w+)\s*\(([^)]*)\)/g)) {
  const start = m.index;
  const end = SQL.indexOf('$$;', SQL.indexOf('$$', start) + 2);
  const args = m[2].trim() ? m[2].split(',').map(a => a.trim().split(' ')) : [];
  functions.set(m[1], { args, at: start, body: SQL.slice(start, end) });
}
const statements = SQL.split(';').map(s => s.trim()).filter(Boolean);
const grantsOf = name => statements.filter(s => s.startsWith(`grant execute on function ${name}(`)).map(g => g.split(' to ')[1]);

test('plain Postgres: nothing from Supabase', () => {
  assert.doesNotMatch(SQL, /\bauth\.|\banon\b|\bauthenticated\b|service_role|supabase|request\.jwt/);
});

test('the database is documented as Radar-only', () => {
  assert.match(RAW, /must hold Radar only/);
});

test('roles: two nologin roles and the API login role, created idempotently, no password in the file', () => {
  for (const r of ['radar_member', 'radar_service']) {
    assert.ok(SQL.includes(`if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r} nologin`), r);
  }
  assert.ok(SQL.includes("then create role radar_api login noinherit"));
  assert.doesNotMatch(SQL, /\bpassword '/);
  assert.ok(statements.includes('grant radar_member to radar_api'));
  assert.ok(statements.includes('grant radar_service to radar_api'));
});

test('default privileges and the public schema: nothing for PUBLIC', () => {
  assert.ok(statements.includes('alter default privileges revoke execute on functions from public'));
  assert.ok(statements.includes('revoke all on schema public from public'));
  assert.ok(statements.includes('revoke all on schema private from public'));
  assert.doesNotMatch(SQL, /alter default privileges [^;]*\bgrant\b/);
  assert.doesNotMatch(SQL, /\bgrant [^;]* to public\b/);
});

test('every table has row level security enabled', () => {
  assert.equal(tables.length, 13);
  for (const t of tables) assert.match(SQL, new RegExp(`alter table ${t.replace('.', '\\.')} enable row level security`), t);
});

test('composite keys: listings (section, id) and archive (section, archive_key)', () => {
  assert.match(SQL, /create table if not exists public\.listings \([^;]*primary key \(section, id\)/);
  assert.match(SQL, /create table if not exists public\.archive \([^;]*primary key \(section, archive_key\)/);
});

test('idempotent: every create policy is preceded by a drop of the same policy', () => {
  for (const m of SQL.matchAll(/create policy ("[^"]+") on (public\.\w+)/g)) {
    const drop = SQL.indexOf(`drop policy if exists ${m[1]} on ${m[2]}`);
    assert.ok(drop !== -1 && drop < m.index, `${m[1]} on ${m[2]}`);
  }
  assert.doesNotMatch(SQL, /create table (?!if not exists)/);
  assert.doesNotMatch(SQL, /create function /, 'only create or replace function');
  assert.doesNotMatch(SQL, /create schema (?!if not exists)/);
  assert.doesNotMatch(SQL, /create index (?!if not exists)/);
  assert.doesNotMatch(SQL, /\bdrop (table|schema)\b/, 'never drops data');
});

test('policies: radar_member reads per Resolution 21; radar_service only the jobs\' tables', () => {
  const policies = [...SQL.matchAll(/create policy "[^"]+" on public\.(\w+) for (\w+) to (\w+) (using|with check) \(([^;]*)\)/g)]
    .map(m => ({ table: m[1], cmd: m[2], role: m[3], expr: m[5] }));
  const member = policies.filter(p => p.role === 'radar_member');
  const sel = t => member.filter(p => p.table === t && p.cmd === 'select');
  for (const t of ['listings', 'archive', 'source_status', 'watch', 'decisions', 'intl_dates', 'manual', 'rounds']) {
    assert.deepEqual(sel(t).map(p => p.expr), ['(select public.is_admin())'], t);
  }
  assert.deepEqual(sel('members').map(p => p.expr), ['(select public.is_admin()) or public.is_self(email)']);
  assert.deepEqual(sel('team_members').map(p => p.expr), ['(select public.is_admin()) or public.is_self(email)']);
  assert.deepEqual(sel('teams').map(p => p.expr), ['(select public.is_admin()) or public.in_team(listing_id)']);
  for (const t of ['teams', 'team_members', 'rounds', 'members', 'listings', 'archive', 'source_status', 'watch']) {
    assert.equal(member.filter(p => p.table === t && p.cmd !== 'select').length, 0, `${t}: no member writes`);
  }
  for (const t of ['decisions', 'intl_dates', 'manual']) {
    for (const cmd of ['insert', 'update', 'delete']) {
      const ps = member.filter(p => p.table === t && p.cmd === cmd);
      assert.equal(ps.length, 1, `${t} ${cmd}`);
      assert.match(ps[0].expr, /^\(select public\.is_admin\(\)\)/);
    }
  }
  const service = policies.filter(p => p.role === 'radar_service').map(p => p.table).sort();
  assert.deepEqual(service, ['archive', 'decisions', 'intl_dates', 'listings', 'manual', 'source_status', 'watch']);
  for (const p of policies) assert.ok(['radar_member', 'radar_service'].includes(p.role), p.role);
});

test('identity: only through caller_email(), which reads app.email', () => {
  assert.match(functions.get('public.caller_email').body, /current_setting\('app\.email', true\)/);
  assert.equal(SQL.match(/current_setting\(/g).length, 1, 'read in one place');
  for (const name of ['public.is_member', 'public.is_admin', 'public.in_team', 'public.is_self']) {
    const { body } = functions.get(name);
    assert.ok(body.includes('security definer') && body.includes('stable'), name);
    assert.ok(body.includes('m.email = public.caller_email() and m.active'), name);
    assert.deepEqual(grantsOf(name), ['radar_member'], name);
  }
  assert.ok(functions.get('public.is_admin').body.includes("m.role = 'admin'"));
  assert.deepEqual(grantsOf('public.caller_email'), [], 'internal only');
  assert.match(functions.get('public.mark_joined').body, /email = public\.caller_email\(\)/);
  assert.match(functions.get('public.my_joins').body, /where tm\.email = public\.caller_email\(\)/);
});

test('every function is revoked from PUBLIC after it is created', () => {
  for (const [name, f] of functions) {
    const re = new RegExp(`revoke execute on function ${name.replace('.', '\\.')}\\([^)]*\\) from public`, 'g');
    assert.ok([...SQL.matchAll(re)].some(m => m.index > f.at), `${name}: no revoke after create`);
  }
});

test('every security definer function pins search_path', () => {
  for (const [name, f] of functions) {
    if (f.body.includes('security definer') || f.body.includes('security invoker')) assert.ok(f.body.includes("set search_path = ''"), name);
  }
});

test('team and round RPCs: security definer, radar_member only, check the caller', () => {
  for (const name of ['create_team', 'update_team', 'delete_team', 'mark_joined', 'upsert_round', 'delete_round', 'set_round_done', 'my_joins']) {
    const { body } = functions.get(`public.${name}`);
    assert.ok(body.includes('security definer'), name);
    assert.deepEqual(grantsOf(`public.${name}`), ['radar_member'], name);
    assert.ok(body.includes("errcode = '42501'"), name);
  }
  for (const name of ['create_team', 'update_team', 'delete_team', 'upsert_round', 'delete_round', 'set_round_done']) {
    assert.match(functions.get(`public.${name}`).body, /if not public\.is_admin\(\) then raise exception '[^']*' using errcode = '42501'/, name);
  }
  assert.match(functions.get('public.my_joins').body, /if not public\.is_member\(\) then raise exception/);
  assert.doesNotMatch(functions.get('public.my_joins').body, /\bnote\b|\bdata\s*,|\.data\s+as\b/, 'no notes, no whole records');
  assert.deepEqual(grantsOf('public.replace_team_members'), [], 'internal only');
});

test('sync_section and set_status: security invoker, radar_service only, checked inside', () => {
  for (const name of ['public.sync_section', 'public.set_status']) {
    const { body } = functions.get(name);
    assert.ok(body.includes('security invoker'), name);
    assert.match(body, /if current_user <> 'radar_service' then raise exception '[^']*' using errcode = '42501'/, name);
    assert.deepEqual(grantsOf(name), ['radar_service'], name);
  }
  const { body } = functions.get('public.sync_section');
  const at = re => { const m = body.match(re); assert.ok(m, String(re)); return m.index; };
  const archive = at(/insert into public\.archive [^;]*on conflict \(section, archive_key\) do nothing/);
  const upsert = at(/insert into public\.listings [^;]*on conflict \(section, id\) do update/);
  const del = at(/delete from public\.listings [^;]*section = p_section/);
  const status = at(/insert into public\.source_status [^;]*on conflict \(section\) do update/);
  assert.ok(archive < upsert && upsert < del && del < status);
});

test('sessions: hashes only, private schema, radar_api only', () => {
  assert.match(SQL, /create table if not exists private\.sessions \( ?token_hash text primary key check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(SQL, /create table if not exists private\.login_codes \( ?code_hash text primary key check/);
  for (const name of ['private.issue_login_code', 'private.exchange_login_code', 'private.session_email', 'private.end_session']) {
    assert.ok(functions.get(name).body.includes('security definer'), name);
    assert.deepEqual(grantsOf(name), ['radar_api'], name);
  }
  assert.match(functions.get('private.issue_login_code').body, /interval '60 seconds'/);
  assert.match(functions.get('private.exchange_login_code').body, /interval '30 days'/);
});

test('seeds Krishna as admin; teammate placeholders use example.com', () => {
  const placeholders = [...RAW.matchAll(/^-- insert into public\.members .*'([^']+@[^']+)'/gm)].map(m => m[1]);
  assert.ok(placeholders.length >= 4);
  for (const e of placeholders) assert.match(e, /@example\.com$/, e);
  assert.match(SQL, /insert into public\.members \(email, name, role, active\) values \('krishnachagti@gmail\.com', 'krishna', 'admin', true\) on conflict \(email\) do update/);
});

