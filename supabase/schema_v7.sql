-- Crewline schema v7 — in-app notifications.
--
-- Run after schema_v6.sql. Safe to re-run.
--
-- There is still no email, SMS or push transport, and this does not pretend to
-- be one. What it fixes is narrower and real: the office would publish a
-- roster, approve leave or reject a punch correction, and the person it
-- concerned had no way of learning that unless they happened to reopen the
-- right screen.

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  -- Who it is for. Null means everyone in the office.
  worker_id  uuid references workers(id) on delete cascade,
  kind       text not null
               check (kind in ('roster_published','leave_decided','correction_raised',
                               'correction_decided','timeoff_requested','shift_flagged')),
  title      text not null,
  body       text,
  /** The nav item that answers it, so tapping the row goes somewhere useful. */
  link_nav   text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_worker_idx
  on notifications (worker_id, created_at desc);
create index if not exists notifications_company_idx
  on notifications (company_id, created_at desc);

alter table notifications enable row level security;

-- You read your own, plus anything addressed to the office if you are office.
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications
  for select using (
    company_id = current_company_id()
    and (worker_id = current_worker_id() or (worker_id is null and current_is_office()))
  );

-- Marking your own as read is the only write a recipient needs.
drop policy if exists notifications_mark_read on notifications;
create policy notifications_mark_read on notifications
  for update using (
    company_id = current_company_id()
    and (worker_id = current_worker_id() or (worker_id is null and current_is_office()))
  )
  with check (
    company_id = current_company_id()
    and (worker_id = current_worker_id() or (worker_id is null and current_is_office()))
  );

-- ------------------------------------------------------------- the triggers

-- Written as triggers rather than app-level inserts so the notice happens no
-- matter which client made the change — including a future integration that
-- never runs this UI.

create or replace function notify_roster_published()
returns trigger language plpgsql security definer set search_path = public as $$
declare site_name text;
begin
  if new.published and not old.published then
    select name into site_name from job_sites where id = new.site_id;
    insert into notifications (company_id, worker_id, kind, title, body, link_nav)
    values (new.company_id, new.worker_id, 'roster_published',
            'You are rostered on',
            coalesce(site_name, 'A job site') || ' — ' ||
              to_char(new.starts_at at time zone 'Australia/Adelaide', 'Dy DD Mon, HH12:MIam'),
            'Schedule');
  end if;
  return new;
end $$;

drop trigger if exists notify_roster_published_t on assignments;
create trigger notify_roster_published_t
  after update on assignments
  for each row execute function notify_roster_published();

create or replace function notify_leave_decided()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> old.status and new.status in ('approved','declined') then
    insert into notifications (company_id, worker_id, kind, title, body, link_nav)
    values (new.company_id, new.worker_id, 'leave_decided',
            'Time off ' || new.status,
            to_char(new.starts_on, 'DD Mon') || ' – ' || to_char(new.ends_on, 'DD Mon'),
            'Crew');
  end if;
  return new;
end $$;

drop trigger if exists notify_leave_decided_t on time_off_requests;
create trigger notify_leave_decided_t
  after update on time_off_requests
  for each row execute function notify_leave_decided();

-- The office needs telling too, or a request sits unseen.
create or replace function notify_timeoff_requested()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select name into who from workers where id = new.worker_id;
  insert into notifications (company_id, worker_id, kind, title, body, link_nav)
  values (new.company_id, null, 'timeoff_requested',
          coalesce(who, 'Someone') || ' asked for time off',
          to_char(new.starts_on, 'DD Mon') || ' – ' || to_char(new.ends_on, 'DD Mon'),
          'Crew');
  return new;
end $$;

drop trigger if exists notify_timeoff_requested_t on time_off_requests;
create trigger notify_timeoff_requested_t
  after insert on time_off_requests
  for each row execute function notify_timeoff_requested();

create or replace function notify_correction_raised()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select name into who from workers where id = new.worker_id;
  insert into notifications (company_id, worker_id, kind, title, body, link_nav)
  values (new.company_id, null, 'correction_raised',
          coalesce(who, 'Someone') || ' disputed a punch',
          new.detail, 'Crew');
  return new;
end $$;

drop trigger if exists notify_correction_raised_t on shift_corrections;
create trigger notify_correction_raised_t
  after insert on shift_corrections
  for each row execute function notify_correction_raised();

create or replace function notify_correction_decided()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> old.status and new.status in ('accepted','rejected') then
    insert into notifications (company_id, worker_id, kind, title, body, link_nav)
    values (new.company_id, new.worker_id, 'correction_decided',
            'Your correction was ' || new.status,
            coalesce(new.resolution_note, new.detail), 'Timesheets');
  end if;
  return new;
end $$;

drop trigger if exists notify_correction_decided_t on shift_corrections;
create trigger notify_correction_decided_t
  after update on shift_corrections
  for each row execute function notify_correction_decided();

do $$
begin
  begin
    alter publication supabase_realtime add table notifications;
  exception when duplicate_object then null;
  end;
end $$;
