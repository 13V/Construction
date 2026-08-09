\set ON_ERROR_STOP on
\pset pager off

begin;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-0000000000b1', 'owner@w.test'),
  ('11111111-0000-0000-0000-0000000000b2', 'tiler@w.test'),
  ('11111111-0000-0000-0000-0000000000b3', 'super@w.test');

insert into companies (id, name) values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'Wet Co');

insert into workers (id, company_id, auth_user_id, name, initials, trade, role) values
  ('bbbbbbbb-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   '11111111-0000-0000-0000-0000000000b1', 'Owner', 'OW', 'admin', 'owner'),
  ('bbbbbbbb-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-0000000000e1',
   '11111111-0000-0000-0000-0000000000b2', 'Tiler', 'TL', 'tiler', 'employee');

insert into job_sites (id, company_id, name, lat, lng) values
  ('cccccccc-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000e1', 'Lot 42', -34.9, 138.5),
  ('cccccccc-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-0000000000e1', 'Lot 99', -34.9, 138.5);

-- The builder's supervisor, with a portal login on Lot 42 only.
insert into portal_contacts (company_id, site_id, auth_user_id, kind, name)
values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'cccccccc-0000-0000-0000-0000000000e1',
        '11111111-0000-0000-0000-0000000000b3', 'client', 'Site Super');

-- ====================================== 1. the waterproofing sign-off is stamped
do $$
declare w record;
begin
  insert into waterproofing (id, company_id, site_id, area, product_name, batch_no, coats, status)
  values ('dddddddd-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000e1',
          'cccccccc-0000-0000-0000-0000000000e1', 'Ensuite', 'Ardex WPM 300', 'B-4471', 2, 'in_progress');

  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000b1';

  -- Signed off with a hand-supplied name and date, both of which must be ignored.
  update waterproofing
     set status = 'signed_off',
         signed_off_name = 'Somebody Else',
         signed_off_at = timestamptz '2020-01-01 00:00+00'
   where id = 'dddddddd-0000-0000-0000-0000000000e1';

  reset role;
  select * into w from waterproofing where id = 'dddddddd-0000-0000-0000-0000000000e1';
  if w.signed_off_name <> 'Owner' then
    raise exception 'FAIL: the signer''s name came from the form, not their identity (got %)', w.signed_off_name;
  end if;
  if w.signed_off_at < now() - interval '1 minute' then
    raise exception 'FAIL: a back-dated sign-off was accepted (%)', w.signed_off_at;
  end if;
  if w.completed_on is null then
    raise exception 'FAIL: signed off without a completion date';
  end if;
  raise notice 'PASS  a waterproofing sign-off is stamped from identity, never the form';
end $$;

-- ============================ 2. un-signing takes the certificate with it
do $$
declare w record;
begin
  update waterproofing set certificate_path = 'certs/wp-1.pdf', certificate_no = 'WP-1'
   where id = 'dddddddd-0000-0000-0000-0000000000e1';

  update waterproofing set status = 'failed' where id = 'dddddddd-0000-0000-0000-0000000000e1';
  select * into w from waterproofing where id = 'dddddddd-0000-0000-0000-0000000000e1';
  if w.signed_off_at is not null or w.signed_off_by is not null then
    raise exception 'FAIL: a sign-off survived the record being reopened';
  end if;
  if w.certificate_path is not null or w.certificate_no is not null then
    raise exception 'FAIL: the certificate survived the sign-off being withdrawn';
  end if;
  raise notice 'PASS  withdrawing a sign-off withdraws its certificate too';
end $$;

-- ======================== 3. the register catches a certificate that won't hold
do $$
declare v record;
begin
  update waterproofing set status = 'signed_off', flood_tested = false
   where id = 'dddddddd-0000-0000-0000-0000000000e1';

  select * into v from site_waterproofing_v where site_id = 'cccccccc-0000-0000-0000-0000000000e1';
  if v.unflooded_count <> 1 then
    raise exception 'FAIL: a sign-off with no flood test was not flagged (%)', v.unflooded_count;
  end if;
  if v.unphotographed_count <> 1 then
    raise exception 'FAIL: a sign-off with no photo was not flagged (%)', v.unphotographed_count;
  end if;
  raise notice 'PASS  signed off with no flood test and no photo is flagged, not counted as done';
end $$;

-- ==================================== 4. progress is weighted, not averaged
do $$
declare p record;
begin
  insert into progress_entries (company_id, site_id, area, unit, quantity, pct_complete) values
    ('aaaaaaaa-0000-0000-0000-0000000000e1', 'cccccccc-0000-0000-0000-0000000000e1', 'Powder room', 'm2', 2, 100),
    ('aaaaaaaa-0000-0000-0000-0000000000e1', 'cccccccc-0000-0000-0000-0000000000e1', 'Balconies', 'm2', 300, 10);

  select * into p from site_progress_v where site_id = 'cccccccc-0000-0000-0000-0000000000e1';
  -- The flat average is 55%. The truth is (2*100 + 300*10) / 302 = 10.6%.
  if p.pct_complete > 11 then
    raise exception 'FAIL: progress was averaged, not weighted (got %)', p.pct_complete;
  end if;
  raise notice 'PASS  a 2m2 powder room does not drag a 300m2 job to 55 percent (got %)', p.pct_complete;
end $$;

-- ===================== 5. the latest assessment per area is the one that counts
do $$
declare p record;
begin
  insert into progress_entries (company_id, site_id, area, unit, quantity, pct_complete, assessed_on)
  values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'cccccccc-0000-0000-0000-0000000000e1',
          'Balconies', 'm2', 300, 60, current_date + 1);

  select * into p from site_progress_v where site_id = 'cccccccc-0000-0000-0000-0000000000e1';
  if p.area_count <> 2 then
    raise exception 'FAIL: a re-assessment was counted as a new area (% areas)', p.area_count;
  end if;
  if p.pct_complete < 59 then
    raise exception 'FAIL: the newer assessment was not the one used (got %)', p.pct_complete;
  end if;
  raise notice 'PASS  re-assessing an area replaces it rather than adding to it';
end $$;

-- ================================ 6. a worker raises a defect but cannot edit it
do $$
declare n integer; sev text;
begin
  insert into defects (id, company_id, site_id, location, description, cost_estimate)
  values ('eeeeeeee-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000e1',
          'cccccccc-0000-0000-0000-0000000000e1', 'Ensuite', 'Grout cracked at the hob', 480);

  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000b2';

  insert into defects (company_id, site_id, location, description)
  values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'cccccccc-0000-0000-0000-0000000000e1',
          'Main bath', 'Chipped tile beside the waste');

  update defects set severity = 'critical' where id = 'eeeeeeee-0000-0000-0000-0000000000e1';
  reset role;

  select count(*) into n from defects where site_id = 'cccccccc-0000-0000-0000-0000000000e1';
  if n <> 2 then raise exception 'FAIL: a worker could not raise a defect (% present)', n; end if;

  select severity into sev from defects where id = 'eeeeeeee-0000-0000-0000-0000000000e1';
  if sev <> 'minor' then raise exception 'FAIL: a worker edited a defect (severity now %)', sev; end if;
  raise notice 'PASS  anyone can raise a defect; only office or captain can change one';
end $$;

-- ============================ 7. and cannot type in a progress percentage
do $$
declare n integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000b2';
  begin
    insert into progress_entries (company_id, site_id, area, pct_complete)
    values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'cccccccc-0000-0000-0000-0000000000e1', 'Everything', 100);
  exception when insufficient_privilege then null;
  end;
  reset role;
  select count(*) into n from progress_entries where area = 'Everything';
  if n <> 0 then raise exception 'FAIL: a worker wrote a progress percentage'; end if;
  raise notice 'PASS  progress is not something anyone can type in — it justifies a claim';
end $$;

-- ================== 8. the builder sees their defects, without our repair cost
do $$
declare n integer; c integer;
begin
  insert into defects (company_id, site_id, location, description, cost_estimate)
  values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'cccccccc-0000-0000-0000-0000000000e2',
          'Other job', 'Nothing to do with them', 9999);

  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000b3';

  select count(*) into n from portal_defects_v;
  if n <> 2 then raise exception 'FAIL: the portal saw % defects, should be their job''s 2', n; end if;

  select count(*) into c from information_schema.columns
   where table_name = 'portal_defects_v' and column_name = 'cost_estimate';
  if c <> 0 then raise exception 'FAIL: the portal view exposes what a fix costs us'; end if;

  -- And the table itself must stay shut, or the view was pointless.
  select count(*) into n from defects;
  if n <> 0 then raise exception 'FAIL: a portal login read % defects off the table directly', n; end if;

  raise notice 'PASS  the builder sees their own defect list and not what it costs us to fix';
end $$;

rollback;
