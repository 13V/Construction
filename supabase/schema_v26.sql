-- Crewline schema v26 — a face on the profile.
--
-- The Me screen has always drawn a camera badge on the avatar, and it did
-- nothing, because there was nowhere to put the photo. The obvious home is a
-- column on `workers` — and it is the wrong one. `workers` is office-write by
-- policy (workers_office_write), and RLS grants rows, not columns: any policy
-- letting a crew member update their own row to set an avatar would equally
-- let them set `is_office` and read every wage in the company.
--
-- So the photo lives in its own table, where "you may write your own row" is
-- a safe sentence to say. Read stays company-wide, the same as `workers`, so
-- a face can appear anywhere a name already does.

create table if not exists worker_avatars (
  worker_id    uuid primary key references workers(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  /** Object key in the site-files bucket, whose own RLS checks the company folder. */
  storage_path text not null,
  updated_at   timestamptz not null default now()
);

comment on table worker_avatars is
  'Profile photos. Separate from workers so a crew member can set their own without gaining write access to their role or pay.';

alter table worker_avatars enable row level security;

drop policy if exists worker_avatars_read on worker_avatars;
create policy worker_avatars_read on worker_avatars
  for select using (company_id = current_company_id());

-- Your own face, or anyone's if you are the office.
drop policy if exists worker_avatars_write on worker_avatars;
create policy worker_avatars_write on worker_avatars
  for all
  using (
    company_id = current_company_id()
    and (worker_id = current_worker_id() or current_is_office())
  )
  with check (
    company_id = current_company_id()
    and (worker_id = current_worker_id() or current_is_office())
  );
