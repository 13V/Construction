\set ON_ERROR_STOP on
\pset pager off

-- Two column-level leaks, and the assertions that they are shut.
--
-- Every one of these runs as `authenticated` with a real auth.uid(), because a
-- superuser bypasses RLS entirely and the whole file would pass while proving
-- nothing. And each asserts an OUTCOME — a count, a value — rather than
-- expecting an exception, because a select that RLS empties returns zero rows
-- quietly and "no error" is not the same as "no access".

begin;

insert into auth.users (id, email) values
  ('22222222-0000-0000-0000-0000000000a1', 'owner@pay.test'),
  ('22222222-0000-0000-0000-0000000000a2', 'captain@pay.test'),
  ('22222222-0000-0000-0000-0000000000a3', 'tiler@pay.test');

insert into companies (id, name) values ('dddddddd-0000-0000-0000-0000000000f1', 'Pay Co');

insert into workers (id, company_id, auth_user_id, name, initials, trade, role) values
  ('eeeeeeee-0000-0000-0000-0000000000f1', 'dddddddd-0000-0000-0000-0000000000f1',
   '22222222-0000-0000-0000-0000000000a1', 'Owner', 'OW', 'admin', 'owner'),
  ('eeeeeeee-0000-0000-0000-0000000000f2', 'dddddddd-0000-0000-0000-0000000000f1',
   '22222222-0000-0000-0000-0000000000a2', 'Captain', 'CA', 'tiler', 'captain'),
  ('eeeeeeee-0000-0000-0000-0000000000f3', 'dddddddd-0000-0000-0000-0000000000f1',
   '22222222-0000-0000-0000-0000000000a3', 'Tiler', 'TI', 'tiler', 'employee');

-- A rate nobody but the office may ever see.
insert into worker_pay (worker_id, company_id, rate) values
  ('eeeeeeee-0000-0000-0000-0000000000f1', 'dddddddd-0000-0000-0000-0000000000f1', 0),
  ('eeeeeeee-0000-0000-0000-0000000000f2', 'dddddddd-0000-0000-0000-0000000000f1', 97.50),
  ('eeeeeeee-0000-0000-0000-0000000000f3', 'dddddddd-0000-0000-0000-0000000000f1', 41.25)
  on conflict (worker_id) do update set rate = excluded.rate;

insert into job_sites (id, company_id, name, lat, lng, captain_id) values
  ('ffffffff-0000-0000-0000-0000000000e1', 'dddddddd-0000-0000-0000-0000000000f1', 'Their job', -34.9, 138.5,
   'eeeeeeee-0000-0000-0000-0000000000f2'),
  ('ffffffff-0000-0000-0000-0000000000e2', 'dddddddd-0000-0000-0000-0000000000f1', 'Not their job', -34.9, 138.5, null);

insert into change_orders (company_id, site_id, co_no, description, detail, cost_impact, days_impact, status) values
  ('dddddddd-0000-0000-0000-0000000000f1', 'ffffffff-0000-0000-0000-0000000000e1', 'VO-A',
   'Extra waterproofing to level 2', 'Builder changed the wet area layout', 4820, 3, 'approved'),
  ('dddddddd-0000-0000-0000-0000000000f1', 'ffffffff-0000-0000-0000-0000000000e2', 'VO-B',
   'Somebody else s job', 'not theirs', 9000, 0, 'approved');

-- ============================================ 1. the column is actually gone
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'workers' and column_name = 'rate';
  if n <> 0 then
    raise exception 'FAIL: workers.rate still exists — a view cannot hide a column from someone who can read the table';
  end if;
  raise notice 'PASS  workers.rate is gone from the readable table';
end $$;

-- ================================ 1b. a new worker gets a pay row by itself
do $$
declare n int; r numeric;
begin
  insert into workers (id, company_id, name, initials, trade, role)
  values ('eeeeeeee-0000-0000-0000-0000000000f9', 'dddddddd-0000-0000-0000-0000000000f1',
          'Fresh Hire', 'FH', 'labourer', 'employee');

  select count(*) into n from worker_pay where worker_id = 'eeeeeeee-0000-0000-0000-0000000000f9';
  if n <> 1 then
    raise exception 'FAIL: a new worker got % pay rows — the office would see a blank wage, not an error', n;
  end if;
  select rate into r from worker_pay where worker_id = 'eeeeeeee-0000-0000-0000-0000000000f9';
  if r <> 0 then raise exception 'FAIL: a new worker started on a rate of %', r; end if;
  raise notice 'PASS  a new worker gets a pay row at zero, without the caller asking';
end $$;

-- ================================== 2. an employee cannot reach a rate at all
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-0000-0000-0000-0000000000a3';

  select count(*) into n from worker_pay;
  if n <> 0 then
    raise exception 'FAIL: an employee read % worker_pay rows', n;
  end if;

  -- And not their own either. What they are paid comes off a payslip.
  select count(*) into n from worker_pay where worker_id = 'eeeeeeee-0000-0000-0000-0000000000f3';
  if n <> 0 then raise exception 'FAIL: an employee read their own pay row'; end if;
  reset role;
  raise notice 'PASS  an employee reads no pay rate, including their own';
end $$;

-- ============================== 3. nor a captain, which the privacy policy says
do $$
declare n int; r numeric;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-0000-0000-0000-0000000000a2';

  select count(*) into n from worker_pay;
  if n <> 0 then raise exception 'FAIL: a captain read % pay rows', n; end if;

  -- crew_v is the list every screen uses. It must come back populated, with the
  -- rate column present and empty — a captain still needs the crew list.
  -- Counted against workers rather than a literal: the assertion is "the whole
  -- crew, not an empty list", and a hardcoded 3 only breaks when a later test
  -- adds a fixture.
  select count(*) into n from crew_v;
  if n <> (select count(*) from workers) then
    raise exception 'FAIL: a captain saw % crew of % workers', n, (select count(*) from workers);
  end if;
  if n = 0 then raise exception 'FAIL: the crew list came back empty'; end if;

  select count(*) into n from crew_v where rate is not null;
  if n <> 0 then raise exception 'FAIL: crew_v handed a captain % rates', n; end if;
  reset role;
  raise notice 'PASS  a captain gets the crew list with every rate null';
end $$;

-- ==================================== 4. and the office still runs the payroll
do $$
declare r numeric;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-0000-0000-0000-0000000000a1';

  select rate into r from crew_v where initials = 'CA';
  if r is distinct from 97.50 then
    raise exception 'FAIL: the office got % for a rate of 97.50 — payroll is blind', r;
  end if;

  select rate into r from worker_pay where worker_id = 'eeeeeeee-0000-0000-0000-0000000000f3';
  if r is distinct from 41.25 then raise exception 'FAIL: the office could not read worker_pay'; end if;
  reset role;
  raise notice 'PASS  the office still reads every rate, through crew_v and directly';
end $$;

-- ========================= 5. an employee cannot write themselves a pay rise
do $$
declare r numeric;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-0000-0000-0000-0000000000a3';
  -- A zero-row update raises nothing, so assert the value afterwards.
  update worker_pay set rate = 200 where worker_id = 'eeeeeeee-0000-0000-0000-0000000000f3';
  reset role;

  select rate into r from worker_pay where worker_id = 'eeeeeeee-0000-0000-0000-0000000000f3';
  if r <> 41.25 then raise exception 'FAIL: an employee set their own rate to %', r; end if;
  raise notice 'PASS  an employee cannot write a pay rate';
end $$;

-- ================================ 6. a captain sees no variation cost_impact
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-0000-0000-0000-0000000000a2';

  select count(*) into n from change_orders;
  if n <> 0 then
    raise exception 'FAIL: a captain read % change_orders rows, cost_impact and all', n;
  end if;
  reset role;
  raise notice 'PASS  a captain reads no change_orders row';
end $$;

-- ===================== 7. but does get the register for their own job, no money
do $$
declare n int; d text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-0000-0000-0000-0000000000a2';

  select count(*) into n from site_variations_v;
  if n <> 1 then raise exception 'FAIL: a captain saw % variations, expected only their own', n; end if;

  select description into d from site_variations_v;
  if d <> 'Extra waterproofing to level 2' then
    raise exception 'FAIL: a captain got the wrong job s variation (%)', d;
  end if;
  reset role;

  -- The view must not carry the money, whatever any future edit does to it.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'site_variations_v'
     and column_name in ('cost_impact', 'signature');
  if n <> 0 then raise exception 'FAIL: site_variations_v exposes cost_impact or signature'; end if;
  raise notice 'PASS  a captain gets their own variation register with no dollar figure';
end $$;

-- ================ 8. an employee gets nothing from the variation view either
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-0000-0000-0000-0000000000a3';
  select count(*) into n from site_variations_v;
  if n <> 0 then raise exception 'FAIL: an employee saw % variations', n; end if;
  reset role;
  raise notice 'PASS  an employee sees no variations at all';
end $$;

-- ============================= 9. job_cost_v still costs labour for the office
do $$
declare c numeric;
begin
  insert into shifts (company_id, worker_id, site_id, started_at, ended_at, source)
  values ('dddddddd-0000-0000-0000-0000000000f1', 'eeeeeeee-0000-0000-0000-0000000000f3',
          'ffffffff-0000-0000-0000-0000000000e1',
          now() - interval '9 hours', now() - interval '1 hour', 'manual');

  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-0000-0000-0000-0000000000a1';
  select labour_cost into c from job_cost_v where site_id = 'ffffffff-0000-0000-0000-0000000000e1';
  reset role;

  -- 8 hours at 41.25.
  if c is null or c < 329 or c > 331 then
    raise exception 'FAIL: labour cost came out as % — expected 330 (8h at 41.25)', c;
  end if;
  raise notice 'PASS  job_cost_v still prices labour, now from worker_pay';
end $$;

rollback;
