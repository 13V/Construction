import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type ExpenseRow, type WorkerRow } from '../data/supabase'
import { BUCKET_RECEIPTS, objectPath, signedUrl, uploadFile } from '../data/storage'
import { InvoiceDrop } from './InvoiceDrop'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Expense capture with AI-assisted receipt reading. The endpoint only reads
 * the photo and hands back a guess — it never writes anything, so a bad OCR
 * read shows up as an amber "needs review" row rather than a silently wrong
 * number in the books. Saving by hand (no photo) skips review entirely.
 */

const CATEGORIES = ['Materials', 'Subcontractor', 'Equipment Rental', 'Permits', 'Fuel', 'Other']

const STATUS_META: Record<ExpenseRow['status'], { label: string; color: string; bg: string }> = {
  confirmed: { label: 'Confirmed', color: '#1B7A32', bg: '#EAF7EE' },
  needs_review: { label: 'Needs review', color: '#8A6100', bg: '#FFF6DF' },
  flagged: { label: 'Flagged', color: theme.alert, bg: '#FCE8EA' },
}

const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

interface FormState {
  siteId: string
  vendor: string
  spentOn: string
  amount: string
  tax: string
  category: string
  costCode: string
  receiptPath: string | null
  lineItems: Array<{ description: string; amount: number }>
  aiNote: string | null
  aiConfidence: number | null
  /** Field names still showing the "read from photo" marker — cleared as the user corrects each one. */
  aiFilled: Set<string>
  /** Sticky even after edits — this is what decides the saved status. */
  aiExtracted: boolean
}

const blankForm = (): FormState => ({
  siteId: '',
  vendor: '',
  spentOn: new Date().toISOString().slice(0, 10),
  amount: '',
  tax: '',
  category: '',
  costCode: '',
  receiptPath: null,
  lineItems: [],
  aiNote: null,
  aiConfidence: null,
  aiFilled: new Set(),
  aiExtracted: false,
})

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

const money = (n: number) => `$${n.toFixed(2)}`

export function Expenses({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [siteFilter, setSiteFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [receiptUrls, setReceiptUrls] = useState<Map<string, string>>(new Map())

  const [form, setForm] = useState<FormState | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase()
      .from('expenses')
      .select('*')
      .order('spent_on', { ascending: false })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setRows((data ?? []) as ExpenseRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? '—'
  const workerName = (id: string | null) => workers.find((w) => w.id === id)?.name ?? 'Unknown'

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

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (siteFilter === 'all' || r.site_id === siteFilter) &&
          (statusFilter === 'all' || r.status === statusFilter),
      ),
    [rows, siteFilter, statusFilter],
  )

  const spendToDate = useMemo(
    () => filtered.reduce((sum, r) => sum + Number(r.amount) + Number(r.tax), 0),
    [filtered],
  )
  const needsReviewCount = useMemo(
    () => filtered.filter((r) => r.status === 'needs_review').length,
    [filtered],
  )
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of filtered) {
      const cat = r.category || 'Uncategorized'
      map.set(cat, (map.get(cat) ?? 0) + Number(r.amount) + Number(r.tax))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [filtered])
  const maxCategory = categoryTotals[0]?.[1] ?? 0

  const patch = (changes: Partial<FormState>) => setForm((f) => (f ? { ...f, ...changes } : f))

  /** Edits from the user correct a field and drop its "read from photo" marker. */
  const editField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => {
      if (!f) return f
      const nextFilled = new Set(f.aiFilled)
      nextFilled.delete(key)
      return { ...f, [key]: value, aiFilled: nextFilled }
    })

  async function onFileSelected(file: File) {
    setFormError(null)
    setExtracting(true)
    try {
      const siteId = form?.siteId || 'unassigned'
      const path = objectPath(me.company_id, siteId, file.name)
      await uploadFile(BUCKET_RECEIPTS, path, file)
      patch({ receiptPath: path })

      const base64 = await readFileAsBase64(file)
      const {
        data: { session },
      } = await supabase().auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not signed in')

      const res = await fetch('/api/parse-receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          imageBase64: base64,
          mediaType: file.type || 'image/jpeg',
          siteHint: form?.siteId ? siteName(form.siteId) : undefined,
          sitesList: sites.map((s) => s.name),
        }),
      })

      if (res.status === 501) {
        // AI extraction not configured — the form stays fully usable by hand.
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Extraction failed (${res.status})`)
      }

      const parsed = (await res.json()) as {
        vendor: string | null
        spent_on: string | null
        amount: number | null
        tax: number | null
        category: string
        line_items: Array<{ description: string; amount: number }>
        confidence: number
        note: string | null
      }

      const filledFields = new Set<string>()
      setForm((f) => {
        if (!f) return f
        const next = { ...f }
        if (parsed.vendor) {
          next.vendor = parsed.vendor
          filledFields.add('vendor')
        }
        if (parsed.spent_on) {
          next.spentOn = parsed.spent_on
          filledFields.add('spentOn')
        }
        if (parsed.amount != null) {
          next.amount = String(parsed.amount)
          filledFields.add('amount')
        }
        if (parsed.tax != null) {
          next.tax = String(parsed.tax)
          filledFields.add('tax')
        }
        if (parsed.category) {
          next.category = parsed.category
          filledFields.add('category')
        }
        next.lineItems = parsed.line_items ?? []
        next.aiNote = parsed.note
        next.aiConfidence = parsed.confidence
        next.aiFilled = filledFields
        next.aiExtracted = true
        return next
      })
    } catch (err) {
      setFormError(
        err instanceof Error
          ? `Couldn't read the receipt automatically — ${err.message}. Enter it by hand.`
          : "Couldn't read the receipt automatically. Enter it by hand.",
      )
    } finally {
      setExtracting(false)
    }
  }

  async function save() {
    if (!form) return
    if (!form.vendor.trim() || !form.spentOn || !form.amount) {
      setFormError('Vendor, date, and amount are required.')
      return
    }
    setSaving(true)
    setFormError(null)

    const { error: err } = await supabase()
      .from('expenses')
      .insert({
        company_id: me.company_id,
        site_id: form.siteId || null,
        submitted_by: me.id,
        vendor: form.vendor.trim(),
        spent_on: form.spentOn,
        amount: Number(form.amount) || 0,
        tax: Number(form.tax) || 0,
        category: form.category || null,
        cost_code: form.costCode.trim() || null,
        receipt_path: form.receiptPath,
        status: form.aiExtracted ? 'needs_review' : 'confirmed',
        ai_note: form.aiNote,
        ai_confidence: form.aiConfidence,
        line_items: form.lineItems,
      })

    setSaving(false)
    if (err) {
      setFormError(err.message)
      return
    }
    setForm(null)
    await load()
    onChanged()
  }

  async function setStatus(id: string, status: ExpenseRow['status']) {
    const { error: err } = await supabase().from('expenses').update({ status }).eq('id', id)
    if (err) setError(err.message)
    else await load()
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Expenses</h1>
          <span style={{ fontSize: 13, color: theme.inkSoft }}>{rows.length}</span>
          {!form && (
            <button onClick={() => setForm(blankForm())} style={{ ...cta, marginLeft: 'auto' }}>
              ADD EXPENSE
            </button>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: theme.alert }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ ...statCard, minWidth: 150 }}>
            <div style={statLabel}>Spend to date</div>
            <div style={{ ...statValue, fontVariantNumeric: 'tabular-nums' }}>
              {money(spendToDate)}
            </div>
          </div>
          <div style={{ ...statCard, minWidth: 150 }}>
            <div style={statLabel}>Needs review</div>
            <div
              style={{
                ...statValue,
                fontVariantNumeric: 'tabular-nums',
                color: needsReviewCount > 0 ? '#8A6100' : theme.ink,
              }}
            >
              {needsReviewCount}
            </div>
          </div>
          <div style={{ ...statCard, flex: 1, minWidth: 260 }}>
            <div style={statLabel}>By category</div>
            {categoryTotals.length === 0 && (
              <div style={{ fontSize: 12.5, color: theme.inkFaint, marginTop: 6 }}>
                No spend in view.
              </div>
            )}
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {categoryTotals.map(([cat, total]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11.5, width: 118, flex: 'none', color: theme.inkSoft }}>
                    {cat}
                  </span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: theme.appBg }}>
                    <div
                      style={{
                        width: maxCategory ? `${(total / maxCategory) * 100}%` : 0,
                        height: '100%',
                        borderRadius: 4,
                        background: theme.accent,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 11.5,
                      width: 74,
                      flex: 'none',
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: theme.inkSoft,
                    }}
                  >
                    {money(total)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
          <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} style={selectStyle}>
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="all">All statuses</option>
            <option value="needs_review">Needs review</option>
            <option value="confirmed">Confirmed</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>

        {form && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New expense</div>

            <label style={label}>
              Receipt photo
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onFileSelected(file)
                  e.target.value = ''
                }}
                style={{ display: 'block', marginTop: 4, fontSize: 12.5 }}
              />
            </label>
            {extracting && (
              <div style={{ fontSize: 12, color: theme.accent, marginTop: 6 }}>
                Reading receipt…
              </div>
            )}
            {form.aiExtracted && !extracting && (
              <div style={{ fontSize: 11.5, color: theme.accent, marginTop: 6 }}>
                Read from photo — confidence{' '}
                {form.aiConfidence != null ? `${Math.round(form.aiConfidence * 100)}%` : '—'}.
                Check every field below.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
              <FormField
                label="Vendor"
                value={form.vendor}
                aiFilled={form.aiFilled.has('vendor')}
                onChange={(v) => editField('vendor', v)}
                placeholder="Home Depot"
                width={210}
              />
              <FormField
                label="Date"
                type="date"
                value={form.spentOn}
                aiFilled={form.aiFilled.has('spentOn')}
                onChange={(v) => editField('spentOn', v)}
                width={150}
              />
              <FormField
                label="Amount"
                value={form.amount}
                aiFilled={form.aiFilled.has('amount')}
                onChange={(v) => editField('amount', v)}
                placeholder="0.00"
                width={110}
              />
              <FormField
                label="Tax"
                value={form.tax}
                aiFilled={form.aiFilled.has('tax')}
                onChange={(v) => editField('tax', v)}
                placeholder="0.00"
                width={110}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
              <label style={label}>
                Category
                {form.aiFilled.has('category') && <AiMarker />}
                <select
                  value={form.category}
                  onChange={(e) => editField('category', e.target.value)}
                  style={{ ...field, width: 180 }}
                >
                  <option value="">—</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <FormField
                label="Cost code"
                value={form.costCode}
                onChange={(v) => editField('costCode', v)}
                placeholder="03-300"
                width={110}
              />
              <label style={label}>
                Job site
                <select
                  value={form.siteId}
                  onChange={(e) => patch({ siteId: e.target.value })}
                  style={{ ...field, width: 200 }}
                >
                  <option value="">No site</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {form.lineItems.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <div style={{ color: theme.inkFaint, marginBottom: 4 }}>Line items read from photo</div>
                {form.lineItems.map((li, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                    <span style={{ flex: 1, color: theme.inkSoft }}>{li.description}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(li.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {formError && (
              <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{formError}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void save()} disabled={saving || extracting} style={cta}>
                {saving ? 'SAVING…' : 'SAVE EXPENSE'}
              </button>
              <button onClick={() => setForm(null)} style={ghost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ ...card, padding: 0, overflow: 'hidden', marginTop: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'Vendor', 'Category', 'Cost code', 'Site', 'Amount', 'Submitted by', 'Status'].map(
                  (h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                    No expenses match these filters.
                  </td>
                </tr>
              )}
              {filtered.map((row) => {
                const status = STATUS_META[row.status]
                const duplicate = isDuplicate(row)
                const expanded = expandedId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={td}>{new Date(row.spent_on).toLocaleDateString()}</td>
                      <td style={{ ...td, fontWeight: 500 }}>
                        {row.vendor || '—'}
                        {duplicate && (
                          <span
                            style={{
                              marginLeft: 8,
                              padding: '1px 6px',
                              borderRadius: 3,
                              fontSize: 10.5,
                              fontWeight: 700,
                              letterSpacing: '.03em',
                              background: '#FCE8EA',
                              color: theme.alert,
                            }}
                          >
                            POSSIBLE DUPLICATE
                          </span>
                        )}
                      </td>
                      <td style={td}>{row.category || '—'}</td>
                      <td style={{ ...td, color: theme.inkSoft }}>{row.cost_code || '—'}</td>
                      <td style={td}>{siteName(row.site_id)}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                        {money(Number(row.amount) + Number(row.tax))}
                      </td>
                      <td style={{ ...td, color: theme.inkSoft }}>{workerName(row.submitted_by)}</td>
                      <td style={td}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 3,
                            fontSize: 11,
                            fontWeight: 600,
                            background: status.bg,
                            color: status.color,
                          }}
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={8} style={{ ...td, background: theme.appBg }}>
                          <div style={{ display: 'flex', gap: 16, padding: '8px 4px', flexWrap: 'wrap' }}>
                            <div style={{ flex: 'none' }}>
                              {row.receipt_path ? (
                                receiptUrls.get(row.id) ? (
                                  <img
                                    src={receiptUrls.get(row.id)}
                                    alt="Receipt"
                                    style={{
                                      width: 220,
                                      borderRadius: 6,
                                      border: `1px solid ${theme.border}`,
                                      display: 'block',
                                    }}
                                  />
                                ) : (
                                  <div style={{ width: 220, fontSize: 12, color: theme.inkSoft }}>
                                    Loading receipt…
                                  </div>
                                )
                              ) : (
                                <div style={{ width: 220, fontSize: 12, color: theme.inkFaint }}>
                                  No receipt attached.
                                </div>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 220 }}>
                              {row.ai_note && (
                                <div style={{ fontSize: 12.5, marginBottom: 8 }}>
                                  <span style={{ color: theme.inkFaint }}>AI note: </span>
                                  {row.ai_note}
                                  {row.ai_confidence != null && (
                                    <span style={{ color: theme.inkFaint }}>
                                      {' '}
                                      ({Math.round(row.ai_confidence * 100)}% confidence)
                                    </span>
                                  )}
                                </div>
                              )}
                              {row.line_items.length > 0 ? (
                                <table style={{ width: '100%', fontSize: 12.5 }}>
                                  <tbody>
                                    {row.line_items.map((li, i) => (
                                      <tr key={i}>
                                        <td style={{ padding: '2px 0', color: theme.inkSoft }}>
                                          {li.description}
                                        </td>
                                        <td
                                          style={{
                                            padding: '2px 0',
                                            textAlign: 'right',
                                            fontVariantNumeric: 'tabular-nums',
                                          }}
                                        >
                                          {money(Number(li.amount))}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <div style={{ fontSize: 12.5, color: theme.inkFaint }}>
                                  No line items captured.
                                </div>
                              )}

                              {me.is_office && (
                                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                                  {(['confirmed', 'needs_review', 'flagged'] as const).map((s) => (
                                    <button
                                      key={s}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        void setStatus(row.id, s)
                                      }}
                                      style={{
                                        ...ghost,
                                        borderColor: row.status === s ? theme.accent : theme.border,
                                        color: row.status === s ? theme.accent : theme.ink,
                                      }}
                                    >
                                      {STATUS_META[s].label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {me.is_office && (
          <InvoiceDrop
            me={me}
            sites={sites}
            defaultSiteId={siteFilter === 'all' ? '' : siteFilter}
            onSaved={() => {
              void load()
              onChanged()
            }}
          />
        )}
      </div>
    </div>
  )
}

function AiMarker() {
  return (
    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: theme.accent, textTransform: 'none', letterSpacing: 0 }}>
      · read from photo — check it
    </span>
  )
}

function FormField({
  label: labelText,
  value,
  onChange,
  placeholder,
  width = 170,
  type = 'text',
  aiFilled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
  type?: string
  aiFilled?: boolean
}) {
  return (
    <label style={label}>
      {labelText}
      {aiFilled && <AiMarker />}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...field, width }}
      />
    </label>
  )
}

const card = {
  marginTop: 14,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const statCard = {
  padding: '10px 14px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const statLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
}

const statValue = {
  fontSize: 22,
  fontWeight: 600,
  marginTop: 4,
}

const th = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  background: theme.appBg,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  textAlign: 'left' as const,
}

const td = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 13,
}

const ghost = {
  padding: '4px 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
}

const cta = {
  padding: '7px 13px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}

const selectStyle = {
  height: 30,
  padding: '0 8px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 12.5,
  color: theme.ink,
} as const

const field = {
  display: 'block',
  height: 32,
  padding: '0 9px',
  marginTop: 4,
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const label = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  display: 'block',
  marginTop: 8,
} as const
