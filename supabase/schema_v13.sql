-- Crewline schema v13 — two buttons on the phone that did nothing.
--
-- Run after schema_v12.sql. Safe to re-run.
--
-- "Flag as an issue" in the photo viewer and "Mark this done" on a plan pin
-- both issue an UPDATE from a field worker. Neither site_files nor plan_pins
-- had an UPDATE policy for anyone but the office — only INSERT — so the
-- statement matched zero rows.
--
-- PostgREST answers a zero-row UPDATE with success. The result was discarded,
-- the screen called its reload, the row came back unchanged, and the worker
-- watched their flag quietly not happen. A refused write that looks like a
-- successful one is worse than an error, because nobody goes looking.
--
-- RLS has no column granularity, so the narrowing is a guard trigger, the same
-- pattern schema_v6 uses for shifts.

-- --------------------------------------------------------- flagging a photo

drop policy if exists site_files_field_update on site_files;
create policy site_files_field_update on site_files
  for update using (company_id = current_company_id())
  with check (company_id = current_company_id());

create or replace function site_files_worker_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_is_office() then
    return new;
  end if;
  -- A worker can say what a photo IS. They cannot move it to another job,
  -- rewrite where it was taken, or change who took it — those are the parts
  -- that make a photo evidence.
  if new.site_id     is distinct from old.site_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.storage_path is distinct from old.storage_path
     or new.lat      is distinct from old.lat
     or new.lng      is distinct from old.lng
     or new.taken_at is distinct from old.taken_at
     or new.kind     is distinct from old.kind
     or new.version  is distinct from old.version
     or new.supersedes is distinct from old.supersedes then
    raise exception 'A worker can set the category and caption on a photo, nothing else';
  end if;
  return new;
end $$;

drop trigger if exists site_files_worker_guard_t on site_files;
create trigger site_files_worker_guard_t
  before update on site_files
  for each row execute function site_files_worker_guard();

-- ------------------------------------------------------- resolving a pin

drop policy if exists plan_pins_field_update on plan_pins;
create policy plan_pins_field_update on plan_pins
  for update using (company_id = current_company_id())
  with check (company_id = current_company_id());

create or replace function plan_pins_worker_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_is_office() then
    return new;
  end if;
  -- Marking a pin done is the whole point of the lifecycle schema_v10 added.
  -- Moving one is not: the coordinate is what the flashing sub navigates to.
  if new.x        is distinct from old.x
     or new.y     is distinct from old.y
     or new.file_id is distinct from old.file_id
     or new.site_id is distinct from old.site_id
     or new.kind  is distinct from old.kind
     or new.label is distinct from old.label
     or new.created_by is distinct from old.created_by then
    raise exception 'A worker can resolve a pin, not move or reword one';
  end if;
  return new;
end $$;

drop trigger if exists plan_pins_worker_guard_t on plan_pins;
create trigger plan_pins_worker_guard_t
  before update on plan_pins
  for each row execute function plan_pins_worker_guard();
