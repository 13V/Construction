-- Crewline schema v39 — delete_worker_account() also purges the profile.
--
-- Run after schema_v27.sql. Safe to re-run.
--
-- worker_profiles (avatar photo + phone, schema_v27.sql) was added four
-- migrations after delete_worker_account() (schema_v23.sql) was first
-- written, and nobody came back to teach the deletion function about the new
-- table. worker_profiles_read has no `deleted_at` exclusion — it only checks
-- `company_id = current_company_id()` — so a deleted worker's face photo and
-- personal mobile number stayed fully visible to the rest of the company
-- forever, on a row the app's own Delete-account screen told the user had
-- been removed. Unlike a timesheet or a site photo, neither is evidence
-- anything downstream needs to keep resolving, so this reaches them the same
-- way the original function already reaches `positions`.
--
-- CREATE OR REPLACE keeps the function's identity (grants, the comment
-- api/delete-account.ts's own comment points at) — only the body changes.

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
  v_avatar  text;
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

  -- The profile photo and phone number (schema_v27.sql). Grab the storage
  -- key before clearing the row so the object itself can be removed too —
  -- leaving it in the site-files bucket after the row goes would just move
  -- the same leak somewhere the app no longer shows it was fixed.
  select avatar_path into v_avatar from worker_profiles where worker_id = p_worker_id;
  if v_avatar is not null then
    delete from storage.objects where bucket_id = 'site-files' and name = v_avatar;
  end if;
  update worker_profiles
     set avatar_path = null,
         phone       = null
   where worker_id = p_worker_id;

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
  'Called once, by api/delete-account.ts with the service role, after resolving the caller''s own worker id from their bearer token. Deactivates the worker, purges their location history and (schema_v39.sql) their worker_profiles photo/phone, and refuses if they are the company''s only owner. Never deletes the workers row itself — shifts and every other Fair Work record must keep resolving. auth.users is deleted separately, by the caller, only after this succeeds.';
