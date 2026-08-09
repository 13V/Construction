import { useCallback, useRef, useState } from 'react'
import { supabase, type WorkerRow } from '../data/supabase'
import { api } from '../data/api'
import { BUCKET_RECEIPTS, objectPath, uploadFile } from '../data/storage'
import { costCodes } from '../data/seed'
import { money2 as money } from '../format'
import { theme } from '../theme'
import type { JobSite } from '../types'

/**
 * Drop a supplier invoice on a job and it becomes a costed material list.
 *
 * The file is stored first and the expense row written even when extraction
 * fails, because the invoice itself is the record — losing it because an AI
 * call timed out would be the worst outcome. Extracted lines are always shown
 * for review before anything is committed to the job cost.
 *
 * Layout matches the "Invoice inbox" drop card in design/screens/isExpenses.html —
 * this component renders the dashed drop target and the "THREE WAYS IN" panel that
 * live in its left column. The review table (once a file is read) has no room in
 * that 300px column, so it grows to the full card width — see the `flex` on the
 * root below — while staying inside the card the caller (Expenses) lays out.
 */

interface Line {
  description: string
  quantity: string
  unit: string
  unit_cost: string
  cost_code: string
  include: boolean
}

const UNITS = ['ea', 'lm', 'm', 'm²', 'm³', 'kg', 't', 'L', 'box', 'pack', 'sheet', 'hr']
const ACCEPTED = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
]
const MAX_BYTES = 25 * 1024 * 1024

// Colours lifted verbatim from isExpenses.html that have no equivalent in theme.ts.
const FAINT = '#8B9096'
const SUBTLE_BG = '#FAFBFC'
const HAIRLINE = '#F1F3F5'
const AMBER_BG = '#FFF6DE'
const AMBER_FG = '#8A6100'
const DASH_BORDER = '#C3C9D0'

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })

export function InvoiceDrop({
  me,
  sites,
  defaultSiteId,
  onSaved,
}: {
  me: WorkerRow
  sites: JobSite[]
  /** Pre-selection from the page filter; the target is always shown and editable. */
  defaultSiteId: string
  onSaved: () => void
}) {
  // Costing an invoice to the wrong job is expensive and quiet, so the target
  // is never inferred silently — it is on screen before the file is dropped.
  const [siteId, setSiteId] = useState(defaultSiteId)
  const [over, setOver] = useState(false)
  const [stage, setStage] = useState<'idle' | 'uploading' | 'reading' | 'review' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [receiptPath, setReceiptPath] = useState<string | null>(null)
  const [vendor, setVendor] = useState('')
  const [spentOn, setSpentOn] = useState(new Date().toISOString().slice(0, 10))
  const [total, setTotal] = useState('')
  const [tax, setTax] = useState('')
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const input = useRef<HTMLInputElement | null>(null)

  const site = sites.find((s) => s.id === siteId) ?? null

  const reset = () => {
    setStage('idle')
    setLines([])
    setReceiptPath(null)
    setVendor('')
    setTotal('')
    setTax('')
    setAiNote(null)
    setConfidence(null)
    setFileName('')
  }

  const handle = useCallback(
    async (file: File) => {
      setError(null)
      setNotice(null)

      if (!siteId) return setError('Pick a job site first — the invoice is costed to it.')
      if (!ACCEPTED.includes(file.type)) {
        return setError('Drop a PDF invoice or a photo of one (JPEG, PNG, WebP).')
      }
      if (file.size > MAX_BYTES) return setError('That file is over the 25 MB limit.')

      setFileName(file.name)
      setStage('uploading')

      let path: string
      try {
        path = objectPath(me.company_id, siteId, file.name)
        await uploadFile(BUCKET_RECEIPTS, path, file, file.type)
        setReceiptPath(path)
      } catch (err) {
        setStage('idle')
        return setError(err instanceof Error ? err.message : 'Upload failed')
      }

      setStage('reading')
      try {
        const { data } = await supabase().auth.getSession()
        const token = data.session?.access_token
        const base64 = await fileToBase64(file)

        const res = await fetch(api('/api/parse-receipt'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            imageBase64: base64,
            mediaType: file.type,
            siteHint: site?.name,
            sitesList: sites.map((s) => s.name),
            costCodes: costCodes.map((c) => c.code),
          }),
        })

        if (res.status === 501) {
          setNotice('AI extraction is not configured — the invoice is saved, add the lines by hand.')
          setLines([blankLine()])
          setStage('review')
          return
        }
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          setNotice(detail.error ?? 'Could not read the invoice — the file is saved, add the lines by hand.')
          setLines([blankLine()])
          setStage('review')
          return
        }

        const parsed = (await res.json()) as {
          vendor: string | null
          spent_on: string | null
          amount: number | null
          tax: number | null
          note: string | null
          confidence: number
          line_items: Array<{
            description: string
            quantity: number
            unit: string
            unit_cost: number
            cost_code: string | null
          }>
        }

        setVendor(parsed.vendor ?? '')
        if (parsed.spent_on) setSpentOn(parsed.spent_on)
        setTotal(parsed.amount == null ? '' : String(parsed.amount))
        setTax(parsed.tax == null ? '' : String(parsed.tax))
        setAiNote(parsed.note)
        setConfidence(parsed.confidence)
        setLines(
          parsed.line_items.length
            ? parsed.line_items.map((li) => ({
                description: li.description,
                quantity: String(li.quantity),
                unit: li.unit,
                unit_cost: String(li.unit_cost),
                cost_code: li.cost_code ?? '',
                include: true,
              }))
            : [blankLine()],
        )
        setStage('review')
      } catch (err) {
        setNotice('Extraction failed — the invoice is saved, add the lines by hand.')
        setLines([blankLine()])
        setStage('review')
        console.error('[invoice] extraction', err)
      }
    },
    [me.company_id, siteId, site, sites],
  )

  const included = lines.filter((l) => l.include && l.description.trim())
  const linesTotal = included.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
    0,
  )
  const invoiceTotal = Number(total) || 0
  // A gap between the lines and the printed total usually means a line was
  // missed or a delivery fee was dropped — worth surfacing, not correcting.
  //
  // The GST is not that gap. Line items are printed ex-GST and the total is
  // inclusive, so without subtracting the tax this warned on every Australian
  // supplier invoice ever scanned — and a badge that always cries wolf is a
  // badge nobody reads when it finally catches the missed line.
  const gap = invoiceTotal > 0 ? invoiceTotal - linesTotal - (Number(tax) || 0) : 0

  async function save() {
    if (!siteId) return setError('Pick a job site first.')
    setStage('saving')
    setError(null)

    const client = supabase()
    const { data: expense, error: expenseError } = await client
      .from('expenses')
      .insert({
        company_id: me.company_id,
        site_id: siteId,
        submitted_by: me.id,
        vendor: vendor.trim() || 'Unknown supplier',
        spent_on: spentOn,
        amount: invoiceTotal || linesTotal,
        tax: Number(tax) || 0,
        category: 'Materials',
        receipt_path: receiptPath,
        status: 'needs_review',
        ai_note: aiNote,
        ai_confidence: confidence,
        line_items: included.map((l) => ({
          description: l.description.trim(),
          amount: (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
        })),
      })
      .select('id')
      .single()

    if (expenseError || !expense) {
      setStage('review')
      return setError(expenseError?.message ?? 'Could not save the invoice')
    }

    if (included.length) {
      // expense_id links them so the job-cost roll-up counts the spend once,
      // through the materials rather than twice.
      const { error: matError } = await client.from('materials').insert(
        included.map((l) => ({
          company_id: me.company_id,
          site_id: siteId,
          name: l.description.trim(),
          quantity: Number(l.quantity) || 0,
          unit: l.unit,
          unit_cost: Number(l.unit_cost) || 0,
          cost_code: l.cost_code || null,
          supplier: vendor.trim() || null,
          status: 'delivered',
          delivered_on: spentOn,
          expense_id: expense.id,
          created_by: me.id,
        })),
      )
      if (matError) {
        setStage('review')
        return setError(`Invoice saved, but the material lines failed: ${matError.message}`)
      }
    }

    reset()
    setNotice(`Saved ${included.length} material line${included.length === 1 ? '' : 's'} to ${site?.name}.`)
    onSaved()
  }

  const patch = (i: number, changes: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...changes } : l)))

  const reviewing = stage === 'review' || stage === 'saving'

  return (
    // 300px in the inbox's left column while idle/working, matching isExpenses.html;
    // once there is a line-item table to show it claims the full card width instead —
    // the parent's flex-wrap lets it drop to its own row rather than being crushed.
    <div style={{ flex: reviewing ? '1 1 100%' : '1 1 300px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: FAINT, whiteSpace: 'nowrap' }}>
          COSTED TO
        </span>
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          disabled={stage !== 'idle'}
          style={{
            height: 26, padding: '0 8px', borderRadius: 3, border: `1px solid ${theme.border}`,
            background: theme.panel, font: 'inherit', fontSize: 12.5, color: theme.ink, minWidth: 170,
          }}
        >
          <option value="">Choose a job…</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {stage === 'idle' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void handle(file)
          }}
          onClick={() => input.current?.click()}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 9, height: 158, border: `1.5px dashed ${over ? theme.accent : DASH_BORDER}`,
            borderRadius: 8, background: over ? theme.accentFill : SUBTLE_BG, textAlign: 'center',
            padding: '0 18px', cursor: 'pointer',
          }}
        >
          <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke={FAINT} strokeWidth={1.4}>
            <path d="M8 11.4V3.2M4.8 6.4L8 3.2l3.2 3.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.6 11v2.4h10.8V11" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Drop an invoice here to keep it</span>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: FAINT }}>
            PDF, photo or emailed bill. We read the vendor, date, total and tax, then you allocate it
            to a job and a cost code.
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); input.current?.click() }}
            style={{
              height: 30, padding: '0 13px', background: theme.panel, border: `1px solid ${theme.border}`,
              borderRadius: 3, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Choose a file
          </button>
          <input
            ref={input}
            type="file"
            accept={ACCEPTED.join(',')}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handle(file)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {(stage === 'uploading' || stage === 'reading') && (
        <div style={{ ...statusCard, textAlign: 'center' }}>
          {stage === 'uploading' ? 'Saving the invoice…' : `Reading ${fileName}…`}
        </div>
      )}

      {error && (
        <div style={{ ...statusCard, borderLeft: `3px solid ${theme.alert}`, color: theme.alert }}>
          {error}
        </div>
      )}
      {notice && stage === 'idle' && (
        <div style={{ ...statusCard, borderLeft: `3px solid ${theme.success}` }}>{notice}</div>
      )}

      {stage === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 12px', background: theme.appBg, borderRadius: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: FAINT }}>THREE WAYS IN</span>
          <span style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45, color: '#4A5057' }}>
            <span style={{ color: theme.accent, fontWeight: 700 }}>→</span>
            Crew photographs it on site — arrives coded to where they were standing
          </span>
          <span style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45, color: '#4A5057' }}>
            <span style={{ color: theme.accent, fontWeight: 700 }}>→</span>
            Forward the email to <b style={{ fontWeight: 600 }}>invoices@whitcombbuilders.com</b>
          </span>
          <span style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45, color: '#4A5057' }}>
            <span style={{ color: theme.accent, fontWeight: 700 }}>→</span>
            Drop a PDF here from the office
          </span>
        </div>
      )}

      {reviewing && (
        <div style={{ padding: 14, background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8 }}>
          {notice && (
            <div style={{ fontSize: 12, color: AMBER_FG, marginBottom: 10 }}>{notice}</div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Supplier" value={vendor} onChange={setVendor} width={200} />
            <label style={fieldLabel}>
              Invoice date
              <input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} style={{ ...fieldInput, width: 150 }} />
            </label>
            <Field label="Invoice total" value={total} onChange={setTotal} width={120} />
            <Field label="Tax" value={tax} onChange={setTax} width={110} />
            {confidence !== null && (
              <span style={{ fontSize: 11.5, color: FAINT, paddingBottom: 8 }}>
                Read from the invoice · {Math.round(confidence * 100)}% confident
              </span>
            )}
          </div>

          {aiNote && (
            <div style={{ fontSize: 11.5, color: FAINT, marginTop: 8, fontStyle: 'italic' }}>
              {aiNote}
            </div>
          )}

          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  {['', 'Material', 'Qty', 'Unit', 'Unit cost', 'Cost code', 'Line total'].map((h, i) => (
                    <th key={h + i} style={{ ...reviewTh, textAlign: i >= 2 && i !== 5 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} style={{ opacity: l.include ? 1 : 0.45 }}>
                    <td style={{ ...reviewTd, width: 28 }}>
                      <input type="checkbox" checked={l.include} onChange={(e) => patch(i, { include: e.target.checked })} />
                    </td>
                    <td style={reviewTd}>
                      <input value={l.description} onChange={(e) => patch(i, { description: e.target.value })} style={{ ...fieldInput, width: '100%' }} />
                    </td>
                    <td style={{ ...reviewTd, textAlign: 'right' }}>
                      <input value={l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} style={{ ...fieldInput, width: 70, textAlign: 'right' }} />
                    </td>
                    <td style={reviewTd}>
                      <select value={l.unit} onChange={(e) => patch(i, { unit: e.target.value })} style={{ ...fieldInput, width: 78 }}>
                        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td style={{ ...reviewTd, textAlign: 'right' }}>
                      <input value={l.unit_cost} onChange={(e) => patch(i, { unit_cost: e.target.value })} style={{ ...fieldInput, width: 90, textAlign: 'right' }} />
                    </td>
                    <td style={reviewTd}>
                      <select value={l.cost_code} onChange={(e) => patch(i, { cost_code: e.target.value })} style={{ ...fieldInput, width: 130 }}>
                        <option value="">Uncoded</option>
                        {costCodes.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                      </select>
                    </td>
                    <td style={{ ...reviewTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {money((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, fontSize: 12.5, flexWrap: 'wrap' }}>
            <button onClick={() => setLines([...lines, blankLine()])} style={ghostBtn}>
              Add a line
            </button>
            <span>
              {included.length} line{included.length === 1 ? '' : 's'} ·{' '}
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(linesTotal)}</strong>
            </span>
            {Math.abs(gap) > 0.02 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 11, background: AMBER_BG, color: AMBER_FG, fontWeight: 600 }}>
                {money(Math.abs(gap))} {gap > 0 ? 'unaccounted for' : 'over'} vs the invoice total — check for a missed line or a delivery fee.
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => void save()} disabled={stage === 'saving' || !included.length} style={cta}>
              {stage === 'saving' ? 'SAVING…' : `ADD ${included.length} LINE${included.length === 1 ? '' : 'S'} TO THE JOB`}
            </button>
            <button onClick={reset} style={ghostBtn}>Discard</button>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: FAINT }}>
              {fileName}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

const blankLine = (): Line => ({
  description: '', quantity: '1', unit: 'ea', unit_cost: '', cost_code: '', include: true,
})

function Field({
  label, value, onChange, width = 170,
}: { label: string; value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <label style={fieldLabel}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...fieldInput, width }} />
    </label>
  )
}

const fieldLabel = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em',
  color: FAINT,
} as const

const fieldInput = {
  display: 'block', height: 32, marginTop: 4, padding: '0 9px', borderRadius: 3,
  border: `1px solid ${theme.border}`, background: theme.panel, font: 'inherit',
  fontSize: 13, fontWeight: 400, color: theme.ink,
} as const

const statusCard = {
  padding: '14px', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8,
  fontSize: 13, color: theme.inkSoft,
} as const

const reviewTh = {
  padding: '6px 8px', borderBottom: `1px solid ${theme.border}`, background: SUBTLE_BG,
  fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: '#696D74',
} as const

const reviewTd = { padding: '5px 8px', borderBottom: `1px solid ${HAIRLINE}`, fontSize: 13 } as const

const ghostBtn = {
  padding: '5px 11px', borderRadius: 3, border: `1px solid ${theme.border}`,
  background: theme.panel, color: theme.ink, font: 'inherit', fontSize: 11.5, cursor: 'pointer',
} as const

const cta = {
  height: 32, padding: '0 15px', borderRadius: 3,
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: '#1A1D21', font: 'inherit', fontSize: 11.5, fontWeight: 700,
  letterSpacing: '.04em', cursor: 'pointer', whiteSpace: 'nowrap',
} as const
