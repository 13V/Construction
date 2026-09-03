-- Crewline schema v36 — lone worker safety.
--
-- A tiler waterproofing a bathroom at six in the evening is often the only
-- person in the building. If they come off a trestle nobody finds out until
-- somebody notices they never came home. That is the risk this table exists
-- for, and it is a real one on domestic jobs: the crew is two people, the
-- second one left at four, and the site has no supervisor.
--
-- The mechanic is deliberately dull, because dull is what works when somebody
-- is hurt. A worker on their own starts a session and says how often they will
-- be asked to confirm they are all right. The app asks. If they answer, the
-- session rolls on. If they do not answer within the grace window, the session
-- goes `overdue`, and if it stays that way it goes to `alarm` and the office
-- is shown where they were last seen. They can also raise `sos` themselves at
-- any moment without waiting to be asked.
--
-- Why the location columns are on the session rather than left to `positions`:
-- when an alarm fires, the one question is "where are they, now". Reading that
-- out of a location trail means a join and a sort at exactly the moment
-- nothing must be slow or clever, and `positions` is pruned on a retention
-- schedule that a safety record must not inherit. So the last fix is copied
-- here, and it stays for as long as the session does.
--
-- Everything is written by the server (api/lone-worker.ts) under the service
-- role, for the same reason shifts are: a phone must not be the system of
-- record for a document that could be read out at an inquest. Times are
-- stamped server-side, so a device with a wrong clock cannot make a missed
-- check-in look answered.

create table if not exists lone_worker_sessions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  worker_id     uuid not null references workers(id) on delete cascade,
  site_id       uuid references job_sites(id) on delete set null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  -- How often the worker is asked, and how long they get to answer before it
  -- counts as missed. Five minutes is the floor: anything shorter is a phone
  -- that never stops buzzing, which is how a safety feature gets switched off.
  interval_min  int not null default 30 check (interval_min between 5 and 240),
  grace_min     int not null default 5 check (grace_min between 1 and 60),
  due_at        timestamptz not null,
  state         text not null default 'ok' check (state in ('ok', 'overdue', 'alarm', 'ended')),
  -- Where they were last seen, copied from the fix that came with the most
  -- recent check-in, ping or SOS. Null only before the first fix arrives.
  last_lat      double precision,
  last_lng      double precision,
  last_fix_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- One open session per worker. Two would mean two due times and two alarms
-- for one person, and the second one is the one nobody watches.
create unique index if not exists lone_worker_one_open
  on lone_worker_sessions (worker_id)
  where ended_at is null;

create index if not exists lone_worker_sessions_due_idx
  on lone_worker_sessions (due_at)
  where ended_at is null;

-- The audit trail. A session's `state` is the current answer; this is what
-- actually happened, and it is what gets read afterwards.
create table if not exists lone_worker_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  session_id  uuid not null references lone_worker_sessions(id) on delete cascade,
  worker_id   uuid not null references workers(id) on delete cascade,
  kind        text not null check (kind in ('started', 'check_in', 'overdue', 'sos', 'resolved', 'ended')),
  at          timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  accuracy_m  real,
  note        text,
  -- Who acted, when it was not the worker — an office user resolving an alarm.
  actor_id    uuid references workers(id) on delete set null
);

create index if not exists lone_worker_events_session_idx
  on lone_worker_events (session_id, at desc);

alter table lone_worker_sessions enable row level security;
alter table lone_worker_events enable row level security;

-- Everyone in the company can see who is working alone and whether they are
-- overdue. This is not private data within a company: the whole point is that
-- somebody notices.
drop policy if exists lone_worker_sessions_read on lone_worker_sessions;
create policy lone_worker_sessions_read on lone_worker_sessions
  for select using (company_id = current_company_id());

drop policy if exists lone_worker_events_read on lone_worker_events;
create policy lone_worker_events_read on lone_worker_events
  for select using (company_id = current_company_id());

-- Resolving an alarm is an office act and is recorded as one. Everything else
-- is written by the server under the service role, which bypasses RLS: no
-- policy here grants a field worker's device the ability to write its own
-- safety record, and that is deliberate.
drop policy if exists lone_worker_sessions_office_update on lone_worker_sessions;
create policy lone_worker_sessions_office_update on lone_worker_sessions
  for update using (company_id = current_company_id() and current_is_office())
  with check (company_id = current_company_id());
