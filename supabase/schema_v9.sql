-- Crewline schema v9 — money actually arriving.
--
-- Run after schema_v8.sql. Safe to re-run.
--
-- `invoices.paid_amount` existed but nothing could write a number into it
-- other than the whole invoice total: the dashboard's "Paid" button set
-- paid_amount = amount and that was the only path. A client paying $20,000
-- against a $58,000 claim — the ordinary case, not the exception — had to be
-- recorded as either unpaid or paid in full, and both are wrong. The aging
-- buckets, the cash-in forecast and the "Part paid · $X owing" row label were
-- all reading a field that only ever held 0 or the full amount.
--
-- Payments become rows. paid_amount and status are then derived from the
-- ledger by trigger, so they cannot drift from it no matter which client
-- writes the payment, and "when did that money land" has an answer.

create table if not exists invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  invoice_id  uuid not null references invoices(id) on delete cascade,
  -- Negative is allowed on purpose: a bounced payment or a credit adjustment
  -- is a ledger entry, not a deletion. The running total is what matters.
  amount      numeric(14,2) not null,
  received_on date not null default current_date,
  method      text not null default 'bank'
                check (method in ('bank','card','cash','cheque','other')),
  -- The client's transfer reference, so a bank statement can be matched.
  reference   text,
  note        text,
  created_by  uuid references workers(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists invoice_payments_invoice_idx
  on invoice_payments (invoice_id, received_on);
create index if not exists invoice_payments_company_idx
  on invoice_payments (company_id, received_on desc);

-- Retention is held back per claim and returned at practical completion. The
-- percentage was already stored, but the amount was not, and recovering it by
-- dividing the net figure back out breaks the moment anyone edits a claim.
-- It is real money the builder is owed, so it gets its own column.
alter table invoices add column if not exists retention_amount numeric(14,2) not null default 0;

-- Backfill from the percentage. `amount` is stored net of retention, so the
-- gross is amount / (1 - pct). Guarded against the degenerate 100% case.
update invoices
   set retention_amount = round(amount / (1 - retention_pct / 100) - amount, 2)
 where retention_pct > 0
   and retention_pct < 100
   and retention_amount = 0;

-- Where a claim itemised retention as its own negative line, that line is what
-- was actually withheld and the percentage above is only an approximation of
-- it — builders round, and they apply the percentage to a base that is not
-- always the claim total. The line wins.
--
-- Guarded so it only overwrites a figure this migration derived itself (or a
-- zero), never one somebody entered deliberately, which also makes it a no-op
-- on the second run.
update invoices i
   set retention_amount = abs(l.total)
  from (select invoice_id, sum(amount) as total
          from invoice_lines
         where description ilike '%retention%' and amount < 0
         group by invoice_id) l
 where l.invoice_id = i.id
   and abs(l.total) <> i.retention_amount
   and (i.retention_amount = 0
        or (i.retention_pct > 0 and i.retention_pct < 100
            and i.retention_amount = round(i.amount / (1 - i.retention_pct / 100) - i.amount, 2)));

-- --------------------------------------------------- keeping the two in step

/**
 * Recompute an invoice's paid_amount from its payment rows, and move the
 * status with it.
 *
 * Only 'sent' and 'paid' are touched. A draft that receives a payment stays a
 * draft (it should not have been paid yet, and silently issuing it would hide
 * the mistake), and a void invoice stays void.
 */
create or replace function sync_invoice_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.invoice_id, old.invoice_id);
  total  numeric(14,2);
begin
  select coalesce(sum(amount), 0) into total
    from invoice_payments where invoice_id = target;

  update invoices i
     set paid_amount = total,
         status = case
           when i.status in ('draft','void') then i.status
           when i.amount > 0 and total >= i.amount then 'paid'
           else 'sent'
         end
   where i.id = target;

  return null;
end $$;

drop trigger if exists sync_invoice_paid_t on invoice_payments;
create trigger sync_invoice_paid_t
  after insert or update or delete on invoice_payments
  for each row execute function sync_invoice_paid();

-- ------------------------------------------------------- opening balances

-- Any invoice already carrying a paid_amount predates the ledger, and the
-- trigger above now recomputes paid_amount from payment rows alone. Without
-- this, the first payment recorded against a part-paid invoice would wipe the
-- earlier money — the sum of one new row replacing a balance that had no rows
-- behind it. Each such balance gets an opening entry so the ledger agrees with
-- the figure the office has already seen.
insert into invoice_payments (company_id, invoice_id, amount, received_on, method, note)
select i.company_id, i.id, i.paid_amount, coalesce(i.issued_on, current_date), 'other',
       'Opening balance — recorded before payments were itemised'
  from invoices i
 where i.paid_amount > 0
   and not exists (select 1 from invoice_payments p where p.invoice_id = i.id);

-- ------------------------------------------------------------------- RLS

alter table invoice_payments enable row level security;

drop policy if exists invoice_payments_read on invoice_payments;
create policy invoice_payments_read on invoice_payments
  for select using (company_id = current_company_id());

drop policy if exists invoice_payments_office_write on invoice_payments;
create policy invoice_payments_office_write on invoice_payments
  for all
  using (company_id = current_company_id() and current_is_office())
  with check (company_id = current_company_id() and current_is_office());

-- A client looking at their own invoice needs to see what has been credited
-- against it, or the portal shows an outstanding figure that disagrees with
-- their bank. Scoped to the same invoices the portal can already read.
drop policy if exists invoice_payments_portal_read on invoice_payments;
create policy invoice_payments_portal_read on invoice_payments
  for select using (
    current_portal_kind() = 'client'
    and exists (
      select 1 from invoices i
       where i.id = invoice_payments.invoice_id
         and i.site_id = current_portal_site()
         and i.status <> 'draft'
    )
  );

-- ---------------------------------------------------------------- the view

-- Recreated because the column list changed. `security_invoker` is not
-- optional here — see schema_v5.sql for what happens without it.
drop view if exists invoice_status_v;
create view invoice_status_v with (security_invoker = on) as
  select i.*,
         (i.status = 'sent'
          and i.due_on is not null
          and i.due_on < current_date
          and i.amount > i.paid_amount) as overdue,
         greatest(0, i.amount - i.paid_amount) as outstanding
    from invoices i;
