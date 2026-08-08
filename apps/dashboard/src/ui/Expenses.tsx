import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  supabase,
  type ExpenseRow,
  type PurchaseOrderRow,
  type WorkerRow,
} from '../data/supabase'
import { BUCKET_RECEIPTS, objectPath, signedUrl, uploadFile } from '../data/storage'
import { costCodes } from '../data/seed'
import { money, money2 } from '../format'
import { InvoiceDrop } from './InvoiceDrop'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Expense ledger, laid out to match design/screens/isExpenses.html exactly.
 *
 * Real-data notes for anyone comparing this against the mock:
 *  - The mock's "Invoice inbox" shows invoices with no job yet, waiting to be
 *    "allocated" (a job + cost code assigned). expenses.site_id is nullable for
 *    exactly this reason, so the inbox here is simply `rows.filter(r => !r.site_id)`
 *    — a real, schema-backed queue, not illustrative data.
 *  - The mock's allocate panel also offers "Billable to client", "Split across
 *    jobs" and a PO link. There is no schema for any of the three (no billable
 *    flag, no split, no purchase_orders linkage on expenses), so they are left
 *    out rather than wired to nothing — everything shown here does something.
 *  - The mock's per-field AI confidence chips imply per-field confidence; we only
 *    persist one overall ai_confidence per expense, so that single real number is
 *    shown against every extracted field rather than inventing per-field figures.
 *  - The receipt "printed on paper" mock in the AI-read panel is replaced with the
 *    actual uploaded photo (signed URL, private bucket) — a real asset beats a
 *    redrawn one.
 *  - "78% of estimated hours used" has no backing data anywhere in the schema
 *    (no estimated-hours field on job_sites), so that clause is dropped; the
 *    count of expenses still awaiting review fills the same spot instead.
 *  - The bottom "How the receipt gets there" section binds to no data at all in
 *    the mock (no {{ }} in it besides the AI-badge flag) — it is static product
 *    copy there too, so it is reproduced as static copy here.
 */

const CATEGORIES = ['Materials', 'Subcontractor', 'Equipment Rental', 'Permits', 'Fuel', 'Other']

const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const GRID_COLS = '88px 1fr 148px 128px 106px 56px 78px 128px'
const TABLE_MIN_W = 1080

// Colours lifted verbatim from isExpenses.html that have no equivalent in theme.ts —
// theme.ts only covers the small set every screen shares.
const FAINT = '#8B9096'
const BODY = '#4A5057'
const HEAD = '#696D74'
const SUBTLE_BG = '#FAFBFC'
const HAIRLINE = '#F1F3F5'
const AMBER_BG = '#FFF6DE'
const AMBER_FG = '#8A6100'
const HATCH = 'repeating-linear-gradient(135deg,#E4E7EA 0 4px,#DADEE2 4px 8px)'

const STATUS_META: Record<ExpenseRow['status'], { label: string; color: string; bg: string }> = {
  confirmed: { label: 'Confirmed', color: '#1B7A2C', bg: '#EAF7EE' },
  needs_review: { label: 'Needs review', color: AMBER_FG, bg: AMBER_BG },
  flagged: { label: 'Flagged', color: theme.alert, bg: '#FCE8EA' },
}

interface QuickAddState {
  siteId: string
  vendor: string
  spentOn: string
  amount: string
  tax: string
  category: string
  costCode: string
  receiptPath: string | null
}

const blankQuickAdd = (siteId: string): QuickAddState => ({
  siteId,
  vendor: '',
  spentOn: new Date().toISOString().slice(0, 10),
  amount: '',
  tax: '',
  category: '',
  costCode: '',
  receiptPath: null,
})

interface CodingDraft {
  siteId: string
  category: string
  costCode: string
  /** The order this receipt settles, so a PO shows what has actually landed. */
  poId: string
}

export function Expenses({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Drives the budget card, the category breakdown and the ledger filter — one
  // control, matching the single `site.name` the mock scopes all three to.
  const [siteId, setSiteId] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [receiptUrls, setReceiptUrls] = useState<Map<string, string>>(new Map())

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<CodingDraft | null>(null)

  const [inboxSelected, setInboxSelected] = useState<string | null>(null)
  const [allocateDraft, setAllocateDraft] = useState<CodingDraft | null>(null)
  const [allocateBusy, setAllocateBusy] = useState(false)
  const [allocateError, setAllocateError] = useState<string | null>(null)

  const [openPos, setOpenPos] = useState<PurchaseOrderRow[]>([])
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null)
  const [quickAddBusy, setQuickAddBusy] = useState(false)
  const [quickAddError, setQuickAddError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()
    const [exp, pos] = await Promise.all([
      client.from('expenses').select('*').order('spent_on', { ascending: false }),
      // Only orders still expecting delivery can sensibly take a receipt.
      client.from('purchase_orders').select('*').in('status', ['sent', 'partially_received']),
    ])
    if (exp.error) {
      setError(exp.error.message)
      setLoading(false)
      return
    }
    setRows((exp.data ?? []) as ExpenseRow[])
    setOpenPos((pos.data ?? []) as PurchaseOrderRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Default to the first site once sites arrive — there is no "current site"
  // concept passed in, so this screen owns the picker (folded into the budget
  // card's subtitle, where the mock shows the site name as plain text).
  useEffect(() => {
    if (!siteId && sites.length) setSiteId(sites[0].id)
  }, [siteId, sites])

  useEffect(() => {
    if (!expandedId) return
    const row = rows.find((r) => r.id === expandedId)
    if (!row?.receipt_path || receiptUrls.has(row.id)) return
    let cancelled = false
    void signedUrl(BUCKET_RECEIPTS, row.receipt_path).then((url) => {
      if (!cancelled && url) setReceiptUrls((prev) => new Map(prev).set(row.id, url))
    })
    return () => {
      cancelled = true
    }
  }, [expandedId, rows, receiptUrls])

  const site = sites.find((s) => s.id === siteId) ?? null
  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? '—'
  const workerName = (id: string | null) => workers.find((w) => w.id === id)?.name ?? 'Unknown'
  const workerInitials = (id: string | null) => workers.find((w) => w.id === id)?.initials ?? '?'

  const isDuplicate = (row: ExpenseRow) => {
    const t = new Date(row.spent_on).getTime()
    return rows.some(
      (o) =>
        o.id !== row.id &&
        Number(o.amount) === Number(row.amount) &&
        o.vendor.trim().toLowerCase() === row.vendor.trim().toLowerCase() &&
        Math.abs(new Date(o.spent_on).getTime() - t) <= DUPLICATE_WINDOW_MS,
    )
  }

  const siteRows = useMemo(() => rows.filter((r) => r.site_id === siteId), [rows, siteId])

  const presentCategories = useMemo(() => {
    const set = new Set<string>()
    for (const r of siteRows) set.add(r.category || 'Uncategorized')
    return [...set].sort()
  }, [siteRows])

  const categoryFiltered = useMemo(
    () =>
      categoryFilter === 'all'
        ? siteRows
        : siteRows.filter((r) => (r.category || 'Uncategorized') === categoryFilter),
    [siteRows, categoryFilter],
  )

  const spendToDate = useMemo(
    // `amount` is the invoice total and `tax` is the GST INSIDE it — that is
    // what api/parse-receipt.ts is told to extract and what InvoiceDrop writes.
    // Adding them double-counted the GST, so this screen read ~9% high while
    // Materials and the job folder — which use `amount` alone — read correctly.
    () => siteRows.reduce((sum, r) => sum + Number(r.amount), 0),
    [siteRows],
  )
  const budget = site?.budget ?? null
  const remaining = budget === null ? null : budget - spendToDate
  const pct = budget !== null && budget > 0 ? (spendToDate / budget) * 100 : null
  const needsReviewCount = useMemo(
    () => siteRows.filter((r) => r.status === 'needs_review').length,
    [siteRows],
  )

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of siteRows) {
      const cat = r.category || 'Uncategorized'
      map.set(cat, (map.get(cat) ?? 0) + Number(r.amount))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [siteRows])
  const maxCategory = categoryTotals[0]?.[1] ?? 0

  // Real analogue of the mock's "Invoice inbox" — captured but never costed to a
  // job, i.e. site_id is null. Company-wide, not filtered by the picker above,
  // since by definition these have no site yet.
  const inboxRows = useMemo(
    () =>
      rows
        .filter((r) => !r.site_id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [rows],
  )

  const shownTotal = useMemo(
    () => categoryFiltered.reduce((sum, r) => sum + Number(r.amount), 0),
    [categoryFiltered],
  )

  async function setStatus(id: string, status: ExpenseRow['status']) {
    const { error: err } = await supabase().from('expenses').update({ status }).eq('id', id)
    if (err) setError(err.message)
    else await load()
  }

  function startEdit(row: ExpenseRow) {
    setEditingId(row.id)
    setEditDraft({
      category: row.category ?? '',
      costCode: row.cost_code ?? '',
      siteId: row.site_id ?? '',
      poId: row.po_id ?? '',
    })
  }
  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
  }
  async function saveEdit(id: string) {
    if (!editDraft) return
    const { error: err } = await supabase()
      .from('expenses')
      .update({
        category: editDraft.category || null,
        cost_code: editDraft.costCode.trim() || null,
        site_id: editDraft.siteId || null,
      })
      .eq('id', id)
    if (err) {
      setError(err.message)
      return
    }
    cancelEdit()
    await load()
    onChanged()
  }

  function openAllocate(row: ExpenseRow) {
    setInboxSelected(row.id)
    setAllocateDraft({
      siteId: siteId || '',
      category: row.category ?? '',
      costCode: row.cost_code ?? '',
      poId: row.po_id ?? '',
    })
    setAllocateError(null)
  }
  function closeAllocate() {
    setInboxSelected(null)
    setAllocateDraft(null)
    setAllocateError(null)
  }
  async function allocate(row: ExpenseRow) {
    if (!allocateDraft?.siteId) {
      setAllocateError('Pick a job site first — that is what "allocate" means here.')
      return
    }
    setAllocateBusy(true)
    const { error: err } = await supabase()
      .from('expenses')
      .update({
        site_id: allocateDraft.siteId,
        category: allocateDraft.category || null,
        cost_code: allocateDraft.costCode.trim() || null,
        po_id: allocateDraft.poId || null,
      })
      .eq('id', row.id)
    setAllocateBusy(false)
    if (err) {
      setAllocateError(err.message)
      return
    }
    closeAllocate()
    await load()
    onChanged()
  }

  async function onQuickAddFile(file: File) {
    if (!quickAdd) return
    try {
      const path = objectPath(me.company_id, quickAdd.siteId || 'unassigned', file.name)
      await uploadFile(BUCKET_RECEIPTS, path, file, file.type)
      setQuickAdd((f) => (f ? { ...f, receiptPath: path } : f))
    } catch (err) {
      setQuickAddError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  async function saveQuickAdd() {
    if (!quickAdd) return
    if (!quickAdd.vendor.trim() || !quickAdd.spentOn || !quickAdd.amount) {
      setQuickAddError('Vendor, date, and amount are required.')
      return
    }
    setQuickAddBusy(true)
    setQuickAddError(null)
    const { error: err } = await supabase()
      .from('expenses')
      .insert({
        company_id: me.company_id,
        site_id: quickAdd.siteId || null,
        submitted_by: me.id,
        vendor: quickAdd.vendor.trim(),
        spent_on: quickAdd.spentOn,
        amount: Number(quickAdd.amount) || 0,
        tax: Number(quickAdd.tax) || 0,
        category: quickAdd.category || null,
        cost_code: quickAdd.costCode.trim() || null,
        receipt_path: quickAdd.receiptPath,
        // Manual entry has no AI guess to double-check, so it can post confirmed —
        // unlike InvoiceDrop's rows, which always start needs_review.
        status: 'confirmed',
        ai_note: null,
        ai_confidence: null,
        line_items: [],
      })
    setQuickAddBusy(false)
    if (err) {
      setQuickAddError(err.message)
      return
    }
    setQuickAdd(null)
    await load()
    onChanged()
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: '16px 18px 40px' }}>
        {error && <div style={{ marginBottom: 10, fontSize: 12.5, color: theme.alert }}>{error}</div>}

        {site ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 14 }}>
            <div
              style={{
                flex: '1 1 380px', minWidth: 340, display: 'flex', flexDirection: 'column', gap: 9,
                padding: '14px 15px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Spend against budget</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, fontSize: 12, color: FAINT }}>
                  <select
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    aria-label="Job site"
                    style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: 12, color: FAINT, cursor: 'pointer' }}
                  >
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  · all categories
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22, flexWrap: 'wrap', rowGap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={statMicroLabel}>SPEND TO DATE</span>
                  <span style={{ fontSize: 25, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {money(spendToDate)}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={statMicroLabel}>BUDGET</span>
                  <span style={{ fontSize: 25, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1, color: HEAD, fontVariantNumeric: 'tabular-nums' }}>
                    {budget === null ? '—' : money(budget)}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={statMicroLabel}>REMAINING</span>
                  <span
                    style={{
                      fontSize: 25, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                      color: remaining !== null && remaining < 0 ? theme.alert : theme.ink,
                    }}
                  >
                    {remaining === null ? '—' : money(remaining)}
                  </span>
                </div>
              </div>
              <span style={{ display: 'block', width: '100%', height: 7, borderRadius: 4, background: '#EDEFF1', overflow: 'hidden' }}>
                <span
                  style={{
                    display: 'block', height: 7, borderRadius: 4,
                    width: `${pct === null ? 0 : Math.min(100, Math.max(0, pct))}%`,
                    background: pct !== null && pct > 100 ? theme.alert : theme.accent,
                  }}
                />
              </span>
              <span style={{ fontSize: 11.5, color: FAINT }}>
                {budget === null
                  ? 'No budget set for this job.'
                  : `${Math.round(pct ?? 0)}% of budget spent${
                      needsReviewCount > 0
                        ? ` · ${needsReviewCount} expense${needsReviewCount === 1 ? '' : 's'} awaiting review`
                        : ''
                    }`}
              </span>
            </div>

            <div
              style={{
                flex: '1 1 380px', minWidth: 340, display: 'flex', flexDirection: 'column', gap: 10,
                padding: '14px 15px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600 }}>By category</span>
              {categoryTotals.length === 0 && (
                <span style={{ fontSize: 12.5, color: FAINT }}>No spend recorded for this job yet.</span>
              )}
              {categoryTotals.map(([cat, amt]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span style={{ flex: 'none', width: 118, fontSize: 12.5, color: BODY }}>{cat}</span>
                  <span style={{ flex: 1, display: 'block', height: 9, borderRadius: 2, background: '#F1F3F5', overflow: 'hidden' }}>
                    <span
                      style={{
                        display: 'block', height: 9, borderRadius: 2,
                        width: `${maxCategory ? (amt / maxCategory) * 100 : 0}%`, background: theme.accent,
                      }}
                    />
                  </span>
                  <span style={{ flex: 'none', width: 74, textAlign: 'right', fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {money2(amt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14, fontSize: 13, color: FAINT }}>
            Add a job site to start tracking spend against a budget.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 14px', borderBottom: `1px solid ${theme.border}`, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Invoice inbox</span>
              <span style={pillAmber}>{inboxRows.length} waiting to be allocated</span>
            </span>
            <span style={{ fontSize: 12, color: FAINT }}>
              Originals kept for 7 years · every allocation is logged with who and when
            </span>
          </div>

          <div style={{ display: 'flex', gap: 14, padding: 14, flexWrap: 'wrap' }}>
            {me.is_office && (
              <InvoiceDrop
                me={me}
                sites={sites}
                defaultSiteId={siteId}
                onSaved={() => {
                  void load()
                  onChanged()
                }}
              />
            )}

            <div style={{ flex: '1 1 420px', minWidth: 360, display: 'flex', flexDirection: 'column', border: `1px solid ${theme.border}`, borderRadius: 6, overflow: 'hidden' }}>
              {inboxRows.length === 0 && (
                <div style={{ padding: '18px 12px', fontSize: 12.5, color: FAINT, textAlign: 'center' }}>
                  Nothing waiting — every captured invoice already has a job.
                </div>
              )}
              {inboxRows.map((row) => {
                const selected = inboxSelected === row.id
                const status = STATUS_META[row.status]
                const amt = money2(Number(row.amount))
                return (
                  <Fragment key={row.id}>
                    <div
                      onClick={() => {
                        if (!me.is_office) return
                        selected ? closeAllocate() : openAllocate(row)
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px',
                        borderBottom: `1px solid ${HAIRLINE}`, background: selected ? SUBTLE_BG : '#fff',
                        cursor: me.is_office ? 'pointer' : 'default',
                      }}
                    >
                      <span style={{ flex: 'none', width: 32, height: 38, borderRadius: 3, border: `1px solid ${theme.border}`, background: HATCH }} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.vendor || 'Unknown supplier'}
                        </span>
                        <span style={{ fontSize: 11.5, color: FAINT }}>
                          Added by {workerName(row.submitted_by)} · {new Date(row.created_at).toLocaleDateString('en-AU')}
                        </span>
                      </div>
                      <span style={{ flex: 'none', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {amt}
                      </span>
                      <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 11, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', background: status.bg, color: status.color }}>
                        {status.label}
                      </span>
                    </div>

                    {selected && allocateDraft && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: '13px 12px', background: SUBTLE_BG }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: HEAD, whiteSpace: 'nowrap' }}>
                            ALLOCATE — {(row.vendor || 'UNKNOWN SUPPLIER').toUpperCase()} · {amt}
                          </span>
                          <span style={{ flex: 1, height: 1, background: theme.border }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 9 }}>
                          <CodingField
                            label="JOB SITE"
                            value={allocateDraft.siteId}
                            onChange={(v) => setAllocateDraft((d) => (d ? { ...d, siteId: v } : d))}
                            options={sites.map((s) => ({ value: s.id, label: s.name }))}
                            placeholder="Choose a job…"
                            edge={!allocateDraft.siteId ? theme.alert : undefined}
                            note={!allocateDraft.siteId ? 'Required to allocate' : undefined}
                          />
                          <CodingField
                            label="CATEGORY"
                            value={allocateDraft.category}
                            onChange={(v) => setAllocateDraft((d) => (d ? { ...d, category: v } : d))}
                            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                            placeholder="—"
                          />
                          <CodingField
                            label="COST CODE"
                            value={allocateDraft.costCode}
                            onChange={(v) => setAllocateDraft((d) => (d ? { ...d, costCode: v } : d))}
                            options={costCodes.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
                            placeholder="Uncoded"
                          />
                          <CodingField
                            label="AGAINST PO"
                            value={allocateDraft.poId}
                            onChange={(v) => setAllocateDraft((d) => (d ? { ...d, poId: v } : d))}
                            options={openPos
                              .filter((p) => !allocateDraft.siteId || p.site_id === allocateDraft.siteId)
                              .map((p) => ({ value: p.id, label: `${p.po_no} · ${p.vendor}` }))}
                            placeholder="No PO"
                          />
                        </div>
                        {allocateError && <span style={{ fontSize: 12, color: theme.alert }}>{allocateError}</span>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', paddingTop: 2 }}>
                          <div style={{ flex: 1 }} />
                          <button onClick={closeAllocate} style={{ ...ghostBase, height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap' }}>
                            Keep unallocated
                          </button>
                          <button
                            onClick={() => void allocate(row)}
                            disabled={allocateBusy || !allocateDraft.siteId}
                            style={{ ...ctaBase, height: 32, padding: '0 15px', fontSize: 11.5, whiteSpace: 'nowrap' }}
                          >
                            {allocateBusy ? 'ALLOCATING…' : `ALLOCATE TO ${(sites.find((s) => s.id === allocateDraft.siteId)?.name ?? 'JOB').toUpperCase()}`}
                          </button>
                        </div>
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>
          </div>
        </div>

        {quickAdd && (
          <div style={{ padding: 14, background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 8, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Add expense</span>
              <span style={{ fontSize: 11.5, color: FAINT }}>Manual entry — to have it read automatically, drop the invoice above instead.</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <TextField label="Vendor" value={quickAdd.vendor} onChange={(v) => setQuickAdd((f) => (f ? { ...f, vendor: v } : f))} placeholder="Home Depot" width={200} />
              <label style={miniLabel}>
                Date
                <input type="date" value={quickAdd.spentOn} onChange={(e) => setQuickAdd((f) => (f ? { ...f, spentOn: e.target.value } : f))} style={{ ...miniInput, width: 150 }} />
              </label>
              <TextField label="Total inc GST" value={quickAdd.amount} onChange={(v) => setQuickAdd((f) => (f ? { ...f, amount: v } : f))} placeholder="0.00" width={110} />
              <TextField label="GST included" value={quickAdd.tax} onChange={(v) => setQuickAdd((f) => (f ? { ...f, tax: v } : f))} placeholder="0.00" width={100} />
              <label style={miniLabel}>
                Category
                <select value={quickAdd.category} onChange={(e) => setQuickAdd((f) => (f ? { ...f, category: e.target.value } : f))} style={{ ...miniInput, width: 160 }}>
                  <option value="">—</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <TextField label="Cost code" value={quickAdd.costCode} onChange={(v) => setQuickAdd((f) => (f ? { ...f, costCode: v } : f))} placeholder="03-300" width={110} />
              <label style={miniLabel}>
                Job site
                <select value={quickAdd.siteId} onChange={(e) => setQuickAdd((f) => (f ? { ...f, siteId: e.target.value } : f))} style={{ ...miniInput, width: 190 }}>
                  <option value="">No site — allocate later</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label style={miniLabel}>
                Receipt photo
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void onQuickAddFile(file)
                    e.target.value = ''
                  }}
                  style={{ display: 'block', marginTop: 4, fontSize: 12.5 }}
                />
              </label>
            </div>
            {quickAdd.receiptPath && <span style={{ fontSize: 11.5, color: theme.success }}>Receipt attached.</span>}
            {quickAddError && <div style={{ fontSize: 12, color: theme.alert }}>{quickAddError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => void saveQuickAdd()} disabled={quickAddBusy} style={{ ...ctaBase, height: 30, padding: '0 14px', fontSize: 12 }}>
                {quickAddBusy ? 'SAVING…' : 'SAVE EXPENSE'}
              </button>
              <button onClick={() => { setQuickAdd(null); setQuickAddError(null) }} style={{ ...ghostBase, height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500 }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 8, overflowX: 'auto', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 14px', borderBottom: `1px solid ${theme.border}`, minWidth: TABLE_MIN_W }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Expenses</span>
              {needsReviewCount > 0 && <span style={pillAmber}>{needsReviewCount} need review</span>}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <PillSelect value={categoryFilter} onChange={setCategoryFilter} options={presentCategories} allLabel="All categories" />
              <button onClick={() => setQuickAdd(blankQuickAdd(siteId))} style={{ ...ghostBase, height: 27, padding: '0 10px', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap' }}>
                Add expense
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', minWidth: TABLE_MIN_W, gridTemplateColumns: GRID_COLS, padding: '7px 14px', background: SUBTLE_BG, borderBottom: `1px solid ${theme.border}` }}>
            <span style={colHead}>DATE</span>
            <span style={colHead}>VENDOR</span>
            <span style={colHead}>CATEGORY</span>
            <span style={colHead}>COST CODE</span>
            <span style={{ ...colHead, textAlign: 'right' }}>AMOUNT</span>
            <span style={{ ...colHead, textAlign: 'center' }}>RECEIPT</span>
            <span style={{ ...colHead, textAlign: 'center' }}>BY</span>
            <span style={{ ...colHead, textAlign: 'right' }}>STATUS</span>
          </div>

          {loading && <div style={{ minWidth: TABLE_MIN_W, padding: 24, fontSize: 13, color: FAINT }}>Loading…</div>}
          {!loading && categoryFiltered.length === 0 && (
            <div style={{ minWidth: TABLE_MIN_W, padding: 24, fontSize: 13, color: FAINT }}>No expenses match these filters.</div>
          )}

          {categoryFiltered.map((row) => {
            const status = STATUS_META[row.status]
            const dup = isDuplicate(row)
            const expanded = expandedId === row.id
            const noteText = dup ? 'Possible duplicate — check before paying twice.' : row.ai_note
            const noteTagLabel = dup ? 'DUP' : 'AI'
            const noteTagBg = dup ? '#FCE8EA' : theme.accentFill
            const noteTagFg = dup ? theme.alert : theme.accent
            const noteFg = dup ? theme.alert : FAINT
            const receiptUrl = row.receipt_path ? receiptUrls.get(row.id) : undefined
            const isPdf = (row.receipt_path ?? '').toLowerCase().endsWith('.pdf')
            const codeName = costCodeName(row.cost_code)

            return (
              <Fragment key={row.id}>
                <div
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  style={{
                    display: 'grid', minWidth: TABLE_MIN_W, gridTemplateColumns: GRID_COLS, alignItems: 'center',
                    padding: '9px 14px', borderBottom: `1px solid ${HAIRLINE}`, background: expanded ? SUBTLE_BG : '#fff', cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 12.5, color: BODY }}>{new Date(row.spent_on).toLocaleDateString('en-AU')}</span>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.vendor || 'Unknown'}
                    </span>
                    {noteText && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, lineHeight: 1.35, color: noteFg }}>
                        <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', padding: '1px 5px', borderRadius: 3, background: noteTagBg, color: noteTagFg, fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em' }}>
                          {noteTagLabel}
                        </span>
                        {noteText}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 12.5, color: BODY }}>{row.category || '—'}</span>
                  <span style={{ fontSize: 12.5, color: BODY }}>{row.cost_code || '—'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {money2(Number(row.amount))}
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'center' }}>
                    {receiptUrl && !isPdf ? (
                      <img src={receiptUrl} alt="" style={{ width: 30, height: 30, borderRadius: 3, border: `1px solid ${theme.border}`, objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span style={{ width: 30, height: 30, borderRadius: 3, border: `1px solid ${theme.border}`, background: HATCH, display: 'block' }} />
                    )}
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'center' }}>
                    <span title={workerName(row.submitted_by)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: theme.railSoft, color: '#fff', fontSize: 9, fontWeight: 700 }}>
                      {workerInitials(row.submitted_by)}
                    </span>
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 11, fontSize: 11.5, fontWeight: 700, background: status.bg, color: status.color }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.color }} />
                      {status.label}
                    </span>
                  </span>
                </div>

                {expanded && (
                  <div style={{ minWidth: TABLE_MIN_W, padding: '0 14px 14px', background: SUBTLE_BG, borderBottom: `1px solid ${theme.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 0 10px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: HEAD }}>
                        {(row.vendor || 'THIS EXPENSE').toUpperCase()} — WHAT WE HAVE ON FILE
                      </span>
                      <span style={{ flex: 1, height: 1, background: theme.border }} />
                      <a href="#" onClick={(e) => { e.preventDefault(); setExpandedId(null) }} style={{ fontSize: 11.5, color: theme.accent }}>
                        Collapse
                      </a>
                    </div>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ flex: 'none', width: 224, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <div style={{ position: 'relative', height: 280, border: `1px solid ${theme.border}`, borderRadius: 4, background: '#fff', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {!row.receipt_path && <span style={{ fontSize: 12, color: FAINT, padding: '0 16px', textAlign: 'center' }}>No receipt attached</span>}
                          {row.receipt_path && isPdf && (
                            <a href={receiptUrl ?? '#'} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: theme.accent, textAlign: 'center', padding: '0 16px' }}>
                              View PDF invoice
                            </a>
                          )}
                          {row.receipt_path && !isPdf && (
                            receiptUrl
                              ? <img src={receiptUrl} alt="Receipt" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              : <span style={{ fontSize: 12, color: FAINT }}>Loading receipt…</span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: FAINT }}>
                          Submitted by {workerName(row.submitted_by)} · {new Date(row.created_at).toLocaleString('en-AU')}
                        </span>
                      </div>

                      <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', border: `1px solid ${theme.border}`, borderRadius: 4, background: '#fff', overflow: 'hidden' }}>
                        {extractedFields(row).map((f) => (
                          <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', borderBottom: `1px solid ${HAIRLINE}` }}>
                            <span style={{ flex: 'none', width: 104, fontSize: 12, color: FAINT }}>{f.k}</span>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{f.v}</span>
                            {f.conf && <span style={{ flex: 'none', fontSize: 11, fontWeight: 600, color: f.conf.fg }}>{f.conf.label}</span>}
                          </div>
                        ))}

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 13px', background: SUBTLE_BG, flexWrap: 'wrap' }}>
                          {editingId === row.id && editDraft ? (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <CodingField label="Site" value={editDraft.siteId} onChange={(v) => setEditDraft((d) => (d ? { ...d, siteId: v } : d))} options={sites.map((s) => ({ value: s.id, label: s.name }))} placeholder="No site" />
                              <CodingField label="Category" value={editDraft.category} onChange={(v) => setEditDraft((d) => (d ? { ...d, category: v } : d))} options={CATEGORIES.map((c) => ({ value: c, label: c }))} placeholder="—" />
                              <CodingField label="Cost code" value={editDraft.costCode} onChange={(v) => setEditDraft((d) => (d ? { ...d, costCode: v } : d))} options={costCodes.map((c) => ({ value: c.code, label: c.code }))} placeholder="Uncoded" />
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: HEAD }}>
                              {row.cost_code ? (
                                <>Coded to <b style={{ fontWeight: 600, color: theme.ink }}>{row.cost_code}{codeName ? ` ${codeName}` : ''}</b> on {siteName(row.site_id)}. Job costing updates the moment you confirm.</>
                              ) : (
                                <>Not yet coded to a cost code on <b style={{ fontWeight: 600, color: theme.ink }}>{siteName(row.site_id)}</b>.</>
                              )}
                            </span>
                          )}
                          {me.is_office && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {editingId === row.id ? (
                                <>
                                  <button onClick={cancelEdit} style={ghostSm}>Cancel</button>
                                  <button onClick={() => void saveEdit(row.id)} style={ctaSm}>SAVE CODING</button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => startEdit(row)} style={ghostSm}>Edit</button>
                                  {row.status === 'needs_review' ? (
                                    <button onClick={() => void setStatus(row.id, 'confirmed')} style={ctaSm}>CONFIRM EXPENSE</button>
                                  ) : (
                                    (['confirmed', 'needs_review', 'flagged'] as const)
                                      .filter((s) => s !== row.status)
                                      .map((s) => (
                                        <button key={s} onClick={() => void setStatus(row.id, s)} style={ghostSm}>
                                          Mark {STATUS_META[s].label.toLowerCase()}
                                        </button>
                                      ))
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Fragment>
            )
          })}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: TABLE_MIN_W, padding: '11px 14px', background: SUBTLE_BG }}>
            <span style={{ fontSize: 12.5, color: HEAD }}>
              {categoryFiltered.length} of {rows.length} expenses{site ? ` · filtered to ${site.name}` : ''}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              Shown total {money2(shownTotal)}
            </span>
          </div>
        </div>

        <ReceiptFlowExplainer />
      </div>
    </div>
  )
}

function costCodeName(code: string | null): string {
  if (!code) return ''
  return costCodes.find((c) => c.code === code)?.name ?? ''
}

function confidenceMeta(conf: number | null): { fg: string; label: string } | null {
  if (conf == null) return null
  const pct = Math.round(conf * 100)
  const fg = conf >= 0.85 ? '#1B7A2C' : conf >= 0.6 ? AMBER_FG : theme.alert
  return { fg, label: `${pct}% match` }
}

/**
 * Mirrors the mock's `extracted` field list. Real ExpenseRow data only carries
 * one overall ai_confidence (no per-field figure), so that single real number
 * is repeated against every field rather than fabricating per-field precision.
 */
function extractedFields(row: ExpenseRow): Array<{ k: string; v: string; conf: { fg: string; label: string } | null }> {
  const conf = confidenceMeta(row.ai_confidence)
  const fields: Array<{ k: string; v: string; conf: { fg: string; label: string } | null }> = [
    { k: 'VENDOR', v: row.vendor || '—', conf },
    { k: 'DATE', v: new Date(row.spent_on).toLocaleDateString('en-AU'), conf },
    { k: 'AMOUNT', v: money2(Number(row.amount)), conf },
    { k: 'TAX', v: money2(Number(row.tax)), conf },
    { k: 'CATEGORY', v: row.category || '—', conf },
    { k: 'COST CODE', v: row.cost_code || 'Uncoded', conf },
  ]
  if (row.line_items.length > 0) {
    fields.push({ k: 'LINE ITEMS', v: `${row.line_items.length} item${row.line_items.length === 1 ? '' : 's'}`, conf: null })
  }
  return fields
}

/** A labelled, boxed field with a native <select> underneath — used by both the
 * inbox's allocate panel and the ledger row's inline recode, matching the design's
 * field-box look (label above, value + chevron in a bordered box, optional note). */
function CodingField({
  label, value, onChange, options, placeholder, edge, note,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  placeholder: string
  edge?: string
  note?: string
}) {
  const current = options.find((o) => o.value === value)?.label ?? placeholder
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: FAINT, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 10px', background: '#fff', border: `1px solid ${edge ?? theme.border}`, borderRadius: 3 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {current}
        </span>
        <svg width="9" height="9" viewBox="0 0 10 10" style={{ flex: 'none', opacity: .45 }}>
          <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="#1A1D21" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {note && <span style={{ fontSize: 11, lineHeight: 1.35, color: edge ? theme.alert : FAINT }}>{note}</span>}
    </div>
  )
}

/** The "All categories ▾" filter — a real <select> hidden under a button-styled backdrop. */
function PillSelect({
  value, onChange, options, allLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  allLabel: string
}) {
  const label = value === 'all' ? allLabel : value
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={{ ...ghostBase, height: 27, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {label}
        <span style={{ opacity: .5, fontSize: 9 }}>▾</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter by category"
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
      >
        <option value="all">{allLabel}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function TextField({
  label, value, onChange, placeholder, width = 170,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
}) {
  return (
    <label style={miniLabel}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...miniInput, width }} />
    </label>
  )
}

// ---------------------------------------------------------------- style atoms

const ghostBase = {
  background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 3,
  fontFamily: 'inherit', color: theme.ink, cursor: 'pointer',
} as const

const ctaBase = {
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: '#1A1D21', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '.04em', cursor: 'pointer',
} as const

const ghostSm = { ...ghostBase, height: 27, padding: '0 11px', fontSize: 12.5, fontWeight: 500 } as const
const ctaSm = { ...ctaBase, height: 27, padding: '0 13px', fontSize: 11.5 } as const

const pillAmber = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 11,
  background: AMBER_BG, color: AMBER_FG, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
} as const

const colHead = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: HEAD } as const

const miniLabel = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: FAINT, display: 'block' } as const

const miniInput = {
  display: 'block', height: 32, marginTop: 4, padding: '0 9px', borderRadius: 3,
  border: `1px solid ${theme.border}`, background: '#fff', font: 'inherit', fontSize: 13, color: theme.ink,
} as const

const statMicroLabel = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: FAINT, whiteSpace: 'nowrap' } as const

// -------------------------------------------------------- static explainer
//
// Nothing below binds to real data — it doesn't in the mock either (no {{ }} in
// this section besides the always-on AI-badge flag). It is product copy explaining
// how a worker's phone gets a receipt into the system, reproduced verbatim.

function ReceiptFlowExplainer() {
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-.01em' }}>
          How the receipt gets there — worker phone
        </h2>
        <p style={{ margin: 0, maxWidth: 720, fontSize: 13, lineHeight: 1.5, color: HEAD }}>
          The guy at the counter photographs the invoice before he leaves the parking lot. It lands in
          the right job, on the right cost code, with the numbers already read. The office confirms
          instead of typing.
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-start' }}>
        <PhoneStep n={1} title="Snap it">
          <SnapPhone />
        </PhoneStep>
        <PhoneStep n={2} title="Already read and coded">
          <CodedPhone />
        </PhoneStep>
        <WhyItMatters />
      </div>
    </>
  )
}

function PhoneStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: 390 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 19, height: 19, borderRadius: '50%', background: '#1A1D21', color: '#fff', fontSize: 10.5, fontWeight: 700 }}>
          {n}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function PhoneStatusBar({ dark, time }: { dark: boolean; time: string }) {
  const fg = dark ? '#fff' : '#1A1D21'
  return (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 46, padding: '0 24px 6px', color: fg }}>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{time}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <svg width="16" height="11" viewBox="0 0 16 11" fill={fg}>
          <rect x="0" y="7" width="2.6" height="4" rx=".6" />
          <rect x="4" y="5" width="2.6" height="6" rx=".6" />
          <rect x="8" y="2.6" width="2.6" height="8.4" rx=".6" />
          <rect x="12" y="0" width="2.6" height="11" rx=".6" opacity={dark ? 0.4 : 0.3} />
        </svg>
        <svg width="22" height="11" viewBox="0 0 24 12" fill="none">
          <rect x="1" y="1" width="19" height="10" rx="3" stroke={fg} strokeOpacity={dark ? 0.5 : 0.4} />
          <rect x="2.5" y="2.5" width="14" height="7" rx="1.8" fill={fg} />
        </svg>
      </span>
    </div>
  )
}

function ReceiptLine({ name, amt }: { name: string; amt: string }) {
  return (
    <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#5C574E' }}>
      <span>{name}</span><span>{amt}</span>
    </span>
  )
}

function CornerMarks() {
  const corner = { position: 'absolute' as const, width: 34, height: 34 }
  return (
    <>
      <span style={{ ...corner, left: 14, top: 22, borderLeft: `3px solid ${theme.brandYellow}`, borderTop: `3px solid ${theme.brandYellow}`, borderRadius: '4px 0 0 0' }} />
      <span style={{ ...corner, right: 14, top: 22, borderRight: `3px solid ${theme.brandYellow}`, borderTop: `3px solid ${theme.brandYellow}`, borderRadius: '0 4px 0 0' }} />
      <span style={{ ...corner, left: 14, bottom: 22, borderLeft: `3px solid ${theme.brandYellow}`, borderBottom: `3px solid ${theme.brandYellow}`, borderRadius: '0 0 0 4px' }} />
      <span style={{ ...corner, right: 14, bottom: 22, borderRight: `3px solid ${theme.brandYellow}`, borderBottom: `3px solid ${theme.brandYellow}`, borderRadius: '0 0 4px 0' }} />
    </>
  )
}

function SnapPhone() {
  return (
    <div style={{ width: 390, height: 844, background: '#2B2F33', borderRadius: 42, padding: 9, boxShadow: '0 8px 26px rgba(26,29,33,.18)' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1A1D21', borderRadius: 34, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <PhoneStatusBar dark time="10:40" />
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 12px' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>New expense</span>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,.65)' }}>Cancel</span>
        </div>
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 26px' }}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', maxHeight: '100%', borderRadius: 6, background: '#F7F5F1', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 9, boxShadow: '0 10px 30px rgba(0,0,0,.45)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.03em', color: '#2B2F33' }}>FERGUSON PLUMBING SUPPLY</span>
            <span style={{ fontSize: 11, color: '#8B8578' }}>2210 SE Foster Rd</span>
            <span style={{ display: 'block', height: 1, background: '#DFDAD1' }} />
            <span style={{ fontSize: 11, color: '#5C574E' }}>INVOICE 88472 · 08/05/2026</span>
            <span style={{ display: 'block', height: 1, background: '#DFDAD1' }} />
            <ReceiptLine name={`3/4" PEX-A COIL 100'`} amt="214.00" />
            <ReceiptLine name="PEX FITTINGS ASSORTED" amt="187.00" />
            <ReceiptLine name="WATER HEATER 50 GAL" amt="380.00" />
            <span style={{ display: 'block', height: 1, background: '#DFDAD1' }} />
            <ReceiptLine name="TAX" amt="61.19" />
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: '#2B2F33' }}>
              <span>TOTAL</span><span>842.19</span>
            </span>
          </div>
          <CornerMarks />
        </div>
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '20px 0 30px' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Snap the invoice — we'll file it.</span>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 74, height: 74, borderRadius: '50%', border: '4px solid rgba(255,255,255,.4)' }}>
            <span style={{ width: 58, height: 58, borderRadius: '50%', background: '#fff' }} />
          </span>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)' }}>Job site and cost code are guessed from where you are.</span>
        </div>
      </div>
    </div>
  )
}

const PHONE_FIELDS: Array<{ k: string; v: string; note: string | null }> = [
  { k: 'VENDOR', v: 'Ferguson Plumbing Supply', note: null },
  { k: 'JOB SITE', v: 'Maple Ridge', note: 'Guessed from GPS — 640m from the site boundary. Check it.' },
  { k: 'COST CODE', v: '15-400 Plumbing', note: null },
  { k: 'CATEGORY', v: 'Materials', note: null },
  { k: 'TAX', v: '$61.19', note: null },
  { k: 'TOTAL', v: '$842.19', note: null },
]

function CodedPhone() {
  return (
    <div style={{ width: 390, height: 844, background: '#2B2F33', borderRadius: 42, padding: 9, boxShadow: '0 8px 26px rgba(26,29,33,.18)' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#fff', borderRadius: 34, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <PhoneStatusBar dark={false} time="10:41" />
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 12px', borderBottom: '1px solid #DCE0E6' }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>Check and save</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 11, background: '#E7F1FF', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: '#007BFF' }}>
            AI READ THIS
          </span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 13, padding: '16px 20px', borderBottom: '1px solid #EDEFF1' }}>
            <div style={{ flex: 'none', width: 82, height: 104, border: '1px solid #DCE0E6', borderRadius: 4, background: '#F7F5F1', padding: '8px 7px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
              <span style={{ fontSize: 6.5, fontWeight: 700, color: '#2B2F33' }}>FERGUSON PLUMBING</span>
              <span style={{ display: 'block', height: 1, background: '#DFDAD1' }} />
              <span style={{ display: 'block', height: 2, width: '80%', background: '#E4DFD6' }} />
              <span style={{ display: 'block', height: 2, width: '64%', background: '#E4DFD6' }} />
              <span style={{ display: 'block', height: 2, width: '72%', background: '#E4DFD6' }} />
              <span style={{ display: 'block', height: 1, background: '#DFDAD1' }} />
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 6.5, fontWeight: 700, color: '#2B2F33' }}>
                <span>TOTAL</span><span>842.19</span>
              </span>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}>Ferguson Plumbing Supply</span>
              <span style={{ fontSize: 14, color: '#696D74' }}>Invoice 88472 · today 10:41 AM</span>

            </div>
          </div>

          {PHONE_FIELDS.map((p) => (
            <div key={p.k} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '13px 20px', borderBottom: '1px solid #EDEFF1' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', color: '#8B9096' }}>
                {p.k}
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: 3, background: '#E7F1FF', color: '#007BFF', fontSize: 8, fontWeight: 700 }}>AI</span>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{p.v}</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#B7BCC2" strokeWidth={1.5} style={{ flex: 'none' }}>
                  <path d="M11.2 2.4l2.4 2.4-8 8H3.2v-3z" strokeLinejoin="round" />
                </svg>
              </div>
              {p.note && (
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 13, lineHeight: 1.4, color: '#8A6100' }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#C9A227" strokeWidth={1.5} style={{ flex: 'none', marginTop: 2 }}>
                    <path d="M8 2.6L14.4 13H1.6z" strokeLinejoin="round" />
                    <path d="M8 6.6v3" strokeLinecap="round" />
                  </svg>
                  {p.note}
                </span>
              )}
            </div>
          ))}

          <button
            onClick={(e) => e.preventDefault()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 20px', border: 0, borderBottom: '1px solid #EDEFF1', background: '#fff', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', width: '100%' }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>3 line items</span>
              <span style={{ fontSize: 13, color: '#8B9096' }}>PEX coil, fittings, 50 gal water heater</span>
            </span>
            <svg width="15" height="15" viewBox="0 0 10 10" style={{ flex: 'none' }}>
              <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="#8B9096" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 20px 22px', borderTop: '1px solid #DCE0E6' }}>
          <button
            onClick={(e) => e.preventDefault()}
            style={{ width: '100%', height: 56, background: theme.cta, border: `1px solid ${theme.ctaBorder}`, borderRadius: 3, fontFamily: 'inherit', fontSize: 15, fontWeight: 700, letterSpacing: '.04em', color: '#1A1D21', cursor: 'pointer' }}
          >
            SAVE TO MAPLE RIDGE
          </button>
          <span style={{ fontSize: 12.5, color: '#8B9096', textAlign: 'center' }}>
            Dale gets it for review. Nothing hits the budget until he confirms.
          </span>
        </div>
      </div>
    </div>
  )
}

function WhyItMatters() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: 330 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 19, height: 19, borderRadius: '50%', background: '#1A1D21', color: '#fff', fontSize: 10.5, fontWeight: 700 }}>
          3
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }}>Why it matters</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '17px 18px', background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>Receipts are where job costing dies.</span>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#4A5057' }}>
          A shoebox of invoices reaches the office two weeks later, gets keyed to the wrong job, and the
          margin number nobody trusts. Here the photo IS the entry — vendor, total, tax, category and
          cost code read on the spot, attached to the site the phone was standing in.
        </p>
        <div style={{ height: 1, background: '#EDEFF1' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: '#4A5057' }}>
            <span style={{ color: '#007BFF', fontWeight: 700 }}>→</span>
            Office keystrokes per receipt: <b style={{ fontWeight: 600 }}>one</b> (Confirm)
          </span>
          <span style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: '#4A5057' }}>
            <span style={{ color: '#007BFF', fontWeight: 700 }}>→</span>
            Duplicate invoices caught before they're paid
          </span>
          <span style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: '#4A5057' }}>
            <span style={{ color: '#007BFF', fontWeight: 700 }}>→</span>
            Budget on the Overview tab is current, not two weeks stale
          </span>
        </div>
      </div>
    </div>
  )
}
