\set ON_ERROR_STOP on
\pset pager off

begin;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-0000000000c1', 'owner@p.test'),
  ('11111111-0000-0000-0000-0000000000c2', 'tiler@p.test');

insert into companies (id, name) values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'Profit Co');

insert into workers (id, company_id, auth_user_id, name, initials, trade, role) values
  ('bbbbbbbb-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000d1',
   '11111111-0000-0000-0000-0000000000c1', 'Owner', 'OW', 'admin', 'owner'),
  ('bbbbbbbb-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000d1',
   '11111111-0000-0000-0000-0000000000c2', 'Tiler', 'TL', 'tiler', 'employee');

-- The wage lives in its own table since schema_v24, so that a captain reading
-- the crew list cannot read what anyone is paid. job_cost_v prices labour from
-- here now, which is what the $500 below is built from.
insert into worker_pay (worker_id, company_id, rate) values
  ('bbbbbbbb-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000d1', 0),
  ('bbbbbbbb-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000d1', 50)
  on conflict (worker_id) do update set rate = excluded.rate;

insert into job_sites (id, company_id, name, lat, lng) values
  ('cccccccc-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'Lot 42', -34.9, 138.5);

insert into contracts (company_id, site_id, contract_sum, gst_inclusive)
values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'cccccccc-0000-0000-0000-0000000000d1', 40000, false);

-- 10 hours net of a 60 minute break, at $50 = $500.
insert into shifts (company_id, worker_id, site_id, started_at, ended_at, break_minutes, source) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-0000000000d2',
   'cccccccc-0000-0000-0000-0000000000d1', now() - interval '11 hours', now(), 60, 'manual'),
  -- Still on the clock. Must NOT be costed: a job whose cost changes on every
  -- page refresh has no authority.
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-0000000000d1',
   'cccccccc-0000-0000-0000-0000000000d1', now() - interval '2 hours', null, 0, 'manual');

-- A receipt for the tiles ($1,100 inc, $100 GST), and the material line it
-- produced. Counting both would double it; counting the GST would inflate it.
insert into expenses (id, company_id, site_id, vendor, amount, tax) values
  ('eeeeeeee-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000d1',
   'cccccccc-0000-0000-0000-0000000000d1', 'Tile Mart', 1100, 100),
  ('eeeeeeee-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000d1',
   'cccccccc-0000-0000-0000-0000000000d1', 'Fuel', 220, 20);

insert into materials (company_id, site_id, name, quantity, unit_cost, status, expense_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'cccccccc-0000-0000-0000-0000000000d1',
   'Porcelain 600x600', 40, 25, 'delivered', 'eeeeeeee-0000-0000-0000-0000000000d1'),
  -- Sent back. Not a cost.
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'cccccccc-0000-0000-0000-0000000000d1',
   'Wrong trim', 10, 30, 'returned', null);

insert into subcontractors (id, company_id, name)
values ('99999999-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'Bob''s Tiling');
insert into subcontract_work (company_id, site_id, subcontractor_id, worked_on, quantity, rate)
values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'cccccccc-0000-0000-0000-0000000000d1',
        '99999999-0000-0000-0000-0000000000d1', current_date, 8, 65);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000c1';

-- ============================================================ 1. the cost side
do $$
declare c record;
begin
  select * into c from job_cost_v where site_id = 'cccccccc-0000-0000-0000-0000000000d1';

  if c.labour_hours <> 10 then raise exception 'FAIL: labour hours % <> 10 (open shift counted?)', c.labour_hours; end if;
  if c.labour_cost <> 500 then raise exception 'FAIL: labour cost % <> 500', c.labour_cost; end if;

  -- 40 x $25 delivered. The returned trim is excluded.
  if c.material_cost <> 1000 then raise exception 'FAIL: materials % <> 1000 (returned stock counted?)', c.material_cost; end if;

  -- Only the fuel docket, net of its GST: $220 - $20 = $200. The tile receipt is
  -- already in materials.
  if c.expense_cost <> 200 then raise exception 'FAIL: expenses % <> 200 (GST or a linked receipt counted?)', c.expense_cost; end if;

  if c.sublet_cost <> 520 then raise exception 'FAIL: sublet % <> 520', c.sublet_cost; end if;
  if c.total_cost <> 2220 then raise exception 'FAIL: total cost % <> 2220', c.total_cost; end if;

  raise notice 'PASS  cost is wages + materials + net-of-GST expenses + sublet, counted once';
end $$;

-- ========================================================== 2. and the margin
do $$
declare p record;
begin
  select * into p from job_profit_v where site_id = 'cccccccc-0000-0000-0000-0000000000d1';

  if p.margin <> 37780 then raise exception 'FAIL: margin % <> 37780', p.margin; end if;
  if p.margin_pct <> 94.5 then raise exception 'FAIL: margin pct % <> 94.5', p.margin_pct; end if;

  -- (40000 - 1000 - 200 - 520) / 10 hours = 3828.00 an hour.
  if p.value_per_labour_hour <> 3828 then
    raise exception 'FAIL: value per hour % <> 3828', p.value_per_labour_hour;
  end if;

  raise notice 'PASS  margin and return per labour hour come out of one definition';
end $$;

-- ============================== 3. an approved variation lifts the margin too
do $$
declare before_margin numeric; after_margin numeric;
begin
  select margin into before_margin from job_profit_v where site_id = 'cccccccc-0000-0000-0000-0000000000d1';

  insert into change_orders (company_id, site_id, co_no, description, cost_impact, status)
  values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'cccccccc-0000-0000-0000-0000000000d1',
          'VO-1', 'Extra niche', 3000, 'approved');

  select margin into after_margin from job_profit_v where site_id = 'cccccccc-0000-0000-0000-0000000000d1';
  if after_margin - before_margin <> 3000 then
    raise exception 'FAIL: an approved variation moved margin by % not 3000', after_margin - before_margin;
  end if;
  raise notice 'PASS  approving a variation lifts the job''s margin by its value';
end $$;

-- ======================================================= 4. the overview row
do $$
declare o record;
begin
  insert into invoices (company_id, site_id, invoice_no, amount, issued_on, due_on, status)
  values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'cccccccc-0000-0000-0000-0000000000d1',
          'INV-9', 5000, current_date - 40, current_date - 10, 'sent');

  select * into o from company_overview_v;
  if o.active_jobs <> 1 then raise exception 'FAIL: active jobs %', o.active_jobs; end if;
  if o.on_the_clock <> 1 then raise exception 'FAIL: on the clock % <> 1', o.on_the_clock; end if;
  if o.overdue_invoices <> 1 then raise exception 'FAIL: overdue invoices %', o.overdue_invoices; end if;
  if o.work_in_hand <> 43000 then raise exception 'FAIL: work in hand % <> 43000', o.work_in_hand; end if;
  raise notice 'PASS  the overview counts jobs, people on the clock, and what is overdue';
end $$;

-- ================================================ 5. and none of it leaks out
do $$
declare n integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000c2';
  select count(*) into n from job_cost_v;
  if n <> 0 then raise exception 'FAIL: a worker read % rows of job cost', n; end if;
  select count(*) into n from job_profit_v;
  if n <> 0 then raise exception 'FAIL: a worker read % rows of job profit', n; end if;
  select count(*) into n from company_overview_v;
  if n <> 0 then raise exception 'FAIL: a worker read the company overview'; end if;
  raise notice 'PASS  cost, profit and the overview are office-only';
end $$;

rollback;
