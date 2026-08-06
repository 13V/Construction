-- Crewline schema v3 — materials replaces equipment.
--
-- Equipment tracking told you where a machine was. Materials tell you what a job
-- actually cost, which is the question the owner is really asking. Run after
-- schema_v2.sql. Safe to re-run.

-- A job you cannot compare against a number isn't costed, so sites carry a budget.
alter table job_sites add column if not exists budget numeric(14,2);

create table if not exists materials (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid not null references job_sites(id) on delete cascade,
  name         text not null,
  quantity     numeric(12,3) not null default 1,
  unit         text not null default 'ea',
  unit_cost    numeric(12,2) not null default 0,
  -- Stored rather than computed on read: every roll-up sums this, and rounding
  -- once at write time keeps the totals on screen matching the totals exported.
  total_cost   numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  supplier     text,
  cost_code    text,
  status       text not null default 'delivered'
                 check (status in ('ordered','delivered','used','returned')),
  ordered_on   date,
  delivered_on date,
  -- Set when the material line came from a receipt, so the ledger and the
  -- material list reconcile instead of double-counting.
  expense_id   uuid references expenses(id) on delete set null,
  note         text,
  created_by   uuid references workers(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists materials_site_idx on materials (site_id, delivered_on desc);
create index if not exists materials_company_idx on materials (company_id);

alter table materials enable row level security;

drop policy if exists materials_read on materials;
create policy materials_read on materials
  for select using (company_id = current_company_id());

drop policy if exists materials_office_write on materials;
create policy materials_office_write on materials
  for all using (company_id = current_company_id() and current_is_office())
  with check (company_id = current_company_id() and current_is_office());

-- Crew log what turns up on site; only the office can change costs afterwards.
drop policy if exists materials_field_insert on materials;
create policy materials_field_insert on materials
  for insert with check (
    company_id = current_company_id() and created_by = current_worker_id());

do $$
begin
  alter publication supabase_realtime add table materials;
exception when duplicate_object then null;
end $$;

-- The daily log already has a free-text `materials` section; a separate
-- equipment note has nothing left to describe.
alter table daily_logs drop column if exists equipment_note;

drop table if exists equipment cascade;
