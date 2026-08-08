-- Crewline schema v17 — the contract, and what an approved variation does to it.
--
-- Run after schema_v16.sql. Safe to re-run.
--
-- The client described their commercial cycle as: the builder issues a
-- contract, work happens, variations get raised and approved, and the approved
-- variation "goes on the contract" — after which it can be invoiced. Every
-- step of that existed in the app except the thing all of it hangs off.
--
-- What was actually there:
--
--   job_sites.contract_value  numeric, nullable, WITH NO WRITER ANYWHERE.
--
-- Added in schema_v6, read by BudgetTab to compute margin, exposed through
-- job_money_v — and never set by a single form in the app. So margin on every
-- job was computed against null and rendered as "—". Worse, even had it been
-- writable it would still have been wrong: it is one flat number, so an
-- approved variation changed nothing. A tiler who wins $18k of variations on
-- an $80k bathroom job was still being measured against $80k.
--
-- This migration gives the contract a table of its own, links variations and
-- invoices to it, and derives the only number that actually matters:
--
--     contract sum + approved variations = what this job is now worth
--
-- Nothing here changes an existing read. job_money_v and job_sites.contract_value
-- are left exactly as they are; the new view sits beside them and the app moves
-- over screen by screen.

-- ------------------------------------------------------------ the contract

-- One per job site, deliberately. A tiling subcontractor gets one contract or
-- one purchase order per job from the builder — the multi-lot case is handled
-- by builder_job_ref, not by stacking contracts on a site. Making it unique is
-- what lets an invoice find its contract from its site_id alone, which is the
-- difference between a link the office has to maintain and one that is simply
-- true.
create table if not exists contracts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid not null references job_sites(id) on delete cascade,
  builder_id   uuid references builders(id) on delete set null,
  /** The builder's contract number. Their accounts team searches on this. */
  contract_no  text,
  /** Their purchase order, when they issue one as well as (or instead of) a contract. */
  order_no     text,
  title        text,
  /**
   * The sum as the contract states it. Whether that figure includes GST is
   * recorded beside it rather than assumed, because both conventions are in
   * daily use here: commercial subcontracts are almost always ex GST, and a
   * fixed-price residential contract is usually inc. Guessing wrong is a 10%
   * error on every margin figure on the job.
   */
  contract_sum numeric(14,2) not null default 0,
  gst_inclusive boolean not null default false,
  gst_rate     numeric(5,2) not null default 10.00,
  /** Held from each claim until practical completion. Defaults from the builder. */
  retention_pct numeric(5,2) not null default 0
                 check (retention_pct >= 0 and retention_pct <= 100),
  /** Days from invoice date, so the claim due date can be worked out. */
  payment_terms_days integer not null default 30,
  signed_on    date,
  starts_on    date,
  /** Contract completion date. The programme runs against this. */
  due_on       date,
  status       text not null default 'draft'
                 check (status in ('draft','active','completed','terminated')),
  note         text,
  created_at   timestamptz not null default now(),
  unique (site_id)
);
create index if not exists contracts_company_idx on contracts (company_id, status);
create index if not exists contracts_builder_idx on contracts (builder_id);

comment on table contracts is
  'The head contract received FROM the builder for one job. Work this business sublets to its own subbies is subcontract_work and purchase_orders, not this.';

-- ------------------------------------------------ variations onto the contract

-- A variation already exists as change_orders (schema_v4) with draft →
-- pending_client → approved/rejected and a signature. What it lacked was any
-- consequence: approving one changed no number anywhere. These two columns are
-- what make "the approved variation goes on the contract" true.
alter table change_orders add column if not exists contract_id uuid references contracts(id) on delete set null;
/**
 * The date the variation joined the contract sum. Distinct from raised_on, and
 * distinct from signature->>'signed_at': a variation can be approved verbally
 * on site and signed a fortnight later, and it is the approval that authorises
 * the work, so it is the approval that has to be dated.
 */
alter table change_orders add column if not exists approved_on date;

-- Stamped by the database, not the client, so it cannot be missed by whichever
-- screen happens to do the update. Cleared again if a variation is walked back
-- out of approved, because a date on a rejected variation reads as authority
-- that does not exist.
create or replace function change_orders_stamp_approval() returns trigger
language plpgsql as $$
begin
  if new.status = 'approved' and new.approved_on is null then
    new.approved_on := current_date;
  elsif new.status <> 'approved' then
    new.approved_on := null;
  end if;
  return new;
end $$;

drop trigger if exists change_orders_stamp_approval_t on change_orders;
create trigger change_orders_stamp_approval_t
  before insert or update on change_orders
  for each row execute function change_orders_stamp_approval();

-- Existing approvals get a real date rather than today's. The signature is the
-- best record there is; a variation approved without one falls back to the day
-- it was raised, which is at least never later than the truth.
update change_orders
   set approved_on = coalesce((signature ->> 'signed_at')::timestamptz::date, raised_on)
 where status = 'approved'
   and approved_on is null;

-- ----------------------------------------------- invoices onto the contract

-- "Uploaded to contract is invoice goes on the contract." An invoice claims
-- against the contract; a variation invoice claims against one specific
-- variation, which is how the office answers "have we actually billed VO-3".
alter table invoices add column if not exists contract_id uuid references contracts(id) on delete set null;
alter table invoices add column if not exists variation_id uuid references change_orders(id) on delete set null;
create index if not exists invoices_contract_idx on invoices (contract_id);

-- ---------------------------------------------------------------- backfill

-- Every job_sites.contract_value that was ever set (in practice: none, since
-- nothing could write it — but this file must be right on any database, not
-- just this one) becomes a real contract row rather than being stranded.
insert into contracts (company_id, site_id, contract_sum, status)
select s.company_id, s.id, s.contract_value,
       case when s.status = 'archived' then 'completed' else 'active' end
  from job_sites s
 where s.contract_value is not null
   and not exists (select 1 from contracts c where c.site_id = s.id);

-- Variations and invoices already sitting on a site join their site's contract.
update change_orders co
   set contract_id = c.id
  from contracts c
 where co.site_id = c.site_id
   and co.contract_id is null;

update invoices i
   set contract_id = c.id
  from contracts c
 where i.site_id = c.site_id
   and i.contract_id is null;

comment on column job_sites.contract_value is
  'Superseded by contracts.contract_sum, which is writable and which approved variations add to. Kept so job_money_v and any existing read keeps working; do not write it from new code.';

-- --------------------------------------------------------- what a job is worth

-- The number the whole commercial side of the app was missing. One row per job
-- site, whether or not a contract has been entered yet, so a screen can always
-- join to it and show zeros rather than nothing.
--
-- Both GST bases are carried because both are needed and neither can be
-- inferred later: ex GST is what the business earns and what margin is measured
-- on, inc GST is what the builder actually owes and what invoices.amount holds.
drop view if exists job_value_v;
create view job_value_v with (security_invoker = on) as
with variation_totals as (
  select co.site_id,
         sum(co.cost_impact) filter (where co.status = 'approved')       as approved,
         sum(co.cost_impact) filter (where co.status = 'pending_client') as pending,
         count(*) filter (where co.status = 'approved')                  as approved_count,
         count(*) filter (where co.status = 'pending_client')            as pending_count
    from change_orders co
   where co.site_id is not null
   group by co.site_id
),
claim_totals as (
  -- Draft invoices are excluded: nothing has been claimed until it is sent.
  -- Void is excluded for the obvious reason. `amount` is GST inclusive
  -- (schema_v15) and `ex_tax` is generated from it, so both bases are exact
  -- rather than reconstructed with a rate that may not have applied.
  select i.site_id,
         sum(i.amount)           filter (where i.status in ('sent','paid')) as claimed_inc,
         sum(i.ex_tax)           filter (where i.status in ('sent','paid')) as claimed_ex,
         sum(i.paid_amount)      filter (where i.status in ('sent','paid')) as paid_inc,
         sum(i.retention_amount) filter (where i.status in ('sent','paid')) as retention_held,
         count(*)                filter (where i.status = 'draft')          as draft_count
    from invoices i
   where i.site_id is not null
   group by i.site_id
)
select s.id                                    as site_id,
       s.company_id,
       s.name                                  as site_name,
       c.id                                    as contract_id,
       c.contract_no,
       c.order_no,
       c.builder_id,
       c.status                                as contract_status,
       c.signed_on,
       c.due_on,
       c.retention_pct,
       c.payment_terms_days,
       c.gst_inclusive,
       coalesce(c.gst_rate, 10.00)             as gst_rate,
       coalesce(c.contract_sum, 0)             as contract_sum,

       -- The contract sum on each basis. A contract row that does not exist
       -- yet reads as zero, not as null: "no contract entered" is a state the
       -- screen shows explicitly from contract_id being null.
       case when c.id is null then 0
            when c.gst_inclusive then round(c.contract_sum / (1 + c.gst_rate / 100), 2)
            else c.contract_sum end            as contract_sum_ex,
       case when c.id is null then 0
            when c.gst_inclusive then c.contract_sum
            else round(c.contract_sum * (1 + c.gst_rate / 100), 2) end
                                               as contract_sum_inc,

       -- Variations are quoted on the same basis as the contract they vary.
       coalesce(v.approved, 0)                 as approved_variations,
       coalesce(v.pending, 0)                  as pending_variations,
       coalesce(v.approved_count, 0)           as approved_variation_count,
       coalesce(v.pending_count, 0)            as pending_variation_count,

       -- What the job is worth now: the contract as signed, plus everything
       -- approved since. This is the figure margin should be measured against,
       -- and the figure the office means by "the job".
       case when coalesce(c.gst_inclusive, false)
            then round(coalesce(c.contract_sum, 0) / (1 + coalesce(c.gst_rate, 10.00) / 100), 2)
                 + round(coalesce(v.approved, 0) / (1 + coalesce(c.gst_rate, 10.00) / 100), 2)
            else coalesce(c.contract_sum, 0) + coalesce(v.approved, 0) end
                                               as job_value_ex,
       case when coalesce(c.gst_inclusive, false)
            then coalesce(c.contract_sum, 0) + coalesce(v.approved, 0)
            else round((coalesce(c.contract_sum, 0) + coalesce(v.approved, 0))
                       * (1 + coalesce(c.gst_rate, 10.00) / 100), 2) end
                                               as job_value_inc,

       coalesce(t.claimed_inc, 0)              as claimed_inc,
       coalesce(t.claimed_ex, 0)               as claimed_ex,
       coalesce(t.paid_inc, 0)                 as paid_inc,
       greatest(0, coalesce(t.claimed_inc, 0) - coalesce(t.paid_inc, 0)) as outstanding_inc,
       coalesce(t.retention_held, 0)           as retention_held,
       coalesce(t.draft_count, 0)              as draft_invoice_count,

       -- Left to claim. Not floored at zero on purpose: over-claiming is a
       -- real and serious condition on a construction contract, and a screen
       -- that quietly clamps it to nought is hiding the one number a builder's
       -- QS will find.
       (case when coalesce(c.gst_inclusive, false)
             then coalesce(c.contract_sum, 0) + coalesce(v.approved, 0)
             else round((coalesce(c.contract_sum, 0) + coalesce(v.approved, 0))
                        * (1 + coalesce(c.gst_rate, 10.00) / 100), 2) end)
       - coalesce(t.claimed_inc, 0)            as to_claim_inc
  from job_sites s
  left join contracts c        on c.site_id = s.id
  left join variation_totals v on v.site_id = s.id
  left join claim_totals t     on t.site_id = s.id
 where s.company_id = current_company_id()
   and current_is_office();

comment on view job_value_v is
  'Contract sum plus approved variations, against what has been claimed and paid. One row per job site; contract_id is null when no contract has been entered.';

-- ------------------------------------------------------------------- RLS

alter table contracts enable row level security;

-- A contract sum is the most commercially sensitive number on a job, so it
-- follows schema_v14's rule without exception: office reads, office writes.
drop policy if exists contracts_read on contracts;
create policy contracts_read on contracts
  for select using (company_id = current_company_id() and current_is_office());

drop policy if exists contracts_office_write on contracts;
create policy contracts_office_write on contracts
  for all
  using (company_id = current_company_id() and current_is_office())
  with check (company_id = current_company_id() and current_is_office());

-- Deliberately no portal policy. A client portal shows that client their own
-- invoices and their own variations, which schema_v4 already handles. The
-- contract's retention terms and payment days are between this business and
-- the builder, and a subcontractor's portal login must never reach them.

-- --------------------------------------------------------------- realtime

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table contracts';
  exception when duplicate_object then null;
  end;
end $$;
