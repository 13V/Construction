-- Crewline schema v22 — location retention.
--
-- Run after schema_v21.sql. Safe to re-run.
--
-- api/ping.ts inserts a row into `positions` on every fix — roughly every 20
-- seconds per tracked worker, all day, every day a shift is open — and nothing
-- in this repo has ever deleted one. There is no TTL and no pg_cron job
-- anywhere in supabase/. The result is an indefinite, minute-by-minute
-- movement history of named employees, which is a privacy liability before it
-- is a storage one: Apple's 5.1.1(ii) expects personal data to be kept only as
-- long as it is needed for the feature it supports, and "forever" is not an
-- answer to "how long".
--
-- What is actually needed, read straight out of src/data/useLive.ts: every
-- query against `positions` is `.gte('at', startOfToday())`. The live map's
-- pin is the last point of today's trail, "traveling" status comes from
-- today's last ping, and the outside-geofence exception is computed from the
-- same trail — all four of them are today-only reads, and every one of them
-- keeps working under a blanket age cutoff because none of them ever look
-- further back. (geofence_events and shifts are untouched here: they are the
-- derived, human-readable record — "clocked in at Lot 42, 7:04am" and the
-- payroll row itself — not raw telemetry, and payroll and dispute evidence
-- need to outlive a single day. dwell_state is one current row per worker,
-- already as small as it can be.)
--
-- The window is 3 days, not 1. `useLive`'s "today" is computed in the caller's
-- own browser, and this business runs across Adelaide job sites that a laptop
-- clock, a stale system timezone, or a UI left open across midnight could read
-- a few hours either side of correct; a straight 24-hour cutoff would let
-- exactly that class of accident silently trim the one day still being
-- viewed. 3 days is comfortably past any such skew while still being "days",
-- not "indefinitely" — the number a reviewer or a regulator can be told
-- without flinching.
--
-- Deleting is done by a function, prune_positions(), rather than only a
-- pg_cron entry, because pg_cron has to be attempted defensively:
--
--   * It IS a supported, first-party Supabase extension, enabled the same way
--     as any other — `create extension pg_cron` from the SQL editor, or the
--     toggle under Database → Extensions — so this file attempts exactly that
--     and then schedules the job itself. No project in this codebase has ever
--     turned it on, so this cannot assume it is already there.
--   * `scripts/schema-check.sh` applies every file in supabase/ against a bare
--     local `initdb` with no Supabase extensions installed at all, three times
--     over, and aborts the whole run on the first ERROR. Both attempts below
--     are therefore wrapped in `exception when others` so a database without
--     pg_cron — local, or a Supabase plan where it is not offered — comes out
--     of this file with prune_positions() defined and nothing scheduled,
--     instead of failing to apply schema_v22 at all.
--
-- If the pg_cron attempt below did not stick — check for a NOTICE from this
-- file, or `select * from cron.job` — schedule it another way. In order of
-- preference: Supabase Dashboard → Database → Cron Jobs (creates the same
-- `cron.schedule` call through the UI); or an external scheduler — a Vercel
-- Cron or a GitHub Actions workflow, on a daily timer — calling
-- `select prune_positions();` through the same Management API
-- `database/query` endpoint `scripts/smoke.mjs` already uses to clean up after
-- itself, authenticated with a Supabase PAT. Either way, the one thing that
-- must not happen is nobody scheduling it at all: the function existing does
-- nothing on its own.

-- -------------------------------------------------------------- the pruner

-- A supporting index: the existing (worker_id, at desc) index does not help a
-- table-wide "at < cutoff" scan, and this function does exactly one of those a
-- day.
create index if not exists positions_at_idx on positions (at);

create or replace function prune_positions() returns integer
language plpgsql as $$
declare
  v_deleted integer;
begin
  -- One unbatched delete. Safe because this only ever has to clear ~3 days'
  -- backlog after the first run — a busy day across 40 crew, pinging every 20
  -- seconds, is a few hundred thousand rows, not the tens of millions an
  -- unbounded table would eventually reach without this.
  delete from positions where at < now() - interval '3 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function prune_positions is
  'Deletes positions older than 3 days. Scheduled below via pg_cron when available; see the header of schema_v22.sql for the fallback if it is not.';

-- Nobody signed in through the app has a legitimate reason to call this: it
-- would let a field worker who wanted their trail gone before payroll checks
-- it just ask early. Only the service role (used by the scheduler below, and
-- by anything calling the Management API directly) and the table owner may
-- run it.
revoke all on function prune_positions() from public;
grant execute on function prune_positions() to service_role;

-- ------------------------------------------------------------- the schedule

-- Enabling the extension needs to be attempted from inside the migration —
-- there is no earlier file to have done it, and DEPLOY.md's instruction is to
-- run this list start to finish with nothing hand-done in between.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'schema_v22: pg_cron is not available here (%). prune_positions() is defined but nothing will call it — schedule it by hand, see the header comment in schema_v22.sql.', sqlerrm;
end $$;

-- 17:00 UTC is roughly 2:30am–3:30am in Adelaide depending on the time of
-- year (ACST is UTC+9:30, ACDT is UTC+10:30) — the quietest point of the
-- working day for a table that a live dashboard is also reading from.
-- `cron.schedule` upserts by job name on the pg_cron versions Supabase ships,
-- so re-running this file updates the existing job instead of stacking a
-- second one; still wrapped, because the schedule call itself is only
-- reachable when the extension above actually took.
do $$
begin
  perform cron.schedule('crewline_prune_positions', '0 17 * * *', 'select prune_positions();');
exception when others then
  raise notice 'schema_v22: could not schedule prune_positions via pg_cron (%). Schedule it another way — see the header comment in schema_v22.sql.', sqlerrm;
end $$;
