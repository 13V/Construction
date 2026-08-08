\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------- fixtures
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'office@t.test'),
  ('22222222-2222-2222-2222-222222222222', 'chippie@t.test');

insert into companies (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Tiling');

insert into workers (id, company_id, auth_user_id, name, initials, trade, rate, is_office) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Office', 'OF', 'admin', 0, true),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'Chippie', 'CH', 'tiler', 55, false);

insert into job_sites (id, company_id, name, lat, lng) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Lot 42', -34.9, 138.5),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Lot 43', -34.9, 138.5);

-- Lot 42: $80,000 EX GST contract, 5% retention.
insert into contracts (id, company_id, site_id, contract_sum, gst_inclusive, retention_pct, status)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001', 80000, false, 5, 'active');

-- Lot 43: $55,000 INC GST contract, to prove the other basis.
insert into contracts (id, company_id, site_id, contract_sum, gst_inclusive, status)
values ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000002', 55000, true, 'active');

insert into change_orders (id, company_id, site_id, contract_id, co_no, description, cost_impact, status) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'VO-1', 'Extra wet area', 12000, 'draft'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'VO-2', 'Feature niche', 6400, 'pending_client'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'VO-3', 'Deleted laundry tiling', -2000, 'pending_client');

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- =========================================================== 1. the trigger
do $$
declare a date;
begin
  select approved_on into a from change_orders where co_no = 'VO-1';
  if a is not null then raise exception 'FAIL: a draft variation carries an approval date'; end if;

  update change_orders set status = 'approved' where co_no = 'VO-1';
  select approved_on into a from change_orders where co_no = 'VO-1';
  if a is distinct from current_date then raise exception 'FAIL: approval was not stamped (got %)', a; end if;

  -- Walked back out of approved: the date must go with it, or it reads as
  -- authority to bill that no longer exists.
  update change_orders set status = 'rejected' where co_no = 'VO-1';
  select approved_on into a from change_orders where co_no = 'VO-1';
  if a is not null then raise exception 'FAIL: approval date survived a decline (got %)', a; end if;

  update change_orders set status = 'approved' where co_no = 'VO-1';

  -- A back-dated approval entered by hand must not be overwritten.
  update change_orders set approved_on = date '2026-01-15' where co_no = 'VO-1';
  select approved_on into a from change_orders where co_no = 'VO-1';
  if a <> date '2026-01-15' then raise exception 'FAIL: a hand-set approval date was clobbered (got %)', a; end if;

  raise notice 'PASS  approval date is stamped, cleared and never clobbered';
end $$;

-- ====================================================== 2. the value ladder
do $$
declare v record;
begin
  select * into v from job_value_v where site_id = 'cccccccc-0000-0000-0000-000000000001';

  if v.contract_sum_ex <> 80000 then raise exception 'FAIL: contract_sum_ex % <> 80000', v.contract_sum_ex; end if;
  if v.contract_sum_inc <> 88000 then raise exception 'FAIL: contract_sum_inc % <> 88000', v.contract_sum_inc; end if;

  -- Only VO-1 is approved. VO-2 and VO-3 are pending and must NOT be counted.
  if v.approved_variations <> 12000 then raise exception 'FAIL: approved % <> 12000', v.approved_variations; end if;
  if v.pending_variations <> 4400 then raise exception 'FAIL: pending % <> 4400', v.pending_variations; end if;
  if v.approved_variation_count <> 1 then raise exception 'FAIL: approved count %', v.approved_variation_count; end if;
  if v.pending_variation_count <> 2 then raise exception 'FAIL: pending count %', v.pending_variation_count; end if;

  if v.job_value_ex <> 92000 then raise exception 'FAIL: job_value_ex % <> 92000', v.job_value_ex; end if;
  if v.job_value_inc <> 101200 then raise exception 'FAIL: job_value_inc % <> 101200', v.job_value_inc; end if;

  raise notice 'PASS  $80k contract + $12k approved = $92k ex / $101.2k inc, pending excluded';
end $$;

-- ============================================== 3. the inc-GST contract too
do $$
declare v record;
begin
  select * into v from job_value_v where site_id = 'cccccccc-0000-0000-0000-000000000002';
  if v.contract_sum_inc <> 55000 then raise exception 'FAIL: inc % <> 55000', v.contract_sum_inc; end if;
  if v.contract_sum_ex <> 50000 then raise exception 'FAIL: ex % <> 50000', v.contract_sum_ex; end if;
  if v.job_value_inc <> 55000 then raise exception 'FAIL: job_value_inc %', v.job_value_inc; end if;
  if v.job_value_ex <> 50000 then raise exception 'FAIL: job_value_ex %', v.job_value_ex; end if;
  raise notice 'PASS  a GST-inclusive contract sum decomposes the other way';
end $$;

-- ============================================================== 4. claiming
insert into invoices (company_id, site_id, contract_id, invoice_no, amount, tax_amount,
                      retention_pct, retention_amount, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 'INV-1', 44000, 4000, 5, 2000, 'sent'),
       -- A draft claim: raised, not sent, and therefore not claimed.
       ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 'INV-2', 11000, 1000, 0, 0, 'draft'),
       -- A void claim must not count either.
       ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 'INV-3', 99000, 9000, 0, 0, 'void');

do $$
declare v record;
begin
  select * into v from job_value_v where site_id = 'cccccccc-0000-0000-0000-000000000001';
  if v.claimed_inc <> 44000 then raise exception 'FAIL: claimed_inc % <> 44000 (draft or void counted)', v.claimed_inc; end if;
  if v.claimed_ex <> 40000 then raise exception 'FAIL: claimed_ex % <> 40000', v.claimed_ex; end if;
  if v.draft_invoice_count <> 1 then raise exception 'FAIL: draft count %', v.draft_invoice_count; end if;
  if v.retention_held <> 2000 then raise exception 'FAIL: retention %', v.retention_held; end if;
  -- 101,200 job value inc GST less 44,000 claimed.
  if v.to_claim_inc <> 57200 then raise exception 'FAIL: to_claim % <> 57200', v.to_claim_inc; end if;
  if v.outstanding_inc <> 44000 then raise exception 'FAIL: outstanding %', v.outstanding_inc; end if;
  raise notice 'PASS  drafts and voids are not claims; left to claim is job value less sent';
end $$;

-- ====================================================== 5. over-claiming
insert into invoices (company_id, site_id, contract_id, invoice_no, amount, tax_amount, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 'INV-4', 66000, 6000, 'sent');

do $$
declare v record;
begin
  select * into v from job_value_v where site_id = 'cccccccc-0000-0000-0000-000000000001';
  if v.to_claim_inc >= 0 then
    raise exception 'FAIL: over-claim was clamped to zero instead of shown (got %)', v.to_claim_inc;
  end if;
  raise notice 'PASS  an over-claim reads negative rather than being hidden (%)', v.to_claim_inc;
end $$;

-- =================================================== 6. a job with no contract
do $$
declare v record;
begin
  insert into job_sites (id, company_id, name, lat, lng)
  values ('cccccccc-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'No contract', -34.9, 138.5);

  select * into v from job_value_v where site_id = 'cccccccc-0000-0000-0000-000000000009';
  if v is null then raise exception 'FAIL: a job with no contract vanished from the view'; end if;
  if v.contract_id is not null then raise exception 'FAIL: contract_id should be null'; end if;
  if v.job_value_ex <> 0 or v.contract_sum_inc <> 0 then
    raise exception 'FAIL: a contractless job should read zero, got % / %', v.job_value_ex, v.contract_sum_inc;
  end if;
  raise notice 'PASS  a job with no contract still has a row, reading zero';
end $$;

-- ============================================= 7. the field worker sees none
do $$
declare n integer;
begin
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  select count(*) into n from job_value_v;
  if n <> 0 then raise exception 'FAIL: a field worker read % rows of contract value', n; end if;
  raise notice 'PASS  job_value_v is empty for a non-office worker';
end $$;

-- ================================================ 8. one contract per site
do $$
begin
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  begin
    insert into contracts (company_id, site_id, contract_sum)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 1);
    raise exception 'FAIL: a second contract was accepted on the same job';
  exception when unique_violation then
    raise notice 'PASS  a job cannot carry two contracts';
  end;
end $$;

rollback;
