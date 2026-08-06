import { useCallback, useRef, useState } from 'react'
import { supabase, type WorkerRow } from '../data/supabase'
import { BUCKET_RECEIPTS, objectPath, uploadFile } from '../data/storage'
import { costCodes } from '../data/seed'
import { theme } from '../theme'
import type { JobSite } from '../types'

/**
 * Drop a supplier invoice on a job and it becomes a costed material list.
 *
 * The file is stored first and the expense row written even when extraction
 * fails, because the invoice itself is the record — losing it because an AI
 * call timed out would be the worst outcome. Extracted lines are always shown
 * for review before anything is committed to the job cost.
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

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

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

        const res = await fetch('/api/parse-receipt', {
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
  const gap = invoiceTotal > 0 ? invoiceTotal - linesTotal : 0

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

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={statLabel}>DROP A SUPPLIER INVOICE</span>
        <span style={{ fontSize: 11.5, color: theme.inkSoft }}>costed to</span>
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          disabled={stage !== 'idle'}
          style={{ ...input, marginTop: 0, height: 26, width: 200 }}
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
            border: `2px dashed ${over ? theme.accent : theme.border}`,
            background: over ? theme.accentFill : theme.panel,
            borderRadius: 8,
            padding: '26px 20px',
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            Drop a PDF invoice or photo here
          </div>
          <div style={{ fontSize: 12.5, color: theme.inkSoft, marginTop: 5, lineHeight: 1.5 }}>
            The file is filed against{' '}
            <strong>{site?.name ?? 'the job you pick above'}</strong>, then every line is read
            out and costed to the job. You review before anything is saved.
          </div>
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
        <div style={{ ...card, textAlign: 'center', color: theme.inkSoft, fontSize: 13 }}>
          {stage === 'uploading' ? 'Saving the invoice…' : `Reading ${fileName}…`}
        </div>
      )}

      {error && (
        <div style={{ ...card, borderLeft: `3px solid ${theme.alert}`, color: theme.alert, fontSize: 12.5 }}>
          {error}
        </div>
      )}
      {notice && stage === 'idle' && (
        <div style={{ ...card, borderLeft: `3px solid ${theme.success}`, fontSize: 12.5 }}>{notice}</div>
      )}

      {(stage === 'review' || stage === 'saving') && (
        <div style={card}>
          {notice && (
            <div style={{ fontSize: 12, color: '#8A6100', marginBottom: 10 }}>{notice}</div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Supplier" value={vendor} onChange={setVendor} width={200} />
            <label style={fieldLabel}>
              Invoice date
              <input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} style={{ ...input, width: 150 }} />
            </label>
            <Field label="Invoice total" value={total} onChange={setTotal} width={120} />
            <Field label="Tax" value={tax} onChange={setTax} width={110} />
            {confidence !== null && (
              <span style={{ fontSize: 11.5, color: theme.inkSoft, paddingBottom: 8 }}>
                Read from the invoice · {Math.round(confidence * 100)}% confident
              </span>
            )}
          </div>

          {aiNote && (
            <div style={{ fontSize: 11.5, color: theme.inkSoft, marginTop: 8, fontStyle: 'italic' }}>
              {aiNote}
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
            <thead>
              <tr>
                {['', 'Material', 'Qty', 'Unit', 'Unit cost', 'Cost code', 'Line total'].map((h, i) => (
                  <th key={h + i} style={{ ...th, textAlign: i >= 2 && i !== 5 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} style={{ opacity: l.include ? 1 : 0.45 }}>
                  <td style={{ ...td, width: 28 }}>
                    <input type="checkbox" checked={l.include} onChange={(e) => patch(i, { include: e.target.checked })} />
                  </td>
                  <td style={td}>
                    <input value={l.description} onChange={(e) => patch(i, { description: e.target.value })} style={{ ...input, marginTop: 0, width: '100%' }} />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <input value={l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} style={{ ...input, marginTop: 0, width: 70, textAlign: 'right' }} />
                  </td>
                  <td style={td}>
                    <select value={l.unit} onChange={(e) => patch(i, { unit: e.target.value })} style={{ ...input, marginTop: 0, width: 78 }}>
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <input value={l.unit_cost} onChange={(e) => patch(i, { unit_cost: e.target.value })} style={{ ...input, marginTop: 0, width: 90, textAlign: 'right' }} />
                  </td>
                  <td style={td}>
                    <select value={l.cost_code} onChange={(e) => patch(i, { cost_code: e.target.value })} style={{ ...input, marginTop: 0, width: 130 }}>
                      <option value="">Uncoded</option>
                      {costCodes.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {money((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, fontSize: 12.5 }}>
            <button onClick={() => setLines([...lines, blankLine()])} style={ghost}>
              Add a line
            </button>
            <span>
              {included.length} line{included.length === 1 ? '' : 's'} ·{' '}
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(linesTotal)}</strong>
            </span>
            {Math.abs(gap) > 0.02 && (
              <span style={{ color: theme.warning }}>
                {money(Math.abs(gap))} {gap > 0 ? 'unaccounted for' : 'over'} vs the invoice total —
                check for a missed line or a delivery fee.
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => void save()} disabled={stage === 'saving' || !included.length} style={cta}>
              {stage === 'saving' ? 'SAVING…' : `ADD ${included.length} LINE${included.length === 1 ? '' : 'S'} TO THE JOB`}
            </button>
            <button onClick={reset} style={ghost}>Discard</button>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: theme.inkSoft, alignSelf: 'center' }}>
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
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, width }} />
    </label>
  )
}

const statLabel = {
  fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em',
  textTransform: 'uppercase' as const, color: theme.inkFaint,
}
const fieldLabel = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em',
  textTransform: 'uppercase' as const, color: theme.inkFaint,
}
const input = {
  display: 'block', height: 32, marginTop: 4, padding: '0 9px', borderRadius: 3,
  border: `1px solid ${theme.border}`, background: theme.panel, font: 'inherit',
  fontSize: 13, fontWeight: 400, letterSpacing: 0, textTransform: 'none' as const, color: theme.ink,
}
const card = {
  marginTop: 10, padding: 14, background: theme.panel,
  border: `1px solid ${theme.border}`, borderRadius: 8,
}
const th = {
  padding: '6px 8px', borderBottom: `1px solid ${theme.border}`, background: theme.appBg,
  fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em',
  textTransform: 'uppercase' as const, color: theme.inkFaint,
}
const td = { padding: '5px 8px', borderBottom: `1px solid ${theme.border}`, fontSize: 13 }
const ghost = {
  padding: '5px 11px', borderRadius: 3, border: `1px solid ${theme.border}`,
  background: theme.panel, color: theme.ink, font: 'inherit', fontSize: 11.5, cursor: 'pointer',
}
const cta = {
  padding: '7px 13px', borderRadius: 3, border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink, font: 'inherit', fontSize: 11, fontWeight: 700,
  letterSpacing: '.04em', cursor: 'pointer',
}
