-- Crewline schema v23 — account deletion (App Store Guideline 5.1.1(v)).
--
-- Run after schema_v21.sql. Safe to re-run.
--
-- Apple rejects an app that lets someone create an account but gives them no
-- way to delete it from inside the app. Crewline had no deletion path at all,
-- which makes this a hard blocker, not a nice-to-have.
--
-- The naive fix — `delete from workers where id = ...` — is wrong on this
-- schema specifically, because a worker row is not just a login: it is the
-- foreign key every shift hangs off, and `shifts` is the employer's wage
-- record. Under the Fair Work Act an employer must keep time and pay records
-- for SEVEN YEARS after they are made, for every employee, whether or not
-- that employee still works there or still wants an account. A hard delete
-- would either cascade (schema.sql: `shifts.worker_id references workers(id)
-- on delete cascade`) and destroy the record, or fail on the foreign key and
-- leave the request looking broken. Both are wrong answers to "delete my
-- account".
--
-- The honest split, applied below:
--
--   * The LOGIN goes. auth.users is deleted via the Supabase admin API (done
--     in api/delete-account.ts, which is the only thing allowed to touch
--     auth.users); `workers.auth_user_id references auth.users(id) on delete
--     set null` — already in schema.sql — severs the link automatically the
--     moment that happens. Nobody can sign in as this person again.
--
--   * The WORKER ROW stays. It is marked `deleted_at` and `active = false` —
--     the same flag Crew already uses for "no longer with us" — so shifts,
--     approvals, invoices and every other record that references workers(id)
--     keeps resolving exactly as it did the day it was written. The name on
--     a seven-year-old timesheet does not change, because Fair Work records
--     are required to identify who was paid; anonymising it would make the
--     employer's own record wrong to satisfy a request the law already
--     carves an exception for (a retention obligation the business does not
--     get to waive on the worker's behalf).
--
--   * POSITIONS go. A position row is a raw GPS ping — personal location
--     data with no independent evidentiary value once the shift it produced
--     already exists in `shifts`. Keeping ten thousand lat/lng pairs after
--     someone has asked to be forgotten, for the sake of a record that is
--     genuinely satisfied by `shifts.started_at`/`ended_at`, is exactly the
--     kind of data a deletion request is supposed to reach. `dwell_state`
--     goes with it — it is live tracking machine state, not a record of
--     anything that happened.
--
--   * SITE_FILES stay, untouched. A defect photo, a waterproofing flood-test
--     record or a daily-log entry is evidence about the JOB, not personal
--     data about the person who uploaded it — `uploaded_by` already points
--     at `workers(id) on delete set null` (schema_v2), so it keeps resolving
--     to the worker's (now inactive) row rather than needing a change here.
--
-- The OWNER case is different in kind, not degree: an owner IS the company's
-- office access. Deleting the only owner's account would not free that
-- person from the business, it would lock everyone else out of pay rates,
-- invoices and contracts with no one able to get back in. delete_worker_
-- account() below refuses that specific case — sole owner — and explains why,
-- rather than silently orphaning the company or silently doing nothing.

-- --------------------------------------------------------------- the column

alter table workers add column if not exists deleted_at timestamptz;

comment on column workers.deleted_at is
  'Set once, by delete_worker_account() only, when this person deletes their own account. The row is kept — shifts, approvals and every other FK still resolve — only the login is gone. NULL means never deleted.';

-- Only delete_worker_account() may set this, and it always runs with no
-- auth.uid() (the service role — see the note on shifts_worker_guard in
-- schema_v6 for why that is the tell). Without this guard, workers_office_
-- write (schema.sql: office may update ANY column on ANY worker in their
-- company) would let an office user flip deleted_at on a coworker directly —
-- soft-deleting them without purging their positions, without touching
-- auth.users, and without the sole-owner check. That is not a smaller version
-- of account deletion, it is a different and broken operation that happens to
-- share a column name.
create or replace function workers_deleted_at_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at and auth.uid() is not null then
    raise exception 'deleted_at is set only by account deletion (delete_worker_account), never by an edit';
  end if;
  return new;
end $$;

drop trigger if exists workers_deleted_at_guard_t on workers;
create trigger workers_deleted_at_guard_t
  before update on workers
  for each row execute function workers_deleted_at_guard();

-- --------------------------------------------------------------- the action

-- Everything account deletion does to OUR tables, as one statement-level unit
-- so a half-applied deletion can never happen: either the worker ends up
-- inactive with their positions purged, or nothing here changes at all and
-- the caller (api/delete-account.ts) never proceeds to delete the login.
--
-- SECURITY DEFINER and locked to service_role below — this function accepts
-- an arbitrary worker id and deactivates that worker's account, which is not
-- something any logged-in worker should be able to do to anyone but
-- themselves. The serverless endpoint is the only caller, and it only ever
-- passes the id it just resolved from the caller's own bearer token.
create or replace function delete_worker_account(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text;
  v_company uuid;
  v_others  int;
begin
  select role, company_id into v_role, v_company
    from workers where id = p_worker_id for update;

  if not found then
    raise exception 'worker_not_found';
  end if;

  if v_role = 'owner' then
    -- Lock every owner row in the company before counting, not just this
    -- one. Without this, two owners deleting their accounts in the same
    -- second could each see "one other owner exists", both pass, and the
    -- company ends up with none — the exact outcome this function exists to
    -- refuse.
    perform id from workers
      where company_id = v_company and role = 'owner' and deleted_at is null
      for update;

    select count(*) into v_others
      from workers
     where company_id = v_company and role = 'owner'
       and id <> p_worker_id and deleted_at is null;

    if v_others = 0 then
      raise exception 'sole_owner';
    end if;
  end if;

  -- Raw location pings. Personal, superseded by the shifts they produced,
  -- and the reason this is a DELETE rather than a flag: nothing downstream
  -- reads a deleted worker's position history for anything.
  delete from positions where worker_id = p_worker_id;
  delete from dwell_state where worker_id = p_worker_id;

  -- coalesce() on deleted_at makes a retried call (the login-delete step in
  -- api/delete-account.ts failing after this one succeeded, then the whole
  -- request being retried) leave the original deletion time in place rather
  -- than sliding it forward on every attempt.
  update workers
     set active     = false,
         deleted_at = coalesce(deleted_at, now()),
         -- An owner stops being one immediately — the moment they can no
         -- longer sign in they must also stop being counted as the company's
         -- office access by current_is_office() (schema.sql) and by the next
         -- worker who checks "am I the only owner left".
         role       = case when role = 'owner' then 'employee' else role end
   where id = p_worker_id;
end;
$$;

revoke all on function delete_worker_account(uuid) from public;
revoke all on function delete_worker_account(uuid) from anon;
revoke all on function delete_worker_account(uuid) from authenticated;
grant execute on function delete_worker_account(uuid) to service_role;

comment on function delete_worker_account is
  'Called once, by api/delete-account.ts with the service role, after resolving the caller''s own worker id from their bearer token. Deactivates the worker, purges their location history, and refuses if they are the company''s only owner. Never deletes the workers row itself — shifts and every other Fair Work record must keep resolving. auth.users is deleted separately, by the caller, only after this succeeds.';
