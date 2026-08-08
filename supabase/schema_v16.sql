-- Crewline schema v16 — three things v15 got wrong, one migration later.
--
-- Run after schema_v15.sql. Safe to re-run.
--
-- v15 was written as "entirely additive, nothing reads differently". Two of
-- those three words were true. What it actually did:
--
--   1. Reopened the exact read leak schema_v14 had just closed. `builders`
--      carries abn, payment_terms_days, default_retention_pct and rcti — the
--      commercial terms of every relationship the business has — behind a
--      company-wide read policy. Any field worker could select the lot.
--   2. Added ten columns to `companies` that nothing can write, because
--      `companies` has only ever had a read policy. A settings form would
--      UPDATE zero rows, get a 200 back, and appear to save.
--   3. Added eight columns to `invoices` without recreating invoice_status_v.
--      That view is `select i.*`, which Postgres freezes at CREATE time, so it
--      still reports the pre-v15 column list and any query for the new columns
--      fails against it.
--
-- All three verified against the live database before this file was written.

-- ---------------------------------------------- 1. the commercial terms

-- Office only, per schema_v14's rule: what a builder pays, how long they take
-- and how much they hold back is not crew information.
drop policy if exists builders_read on builders;
create policy builders_read on builders
  for select using (company_id = current_company_id() and current_is_office());

-- Contacts stay company-wide on purpose. The whole point of putting the site
-- supervisor's mobile in the app is a chippie standing at a locked gate at
-- 6:50am, and a phone number is not a commercial term.
--
-- builder_contacts_read is left as v15 created it.

-- ------------------------------------------- 2. the company's own details

-- A tax invoice carries the supplier's ABN, licence and bank details. v15 added
-- the columns; nothing could ever set them.
drop policy if exists companies_office_write on companies;
create policy companies_office_write on companies
  for update
  using (id = current_company_id() and current_is_office())
  with check (id = current_company_id() and current_is_office());

-- Deliberately no insert or delete policy. A company row is created by
-- /api/bootstrap with the service role, and nothing should ever delete one
-- from the client — that cascades to every job, shift and invoice it has.

-- ------------------------------------------------- 3. the status view

-- Recreated with an EXPLICIT column list. `select i.*` is what caused this:
-- the view froze its columns at creation and silently stopped matching the
-- table three migrations later. Naming them means the next `alter table
-- invoices` is a compile error here rather than a 400 at runtime.
drop view if exists invoice_status_v;
create view invoice_status_v with (security_invoker = on) as
  select i.id,
         i.company_id,
         i.site_id,
         i.builder_id,
         i.invoice_no,
         i.client_name,
         i.period,
         i.issued_on,
         i.due_on,
         i.amount,
         i.tax_amount,
         i.ex_tax,
         i.tax_rate,
         i.supplier_abn,
         i.builder_abn,
         i.builder_job_ref,
         i.is_rcti,
         i.paid_amount,
         i.status,
         i.note,
         i.retention_pct,
         i.retention_amount,
         i.created_at,
         (i.status = 'sent'
          and i.due_on is not null
          and i.due_on < current_date
          and i.amount > i.paid_amount) as overdue,
         greatest(0, i.amount - i.paid_amount) as outstanding
    from invoices i;

-- --------------------------------------------------- 4. realtime, as usual

-- Every migration that added a table put it on the publication. v15 was the
-- first to forget, which would have shown up later as "why does the builder
-- list not refresh when everything beside it does".
do $$
declare t text;
begin
  foreach t in array array['builders','builder_contacts','subcontractors','subcontract_work']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
