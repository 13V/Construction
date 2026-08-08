-- Crewline schema v15 — the counterparty, and the paperwork a tax invoice needs.
--
-- Run after schema_v14.sql. Safe to re-run.
--
-- Everything here is ADDITIVE: new tables, and nullable columns on existing
-- ones. Nothing reads differently after this migration, so it can land on its
-- own without a coordinated app deploy. Switching the app over to read
-- builder_id instead of client_name is a separate, riskier step.
--
-- Why it is needed. Proven Tiling works FOR builders and sublets tiling work
-- to their own subbies, so they sit in the middle of two contractual chains:
--
--     builder  --contract + PO-->  Proven Tiling  --PO-->  their subbies
--     builder  <--tax invoice---   Proven Tiling  <--invoice--
--
-- The app had no record of the party at either end. The counterparty existed
-- only as unlinked free text in job_sites.client_name, estimates.client_name
-- and invoices.client_name — three strings that cannot be joined, so there was
-- no way to ask what any builder owes, which jobs are theirs, or what rates
-- were agreed. A tiling subcontractor's risk concentrates per builder, not per
-- house, which is exactly the question the schema could not answer.

-- ------------------------------------------------------- who we work for

create table if not exists builders (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  name         text not null,
  /** 11 digits, no spaces. Required on a tax invoice over $82.50 inc GST. */
  abn          text,
  accounts_email text,
  phone        text,
  address      text,
  /** Days from invoice date. Most residential builders here are 30 from EOM. */
  payment_terms_days integer not null default 30,
  /** Their standard retention, held from every claim until practical completion. */
  default_retention_pct numeric(5,2) not null default 0
                 check (default_retention_pct >= 0 and default_retention_pct <= 100),
  /** True when the BUILDER raises the invoice under an RCTI agreement. */
  rcti         boolean not null default false,
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists builders_company_idx on builders (company_id, name);

-- A builder is not one person. The site supervisor who answers about access is
-- rarely the contract admin who answers about a variation, and neither is
-- accounts. The crew screen asks for "site supervisors details" specifically.
create table if not exists builder_contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  builder_id  uuid not null references builders(id) on delete cascade,
  name        text not null,
  role        text not null default 'supervisor'
                check (role in ('supervisor','contract_admin','accounts','estimator','other')),
  mobile      text,
  email       text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists builder_contacts_builder_idx on builder_contacts (builder_id, role);

-- Nullable, and nothing reads them yet. Backfilling and switching the reads
-- over is a later migration, once the app has a builder picker.
alter table job_sites add column if not exists builder_id uuid references builders(id) on delete set null;
alter table job_sites add column if not exists builder_job_ref text;
alter table job_sites add column if not exists supervisor_contact_id uuid references builder_contacts(id) on delete set null;
alter table estimates add column if not exists builder_id uuid references builders(id) on delete set null;
alter table invoices  add column if not exists builder_id uuid references builders(id) on delete set null;

comment on column job_sites.builder_job_ref is
  'The builder''s own job or lot number. Their accounts team searches on this, not on ours, so it belongs on every invoice.';

-- ------------------------------------------------------------ our own details

-- A tax invoice has to carry the supplier's identity. There was nowhere to put
-- it: companies held a name and nothing else.
alter table companies add column if not exists abn text;
alter table companies add column if not exists acn text;
/** Builders licence — BLD 187384 for this client. Goes on the invoice. */
alter table companies add column if not exists licence_no text;
alter table companies add column if not exists address text;
alter table companies add column if not exists phone text;
alter table companies add column if not exists email text;
alter table companies add column if not exists bank_bsb text;
alter table companies add column if not exists bank_account text;
alter table companies add column if not exists bank_account_name text;
/** Almost every builder here is registered. Set false for a supplier who is not. */
alter table companies add column if not exists gst_registered boolean not null default true;

-- --------------------------------------------------------- GST on invoices

-- The invoices table had no tax column of any kind, so the app could not issue
-- a compliant Australian tax invoice at all.
--
-- `amount` KEEPS ITS MEANING — the sum the builder owes. Changing what an
-- existing column means would silently restate every historical invoice, every
-- aging bucket and every payment already recorded against it. So the tax is
-- decomposed alongside it rather than added on top:
--
--     amount     = what is owed, GST inclusive (unchanged)
--     tax_amount = the GST portion of that
--     ex_tax     = amount - tax_amount, generated
--
-- Existing rows get tax_amount = 0, which is the honest reading: they were
-- raised before the app knew about GST, and nobody should assume otherwise.
alter table invoices add column if not exists tax_amount numeric(14,2) not null default 0;
alter table invoices add column if not exists tax_rate numeric(5,2) not null default 10.00;
/** Stamped at issue, because a company can re-register or change details. */
alter table invoices add column if not exists supplier_abn text;
alter table invoices add column if not exists builder_abn text;
alter table invoices add column if not exists builder_job_ref text;
/** An RCTI is raised by the recipient; the document says so on its face. */
alter table invoices add column if not exists is_rcti boolean not null default false;

do $$
begin
  alter table invoices add column ex_tax numeric(14,2)
    generated always as (amount - tax_amount) stored;
exception when duplicate_column then null;
end $$;

comment on column invoices.amount is
  'What the builder owes, GST inclusive. Unchanged meaning: the payment ledger and every aging bucket settle against this.';

-- ---------------------------------------------- labour that is not employed

-- They sublet tiling work. A subbie has hours on a site and a cost, but no
-- login, no geofence, no pay rate and no timesheet — everything `shifts`
-- assumes. Putting them in `workers` would put them in the crew list, the
-- roster, the payroll export and the SWMS gate, so they get their own record.
create table if not exists subcontractors (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  trade       text,
  abn         text,
  contact     text,
  phone       text,
  email       text,
  /** What we pay them. Distinct from workers.rate, which is a wage. */
  default_rate numeric(10,2),
  rate_unit   text not null default 'hour' check (rate_unit in ('hour','day','m2','item')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists subcontractors_company_idx on subcontractors (company_id, name);

-- Hours a subbie spent on a job. Entered by the office from the subbie's own
-- docket or invoice — it is a cost record, not a punch, so it never touches
-- the geofence and never appears in a timesheet.
create table if not exists subcontract_work (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid not null references job_sites(id) on delete cascade,
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,
  worked_on   date not null,
  quantity    numeric(10,2) not null,
  unit        text not null default 'hour' check (unit in ('hour','day','m2','item')),
  rate        numeric(10,2) not null,
  /** Generated so a hand-typed total can never disagree with the maths. */
  cost        numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  cost_code   text,
  note        text,
  /** The subbie's invoice, once it arrives, so cost ties back to a document. */
  expense_id  uuid references expenses(id) on delete set null,
  created_by  uuid references workers(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists subcontract_work_site_idx on subcontract_work (site_id, worked_on);

-- ------------------------------------------------------------------- RLS

alter table builders         enable row level security;
alter table builder_contacts enable row level security;
alter table subcontractors   enable row level security;
alter table subcontract_work enable row level security;

-- Builders and their contacts are readable by the whole company: the crew
-- screen is meant to show "site supervisors details", and a chippie who cannot
-- ring the supervisor about access is stuck at a locked gate.
do $$
declare t text;
begin
  foreach t in array array['builders','builder_contacts']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (company_id = current_company_id())', t, t);
    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format('create policy %I_office_write on %I for all
      using (company_id = current_company_id() and current_is_office())
      with check (company_id = current_company_id() and current_is_office())', t, t);
  end loop;
end $$;

-- Subcontractor rates and costs are money, so they follow schema_v14's rule.
do $$
declare t text;
begin
  foreach t in array array['subcontractors','subcontract_work']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select
      using (company_id = current_company_id() and current_is_office())', t, t);
    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format('create policy %I_office_write on %I for all
      using (company_id = current_company_id() and current_is_office())
      with check (company_id = current_company_id() and current_is_office())', t, t);
  end loop;
end $$;
