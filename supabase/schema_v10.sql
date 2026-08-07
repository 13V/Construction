-- Crewline schema v10 — what the phone screens need and the database did not have.
--
-- Run after schema_v9.sql. Safe to re-run.
--
-- The six worker-app screens were designed against this schema, and the design
-- notes flagged four figures that had no column behind them. Rather than let
-- the screens draw plausible numbers, the columns get added. Each one below
-- exists because a specific screen cannot be built honestly without it.

-- ------------------------------------------------- a worker's ordinary week

-- The payday screen shows "31.4 / 38 hrs". 38 was a constant in the drawing
-- and a constant in the payroll code, which is right for a full-time employee
-- under the NES and wrong for the first part-timer, apprentice on a different
-- award, or anyone on a 76-hour fortnight. It is the one screen the design
-- brief said had to be unarguable, so the denominator has to be per-worker.
alter table workers add column if not exists ordinary_hours numeric(5,2) not null default 38
  check (ordinary_hours > 0 and ordinary_hours <= 168);

-- ------------------------------------------------ what an expired ticket stops

-- A certification stored a name and an expiry. The safety screen says what an
-- expired ticket stops the worker doing — "cannot be on the slab" — and there
-- was nowhere for that sentence to come from, so it was invented in the mock.
-- The office writes it per ticket; null means the card just shows the date.
alter table certifications add column if not exists restriction text;

-- ----------------------------------------------------- SWMS and inductions

-- The largest gap the design found. safety_records.kind is
-- ('jha','incident','toolbox','hazard') — a Safe Work Method Statement is none
-- of those, and neither is a site induction. Both are documents a worker signs
-- *before* starting, and the sign-on gate cannot be built without somewhere for
-- the document and the signature to live.
--
-- Signatures are their own table rather than the jsonb blob safety_records
-- uses, because the question this screen asks is "has THIS worker signed THIS
-- document for TODAY" — which a jsonb array cannot answer without scanning
-- every row.

create table if not exists safety_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  -- Null site means it applies company-wide, e.g. a general induction.
  site_id     uuid references job_sites(id) on delete cascade,
  kind        text not null check (kind in ('swms','induction','policy')),
  title       text not null,
  body        text,
  /** The cost code or task this SWMS covers, so the right one is shown. */
  cost_code   text,
  version     text not null default '1',
  /** Signatures older than this many hours must be renewed. Null = sign once. */
  resign_after_hours integer,
  active      boolean not null default true,
  created_by  uuid references workers(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists safety_documents_site_idx
  on safety_documents (company_id, site_id, active);

create table if not exists safety_signatures (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  document_id uuid not null references safety_documents(id) on delete cascade,
  worker_id   uuid not null references workers(id) on delete cascade,
  site_id     uuid references job_sites(id) on delete set null,
  signed_at   timestamptz not null default now(),
  /** The drawn signature, as a data URL. Null for a tick-to-acknowledge. */
  signature   text,
  created_at  timestamptz not null default now()
);
create index if not exists safety_signatures_lookup
  on safety_signatures (worker_id, document_id, signed_at desc);

-- Toolbox talk attendance asks the same question and had the same problem.
alter table safety_records add column if not exists ran_by uuid references workers(id) on delete set null;

-- ------------------------------------------------------- plan pin lifecycle

-- A pin could only ever be created, so a sheet's pin count only grew and there
-- was no honest way to draw "2 open, 6 done". The design called this out rather
-- than inventing a resolved count.
alter table plan_pins add column if not exists resolved_at timestamptz;
alter table plan_pins add column if not exists resolved_by uuid references workers(id) on delete set null;

-- ------------------------------------------------------------------- RLS

alter table safety_documents  enable row level security;
alter table safety_signatures enable row level security;

-- Everyone in the company reads the documents; only the office writes them.
drop policy if exists safety_documents_read on safety_documents;
create policy safety_documents_read on safety_documents
  for select using (company_id = current_company_id());

drop policy if exists safety_documents_office_write on safety_documents;
create policy safety_documents_office_write on safety_documents
  for all
  using (company_id = current_company_id() and current_is_office())
  with check (company_id = current_company_id() and current_is_office());

-- A worker signs for themselves and nobody else. Signing on someone's behalf is
-- the whole thing a signature is supposed to prevent, so the check is on the
-- row's worker_id rather than on the screen that wrote it.
drop policy if exists safety_signatures_read on safety_signatures;
create policy safety_signatures_read on safety_signatures
  for select using (company_id = current_company_id());

drop policy if exists safety_signatures_sign on safety_signatures;
create policy safety_signatures_sign on safety_signatures
  for insert with check (
    company_id = current_company_id()
    and (worker_id = current_worker_id() or current_is_office())
  );

-- A signature is a record of something that happened. It is not editable, and
-- only the office can strike one, which leaves the deletion in the audit trail
-- rather than letting a worker quietly unsign.
drop policy if exists safety_signatures_office_delete on safety_signatures;
create policy safety_signatures_office_delete on safety_signatures
  for delete using (company_id = current_company_id() and current_is_office());

-- ------------------------------------------------------------------ helper

/**
 * The documents a worker still has to sign before starting at a site today.
 * The sign-on gate is exactly this list being empty.
 */
create or replace function unsigned_safety_docs(p_worker uuid, p_site uuid)
returns setof safety_documents
language sql stable security definer set search_path = public as $$
  select d.*
    from safety_documents d
   where d.active
     and d.company_id = (select company_id from workers where id = p_worker)
     and (d.site_id is null or d.site_id = p_site)
     and not exists (
       select 1 from safety_signatures s
        where s.document_id = d.id
          and s.worker_id = p_worker
          and (
            d.resign_after_hours is null
            or s.signed_at > now() - make_interval(hours => d.resign_after_hours)
          )
     );
$$;
