-- Crewline schema v11 — products, and the paperwork that has to follow them.
--
-- Run after schema_v10.sql. Safe to re-run.
--
-- From the client's own list of what a job needs: tile selections, grout
-- selection, technical data sheets, and material safety data sheets. All four
-- are the same shape underneath — a *product* the job uses, and the documents
-- that came with it — so they get one set of tables rather than four.
--
-- The SDS half is not filing. Under the WHS Regulations a business must keep a
-- register of the hazardous chemicals at a workplace, hold the current safety
-- data sheet for each, and keep it readily accessible to any worker who could
-- be exposed. A tiler's adhesives, epoxies, sealers and solvents are all in
-- scope. An SDS is only current for five years from its issue date, so the
-- issue date is a column and not a nicety — a register full of lapsed sheets
-- fails an inspection exactly as hard as an empty one.

-- ------------------------------------------------------------- the products

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null default 'other'
                check (kind in ('tile','adhesive','grout','sealer','silicone','waterproofing','trim','other')),
  name        text not null,
  brand       text,
  /** The supplier's product code — what actually gets ordered. */
  code        text,
  colour      text,
  /** "600 x 600 x 10 mm", "20 kg bag". Free text: units vary by product kind. */
  size        text,
  supplier    text,
  /** Set by the office when a product is a hazardous chemical under the WHS
      Regulations. Drives whether a current SDS is required. */
  hazardous   boolean not null default false,
  note        text,
  active      boolean not null default true,
  created_by  uuid references workers(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists products_company_idx on products (company_id, kind, name);

-- ------------------------------------------------------- their paperwork

create table if not exists product_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  -- tds: how to install it — coverage, open time, substrate prep, joint width.
  -- sds: how it can hurt you, and what to do when it has.
  kind        text not null check (kind in ('tds','sds','warranty','certificate','other')),
  title       text not null,
  storage_path text not null,
  mime        text,
  size_bytes  bigint,
  /** The date printed on the sheet, not the day it was uploaded. An SDS is
      only current for five years from this. */
  issued_on   date,
  uploaded_by uuid references workers(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists product_documents_product_idx on product_documents (product_id, kind);

-- --------------------------------------------------- what is on which job

create table if not exists site_products (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid not null references job_sites(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  /** Where it goes: "Ensuite floor", "Kitchen splashback". */
  area        text,
  /** A selection is the client's choice; a consumable is what the crew uses. */
  role        text not null default 'selection' check (role in ('selection','consumable')),
  quantity    numeric(12,2),
  unit        text,
  note        text,
  created_at  timestamptz not null default now(),
  unique (site_id, product_id, area)
);
create index if not exists site_products_site_idx on site_products (site_id, role);

-- A selection can now point at the actual product, which is what turns
-- "Floor tile — pending" into a picture, a code the supplier recognises, and
-- the installation sheet the tiler needs.
alter table selections add column if not exists product_id uuid references products(id) on delete set null;

-- --------------------------------------------------------------- the register

/**
 * The hazardous chemical register for a site: every hazardous product on the
 * job, its current SDS, and whether that SDS has gone stale.
 *
 * security_invoker so it obeys the caller's RLS — see schema_v5.sql for what
 * happens to a view that does not.
 */
-- `cascade`, on every view drop in this repo. A later migration builds views on
-- top of this one (job_profit_v and company_overview_v read job_value_v and
-- invoice_status_v), and Postgres refuses to drop a view something depends on.
-- Without cascade, re-running this file on an up-to-date database aborts — and
-- DEPLOY.md's instruction is to run the whole list in order, so an abort here
-- means every migration after it silently never runs. That exact failure has
-- now happened twice. The dependants are recreated by the later file, which
-- always runs after this one; the run is only ever safe as a complete run,
-- which is what the runbook has said all along.
drop view if exists site_sds_register_v cascade;
create view site_sds_register_v with (security_invoker = on) as
  select sp.site_id,
         p.id            as product_id,
         p.name,
         p.brand,
         p.supplier,
         sp.area,
         d.id            as document_id,
         d.storage_path,
         d.issued_on,
         -- An SDS is current for five years from its issue date. No sheet at
         -- all and a sheet from 2016 are both failures, so both are false.
         (d.id is not null
          and d.issued_on is not null
          and d.issued_on > (current_date - interval '5 years')) as sds_current
    from site_products sp
    join products p on p.id = sp.product_id
    left join lateral (
      select id, storage_path, issued_on
        from product_documents
       where product_id = p.id and kind = 'sds'
       order by issued_on desc nulls last
       limit 1
    ) d on true
   where p.hazardous;

-- ------------------------------------------------------------------- RLS

alter table products          enable row level security;
alter table product_documents enable row level security;
alter table site_products     enable row level security;

-- Everyone in the company reads. A worker has to be able to pull up an SDS on
-- their phone — "readily accessible" is the actual wording of the obligation,
-- and a register only the office can open does not meet it.
do $$
declare t text;
begin
  foreach t in array array['products','product_documents','site_products']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (company_id = current_company_id())', t, t);
    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format('create policy %I_office_write on %I for all
      using (company_id = current_company_id() and current_is_office())
      with check (company_id = current_company_id() and current_is_office())', t, t);
  end loop;
end $$;

-- The client sees the tiles and grout they chose, and their datasheets. They
-- do not see what the crew is using or what it cost.
drop policy if exists site_products_portal_read on site_products;
create policy site_products_portal_read on site_products
  for select using (site_id = current_portal_site() and role = 'selection');

drop policy if exists products_portal_read on products;
create policy products_portal_read on products
  for select using (
    exists (
      select 1 from site_products sp
       where sp.product_id = products.id
         and sp.site_id = current_portal_site()
         and sp.role = 'selection'
    )
  );

drop policy if exists product_documents_portal_read on product_documents;
create policy product_documents_portal_read on product_documents
  for select using (
    exists (
      select 1 from site_products sp
       where sp.product_id = product_documents.product_id
         and sp.site_id = current_portal_site()
         and sp.role = 'selection'
    )
  );
