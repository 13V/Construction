import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  supabase,
  type ChangeOrderRow,
  type EstimateLineRow,
  type EstimateRow,
  type ExpenseRow,
  type InvoiceLineRow,
  type InvoicePaymentRow,
  type InvoiceRow,
  type PoLineRow,
  type PurchaseOrderRow,
  type WorkerRow,
} from '../data/supabase'
import { costCodes } from '../data/seed'
import { money, money2 } from '../format'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Invoices and progress claims.
 *
 * Overdue is never stored. An invoice is overdue when it has been sent and
 * its due date has passed — a boolean column for that would be correct at
 * write time and wrong by morning. Everything on this screen that says
 * "overdue" is computed against today on every render.
 */

// The last column carries the row actions alongside the status chip, and
// "Record payment" next to an "Overdue" pill is the widest that gets: at 140px
// the amount column was being clipped to "$3".
const LIST_COLUMNS = '104px 1fr 148px 100px 104px 112px 214px'
const CLAIM_COLUMNS = '1fr 116px 104px 130px 118px 118px'

const STATUS_META: Record<InvoiceRow['status'], { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: theme.appBg, fg: theme.inkSoft },
  sent: { label: 'Sent', bg: theme.accentFill, fg: theme.accent },
  paid: { label: 'Paid', bg: theme.successFill, fg: theme.successInk },
  void: { label: 'Void', bg: theme.fill, fg: theme.inkFaint },
}

const OVERDUE_META = { label: 'Overdue', bg: theme.alertFill, fg: theme.alertInk }

const PAYMENT_METHODS: Array<[InvoicePaymentRow['method'], string]> = [
  ['bank', 'Bank transfer'],
  ['card', 'Card'],
  ['cash', 'Cash'],
  ['cheque', 'Cheque'],
  ['other', 'Other'],
]

const SITE_PALETTE = ['#4E7FB0', '#8A6FCB', '#4E9E78', '#C08A3E', '#B15D87', '#5C8F99', '#8C8F52', '#B15F5F']

/** Stable colour per job site so the same site always reads the same. */
function siteColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return SITE_PALETTE[hash % SITE_PALETTE.length]!
}

const startOfDay = (d: Date) => {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/** Whole days a due date is past today. Negative means it hasn't fallen due. */
function daysPastDue(dueOn: string | null, today: Date): number {
  if (!dueOn) return -Infinity
  const due = startOfDay(new Date(`${dueOn}T00:00:00`))
  return Math.round((today.getTime() - due.getTime()) / 86_400_000)
}

/**
 * Round to cents at every step of a claim, not once at the end. `numeric(14,2)`
 * rounds on the way into Postgres, so a total carrying a third decimal comes
 * back a cent away from the sum of its own parts — and a claim whose GST line
 * does not add up is a claim a builder's accounts team sends back.
 */
const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100

const outstandingOf = (inv: InvoiceRow) => Math.max(0, Number(inv.amount) - Number(inv.paid_amount))

/** Sent, still owing, and past its due date. The only definition used anywhere here. */
function isOverdue(inv: InvoiceRow, today: Date): boolean {
  return inv.status === 'sent' && outstandingOf(inv) > 0 && daysPastDue(inv.due_on, today) > 0
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }) : '—'

/** Monday of the week containing `d`. Weeks are the unit builders think in. */
function weekStart(d: Date): Date {
  const c = startOfDay(d)
  const dow = (c.getDay() + 6) % 7
  c.setDate(c.getDate() - dow)
  return c
}

function suggestInvoiceNo(rows: InvoiceRow[]): string {
  let max = 2000
  for (const i of rows) {
    const m = /^INV-(\d+)$/.exec(i.invoice_no.trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `INV-${max + 1}`
}

type Filter = 'all' | 'draft' | 'sent' | 'overdue'
type Grouping = 'site' | 'date'

interface ClaimLineDraft {
  key: string
  costCode: string
  description: string
  pctComplete: string
  amount: string
}

const blankClaimLine = (): ClaimLineDraft => ({
  key: crypto.randomUUID(),
  costCode: '',
  description: '',
  pctComplete: '',
  amount: '',
})

interface PaymentDraft {
  amount: string
  receivedOn: string
  method: InvoicePaymentRow['method']
  reference: string
  note: string
}

interface ClaimForm {
  /** Set when reopening an existing draft, null when raising a new one. */
  editingId: string | null
  invoiceNo: string
  siteId: string
  clientName: string
  period: string
  issuedOn: string
  dueOn: string
  retentionPct: string
  /** 10.00 in Australia. Zero for a supplier who is not registered for GST. */
  gstRate: string
  /** Set when this claim is for one approved variation rather than the base contract. */
  variationId: string
  note: string
  lines: ClaimLineDraft[]
}

/** The contract fields a claim needs: which contract, and its default terms. */
interface ContractLite {
  id: string
  site_id: string
  retention_pct: number
  payment_terms_days: number
}

export function Invoices({
  me,
  sites,
  // Every feature screen shares one prop contract; an invoice has no worker
  // reference in the schema, so the roster isn't read here.
  workers: _workers,
  onChanged,
}: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const canEdit = me.is_office

  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [payments, setPayments] = useState<InvoicePaymentRow[]>([])
  const [pos, setPos] = useState<PurchaseOrderRow[]>([])
  const [poLines, setPoLines] = useState<PoLineRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [estimates, setEstimates] = useState<EstimateRow[]>([])
  const [estLines, setEstLines] = useState<EstimateLineRow[]>([])
  const [contracts, setContracts] = useState<ContractLite[]>([])
  const [variations, setVariations] = useState<ChangeOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [filter, setFilter] = useState<Filter>('all')
  const [grouping, setGrouping] = useState<Grouping>('site')
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<ClaimForm | null>(null)
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null)
  const [confirm, setConfirm] = useState<{ inv: InvoiceRow; action: 'void' | 'delete' } | null>(null)

  // Recomputed per load rather than per render so a long-lived tab doesn't
  // shift rows between overdue and not while the user is reading them.
  const today = useMemo(() => startOfDay(new Date()), [])

  const load = useCallback(async () => {
    setLoading(true)
    const client = supabase()
    const [inv, il, ip, po, pl, ex, es, el, ct, vo] = await Promise.all([
      client.from('invoices').select('*').order('issued_on', { ascending: false }),
      client.from('invoice_lines').select('*').order('sort'),
      client.from('invoice_payments').select('*').order('received_on'),
      client.from('purchase_orders').select('*'),
      client.from('po_lines').select('*'),
      client.from('expenses').select('*'),
      client.from('estimates').select('*').eq('status', 'approved'),
      client.from('estimate_lines').select('*'),
      // The contract a claim is made against, and the approved variations that
      // can be claimed individually. Both are per-site (schema_v17).
      client.from('contracts').select('id, site_id, retention_pct, payment_terms_days'),
      client.from('change_orders').select('*').eq('status', 'approved'),
    ])
    const failed = [inv, il, ip, po, pl, ex, es, el].find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
    else setError(null)
    setRows((inv.data ?? []) as InvoiceRow[])
    setLines((il.data ?? []) as InvoiceLineRow[])
    setPayments((ip.data ?? []) as InvoicePaymentRow[])
    setPos((po.data ?? []) as PurchaseOrderRow[])
    setPoLines((pl.data ?? []) as PoLineRow[])
    setExpenses((ex.data ?? []) as ExpenseRow[])
    setEstimates((es.data ?? []) as EstimateRow[])
    setEstLines((el.data ?? []) as EstimateLineRow[])
    setContracts((ct.data ?? []) as ContractLite[])
    setVariations((vo.data ?? []) as ChangeOrderRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const siteName = useCallback(
    (id: string | null) => (id ? (sites.find((s) => s.id === id)?.name ?? 'Unassigned') : 'Unassigned'),
    [sites],
  )

  const counts = useMemo(() => {
    let draft = 0
    let sent = 0
    let overdue = 0
    for (const r of rows) {
      if (r.status === 'draft') draft++
      if (r.status === 'sent') sent++
      if (isOverdue(r, today)) overdue++
    }
    return { all: rows.length, draft, sent, overdue }
  }, [rows, today])

  const totals = useMemo(() => {
    let outstanding = 0
    let overdue = 0
    for (const r of rows) {
      if (r.status === 'draft' || r.status === 'void') continue
      outstanding += outstandingOf(r)
      if (isOverdue(r, today)) overdue += outstandingOf(r)
    }
    return { outstanding, overdue }
  }, [rows, today])

  /**
   * Retention held, per job. This is money the builder has earned and not
   * billed — it falls due at practical completion, and a builder who does not
   * track it simply never invoices for it. Drafts and voids are excluded:
   * nothing is being held back on a claim that was never issued.
   */
  const retention = useMemo(() => {
    const bySite = new Map<string, number>()
    let total = 0
    for (const r of rows) {
      if (r.status === 'draft' || r.status === 'void') continue
      const held = Number(r.retention_amount)
      if (held <= 0) continue
      const key = r.site_id ?? 'none'
      bySite.set(key, (bySite.get(key) ?? 0) + held)
      total += held
    }
    return {
      total,
      sites: [...bySite.entries()]
        .map(([id, amt]) => ({ id, name: siteName(id === 'none' ? null : id), amt }))
        .sort((a, b) => b.amt - a.amt),
    }
  }, [rows, siteName])

  /**
   * Four buckets rather than three: money that hasn't fallen due yet is not
   * a collection problem, and folding it into "1–30" would overstate the
   * pile the owner has to chase.
   */
  const aging = useMemo(() => {
    const b = [
      { label: 'Not yet due', amt: 0, fg: theme.inkSoft },
      { label: '1–30 days', amt: 0, fg: '#8A6100' },
      { label: '31–60 days', amt: 0, fg: '#C0621A' },
      { label: '60+ days', amt: 0, fg: theme.alert },
    ]
    for (const r of rows) {
      if (r.status !== 'sent') continue
      const out = outstandingOf(r)
      if (out <= 0) continue
      const d = daysPastDue(r.due_on, today)
      const i = d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : 3
      b[i]!.amt += out
    }
    const max = Math.max(...b.map((x) => x.amt), 1)
    return b.map((x) => ({ ...x, bar: `${Math.max(x.amt > 0 ? 8 : 2, (x.amt / max) * 100)}%` }))
  }, [rows, today])

  /**
   * Eight weeks forward. In is what clients owe and when. Out is what's been
   * committed to vendors on a PO that hasn't landed, plus expenses already
   * booked in the window.
   */
  const cashflow = useMemo(() => {
    const first = weekStart(today)
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const from = new Date(first)
      from.setDate(from.getDate() + i * 7)
      const to = new Date(from)
      to.setDate(to.getDate() + 7)
      return { from, to, in: 0, out: 0 }
    })
    const bucket = (iso: string | null) => {
      if (!iso) return -1
      const t = startOfDay(new Date(`${iso}T00:00:00`)).getTime()
      return weeks.findIndex((w) => t >= w.from.getTime() && t < w.to.getTime())
    }

    for (const r of rows) {
      if (r.status !== 'sent') continue
      const out = outstandingOf(r)
      if (out <= 0) continue
      // Anything already overdue is money we are waiting on now, not later.
      const i = daysPastDue(r.due_on, today) > 0 ? 0 : bucket(r.due_on)
      if (i >= 0) weeks[i]!.in += out
    }

    const owedOnPo = new Map<string, number>()
    for (const l of poLines) {
      const left = Math.max(0, Number(l.ordered_qty) - Number(l.received_qty)) * Number(l.unit_cost)
      if (left > 0) owedOnPo.set(l.po_id, (owedOnPo.get(l.po_id) ?? 0) + left)
    }
    for (const p of pos) {
      if (p.status !== 'sent' && p.status !== 'partially_received') continue
      const owed = owedOnPo.get(p.id)
      if (!owed) continue
      const i = bucket(p.expected_on)
      if (i >= 0) weeks[i]!.out += owed
    }
    for (const e of expenses) {
      const i = bucket(e.spent_on)
      if (i >= 0) weeks[i]!.out += Number(e.amount)
    }

    const max = Math.max(...weeks.flatMap((w) => [w.in, w.out]), 1)
    return weeks.map((w, i) => ({
      week: w.from.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }),
      in: w.in,
      out: w.out,
      inH: `${(w.in / max) * 100}%`,
      outH: `${(w.out / max) * 100}%`,
      negative: w.out > w.in,
      current: i === 0,
    }))
  }, [rows, pos, poLines, expenses, today])

  const firstNegative = useMemo(() => cashflow.find((c) => c.negative && c.out > 0), [cashflow])

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (filter === 'all') return true
      if (filter === 'overdue') return isOverdue(r, today)
      return r.status === filter
    })
  }, [rows, filter, today])

  const groups = useMemo(() => {
    if (grouping === 'date') {
      return [{ key: 'all', site: 'All invoices', color: theme.inkFaint, rows: visible, total: visible.reduce((s, r) => s + Number(r.amount), 0) }]
    }
    const map = new Map<string, { key: string; site: string; color: string; rows: InvoiceRow[]; total: number }>()
    for (const r of visible) {
      const key = r.site_id ?? 'none'
      let g = map.get(key)
      if (!g) {
        g = { key, site: siteName(r.site_id), color: r.site_id ? siteColor(r.site_id) : theme.inkFaint, rows: [], total: 0 }
        map.set(key, g)
      }
      g.rows.push(r)
      g.total += Number(r.amount)
    }
    return [...map.values()].sort((a, b) => a.site.localeCompare(b.site))
  }, [visible, grouping, siteName])

  const open = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId])

  const openPayments = useMemo(
    () => (open ? payments.filter((p) => p.invoice_id === open.id) : []),
    [payments, open],
  )

  /**
   * The claim breakdown. Contract value per cost code comes from the site's
   * approved estimate — the only place in the schema that says what a line
   * was sold for. Claimed-to-date counts every non-draft invoice on the site
   * issued before this one, so the "this claim" column is genuinely the
   * increment rather than the running total.
   */
  const claim = useMemo(() => {
    if (!open) return null
    const mine = lines.filter((l) => l.invoice_id === open.id)
    if (mine.length === 0) return null

    const estIds = new Set(estimates.filter((e) => e.site_id === open.site_id).map((e) => e.id))
    const contract = new Map<string, number>()
    for (const l of estLines) {
      if (!estIds.has(l.estimate_id)) continue
      const code = l.cost_code ?? '—'
      contract.set(code, (contract.get(code) ?? 0) + Number(l.line_total))
    }

    const priorIds = new Set(
      rows
        .filter(
          (r) =>
            r.site_id === open.site_id &&
            r.id !== open.id &&
            r.status !== 'draft' &&
            r.status !== 'void' &&
            r.issued_on <= open.issued_on,
        )
        .map((r) => r.id),
    )
    const toDate = new Map<string, number>()
    for (const l of lines) {
      if (!priorIds.has(l.invoice_id)) continue
      const code = l.cost_code ?? '—'
      toDate.set(code, (toDate.get(code) ?? 0) + Number(l.amount))
    }

    const out = mine.map((l) => {
      const code = l.cost_code ?? '—'
      return {
        id: l.id,
        code,
        name: l.description || costCodes.find((c) => c.code === code)?.name || '—',
        contract: contract.get(code) ?? null,
        pct: l.pct_complete === null ? null : Number(l.pct_complete),
        toDate: toDate.get(code) ?? 0,
        now: Number(l.amount),
      }
    })
    const sum = {
      contract: out.reduce((s, r) => s + (r.contract ?? 0), 0),
      toDate: out.reduce((s, r) => s + r.toDate, 0),
      now: out.reduce((s, r) => s + r.now, 0),
    }
    const pct = sum.contract > 0 ? ((sum.toDate + sum.now) / sum.contract) * 100 : null
    return { rows: out, sum, pct }
  }, [open, lines, rows, estimates, estLines])

  // ------------------------------------------------------------- mutations

  /**
   * Status moves that are a decision rather than a consequence: issuing a
   * draft, or voiding. 'paid' is deliberately not reachable here — it is
   * derived from the payment ledger by trigger, and setting it by hand would
   * be overwritten the next time a payment moved.
   */
  const setStatus = async (inv: InvoiceRow, status: 'draft' | 'sent' | 'void') => {
    if (!canEdit || busy) return
    setBusy(true)
    const { error: err } = await supabase().from('invoices').update({ status }).eq('id', inv.id)
    setBusy(false)
    if (err) setError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  /**
   * Record money arriving. Partial is the normal case — a client paying part
   * of a claim is not an edge case — so the amount is editable and only
   * defaults to what is outstanding. The trigger behind `invoice_payments`
   * moves paid_amount and status, so nothing here writes either.
   */
  const recordPayment = async (inv: InvoiceRow, p: PaymentDraft) => {
    if (!canEdit || busy) return
    const amount = Number(p.amount)
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Enter the amount that was received.')
      return
    }
    setBusy(true)
    const { error: err } = await supabase().from('invoice_payments').insert({
      company_id: inv.company_id,
      invoice_id: inv.id,
      amount,
      received_on: p.receivedOn,
      method: p.method,
      reference: p.reference.trim() || null,
      note: p.note.trim() || null,
      created_by: me.id,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setPayFor(null)
    await load()
    onChanged()
  }

  const removePayment = async (id: string) => {
    if (!canEdit || busy) return
    setBusy(true)
    const { error: err } = await supabase().from('invoice_payments').delete().eq('id', id)
    setBusy(false)
    if (err) setError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  /**
   * A draft has never been seen by the client, so it can be deleted outright.
   * Anything issued is voided instead — the number stays used, which is what
   * an auditor expects of an invoice sequence.
   */
  const deleteDraft = async (inv: InvoiceRow) => {
    if (!canEdit || busy || inv.status !== 'draft') return
    setBusy(true)
    const { error: err } = await supabase().from('invoices').delete().eq('id', inv.id)
    setBusy(false)
    if (err) setError(err.message)
    else {
      if (openId === inv.id) setOpenId(null)
      setConfirm(null)
      await load()
      onChanged()
    }
  }

  /**
   * There is no mail transport in this app, so this composes the reminder and
   * hands it to the owner's own mail client rather than claiming to have sent
   * anything. A button that silently sends nothing is worse than no button.
   */
  const sendReminders = () => {
    const late = rows.filter((r) => isOverdue(r, today))
    if (late.length === 0) return
    const lines = late.map(
      (r) =>
        `${r.invoice_no} — ${r.client_name || 'client'} — ${siteName(r.site_id)} — ${money(outstandingOf(r))} outstanding, due ${fmtDate(r.due_on)} (${daysPastDue(r.due_on, today)} days ago)`,
    )
    const body = [
      'The following invoices are past their due date:',
      '',
      ...lines,
      '',
      `Total outstanding on overdue invoices: ${money(totals.overdue)}`,
    ].join('\n')
    window.location.href = `mailto:?subject=${encodeURIComponent('Overdue invoices')}&body=${encodeURIComponent(body)}`
  }

  const startClaim = () => {
    const site = sites[0]
    // Retention and payment terms are contract terms, not app preferences. When
    // the job has a contract they come from it; the old hard-coded 5% and 14
    // days are only the fallback for a job that has none yet.
    const contract = site ? contracts.find((c) => c.site_id === site.id) : undefined
    const issued = new Date()
    const due = new Date()
    due.setDate(due.getDate() + (contract ? contract.payment_terms_days : 14))
    setForm({
      editingId: null,
      invoiceNo: suggestInvoiceNo(rows),
      siteId: site?.id ?? '',
      clientName: site?.clientName ?? '',
      period: '',
      issuedOn: issued.toISOString().slice(0, 10),
      dueOn: due.toISOString().slice(0, 10),
      retentionPct: contract ? String(Number(contract.retention_pct)) : '5',
      gstRate: '10',
      variationId: '',
      note: '',
      lines: [blankClaimLine()],
    })
  }

  /**
   * Reopen a draft. Only drafts: once a claim has been issued the client is
   * holding a copy, and quietly changing the amounts underneath it is how the
   * builder's records and the client's stop matching.
   */
  const editDraft = (inv: InvoiceRow) => {
    if (!canEdit || inv.status !== 'draft') return
    const mine = lines
      .filter((l) => l.invoice_id === inv.id)
      .map((l) => ({
        key: l.id,
        costCode: l.cost_code ?? '',
        description: l.description,
        pctComplete: l.pct_complete === null ? '' : String(Number(l.pct_complete)),
        amount: String(Number(l.amount)),
      }))
    setForm({
      editingId: inv.id,
      invoiceNo: inv.invoice_no,
      siteId: inv.site_id ?? '',
      clientName: inv.client_name,
      period: inv.period ?? '',
      issuedOn: inv.issued_on,
      dueOn: inv.due_on ?? '',
      retentionPct: String(Number(inv.retention_pct)),
      gstRate: String(Number(inv.tax_rate ?? 10)),
      variationId: inv.variation_id ?? '',
      note: inv.note ?? '',
      lines: mine.length > 0 ? mine : [blankClaimLine()],
    })
  }

  /**
   * Retention is money the client holds back until practical completion. It
   * comes off what is claimed now, so the invoice is raised net — billing the
   * gross and "remembering" the retention is how a builder ends up chasing an
   * amount the contract never entitled them to yet.
   */
  const claimGross = useMemo(
    () => (form ? form.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) : 0),
    [form],
  )
  const claimRetained = useMemo(
    () => (form ? round2(claimGross * ((Number(form.retentionPct) || 0) / 100)) : 0),
    [form, claimGross],
  )
  /** Value of work less retention, still excluding GST. */
  const claimNet = round2(claimGross - claimRetained)
  /**
   * GST, on the net. This is the order an Australian progress claim runs in:
   * value of work → less retention → net → plus GST → total payable. Charging
   * GST on the gross and then retaining would collect tax on money the contract
   * does not entitle them to yet.
   *
   * Before this, the app wrote no tax at all — schema_v15 added the columns and
   * nothing filled them, so every claim it produced was missing the one line
   * that makes a document a tax invoice.
   */
  const claimGst = useMemo(
    () => (form ? round2(claimNet * ((Number(form.gstRate) || 0) / 100)) : 0),
    [form, claimNet],
  )
  /** `invoices.amount` is GST inclusive and has been since schema_v4. */
  const claimTotal = round2(claimNet + claimGst)

  const saveClaim = async () => {
    if (!form || !canEdit || busy) return
    const usable = form.lines.filter((l) => l.description.trim() || Number(l.amount) > 0)
    if (!form.invoiceNo.trim()) {
      setError('Give the claim an invoice number.')
      return
    }
    setBusy(true)
    const client = supabase()
    const header = {
      site_id: form.siteId || null,
      // The claim goes ON the contract: one contract per site, so the link is
      // derived rather than asked for. A variation claim also names which
      // variation it bills, which is how the office answers "have we actually
      // invoiced VO-3".
      contract_id: (form.siteId && contracts.find((c) => c.site_id === form.siteId)?.id) || null,
      variation_id: form.variationId || null,
      invoice_no: form.invoiceNo.trim(),
      client_name: form.clientName.trim(),
      period: form.period.trim() || null,
      issued_on: form.issuedOn,
      due_on: form.dueOn || null,
      amount: claimTotal,
      tax_amount: claimGst,
      tax_rate: Number(form.gstRate) || 0,
      retention_pct: Number(form.retentionPct) || 0,
      retention_amount: claimRetained,
      note: form.note.trim() || null,
    }

    const { data, error: err } = form.editingId
      ? await client.from('invoices').update(header).eq('id', form.editingId).select().single()
      : await client
          .from('invoices')
          .insert({ ...header, company_id: me.company_id, paid_amount: 0, status: 'draft' })
          .select()
          .single()

    if (err) {
      setBusy(false)
      // invoice_no is unique per company; say so in words rather than leaking
      // the raw constraint name.
      setError(
        err.code === '23505'
          ? `Invoice ${form.invoiceNo.trim()} already exists. Pick another number.`
          : err.message,
      )
      return
    }

    const invoiceId = (data as InvoiceRow).id

    // Lines are replaced rather than diffed. A claim has a handful of them and
    // they are only editable while the invoice is a draft, so the simpler path
    // cannot lose anything a user would miss.
    if (form.editingId) {
      const { error: wipeErr } = await client.from('invoice_lines').delete().eq('invoice_id', invoiceId)
      if (wipeErr) {
        setBusy(false)
        setError(wipeErr.message)
        return
      }
    }

    if (usable.length > 0) {
      const { error: lineErr } = await client.from('invoice_lines').insert(
        usable.map((l, i) => ({
          invoice_id: invoiceId,
          cost_code: l.costCode || null,
          description: l.description.trim(),
          pct_complete: l.pctComplete === '' ? null : Number(l.pctComplete),
          amount: Number(l.amount) || 0,
          sort: i,
        })),
      )
      if (lineErr) setError(lineErr.message)
    }

    setBusy(false)
    setForm(null)
    setOpenId(invoiceId)
    await load()
    onChanged()
  }

  // ---------------------------------------------------------------- render

  const tabs: Array<{ key: Filter; label: string; n: number; alert?: boolean }> = [
    { key: 'all', label: 'All', n: counts.all },
    { key: 'draft', label: 'Draft', n: counts.draft },
    { key: 'sent', label: 'Sent', n: counts.sent },
    { key: 'overdue', label: 'Overdue', n: counts.overdue, alert: true },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg }}>
      <div style={toolbar}>
        <div style={segment}>
          {tabs.map((t, i) => {
            const on = filter === t.key
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                style={{
                  ...segmentCell,
                  borderLeft: i === 0 ? 'none' : `1px solid ${theme.border}`,
                  background: on ? theme.accentFill : theme.panel,
                  color: on ? theme.accent : t.alert && t.n > 0 ? theme.alertInk : theme.ink,
                  fontWeight: on || (t.alert && t.n > 0) ? 600 : 400,
                }}
              >
                {t.alert && t.n > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.alert }} />}
                {t.label} <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t.n}</span>
              </button>
            )
          })}
        </div>

        <div style={segment}>
          {([['site', 'By job site'], ['date', 'Newest first']] as const).map(([key, label], i) => {
            const on = grouping === key
            return (
              <button
                key={key}
                onClick={() => setGrouping(key)}
                style={{
                  ...segmentCell,
                  borderLeft: i === 0 ? 'none' : `1px solid ${theme.border}`,
                  background: on ? theme.accentFill : theme.panel,
                  color: on ? theme.accent : theme.ink,
                  fontWeight: on ? 600 : 400,
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 'none', width: 1, height: 20, background: theme.border, margin: '0 4px' }} />

        <span style={{ flex: 'none', fontSize: 12.5, color: theme.inkSoft, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          Outstanding {money(totals.outstanding)}
          {counts.overdue > 0 && ` · ${counts.overdue} overdue ${money(totals.overdue)}`}
        </span>

        <div style={{ flex: 1 }} />

        {loading && <span style={{ fontSize: 11.5, color: theme.inkFaint }}>Loading…</span>}
        {canEdit && counts.overdue > 0 && (
          <button onClick={sendReminders} style={ghost} title="Opens your mail client with the overdue invoices listed">
            Send reminders
          </button>
        )}
        {canEdit && (
          <button onClick={startClaim} style={cta}>
            NEW PROGRESS CLAIM
          </button>
        )}
      </div>

      {error && (
        <div style={errorBar}>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={dismiss}>
            Dismiss
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ ...card, flex: '1 1 300px', minWidth: 280, gap: 9, padding: '14px 15px' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Aging</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              {aging.map((a) => (
                <div key={a.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: a.fg, fontVariantNumeric: 'tabular-nums' }}>
                    {money(a.amt)}
                  </span>
                  <span style={{ display: 'block', height: 6, borderRadius: 3, background: a.fg, width: a.bar }} />
                  <span style={{ fontSize: 11, color: theme.inkFaint, whiteSpace: 'nowrap' }}>{a.label}</span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: theme.inkFaint }}>
              {aging[3]!.amt > 0
                ? `${money(aging[3]!.amt)} has been sitting past 60 days. That is the call to make this week.`
                : aging[1]!.amt + aging[2]!.amt > 0
                  ? 'Nothing past 60 days. Chase the 31–60 column before it ages further.'
                  : 'Nothing overdue. Every sent invoice is still inside its terms.'}
            </span>
          </div>

          <div style={{ ...card, flex: '1 1 460px', minWidth: 400, gap: 10, padding: '14px 15px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Cash in vs out — next 8 weeks</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={legendItem}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: theme.success }} />
                  In
                </span>
                <span style={legendItem}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: '#C9CED4' }} />
                  Out
                </span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 110 }}>
              {cashflow.map((c) => (
                <div
                  key={c.week}
                  title={`${c.week} — in ${money(c.in)}, out ${money(c.out)}`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, height: '100%', justifyContent: 'flex-end' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, width: '100%', height: 86, justifyContent: 'center' }}>
                    <span style={{ display: 'block', width: '42%', borderRadius: '2px 2px 0 0', background: theme.success, height: c.inH }} />
                    <span style={{ display: 'block', width: '42%', borderRadius: '2px 2px 0 0', background: '#C9CED4', height: c.outH }} />
                  </div>
                  <span
                    style={{
                      fontSize: 10.5,
                      color: c.current ? theme.ink : theme.inkFaint,
                      fontWeight: c.current ? 700 : 400,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.week}
                  </span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: theme.inkFaint }}>
              {firstNegative
                ? `Week of ${firstNegative.week} goes negative — ${money(firstNegative.out)} out against ${money(firstNegative.in)} in.`
                : 'No week in the window goes negative on what is currently committed.'}
            </span>
          </div>

          {retention.total > 0 && (
            <div style={{ ...card, flex: '1 1 240px', minWidth: 230, gap: 9, padding: '14px 15px' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Retention held</span>
              <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {money(retention.total)}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {retention.sites.slice(0, 4).map((s) => (
                  <span key={s.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
                    <span style={{ flex: 1, minWidth: 0, color: theme.inkMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(s.amt)}</span>
                  </span>
                ))}
              </div>
              <span style={{ fontSize: 11.5, lineHeight: 1.45, color: theme.inkFaint }}>
                Withheld from claims already issued. It falls due at practical completion — it will not
                be invoiced unless you raise it.
              </span>
            </div>
          )}
        </div>

        <div style={{ ...card, padding: 0, overflowX: 'auto', marginBottom: 14 }}>
          <div style={{ ...listHead, gridTemplateColumns: LIST_COLUMNS }}>
            <span style={th}>INVOICE</span>
            <span style={th}>CLIENT</span>
            <span style={th}>JOB SITE</span>
            <span style={th}>ISSUED</span>
            <span style={th}>DUE</span>
            <span style={{ ...th, textAlign: 'right' }}>AMOUNT</span>
            <span style={{ ...th, textAlign: 'right' }}>STATUS</span>
          </div>

          {groups.length === 0 && !loading && (
            <div style={{ padding: '28px 15px', textAlign: 'center', fontSize: 12.5, color: theme.inkFaint }}>
              {rows.length === 0
                ? 'No invoices yet. A progress claim bills the client for work already done and costed.'
                : 'Nothing matches this filter.'}
            </div>
          )}

          {groups.map((g) => (
            <Fragment key={g.key}>
              <div style={{ ...groupRow, minWidth: 995 }}>
                <span style={{ flex: 'none', width: 9, height: 9, borderRadius: 2, background: g.color }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{g.site}</span>
                <span style={{ fontSize: 11.5, color: theme.inkFaint, whiteSpace: 'nowrap' }}>
                  {g.rows.length} {g.rows.length === 1 ? 'invoice' : 'invoices'}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: theme.inkFaint, whiteSpace: 'nowrap' }}>Billed</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {money(g.total)}
                </span>
              </div>

              {g.rows.map((v) => {
                const over = isOverdue(v, today)
                const meta = over ? OVERDUE_META : STATUS_META[v.status]
                const past = daysPastDue(v.due_on, today)
                const owing = outstandingOf(v)
                return (
                  <div
                    key={v.id}
                    onClick={() => setOpenId(openId === v.id ? null : v.id)}
                    style={{
                      ...listRow,
                      gridTemplateColumns: LIST_COLUMNS,
                      background: openId === v.id ? theme.accentFill : theme.panel,
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.accent }}>{v.invoice_no}</span>
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{v.client_name || '—'}</span>
                      <span style={{ fontSize: 11.5, color: over ? theme.alertInk : theme.inkFaint }}>
                        {over
                          ? `${past} ${past === 1 ? 'day' : 'days'} overdue · ${money(owing)} owing`
                          : v.status === 'sent' && owing < Number(v.amount)
                            ? `Part paid · ${money(owing)} owing`
                            : (v.period ?? v.note ?? '—')}
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, color: theme.inkMid }}>{siteName(v.site_id)}</span>
                    <span style={{ fontSize: 12.5, color: theme.inkMid, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtDate(v.issued_on)}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: over ? theme.alertInk : theme.inkMid,
                        fontWeight: over ? 700 : 400,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtDate(v.due_on)}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {money(Number(v.amount))}
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                      {canEdit && v.status === 'draft' && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); editDraft(v) }} style={miniBtn}>
                            Edit
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); void setStatus(v, 'sent') }} style={miniBtn}>
                            Send
                          </button>
                        </>
                      )}
                      {canEdit && v.status === 'sent' && (
                        <button onClick={(e) => { e.stopPropagation(); setPayFor(v) }} style={miniBtn}>
                          Record payment
                        </button>
                      )}
                      <span style={{ ...chip, background: meta.bg, color: meta.fg }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.fg }} />
                        {meta.label}
                      </span>
                    </span>
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>

        {open && (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={claimHead}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>
                    {open.period ?? open.invoice_no} · {siteName(open.site_id)}
                  </span>
                  <span
                    style={{
                      ...chip,
                      gap: 0,
                      background: (isOverdue(open, today) ? OVERDUE_META : STATUS_META[open.status]).bg,
                      color: (isOverdue(open, today) ? OVERDUE_META : STATUS_META[open.status]).fg,
                    }}
                  >
                    {(isOverdue(open, today) ? OVERDUE_META : STATUS_META[open.status]).label}
                  </span>
                </span>
                <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                  Issued {fmtDate(open.issued_on)} · due {fmtDate(open.due_on)}
                  {claim ? ' · % complete drawn from the approved estimate for this job' : ''}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                {canEdit && open.status === 'draft' && (
                  <>
                    <button onClick={() => setConfirm({ inv: open, action: 'delete' })} style={ghost}>
                      Delete
                    </button>
                    <button onClick={() => editDraft(open)} style={ghost}>
                      Edit
                    </button>
                    <button onClick={() => void setStatus(open, 'sent')} style={{ ...cta, fontSize: 11.5, padding: '0 13px' }}>
                      ISSUE CLAIM · {money(Number(open.amount))}
                    </button>
                  </>
                )}
                {canEdit && (open.status === 'sent' || open.status === 'paid') && (
                  <>
                    <button onClick={() => setConfirm({ inv: open, action: 'void' })} style={ghost}>
                      Void
                    </button>
                    <button onClick={() => setPayFor(open)} style={{ ...cta, fontSize: 11.5, padding: '0 13px' }}>
                      RECORD PAYMENT
                    </button>
                  </>
                )}
              </div>
            </div>

            {claim && <div style={{ overflowX: 'auto' }}>
              <div style={{ ...listHead, minWidth: 820, gridTemplateColumns: CLAIM_COLUMNS, padding: '7px 15px' }}>
                <span style={th}>COST CODE</span>
                <span style={{ ...th, textAlign: 'right' }}>CONTRACT</span>
                <span style={{ ...th, textAlign: 'right' }}>% COMPLETE</span>
                <span style={th}>PROGRESS</span>
                <span style={{ ...th, textAlign: 'right' }}>CLAIMED TO DATE</span>
                <span style={{ ...th, textAlign: 'right' }}>THIS CLAIM</span>
              </div>

              {claim.rows.map((c) => (
                <div key={c.id} style={{ ...claimRow, gridTemplateColumns: CLAIM_COLUMNS }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: theme.inkFaint }}>{c.code}</span>
                    <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </span>
                  </span>
                  <span style={{ fontSize: 13, textAlign: 'right', color: theme.inkMid, fontVariantNumeric: 'tabular-nums' }}>
                    {c.contract === null || c.contract === 0 ? '—' : money(c.contract)}
                  </span>
                  <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {c.pct === null ? '—' : `${c.pct}%`}
                  </span>
                  <span>
                    <span style={{ display: 'block', height: 6, borderRadius: 3, background: theme.borderSoft, overflow: 'hidden' }}>
                      <span
                        style={{
                          display: 'block',
                          height: 6,
                          borderRadius: 3,
                          background: theme.accent,
                          width: `${Math.min(100, Math.max(0, c.pct ?? 0))}%`,
                        }}
                      />
                    </span>
                  </span>
                  <span style={{ fontSize: 13, textAlign: 'right', color: theme.inkMid, fontVariantNumeric: 'tabular-nums' }}>
                    {money(c.toDate)}
                  </span>
                  <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {money(c.now)}
                  </span>
                </div>
              ))}

              <div style={{ ...claimRow, gridTemplateColumns: CLAIM_COLUMNS, padding: '11px 15px', background: theme.rowFill, borderBottom: 'none' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Total</span>
                <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {claim.sum.contract > 0 ? money(claim.sum.contract) : '—'}
                </span>
                <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {claim.pct === null ? '—' : `${Math.round(claim.pct)}%`}
                </span>
                <span />
                <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {money(claim.sum.toDate)}
                </span>
                <span style={{ fontSize: 13.5, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {money(claim.sum.now)}
                </span>
              </div>
            </div>}

            {!claim && (
              <div style={{ padding: '16px 15px', fontSize: 12.5, color: theme.inkFaint, borderBottom: `1px solid ${theme.border}` }}>
                {open.invoice_no} has no line breakdown — it was billed as a single amount of{' '}
                {money(Number(open.amount))}.
              </div>
            )}

            <PaymentLedger
              invoice={open}
              payments={openPayments}
              canEdit={canEdit}
              busy={busy}
              onRemove={(id) => void removePayment(id)}
            />

            {open.note && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 15px', borderTop: `1px solid ${theme.border}` }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={theme.inkFaint} strokeWidth={1.4} style={{ flex: 'none' }}>
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 5.1v.01M8 7.3v3.5" strokeLinecap="round" strokeWidth={1.7} />
                </svg>
                <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, color: theme.inkSoft }}>{open.note}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {payFor && (
        <PaymentDialog
          invoice={payFor}
          outstanding={outstandingOf(payFor)}
          busy={busy}
          onCancel={() => setPayFor(null)}
          onSave={(p) => void recordPayment(payFor, p)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.action === 'delete' ? `Delete ${confirm.inv.invoice_no}?` : `Void ${confirm.inv.invoice_no}?`}
          body={
            confirm.action === 'delete'
              ? 'This draft has never been issued, so it can go entirely. The invoice number becomes free again.'
              : 'The invoice stays on the books at zero — the number is not reused, which is what an auditor expects of an invoice sequence. Any payments recorded against it are left alone.'
          }
          confirmLabel={confirm.action === 'delete' ? 'DELETE DRAFT' : 'VOID INVOICE'}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.action === 'delete') void deleteDraft(confirm.inv)
            else {
              void setStatus(confirm.inv, 'void')
              setConfirm(null)
            }
          }}
        />
      )}

      {form && (
        <ClaimEditor
          form={form}
          sites={sites}
          variations={variations}
          contracts={contracts}
          total={claimTotal}
          gross={claimGross}
          retained={claimRetained}
          net={claimNet}
          gst={claimGst}
          busy={busy}
          onChange={setForm}
          onCancel={() => setForm(null)}
          onSave={() => void saveClaim()}
        />
      )}
    </div>
  )
}

/**
 * What has been received against one invoice, and what is still held back.
 *
 * Shown even when nothing has been paid, because the two figures a builder
 * chases — outstanding, and retention that falls due at practical completion —
 * are the reason to open an invoice at all.
 */
function PaymentLedger({
  invoice,
  payments,
  canEdit,
  busy,
  onRemove,
}: {
  invoice: InvoiceRow
  payments: InvoicePaymentRow[]
  canEdit: boolean
  busy: boolean
  onRemove: (id: string) => void
}) {
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0)
  const owing = outstandingOf(invoice)
  const held = Number(invoice.retention_amount)

  return (
    <div style={{ borderTop: `1px solid ${theme.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '11px 15px', flexWrap: 'wrap' }}>
        <Stat label="Invoiced" value={money2(Number(invoice.amount))} />
        <Stat label="Received" value={money2(paid)} fg={paid > 0 ? theme.successInk : undefined} />
        <Stat
          label="Outstanding"
          value={money2(owing)}
          fg={owing > 0 ? (invoice.status === 'sent' ? theme.alertInk : theme.ink) : theme.successInk}
          strong
        />
        {held > 0 && (
          <Stat
            label={`Retention held (${Number(invoice.retention_pct)}%)`}
            value={money2(held)}
            hint="Falls due at practical completion"
          />
        )}
      </div>

      {payments.length > 0 && (
        <div style={{ borderTop: `1px solid ${theme.fill}` }}>
          {payments.map((p) => (
            <div
              key={p.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 15px', borderBottom: `1px solid ${theme.fill}` }}
            >
              <span style={{ fontSize: 12.5, color: theme.inkMid, width: 74, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
                {fmtDate(p.received_on)}
              </span>
              <span style={{ fontSize: 12.5, color: theme.inkMid, width: 96, flex: 'none' }}>
                {PAYMENT_METHODS.find(([k]) => k === p.method)?.[1] ?? p.method}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: theme.inkFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.reference ?? p.note ?? ''}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: Number(p.amount) < 0 ? theme.alertInk : theme.ink,
                }}
              >
                {money2(Number(p.amount))}
              </span>
              {canEdit && (
                <button
                  onClick={() => onRemove(p.id)}
                  disabled={busy}
                  title="Remove this payment"
                  style={{ ...ghost, height: 22, padding: '0 7px', fontSize: 11.5, flex: 'none' }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  fg,
  strong,
  hint,
}: {
  label: string
  value: string
  fg?: string
  strong?: boolean
  hint?: string
}) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }} title={hint}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: theme.inkSoft }}>
        {label.toUpperCase()}
      </span>
      <span style={{ fontSize: strong ? 15 : 13.5, fontWeight: strong ? 700 : 600, color: fg ?? theme.ink, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </span>
  )
}

function PaymentDialog({
  invoice,
  outstanding,
  busy,
  onCancel,
  onSave,
}: {
  invoice: InvoiceRow
  outstanding: number
  busy: boolean
  onCancel: () => void
  onSave: (p: PaymentDraft) => void
}) {
  const [draft, setDraft] = useState<PaymentDraft>({
    // Defaults to what is owing, but stays editable — part payment is the
    // ordinary case on a progress claim.
    amount: outstanding > 0 ? String(outstanding) : '',
    receivedOn: new Date().toISOString().slice(0, 10),
    method: 'bank',
    reference: '',
    note: '',
  })
  const set = <K extends keyof PaymentDraft>(k: K, v: PaymentDraft[K]) => setDraft({ ...draft, [k]: v })

  const amount = Number(draft.amount) || 0
  const left = outstanding - amount

  return (
    <div style={scrim} onClick={onCancel}>
      <div style={{ ...modal, width: 'min(520px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Record a payment</span>
          <span style={{ fontSize: 12, color: theme.inkFaint }}>
            {invoice.invoice_no} · {money2(outstanding)} outstanding
          </span>
        </div>

        <div style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Field label="Amount received">
              <input
                value={draft.amount}
                onChange={(e) => set('amount', e.target.value)}
                inputMode="decimal"
                autoFocus
                style={{ ...input, width: 130, textAlign: 'right', fontWeight: 600 }}
              />
            </Field>
            <Field label="Received on">
              <input type="date" value={draft.receivedOn} onChange={(e) => set('receivedOn', e.target.value)} style={input} />
            </Field>
            <Field label="Method" grow>
              <select
                value={draft.method}
                onChange={(e) => set('method', e.target.value as InvoicePaymentRow['method'])}
                style={input}
              >
                {PAYMENT_METHODS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Reference">
            <input
              value={draft.reference}
              onChange={(e) => set('reference', e.target.value)}
              placeholder="What appears on the bank statement"
              style={input}
            />
          </Field>

          <span style={{ fontSize: 12, lineHeight: 1.5, color: left > 0.005 ? theme.inkSoft : theme.successInk }}>
            {amount === 0
              ? 'Enter the amount that landed.'
              : left > 0.005
                ? `Leaves ${money2(left)} outstanding — the invoice stays open.`
                : left < -0.005
                  ? `That is ${money2(-left)} more than owing. The invoice will be marked paid and the excess sits as a credit.`
                  : 'Settles the invoice in full — it will be marked paid.'}
          </span>
        </div>

        <div style={modalFoot}>
          <button onClick={onCancel} style={ghost}>
            Cancel
          </button>
          <button onClick={() => onSave(draft)} disabled={busy} style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'SAVING…' : 'RECORD PAYMENT'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div style={scrim} onClick={onCancel}>
      <div style={{ ...modal, width: 'min(430px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        </div>
        <div style={{ padding: '13px 15px', fontSize: 12.5, lineHeight: 1.55, color: theme.inkSoft }}>{body}</div>
        <div style={modalFoot}>
          <button onClick={onCancel} style={ghost}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'WORKING…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ClaimEditor({
  form,
  sites,
  variations,
  contracts,
  total,
  gross,
  retained,
  net,
  gst,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  form: ClaimForm
  sites: JobSite[]
  variations: ChangeOrderRow[]
  contracts: ContractLite[]
  total: number
  gross: number
  retained: number
  net: number
  gst: number
  busy: boolean
  onChange: (f: ClaimForm) => void
  onCancel: () => void
  onSave: () => void
}) {
  // Only variations already approved on this job can be claimed: an unapproved
  // one adds nothing to the contract sum, so billing it is exactly the thing a
  // builder disputes.
  const claimable = variations.filter((v) => v.site_id === form.siteId)
  const set = <K extends keyof ClaimForm>(k: K, v: ClaimForm[K]) => onChange({ ...form, [k]: v })
  const setLine = (key: string, patch: Partial<ClaimLineDraft>) =>
    onChange({ ...form, lines: form.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })

  return (
    <div style={scrim} onClick={onCancel}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            {form.editingId ? `Edit ${form.invoiceNo}` : 'New progress claim'}
          </span>
          <span style={{ fontSize: 12, color: theme.inkFaint }}>
            {form.editingId
              ? 'Still a draft — nothing has been sent to the client.'
              : 'Saved as a draft — nothing is sent yet.'}
          </span>
        </div>

        <div style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 11, overflow: 'auto' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Field label="Invoice no">
              <input value={form.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value)} style={input} />
            </Field>
            <Field label="Job site" grow>
              <select
                value={form.siteId}
                onChange={(e) => {
                  const id = e.target.value
                  const s = sites.find((x) => x.id === id)
                  const c = contracts.find((x) => x.site_id === id)
                  // Retention follows the new job's contract, and the variation
                  // is cleared outright — one raised on the old job is not a
                  // thing this claim can bill.
                  onChange({
                    ...form,
                    siteId: id,
                    clientName: s?.clientName ?? form.clientName,
                    retentionPct: c ? String(Number(c.retention_pct)) : form.retentionPct,
                    variationId: '',
                  })
                }}
                style={input}
              >
                <option value="">Unassigned</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Client" grow>
              <input value={form.clientName} onChange={(e) => set('clientName', e.target.value)} style={input} />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Field label="Period" grow>
              <input
                value={form.period}
                onChange={(e) => set('period', e.target.value)}
                placeholder="Progress claim 3 — Aug"
                style={input}
              />
            </Field>
            <Field label="Issued">
              <input type="date" value={form.issuedOn} onChange={(e) => set('issuedOn', e.target.value)} style={input} />
            </Field>
            <Field label="Due">
              <input type="date" value={form.dueOn} onChange={(e) => set('dueOn', e.target.value)} style={input} />
            </Field>
            <Field label="Retention %">
              <input
                value={form.retentionPct}
                onChange={(e) => set('retentionPct', e.target.value)}
                inputMode="decimal"
                style={{ ...input, width: 78, textAlign: 'right' }}
              />
            </Field>
            <Field label="GST %">
              <input
                value={form.gstRate}
                onChange={(e) => set('gstRate', e.target.value)}
                inputMode="decimal"
                style={{ ...input, width: 78, textAlign: 'right' }}
              />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Field label="Claims" grow>
              <select value={form.variationId} onChange={(e) => set('variationId', e.target.value)} style={input}>
                <option value="">The contract — progress claim</option>
                {claimable.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.co_no} — {v.description} ({money2(Number(v.cost_impact))})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                Claim lines <span style={{ fontWeight: 400, color: theme.inkFaint }}>· amounts ex GST</span>
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 11.5, color: theme.inkFaint, fontVariantNumeric: 'tabular-nums' }}>
                  {retained > 0 ? `${money2(gross)} less ${money2(retained)} retention = ` : ''}
                  {money2(net)} ex GST
                  {gst > 0 ? ` + ${money2(gst)} GST` : ''}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {money2(total)} inc GST
                </span>
              </span>
            </div>

            {form.lines.map((l) => (
              <div key={l.key} style={{ display: 'flex', gap: 8, marginBottom: 7, alignItems: 'center' }}>
                <select value={l.costCode} onChange={(e) => setLine(l.key, { costCode: e.target.value })} style={{ ...input, flex: '0 0 150px' }}>
                  <option value="">No cost code</option>
                  {costCodes.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} {c.name}
                    </option>
                  ))}
                </select>
                <input
                  value={l.description}
                  onChange={(e) => setLine(l.key, { description: e.target.value })}
                  placeholder="Description"
                  style={{ ...input, flex: 1 }}
                />
                <input
                  value={l.pctComplete}
                  onChange={(e) => setLine(l.key, { pctComplete: e.target.value })}
                  placeholder="%"
                  inputMode="decimal"
                  style={{ ...input, flex: '0 0 64px', textAlign: 'right' }}
                />
                <input
                  value={l.amount}
                  onChange={(e) => setLine(l.key, { amount: e.target.value })}
                  placeholder="Amount"
                  inputMode="decimal"
                  style={{ ...input, flex: '0 0 106px', textAlign: 'right' }}
                />
                <button
                  onClick={() => onChange({ ...form, lines: form.lines.filter((x) => x.key !== l.key) })}
                  disabled={form.lines.length === 1}
                  style={{ ...ghost, flex: 'none', opacity: form.lines.length === 1 ? 0.4 : 1 }}
                >
                  ×
                </button>
              </div>
            ))}

            <button onClick={() => onChange({ ...form, lines: [...form.lines, blankClaimLine()] })} style={linkBtn}>
              + Add line
            </button>
          </div>

          <Field label="Note">
            <input value={form.note} onChange={(e) => set('note', e.target.value)} style={input} />
          </Field>
        </div>

        <div style={modalFoot}>
          <button onClick={onCancel} style={ghost}>
            Cancel
          </button>
          <button onClick={onSave} disabled={busy} style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'SAVING…' : form.editingId ? 'SAVE CHANGES' : 'SAVE DRAFT'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: grow ? '1 1 160px' : 'none' }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: theme.inkSoft }}>
        {label.toUpperCase()}
      </span>
      {children}
    </label>
  )
}

// ------------------------------------------------------------------ styles

const toolbar = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 40,
  padding: '0 12px',
  background: theme.panel,
  borderBottom: `1px solid ${theme.border}`,
  overflowX: 'auto',
} as const

const segment = {
  flex: 'none',
  display: 'flex',
  height: 27,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  overflow: 'hidden',
} as const

const segmentCell = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '0 11px',
  border: 'none',
  font: 'inherit',
  fontSize: 12.5,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const cta = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  height: 29,
  padding: '0 14px',
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: theme.ink,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const ghost = {
  display: 'flex',
  alignItems: 'center',
  height: 27,
  padding: '0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const miniBtn = {
  ...ghost,
  height: 22,
  padding: '0 8px',
  fontSize: 11.5,
} as const

const linkBtn = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 12.5,
  color: theme.accent,
  cursor: 'pointer',
} as const

const card = {
  display: 'flex',
  flexDirection: 'column',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const listHead = {
  display: 'grid',
  columnGap: 10,
  padding: '7px 14px',
  background: theme.rowFill,
  borderBottom: `1px solid ${theme.border}`,
  minWidth: 995,
} as const

const th = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  color: theme.inkSoft,
} as const

const groupRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 14px',
  background: '#F7F9FB',
  borderBottom: `1px solid ${theme.borderSoft}`,
} as const

const listRow = {
  display: 'grid',
  columnGap: 10,
  alignItems: 'center',
  padding: '9px 14px',
  borderBottom: `1px solid ${theme.fill}`,
  cursor: 'pointer',
  minWidth: 995,
} as const

const claimHead = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 14,
  padding: '13px 15px',
  borderBottom: `1px solid ${theme.border}`,
  flexWrap: 'wrap',
} as const

const claimRow = {
  display: 'grid',
  columnGap: 10,
  alignItems: 'center',
  padding: '9px 15px',
  borderBottom: `1px solid ${theme.fill}`,
  minWidth: 820,
} as const

const chip = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 9px',
  borderRadius: 11,
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: 'nowrap',
} as const

const legendItem = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 11.5,
  color: theme.inkMid,
} as const

const errorBar = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 14px',
  background: theme.alertFill,
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 12,
  color: theme.alertInk,
} as const

const dismiss = {
  border: 'none',
  background: 'none',
  font: 'inherit',
  fontSize: 12,
  color: theme.alertInk,
  textDecoration: 'underline',
  cursor: 'pointer',
} as const

const scrim = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(26,29,33,.34)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  zIndex: 40,
} as const

const modal = {
  display: 'flex',
  flexDirection: 'column',
  width: 'min(860px, 100%)',
  maxHeight: '100%',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  overflow: 'hidden',
} as const

const modalHead = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  padding: '12px 15px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const modalFoot = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '11px 15px',
  borderTop: `1px solid ${theme.border}`,
} as const

const input = {
  height: 28,
  padding: '0 8px',
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  background: theme.panel,
  font: 'inherit',
  fontSize: 12.5,
  color: theme.ink,
  outline: 'none',
} as const
