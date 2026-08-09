\set ON_ERROR_STOP on
\pset pager off

-- The captain tier is a security boundary: it exists to stop a leading hand
-- being made "office" just so they can run a job. What it must NOT reach is
-- the point of it, so most of what follows asserts absence.

begin;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-0000000000a1', 'owner@r.test'),
  ('11111111-0000-0000-0000-0000000000a2', 'captain@r.test'),
  ('11111111-0000-0000-0000-0000000000a3', 'chippie@r.test');

insert into companies (id, name) values ('aaaaaaaa-0000-0000-0000-0000000000f1', 'Roles Co');

insert into workers (id, company_id, auth_user_id, name, initials, trade, role) values
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   '11111111-0000-0000-0000-0000000000a1', 'Owner', 'OW', 'admin', 'owner'),
  ('bbbbbbbb-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   '11111111-0000-0000-0000-0000000000a2', 'Captain', 'CA', 'tiler', 'captain'),
  ('bbbbbbbb-0000-0000-0000-0000000000f3', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   '11111111-0000-0000-0000-0000000000a3', 'Chippie', 'CH', 'tiler', 'employee');

-- Theirs, and not theirs.
insert into job_sites (id, company_id, name, lat, lng, captain_id) values
  ('cccccccc-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'Lot 42', -34.9, 138.5,
   'bbbbbbbb-0000-0000-0000-0000000000f2'),
  ('cccccccc-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'Lot 99', -34.9, 138.5, null);

insert into contracts (company_id, site_id, contract_sum) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'cccccccc-0000-0000-0000-0000000000f1', 80000);

insert into change_orders (company_id, site_id, co_no, description, cost_impact, status) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'cccccccc-0000-0000-0000-0000000000f1', 'VO-1', 'Theirs', 5000, 'approved'),
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'cccccccc-0000-0000-0000-0000000000f2', 'VO-2', 'Not theirs', 9000, 'approved');

insert into invoices (company_id, site_id, invoice_no, amount, status) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'cccccccc-0000-0000-0000-0000000000f1', 'INV-1', 44000, 'sent');

insert into shifts (id, company_id, worker_id, site_id, started_at, ended_at, source) values
  ('ffffffff-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'bbbbbbbb-0000-0000-0000-0000000000f3', 'cccccccc-0000-0000-0000-0000000000f1',
   now() - interval '9 hours', now() - interval '1 hour', 'manual'),
  ('ffffffff-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-0000000000f1',
   'bbbbbbbb-0000-0000-0000-0000000000f3', 'cccccccc-0000-0000-0000-0000000000f2',
   now() - interval '33 hours', now() - interval '25 hours', 'manual');

-- ================================================== 1. is_office stays in step
do $$
declare o boolean; r text;
begin
  select is_office into o from workers where initials = 'CA';
  if o then raise exception 'FAIL: a captain came out as office'; end if;
  select is_office into o from workers where initials = 'OW';
  if not o then raise exception 'FAIL: an owner did not come out as office'; end if;

  -- The Crew screen still ticks a box; that has to still mean something.
  update workers set is_office = true where initials = 'CH';
  select role into r from workers where initials = 'CH';
  if r <> 'owner' then raise exception 'FAIL: ticking office did not make an owner (got %)', r; end if;

  update workers set is_office = false where initials = 'CH';
  select role into r from workers where initials = 'CH';
  if r <> 'employee' then raise exception 'FAIL: unticking office should give employee, got %', r; end if;

  -- And promoting by role must set the box the money policies read.
  update workers set role = 'owner' where initials = 'CH';
  select is_office into o from workers where initials = 'CH';
  if not o then raise exception 'FAIL: role owner did not set is_office'; end if;
  update workers set role = 'employee' where initials = 'CH';

  raise notice 'PASS  role and is_office stay in step, whichever one is written';
end $$;

-- ============================================= 2. the captain reaches their job
do $$
declare n integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000a2';

  if not captains_site('cccccccc-0000-0000-0000-0000000000f1') then
    raise exception 'FAIL: a captain does not reach the job they are named on';
  end if;
  if captains_site('cccccccc-0000-0000-0000-0000000000f2') then
    raise exception 'FAIL: a captain reaches a job that is not theirs';
  end if;

  -- The scoping this always asserted still holds; what changed in schema_v24 is
  -- where it is enforced. Reading change_orders directly handed the captain
  -- cost_impact along with the description, because RLS is row-level and cannot
  -- return a row with one column withheld. The table is office-only now and the
  -- captain's register is a view with no money on it.
  select count(*) into n from change_orders;
  if n <> 0 then raise exception 'FAIL: a captain read % change_orders rows', n; end if;

  select count(*) into n from site_variations_v;
  if n <> 1 then raise exception 'FAIL: a captain saw % variations, should be 1 (their own job)', n; end if;

  raise notice 'PASS  a captain sees their own job''s variations and no others';
end $$;

-- ================================================== 3. and never the money
do $$
declare n integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000a2';
  select count(*) into n from invoices;
  if n <> 0 then raise exception 'FAIL: a captain read % invoices', n; end if;
  select count(*) into n from contracts;
  if n <> 0 then raise exception 'FAIL: a captain read % contracts', n; end if;
  select count(*) into n from job_value_v;
  if n <> 0 then raise exception 'FAIL: a captain read % rows of job value', n; end if;
  select count(*) into n from job_money_v;
  if n <> 0 then raise exception 'FAIL: a captain read % job budgets', n; end if;
  raise notice 'PASS  a captain reads no invoice, contract, job value or budget';
end $$;

-- ======================================= 4. an ordinary employee is unchanged
do $$
declare n integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000a3';
  select count(*) into n from change_orders;
  if n <> 0 then raise exception 'FAIL: an employee read % variations', n; end if;
  if captains_site('cccccccc-0000-0000-0000-0000000000f1') then
    raise exception 'FAIL: captains_site() said yes to an employee';
  end if;
  raise notice 'PASS  the employee tier is exactly what it was';
end $$;

-- ============================ 5. the guard lets a captain fix their own punch
--
-- Asserted on the OUTCOME, never on an exception being raised. A row RLS hides
-- is simply not matched, so the UPDATE reports success having changed nothing —
-- a test that waits for an error would read that as the write going through.
do $$
declare a timestamptz; sid uuid; n integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000a2';

  update shifts set approved_at = now(), approved_by = 'bbbbbbbb-0000-0000-0000-0000000000f2'
   where id = 'ffffffff-0000-0000-0000-0000000000f1';
  reset role;
  select approved_at into a from shifts where id = 'ffffffff-0000-0000-0000-0000000000f1';
  if a is null then raise exception 'FAIL: a captain could not approve a shift on their own job'; end if;
  raise notice 'PASS  a captain can approve a shift on their own job';

  -- The other job's shift: invisible, and unmovable.
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000a2';
  select count(*) into n from shifts where id = 'ffffffff-0000-0000-0000-0000000000f2';
  if n <> 0 then raise exception 'FAIL: a captain can see a shift on a job that is not theirs'; end if;

  update shifts set site_id = 'cccccccc-0000-0000-0000-0000000000f1'
   where id = 'ffffffff-0000-0000-0000-0000000000f2';
  reset role;
  select site_id into sid from shifts where id = 'ffffffff-0000-0000-0000-0000000000f2';
  if sid <> 'cccccccc-0000-0000-0000-0000000000f2' then
    raise exception 'FAIL: a captain pulled another job''s shift onto their own';
  end if;
  raise notice 'PASS  a captain cannot see or pull another job''s shift';
end $$;

-- ================================== 6. and an employee still cannot self-approve
do $$
declare a timestamptz;
begin
  set local role postgres;
  update shifts set approved_at = null, approved_by = null where id = 'ffffffff-0000-0000-0000-0000000000f1';

  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000a3';
  begin
    update shifts set approved_at = now() where id = 'ffffffff-0000-0000-0000-0000000000f1';
  exception when raise_exception then
    -- The guard fired, which is the other acceptable outcome.
    null;
  end;
  reset role;
  select approved_at into a from shifts where id = 'ffffffff-0000-0000-0000-0000000000f1';
  if a is not null then raise exception 'FAIL: an employee approved their own shift'; end if;
  raise notice 'PASS  an employee still cannot approve their own shift';
end $$;

-- ================================ 7. a crew carries the captain onto the job
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000a1';
  insert into crews (id, company_id, name, captain_id)
  values ('dddddddd-0000-0000-0000-0000000000f9', 'aaaaaaaa-0000-0000-0000-0000000000f1',
          'Wet area crew', 'bbbbbbbb-0000-0000-0000-0000000000f2');
  insert into assignments (company_id, worker_id, site_id, crew_id, starts_at, ends_at, published)
  values ('aaaaaaaa-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-0000000000f3',
          'cccccccc-0000-0000-0000-0000000000f2', 'dddddddd-0000-0000-0000-0000000000f9',
          now(), now() + interval '8 hours', true);

  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000a2';
  if not captains_site('cccccccc-0000-0000-0000-0000000000f2') then
    raise exception 'FAIL: booking the crew did not carry its captain onto the job';
  end if;
  raise notice 'PASS  booking a crew scopes its captain to that job';
end $$;

rollback;
