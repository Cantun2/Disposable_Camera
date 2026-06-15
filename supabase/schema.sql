-- ───────────────────────────────────────────────────────────────────────────
-- Disposable Wedding Cam — database schema + Row Level Security.
-- Run this in the Supabase SQL editor once per project.
-- Safe to re-run: every statement uses if-not-exists / drop-if-exists /
-- create-or-replace guards, so this whole file is idempotent.
--
-- SECURITY MODEL (see README "Auth & RLS model"):
--   • Guests are anonymous (role `anon`). They may READ active events and READ
--     photos, and may INSERT photos ONLY into an active event and ONLY up to
--     that event's per-guest limit (enforced server-side — clearing
--     localStorage cannot bypass it).
--   • Operators sign in with Supabase Auth (role `authenticated`). Only they can
--     create / edit / archive / delete events and delete (moderate) photos.
-- ───────────────────────────────────────────────────────────────────────────

-- 0. Events table — created from the admin console, read by guest room pages.
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  event_date  date,
  photo_limit int not null default 20,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Older deployments may predate the is_active flag — add it idempotently.
alter table public.events
  add column if not exists is_active boolean not null default true;

alter table public.events enable row level security;

-- Guests (anon) may read ONLY active events. Archiving an event (is_active =
-- false) instantly makes its room behave as "not active" on the guest side
-- without deleting any data. Operators read everything via the authenticated
-- policy below.
drop policy if exists "anon can read events" on public.events;
drop policy if exists "anon can read active events" on public.events;
create policy "anon can read active events"
  on public.events for select
  to anon
  using (is_active);

-- Operators (signed in) can read every event, active or archived.
drop policy if exists "authenticated can read events" on public.events;
create policy "authenticated can read events"
  on public.events for select
  to authenticated
  using (true);

-- Event creation / editing / archiving / deletion is operator-only. The old
-- "anon can create events" policy is dropped so the public anon key can no
-- longer spam events.
drop policy if exists "anon can create events" on public.events;

drop policy if exists "authenticated can insert events" on public.events;
create policy "authenticated can insert events"
  on public.events for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated can update events" on public.events;
create policy "authenticated can update events"
  on public.events for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated can delete events" on public.events;
create policy "authenticated can delete events"
  on public.events for delete
  to authenticated
  using (true);

-- 1. Photos table
create table if not exists public.photos (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  photo_url  text not null,
  guest_id   uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists photos_room_created_idx
  on public.photos (room_id, created_at desc);

-- Speeds up the per-guest count enforced by the trigger below.
create index if not exists photos_room_guest_idx
  on public.photos (room_id, guest_id);

-- 2. Realtime — let clients subscribe to INSERTs (guarded so re-runs don't error).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'photos'
  ) then
    alter publication supabase_realtime add table public.photos;
  end if;
end $$;

-- 3. Row Level Security for photos
alter table public.photos enable row level security;

-- Anyone may read the roll (the gallery is public).
drop policy if exists "anon can read photos" on public.photos;
create policy "anon can read photos"
  on public.photos for select
  to anon
  using (true);

-- Anon may insert a photo ONLY when room_id points at an EXISTING, ACTIVE event.
-- The per-guest count cap is enforced by the BEFORE INSERT trigger below (a
-- WITH CHECK subquery cannot reliably count "rows so far" the way a trigger
-- can), so the two layers together fully enforce requirement 2b server-side.
drop policy if exists "anon can insert photos" on public.photos;
drop policy if exists "anon can insert photos for active events" on public.photos;
create policy "anon can insert photos for active events"
  on public.photos for insert
  to anon
  with check (
    exists (
      select 1 from public.events e
      where e.slug = room_id and e.is_active
    )
  );

-- No anon UPDATE/DELETE: guests can never mutate or remove photos.
-- Operators (signed in) may delete photos for moderation.
drop policy if exists "authenticated can delete photos" on public.photos;
create policy "authenticated can delete photos"
  on public.photos for delete
  to authenticated
  using (true);

-- Server-side enforcement of the per-guest photo limit + event validity.
-- SECURITY DEFINER so it can read events/count photos regardless of the
-- caller's RLS. This is what makes clearing localStorage unable to bypass the
-- limit: the database itself rejects the (limit+1)-th insert.
create or replace function public.enforce_photo_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev     public.events%rowtype;
  taken  int;
begin
  select * into ev from public.events where slug = new.room_id;
  if not found then
    raise exception 'No event exists for room_id "%"', new.room_id
      using errcode = 'check_violation';
  end if;
  if not ev.is_active then
    raise exception 'Event "%" is not accepting photos', new.room_id
      using errcode = 'check_violation';
  end if;

  select count(*) into taken
  from public.photos
  where room_id = new.room_id and guest_id = new.guest_id;

  if taken >= ev.photo_limit then
    raise exception 'Per-guest photo limit (%) reached for this event', ev.photo_limit
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_photo_rules on public.photos;
create trigger trg_enforce_photo_rules
  before insert on public.photos
  for each row
  execute function public.enforce_photo_rules();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Storage bucket  (a PUBLIC bucket named `photos`) and matching policies.
-- ───────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

-- Public read (the gallery serves images straight from public URLs).
drop policy if exists "public can read photos bucket" on storage.objects;
create policy "public can read photos bucket"
  on storage.objects for select
  to anon
  using (bucket_id = 'photos');

-- Anon may upload into the photos bucket. Storage policies can't see the
-- events table cheaply, so existence/limit are enforced on the DB row insert
-- (trigger above); here we constrain inserts to this one bucket.
drop policy if exists "anon can upload to photos bucket" on storage.objects;
create policy "anon can upload to photos bucket"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'photos');

-- Operators may delete stored objects for moderation.
drop policy if exists "authenticated can delete from photos bucket" on storage.objects;
create policy "authenticated can delete from photos bucket"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'photos');
