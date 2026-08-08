\set ON_ERROR_STOP on
\pset pager off

begin;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-0000000000d1', 'a@prog.test'),
  ('11111111-0000-0000-0000-0000000000d2', 'b@prog.test'),
  ('11111111-0000-0000-0000-0000000000d3', 'tiler@prog.test');

insert into companies (id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'Us'),
  ('aaaaaaaa-0000-0000-0000-0000000000c2', 'Someone else');

insert into workers (id, company_id, auth_user_id, name, initials, trade, role) values
  ('bbbbbbbb-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   '11111111-0000-0000-0000-0000000000d1', 'Our owner', 'OU', 'admin', 'owner'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-0000000000c2',
   '11111111-0000-0000-0000-0000000000d2', 'Their owner', 'TH', 'admin', 'owner'),
  ('bbbbbbbb-0000-0000-0000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   '11111111-0000-0000-0000-0000000000d3', 'Our tiler', 'TL', 'tiler', 'employee');

insert into job_sites (id, company_id, name, lat, lng) values
  ('cccccccc-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Lot 42', -34.9, 138.5);

-- Rev A, then Rev B with tiling pushed out nine days.
insert into programmes (id, company_id, site_id, name, revision, status, received_on) values
  ('dddddddd-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'cccccccc-0000-0000-0000-0000000000c1', 'Rev A.xlsx', 'A', 'current', current_date - 30);

insert into programme_tasks (company_id, programme_id, site_id, ref, name, starts_on, ends_on, is_ours, is_predecessor, status) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-0000000000c1',
   'cccccccc-0000-0000-0000-0000000000c1', '10', 'Screed to falls', current_date + 1, current_date + 2, false, true, 'planned'),
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-0000000000c1',
   'cccccccc-0000-0000-0000-0000000000c1', '12', 'Wall and floor tiling', current_date + 5, current_date + 12, true, false, 'planned');

-- ============================================ 1. one current programme per job
do $$
declare n integer;
begin
  insert into programmes (id, company_id, site_id, name, revision, status, received_on)
  values ('dddddddd-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-0000000000c1',
          'cccccccc-0000-0000-0000-0000000000c1', 'Rev B.xlsx', 'B', 'current', current_date);

  select count(*) into n from programmes
   where site_id = 'cccccccc-0000-0000-0000-0000000000c1' and status = 'current';
  if n <> 1 then raise exception 'FAIL: % current programmes on one job', n; end if;
  raise notice 'PASS  importing a revision supersedes the one before it';
end $$;

insert into programme_tasks (company_id, programme_id, site_id, ref, name, starts_on, ends_on, is_ours, is_predecessor, status) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-0000000000c2',
   'cccccccc-0000-0000-0000-0000000000c1', '10', 'Screed to falls', current_date + 1, current_date + 2, false, true, 'planned'),
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-0000000000c2',
   'cccccccc-0000-0000-0000-0000000000c1', '12', 'Wall and floor tiling', current_date + 14, current_date + 21, true, false, 'planned');

-- ============================================== 2. the previous dates carry over
do $$
declare moved integer; t record;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000d1';

  select programme_carry_previous('dddddddd-0000-0000-0000-0000000000c2') into moved;
  if moved <> 2 then raise exception 'FAIL: carried % rows, expected 2', moved; end if;

  reset role;
  select * into t from programme_tasks
   where programme_id = 'dddddddd-0000-0000-0000-0000000000c2' and ref = '12';
  if t.prev_starts_on <> current_date + 5 then
    raise exception 'FAIL: the previous start did not carry (got %)', t.prev_starts_on;
  end if;
  raise notice 'PASS  a revision carries the dates it moved from';
end $$;

-- ============================ 3. and cannot be pointed at another company's job
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  -- Signed in as the OTHER company's owner, passing our programme id.
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000d2';
  begin
    perform programme_carry_previous('dddddddd-0000-0000-0000-0000000000c2');
  exception when raise_exception then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL: a security definer RPC rewrote another company''s programme';
  end if;
  raise notice 'PASS  the programme RPC refuses another company''s id';
end $$;

-- ================================= 4. when we are on, how far it moved, readiness
do $$
declare v record;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000d1';

  select * into v from site_programme_v where site_id = 'cccccccc-0000-0000-0000-0000000000c1';
  if v.our_start <> current_date + 14 then
    raise exception 'FAIL: our start read % not the current revision''s', v.our_start;
  end if;
  if v.start_moved_days <> 9 then
    raise exception 'FAIL: the slip read % days, should be 9', v.start_moved_days;
  end if;
  if v.ready is not false then
    raise exception 'FAIL: ready should be false with the screed still open, got %', v.ready;
  end if;
  if v.blocked_by is null or v.blocked_by not like '%Screed%' then
    raise exception 'FAIL: "not ready" did not name what is blocking (%)', v.blocked_by;
  end if;
  raise notice 'PASS  our window, the nine day slip, and what is blocking it';
end $$;

-- ================================= 5. readiness goes green when the screed is done
do $$
declare v record;
begin
  reset role;
  update programme_tasks set status = 'done'
   where programme_id = 'dddddddd-0000-0000-0000-0000000000c2' and ref = '10';

  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000d1';
  select * into v from site_programme_v where site_id = 'cccccccc-0000-0000-0000-0000000000c1';
  if v.ready is not true then raise exception 'FAIL: still not ready with nothing open, got %', v.ready; end if;
  raise notice 'PASS  readiness turns over when the trade we follow finishes';
end $$;

-- ========================= 6. an employee cannot sign off waterproofing on insert
do $$
declare st text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-0000000000d3';

  -- Creating the record is theirs to do — they laid the membrane. Creating it
  -- ALREADY signed off is not: that is a certificate somebody can be
  -- prosecuted over.
  insert into waterproofing (id, company_id, site_id, area, status)
  values ('99999999-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000c1',
          'cccccccc-0000-0000-0000-0000000000c1', 'Ensuite', 'signed_off');

  reset role;
  select status into st from waterproofing where id = '99999999-0000-0000-0000-0000000000c1';
  if st = 'signed_off' then
    raise exception 'FAIL: an employee created a pre-signed waterproofing certificate';
  end if;
  raise notice 'PASS  an employee can start a wet area record but not sign one off (%)', st;
end $$;

rollback;
