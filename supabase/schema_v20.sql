-- Crewline schema v20 — what a job actually made.
--
-- Run after schema_v19.sql. Safe to re-run.
--
-- schema_v17 answered what a job is WORTH. This answers what it COST, and puts
-- the two together — which is the "job profitability" the client asked for and
-- the only number that tells this business whether a builder is worth working
-- for.
--
-- Cost was already computed, in TypeScript, in siteSpend() — and separately in
-- Materials.tsx, which is why a comment there says "mirrors JobSiteFolder's
-- roll-up exactly so the two screens never show different numbers". Two copies
-- of an arithmetic rule stay identical exactly as long as nobody edits one. It
-- moves here so there is one.
--
-- EVERYTHING BELOW IS EX GST, on both sides. That is not a stylistic choice:
--   * GST collected on a claim is not revenue, it is remitted.
--   * GST paid on a docket is not a cost, it is claimed back as an input credit.
-- Mixing the two bases is a 10% error, and a 10% error on a margin that is
-- typically 15-25% is most of the answer.
--
-- What is deliberately NOT in the cost side:
--   * Overheads, on-costs and superannuation. `workers.rate` is a bare wage, so
--     labour here is direct wage cost only. A tiler's true cost of labour is
--     roughly 1.3-1.5x that once super, leave, insurance and workers' comp are
--     counted, and the client explicitly deferred on-costs ("9 and 10 skip for
--     now"). The view exposes labour_hours beside labour_cost so an on-cost
--     multiplier can be applied later without restating anything.
--   * Anything from an unapproved variation, on either side.

-- ------------------------------------------------------------ what it cost

-- `cascade`, on every view drop in this repo. A later migration builds views on
-- top of this one (job_profit_v and company_overview_v read job_value_v and
-- invoice_status_v), and Postgres refuses to drop a view something depends on.
-- Without cascade, re-running this file on an up-to-date database aborts — and
-- DEPLOY.md's instruction is to run the whole list in order, so an abort here
-- means every migration after it silently never runs. That exact failure has
-- now happened twice. The dependants are recreated by the later file, which
-- always runs after this one; the run is only ever safe as a complete run,
-- which is what the runbook has said all along.
drop view if exists job_cost_v cascade;
create view job_cost_v with (security_invoker = on) as
with labour as (
  -- Closed shifts only. An open shift has no duration yet, and counting one as
  -- "now minus start" makes the cost of a job change every time the page is
  -- refreshed — which is how a margin figure loses its authority.
  select s.site_id,
         sum(greatest(0, extract(epoch from (s.ended_at - s.started_at)) / 3600.0
                         - coalesce(s.break_minutes, 0) / 60.0))          as hours,
         sum(greatest(0, extract(epoch from (s.ended_at - s.started_at)) / 3600.0
                         - coalesce(s.break_minutes, 0) / 60.0) * coalesce(p.rate, 0)) as cost
    from shifts s
    join workers w on w.id = s.worker_id
    -- LEFT join, and the reason is the security model rather than missing data.
    -- This view is security_invoker, so worker_pay's office-only policy is
    -- applied to whoever is asking. For the office every row matches and the
    -- cost is real; for anyone else no row matches, and a left join turns that
    -- into a zero rather than dropping the shift entirely and reporting hours
    -- that silently exclude half the crew. Nobody but the office can read this
    -- view at all — job_profit_v and the office screens are gated — but if that
    -- ever changes, "zero cost" is a visibly wrong number and "quietly fewer
    -- hours" is not.
    left join worker_pay p on p.worker_id = w.id
   where s.site_id is not null
     and s.ended_at is not null
   group by s.site_id
),
mats as (
  -- Returned stock is not a cost. Supplier prices to a trade account are ex GST,
  -- and materials carry no tax column, so total_cost is taken at face value.
  select site_id, sum(total_cost) as cost
    from materials
   where status <> 'returned'
   group by site_id
),
linked as (
  -- An expense already folded into a material line would be counted twice.
  select distinct expense_id from materials where expense_id is not null
),
other as (
  select e.site_id,
         sum(e.amount - coalesce(e.tax, 0)) as cost
    from expenses e
   where e.site_id is not null
     and not exists (select 1 from linked l where l.expense_id = e.id)
   group by e.site_id
),
sublet as (
  -- Labour bought in rather than employed. It is a real cost of the job and was
  -- missing from every roll-up in the app, because siteSpend() predates the
  -- table existing.
  select site_id, sum(cost) as cost
    from subcontract_work
   group by site_id
)
select s.id                                    as site_id,
       s.company_id,
       s.name                                  as site_name,
       round(coalesce(l.hours, 0), 2)          as labour_hours,
       round(coalesce(l.cost, 0), 2)           as labour_cost,
       coalesce(m.cost, 0)                     as material_cost,
       coalesce(o.cost, 0)                     as expense_cost,
       coalesce(sub.cost, 0)                   as sublet_cost,
       round(coalesce(l.cost, 0) + coalesce(m.cost, 0)
             + coalesce(o.cost, 0) + coalesce(sub.cost, 0), 2) as total_cost
  from job_sites s
  left join labour l   on l.site_id = s.id
  left join mats m     on m.site_id = s.id
  left join other o    on o.site_id = s.id
  left join sublet sub on sub.site_id = s.id
 where s.company_id = current_company_id()
   and current_is_office();

comment on view job_cost_v is
  'Direct cost of a job, ex GST: wages for closed shifts, materials not returned, expenses net of GST and not already counted as materials, and sublet labour. No overheads or on-costs — labour_hours is exposed so a multiplier can be applied without restating this.';

-- --------------------------------------------------------- and what it made

drop view if exists job_profit_v cascade;
create view job_profit_v with (security_invoker = on) as
  select v.site_id,
         v.company_id,
         v.site_name,
         v.contract_id,
         v.contract_status,
         v.builder_id,

         v.contract_sum_ex,
         v.approved_variations,
         v.job_value_ex,
         v.job_value_inc,
         v.claimed_inc,
         v.claimed_ex,
         v.paid_inc,
         v.outstanding_inc,
         v.to_claim_inc,
         v.retention_held,

         c.labour_hours,
         c.labour_cost,
         c.material_cost,
         c.expense_cost,
         c.sublet_cost,
         c.total_cost,

         -- Margin against the whole job. Both sides ex GST.
         round(v.job_value_ex - c.total_cost, 2)                as margin,
         case when v.job_value_ex > 0
              then round((v.job_value_ex - c.total_cost) / v.job_value_ex * 100, 1)
         end                                                    as margin_pct,

         -- What an hour on this job returned, after everything that was not
         -- labour. The number a tiling business actually runs on: it is directly
         -- comparable to the charge-out rate and to every other job.
         case when c.labour_hours > 0
              then round((v.job_value_ex - c.material_cost - c.expense_cost - c.sublet_cost)
                         / c.labour_hours, 2)
         end                                                    as value_per_labour_hour,

         -- Cost booked against work not yet claimed. On a job running to plan
         -- this tracks progress; when it runs away it is the earliest warning
         -- there is that the job is being worked faster than it is being billed.
         round(c.total_cost - v.claimed_ex, 2)                   as unbilled_cost,

         p.pct_complete                                          as progress_pct,
         p.last_assessed_on                                      as progress_assessed_on,

         -- Claimed as a share of the job. Read beside progress_pct, the two
         -- together are the over/under-claim conversation with a builder.
         case when v.job_value_inc > 0
              then round(v.claimed_inc / v.job_value_inc * 100, 1)
         end                                                     as claimed_pct
    from job_value_v v
    join job_cost_v c on c.site_id = v.site_id
    left join site_progress_v p on p.site_id = v.site_id;

comment on view job_profit_v is
  'One row per job: what it is worth, what it cost, what that leaves, and what an hour on it returned. Office only, both sides ex GST.';

-- ------------------------------------------- the whole business, one row

-- The counters an owner wants on opening the app, computed once rather than by
-- pulling every job down to the browser and adding them up there.
drop view if exists company_overview_v cascade;
create view company_overview_v with (security_invoker = on) as
  select
    (select count(*) from job_sites
      where company_id = current_company_id() and status = 'active')          as active_jobs,
    (select count(*) from job_sites
      where company_id = current_company_id() and status = 'starting_soon')   as starting_soon,
    (select count(*) from shifts
      where company_id = current_company_id() and ended_at is null)           as on_the_clock,
    (select coalesce(sum(job_value_ex), 0) from job_profit_v)                 as work_in_hand,
    (select coalesce(sum(to_claim_inc), 0) from job_profit_v)                 as left_to_claim,
    (select coalesce(sum(outstanding_inc), 0) from job_profit_v)              as owed_to_us,
    (select coalesce(sum(retention_held), 0) from job_profit_v)               as retention_held,
    (select coalesce(sum(margin), 0) from job_profit_v)                       as margin_to_date,
    (select count(*) from invoice_status_v where overdue)                     as overdue_invoices,
    (select coalesce(sum(outstanding), 0) from invoice_status_v where overdue) as overdue_amount,
    (select count(*) from change_orders
      where company_id = current_company_id() and status = 'pending_client')  as variations_pending,
    (select coalesce(sum(cost_impact), 0) from change_orders
      where company_id = current_company_id() and status = 'pending_client')  as variations_pending_value,
    (select count(*) from defects
      where company_id = current_company_id() and status in ('open','in_progress')) as open_defects,
    (select count(*) from site_instructions
      where company_id = current_company_id() and status = 'open')            as open_instructions,
    -- Wet areas finished but not signed off. Every one of them is a certificate
    -- the builder is waiting on and a liability nobody has closed.
    (select coalesce(sum(outstanding_count), 0) from site_waterproofing_v)    as waterproofing_outstanding,
    (select count(*) from certifications c
       join workers w on w.id = c.worker_id
      where w.company_id = current_company_id()
        and c.expires_on is not null
        and c.expires_on < current_date + 30)                                 as tickets_expiring
  where current_is_office();

comment on view company_overview_v is
  'The owner''s opening screen, in one row. Office only — every figure on it is money or company-wide.';
