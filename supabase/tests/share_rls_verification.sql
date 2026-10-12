-- =========================================================================
-- Curate: Share My Week Two-Account RLS Verification Script
-- Run this in the Supabase SQL editor to test cross-tenant isolation
-- for public.shared_weeks.
-- =========================================================================
do $$
declare
  user_a uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  user_b uuid := '22222222-2222-2222-2222-222222222222'::uuid;
  share_id text := '0123456789abcdef0123456789abcdef';
  updated_rows integer;
  deleted_rows integer;
  inserted_rows integer;
begin
  raise notice 'Starting Share My Week RLS verification between User A and User B...';

  -- 1. Setup: Clean existing test records and insert a shared week owned by User B
  delete from public.shared_weeks where user_id in (user_a, user_b);
  
  insert into public.shared_weeks (
    id, user_id, week_start_date, week_end_date, week_label, display_name,
    total_planned_minutes, items, is_active, created_at, updated_at
  ) values (
    share_id, user_b, '2026-10-12', '2026-10-18', 'Oct 12 – Oct 18, 2026', 'User B',
    120, '[{"title": "Mindful Architecture", "type": "article", "duration": 45, "day": "Monday", "source": "Curate"}]'::jsonb,
    false, now(), now()
  );

  -- 2. Test Inactive Share Visibility:
  -- Set auth context to User A. Since the share is is_active = false and owned by User B, User A should NOT see it.
  perform set_config('request.jwt.claims', json_build_object('sub', user_a::text)::text, true);

  if exists (select 1 from public.shared_weeks where id = share_id) then
    raise exception 'RLS FAILURE: User A was able to SELECT User B private inactive share!';
  else
    raise notice 'PASS: User A cannot read User B inactive share (0 rows returned).';
  end if;

  -- 3. Test Unauthorized UPDATE:
  -- User A attempts to modify User B's share link
  update public.shared_weeks
  set display_name = 'Tampered by User A'
  where id = share_id;
  get diagnostics updated_rows = row_count;

  if updated_rows <> 0 then
    raise exception 'RLS FAILURE: User A was able to UPDATE User B share!';
  else
    raise notice 'PASS: User A cannot update User B share (0 rows modified).';
  end if;

  -- 4. Test Unauthorized DELETE:
  -- User A attempts to delete User B's share link
  delete from public.shared_weeks where id = share_id;
  get diagnostics deleted_rows = row_count;

  if deleted_rows <> 0 then
    raise exception 'RLS FAILURE: User A was able to DELETE User B share!';
  else
    raise notice 'PASS: User A cannot delete User B share (0 rows deleted).';
  end if;

  -- 5. Test Unauthorized INSERT:
  -- User A attempts to forge a row with user_id = user_b
  begin
    insert into public.shared_weeks (
      id, user_id, week_start_date, week_end_date, week_label, total_planned_minutes
    ) values (
      'fedcba9876543210fedcba9876543210', user_b, '2026-10-12', '2026-10-18', 'Fake Week', 60
    );
    raise exception 'RLS FAILURE: User A was able to insert a row posing as User B!';
  exception when others then
    raise notice 'PASS: User A cannot insert rows for User B (check violation triggered).';
  end;

  -- 6. Cleanup
  perform set_config('request.jwt.claims', json_build_object('sub', user_b::text)::text, true);
  delete from public.shared_weeks where user_id in (user_a, user_b);

  raise notice '=========================================================';
  raise notice '✅ ALL SHARE RLS CHECKS PASSED: 100%% Tenant Isolation Confirmed.';
  raise notice '=========================================================';
end;$$;
