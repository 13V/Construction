-- Crewline schema v18 — the third role, and crews as units.
--
-- Run after schema_v17.sql. Safe to re-run.
--
-- The client asked for three tiers: the owner, a crew captain who runs "their
-- own job", and an employee. The app had two, expressed as one boolean:
--
--     workers.is_office  true = sees the whole company, false = sees themselves
--
-- There was no way to say "this person runs Lot 42 and nothing else", so the
-- only way to give a leading hand what they needed to do their job was to make
-- them office — which handed them every pay rate, every invoice and every
-- contract sum in the business. The missing tier was a security problem, not a
-- convenience one.
--
-- The line drawn here, and the reason for it: **a captain runs the work, the
-- owner runs the money.** A captain gets their own jobs' variations, defects,
-- instructions, progress, materials, logs and timesheets — everything needed to
-- run a job and sign off a day. They do not get pay rates, invoices, contract
-- sums or margins, on their own jobs or any other. Those stay owner-only,
-- exactly where schema_v14 put them.

-- ---------------------------------------------------------------- the role

alter table workers add column if not exists role text not null default 'employee'
  check (role in ('owner','captain','employee'));

comment on column workers.role is
  'owner = the whole company. captain = the jobs they run, work only, never money. employee = themselves.';

-- Backfill before anything reads it: every existing office user is an owner.
update workers set role = 'owner' where is_office and role <> 'owner';

-- `is_office` is not dropped, and that is deliberate rather than lazy. Every
-- money policy written in schema_v14 keys off current_is_office(), the app
-- writes it from two screens, and crew_v exposes it. Keeping the two in step by
-- trigger means this migration changes no existing policy and no existing
-- screen, and a captain lands on the correct side of every one of them —
-- is_office false — without a single line of v14 being touched.
--
-- The sync is two-way because both are written in practice: new code sets the
-- role, the Crew screen still ticks the box.
create or replace function workers_sync_role() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- Old code paths pass is_office and no role at all.
    if new.is_office and new.role = 'employee' then
      new.role := 'owner';
    end if;
  elsif new.role is distinct from old.role then
    -- Role was the thing edited: it wins.
    null;
  elsif new.is_office is distinct from old.is_office then
    -- The box was the thing ticked: derive the role from it. Turning it off
    -- makes someone an employee, not a captain — promoting to captain is a
    -- deliberate act and must never be a side effect of unticking a box.
    new.role := case when new.is_office then 'owner' else 'employee' end;
  end if;

  new.is_office := (new.role = 'owner');
  return new;
end $$;

drop trigger if exists workers_sync_role_t on workers;
create trigger workers_sync_role_t
  before insert or update on workers
  for each row execute function workers_sync_role();

-- ------------------------------------------------------------- the crews

-- A crew is how this business actually schedules: two tilers and a labourer go
-- to a job together, and the office books the crew, not three people. Booking
-- them still writes one `assignments` row per person — the roster, the
-- notifications and the geofence all work per worker and none of that should be
-- rebuilt — but the rows carry the crew_id that made them, so the block can be
-- moved or pulled off the job as the one thing it is.
create table if not exists crews (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  /** The captain. Their scope follows the crew onto whatever job it is booked on. */
  captain_id  uuid references workers(id) on delete set null,
  /** For the roster block. Free text so the palette can change without a migration. */
  colour      text,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists crews_company_idx on crews (company_id, active);

create table if not exists crew_members (
  crew_id    uuid not null references crews(id) on delete cascade,
  worker_id  uuid not null references workers(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (crew_id, worker_id)
);
create index if not exists crew_members_worker_idx on crew_members (worker_id);

alter table assignments add column if not exists crew_id uuid references crews(id) on delete set null;
create index if not exists assignments_crew_idx on assignments (crew_id, starts_at);

-- Who runs this job. Set directly, or reached through whichever crew is on it.
alter table job_sites add column if not exists captain_id uuid references workers(id) on delete set null;

comment on column job_sites.captain_id is
  'The crew captain running this job. Read by captains_site(), which is what every captain-scoped policy keys off.';

-- ------------------------------------------------------- what a captain sees

create or replace function current_worker_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from workers where auth_user_id = auth.uid() limit 1), 'employee');
$$;

/**
 * True when the caller is a captain AND this is one of their jobs — named on
 * the job itself, or captain of a crew booked on it.
 *
 * Returns false for the service role (auth.uid() is null → current_worker_id()
 * is null → neither exists() matches), which is correct: the geofence engine
 * bypasses RLS entirely and must never depend on a role check.
 */
create or replace function captains_site(p_site uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_site is not null
     and (select role from workers where auth_user_id = auth.uid() limit 1) = 'captain'
     and (
       exists (select 1 from job_sites s
                where s.id = p_site and s.captain_id = current_worker_id())
       or exists (select 1 from crews c
                   join assignments a on a.crew_id = c.id
                  where a.site_id = p_site and c.captain_id = current_worker_id())
     );
$$;

-- ------------------------------------------------------------------- RLS

alter table crews        enable row level security;
alter table crew_members enable row level security;

-- Who is in which crew is roster information, not commercial: the whole company
-- reads it, the office writes it.
do $$
declare t text;
begin
  foreach t in array array['crews','crew_members']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (company_id = current_company_id())', t, t);
    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format('create policy %I_office_write on %I for all
      using (company_id = current_company_id() and current_is_office())
      with check (company_id = current_company_id() and current_is_office())', t, t);
  end loop;
end $$;

-- ------------------------------------------- the captain's own jobs, widened
--
-- Each of these ADDS a captain clause to a policy schema_v14 wrote. The office
-- and worker halves are repeated verbatim so the policy still reads as one
-- rule; changing any of them here would silently rewrite v14's decision.

-- Variations on their own job: a captain is the person the builder collars on
-- site about extra work, so they have to be able to see what has been raised
-- and what has been approved. They still cannot raise or approve one — that is
-- a commitment of the company's money.
drop policy if exists change_orders_read on change_orders;
create policy change_orders_read on change_orders
  for select using (
    company_id = current_company_id()
    and (current_is_office() or captains_site(site_id))
  );

-- Materials on their own job. What was delivered and what is still coming is
-- the question that stops a crew standing around.
drop policy if exists materials_captain_write on materials;
create policy materials_captain_write on materials
  for all
  using (company_id = current_company_id() and captains_site(site_id))
  with check (company_id = current_company_id() and captains_site(site_id));

-- Timesheets for the crew on their job, including approving them. This is the
-- single most useful thing the tier unlocks: the person who was there is the
-- person who should be signing off the hours.
drop policy if exists shifts_captain_write on shifts;
create policy shifts_captain_write on shifts
  for all
  using (company_id = current_company_id() and captains_site(site_id))
  with check (company_id = current_company_id() and captains_site(site_id));

-- The daily log for their own job.
drop policy if exists daily_logs_captain_write on daily_logs;
create policy daily_logs_captain_write on daily_logs
  for all
  using (company_id = current_company_id() and captains_site(site_id))
  with check (company_id = current_company_id() and captains_site(site_id));

-- RLS is only half of the shifts story. shifts_worker_guard (schema_v6, fixed
-- in v12) refuses any non-office edit that moves a time or sets approved_at —
-- which would have made shifts_captain_write above completely inert, letting a
-- captain past the policy and then straight into a P0001. The guard has to know
-- about the tier too.
create or replace function shifts_worker_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No auth.uid() means the service role: the geofence engine, or a migration.
  -- It is the system of record for times and MUST be able to set ended_at.
  if auth.uid() is null then
    return new;
  end if;

  if current_is_office() then
    return new;
  end if;

  -- A captain, on one of their own jobs. The person who was standing there is
  -- the right person to fix a punch and sign off the day. Scoped by the site on
  -- the row, so it stops at the boundary of the jobs they run — and checked
  -- against BOTH sites, so a captain cannot drag a shift off someone else's job
  -- onto their own, or off their own onto someone else's. (The trigger is
  -- BEFORE UPDATE only — schema_v6 — so `old` is always there.)
  if captains_site(new.site_id) and captains_site(old.site_id) then
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

-- Deliberately NOT widened: invoices, invoice_payments, estimates,
-- purchase_orders, contracts, job_value_v, job_money_v, workers.rate,
-- subcontractors, subcontract_work, builders. A captain runs the work. None of
-- those are the work.

-- --------------------------------------------------------- crew_v gains role

-- crew_v is what the worker app and any crew list read instead of `workers`,
-- because `rate` must not be on it. It has to carry the role now, or a screen
-- wanting to show "captain" would have to go back to the table it was moved off.
-- `cascade`, on every view drop in this repo. A later migration builds views on
-- top of this one (job_profit_v and company_overview_v read job_value_v and
-- invoice_status_v), and Postgres refuses to drop a view something depends on.
-- Without cascade, re-running this file on an up-to-date database aborts — and
-- DEPLOY.md's instruction is to run the whole list in order, so an abort here
-- means every migration after it silently never runs. That exact failure has
-- now happened twice. The dependants are recreated by the later file, which
-- always runs after this one; the run is only ever safe as a complete run,
-- which is what the runbook has said all along.
drop view if exists crew_v cascade;
create view crew_v with (security_invoker = on) as
  select id, company_id, auth_user_id, name, initials, trade, is_office, role, active, ordinary_hours
    from workers
   where company_id = current_company_id();

-- --------------------------------------------------------------- realtime

do $$
declare t text;
begin
  foreach t in array array['crews','crew_members']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
