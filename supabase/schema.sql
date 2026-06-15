-- ───────────────────────────────────────────────────────────────────────────
-- Run this in the Supabase SQL editor once per project.
-- (Safe to re-run — uses if-not-exists / drop-if-exists guards.)
-- ───────────────────────────────────────────────────────────────────────────

-- 0. Events table — created from the admin console, read by guest room pages.
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  event_date  date,
  photo_limit int not null default 20,
  created_at  timestamptz not null default now()
);

alter table public.events enable row level security;

-- Guests need to read the event behind their link. The admin console (which
-- uses the same public anon key) creates events, so anon insert is allowed too.
-- NOTE: this is MVP-grade. To lock down event creation, move it behind Supabase
-- Auth and restrict the insert policy to authenticated admins.
drop policy if exists "anon can read events" on public.events;
create policy "anon can read events"
  on public.events for select
  to anon
  using (true);

drop policy if exists "anon can create events" on public.events;
create policy "anon can create events"
  on public.events for insert
  to anon
  with check (true);

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

-- 2. Realtime — let clients subscribe to INSERTs
alter publication supabase_realtime add table public.photos;

-- 3. Row Level Security
-- This is a zero-login product: the anon key is public, so we deliberately
-- allow anonymous INSERT + SELECT. We do NOT allow update/delete from clients.
alter table public.photos enable row level security;

create policy "anon can read photos"
  on public.photos for select
  to anon
  using (true);

create policy "anon can insert photos"
  on public.photos for insert
  to anon
  with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Storage bucket  (create a PUBLIC bucket named `photos` in the dashboard,
--    or run the snippet below) and matching policies.
-- ───────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "anon can upload to photos bucket"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'photos');

create policy "public can read photos bucket"
  on storage.objects for select
  to anon
  using (bucket_id = 'photos');
