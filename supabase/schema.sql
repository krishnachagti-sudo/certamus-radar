-- Certamus Radar: team decisions, confirmed international dates, hand-added links.
-- Anyone can read. The only way to write is the three functions below, and each
-- checks the editor key against a stored SHA-256 hash (the key itself is never
-- stored). Run once in the Supabase SQL Editor.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.editor_key (hash text primary key);
insert into private.editor_key (hash)
values ('1e8ae88a6fa5716e916b982e85fba7205dcb87e3a8b68cbc691fbff239f56ddb')
on conflict do nothing;

create or replace function private.key_ok(k text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select k is not null and exists (
    select 1 from private.editor_key
    where hash = encode(extensions.digest(k, 'sha256'), 'hex'));
$$;

-- Tables ---------------------------------------------------------------------

create table if not exists public.decisions (
  id          text primary key check (length(id) between 1 and 64),
  status      text check (status in ('watching', 'entering', 'skipped')),
  registered  boolean not null default false,
  note        text check (length(note) <= 1000),
  updated_at  timestamptz not null default now()
);

create table if not exists public.intl_dates (
  id           text primary key check (id like 'intl-%' and length(id) <= 64),
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

alter table public.decisions  enable row level security;
alter table public.intl_dates enable row level security;
alter table public.manual     enable row level security;

drop policy if exists "public read" on public.decisions;
drop policy if exists "public read" on public.intl_dates;
drop policy if exists "public read" on public.manual;
create policy "public read" on public.decisions  for select to anon, authenticated using (true);
create policy "public read" on public.intl_dates for select to anon, authenticated using (true);
create policy "public read" on public.manual     for select to anon, authenticated using (true);
-- No insert/update/delete policies: direct writes are refused.

-- Write functions --------------------------------------------------------------

create or replace function public.check_editor(k text) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.key_ok(k); $$;

create or replace function public.set_decision(
  k text, p_id text, p_status text, p_registered boolean, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.key_ok(k) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_status is null and not coalesce(p_registered, false) and p_note is null then
    delete from public.decisions where id = p_id;
  else
    insert into public.decisions (id, status, registered, note, updated_at)
    values (p_id, p_status, coalesce(p_registered, false), p_note, now())
    on conflict (id) do update
      set status = excluded.status, registered = excluded.registered,
          note = excluded.note, updated_at = now();
  end if;
end;
$$;

create or replace function public.set_intl_dates(
  k text, p_id text, p_regn_close date, p_comp_end date)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.key_ok(k) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_regn_close is null and p_comp_end is null then
    delete from public.intl_dates where id = p_id;
  else
    insert into public.intl_dates (id, regn_close, comp_end, confirmed_on)
    values (p_id, p_regn_close, p_comp_end, current_date)
    on conflict (id) do update
      set regn_close = excluded.regn_close, comp_end = excluded.comp_end,
          confirmed_on = current_date;
  end if;
end;
$$;

create or replace function public.add_manual(k text, p_url text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare m text[];
begin
  if not private.key_ok(k) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  m := regexp_match(p_url, '^https://(www\.)?unstop\.com/[^?#]*-([0-9]+)/?([?#].*)?$');
  if m is null then
    raise exception 'Only Unstop competition links' using errcode = '22023';
  end if;
  insert into public.manual (id, url) values (m[2], p_url) on conflict (id) do nothing;
  return m[2];
end;
$$;

revoke all on function private.key_ok(text) from public, anon, authenticated;
revoke all on function public.check_editor(text) from public;
revoke all on function public.set_decision(text, text, text, boolean, text) from public;
revoke all on function public.set_intl_dates(text, text, date, date) from public;
revoke all on function public.add_manual(text, text) from public;
grant execute on function public.check_editor(text) to anon, authenticated;
grant execute on function public.set_decision(text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.set_intl_dates(text, text, date, date) to anon, authenticated;
grant execute on function public.add_manual(text, text) to anon, authenticated;
grant select on public.decisions, public.intl_dates, public.manual to anon, authenticated;
