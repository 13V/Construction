-- Crewline schema v14 — the money was readable by everyone in the company.
--
-- Run after schema_v13.sql. Safe to re-run.
--
-- `is_office` gates WRITES. It was never on a single read policy. Every
-- money and HR read was a bare `company_id = current_company_id()`, so any
-- signed-in field worker could select the lot.
--
-- Verified against the live database before this migration: a worker with
-- is_office = false read a colleague's pay rate ($97.50), a $48,000 invoice
-- and a $3,200 expense. Crew.tsx prints "Pay rates visible to you only" over
-- a policy with no column filter, which made it worse than silent.
--
-- The surface router made it reachable rather than merely possible: main.tsx
-- picks the office app by URL path, never by role, so a worker who types the
-- bare domain lands on the dashboard — and the data loaded.
--
-- This closes the read side. It does NOT build the third role tier (the
-- Project Manager / Crew Captain the client asked for); that is a larger piece
-- of work and this is the part that should not wait for it.

-- ------------------------------------------------- the commercial tables

-- Office only. Portal policies are separate and stay as they are: a client
-- still sees their own sent invoices, a sub still sees the PO they bill
-- against. Those are scoped by portal identity, not by company membership.
do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_payments','estimates',
                           'purchase_orders','change_orders']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select
      using (company_id = current_company_id() and current_is_office())', t, t);
  end loop;
end $$;

-- The line tables carry no company_id — they hang off a parent and are scoped
-- through it. RLS on the parent does not cascade, so each needs its own.
drop policy if exists invoice_lines_read on invoice_lines;
create policy invoice_lines_read on invoice_lines
  for select using (
    exists (select 1 from invoices i
             where i.id = invoice_lines.invoice_id
               and i.company_id = current_company_id()
               and current_is_office())
  );

drop policy if exists estimate_lines_read on estimate_lines;
create policy estimate_lines_read on estimate_lines
  for select using (
    exists (select 1 from estimates e
             where e.id = estimate_lines.estimate_id
               and e.company_id = current_company_id()
               and current_is_office())
  );

drop policy if exists po_lines_read on po_lines;
create policy po_lines_read on po_lines
  for select using (
    exists (select 1 from purchase_orders p
             where p.id = po_lines.po_id
               and p.company_id = current_company_id()
               and current_is_office())
  );

-- ------------------------------------------------------------- expenses

-- A worker photographs a docket, so they must be able to see the ones they
-- submitted — otherwise the receipt they just sent vanishes. They must not see
-- the job's cost base.
drop policy if exists expenses_read on expenses;
create policy expenses_read on expenses
  for select using (
    company_id = current_company_id()
    and (current_is_office() or submitted_by = current_worker_id())
  );

-- ------------------------------------------------------------ materials

-- The crew needs to know what has been delivered and what is still coming.
-- What it cost is not their business, but RLS cannot hide one column, so the
-- row stays readable and the office-only figures move to a view below.
-- Materials read is deliberately left company-wide.

-- ------------------------------------------------- job budgets and value

-- job_sites has to stay readable — the geofence, the map, every screen keys
-- off it. Only three columns are sensitive, and a view is the only way to
-- drop columns, so the office-only figures live here and the app reads this
-- instead of selecting budget/contract_value off the table.
-- `cascade`, on every view drop in this repo. A later migration builds views on
-- top of this one (job_profit_v and company_overview_v read job_value_v and
-- invoice_status_v), and Postgres refuses to drop a view something depends on.
-- Without cascade, re-running this file on an up-to-date database aborts — and
-- DEPLOY.md's instruction is to run the whole list in order, so an abort here
-- means every migration after it silently never runs. That exact failure has
-- now happened twice. The dependants are recreated by the later file, which
-- always runs after this one; the run is only ever safe as a complete run,
-- which is what the runbook has said all along.
drop view if exists job_money_v cascade;
create view job_money_v with (security_invoker = on) as
  select s.id as site_id, s.name, s.budget, s.contract_value
    from job_sites s
   where s.company_id = current_company_id()
     and current_is_office();

-- -------------------------------------------------------------- pay rates

-- `workers` must stay readable by everyone: the crew list, chat authors, who
-- is on site with you. `rate` must not be. RLS is row-level, so the column is
-- dropped in a view and the office keeps the table.
--
-- NOTE: this migration does NOT yet revoke select on workers, because the app
-- still selects `rate` in office screens that would break. crew_v exists so
-- the worker app and any crew list can move onto it first; the revoke lands
-- once nothing field-facing reads the table directly.
drop view if exists crew_v cascade;
create view crew_v with (security_invoker = on) as
  select id, company_id, auth_user_id, name, initials, trade, is_office, active, ordinary_hours
    from workers
   where company_id = current_company_id();
