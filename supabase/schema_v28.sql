-- Crewline schema v28 — the scope of works, and notes for the team.
--
-- A tiling job is lost or won on the things nobody wrote down: which grout,
-- which silicone, which angle trim, what the mitres do at the return, what
-- grate goes in the floor waste. The client asked for that list to live on the
-- job, each line either confirmed, still required, or not applicable — which is
-- exactly what `selections` already models (name, detail, status, chosen,
-- chosen_at) and exactly what the builder portal already renders. So this
-- widens that table rather than inventing a parallel one, and the office's
-- scope list and the client's portal stay one set of facts.
--
-- Two additions to it:
--   scope_key  identifies a line from the standard list, so the app can show
--              the seven every job has without matching on display text.
--   sort       keeps the client's order, which is the order the trade works in.
--
-- And the status vocabulary grows a third word. 'pending' and 'chosen' are the
-- portal's own, kept as they are — the app reads them as Required and
-- Confirmed — while 'not_applicable' covers the line that simply does not
-- arise on this job. A job with no strip drain should say so once, not sit
-- red forever.

alter table selections add column if not exists scope_key text;
alter table selections add column if not exists sort integer not null default 0;

comment on column selections.scope_key is
  'Stable key for a line from the standard scope list (grout, silicone, mitres…). Null for a one-off selection someone added by hand.';

alter table selections drop constraint if exists selections_status_check;
alter table selections add constraint selections_status_check
  check (status = any (array['pending', 'chosen', 'not_applicable']));

create unique index if not exists selections_site_scope_key_idx
  on selections (site_id, scope_key) where scope_key is not null;

-- ------------------------------------------------------------------ notes

-- "Add any additional notes or information for the team" — so the team writes
-- them, not only the office. Anyone in the company may add one and remove
-- their own; the office can remove anybody's, the same shape every other
-- crew-authored record in this schema has.
create table if not exists site_notes (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  site_id    uuid not null references job_sites(id) on delete cascade,
  body       text not null,
  author_id  uuid references workers(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table site_notes is
  'Free notes against a job, written by whoever is on it. Shown on the Scope tab.';

create index if not exists site_notes_site_idx on site_notes (site_id, created_at desc);

alter table site_notes enable row level security;

drop policy if exists site_notes_read on site_notes;
create policy site_notes_read on site_notes
  for select using (company_id = current_company_id());

drop policy if exists site_notes_insert on site_notes;
create policy site_notes_insert on site_notes
  for insert with check (
    company_id = current_company_id()
    and (author_id is null or author_id = current_worker_id())
  );

drop policy if exists site_notes_delete on site_notes;
create policy site_notes_delete on site_notes
  for delete using (
    company_id = current_company_id()
    and (author_id = current_worker_id() or current_is_office())
  );

drop policy if exists site_notes_update on site_notes;
create policy site_notes_update on site_notes
  for update
  using (company_id = current_company_id() and (author_id = current_worker_id() or current_is_office()))
  with check (company_id = current_company_id());
