-- Crewline schema v27 — a profile that holds the papers.
--
-- Three changes, all of them the same idea: the things a person is asked for
-- on a job site are facts about that person, and they should be able to carry
-- them in the app.
--
-- 1. worker_avatars becomes worker_profiles. The table was one column wide
--    when a face was all it held; a phone number belongs in exactly the same
--    place, for exactly the same reason it could not go on `workers` (that
--    table is office-write, and row security grants rows rather than columns,
--    so self-write there would also hand over `is_office` and every wage).
--
-- 2. certifications gains document_path — a photo of the actual card. A ticket
--    nobody can produce is not much use at a site induction.
--
-- 3. certifications becomes self-writable for your own row. Until now only the
--    office could enter one, which left a crew member holding a licence and no
--    way to record it. The office keeps full write over everybody, so nothing
--    it could do before is lost.
--
-- Worth stating plainly, because it is a real trade: a self-entered ticket is
-- an assertion, not a verified record, and the Crew tab's green pill cannot
-- tell the two apart. The office can still correct or remove anything.

alter table if exists worker_avatars rename to worker_profiles;
alter table if exists worker_profiles rename column storage_path to avatar_path;
alter table worker_profiles alter column avatar_path drop not null;
alter table worker_profiles add column if not exists phone text;

comment on table worker_profiles is
  'Per-person details a worker may maintain themselves — profile photo, phone. Separate from workers so self-write cannot reach role or pay.';

alter index if exists worker_avatars_pkey rename to worker_profiles_pkey;

drop policy if exists worker_avatars_read on worker_profiles;
drop policy if exists worker_avatars_write on worker_profiles;
drop policy if exists worker_profiles_read on worker_profiles;
create policy worker_profiles_read on worker_profiles
  for select using (company_id = current_company_id());

drop policy if exists worker_profiles_write on worker_profiles;
create policy worker_profiles_write on worker_profiles
  for all
  using (
    company_id = current_company_id()
    and (worker_id = current_worker_id() or current_is_office())
  )
  with check (
    company_id = current_company_id()
    and (worker_id = current_worker_id() or current_is_office())
  );

-- ---------------------------------------------------------------- tickets

alter table certifications add column if not exists document_path text;

comment on column certifications.document_path is
  'Photo of the card itself, in the site-files bucket. Null when only the dates are on file.';

-- Your own tickets, alongside the office's existing write over everyone's.
drop policy if exists certifications_self_write on certifications;
create policy certifications_self_write on certifications
  for all
  using (company_id = current_company_id() and worker_id = current_worker_id())
  with check (company_id = current_company_id() and worker_id = current_worker_id());
