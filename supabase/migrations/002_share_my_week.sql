-- =========================================================================
-- Curate: Share My Week Migration
-- Schema Version: 2
-- Description:
--   Creates the public.shared_weeks table with Row-Level Security (RLS).
--   - Each shared link is referenced by a random 128-bit hex ID.
--   - Stores ONLY: title, source, type, duration, cover reference, day.
--   - Never stores notes, URLs, or other personal items.
--   - Active links can be read publicly (for /w/:id previews).
--   - ONLY the owner can insert, update, or delete their shared weeks.
--   - Deleting the account cascades and permanently removes all shared links.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Table: shared_weeks
-- -------------------------------------------------------------------------
create table if not exists public.shared_weeks (
  id text primary key, -- 128-bit random hex string (32 characters)
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start_date text not null, -- YYYY-MM-DD
  week_end_date text not null,   -- YYYY-MM-DD
  week_label text not null,      -- e.g. "Oct 12 – Oct 18, 2026"
  display_name text,             -- optional creator display name (max 40 chars sanitized)
  total_planned_minutes integer not null default 0,
  items jsonb not null default '[]'::jsonb, -- array of sanitized items without notes or URLs
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indices for performance and user quotas
create index if not exists idx_shared_weeks_user_id on public.shared_weeks(user_id);
create index if not exists idx_shared_weeks_user_active on public.shared_weeks(user_id, is_active);
create index if not exists idx_shared_weeks_created_at on public.shared_weeks(user_id, created_at);

-- Enable Row-Level Security
alter table public.shared_weeks enable row level security;

-- -------------------------------------------------------------------------
-- 2. Strict Row-Level Security Policies
-- -------------------------------------------------------------------------

-- Anyone can read active shared weeks by ID, or owners can view their own inactive weeks
create policy "shared_weeks_select_policy"
  on public.shared_weeks
  for select
  using (is_active = true or auth.uid() = user_id);

-- Only authenticated owners can create their own shared weeks
create policy "shared_weeks_insert_policy"
  on public.shared_weeks
  for insert
  with check (auth.uid() = user_id);

-- Only authenticated owners can update (toggle active, change display name, update snapshot)
create policy "shared_weeks_update_policy"
  on public.shared_weeks
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Only authenticated owners can delete their shared weeks
create policy "shared_weeks_delete_policy"
  on public.shared_weeks
  for delete
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 3. Account Deletion: Cascade delete shared links
-- -------------------------------------------------------------------------
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Remove all shared links owned by the user
  delete from public.shared_weeks where user_id = current_user_id;

  -- Remove items, media, and settings
  delete from public.user_items where user_id = current_user_id;
  delete from public.user_media where user_id = current_user_id;
  delete from public.user_settings where user_id = current_user_id;

  -- Delete auth user
  delete from auth.users where id = current_user_id;
end;$$;
