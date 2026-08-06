-- Crewline MVP schema.
-- Run in the Supabase SQL editor, or `supabase db push` with the CLI.
--
-- Design notes:
--  * The geofence engine runs SERVER-SIDE (api/ping.ts). Timesheets must be
--    produced whether or not anyone has the dashboard open, so dwell state is
--    persisted here rather than living in a browser tab.
--  * Location data is sensitive. Every table is RLS-protected and scoped to the
--    caller's company; a worker can only ever insert their own positions.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- companies

create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists workers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  name          text not null,
  initials      text not null,
  trade         text not null,
  rate          numeric(10,2) not null default 0,
  -- Office staff see the whole company; field staff see only themselves.
  is_office     boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists workers_company_idx on workers (company_id);

create table if not exists job_sites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  address     text not null default '',
  job_type    text not null default '',
  status      text not null default 'active'
                check (status in ('active','starting_soon','archived')),
  lat         double precision not null,
  lng         double precision not null,
  radius_m    integer not null default 150 check (radius_m between 25 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists job_sites_company_idx on job_sites (company_id);

-- ---------------------------------------------------------------- telemetry

create table if not exists positions (
  id          bigserial primary key,
  worker_id   uuid not null references workers(id) on delete cascade,
  at          timestamptz not null default now(),
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  real
);
create index if not exists positions_worker_at_idx on positions (worker_id, at desc);

-- Persisted dwell machine, one row per worker. Written only by the service role.
create table if not exists dwell_state (
  worker_id   uuid primary key references workers(id) on delete cascade,
  phase       jsonb not null default '{"kind":"offsite"}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------- derived records

create table if not exists shifts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  worker_id   uuid not null references workers(id) on delete cascade,
  site_id     uuid references job_sites(id) on delete set null,
  started_at  timestamptz not null,
  ended_at    timestamptz,
  cost_code   text,
  -- 'auto' came from the geofence; 'manual' was entered or edited by a human.
  -- The dashboard shows this distinction on every timesheet cell.
  source      text not null default 'auto' check (source in ('auto','manual')),
  edited      boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references workers(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists shifts_company_started_idx on shifts (company_id, started_at desc);
create index if not exists shifts_worker_started_idx on shifts (worker_id, started_at desc);

-- At most one open shift per worker.
create unique index if not exists shifts_one_open_per_worker
  on shifts (worker_id) where ended_at is null;

create table if not exists geofence_events (
  id          bigserial primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  worker_id   uuid not null references workers(id) on delete cascade,
  site_id     uuid references job_sites(id) on delete set null,
  at          timestamptz not null,
  kind        text not null
                check (kind in ('clock_in','clock_out','drive_by_rejected',
                                'geofence_exception','signal_lost')),
  message     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists geofence_events_company_at_idx on geofence_events (company_id, at desc);

-- ---------------------------------------------------------------------- RLS

-- Company of the calling user. STABLE so the planner can cache it per statement.
create or replace function current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from workers where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_worker_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from workers where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_is_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_office from workers where auth_user_id = auth.uid() limit 1), false);
$$;

alter table companies      enable row level security;
alter table workers        enable row level security;
alter table job_sites      enable row level security;
alter table positions      enable row level security;
alter table dwell_state    enable row level security;
alter table shifts         enable row level security;
alter table geofence_events enable row level security;

drop policy if exists companies_read on companies;
create policy companies_read on companies
  for select using (id = current_company_id());

drop policy if exists workers_read on workers;
create policy workers_read on workers
  for select using (company_id = current_company_id());

drop policy if exists job_sites_read on job_sites;
create policy job_sites_read on job_sites
  for select using (company_id = current_company_id());

drop policy if exists job_sites_write on job_sites;
create policy job_sites_write on job_sites
  for all using (company_id = current_company_id() and current_is_office())
  with check (company_id = current_company_id() and current_is_office());

-- A worker may only ever write their own location, and only office staff may
-- read anyone else's. This is the whole privacy posture in two policies.
drop policy if exists positions_insert_own on positions;
create policy positions_insert_own on positions
  for insert with check (worker_id = current_worker_id());

drop policy if exists positions_read on positions;
create policy positions_read on positions
  for select using (
    worker_id = current_worker_id()
    or (current_is_office() and worker_id in (
          select id from workers where company_id = current_company_id()))
  );

drop policy if exists shifts_read on shifts;
create policy shifts_read on shifts
  for select using (
    worker_id = current_worker_id()
    or (company_id = current_company_id() and current_is_office())
  );

drop policy if exists shifts_office_write on shifts;
create policy shifts_office_write on shifts
  for all using (company_id = current_company_id() and current_is_office())
  with check (company_id = current_company_id() and current_is_office());

drop policy if exists events_read on geofence_events;
create policy events_read on geofence_events
  for select using (
    worker_id = current_worker_id()
    or (company_id = current_company_id() and current_is_office())
  );

-- dwell_state has no policies at all: only the service role touches it, and
-- the service role bypasses RLS. Left enabled so nothing leaks by default.

-- ------------------------------------------------------------------ realtime

alter publication supabase_realtime add table positions;
alter publication supabase_realtime add table shifts;
alter publication supabase_realtime add table geofence_events;
