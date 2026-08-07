-- Crewline schema v8 — a worker cannot be in two places at once.
--
-- Run after schema_v7.sql. Safe to re-run.
--
-- There was already a partial unique index stopping two OPEN shifts per
-- worker, but nothing stopped two overlapping CLOSED ones. Seeded data managed
-- to put someone on two job sites at identical times for eleven days running,
-- which doubled their hours, doubled the labour cost on both jobs, and pushed
-- them into overtime that was never worked. Manual timesheet entry can do the
-- same thing by hand.
--
-- Hours are what this app is for, so this is a database constraint rather than
-- a check in one screen: every path that writes a shift has to obey it.

create extension if not exists btree_gist;

do $$
begin
  -- An open shift is treated as running to infinity, so a new shift cannot be
  -- started while one is still open either.
  alter table shifts
    add constraint shifts_no_overlap
    exclude using gist (
      worker_id with =,
      tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz)) with &&
    );
exception
  when duplicate_object then null;
  -- If existing rows already overlap, the constraint cannot be added. Find
  -- them with the query in the comment below, fix them, and re-run.
  when others then
    raise notice 'shifts_no_overlap not added: %', sqlerrm;
end $$;

/*
  Overlapping shifts, if the constraint above refused to apply:

    select a.id, a.worker_id, a.started_at, a.ended_at,
           b.id, b.started_at, b.ended_at
      from shifts a
      join shifts b
        on a.worker_id = b.worker_id
       and a.id < b.id
       and tstzrange(a.started_at, coalesce(a.ended_at, 'infinity'))
        && tstzrange(b.started_at, coalesce(b.ended_at, 'infinity'));
*/
