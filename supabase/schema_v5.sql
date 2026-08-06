-- Crewline schema v5 — RLS corrections found by the v4 smoke test.
--
-- Run after schema_v4.sql. Safe to re-run.
--
-- Three of these are security fixes, not features. The first one was a live
-- cross-tenant leak: a user with no company, no worker row and no portal
-- contact could read every company's invoices.

-- ------------------------------------------------- 1. the invoice view leak

-- A Postgres view runs as its OWNER unless told otherwise, so RLS on the
-- underlying table is never consulted. invoice_status_v is owned by postgres,
-- which means it handed every invoice in the database to any authenticated
-- caller — and signup is open, so that is anyone at all.
--
-- security_invoker makes the view read as the CALLER, which puts the invoices
-- policies back in the path. Any future view over an RLS table needs this too.
alter view invoice_status_v set (security_invoker = on);

-- --------------------------------------------- 2. portals: whose row is this

/** The portal caller's kind ('client' | 'sub'), or null for staff. */
create or replace function current_portal_kind()
returns text
language sql stable security definer set search_path = public as $$
  select kind from portal_contacts where auth_user_id = auth.uid() and active limit 1;
$$;

-- The old invoices_portal_read asked `(select kind from portal_contacts where
-- auth_user_id = auth.uid())` inline. That subquery is itself subject to RLS on
-- portal_contacts, whose read policy is `company_id = current_company_id()` —
-- and current_company_id() is null for a portal visitor, who has no workers
-- row. So the subquery returned nothing, `null = 'client'` was null, and the
-- policy denied the client their own invoices. A policy that needs to look up
-- the caller must go through a security definer function, never a bare
-- subquery against another protected table.
drop policy if exists invoices_portal_read on invoices;
create policy invoices_portal_read on invoices
  for select using (
    site_id = current_portal_site()
    and current_portal_kind() = 'client'
    and status <> 'draft');

-- Cost impact and schedule slip are between the builder and the client. A
-- subcontractor on the same job has no business reading either.
drop policy if exists change_orders_portal_read on change_orders;
create policy change_orders_portal_read on change_orders
  for select using (
    site_id = current_portal_site()
    and current_portal_kind() = 'client'
    and status <> 'draft');

-- daily_logs.crew_summary carries worker names and hours. That is staff data.
drop policy if exists daily_logs_portal_read on daily_logs;
create policy daily_logs_portal_read on daily_logs
  for select using (
    site_id = current_portal_site()
    and current_portal_kind() = 'client'
    and status = 'confirmed');

-- ------------------------------------------ 3. portals: the budget is ours

-- job_sites.budget is the builder's internal cost target, not the contract
-- price, and job_sites_portal_read handed the whole row over. RLS filters rows,
-- not columns, so the fix is to stop portal visitors reading the table at all
-- and give them a view with only the columns the portal is meant to show.
--
-- This view is deliberately NOT security_invoker: it runs as its owner and so
-- bypasses RLS on job_sites, which is safe only because the predicate below is
-- inside the view where the caller cannot remove it. security_barrier stops a
-- caller-supplied WHERE from being evaluated ahead of that predicate.
create or replace view portal_site_v
  with (security_barrier = true) as
  select id, name, address, job_type, status, client_name, progress_pct, schedule_note
    from job_sites
   where id = current_portal_site();

grant select on portal_site_v to authenticated, anon;

drop policy if exists job_sites_portal_read on job_sites;

-- ------------------------------------- 4. a client answers, does not rewrite

-- selections_portal_update lets a portal visitor UPDATE the row so they can
-- answer a selection. RLS has no column granularity and WITH CHECK cannot see
-- OLD, so without this a client could also reword the selection, move its due
-- date, or reassign it to another job.
create or replace function selections_portal_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Staff edits are unrestricted; only portal visitors are constrained.
  if current_worker_id() is not null then
    return new;
  end if;
  if new.company_id is distinct from old.company_id
     or new.site_id   is distinct from old.site_id
     or new.name      is distinct from old.name
     or new.detail    is distinct from old.detail
     or new.needed_by is distinct from old.needed_by then
    raise exception 'A portal visitor can answer a selection but not change it';
  end if;
  return new;
end $$;

drop trigger if exists selections_portal_guard_t on selections;
create trigger selections_portal_guard_t
  before update on selections
  for each row execute function selections_portal_guard();
