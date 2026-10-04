// Static checks on supabase/v3.sql (the platform migration). Nothing here
// talks to a database: it parses the SQL text for the shapes the spec's
// Resolutions require (no anon access, RLS everywhere, every function
// explicitly revoked then granted, service-role-only sync) and checks that
// supabase/check-access.mjs probes every table and function it creates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TABLES, RPCS } from '../supabase/check-access.mjs';

const RAW = fs.readFileSync(fileURLToPath(new URL('../supabase/v3.sql', import.meta.url)), 'utf8');
// Comments out, whitespace collapsed, lowercased: the shape, not the layout.
const SQL = RAW.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();

const tables = [...SQL.matchAll(/create table if not exists public\.(\w+)/g)].map(m => m[1]);
// name -> { args: [[name, type]], body, at }
const functions = new Map();
for (const m of SQL.matchAll(/create or replace function public\.(\w+)\s*\(([^)]*)\)/g)) {
  const args = m[2].trim() ? m[2].split(',').map(a => a.trim().split(' ')) : [];
  const start = m.index;
  const end = SQL.indexOf('$$;', SQL.indexOf('$$', start) + 2);
  functions.set(m[1], { args, at: start, body: SQL.slice(start, end) });
}
const statements = SQL.split(';').map(s => s.trim()).filter(Boolean);
const grantsOf = name => statements.filter(s => new RegExp(`^grant execute on function public\\.${name}\\(`).test(s));

const TEAM_RPCS = ['create_team', 'update_team', 'delete_team', 'mark_joined', 'upsert_round', 'delete_round', 'set_round_done'];
const SERVICE_RPCS = ['sync_section', 'set_status'];
const HELPERS = ['is_member', 'is_admin', 'in_team'];

test('starts by revoking default function execute from public, anon and authenticated', () => {
  assert.equal(statements[0], 'alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated');
});

test('default privileges: nothing created later is reachable by public, anon or authenticated', () => {
  assert.ok(statements.includes('alter default privileges for role postgres revoke execute on functions from public'), 'global function default');
  assert.ok(statements.includes('alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated'));
  assert.ok(statements.includes('alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated'));
  assert.doesNotMatch(SQL, /alter default privileges [^;]*\bgrant\b/);
});

test('the project is documented as Radar-only and the old schema file is gone', () => {
  assert.match(RAW, /must hold Radar only/);
  assert.equal(fs.existsSync(fileURLToPath(new URL('../supabase/schema.sql', import.meta.url))), false);
});

test('creates every platform table, plus the three existing ones for a fresh project', () => {
  for (const t of ['members', 'listings', 'archive', 'source_status', 'watch', 'teams', 'team_members', 'rounds', 'decisions', 'intl_dates', 'manual']) {
    assert.ok(tables.includes(t), `missing create table public.${t}`);
  }
});

test('every public table has row level security enabled', () => {
  for (const t of tables) assert.match(SQL, new RegExp(`alter table public\\.${t} enable row level security`), t);
});

test('composite keys: listings (section, id) and archive (section, archive_key)', () => {
  assert.match(SQL, /create table if not exists public\.listings \([^;]*primary key \(section, id\)/);
  assert.match(SQL, /create table if not exists public\.archive \([^;]*primary key \(section, archive_key\)/);
});

test('removes all anon access to tables and every grant names a known role', () => {
  assert.match(SQL, /revoke all on all tables in schema public from anon/);
  assert.doesNotMatch(SQL, /\bto [^;]*\banon\b/, 'nothing is granted or policied to anon');
  assert.doesNotMatch(SQL, /\bgrant [^;]* to public\b/);
});

test('drops the old public policies, key RPCs and private editor key', () => {
  for (const t of ['decisions', 'intl_dates', 'manual']) assert.ok(SQL.includes(`drop policy if exists "public read" on public.${t}`), t);
  for (const f of ['check_editor(text)', 'set_decision(text, text, text, boolean, text)', 'set_intl_dates(text, text, date, date)', 'add_manual(text, text)']) {
    assert.ok(SQL.includes(`drop function if exists public.${f}`), f);
  }
  assert.match(SQL, /drop schema if exists private cascade/);
});

test('intl_dates ids widened to intl-, fest- and hk-', () => {
  assert.match(SQL, /alter table public\.intl_dates drop constraint if exists intl_dates_id_check/);
  for (const p of ['intl-%', 'fest-%', 'hk-%']) assert.ok(SQL.includes(`id like '${p}'`), p);
});

test('idempotent: every create policy is preceded by a drop of the same policy', () => {
  for (const m of SQL.matchAll(/create policy ("[^"]+") on (public\.\w+)/g)) {
    const drop = SQL.indexOf(`drop policy if exists ${m[1]} on ${m[2]}`);
    assert.ok(drop !== -1 && drop < m.index, `${m[1]} on ${m[2]}`);
  }
  assert.doesNotMatch(SQL, /create table (?!if not exists)/);
  assert.doesNotMatch(SQL, /create function /, 'only create or replace function');
  assert.doesNotMatch(SQL, /create schema (?!if not exists)/);
});

test('policies: members read the shared tables, admin writes the editable ones, teams are team-only', () => {
  const policies = [...SQL.matchAll(/create policy "[^"]+" on public\.(\w+) for (\w+) to (\w+) (using|with check) \(([^;]*)\)/g)]
    .map(m => ({ table: m[1], cmd: m[2], role: m[3], expr: m[5] }));
  for (const p of policies) assert.equal(p.role, 'authenticated', `${p.table} ${p.cmd}`);
  const sel = t => policies.filter(p => p.table === t && p.cmd === 'select');
  for (const t of ['members', 'listings', 'archive', 'source_status', 'watch', 'decisions', 'intl_dates', 'manual']) {
    assert.equal(sel(t).length, 1, t);
    assert.equal(sel(t)[0].expr, '(select public.is_member())', t);
  }
  for (const t of ['teams', 'team_members', 'rounds']) {
    assert.equal(sel(t).length, 1, t);
    assert.equal(sel(t)[0].expr, '(select public.is_admin()) or public.in_team(listing_id)', t);
    assert.equal(policies.filter(p => p.table === t && p.cmd !== 'select').length, 0, `${t}: writes only via RPC`);
  }
  for (const t of ['decisions', 'intl_dates', 'manual']) {
    for (const cmd of ['insert', 'update', 'delete']) {
      const ps = policies.filter(p => p.table === t && p.cmd === cmd);
      assert.equal(ps.length, 1, `${t} ${cmd}`);
      assert.match(ps[0].expr, /^\(select public\.is_admin\(\)\)/, `${t} ${cmd}`);
    }
  }
  for (const t of ['members', 'listings', 'archive', 'source_status', 'watch']) {
    assert.equal(policies.filter(p => p.table === t && p.cmd !== 'select').length, 0, `${t}: no client writes`);
  }
});

test('table grants to authenticated: select everywhere, writes only on the admin-edited tables', () => {
  const grants = statements.filter(s => /^grant [^;]* on (table )?public\./.test(s) && !s.startsWith('grant execute'));
  for (const g of grants) assert.match(g, / to (authenticated|service_role)$/, g);
  const writes = grants.filter(g => g.endsWith(' to authenticated') && /\b(insert|update|delete|all)\b/.test(g.split(' on ')[0]));
  assert.ok(writes.length >= 1);
  for (const g of writes) assert.match(g, /on (table )?public\.(decisions|intl_dates|manual)(, public\.(decisions|intl_dates|manual))* to/, g);
});

test('every function is revoked from public, anon and authenticated after it is created', () => {
  assert.ok(functions.size >= TEAM_RPCS.length + SERVICE_RPCS.length + HELPERS.length);
  for (const [name, f] of functions) {
    const re = new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon, authenticated`, 'g');
    const after = [...SQL.matchAll(re)].filter(m => m.index > f.at);
    assert.ok(after.length >= 1, `${name}: no revoke after create`);
  }
});

test('every security definer function pins search_path and the expected set is there', () => {
  for (const name of [...TEAM_RPCS, ...SERVICE_RPCS, ...HELPERS]) assert.ok(functions.has(name), name);
  for (const [name, f] of functions) {
    if (f.body.includes('security definer')) assert.ok(f.body.includes("set search_path = ''"), name);
  }
});

test('helpers: security definer, stable, bound to the Google identity; granted to authenticated for RLS', () => {
  for (const name of HELPERS) {
    const { body } = functions.get(name);
    assert.ok(body.includes('security definer'), name);
    assert.ok(body.includes('stable'), name);
    assert.ok(body.includes('from auth.identities i join public.members m on m.email = lower(i.identity_data ->> \'email\')'), name);
    assert.ok(body.includes("where i.user_id = auth.uid() and i.provider = 'google' and m.active"), name);
    assert.deepEqual(grantsOf(name).map(g => g.split(' to ')[1]), ['authenticated'], name);
  }
  assert.ok(functions.get('is_admin').body.includes("m.role = 'admin'"));
  const own = functions.get('google_emails').body;
  assert.ok(own.includes("where i.user_id = auth.uid() and i.provider = 'google'"));
  assert.equal(grantsOf('google_emails').length, 0, 'internal only');
});

test('the JWT email claim is never trusted', () => {
  assert.doesNotMatch(SQL, /auth\.jwt\(\)/);
});

test('team and round RPCs: security definer, granted to authenticated only, check the caller', () => {
  for (const name of TEAM_RPCS) {
    const { body } = functions.get(name);
    assert.ok(body.includes('security definer'), name);
    assert.deepEqual(grantsOf(name).map(g => g.split(' to ')[1]), ['authenticated'], name);
    assert.ok(body.includes("errcode = '42501'"), `${name} raises forbidden`);
  }
  for (const name of ['create_team', 'update_team', 'delete_team', 'upsert_round', 'delete_round']) {
    assert.match(functions.get(name).body, /if not public\.is_admin\(\) then raise exception '[^']*' using errcode = '42501'/, name);
  }
  assert.match(functions.get('set_round_done').body, /public\.is_admin\(\) or public\.in_team\(/);
  assert.match(functions.get('mark_joined').body, /public\.in_team\(p_listing_id\)/);
  assert.match(functions.get('mark_joined').body, /email in \(select public\.google_emails\(\)\)/);
});

test('create_team validates https, lowercases emails, requires active members, sets registered', () => {
  const { body } = functions.get('create_team');
  assert.ok(body.includes("'^https://"), 'https check');
  assert.ok(body.includes("errcode = '22023'"), 'invalid input errcode');
  assert.match(body, /perform public\.replace_team_members\(p_listing_id, p_emails\)/);
  assert.match(body, /if exists \(select 1 from public\.teams where listing_id = p_listing_id\) then raise exception 'team exists, use update_team' using errcode = '22023'/);
  assert.doesNotMatch(body, /insert into public\.teams [^;]*on conflict/);
  assert.match(functions.get('update_team').body, /perform public\.replace_team_members\(p_listing_id, p_emails\)/);
  const members = functions.get('replace_team_members');
  assert.match(members.body, /lower\(btrim\(/);
  assert.match(members.body, /from public\.members [^;]*active/);
  assert.match(members.body, /not between 1 and 5/);
  assert.equal(grantsOf('replace_team_members').length, 0, 'internal only');
  assert.match(body, /insert into public\.decisions \(id, registered[^;]*on conflict \(id\) do update set registered = true/);
  assert.doesNotMatch(body.match(/insert into public\.decisions[^;]*/)[0], /status =|note =/, 'keeps status and note');
});

test('sync_section and set_status: service_role only, checked inside, granted to service_role only', () => {
  for (const name of SERVICE_RPCS) {
    const { body } = functions.get(name);
    assert.ok(body.includes('security definer'), name);
    assert.match(body, /if coalesce\(auth\.role\(\), ''\) <> 'service_role' then raise exception '[^']*' using errcode = '42501'/, name);
    assert.deepEqual(grantsOf(name).map(g => g.split(' to ')[1]), ['service_role'], name);
  }
});

test('sync_section steps run in order: archive, upsert, delete missing, status', () => {
  const { body } = functions.get('sync_section');
  const at = re => { const m = body.match(re); assert.ok(m, String(re)); return m.index; };
  const archive = at(/insert into public\.archive [^;]*on conflict \(section, archive_key\) do nothing/);
  const upsert = at(/insert into public\.listings [^;]*on conflict \(section, id\) do update/);
  const del = at(/delete from public\.listings [^;]*section = p_section/);
  const status = at(/insert into public\.source_status [^;]*on conflict \(section\) do update/);
  assert.ok(archive < upsert && upsert < del && del < status);
  assert.match(body, /->> 'id'/, 'id read as text');
  for (const c of ['regn_close', 'comp_end', 'closed_on']) assert.ok(body.includes(`'${c}'`), c);
  assert.match(body, /return jsonb_build_object\(/);
});

test('seeds Krishna as admin; teammate placeholders use example.com', () => {
  const placeholders = [...RAW.matchAll(/^-- insert into public\.members .*'([^']+@[^']+)'/gm)].map(m => m[1]);
  assert.ok(placeholders.length >= 4);
  for (const e of placeholders) assert.match(e, /@example\.com$/, e);
  assert.match(SQL, /insert into public\.members \(email, name, role, active\) values \('krishnachagti@gmail\.com', 'krishna', 'admin', true\) on conflict \(email\) do update/);
});

test('check-access probes every table and every function, with the real argument names', () => {
  assert.deepEqual([...TABLES].sort(), [...tables].sort());
  assert.deepEqual(Object.keys(RPCS).sort(), [...functions.keys()].sort());
  for (const [name, { args }] of functions) {
    assert.deepEqual(Object.keys(RPCS[name]).sort(), args.map(a => a[0]).sort(), name);
  }
});

test('check-access: refusals and empty reads pass, rows or a run are leaks, missing schema fails', async () => {
  const { judgeTable, judgeRpc, checkAccess } = await import('../supabase/check-access.mjs');
  assert.equal(judgeTable({ status: 401, body: { code: '42501' } }).ok, true);
  assert.equal(judgeTable({ status: 200, body: [] }).ok, true);
  assert.equal(judgeTable({ status: 200, body: [{ id: 1 }] }).ok, false);
  assert.equal(judgeTable({ status: 404, body: { code: '42P01' } }).ok, false);
  assert.equal(judgeRpc('create_team', { status: 403, body: { code: '42501' } }).ok, true);
  assert.equal(judgeRpc('create_team', { status: 400, body: { code: '42501' } }).ok, true);
  assert.equal(judgeRpc('sync_section', { status: 404, body: { code: 'PGRST202' } }).ok, false, 'v3 not applied');
  assert.equal(judgeRpc('sync_section', { status: 404, body: { code: '42501' } }).ok, true);
  assert.equal(judgeRpc('sync_section', { status: 200, body: { upserted: 0 } }).ok, false);
  assert.equal(judgeRpc('delete_team', { status: 204, body: '' }).ok, false);
  assert.equal(judgeRpc('create_team', { status: 400, body: { code: '22023' } }).ok, false);
  assert.equal(judgeRpc('is_member', { status: 200, body: false }).ok, true);
  assert.equal(judgeRpc('is_member', { status: 200, body: true }).ok, false);

  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    const leak = url.includes('/rest/v1/watch?');
    return new Response(leak ? '[{"id":"x"}]' : '{"code":"42501"}', { status: leak ? 200 : 401 });
  };
  const results = await checkAccess({ url: 'https://x.supabase.co/', key: 'pk', jwt: 'j', fetchImpl });
  assert.deepEqual(results.filter(r => !r.ok).map(r => r.name), ['watch']);
  assert.equal(seen.length, TABLES.length + Object.keys(RPCS).length);
  assert.equal(seen[0].url, 'https://x.supabase.co/rest/v1/members?select=*&limit=1');
  assert.equal(seen[0].init.headers.apikey, 'pk');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer j');
  const rpc = seen.find(s => s.url.endsWith('/rpc/create_team'));
  assert.equal(rpc.init.method, 'POST');
  assert.deepEqual(Object.keys(JSON.parse(rpc.init.body)).sort(), ['p_emails', 'p_invite_url', 'p_listing_id', 'p_section']);
});
