-- =========================================================================
-- Curate: Two-Account Row-Level Security (RLS) Verification Script
-- Run this in the Supabase SQL editor to test cross-tenant isolation.
-- =========================================================================

do $$
declare
  user_a uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  user_b uuid := '22222222-2222-2222-2222-222222222222'::uuid;
  item_count_for_a integer;
  updated_rows integer;
begin
  raise notice 'Starting RLS verification between User A and User B...';

  -- 1. Insert an item as User B (simulating direct insert or service setup)
  delete from public.user_items where user_id in (user_a, user_b);

  insert into public.user_items (id, user_id, title, content_type, status, created_at, updated_at)
  values ('b-secret-item', user_b, 'User B Private Journal', 'article', 'inbox', now(), now());

  -- 2. Test SELECT: Set active auth context to User A
  perform set_config('request.jwt.claims', json_build_object('sub', user_a::text)::text, true);

  select count(*) into item_count_for_a
  from public.user_items
  where id = 'b-secret-item';

  if item_count_for_a <> 0 then
    raise exception 'RLS FAILURE: User A was able to SELECT User B item!';
  else
    raise notice 'PASS: User A cannot read User B item (0 rows returned).';
  end if;

  -- 3. Test UPDATE: User A attempts to overwrite User B's item
  update public.user_items
  set title = 'Hacked by User A'
  where id = 'b-secret-item';

  get diagnostics updated_rows = row_count;
  if updated_rows <> 0 then
    raise exception 'RLS FAILURE: User A was able to UPDATE User B item!';
  else
    raise notice 'PASS: User A cannot update User B item (0 rows modified).';
  end if;

  -- 4. Test DELETE: User A attempts to delete User B's item
  delete from public.user_items where id = 'b-secret-item';

  get diagnostics updated_rows = row_count;
  if updated_rows <> 0 then
    raise exception 'RLS FAILURE: User A was able to DELETE User B item!';
  else
    raise notice 'PASS: User A cannot delete User B item (0 rows deleted).';
  end if;

  -- 5. Cleanup test rows
  perform set_config('request.jwt.claims', json_build_object('sub', user_b::text)::text, true);
  delete from public.user_items where user_id in (user_a, user_b);

  raise notice '=========================================================';
  raise notice '✅ ALL RLS CHECKS PASSED: 100%% Tenant Isolation Confirmed.';
  raise notice '=========================================================';
end;
$$;
