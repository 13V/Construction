\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------- fixtures
begin;

insert into auth.users (id, email) values
  ('11111111-2222-1111-1111-111111111111', 'office22@t.test'),
  ('22222222-3333-2222-2222-222222222222', 'field22@t.test');

insert into companies (id, name) values ('aaaaaaaa-0000-0000-0000-000000000022', 'Test Tiling 22');

insert into workers (id, company_id, auth_user_id, name, initials, trade, rate, is_office) values
  ('bbbbbbbb-0000-0000-0000-000000000022', 'aaaaaaaa-0000-0000-0000-000000000022',
   '11111111-2222-1111-1111-111111111111', 'Office', 'OF', 'admin', 0, true),
  ('bbbbbbbb-0000-0000-0000-000000000023', 'aaaaaaaa-0000-0000-0000-000000000022',
   '22222222-3333-2222-2222-222222222222', 'Chippie', 'CH', 'tiler', 55, false);

-- One position well outside the 3-day window, one well inside it, and one on
-- each side of the cutoff itself — the boundary is the only place this logic
-- can be wrong without every other assertion still passing.
insert into positions (worker_id, at, lat, lng, accuracy_m) values
  ('bbbbbbbb-0000-0000-0000-000000000023', now() - interval '10 days',        -34.9, 138.5, 5),
  ('bbbbbbbb-0000-0000-0000-000000000023', now() - interval '1 hour',         -34.9, 138.5, 5),
  ('bbbbbbbb-0000-0000-0000-000000000023', now() - interval '2 days 23 hours',-34.9, 138.5, 5),
  ('bbbbbbbb-0000-0000-0000-000000000023', now() - interval '3 days 1 hour',  -34.9, 138.5, 5);

-- ================================================ 1. nobody signed in may call it
-- The whole point of restricting this to service_role is that a field worker
-- must not be able to trigger early deletion of their own trail before the
-- office ever looks at it. Tested as the field worker specifically, not the
-- office, because "office write access" and "may run maintenance functions"
-- are different privileges and this proves the narrower one.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-3333-2222-2222-222222222222';
  begin
    perform prune_positions();
    raise exception 'FAIL: a signed-in field worker was able to call prune_positions()';
  exception when insufficient_privilege then
    raise notice 'PASS  prune_positions() refuses a signed-in caller';
  end;
end $$;

-- Back to the superuser role schema-check.sh runs as, the same way service_role
-- would call this — bypassing RLS on purpose, because that is what the
-- scheduled job and the Management API path both do.
reset role;

-- ========================================================== 2. what survives
do $$
declare
  v_before integer;
  v_after  integer;
  v_deleted integer;
begin
  select count(*) into v_before from positions where worker_id = 'bbbbbbbb-0000-0000-0000-000000000023';
  if v_before <> 4 then raise exception 'FAIL: fixture setup — expected 4 rows, found %', v_before; end if;

  select prune_positions() into v_deleted;

  select count(*) into v_after from positions where worker_id = 'bbbbbbbb-0000-0000-0000-000000000023';
  if v_after <> 2 then raise exception 'FAIL: expected 2 rows left, found %', v_after; end if;
  if v_deleted <> 2 then raise exception 'FAIL: prune_positions() reported % deleted, expected 2', v_deleted; end if;

  -- now() is frozen at the transaction's start time in Postgres, so it reads
  -- back here exactly as it was written above — these are the same four
  -- instants, not four new ones.
  if exists (select 1 from positions where worker_id = 'bbbbbbbb-0000-0000-0000-000000000023'
             and at = now() - interval '10 days') then
    raise exception 'FAIL: the 10-day-old position survived the prune';
  end if;
  if exists (select 1 from positions where worker_id = 'bbbbbbbb-0000-0000-0000-000000000023'
             and at = now() - interval '3 days 1 hour') then
    raise exception 'FAIL: the position just OUTSIDE the 3-day cutoff survived the prune';
  end if;
  if not exists (select 1 from positions where worker_id = 'bbbbbbbb-0000-0000-0000-000000000023'
                 and at = now() - interval '1 hour') then
    raise exception 'FAIL: the position from an hour ago did not survive the prune';
  end if;
  if not exists (select 1 from positions where worker_id = 'bbbbbbbb-0000-0000-0000-000000000023'
                 and at = now() - interval '2 days 23 hours') then
    raise exception 'FAIL: the position just INSIDE the 3-day cutoff did not survive the prune';
  end if;

  raise notice 'PASS  positions older than 3 days are gone; recent and just-inside-cutoff positions remain';
end $$;

-- ==================================================== 3. safe to run again
-- A cron job that fires daily will call this on an already-pruned table most
-- days. It must not error, and it must not touch what is left.
do $$
declare v_deleted integer; v_after integer;
begin
  select prune_positions() into v_deleted;
  if v_deleted <> 0 then raise exception 'FAIL: a second prune deleted % rows that were already clean', v_deleted; end if;

  select count(*) into v_after from positions where worker_id = 'bbbbbbbb-0000-0000-0000-000000000023';
  if v_after <> 2 then raise exception 'FAIL: a second, no-op prune changed the row count to %', v_after; end if;

  raise notice 'PASS  running the prune again is a no-op';
end $$;

rollback;
