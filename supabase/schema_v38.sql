-- Crewline schema v38 — job_value_v stops un-receiving cash when a paid
-- invoice is voided.
--
-- Run after schema_v37.sql. Safe to re-run.
--
-- claim_totals (schema_v17.sql) derived paid_inc the same way it derives
-- claimed_inc/claimed_ex: sum(invoices.paid_amount) filter (where status in
-- ('sent','paid')). That is correct for claimed_inc/claimed_ex — a voided
-- invoice's claim really has been withdrawn — but wrong for paid_inc: Void
-- (apps/dashboard/src/ui/Invoices.tsx setStatus()) only ever writes
-- invoices.status, and its own confirm dialog says so ("Any payments
-- recorded against it are left alone") — invoice_payments and paid_amount
-- are untouched. The instant status flips to 'void', that already-received
-- cash dropped out of paid_inc (and therefore out of outstanding_inc) on the
-- spot, even though invoice_payments still had the row and paid_amount still
-- held the figure. A builder's QS does not un-receive a bank transfer
-- because the claim behind it was voided afterwards.
--
-- Fixed by sourcing paid_inc from invoice_payments directly — the actual
-- cash ledger — filtered only by "not a draft" (nothing should be paid
-- against an invoice that was never sent), instead of piggybacking on the
-- same sent/paid filter used for the claim figures. claimed_inc/claimed_ex/
-- retention_held keep the original filter: those describe what is currently
-- being claimed, and a voided claim is rightly excluded from that.
--
-- `create or replace view`, not `drop view ... cascade` (schema_v17.sql's
-- pattern): job_profit_v and company_overview_v (schema_v20.sql) already
-- depend on job_value_v, and the cascade-drop there only works because the
-- file that recreates them runs immediately after it in the same deploy.
-- This file runs last, with nothing after it to rebuild them, so a cascade
-- here would leave both views permanently gone. The output column list below
-- is unchanged from schema_v17.sql — same names, same order, same types —
-- which is all CREATE OR REPLACE VIEW needs.
create or replace view job_value_v with (security_invoker = on) as
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
         sum(i.retention_amount) filter (where i.status in ('sent','paid')) as retention_held,
         count(*)                filter (where i.status = 'draft')          as draft_count
    from invoices i
   where i.site_id is not null
   group by i.site_id
),
payment_totals as (
  -- Cash actually received, read from the ledger itself rather than derived
  -- from invoices.status, so voiding the invoice afterwards can't make it
  -- vanish. Drafts stay excluded — the app never offers Record Payment on
  -- one — but void does not, unlike claim_totals above.
  select i.site_id,
         sum(p.amount) as paid_inc
    from invoice_payments p
    join invoices i on i.id = p.invoice_id
   where i.site_id is not null
     and i.status <> 'draft'
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
       coalesce(pt.paid_inc, 0)                as paid_inc,
       greatest(0, coalesce(t.claimed_inc, 0) - coalesce(pt.paid_inc, 0)) as outstanding_inc,
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
  left join payment_totals pt  on pt.site_id = s.id
 where s.company_id = current_company_id()
   and current_is_office();

comment on view job_value_v is
  'Contract sum plus approved variations, against what has been claimed and paid. One row per job site; contract_id is null when no contract has been entered.';
