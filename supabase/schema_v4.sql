-- Crewline schema v4 — the commercial side: estimates, purchase orders,
-- progress claims, change orders, and the client / subcontractor portals.
--
-- Derived from the screens in design/screens/, so the columns match what the
-- design actually puts on the page. Run after schema_v3.sql. Safe to re-run.

-- Job sites gain what the client portal shows about progress.
alter table job_sites add column if not exists client_name   text;
alter table job_sites add column if not exists progress_pct  integer
  check (progress_pct is null or (progress_pct between 0 and 100));
alter table job_sites add column if not exists schedule_note text;

-- --------------------------------------------------------------- estimates

create table if not exists estimates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid references job_sites(id) on delete set null,
  -- An estimate exists before the job does, so the client is named here too.
  client_name text not null default '',
  title       text not null,
  revision    integer not null default 1,
  -- Revisions chain to the original rather than overwriting it; a superseded
  -- price is evidence in a dispute.
  parent_id   uuid references estimates(id) on delete set null,
  status      text not null default 'draft'
                check (status in ('draft','awaiting_approval','approved','rejected','superseded')),
  note        text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists estimates_company_idx on estimates (company_id, created_at desc);

create table if not exists estimate_lines (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  cost_code   text,
  name        text not null,
  qty         numeric(12,3) not null default 1,
  unit        text not null default 'ea',
  unit_price  numeric(12,2) not null default 0,
  markup_pct  numeric(6,2) not null default 0,
  line_total  numeric(14,2) generated always as
                (round(qty * unit_price * (1 + markup_pct / 100), 2)) stored,
  sort        integer not null default 0
);
create index if not exists estimate_lines_estimate_idx on estimate_lines (estimate_id, sort);

-- --------------------------------------------------------- purchase orders

create table if not exists purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid references job_sites(id) on delete set null,
  po_no       text not null,
  vendor      text not null default '',
  issued_on   date not null default current_date,
  expected_on date,
  status      text not null default 'draft'
                check (status in ('draft','sent','partially_received','received','cancelled')),
  note        text,
  created_at  timestamptz not null default now(),
  unique (company_id, po_no)
);
create index if not exists purchase_orders_company_idx on purchase_orders (company_id, issued_on desc);

create table if not exists po_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references purchase_orders(id) on delete cascade,
  name         text not null,
  ordered_qty  numeric(12,3) not null default 1,
  received_qty numeric(12,3) not null default 0,
  unit         text not null default 'ea',
  unit_cost    numeric(12,2) not null default 0,
  line_total   numeric(14,2) generated always as (round(ordered_qty * unit_cost, 2)) stored,
  cost_code    text,
  sort         integer not null default 0
);
create index if not exists po_lines_po_idx on po_lines (po_id, sort);

-- ------------------------------------------ invoices and progress claims

create table if not exists invoices (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid references job_sites(id) on delete set null,
  invoice_no  text not null,
  client_name text not null default '',
  -- e.g. "Progress claim 3 — Aug", shown to the client verbatim.
  period      text,
  issued_on   date not null default current_date,
  due_on      date,
  amount      numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  status      text not null default 'draft'
                check (status in ('draft','sent','paid','void')),
  note        text,
  created_at  timestamptz not null default now(),
  unique (company_id, invoice_no)
);
create index if not exists invoices_company_idx on invoices (company_id, issued_on desc);

-- Overdue is derived, never stored — a stored flag goes stale overnight.
--
-- `drop` then `create`, never `create or replace`. Every file here claims to be
-- safe to re-run and DEPLOY.md says to run all of them in order — but CREATE OR
-- REPLACE VIEW can only APPEND columns, and later migrations add columns to
-- `invoices` that land before `overdue`. Re-running this file on an up-to-date
-- database aborted with `42P16: cannot change name of view column "overdue"`,
-- and every migration after this one silently never ran, including the geofence
-- clock-out fix and the read lockdown.
-- `cascade`, on every view drop in this repo. A later migration builds views on
-- top of this one (job_profit_v and company_overview_v read job_value_v and
-- invoice_status_v), and Postgres refuses to drop a view something depends on.
-- Without cascade, re-running this file on an up-to-date database aborts — and
-- DEPLOY.md's instruction is to run the whole list in order, so an abort here
-- means every migration after it silently never runs. That exact failure has
-- now happened twice. The dependants are recreated by the later file, which
-- always runs after this one; the run is only ever safe as a complete run,
-- which is what the runbook has said all along.
drop view if exists invoice_status_v cascade;
create view invoice_status_v as
  select i.*,
         (i.status = 'sent' and i.due_on is not null and i.due_on < current_date) as overdue,
         greatest(0, i.amount - i.paid_amount) as outstanding
    from invoices i;

create table if not exists invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id) on delete cascade,
  cost_code    text,
  description  text not null,
  pct_complete numeric(5,2),
  amount       numeric(14,2) not null default 0,
  sort         integer not null default 0
);
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id, sort);

-- ----------------------------------------------------------- change orders

create table if not exists change_orders (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid references job_sites(id) on delete set null,
  co_no        text not null,
  description  text not null,
  detail       text,
  cost_impact  numeric(14,2) not null default 0,
  days_impact  integer not null default 0,
  status       text not null default 'pending_client'
                 check (status in ('draft','pending_client','approved','rejected')),
  raised_on    date not null default current_date,
  -- {name, signed_at} once the client accepts; the record of authority to bill.
  signature    jsonb,
  created_at   timestamptz not null default now(),
  unique (company_id, co_no)
);
create index if not exists change_orders_company_idx on change_orders (company_id, raised_on desc);

create table if not exists change_order_lines (
  id              uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references change_orders(id) on delete cascade,
  cost_code       text,
  name            text not null,
  detail          text,
  amount          numeric(14,2) not null default 0,
  sort            integer not null default 0
);
create index if not exists co_lines_idx on change_order_lines (change_order_id, sort);

-- ------------------------------------------------- milestones & selections

create table if not exists milestones (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  site_id    uuid not null references job_sites(id) on delete cascade,
  name       text not null,
  due_on     date,
  done_on    date,
  sort       integer not null default 0
);
create index if not exists milestones_site_idx on milestones (site_id, sort);

-- Client choices that block work — the portal's "needs you" list.
create table if not exists selections (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid not null references job_sites(id) on delete cascade,
  name        text not null,
  detail      text,
  needed_by   date,
  status      text not null default 'pending' check (status in ('pending','chosen')),
  chosen      text,
  chosen_at   timestamptz
);
create index if not exists selections_site_idx on selections (site_id);

-- ----------------------------------------------------------------- portals

-- Clients and subcontractors get read-mostly access to one job. They are not
-- workers: no location, no timesheet, no crew list.
create table if not exists portal_contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid references job_sites(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  kind         text not null check (kind in ('client','sub')),
  name         text not null,
  -- Trade or company name for a sub; blank for a client.
  org          text,
  invite_email text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists portal_contacts_invite_idx
  on portal_contacts (lower(invite_email)) where invite_email is not null;
create index if not exists portal_contacts_company_idx on portal_contacts (company_id);

/** The portal caller's row, or null for staff. */
create or replace function current_portal()
returns portal_contacts
language sql stable security definer set search_path = public as $$
  select * from portal_contacts where auth_user_id = auth.uid() and active limit 1;
$$;

create or replace function current_portal_site()
returns uuid
language sql stable security definer set search_path = public as $$
  select site_id from portal_contacts where auth_user_id = auth.uid() and active limit 1;
$$;

-- ------------------------------------------------------------------- RLS

alter table estimates          enable row level security;
alter table estimate_lines     enable row level security;
alter table purchase_orders    enable row level security;
alter table po_lines           enable row level security;
alter table invoices           enable row level security;
alter table invoice_lines      enable row level security;
alter table change_orders      enable row level security;
alter table change_order_lines enable row level security;
alter table milestones         enable row level security;
alter table selections         enable row level security;
alter table portal_contacts    enable row level security;

-- Staff: read within the company, office writes.
do $$
declare t text;
begin
  foreach t in array array['estimates','purchase_orders','invoices','change_orders',
                           'milestones','selections','portal_contacts']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (company_id = current_company_id())', t, t);
    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format('create policy %I_office_write on %I for all
      using (company_id = current_company_id() and current_is_office())
      with check (company_id = current_company_id() and current_is_office())', t, t);
  end loop;
end $$;

-- Line tables inherit access from their parent document.
do $$
declare r record;
begin
  for r in select * from (values
      ('estimate_lines','estimates','estimate_id'),
      ('po_lines','purchase_orders','po_id'),
      ('invoice_lines','invoices','invoice_id'),
      ('change_order_lines','change_orders','change_order_id')
    ) as t(child, parent, fk)
  loop
    execute format('drop policy if exists %I_read on %I', r.child, r.child);
    execute format('create policy %I_read on %I for select using (%I in (select id from %I))',
                   r.child, r.child, r.fk, r.parent);
    execute format('drop policy if exists %I_office_write on %I', r.child, r.child);
    execute format('create policy %I_office_write on %I for all
      using (current_is_office() and %I in (select id from %I))
      with check (current_is_office() and %I in (select id from %I))',
      r.child, r.child, r.fk, r.parent, r.fk, r.parent);
  end loop;
end $$;

-- Portal visitors see one job, and only the parts meant for them. Financial
-- internals — labour cost, materials, other clients' work — never appear.
drop policy if exists job_sites_portal_read on job_sites;
create policy job_sites_portal_read on job_sites
  for select using (id = current_portal_site());

drop policy if exists milestones_portal_read on milestones;
create policy milestones_portal_read on milestones
  for select using (site_id = current_portal_site());

drop policy if exists selections_portal_read on selections;
create policy selections_portal_read on selections
  for select using (site_id = current_portal_site());

-- A client answering a selection is the whole point of showing it to them.
drop policy if exists selections_portal_update on selections;
create policy selections_portal_update on selections
  for update using (site_id = current_portal_site())
  with check (site_id = current_portal_site());

drop policy if exists invoices_portal_read on invoices;
create policy invoices_portal_read on invoices
  for select using (
    site_id = current_portal_site()
    and (select kind from portal_contacts where auth_user_id = auth.uid()) = 'client'
    and status <> 'draft');

drop policy if exists change_orders_portal_read on change_orders;
create policy change_orders_portal_read on change_orders
  for select using (site_id = current_portal_site() and status <> 'draft');

-- Photos yes, receipts and internal documents no.
drop policy if exists site_files_portal_read on site_files;
create policy site_files_portal_read on site_files
  for select using (site_id = current_portal_site() and kind = 'photo');

drop policy if exists daily_logs_portal_read on daily_logs;
create policy daily_logs_portal_read on daily_logs
  for select using (site_id = current_portal_site() and status = 'confirmed');

do $$
declare t text;
begin
  foreach t in array array['estimates','purchase_orders','invoices','change_orders',
                           'milestones','selections']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
