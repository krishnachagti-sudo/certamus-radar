-- Certamus Radar: the private team platform's database (plain Postgres).
-- Spec: linkedin repo docs/superpowers/specs/2026-10-04-certamus-radar-platform-design.md
-- (Resolutions 1-22 are binding; Resolution 22 moved it from Supabase to
-- Railway Postgres). Idempotent: safe to run twice. Apply it as the
-- database owner (Railway's `postgres` user): `node db/apply.mjs`.
-- This database must hold Radar only: the revokes and default privileges
-- below apply to the whole public schema.
--
-- Who connects: only the API service (api/), as the login role radar_api.
-- radar_api owns nothing and holds no table privileges. It can execute the
-- four session functions in `private`, and it can switch, per transaction,
-- to one of two nologin roles that hold the real privileges:
--
--   radar_member   a signed-in person. The API runs
--                    begin; set local role radar_member;
--                    select set_config('app.email', <session email>, true);
--                  The email comes only from a session row the API looked up
--                  by the hashed bearer token (private.session_email), and a
--                  session is only ever issued for an active members row
--                  after Google verified the address. Every policy and RPC
--                  below reads it through public.caller_email().
--     admin        (members.role 'admin') reads every table, writes
--                  decisions / intl_dates / manual directly and runs every
--                  team and round RPC.
--     member       (a teammate; Resolution 21) reads only: their own members
--                  row; teams they are in; their own team_members rows (not
--                  teammates' join status); and, through my_joins(), the
--                  title, section and registration deadline of those teams'
--                  listings. Writes only mark_joined (their own row). No
--                  listings, archive, source_status, watch, decisions,
--                  intl_dates, manual, rounds or other people's rows.
--   radar_service  the GitHub Actions jobs (bearer RADAR_SERVICE_TOKEN):
--                  sync_section / set_status, reads of listings,
--                  source_status, watch, decisions, intl_dates and manual,
--                  and watch upserts. Nothing about members, teams or rounds.
--
-- Anyone else (PUBLIC) gets nothing: no table grants, no function execute,
-- no schema usage.
-- Errors: 42501 = forbidden, 22023 = invalid input.

-- 0. Roles and default privileges ------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'radar_member') then create role radar_member nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'radar_service') then create role radar_service nologin; end if;
  -- No password here (the repo is public): set it with
  -- RADAR_API_PASSWORD=... node db/apply.mjs, or `alter role radar_api password '...'`.
  -- noinherit: radar_api gets nothing from the two roles unless it switches
  -- to one of them with set role.
  if not exists (select 1 from pg_roles where rolname = 'radar_api') then create role radar_api login noinherit; end if;
end
$$;
alter role radar_member nologin noinherit;
alter role radar_service nologin noinherit;
alter role radar_api noinherit nocreatedb nocreaterole;
grant radar_member to radar_api;
grant radar_service to radar_api;

-- Functions are executable by PUBLIC by default in every schema; that
-- built-in default can only be removed globally (no "in schema"). Plain
-- Postgres grants nothing else by default, so tables, sequences and
-- functions created later stay unreachable until granted.
alter default privileges revoke execute on functions from public;

revoke all on schema public from public;
grant usage on schema public to radar_member, radar_service;

-- 1. Tables ---------------------------------------------------------------------

create table if not exists public.members (
  email   text primary key check (email = lower(email) and email like '%_@_%' and length(email) <= 254),
  name    text not null check (length(name) between 1 and 80),
  role    text not null default 'member' check (role in ('admin', 'member')),
  active  boolean not null default true
);

-- One row per competition or hackathon; `data` is the record the pages use.
-- The same Unstop id can appear in both sections, hence (section, id).
create table if not exists public.listings (
  section     text not null check (section in ('case', 'hack')),
  id          text not null check (length(id) between 1 and 64),
  regn_close  date,
  comp_end    date,
  closed_on   date,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (section, id)
);

create table if not exists public.archive (
  section      text not null check (section in ('case', 'hack')),
  archive_key  text not null check (length(archive_key) between 1 and 128),
  data         jsonb not null,
  archived_on  date not null default (now() at time zone 'Asia/Kolkata')::date,
  primary key (section, archive_key)
);

create table if not exists public.source_status (
  section     text primary key check (section in ('case', 'hack')),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.watch (
  id          text primary key check (length(id) between 1 and 64),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.decisions (
  id          text primary key check (length(id) between 1 and 64),
  status      text check (status in ('watching', 'entering', 'skipped')),
  registered  boolean not null default false,
  note        text check (length(note) <= 1000),
  updated_at  timestamptz not null default now()
);

-- Confirmed dates for the curated lists (international, fests, hackathons).
create table if not exists public.intl_dates (
  id           text primary key
               constraint intl_dates_id_check check ((id like 'intl-%' or id like 'fest-%' or id like 'hk-%') and length(id) <= 64),
  regn_close   date,
  comp_end     date,
  confirmed_on date not null default current_date,
  check (regn_close is null or comp_end is null or comp_end >= regn_close)
);

-- Unstop links added by hand; the admin writes this table directly, so the
-- table itself insists on an Unstop link and a numeric id.
create table if not exists public.manual (
  id    text primary key constraint manual_id_digits check (id ~ '^[0-9]+$'),
  url   text not null check (length(url) <= 500)
        constraint manual_url_unstop check (url ~ '^https://(www\.)?unstop\.com/'),
  added date not null default current_date
);

-- Teams, keyed by listing id alone (shared across sections, like decisions).
-- No foreign key to listings: a team outlives its listing being pruned.
create table if not exists public.teams (
  listing_id  text primary key check (length(listing_id) between 1 and 64),
  section     text not null check (section in ('case', 'hack')),
  invite_url  text not null check (invite_url like 'https://%' and length(invite_url) <= 1000),
  note        text check (length(note) <= 1000),
  created_at  timestamptz not null default now()
);

create table if not exists public.team_members (
  listing_id  text not null references public.teams (listing_id) on delete cascade,
  email       text not null references public.members (email) on update cascade on delete cascade,
  joined_at   timestamptz,
  primary key (listing_id, email)
);

create table if not exists public.rounds (
  id           uuid primary key default gen_random_uuid(),
  listing_id   text not null references public.teams (listing_id) on delete cascade,
  name         text not null check (length(name) between 1 and 200),
  due          date,
  owner_email  text references public.members (email) on update cascade on delete set null,
  done         boolean not null default false,
  done_at      timestamptz
);
create index if not exists rounds_listing_id_idx on public.rounds (listing_id);
create index if not exists team_members_email_idx on public.team_members (email);

alter table public.members       enable row level security;
alter table public.listings      enable row level security;
alter table public.archive       enable row level security;
alter table public.source_status enable row level security;
alter table public.watch         enable row level security;
alter table public.decisions     enable row level security;
alter table public.intl_dates    enable row level security;
alter table public.manual        enable row level security;
alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.rounds        enable row level security;

-- 2. Table privileges -----------------------------------------------------------

revoke all on all tables in schema public from public, radar_member, radar_service, radar_api;
revoke all on all sequences in schema public from public, radar_member, radar_service, radar_api;
grant select on public.members, public.listings, public.archive, public.source_status, public.watch,
  public.decisions, public.intl_dates, public.manual, public.teams, public.team_members, public.rounds
  to radar_member;
grant insert, update, delete on public.decisions, public.intl_dates, public.manual to radar_member;
-- The jobs: what fetch/run.js, fetch/hack-run.js, fetch/watch.js and
-- db/seed.mjs use, nothing more (sync_section and set_status run with the
-- caller's privileges, so these cover their writes too).
grant select, insert, update, delete on public.listings to radar_service;
-- (on conflict needs select on the conflict target's columns.)
grant insert, select (section, archive_key) on public.archive to radar_service;
grant select, insert, update on public.source_status, public.watch to radar_service;
grant select on public.decisions, public.intl_dates, public.manual to radar_service;

-- 3. Helpers (used by the policies; security definer so they can read
-- members and team_members without tripping those tables' own policies).

-- Internal: the signed-in person's email, lowercased, or null. The API sets
-- app.email per transaction (set_config(..., true)); after such a
-- transaction the setting reads '' on that connection, hence nullif.
create or replace function public.caller_email() returns text
language sql stable security definer set search_path = ''
as $$
  select nullif(lower(btrim(current_setting('app.email', true))), '');
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.email = public.caller_email() and m.active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.email = public.caller_email() and m.active and m.role = 'admin');
$$;

create or replace function public.in_team(p_listing_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    join public.team_members t on t.email = m.email
    where m.email = public.caller_email() and m.active
      and t.listing_id = p_listing_id);
$$;

-- "Is this email the caller's own, on an active member row?" (the own-row
-- policies on members and team_members).
create or replace function public.is_self(p_email text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.email = public.caller_email() and m.active
      and m.email = lower(p_email));
$$;

revoke execute on function public.caller_email() from public;
revoke execute on function public.is_member() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.in_team(text) from public;
revoke execute on function public.is_self(text) from public;
grant execute on function public.is_member() to radar_member;
grant execute on function public.is_admin() to radar_member;
grant execute on function public.in_team(text) to radar_member;
grant execute on function public.is_self(text) to radar_member;

-- 4. Policies -------------------------------------------------------------------
-- Reads are the admin's, apart from a teammate's own rows (Resolution 21).

-- Own row for everyone (/auth/me reads the caller's name and role).
drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select to radar_member using ((select public.is_admin()) or public.is_self(email));

drop policy if exists "admin read" on public.listings;
create policy "admin read" on public.listings for select to radar_member using ((select public.is_admin()));
drop policy if exists "admin read" on public.archive;
create policy "admin read" on public.archive for select to radar_member using ((select public.is_admin()));
drop policy if exists "admin read" on public.source_status;
create policy "admin read" on public.source_status for select to radar_member using ((select public.is_admin()));
drop policy if exists "admin read" on public.watch;
create policy "admin read" on public.watch for select to radar_member using ((select public.is_admin()));

drop policy if exists "admin read" on public.decisions;
create policy "admin read" on public.decisions for select to radar_member using ((select public.is_admin()));
drop policy if exists "admin insert" on public.decisions;
create policy "admin insert" on public.decisions for insert to radar_member with check ((select public.is_admin()));
drop policy if exists "admin update" on public.decisions;
create policy "admin update" on public.decisions for update to radar_member using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "admin delete" on public.decisions;
create policy "admin delete" on public.decisions for delete to radar_member using ((select public.is_admin()));

drop policy if exists "admin read" on public.intl_dates;
create policy "admin read" on public.intl_dates for select to radar_member using ((select public.is_admin()));
drop policy if exists "admin insert" on public.intl_dates;
create policy "admin insert" on public.intl_dates for insert to radar_member with check ((select public.is_admin()));
drop policy if exists "admin update" on public.intl_dates;
create policy "admin update" on public.intl_dates for update to radar_member using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "admin delete" on public.intl_dates;
create policy "admin delete" on public.intl_dates for delete to radar_member using ((select public.is_admin()));

drop policy if exists "admin read" on public.manual;
create policy "admin read" on public.manual for select to radar_member using ((select public.is_admin()));
drop policy if exists "admin insert" on public.manual;
create policy "admin insert" on public.manual for insert to radar_member with check ((select public.is_admin()));
drop policy if exists "admin update" on public.manual;
create policy "admin update" on public.manual for update to radar_member using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "admin delete" on public.manual;
create policy "admin delete" on public.manual for delete to radar_member using ((select public.is_admin()));

-- Invite links are effectively passwords: admin and that team only. A
-- teammate sees only their own team_members rows, never teammates' join
-- status, and no rounds. No write policies: teams, team_members and rounds
-- change only via RPCs.
drop policy if exists "team read" on public.teams;
create policy "team read" on public.teams for select to radar_member using ((select public.is_admin()) or public.in_team(listing_id));
drop policy if exists "team read" on public.team_members;
create policy "team read" on public.team_members for select to radar_member using ((select public.is_admin()) or public.is_self(email));
drop policy if exists "admin read" on public.rounds;
create policy "admin read" on public.rounds for select to radar_member using ((select public.is_admin()));

-- The jobs (radar_service): whole tables, limited by the grants above.
drop policy if exists "service all" on public.listings;
create policy "service all" on public.listings for all to radar_service using (true) with check (true);
drop policy if exists "service all" on public.archive;
create policy "service all" on public.archive for all to radar_service using (true) with check (true);
drop policy if exists "service all" on public.source_status;
create policy "service all" on public.source_status for all to radar_service using (true) with check (true);
drop policy if exists "service all" on public.watch;
create policy "service all" on public.watch for all to radar_service using (true) with check (true);
drop policy if exists "service read" on public.decisions;
create policy "service read" on public.decisions for select to radar_service using (true);
drop policy if exists "service read" on public.intl_dates;
create policy "service read" on public.intl_dates for select to radar_service using (true);
drop policy if exists "service read" on public.manual;
create policy "service read" on public.manual for select to radar_service using (true);

-- 5. Team and round RPCs (radar_member; each checks the caller) -------------

-- Internal: make the team's membership exactly p_emails (lowercased,
-- trimmed, deduped; 1-5 active members), keeping joined_at for people who
-- stay. Only ever called from create_team / update_team; no grants.
create or replace function public.replace_team_members(p_listing_id text, p_emails text[])
returns void
language plpgsql set search_path = ''
as $$
declare
  v_emails text[];
  v_unknown text;
begin
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_emails
  from unnest(coalesce(p_emails, '{}')) as e
  where nullif(btrim(e), '') is not null;
  if cardinality(v_emails) not between 1 and 5 then
    raise exception 'a team needs 1 to 5 members' using errcode = '22023';
  end if;
  select e into v_unknown from unnest(v_emails) as e
  where not exists (select 1 from public.members m where m.email = e and m.active)
  limit 1;
  if v_unknown is not null then
    raise exception 'not an active member: %', v_unknown using errcode = '22023';
  end if;
  delete from public.team_members t
  where t.listing_id = p_listing_id and not (t.email = any (v_emails));
  insert into public.team_members (listing_id, email)
  select p_listing_id, e from unnest(v_emails) as e
  on conflict (listing_id, email) do nothing;
end;
$$;

create or replace function public.create_team(p_listing_id text, p_section text, p_invite_url text, p_emails text[])
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  p_listing_id := btrim(coalesce(p_listing_id, ''));
  p_invite_url := btrim(coalesce(p_invite_url, ''));
  if length(p_listing_id) not between 1 and 64 then
    raise exception 'bad listing id' using errcode = '22023';
  end if;
  if p_section is null or p_section not in ('case', 'hack') then
    raise exception 'section must be case or hack' using errcode = '22023';
  end if;
  if p_invite_url !~ '^https://[^[:space:]]+$' or length(p_invite_url) > 1000 then
    raise exception 'invite link must be an https:// URL' using errcode = '22023';
  end if;
  if exists (select 1 from public.teams where listing_id = p_listing_id) then
    raise exception 'team exists, use update_team' using errcode = '22023';
  end if;
  insert into public.teams (listing_id, section, invite_url)
  values (p_listing_id, p_section, p_invite_url);
  perform public.replace_team_members(p_listing_id, p_emails);
  -- Creating the team is registering: keep any existing status and note.
  insert into public.decisions (id, registered, updated_at) values (p_listing_id, true, now())
  on conflict (id) do update set registered = true, updated_at = now();
end;
$$;

create or replace function public.update_team(p_listing_id text, p_invite_url text, p_emails text[])
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  p_invite_url := btrim(coalesce(p_invite_url, ''));
  if p_invite_url !~ '^https://[^[:space:]]+$' or length(p_invite_url) > 1000 then
    raise exception 'invite link must be an https:// URL' using errcode = '22023';
  end if;
  update public.teams set invite_url = p_invite_url where listing_id = p_listing_id;
  if not found then raise exception 'no such team' using errcode = '22023'; end if;
  perform public.replace_team_members(p_listing_id, p_emails);
end;
$$;

-- Deletes the team, its members and its rounds; the decision is left as is.
create or replace function public.delete_team(p_listing_id text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.teams where listing_id = p_listing_id;
end;
$$;

-- The caller's own row only, and only in a team they are in.
create or replace function public.mark_joined(p_listing_id text, p_joined boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.in_team(p_listing_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.team_members
  set joined_at = case when coalesce(p_joined, false) then coalesce(joined_at, now()) end
  where listing_id = p_listing_id and email = public.caller_email();
end;
$$;

-- p_id null = new round. Returns the round id.
create or replace function public.upsert_round(p_id uuid, p_listing_id text, p_name text, p_due date, p_owner_email text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_owner text := nullif(lower(btrim(coalesce(p_owner_email, ''))), '');
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) not between 1 and 200 then
    raise exception 'round name must be 1 to 200 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.teams where listing_id = p_listing_id) then
    raise exception 'no such team' using errcode = '22023';
  end if;
  if v_owner is not null and not exists (select 1 from public.members m where m.email = v_owner and m.active) then
    raise exception 'not an active member: %', v_owner using errcode = '22023';
  end if;
  if exists (select 1 from public.rounds where id = v_id and listing_id <> p_listing_id) then
    raise exception 'round belongs to another team' using errcode = '22023';
  end if;
  insert into public.rounds (id, listing_id, name, due, owner_email)
  values (v_id, p_listing_id, p_name, p_due, v_owner)
  on conflict (id) do update set name = excluded.name, due = excluded.due, owner_email = excluded.owner_email;
  return v_id;
end;
$$;

create or replace function public.delete_round(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.rounds where id = p_id;
end;
$$;

-- Admin only (Resolution 21: rounds are the admin's).
create or replace function public.set_round_done(p_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.rounds where id = p_id) then
    raise exception 'no such round' using errcode = '22023';
  end if;
  update public.rounds
  set done = coalesce(p_done, false),
      done_at = case when coalesce(p_done, false) then coalesce(done_at, now()) end
  where id = p_id;
end;
$$;

-- The member screen's one read (Resolution 21): one row per team the caller
-- is in, with only what the screen shows. The title and deadline come from
-- the team's listing (its own section first, then the other one; the
-- deadline from a confirmed intl_dates row when there is one), else the
-- newest archived edition's title. Other columns of listings, and other
-- people's join rows, never leave the database. Not a member: forbidden.
create or replace function public.my_joins()
returns table (listing_id text, section text, title text, regn_close date, invite_url text, joined_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_member() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select t.listing_id, t.section,
    coalesce(own.data ->> 'title', oth.data ->> 'title', arc.title),
    coalesce(d.regn_close, own.regn_close, oth.regn_close),
    t.invite_url, tm.joined_at
  from public.team_members tm
  join public.members m on m.email = tm.email and m.active
  join public.teams t on t.listing_id = tm.listing_id
  left join public.listings own on own.section = t.section and own.id = t.listing_id
  left join public.listings oth on oth.section <> t.section and oth.id = t.listing_id
  left join public.intl_dates d on d.id = t.listing_id
  left join lateral (
    select a.data ->> 'title' as title from public.archive a
    where a.section = t.section and a.data ->> 'id' = t.listing_id
    order by a.archived_on desc, a.archive_key desc limit 1) arc on true
  where tm.email = public.caller_email()
  order by t.listing_id;
end;
$$;

revoke execute on function public.replace_team_members(text, text[]) from public;
revoke execute on function public.create_team(text, text, text, text[]) from public;
revoke execute on function public.update_team(text, text, text[]) from public;
revoke execute on function public.delete_team(text) from public;
revoke execute on function public.mark_joined(text, boolean) from public;
revoke execute on function public.upsert_round(uuid, text, text, date, text) from public;
revoke execute on function public.delete_round(uuid) from public;
revoke execute on function public.set_round_done(uuid, boolean) from public;
revoke execute on function public.my_joins() from public;
grant execute on function public.create_team(text, text, text, text[]) to radar_member;
grant execute on function public.update_team(text, text, text[]) to radar_member;
grant execute on function public.delete_team(text) to radar_member;
grant execute on function public.mark_joined(text, boolean) to radar_member;
grant execute on function public.upsert_round(uuid, text, text, date, text) to radar_member;
grant execute on function public.delete_round(uuid) to radar_member;
grant execute on function public.set_round_done(uuid, boolean) to radar_member;
grant execute on function public.my_joins() to radar_member;

-- 6. Fetcher write path (radar_service only) ----------------------------------------
-- Security invoker on purpose: inside a security definer function the
-- caller's role is not visible (current_user is the owner), so these run
-- with the caller's own privileges and check current_user = radar_service;
-- the execute grant says the same.

-- One section's whole write, in one transaction: archive the pruned records
-- (ignoring ones already archived), upsert the live rows, delete the
-- section's rows that are no longer live, then record the run status.
-- p_rows: the full live record array merge() returned; each element's id is
-- data->>'id' (Unstop ids are JSON numbers, stored as text). p_archive: the
-- new archive entries, each carrying archive_key. Refuses an empty p_rows
-- while the section has rows, so a bug can never blank the board.
create or replace function public.sync_section(p_section text, p_rows jsonb, p_archive jsonb, p_status jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_ids text[];
  v_archived integer;
  v_upserted integer;
  v_deleted integer;
begin
  if current_user <> 'radar_service' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_section is null or p_section not in ('case', 'hack') then
    raise exception 'section must be case or hack' using errcode = '22023';
  end if;
  p_archive := coalesce(p_archive, '[]'::jsonb);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_archive) <> 'array' then
    raise exception 'rows and archive must be arrays' using errcode = '22023';
  end if;
  if jsonb_typeof(p_status) is distinct from 'object' then
    raise exception 'status must be an object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) as r(v)
             where jsonb_typeof(r.v) <> 'object' or nullif(r.v ->> 'id', '') is null) then
    raise exception 'every row needs an id' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_archive) as a(v)
             where jsonb_typeof(a.v) <> 'object' or nullif(a.v ->> 'archive_key', '') is null) then
    raise exception 'every archive entry needs an archive_key' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 and exists (select 1 from public.listings where section = p_section) then
    raise exception 'refusing to empty section %', p_section using errcode = '22023';
  end if;

  -- 1. Archive first: a record is never deleted without being archived.
  insert into public.archive (section, archive_key, data)
  select p_section, a.v ->> 'archive_key', a.v
  from jsonb_array_elements(p_archive) as a(v)
  on conflict (section, archive_key) do nothing;
  get diagnostics v_archived = row_count;

  -- 2. Upsert the live rows (last occurrence wins if an id repeats).
  insert into public.listings (section, id, regn_close, comp_end, closed_on, data, updated_at)
  select distinct on (r.v ->> 'id')
    p_section,
    r.v ->> 'id',
    case when r.v ->> 'regn_close' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (r.v ->> 'regn_close')::date end,
    case when r.v ->> 'comp_end' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (r.v ->> 'comp_end')::date end,
    case when r.v ->> 'closed_on' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (r.v ->> 'closed_on')::date end,
    r.v,
    now()
  from jsonb_array_elements(p_rows) with ordinality as r(v, n)
  order by r.v ->> 'id', r.n desc
  on conflict (section, id) do update set
    regn_close = excluded.regn_close,
    comp_end = excluded.comp_end,
    closed_on = excluded.closed_on,
    data = excluded.data,
    updated_at = case when public.listings.data is distinct from excluded.data
                      then now() else public.listings.updated_at end;
  get diagnostics v_upserted = row_count;

  -- 3. Whatever merge() dropped from this section goes.
  select coalesce(array_agg(r.v ->> 'id'), '{}') into v_ids from jsonb_array_elements(p_rows) as r(v);
  delete from public.listings l where l.section = p_section and not (l.id = any (v_ids));
  get diagnostics v_deleted = row_count;

  -- 4. Run status for the banner.
  insert into public.source_status (section, data, updated_at) values (p_section, p_status, now())
  on conflict (section) do update set data = excluded.data, updated_at = now();

  return jsonb_build_object('archived', v_archived, 'upserted', v_upserted, 'deleted', v_deleted);
end;
$$;

-- A failed run: record the status only (the caller carries the old last_ok).
create or replace function public.set_status(p_section text, p_status jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user <> 'radar_service' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_section is null or p_section not in ('case', 'hack') then
    raise exception 'section must be case or hack' using errcode = '22023';
  end if;
  if jsonb_typeof(p_status) is distinct from 'object' then
    raise exception 'status must be an object' using errcode = '22023';
  end if;
  insert into public.source_status (section, data, updated_at) values (p_section, p_status, now())
  on conflict (section) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke execute on function public.sync_section(text, jsonb, jsonb, jsonb) from public;
revoke execute on function public.set_status(text, jsonb) from public;
grant execute on function public.sync_section(text, jsonb, jsonb, jsonb) to radar_service;
grant execute on function public.set_status(text, jsonb) to radar_service;

-- 7. Sign-in: one-time login codes and sessions (radar_api only) ---------------
-- Only hashes are stored (sha256 hex of the random code / token the API
-- hands out), so a copy of this schema's rows signs nobody in. radar_api
-- reaches these tables only through the four functions below.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to radar_api;

-- bind_hash: sha256 of a random value the signing-in browser keeps in its
-- sessionStorage; only that browser can spend the code (login CSRF).
create table if not exists private.login_codes (
  code_hash   text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  email       text not null references public.members (email) on update cascade on delete cascade,
  bind_hash   text not null check (bind_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz not null
);

create table if not exists private.sessions (
  token_hash  text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  email       text not null references public.members (email) on update cascade on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_email_idx on private.sessions (email);

revoke all on all tables in schema private from public, radar_member, radar_service, radar_api;
alter table private.login_codes enable row level security;
alter table private.sessions enable row level security;

-- An earlier draft of these two functions took no binding; drop it if a
-- database ever got it, so only the bound versions exist.
drop function if exists private.issue_login_code(text, text);
drop function if exists private.exchange_login_code(text, text);

-- After Google verified p_email: a 60-second one-time code for an active
-- member, bound to the browser that started the sign-in (p_bind_hash), or
-- false (not on the team list; nothing stored). Also sweeps expired codes
-- and sessions.
create or replace function private.issue_login_code(p_email text, p_code_hash text, p_bind_hash text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  delete from private.login_codes where expires_at <= now();
  delete from private.sessions where expires_at <= now();
  if not exists (select 1 from public.members m where m.email = lower(btrim(p_email)) and m.active) then
    return false;
  end if;
  insert into private.login_codes (code_hash, email, bind_hash, expires_at)
  values (p_code_hash, lower(btrim(p_email)), p_bind_hash, now() + interval '60 seconds');
  return true;
end;
$$;

-- Spends a login code (whatever the outcome, it is gone) and, if it was
-- live, presented with the binding of the browser it was issued to, and its
-- member still active, opens a 30-day session for p_token_hash. Returns the
-- session's email and expiry, or no row.
create or replace function private.exchange_login_code(p_code_hash text, p_token_hash text, p_bind_hash text)
returns table (email text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email text;
  v_expires timestamptz;
  v_bind text;
begin
  delete from private.login_codes c where c.code_hash = p_code_hash
  returning c.email, c.expires_at, c.bind_hash into v_email, v_expires, v_bind;
  if v_email is null or v_expires <= now() then return; end if;
  if p_bind_hash is null or v_bind is distinct from p_bind_hash then return; end if;
  if not exists (select 1 from public.members m where m.email = v_email and m.active) then return; end if;
  insert into private.sessions (token_hash, email, expires_at)
  values (p_token_hash, v_email, now() + interval '30 days');
  return query select s.email, s.expires_at from private.sessions s where s.token_hash = p_token_hash;
end;
$$;

-- The email behind a live session of an active member, else null. A member
-- set inactive loses access on their next request.
create or replace function private.session_email(p_token_hash text)
returns text
language sql stable security definer set search_path = ''
as $$
  select s.email from private.sessions s
  join public.members m on m.email = s.email and m.active
  where s.token_hash = p_token_hash and s.expires_at > now();
$$;

create or replace function private.end_session(p_token_hash text)
returns void
language sql security definer set search_path = ''
as $$
  delete from private.sessions where token_hash = p_token_hash;
$$;

revoke execute on function private.issue_login_code(text, text, text) from public;
revoke execute on function private.exchange_login_code(text, text, text) from public;
revoke execute on function private.session_email(text) from public;
revoke execute on function private.end_session(text) from public;
grant execute on function private.issue_login_code(text, text, text) to radar_api;
grant execute on function private.exchange_login_code(text, text, text) to radar_api;
grant execute on function private.session_email(text) to radar_api;
grant execute on function private.end_session(text) to radar_api;

-- 8. Members seed -------------------------------------------------------------------
-- Teammates are added at cutover (lowercase Gmail addresses), e.g.:
-- insert into public.members (email, name, role) values ('teammate1@example.com', 'Name', 'member') on conflict (email) do nothing;
-- insert into public.members (email, name, role) values ('teammate2@example.com', 'Name', 'member') on conflict (email) do nothing;
-- insert into public.members (email, name, role) values ('teammate3@example.com', 'Name', 'member') on conflict (email) do nothing;
-- insert into public.members (email, name, role) values ('akshit@example.com', 'Akshit', 'member') on conflict (email) do nothing;

insert into public.members (email, name, role, active) values ('krishnachagti@gmail.com', 'Krishna', 'admin', true)
on conflict (email) do update set role = 'admin', active = true;
