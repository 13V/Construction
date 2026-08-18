-- Crewline schema v33 — dates somebody set by hand.
--
-- A job's dates have so far been worked out: the builder's programme lines
-- that are ours, or failing that when the crew was actually booked. That is
-- right when there is a programme, and useless on the jobs that never get one
-- — a bathroom for a private client has no programme and no bookings until
-- the week it starts, so its dates read as nothing.
--
-- These two are the override. Set, they win over everything derived; null, and
-- nothing changes. Kept as two nullable columns rather than a "has_manual_dates"
-- flag because the flag and the dates can disagree and the columns cannot.

alter table job_sites add column if not exists starts_on date;
alter table job_sites add column if not exists ends_on date;

comment on column job_sites.starts_on is
  'Start date set by hand on the job. Overrides the programme-derived span. Null means derive it.';
comment on column job_sites.ends_on is
  'End date set by hand on the job. Overrides the programme-derived span. Null means derive it.';
