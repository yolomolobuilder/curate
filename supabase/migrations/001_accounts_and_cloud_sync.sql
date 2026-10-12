-- =========================================================================
-- Curate: Accounts & Cloud Sync Migration
-- Schema Version: 1
-- Description:
--   Creates user_items, user_settings, and user_media tables with strict
--   PostgreSQL Row-Level Security (RLS) guaranteeing tenant isolation:
--   a user can ONLY read, insert, update, or delete their own rows.
-- =========================================================================

-- Enable uuid extension
create extension if not exists "uuid-ossp";

-- -------------------------------------------------------------------------
-- 1. Table: user_items
-- Stores each user's curated videos, articles, podcasts, and books.
-- -------------------------------------------------------------------------
create table if not exists public.user_items (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled Item',
  url text,
  thumbnail_url text,
  content_type text not null default 'other',
  source text,
  platform text,
  author text,
  duration_minutes integer,
  duration_is_estimate boolean default true,
  duration_fetched_at text,
  user_edited_fields text[] default '{}',
  topic text,
  status text not null default 'inbox',
  scheduled_date text,
  scheduled_end_date text,
  notes text,
  key_takeaway text,
  screenshots text[] default '{}',
  spatial_x double precision,
  spatial_y double precision,
  is_priority boolean default false,
  is_sample boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, id)
);

-- Index for fast user queries
create index if not exists idx_user_items_user_id on public.user_items(user_id);
create index if not exists idx_user_items_scheduled on public.user_items(user_id, scheduled_date);

-- Enable Row-Level Security
alter table public.user_items enable row level security;

-- Strict RLS Policies: users can only access their own items
create policy "user_items_select_policy"
  on public.user_items
  for select
  using (auth.uid() = user_id);

create policy "user_items_insert_policy"
  on public.user_items
  for insert
  with check (auth.uid() = user_id);

create policy "user_items_update_policy"
  on public.user_items
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_items_delete_policy"
  on public.user_items
  for delete
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 2. Table: user_settings
-- Stores personalized day themes, custom topics, week budgets, brand preferences.
-- -------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day_themes jsonb default '[]'::jsonb,
  custom_topics jsonb default '[]'::jsonb,
  week_budgets jsonb default '{}'::jsonb,
  day_preferences_enabled boolean default true,
  brand_name text,
  brand_logo text,
  dark_mode boolean default true,
  updated_at timestamptz not null default now()
);

-- Enable Row-Level Security
alter table public.user_settings enable row level security;

-- Strict RLS Policies: users can only access their own settings
create policy "user_settings_select_policy"
  on public.user_settings
  for select
  using (auth.uid() = user_id);

create policy "user_settings_insert_policy"
  on public.user_settings
  for insert
  with check (auth.uid() = user_id);

create policy "user_settings_update_policy"
  on public.user_settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_settings_delete_policy"
  on public.user_settings
  for delete
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 3. Table: user_media
-- Stores compressed screenshot and logo references capped at 200 KB.
-- -------------------------------------------------------------------------
create table if not exists public.user_media (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_data text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Enable Row-Level Security
alter table public.user_media enable row level security;

-- Strict RLS Policies: users can only access their own media
create policy "user_media_select_policy"
  on public.user_media
  for select
  using (auth.uid() = user_id);

create policy "user_media_insert_policy"
  on public.user_media
  for insert
  with check (auth.uid() = user_id);

create policy "user_media_update_policy"
  on public.user_media
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_media_delete_policy"
  on public.user_media
  for delete
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 4. User Account Deletion Function
-- Allows an authenticated user to permanently delete all their cloud data.
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

  -- Delete items, media, and settings
  delete from public.user_items where user_id = current_user_id;
  delete from public.user_media where user_id = current_user_id;
  delete from public.user_settings where user_id = current_user_id;

  -- Delete auth user record
  delete from auth.users where id = current_user_id;
end;
$$;
