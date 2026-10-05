// db/schema.sql run for real (PGlite): every access rule of the spec's
// Resolutions 1-22, as the roles the API uses. Ported from the old Supabase
// harness (167 checks); the identity checks now go through app.email, which
// only the API sets, from a session row. The tests run in file order and
// share one database, like a script.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers/pg.js';

let db;
before(async () => {
  db = await freshDb({ applyTwice: true });
  await db.exec(`insert into public.decisions (id, status, note) values ('555', 'watching', 'keep me');
    insert into public.intl_dates (id, regn_close) values ('intl-a', '2026-11-01');
    insert into public.manual (id, url) values ('123', 'https://unstop.com/x-123');
    insert into public.members (email, name, role) values ('mate@gmail.com','Mate','member'), ('akshit@gmail.com','Akshit','member') on conflict do nothing;`);
});

const K = 'krishnachagti@gmail.com', M = 'mate@gmail.com', A = 'akshit@gmail.com', X = 'stranger@gmail.com';
const TABLES = ['members', 'listings', 'archive', 'source_status', 'watch', 'decisions', 'intl_dates', 'manual', 'teams', 'team_members', 'rounds'];

// who: 'nobody' (PUBLIC), 'api' (radar_api), 'service' (radar_service),
// 'owner' (no role switch), or an email (radar_member with that app.email;
// '' = signed in as nobody in particular).
const ROLE = { nobody: 'nobody', api: 'radar_api', service: 'radar_service' };
async function as(who, sql, params) {
  try {
    const rows = await db.transaction(async tx => {
      if (who !== 'owner') {
        await tx.exec(`set local role ${ROLE[who] || 'radar_member'}`);
        if (!ROLE[who] && who) await tx.query(`select set_config('app.email', $1, true)`, [who]);
      }
      return (await tx.query(sql, params)).rows;
    });
    return { rows };
  } catch (e) {
    return { code: e.code, msg: e.message };
  }
}
const code = async (expected, who, sql, params) => {
  const r = await as(who, sql, params);
  assert.equal(r.code, expected, JSON.stringify(r));
};
const count = async (n, who, sql, params) => {
  const r = await as(who, sql, params);
  assert.ok(r.rows, JSON.stringify(r));
  assert.equal(r.rows.length, n, JSON.stringify(r.rows));
};
const run = async (who, sql, params) => {
  const r = await as(who, sql, params);
  assert.ok(r.rows, JSON.stringify(r));
  return r.rows;
};

// ---- nobody gets in ---------------------------------------------------------

for (const t of TABLES) test(`PUBLIC select ${t} -> 42501`, () => code('42501', 'nobody', `select * from public.${t}`));
for (const t of TABLES) test(`radar_api itself select ${t} -> 42501 (noinherit)`, () => code('42501', 'api', `select * from public.${t}`));
for (const t of TABLES) test(`stranger select ${t} -> 0 rows`, () => count(0, X, `select * from public.${t}`));
for (const t of TABLES) test(`signed in with no email: ${t} -> 0 rows`, () => count(0, '', `select * from public.${t}`));
test('PUBLIC create_team -> 42501', () => code('42501', 'nobody', `select public.create_team('1','case','https://x',array['${M}'])`));
test('radar_api create_team -> 42501', () => code('42501', 'api', `select public.create_team('1','case','https://x',array['${M}'])`));
test('radar_service create_team -> 42501', () => code('42501', 'service', `select public.create_team('1','case','https://x',array['${M}'])`));
test('stranger create_team -> 42501', () => code('42501', X, `select public.create_team('1','case','https://x',array['${M}'])`));
test('member create_team -> 42501', () => code('42501', M, `select public.create_team('1','case','https://x',array['${M}'])`));
test('admin sync_section as radar_member -> 42501', () => code('42501', K, `select public.sync_section('case','[]','[]','{}')`));
test('radar_member replace_team_members -> 42501', () => code('42501', K, `select public.replace_team_members('1', array['${M}'])`));
test('radar_member caller_email (internal) -> 42501', () => code('42501', K, 'select public.caller_email()'));
test('admin create_team http -> 22023', () => code('22023', K, `select public.create_team('555','case','http://x',array['${M}'])`));
test('admin create_team unknown email -> 22023', () => code('22023', K, `select public.create_team('555','case','https://x',array['${X}'])`));
test('admin create_team 6 emails -> 22023', () => code('22023', K, `select public.create_team('555','case','https://x',array['a','b','c','d','e','f'])`));
test('Krishna sees all 3 members', () => count(3, K, 'select * from public.members'));
test('Krishna with an odd-case email still the admin', () => count(3, K.toUpperCase(), 'select * from public.members'));

// ---- teams ---------------------------------------------------------------------

test('admin create_team with mixed-case emails', () => run(K, `select public.create_team('555','case','https://unstop.com/invite/abc',array[' MATE@gmail.com ','${K}'])`));
test('create_team on an existing team -> 22023', () => code('22023', K, `select public.create_team('555','case','https://unstop.com/invite/abc',array['${M}'])`));
test('create_team: registered = true, status and note kept', async () => {
  const d = await run(K, `select * from public.decisions where id='555'`);
  assert.equal(d[0].registered, true);
  assert.equal(d[0].status, 'watching');
  assert.equal(d[0].note, 'keep me');
});
test('mate sees the team', () => count(1, M, 'select * from public.teams'));
test('akshit (not in team) sees no team', () => count(0, A, 'select * from public.teams'));
test('akshit sees no team_members', () => count(0, A, 'select * from public.team_members'));
test('akshit mark_joined -> 42501', () => code('42501', A, `select public.mark_joined('555', true)`));
test('admin not in team mark_joined -> 42501', () => code('42501', K, `select public.mark_joined('999', true)`));
test('stranger mark_joined -> 42501', () => code('42501', X, `select public.mark_joined('555', true)`));
test('stranger sees no team', () => count(0, X, 'select * from public.teams'));
test('mate mark_joined', () => run(M, `select public.mark_joined('555', true)`));
test('only own joined_at set', async () => {
  const tm = await run(K, 'select email, joined_at from public.team_members order by email');
  assert.ok(tm.find(r => r.email === M).joined_at);
  assert.equal(tm.find(r => r.email === K).joined_at, null);
});
test('admin update_team drops K, adds A (keeps M joined)', async () => {
  await run(K, `select public.update_team('555','https://unstop.com/invite/new',array['${M}','${A}'])`);
  const tm = await run(K, 'select email, joined_at from public.team_members order by email');
  assert.equal(tm.length, 2);
  assert.ok(tm.find(r => r.email === M).joined_at);
});

// ---- rounds --------------------------------------------------------------------

let rid;
test('member upsert_round -> 42501', () => code('42501', M, `select public.upsert_round(null,'555','R1','2026-11-01',null)`));
test('admin upsert_round', async () => {
  rid = (await run(K, `select public.upsert_round(null,'555','Round 1','2026-11-01','MATE@gmail.com') as id`))[0].id;
  assert.match(rid, /^[0-9a-f-]{36}$/);
});
test('admin edits round', () => run(K, `select public.upsert_round('${rid}','555','Round 1 (edited)','2026-11-02',null)`));
test('round moved to other team -> 22023', () => code('22023', K, `select public.upsert_round('${rid}','777','x',null,null)`));
test('stranger set_round_done -> 42501', () => code('42501', X, `select public.set_round_done('${rid}', true)`));
test('akshit (in team) set_round_done -> 42501: rounds are admin-only', () => code('42501', A, `select public.set_round_done('${rid}', true)`));
test('mate (in team) set_round_done -> 42501', () => code('42501', M, `select public.set_round_done('${rid}', false)`));
test('admin set_round_done', () => run(K, `select public.set_round_done('${rid}', true)`));
test('admin sees the done round', () => count(1, K, 'select * from public.rounds where done'));
test('akshit (in team) sees no rounds', () => count(0, A, 'select * from public.rounds'));
test('mate (in team) sees no rounds', () => count(0, M, 'select * from public.rounds'));
test('admin set_round_done on a missing round -> 22023', () => code('22023', K, `select public.set_round_done('00000000-0000-0000-0000-000000000000', true)`));
test('mark_joined undo', () => run(M, `select public.mark_joined('555', false)`));

// ---- direct writes ---------------------------------------------------------------

test('member insert decision -> 42501', () => code('42501', M, `insert into public.decisions (id, status) values ('9','watching')`));
test('admin insert decision', () => run(K, `insert into public.decisions (id, status) values ('9','watching') returning id`));
test('admin delete decision', () => run(K, `delete from public.decisions where id='9' returning id`));
test('admin insert non-unstop manual -> 23514', () => code('23514', K, `insert into public.manual (id, url) values ('5','https://evil.com/5')`));
test('admin intl_dates hk-', () => run(K, `insert into public.intl_dates (id, regn_close) values ('hk-x','2026-12-01') returning id`));
test('intl_dates refuses other ids -> 23514', () => code('23514', K, `insert into public.intl_dates (id) values ('555')`));
test('member direct teams insert -> 42501', () => code('42501', M, `insert into public.teams (listing_id, section, invite_url) values ('2','case','https://x')`));
test('admin direct teams insert -> 42501', () => code('42501', K, `insert into public.teams (listing_id, section, invite_url) values ('2','case','https://x')`));
test('service direct decisions insert -> 42501', () => code('42501', 'service', `insert into public.decisions (id) values ('8')`));

// ---- sync_section ------------------------------------------------------------------

const rows = [{ id: 1759741, title: 'A', regn_close: '2026-10-20', comp_end: null, closed_on: null }, { id: 'intl-a', title: 'B', regn_close: '2026-11-01' }, { id: 42, title: 'old' }];
const rows2 = [{ ...rows[0], title: 'A2', closed_on: '2026-10-21' }, rows[1], rows[1]];
const sync = (section, r, a, s) => ['select public.sync_section($1, $2::jsonb, $3::jsonb, $4::jsonb) as c',
  [section, JSON.stringify(r), JSON.stringify(a), JSON.stringify(s)]];

test('sync 1', async () => assert.deepEqual((await run('service', ...sync('case', rows, [], { last_ok: 't1' })))[0].c, { archived: 0, upserted: 3, deleted: 0 }));
test('hack section, same id', () => run('service', ...sync('hack', [{ id: 1759741, title: 'H' }], [], {})));
test('sync 2 prunes 42, dup intl-a', async () => assert.deepEqual((await run('service', ...sync('case', rows2, [{ archive_key: '42', id: 42, title: 'old' }], { last_ok: 't2' })))[0].c, { archived: 1, upserted: 2, deleted: 1 }));
test('sync 3 archive conflict ignored', async () => assert.deepEqual((await run('service', ...sync('case', rows2, [{ archive_key: '42', id: 42, title: 'again' }], { last_ok: 't3' })))[0].c, { archived: 0, upserted: 2, deleted: 0 }));
test('listings correct; hack copy untouched', async () => {
  const L = await run(K, `select section, id, regn_close::text, closed_on::text, data->>'title' t from public.listings order by section, id`);
  assert.equal(L.length, 3);
  assert.equal(L.find(r => r.section === 'case' && r.id === '1759741').closed_on, '2026-10-21');
  assert.equal(L.find(r => r.section === 'hack').t, 'H');
  assert.ok(!L.find(r => r.id === '42'));
});
for (const t of ['listings', 'archive', 'source_status', 'rounds']) test(`after sync, stranger: ${t} -> 0 rows`, () => count(0, X, `select * from public.${t}`));
test('archive keeps the first insert', async () => {
  const Ar = await run(K, `select archive_key, data->>'title' t from public.archive`);
  assert.deepEqual(Ar, [{ archive_key: '42', t: 'old' }]);
});
test('sync empty rows refused -> 22023', () => code('22023', 'service', ...sync('case', [], [], {})));
test('sync row without id -> 22023', () => code('22023', 'service', ...sync('case', [{ title: 'x' }], [], {})));
test('sync status not an object -> 22023', () => code('22023', 'service', ...sync('case', rows2, [], [])));
test('set_status', () => run('service', `select public.set_status('case', '{"last_error":"boom"}')`));
test('set_status as admin -> 42501', () => code('42501', K, `select public.set_status('case', '{}')`));
test('set_status as radar_api -> 42501', () => code('42501', 'api', `select public.set_status('case', '{}')`));
test('sync_section as owner -> 42501 (only radar_service)', () => code('42501', 'owner', ...sync('case', rows2, [], {})));
test('status upserted', async () => {
  const S = await run(K, 'select section, data from public.source_status order by section');
  assert.equal(S[0].data.last_error, 'boom');
});

// ---- the jobs' role reads only what the jobs need ----------------------------------

for (const t of ['listings', 'source_status', 'watch', 'decisions', 'intl_dates', 'manual']) {
  test(`service reads ${t}`, () => run('service', `select * from public.${t}`));
}
for (const t of ['members', 'teams', 'team_members', 'rounds', 'archive']) {
  test(`service select ${t} -> 42501`, () => code('42501', 'service', `select * from public.${t}`));
}
test('service cannot change members -> 42501', () => code('42501', 'service', `update public.members set active = false`));
test('service upserts watch', () => run('service', `insert into public.watch (id, data) values ('w1', '{}') on conflict (id) do update set data = excluded.data returning id`));

// ---- Resolution 21: a teammate reads only their own rows and their teams ----

test('setup: listing for team 555 (case) and a watch row', async () => {
  await run('service', ...sync('case', [...rows2, { id: 555, title: 'Five Five Five', regn_close: '2026-10-30' }], [], { last_ok: 't4' }));
  await run('service', `insert into public.watch (id, data) values ('555', '{"changed_on":"2026-10-01"}')`);
});
test('setup: team on the hack listing (Krishna + Akshit)', () => run(K, `select public.create_team('1759741','hack','https://devfolio.co/invite/secret-hack',array['${K}','${A}'])`));
test('setup: team on the pruned (archived) listing 42 (Mate)', () => run(K, `select public.create_team('42','case','https://unstop.com/invite/old',array['${M}'])`));
test('setup: team on intl-a (Mate) with a confirmed date', async () => {
  await run(K, `select public.create_team('intl-a','case','https://example.org/invite/intl',array['${M}'])`);
  await run(K, `insert into public.intl_dates (id, regn_close) values ('intl-a','2026-11-05') on conflict (id) do update set regn_close = excluded.regn_close`);
});
test('mate joins 42', () => run(M, `select public.mark_joined('42', true)`));

test('mate sees only their own members row', async () => {
  assert.deepEqual(await run(M, 'select email from public.members'), [{ email: M }]);
});
test('mate sees only their own teams; not the hack team or its invite link', async () => {
  const mt = await run(M, 'select listing_id, invite_url from public.teams order by listing_id');
  assert.deepEqual(mt.map(r => r.listing_id), ['42', '555', 'intl-a']);
  assert.ok(!mt.some(r => r.invite_url.includes('secret-hack')));
});
test('mate cannot read the hack team by id', () => count(0, M, `select * from public.teams where listing_id='1759741'`));
test('mate sees only their own team_members rows (not Akshit\'s on 555)', async () => {
  const mtm = await run(M, 'select listing_id, email from public.team_members order by listing_id');
  assert.equal(mtm.length, 3);
  assert.ok(mtm.every(r => r.email === M));
});
test('mate cannot read Akshit\'s join row', () => count(0, M, `select * from public.team_members where email='${A}'`));
for (const t of ['listings', 'archive', 'source_status', 'watch', 'decisions', 'intl_dates', 'manual', 'rounds']) {
  test(`mate reads no ${t}`, () => count(0, M, `select * from public.${t}`));
}
test('mate cannot read the listing of a team they are in either (only via my_joins)', () => count(0, M, `select * from public.listings where id='555'`));
test('akshit reads only his own members row', () => count(1, A, 'select * from public.members'));
test('akshit reads no listings of teams he is not in', () => count(0, A, `select * from public.listings where id='42'`));

test('my_joins: mate\'s three teams with only the screen columns', async () => {
  const mj = await run(M, 'select * from public.my_joins()');
  const byId = Object.fromEntries(mj.map(r => [r.listing_id, r]));
  assert.deepEqual(Object.keys(byId).sort(), ['42', '555', 'intl-a']);
  assert.equal(byId['555'].title, 'Five Five Five');
  assert.equal(byId['555'].section, 'case');
  assert.equal(byId['555'].invite_url, 'https://unstop.com/invite/new');
  assert.equal(byId['555'].joined_at, null);
  assert.equal(new Date(byId['555'].regn_close).toISOString().slice(0, 10), '2026-10-30', 'listing deadline');
  assert.equal(byId['42'].title, 'old', 'archived title');
  assert.ok(byId['42'].joined_at);
  assert.equal(byId['intl-a'].title, 'B');
  assert.equal(new Date(byId['intl-a'].regn_close).toISOString().slice(0, 10), '2026-11-05', 'confirmed intl_dates deadline wins');
  assert.deepEqual(Object.keys(mj[0]).sort(), ['invite_url', 'joined_at', 'listing_id', 'regn_close', 'section', 'title']);
  assert.ok(!mj.some(r => String(r.invite_url).includes('secret-hack')));
});
test('akshit my_joins: hack title from the hack listing; his two teams only', async () => {
  const aj = await run(A, 'select listing_id, section, title from public.my_joins() order by listing_id');
  assert.deepEqual(aj, [{ listing_id: '1759741', section: 'hack', title: 'H' }, { listing_id: '555', section: 'case', title: 'Five Five Five' }]);
});
test('admin my_joins: only the admin\'s own team', () => count(1, K, 'select * from public.my_joins()'));
test('PUBLIC my_joins -> 42501', () => code('42501', 'nobody', 'select * from public.my_joins()'));
test('service my_joins -> 42501', () => code('42501', 'service', 'select * from public.my_joins()'));
test('stranger my_joins -> 42501', () => code('42501', X, 'select * from public.my_joins()'));
test('no email my_joins -> 42501', () => code('42501', '', 'select * from public.my_joins()'));
test('PUBLIC is_self -> 42501', () => code('42501', 'nobody', `select public.is_self('${M}')`));
test('mate direct team_members update -> 42501', () => code('42501', M, `update public.team_members set joined_at = now() where email='${A}'`));
test('mate direct rounds insert -> 42501', () => code('42501', M, `insert into public.rounds (listing_id, name) values ('555','x')`));
test('mate mark_joined on a team they are not in -> 42501', () => code('42501', M, `select public.mark_joined('1759741', true)`));
test('mate\'s mark_joined leaves Akshit\'s row alone', async () => {
  await run(M, `select public.mark_joined('555', true)`);
  const aRow = await run(K, `select joined_at from public.team_members where listing_id='555' and email='${A}'`);
  assert.equal(aRow[0].joined_at, null);
});
test('an inactive mate reads and calls nothing', async () => {
  await run('owner', `update public.members set active = false where email = '${M}'`);
  await count(0, M, 'select * from public.members');
  await count(0, M, 'select * from public.teams');
  await count(0, M, 'select * from public.team_members');
  await code('42501', M, 'select * from public.my_joins()');
  await run('owner', `update public.members set active = true where email = '${M}'`);
});

// ---- sign-in: login codes and sessions (radar_api only) --------------------------

const h = c => c.repeat(64).slice(0, 64); // a 64-hex "hash" made of one digit
test('issue_login_code: a stranger gets false and nothing is stored', async () => {
  assert.deepEqual(await run('api', 'select private.issue_login_code($1, $2) as ok', [X, h('1')]), [{ ok: false }]);
  assert.deepEqual(await run('owner', 'select count(*)::int n from private.login_codes'), [{ n: 0 }]);
});
test('issue_login_code: an active member gets a 60-second code', async () => {
  assert.deepEqual(await run('api', 'select private.issue_login_code($1, $2) as ok', [` ${M.toUpperCase()} `, h('2')]), [{ ok: true }]);
  const [c] = await run('owner', `select email, extract(epoch from expires_at - now())::int s from private.login_codes`);
  assert.equal(c.email, M);
  assert.ok(c.s > 50 && c.s <= 60, String(c.s));
});
test('exchange_login_code: a wrong code opens nothing', () => count(0, 'api', 'select * from private.exchange_login_code($1, $2)', [h('3'), h('a')]));
test('exchange_login_code: the right code opens a 30-day session, once', async () => {
  const [s] = await run('api', 'select * from private.exchange_login_code($1, $2)', [h('2'), h('b')]);
  assert.equal(s.email, M);
  const days = (new Date(s.expires_at) - Date.now()) / 864e5;
  assert.ok(days > 29.9 && days <= 30, String(days));
  await count(0, 'api', 'select * from private.exchange_login_code($1, $2)', [h('2'), h('c')]);
});
test('session_email: the session\'s email; unknown token null', async () => {
  assert.deepEqual(await run('api', 'select private.session_email($1) e', [h('b')]), [{ e: M }]);
  assert.deepEqual(await run('api', 'select private.session_email($1) e', [h('c')]), [{ e: null }]);
});
test('an expired code opens nothing and is spent', async () => {
  await run('api', 'select private.issue_login_code($1, $2)', [A, h('4')]);
  await run('owner', `update private.login_codes set expires_at = now() - interval '1 second' where code_hash = $1`, [h('4')]);
  await count(0, 'api', 'select * from private.exchange_login_code($1, $2)', [h('4'), h('d')]);
  await count(0, 'owner', 'select * from private.login_codes where code_hash = $1', [h('4')]);
});
test('a code whose member went inactive opens nothing', async () => {
  await run('api', 'select private.issue_login_code($1, $2)', [A, h('5')]);
  await run('owner', `update public.members set active = false where email = '${A}'`);
  await count(0, 'api', 'select * from private.exchange_login_code($1, $2)', [h('5'), h('e')]);
  assert.deepEqual(await run('api', 'select private.issue_login_code($1, $2) as ok', [A, h('6')]), [{ ok: false }], 'inactive: no code');
  await run('owner', `update public.members set active = true where email = '${A}'`);
});
test('session_email: null once the member is inactive, back when active', async () => {
  await run('owner', `update public.members set active = false where email = '${M}'`);
  assert.deepEqual(await run('api', 'select private.session_email($1) e', [h('b')]), [{ e: null }]);
  await run('owner', `update public.members set active = true where email = '${M}'`);
  assert.deepEqual(await run('api', 'select private.session_email($1) e', [h('b')]), [{ e: M }]);
});
test('session_email: null once expired; issue_login_code sweeps expired sessions', async () => {
  await run('owner', `insert into private.sessions (token_hash, email, expires_at) values ($1, $2, now() - interval '1 second')`, [h('f'), K]);
  assert.deepEqual(await run('api', 'select private.session_email($1) e', [h('f')]), [{ e: null }]);
  await run('api', 'select private.issue_login_code($1, $2)', [X, h('7')]);
  await count(0, 'owner', 'select * from private.sessions where token_hash = $1', [h('f')]);
});
test('end_session deletes the session', async () => {
  await run('api', 'select private.end_session($1)', [h('b')]);
  assert.deepEqual(await run('api', 'select private.session_email($1) e', [h('b')]), [{ e: null }]);
});
test('a hash that is not 64 hex characters is refused', () => code('23514', 'api', 'select private.issue_login_code($1, $2)', [M, 'abc']));
for (const who of ['api', 'service', K, 'nobody']) {
  test(`${who} cannot read private.sessions or private.login_codes`, async () => {
    await code('42501', who, 'select * from private.sessions');
    await code('42501', who, 'select * from private.login_codes');
  });
}
for (const who of ['service', K, 'nobody']) {
  test(`${who} cannot call the session functions`, async () => {
    await code('42501', who, `select private.session_email('${h('b')}')`);
    await code('42501', who, `select private.issue_login_code('${M}', '${h('8')}')`);
    await code('42501', who, `select * from private.exchange_login_code('${h('8')}', '${h('9')}')`);
    await code('42501', who, `select private.end_session('${h('b')}')`);
  });
}

// ---- roles and grants audit -----------------------------------------------------------

test('radar_api may switch to radar_member and radar_service but inherits neither', async () => {
  const [r] = await run('owner', `select
    pg_has_role('radar_api', 'radar_member', 'SET') ms, pg_has_role('radar_api', 'radar_service', 'SET') ss,
    pg_has_role('radar_api', 'radar_member', 'USAGE') mu, pg_has_role('radar_api', 'radar_service', 'USAGE') su,
    pg_has_role('radar_member', 'radar_service', 'MEMBER') m2s, pg_has_role('radar_service', 'radar_member', 'MEMBER') s2m,
    pg_has_role('radar_member', 'radar_api', 'MEMBER') m2a`);
  assert.deepEqual(r, { ms: true, ss: true, mu: false, su: false, m2s: false, s2m: false, m2a: false });
});
test('role attributes: only radar_api logs in; nobody bypasses RLS or is a superuser', async () => {
  const roles = await run('owner', `select rolname, rolcanlogin, rolbypassrls, rolsuper, rolinherit from pg_roles where rolname like 'radar_%' order by 1`);
  assert.deepEqual(roles, [
    { rolname: 'radar_api', rolcanlogin: true, rolbypassrls: false, rolsuper: false, rolinherit: false },
    { rolname: 'radar_member', rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolinherit: false },
    { rolname: 'radar_service', rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolinherit: false },
  ]);
});
test('no table grants to PUBLIC or radar_api, in public or private', async () => {
  await count(0, 'owner', `select * from information_schema.role_table_grants where table_schema in ('public', 'private') and grantee in ('PUBLIC', 'radar_api')`);
  await count(0, 'owner', `select * from information_schema.role_table_grants where table_schema = 'private' and grantee in ('radar_member', 'radar_service')`);
});
test('every function: no PUBLIC execute; grants exactly as designed', async () => {
  const fns = await run('owner', `select n.nspname || '.' || p.proname f, coalesce(array_to_string(p.proacl, ' '), '') acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') order by 1`);
  const want = {
    'public.caller_email': [], 'public.replace_team_members': [],
    'public.is_member': ['radar_member'], 'public.is_admin': ['radar_member'], 'public.in_team': ['radar_member'], 'public.is_self': ['radar_member'],
    'public.create_team': ['radar_member'], 'public.update_team': ['radar_member'], 'public.delete_team': ['radar_member'],
    'public.mark_joined': ['radar_member'], 'public.upsert_round': ['radar_member'], 'public.delete_round': ['radar_member'],
    'public.set_round_done': ['radar_member'], 'public.my_joins': ['radar_member'],
    'public.sync_section': ['radar_service'], 'public.set_status': ['radar_service'],
    'private.issue_login_code': ['radar_api'], 'private.exchange_login_code': ['radar_api'],
    'private.session_email': ['radar_api'], 'private.end_session': ['radar_api'],
  };
  assert.deepEqual(fns.map(r => r.f).sort(), Object.keys(want).sort());
  for (const { f, acl } of fns) {
    const grantees = acl.split(' ').filter(Boolean).map(e => e.split('=')[0]).filter(g => g && g !== 'postgres');
    assert.ok(!acl.split(' ').some(e => e.startsWith('=')), `${f}: PUBLIC execute (${acl})`);
    assert.deepEqual(grantees.sort(), want[f], f);
  }
});

// Objects created later (as the owner) are unreachable until granted.
test('objects created later are unreachable', async () => {
  await db.exec(`create table public.later (x int); insert into public.later values (1);
    create function public.later_fn() returns int language sql as $$ select 1 $$;
    create schema if not exists extensions; create function extensions.other_fn() returns int language sql as $$ select 2 $$;
    create sequence public.later_seq;`);
  for (const who of ['nobody', K, 'service', 'api']) {
    await code('42501', who, 'select * from public.later');
    await code('42501', who, 'select public.later_fn()');
    await code('42501', who, 'select extensions.other_fn()');
    await code('42501', who, "select nextval('public.later_seq')");
  }
});
