-- schema_v24 — close two column-level leaks that RLS was never going to close.
--
-- Both are the same mistake in two places: a policy grants a row to a role that
-- is supposed to see only part of it. Postgres RLS is row-level. There is no
-- column-level RLS, so "you may read this row but not that column of it" has to
-- be built out of something else — a different table, or a view with the column
-- left out and security_invoker off.
--
-- 1. PAY RATES. `workers_read` (schema.sql) grants SELECT on the whole workers
--    row to everyone in the company, and `rate` was a column on it. Any worker
--    holding their own token could GET /rest/v1/workers?select=name,rate and
--    read the entire company's wages. The app never asked for that column
--    outside the office screens, which is why it was never visible — but the
--    API answered anyone who did.
--
--    This was known. schema_v14 documented it, added crew_v as a first step,
--    and left a note to "revoke select on workers" once the office screens
--    moved off the table. That plan could not have worked. Office and field
--    staff are the same Postgres role, `authenticated` — a column-level GRANT
--    cannot distinguish them, so revoking `rate` would have blinded payroll
--    too. The column has to move to a table that RLS can gate by who is asking.
--
--    It also makes a published promise true. PRIVACY.md and the in-app policy
--    both state that crew captains "cannot see the live map trail or anyone's
--    pay rate". Until this file, the second half of that sentence was false.
--
-- 2. VARIATION VALUES. schema_v18 gave captains SELECT on change_orders for
--    their own sites, with the stated intent that they see "what has been
--    raised and what has been approved" — while the same row carries
--    cost_impact. The intent was right and the mechanism gave away the money.
--    The policy narrows to the office; captains get site_variations_v, which is
--    the same list with no dollar figure on it.
--
-- Safe to re-run. The backfill is guarded on the old column still existing, and
-- every view drop cascades.

-- ------------------------------------------------------------------ pay rates

-- worker_pay itself is created in schema.sql, next to workers, because
-- job_cost_v in schema_v20 reads it and every file has to be applicable in
-- order on a fresh database. This block is only the migration of existing data.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'workers' and column_name = 'rate'
  ) then
    insert into worker_pay (worker_id, company_id, rate)
      select id, company_id, rate from workers
      on conflict (worker_id) do nothing;

    -- cascade because crew_v and job_cost_v may still be the old definitions
    -- that read this column; both are recreated below and by schema_v20.
    alter table workers drop column rate cascade;
    raise notice 'workers.rate migrated into worker_pay and dropped';
  end if;
end $$;

-- Every existing worker gets a row, so an office screen can edit a rate without
-- first discovering whether one exists.
insert into worker_pay (worker_id, company_id, rate)
  select id, company_id, 0 from workers
  on conflict (worker_id) do nothing;

-- And every future one, by trigger rather than by each insert path remembering.
-- There are three of them already — the Crew screen, /api/bootstrap claiming an
-- invited row, and the seed script — and "no worker_pay row" is not a visible
-- failure: it reads as a null rate, which the office would see as a blank wage
-- on a real employee. A trigger is also the only mechanism that covers the
-- service role, which bypasses RLS but does not bypass triggers.
--
-- SECURITY DEFINER because the row belongs to the company, not to whoever
-- happened to insert the worker; the values come from the new row rather than
-- from the caller, so there is nothing here for a caller to influence.
create or replace function workers_ensure_pay() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into worker_pay (worker_id, company_id, rate)
  values (new.id, new.company_id, 0)
  on conflict (worker_id) do nothing;
  return new;
end;
$$;

drop trigger if exists workers_ensure_pay_t on workers;
create trigger workers_ensure_pay_t after insert on workers
  for each row execute function workers_ensure_pay();

comment on table worker_pay is
  'Hourly wage, split off workers so that RLS can gate it. workers is readable by the whole company by design (the crew list, chat authors, who is on site); a pay rate must not be, and RLS is row-level so it could not be hidden while the row was readable.';

-- crew_v is the crew list everything reads. It carries the rate now, and the
-- rate is correct for exactly one audience without the view knowing anything
-- about roles: security_invoker = on means worker_pay's office-only policy is
-- evaluated against whoever is querying, so the office left-joins a row and
-- everyone else left-joins nothing and gets null. One view, no branching, and
-- no second query for the office to remember to make.
drop view if exists crew_v cascade;
create view crew_v with (security_invoker = on) as
  select w.id, w.company_id, w.auth_user_id, w.name, w.initials, w.trade,
         w.is_office, w.role, w.active, w.ordinary_hours,
         p.rate
    from workers w
    left join worker_pay p on p.worker_id = w.id
   where w.company_id = current_company_id();

comment on view crew_v is
  'The crew list. rate comes back for the office and null for everyone else, decided by worker_pay RLS rather than by this view — so a screen that forgets to check a role still cannot show a wage to a captain.';

-- ------------------------------------------------------------- variations

-- Office only. schema_v18's version added `or captains_site(site_id)`, which
-- handed the captain cost_impact along with the description.
drop policy if exists change_orders_read on change_orders;
create policy change_orders_read on change_orders
  for select using (company_id = current_company_id() and current_is_office());

-- What a captain is actually supposed to have: the variation register for their
-- own jobs, so they know what has been raised and what the builder has agreed
-- to, with no figure attached. security_invoker = off — this view deliberately
-- does NOT inherit the policy above, and its where clause is the only gate, so
-- treat any edit to it as an edit to a security boundary.
--
-- cost_impact is absent rather than nulled. A null column invites a screen to
-- render "$—" and a reader to wonder whether that means zero.
--
-- days_impact stays. Time is not money here: whether a variation pushes the
-- programme out three days is the captain's problem to plan around, and it is
-- the question they get asked on site.
--
-- `signature` is out too. It is the client's name and the moment they accepted,
-- which is the record of authority to bill — office business, not site business.
drop view if exists site_variations_v cascade;
create view site_variations_v with (security_invoker = off) as
  select id, company_id, site_id, co_no, description, detail, days_impact,
         status, raised_on, approved_on, created_at
    from change_orders
   where company_id = current_company_id()
     and (current_is_office() or captains_site(site_id));

comment on view site_variations_v is
  'The variation register a crew captain may see: what was raised, why, whether it was approved, and what it does to the programme. No cost_impact and no signature. SECURITY DEFINER — the where clause is the only thing between a captain and every variation in the company.';

grant select on crew_v, site_variations_v to authenticated;
