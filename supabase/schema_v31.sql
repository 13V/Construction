-- Crewline schema v31 — safety documents as a shelf, and a SWMS you can issue.
--
-- The client drew the Safety tab as four shelves — Toolbox, Safe work method
-- statement, SDS, Company policy — each carrying documents, each with a state
-- of its own: current, expiring, overdue, not required for this job. What the
-- table held was closer to a notice board: a title, a body typed into the app,
-- and a signature against it. Three things were missing.
--
--   the file        "SDS - just requires to upload PDF". A safety data sheet
--                   is a PDF from the manufacturer. There was nowhere to put
--                   one, so the shelf could not hold what goes on it.
--   the expiry      A SWMS reviewed eleven months ago is not the same document
--                   as one reviewed last week, and the drawing counts them
--                   separately. Without a date, every state is "current".
--   who and when    "Updated 12 May 2024 - You" is on every row of the drawing
--                   and is the first thing anyone checks.

-- ------------------------------------------------------------------ the file

alter table safety_documents add column if not exists storage_path text;
alter table safety_documents add column if not exists file_name text;
alter table safety_documents add column if not exists mime text;
alter table safety_documents add column if not exists size_bytes bigint;

comment on column safety_documents.storage_path is
  'The PDF or image in the site-files bucket. Null for a document typed into the app rather than uploaded.';

-- ---------------------------------------------------------------- the states

-- Null means it does not expire, which is the honest default: a company policy
-- is current until it is replaced. The drawing's "Not required" is a state of
-- the SHELF, not of a document — it is what an empty shelf reads as when the
-- job does not need one — so it is computed, not stored.
alter table safety_documents add column if not exists expires_on date;
alter table safety_documents add column if not exists updated_at timestamptz not null default now();
alter table safety_documents add column if not exists updated_by uuid references workers(id) on delete set null;

comment on column safety_documents.expires_on is
  'Review or expiry date. Inside 30 days reads Expiring; past it, Overdue. Null never expires.';

-- Set on every write rather than trusted from the client, so "updated" cannot
-- be back-dated by whoever is holding the phone.
create or replace function safety_documents_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists safety_documents_touched on safety_documents;
create trigger safety_documents_touched before update on safety_documents
  for each row execute function safety_documents_touch();

-- ------------------------------------------------------------------ the kind

-- 'sds' joins the three that were there. The shelves the client drew map onto
-- them exactly: Toolbox is 'induction' (site inductions and toolbox talks),
-- and the other three name themselves.
alter table safety_documents drop constraint if exists safety_documents_kind_check;
alter table safety_documents add constraint safety_documents_kind_check
  check (kind in ('swms', 'induction', 'policy', 'sds'));

-- ------------------------------------------------------------------ the SWMS

-- "Each SWMS will require the project, the builder, the date. The rest stays
-- the same."
--
-- So the part that stays the same is a template — one company-level row, body
-- and all — and issuing a SWMS for a job copies it with those three facts
-- filled in. Keeping the body as data rather than in code means the next
-- revision is an edit, not a release.
alter table safety_documents add column if not exists is_template boolean not null default false;
alter table safety_documents add column if not exists template_id uuid
  references safety_documents(id) on delete set null;
/** The builder this copy is addressed to. Defaults to the job's, and is stored
 *  because the document is a record of what was issued, not a live view. */
alter table safety_documents add column if not exists builder_name text;
/** The date ON the document, which is not the date the row was made. */
alter table safety_documents add column if not exists document_date date;
/** PTS-SWMS-260818-001. Allocated on issue, like a certificate number. */
alter table safety_documents add column if not exists reference text;
alter table safety_documents add column if not exists issued_at timestamptz;
alter table safety_documents add column if not exists sent_at timestamptz;
alter table safety_documents add column if not exists sent_to text;

comment on column safety_documents.is_template is
  'A company-level master whose body is copied when a document is issued for a job. Templates are never listed on a job.';

create index if not exists safety_documents_template_idx
  on safety_documents (company_id, kind) where is_template;

-- A template belongs to the company, not to a job — the two would contradict
-- each other, and a template that had quietly attached itself to one job would
-- stop appearing for the rest.
alter table safety_documents drop constraint if exists safety_documents_template_no_site;
alter table safety_documents add constraint safety_documents_template_no_site
  check (not is_template or site_id is null);

-- Same reasoning as the waterproofing certificate: once a reference is on a
-- document somebody has filed, it is the thing they refer to it by.
create or replace function safety_documents_guard_reference() returns trigger
language plpgsql as $$
begin
  if old.reference is not null and new.reference is distinct from old.reference then
    raise exception 'reference is write-once (% already issued)', old.reference;
  end if;
  return new;
end $$;

drop trigger if exists safety_documents_reference_guard on safety_documents;
create trigger safety_documents_reference_guard before update on safety_documents
  for each row execute function safety_documents_guard_reference();

-- ---------------------------------------------------------------- the shelves

-- What the four rows on the drawing count. A shelf's state is its worst
-- document's, and an empty shelf is "not required for this job" rather than a
-- problem — which is the only reading that does not turn every new job red.
create or replace view safety_shelf_v as
select
  d.company_id,
  d.site_id,
  d.kind,
  count(*)                                                              as documents,
  count(*) filter (where d.expires_on is not null
                     and d.expires_on < current_date)                    as overdue,
  count(*) filter (where d.expires_on is not null
                     and d.expires_on >= current_date
                     and d.expires_on < current_date + 30)               as expiring,
  count(*) filter (where d.expires_on is null
                     or d.expires_on >= current_date + 30)               as current,
  max(d.updated_at)                                                      as updated_at
from safety_documents d
where d.active and not d.is_template
group by d.company_id, d.site_id, d.kind;

comment on view safety_shelf_v is
  'One row per job per safety shelf: how many documents it holds and how many are current, expiring or overdue.';
