-- Crewline schema v41 — "You are rostered on", once per booking.
--
-- Run after schema_v7.sql. Safe to re-run.
--
-- schema_v7's notify_roster_published only fires when a row goes from
-- unpublished to published: the old office dashboard's draft-then-publish
-- roster. Nothing books that way any more. The website's Book crew
-- (web/data/bookings.ts bookCrew) and the phone's Roster
-- (worker/simple/Projects.tsx AssignSheet) both insert rows that are already
-- published, so nobody was ever told they had been booked.
--
-- This tells them on insert, once per booking rather than once per day: a
-- fortnight's booking is ten rows, and ten identical notices in a row is
-- noise people learn to ignore. A statement-level trigger sees every row the
-- insert added (the transition table), so each person booked onto a job in
-- that insert gets one notice naming the job and the days it covers. Both
-- apps insert a whole booking in one statement (the website in batches of
-- 500 rows, which one booking only exceeds past 500 person-days).
--
-- Unpublished rows are left to the old trigger, which still covers a draft
-- that is published later.

create or replace function notify_roster_booked()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (company_id, worker_id, kind, title, body, link_nav)
  select b.company_id,
         b.worker_id,
         'roster_published',
         'You are rostered on',
         -- What the phone lists the job by: its address, or its name when it has none.
         coalesce(nullif(btrim(s.address), ''), s.name, 'A job site') || ' — ' ||
           case when b.days = 1
                then to_char(b.first_at at time zone 'Australia/Adelaide', 'Dy FMDD Mon, FMHH12:MIam')
                else to_char(b.first_at at time zone 'Australia/Adelaide', 'Dy FMDD Mon') || ' to ' ||
                     to_char(b.last_at at time zone 'Australia/Adelaide', 'Dy FMDD Mon') ||
                     ' (' || b.days || ' days)'
           end,
         'Schedule'
    from (
      select company_id, worker_id, site_id,
             min(starts_at) as first_at,
             max(starts_at) as last_at,
             count(*)       as days
        from booked
       where published
       group by company_id, worker_id, site_id
    ) b
    left join job_sites s on s.id = b.site_id;
  return null;
end $$;

drop trigger if exists notify_roster_booked_t on assignments;
create trigger notify_roster_booked_t
  after insert on assignments
  referencing new table as booked
  for each statement execute function notify_roster_booked();

comment on function notify_roster_booked() is
  'One "You are rostered on" notice per person per job per booking insert, from the website''s Book crew or the phone''s Roster.';
