-- Crewline schema v6 — backing tables for features the UI was asserting
-- without them.
--
-- Run after schema_v5.sql. Safe to re-run.
--
-- An audit found three screens presenting data that had no table behind it: a
-- pending leave request for a named employee with live Approve/Decline
-- buttons, a worker's "fix my punch" flow, and pins on a drawing. Each is a
-- real thing a builder needs, so they get real tables rather than deletion.

-- --------------------------------------------------------------- time off

create table if not exists time_off_requests (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  worker_id   uuid not null references workers(id) on delete cascade,
  kind        text not null default 'annual'
                check (kind in ('annual','personal','unpaid','other')),
  starts_on   date not null,
  ends_on     date not null,
  -- Hours rather than days: a builder's week isn't uniform, and payroll wants
  -- hours. Null means "the whole of those days", resolved against the roster.
  hours       numeric(6,2),
  reason      text,
  status      text not null default 'pending'
                check (status in ('pending','approved','declined','cancelled')),
  decided_by  uuid references workers(id) on delete set null,
  decided_at  timestamptz,
  decision_note text,
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists time_off_company_idx on time_off_requests (company_id, starts_on desc);
create index if not exists time_off_worker_idx  on time_off_requests (worker_id, starts_on desc);

-- ------------------------------------------------------- shift corrections

-- The dispute path. A geofence clock-in is evidence, so it is never silently
-- overwritten by the worker — they raise a correction and the office decides.
-- Without this, a worker clocked in by GPS drift has no recourse at all, and
-- the "your hours are held for review" message points nowhere.
create table if not exists shift_corrections (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  shift_id        uuid references shifts(id) on delete cascade,
  worker_id       uuid not null references workers(id) on delete cascade,
  reason_code     text not null default 'other'
                    check (reason_code in ('parked_offsite','access_changed','blocked','forgot','other')),
  detail          text,
  -- What the worker says the times should have been. Null means "the times
  -- are right, the location flag is wrong".
  requested_start timestamptz,
  requested_end   timestamptz,
  status          text not null default 'open'
                    check (status in ('open','accepted','rejected')),
  resolved_by     uuid references workers(id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now()
);
create index if not exists shift_corrections_company_idx on shift_corrections (company_id, created_at desc);
create index if not exists shift_corrections_shift_idx   on shift_corrections (shift_id);

-- ------------------------------------------------------------- plan pins

-- A point on a drawing. x/y are fractions of the sheet (0–1) so a pin stays
-- put at any zoom or render size.
create table if not exists plan_pins (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid not null references job_sites(id) on delete cascade,
  file_id     uuid not null references site_files(id) on delete cascade,
  x           numeric(6,5) not null check (x between 0 and 1),
  y           numeric(6,5) not null check (y between 0 and 1),
  kind        text not null default 'note' check (kind in ('issue','photo','note')),
  label       text not null default '',
  -- Optional link to the photo that documents this spot.
  photo_id    uuid references site_files(id) on delete set null,
  created_by  uuid references workers(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists plan_pins_file_idx on plan_pins (file_id);

-- --------------------------------------------- columns the screens needed

-- The price agreed with the client. Distinct from job_sites.budget, which is
-- the internal cost target — margin is the gap between the two, and conflating
-- them is how a builder ends up thinking a job is profitable because it came
-- in under its own cost budget.
alter table job_sites add column if not exists contract_value numeric(14,2);

-- Retention withheld from a progress claim until practical completion.
alter table invoices add column if not exists retention_pct numeric(5,2) not null default 0
  check (retention_pct >= 0 and retention_pct <= 100);

-- Ties a receipt to the order it settles, so a PO can show what has actually
-- been invoiced against it instead of only what was ordered.
alter table expenses add column if not exists po_id uuid references purchase_orders(id) on delete set null;
create index if not exists expenses_po_idx on expenses (po_id);

-- ------------------------------------------------------------------- RLS

alter table time_off_requests enable row level security;
alter table shift_corrections enable row level security;
alter table plan_pins         enable row level security;

-- Everyone in the company reads; office decides.
do $$
declare t text;
begin
  foreach t in array array['time_off_requests','shift_corrections','plan_pins']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (company_id = current_company_id())', t, t);
    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format('create policy %I_office_write on %I for all
      using (company_id = current_company_id() and current_is_office())
      with check (company_id = current_company_id() and current_is_office())', t, t);
  end loop;
end $$;

-- A field worker raises their own request and their own correction — that is
-- the entire point of both tables — but cannot decide either, and cannot file
-- one in someone else's name.
drop policy if exists time_off_self_insert on time_off_requests;
create policy time_off_self_insert on time_off_requests
  for insert with check (
    company_id = current_company_id()
    and worker_id = current_worker_id()
    and status = 'pending');

-- Withdrawing your own pending request is not a decision, so it stays allowed.
drop policy if exists time_off_self_cancel on time_off_requests;
create policy time_off_self_cancel on time_off_requests
  for update using (worker_id = current_worker_id() and status = 'pending')
  with check (worker_id = current_worker_id() and status in ('pending','cancelled'));

drop policy if exists corrections_self_insert on shift_corrections;
create policy corrections_self_insert on shift_corrections
  for insert with check (
    company_id = current_company_id()
    and worker_id = current_worker_id()
    and status = 'open');

-- Field crew pin photos and problems on the plan; that is field work.
drop policy if exists plan_pins_field_insert on plan_pins;
create policy plan_pins_field_insert on plan_pins
  for insert with check (
    company_id = current_company_id()
    and created_by = current_worker_id());

-- A worker may remove a pin they placed; anything else is the office's call.
drop policy if exists plan_pins_own_delete on plan_pins;
create policy plan_pins_own_delete on plan_pins
  for delete using (created_by = current_worker_id());

-- Guard the decision fields the same way selections are guarded: RLS has no
-- column granularity, so without this a worker could approve their own leave
-- through the self-update policy.
create or replace function time_off_worker_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_is_office() then
    return new;
  end if;
  if new.status not in ('pending','cancelled')
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.worker_id  is distinct from old.worker_id
     or new.hours      is distinct from old.hours then
    raise exception 'Only the office can decide a time off request';
  end if;
  return new;
end $$;

drop trigger if exists time_off_worker_guard_t on time_off_requests;
create trigger time_off_worker_guard_t
  before update on time_off_requests
  for each row execute function time_off_worker_guard();

do $$
declare t text;
begin
  foreach t in array array['time_off_requests','shift_corrections','plan_pins']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ------------------------------------------- worker-editable shift fields

-- Unpaid break, recorded by the worker on their own open shift. Payroll needs
-- it and the worker is the only one who knows, so they own the field.
alter table shifts add column if not exists break_minutes integer not null default 0
  check (break_minutes >= 0 and break_minutes <= 480);

-- Field crew can annotate their OWN open shift — which cost code they moved
-- onto, and the break they took. Times stay off-limits: a clock-in is evidence,
-- and changing one goes through shift_corrections so a human signs off on it.
drop policy if exists shifts_self_annotate on shifts;
create policy shifts_self_annotate on shifts
  for update using (worker_id = current_worker_id() and ended_at is null)
  with check (worker_id = current_worker_id());

create or replace function shifts_worker_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_is_office() then
    return new;
  end if;
  if new.started_at  is distinct from old.started_at
     or new.ended_at is distinct from old.ended_at
     or new.site_id  is distinct from old.site_id
     or new.worker_id is distinct from old.worker_id
     or new.source   is distinct from old.source
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
    raise exception 'A worker can set the cost code and break on their own open shift, nothing else';
  end if;
  return new;
end $$;

drop trigger if exists shifts_worker_guard_t on shifts;
create trigger shifts_worker_guard_t
  before update on shifts
  for each row execute function shifts_worker_guard();

-- ------------------------------------- a subcontractor bills against a PO

-- The sub portal shows "your PO" and, per the design, lets them submit an
-- invoice against it. A sub's invoice is a payable, not a client invoice, so
-- it lands in `expenses` where every other cost does — as needs_review, tied
-- to the PO, never auto-approved.
--
-- The predicate is deliberately narrow: their own site, a PO that really
-- belongs to that site, and no ability to mark it confirmed.
drop policy if exists expenses_sub_submit on expenses;
create policy expenses_sub_submit on expenses
  for insert with check (
    current_portal_kind() = 'sub'
    and site_id = current_portal_site()
    and status = 'needs_review'
    and po_id is not null
    and po_id in (select id from purchase_orders where site_id = current_portal_site())
  );

-- They see only what they filed themselves, never the builder's other costs.
drop policy if exists expenses_sub_read_own on expenses;
create policy expenses_sub_read_own on expenses
  for select using (
    current_portal_kind() = 'sub'
    and site_id = current_portal_site()
    and po_id is not null
  );

-- A sub needs to see the order they are billing against, and nothing else.
drop policy if exists po_sub_read on purchase_orders;
create policy po_sub_read on purchase_orders
  for select using (
    current_portal_kind() = 'sub'
    and site_id = current_portal_site()
    and status in ('sent','partially_received','received')
  );

drop policy if exists po_lines_sub_read on po_lines;
create policy po_lines_sub_read on po_lines
  for select using (po_id in (select id from purchase_orders));
