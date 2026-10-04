-- Certamus Radar v3: the private team platform.
-- Spec: linkedin repo docs/superpowers/specs/2026-10-04-certamus-radar-platform-design.md
-- (Resolutions 1-20 are binding). Idempotent: safe to run twice in the
-- Supabase SQL Editor. Replaces the v2 schema (public reads plus a #key
-- editor path through private.editor_key), which it dismantles below.
-- This Supabase project must hold Radar only: the revokes and default
-- privileges below apply to the whole public schema.
--
-- Access model:
--   anon           nothing at all (no table grants, no function execute)
--   authenticated  any Google account can get this role, so every policy
--                  checks public.is_member(): the caller's linked Google
--                  identity (auth.identities, provider 'google') carries the
--                  email of an active row in public.members. The JWT's own
--                  email claim is never trusted.
--   service_role   the GitHub Actions jobs: sync_section / set_status and
--                  direct reads/writes of listings, archive, watch etc.
-- Errors: 42501 = forbidden, 22023 = invalid input.

alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
-- Functions are executable by PUBLIC by default in every schema; that
-- built-in default can only be removed globally (no "in schema").
alter default privileges for role postgres revoke execute on functions from public;
-- Supabase grants anon and authenticated everything on new tables and
-- sequences in public; nothing created later is reachable until granted.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- 1. Retire the public-read policies and the editor-key path -----------------

drop policy if exists "public read" on public.decisions;
drop policy if exists "public read" on public.intl_dates;
drop policy if exists "public read" on public.manual;

drop function if exists public.check_editor(text);
drop function if exists public.set_decision(text, text, text, boolean, text);
drop function if exists public.set_intl_dates(text, text, date, date);
drop function if exists public.add_manual(text, text);
drop schema if exists private cascade;

revoke execute on all functions in schema public from public, anon, authenticated;

-- 2. Tables ---------------------------------------------------------------------

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

-- Existing tables (created by the v2 schema); repeated here so a fresh project
-- gets them too. Their constraints are adjusted below.
create table if not exists public.decisions (
  id          text primary key check (length(id) between 1 and 64),
  status      text check (status in ('watching', 'entering', 'skipped')),
  registered  boolean not null default false,
  note        text check (length(note) <= 1000),
  updated_at  timestamptz not null default now()
);

create table if not exists public.intl_dates (
  id           text primary key,
  regn_close   date,
  comp_end     date,
  confirmed_on date not null default current_date,
  check (regn_close is null or comp_end is null or comp_end >= regn_close)
);

create table if not exists public.manual (
  id    text primary key,
  url   text not null check (length(url) <= 500),
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

-- Widen the international-dates id check to the fest and hackathon lists.
alter table public.intl_dates drop constraint if exists intl_dates_id_check;
alter table public.intl_dates add constraint intl_dates_id_check
  check ((id like 'intl-%' or id like 'fest-%' or id like 'hk-%') and length(id) <= 64);

-- The admin now writes manual directly (no add_manual RPC), so the table
-- itself insists on an Unstop link and a numeric id. Not valid: existing
-- rows were already checked by add_manual.
alter table public.manual drop constraint if exists manual_url_unstop;
alter table public.manual add constraint manual_url_unstop
  check (url ~ '^https://(www\.)?unstop\.com/') not valid;
alter table public.manual drop constraint if exists manual_id_digits;
alter table public.manual add constraint manual_id_digits
  check (id ~ '^[0-9]+$') not valid;

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

-- 3. Table privileges -----------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.members, public.listings, public.archive, public.source_status, public.watch,
  public.decisions, public.intl_dates, public.manual, public.teams, public.team_members, public.rounds
  to authenticated;
grant insert, update, delete on public.decisions, public.intl_dates, public.manual to authenticated;
grant all on public.members, public.listings, public.archive, public.source_status, public.watch,
  public.decisions, public.intl_dates, public.manual, public.teams, public.team_members, public.rounds
  to service_role;

-- 4. Helpers (used by the policies; security definer so they can read
-- auth.identities, members and team_members without tripping those tables'
-- own policies). Identity comes from the caller's linked Google identity,
-- not from the JWT's email claim.

-- Internal: the lowercased emails of the caller's Google identities.
create or replace function public.google_emails() returns setof text
language sql stable security definer set search_path = ''
as $$
  select lower(i.identity_data ->> 'email')
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'google'
    and nullif(i.identity_data ->> 'email', '') is not null;
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.identities i
    join public.members m on m.email = lower(i.identity_data ->> 'email')
    where i.user_id = auth.uid() and i.provider = 'google' and m.active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.identities i
    join public.members m on m.email = lower(i.identity_data ->> 'email')
    where i.user_id = auth.uid() and i.provider = 'google' and m.active and m.role = 'admin');
$$;

create or replace function public.in_team(p_listing_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.identities i
    join public.members m on m.email = lower(i.identity_data ->> 'email')
    join public.team_members t on t.email = m.email
    where i.user_id = auth.uid() and i.provider = 'google' and m.active
      and t.listing_id = p_listing_id);
$$;

revoke execute on function public.google_emails() from public, anon, authenticated;
revoke execute on function public.is_member() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.in_team(text) from public, anon, authenticated;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.in_team(text) to authenticated;

-- 5. Policies -------------------------------------------------------------------

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select to authenticated using ((select public.is_member()));

drop policy if exists "members read" on public.listings;
create policy "members read" on public.listings for select to authenticated using ((select public.is_member()));
drop policy if exists "members read" on public.archive;
create policy "members read" on public.archive for select to authenticated using ((select public.is_member()));
drop policy if exists "members read" on public.source_status;
create policy "members read" on public.source_status for select to authenticated using ((select public.is_member()));
drop policy if exists "members read" on public.watch;
create policy "members read" on public.watch for select to authenticated using ((select public.is_member()));

drop policy if exists "members read" on public.decisions;
create policy "members read" on public.decisions for select to authenticated using ((select public.is_member()));
drop policy if exists "admin insert" on public.decisions;
create policy "admin insert" on public.decisions for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "admin update" on public.decisions;
create policy "admin update" on public.decisions for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "admin delete" on public.decisions;
create policy "admin delete" on public.decisions for delete to authenticated using ((select public.is_admin()));

drop policy if exists "members read" on public.intl_dates;
create policy "members read" on public.intl_dates for select to authenticated using ((select public.is_member()));
drop policy if exists "admin insert" on public.intl_dates;
create policy "admin insert" on public.intl_dates for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "admin update" on public.intl_dates;
create policy "admin update" on public.intl_dates for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "admin delete" on public.intl_dates;
create policy "admin delete" on public.intl_dates for delete to authenticated using ((select public.is_admin()));

drop policy if exists "members read" on public.manual;
create policy "members read" on public.manual for select to authenticated using ((select public.is_member()));
drop policy if exists "admin insert" on public.manual;
create policy "admin insert" on public.manual for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "admin update" on public.manual;
create policy "admin update" on public.manual for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "admin delete" on public.manual;
create policy "admin delete" on public.manual for delete to authenticated using ((select public.is_admin()));

-- Invite links are effectively passwords: admin and that team only.
-- No write policies: teams, team_members and rounds change only via RPCs.
drop policy if exists "team read" on public.teams;
create policy "team read" on public.teams for select to authenticated using ((select public.is_admin()) or public.in_team(listing_id));
drop policy if exists "team read" on public.team_members;
create policy "team read" on public.team_members for select to authenticated using ((select public.is_admin()) or public.in_team(listing_id));
drop policy if exists "team read" on public.rounds;
create policy "team read" on public.rounds for select to authenticated using ((select public.is_admin()) or public.in_team(listing_id));

-- 6. Team and round RPCs (authenticated; each checks the caller) -------------

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
  where listing_id = p_listing_id and email in (select public.google_emails());
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

create or replace function public.set_round_done(p_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_listing text;
begin
  if not public.is_member() then raise exception 'forbidden' using errcode = '42501'; end if;
  select listing_id into v_listing from public.rounds where id = p_id;
  if not found then raise exception 'no such round' using errcode = '22023'; end if;
  if not (public.is_admin() or public.in_team(v_listing)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.rounds
  set done = coalesce(p_done, false),
      done_at = case when coalesce(p_done, false) then coalesce(done_at, now()) end
  where id = p_id;
end;
$$;

revoke execute on function public.replace_team_members(text, text[]) from public, anon, authenticated;
revoke execute on function public.create_team(text, text, text, text[]) from public, anon, authenticated;
revoke execute on function public.update_team(text, text, text[]) from public, anon, authenticated;
revoke execute on function public.delete_team(text) from public, anon, authenticated;
revoke execute on function public.mark_joined(text, boolean) from public, anon, authenticated;
revoke execute on function public.upsert_round(uuid, text, text, date, text) from public, anon, authenticated;
revoke execute on function public.delete_round(uuid) from public, anon, authenticated;
revoke execute on function public.set_round_done(uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_team(text, text, text, text[]) to authenticated;
grant execute on function public.update_team(text, text, text[]) to authenticated;
grant execute on function public.delete_team(text) to authenticated;
grant execute on function public.mark_joined(text, boolean) to authenticated;
grant execute on function public.upsert_round(uuid, text, text, date, text) to authenticated;
grant execute on function public.delete_round(uuid) to authenticated;
grant execute on function public.set_round_done(uuid, boolean) to authenticated;

-- 7. Fetcher write path (service_role only) ---------------------------------------

-- One section's whole write, in one transaction: archive the pruned records
-- (ignoring ones already archived), upsert the live rows, delete the
-- section's rows that are no longer live, then record the run status.
-- p_rows: the full live record array merge() returned; each element's id is
-- data->>'id' (Unstop ids are JSON numbers, stored as text). p_archive: the
-- new archive entries, each carrying archive_key. Refuses an empty p_rows
-- while the section has rows, so a bug can never blank the board.
create or replace function public.sync_section(p_section text, p_rows jsonb, p_archive jsonb, p_status jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ids text[];
  v_archived integer;
  v_upserted integer;
  v_deleted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
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
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
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

revoke execute on function public.sync_section(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.set_status(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_section(text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.set_status(text, jsonb) to service_role;

-- 8. Members seed -------------------------------------------------------------------
-- Teammates are added at cutover (lowercase emails), e.g.:
-- insert into public.members (email, name, role) values ('teammate1@example.com', 'Name', 'member') on conflict (email) do nothing;
-- insert into public.members (email, name, role) values ('teammate2@example.com', 'Name', 'member') on conflict (email) do nothing;
-- insert into public.members (email, name, role) values ('teammate3@example.com', 'Name', 'member') on conflict (email) do nothing;
-- insert into public.members (email, name, role) values ('akshit@example.com', 'Akshit', 'member') on conflict (email) do nothing;

insert into public.members (email, name, role, active) values ('krishnachagti@gmail.com', 'Krishna', 'admin', true)
on conflict (email) do update set role = 'admin', active = true;
