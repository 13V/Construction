import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  supabase,
  type PoLineRow,
  type PurchaseOrderRow,
  type WorkerRow,
} from '../data/supabase'
import { costCodes } from '../data/seed'
import { money, money2 } from '../format'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Purchase orders, grouped by job site.
 *
 * The list is only half of it — the point is the toolbar figure: what's been
 * committed to a vendor but hasn't landed on site yet. That's real money the
 * owner has spent that doesn't show up in any pile of lumber they can walk
 * up to, so it's computed fresh from ordered-vs-received on every open PO
 * rather than stored anywhere it could go stale.
 */

const UNITS = ['ea', 'lm', 'm', 'm²', 'm³', 'kg', 't', 'L', 'box', 'pack', 'sheet', 'hr']

const LIST_COLUMNS = '96px 1fr 148px 96px 108px 150px'
const LINE_COLUMNS = '1fr 92px 92px 104px 112px'

const STATUS_META: Record<PurchaseOrderRow['status'], { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: '#F1F2F4', fg: theme.inkSoft },
  sent: { label: 'Sent', bg: theme.accentFill, fg: theme.accent },
  partially_received: { label: 'Partially received', bg: '#FFF6DE', fg: '#8A6100' },
  received: { label: 'Received', bg: '#EAF7EC', fg: '#1B7A2C' },
  cancelled: { label: 'Cancelled', bg: '#F1F2F4', fg: theme.inkFaint },
}

/**
 * Sent-but-not-fully-landed is the only real "committed" state: a draft
 * never left the building, and received/cancelled have nothing outstanding.
 */
const OPEN_STATUSES = new Set<PurchaseOrderRow['status']>(['sent', 'partially_received'])

const SITE_PALETTE = ['#4E7FB0', '#8A6FCB', '#4E9E78', '#C08A3E', '#B15D87', '#5C8F99', '#8C8F52', '#B15F5F']

/**
 * Stable colour per job site, derived from its id. No palette to maintain by
 * hand as sites come and go, and the same site always reads the same colour.
 */
function siteColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return SITE_PALETTE[hash % SITE_PALETTE.length]!
}

/** Only touches "PO-1043"-style numbers; anything typed by hand is left alone. */
function suggestPoNo(rows: PurchaseOrderRow[]): string {
  let max = 1000
  for (const p of rows) {
    const m = /^PO-(\d+)$/.exec(p.po_no.trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `PO-${max + 1}`
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })

/** Green once every unit ordered has landed, amber mid-delivery, neutral before anything has. */
function lineProgress(received: number, ordered: number): { dot: string; fg: string } {
  if (ordered > 0 && received >= ordered) return { dot: '#1B7A2C', fg: '#1B7A2C' }
  if (received > 0) return { dot: '#8A6100', fg: '#8A6100' }
  return { dot: theme.border, fg: theme.inkFaint }
}

/** A PO's lines can carry different cost codes; collapse them to one breadcrumb segment. */
function costCodeSummary(lines: PoLineRow[]): string | null {
  const codes = [...new Set(lines.map((l) => l.cost_code).filter((c): c is string => Boolean(c)))]
  if (codes.length === 0) return null
  if (codes.length === 1) {
    const name = costCodes.find((c) => c.code === codes[0])?.name
    return name ? `${codes[0]} ${name}` : codes[0]!
  }
  return `${codes.length} cost codes`
}

interface LineDraft {
  key: string
  name: string
  orderedQty: string
  unit: string
  unitCost: string
  costCode: string
}

const blankLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  name: '',
  orderedQty: '1',
  unit: 'ea',
  unitCost: '',
  costCode: '',
})

interface PoForm {
  poNo: string
  vendor: string
  siteId: string
  issuedOn: string
  expectedOn: string
  note: string
  status: 'draft' | 'sent'
  lines: LineDraft[]
}

interface PoGroup {
  key: string
  site: string
  color: string
  rows: PurchaseOrderRow[]
  total: number
}

export function PurchaseOrders({
  me,
  sites,
  // Every screen sharing Dashboard's featureProps gets this prop, but a PO
  // has no worker-level assignment in the schema, so it isn't read here.
  workers: _workers,
  onChanged,
}: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const canEdit = me.is_office

  const [pos, setPos] = useState<PurchaseOrderRow[]>([])
  const [lines, setLines] = useState<PoLineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [groupMode, setGroupMode] = useState<'site' | 'date'>('site')
  const [vendorFilter, setVendorFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [form, setForm] = useState<PoForm | null>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [receiving, setReceiving] = useState(false)
  const [receiveDraft, setReceiveDraft] = useState<Record<string, string>>({})
  const [receiveBusy, setReceiveBusy] = useState(false)
  const [receiveError, setReceiveError] = useState<string | null>(null)

  const [detailBusy, setDetailBusy] = useState(false)
  // Separate from `error` (initial load) on purpose — that one gates whether
  // the whole list+detail section renders at all, so a failed status change
  // must not reuse it or the entire screen would vanish behind a banner.
  const [detailError, setDetailError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()

    const { data: poData, error: poErr } = await client
      .from('purchase_orders')
      .select('*')
      .order('issued_on', { ascending: false })
    if (poErr) {
      setError(poErr.message)
      setLoading(false)
      return
    }
    const poRows = (poData ?? []) as PurchaseOrderRow[]

    // po_lines has no company_id of its own — RLS scopes it through the
    // parent PO, so fetching by the ids we just loaded is enough either way.
    const ids = poRows.map((p) => p.id)
    const { data: lineData, error: lineErr } = ids.length
      ? await client.from('po_lines').select('*').in('po_id', ids).order('sort', { ascending: true })
      : { data: [] as PoLineRow[], error: null }
    if (lineErr) {
      setError(lineErr.message)
      setLoading(false)
      return
    }

    setPos(poRows)
    setLines((lineData ?? []) as PoLineRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Default to the most recently issued PO once the list arrives, and follow
  // along if the current selection ever disappears (e.g. after a reload).
  useEffect(() => {
    if (pos.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !pos.some((p) => p.id === selectedId)) {
      setSelectedId(pos[0]!.id)
    }
  }, [pos, selectedId])

  const siteName = (id: string | null) => (id ? sites.find((s) => s.id === id)?.name ?? 'Unknown site' : 'No job site')

  const linesByPo = useMemo(() => {
    const map = new Map<string, PoLineRow[]>()
    for (const l of lines) {
      const arr = map.get(l.po_id)
      if (arr) arr.push(l)
      else map.set(l.po_id, [l])
    }
    return map
  }, [lines])

  // Ordered value comes straight off the generated line_total (authoritative,
  // rounded server-side); received value is computed here since there's no
  // generated column for it, capped so a data mistake can't overstate it.
  const poTotals = useMemo(() => {
    const map = new Map<string, { ordered: number; received: number }>()
    for (const p of pos) {
      const ls = linesByPo.get(p.id) ?? []
      let ordered = 0
      let received = 0
      for (const l of ls) {
        const orderedQty = Number(l.ordered_qty)
        const cappedQty = Math.min(Number(l.received_qty), orderedQty)
        ordered += Number(l.line_total)
        received += cappedQty * Number(l.unit_cost)
      }
      map.set(p.id, { ordered, received })
    }
    return map
  }, [pos, linesByPo])

  const vendors = useMemo(
    () => [...new Set(pos.map((p) => p.vendor.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [pos],
  )

  const visiblePos = useMemo(
    () => (vendorFilter ? pos.filter((p) => p.vendor.trim() === vendorFilter) : pos),
    [pos, vendorFilter],
  )

  // The headline follows whatever the vendor filter currently shows, so
  // narrowing to one vendor answers "how much of THIS is still in the air".
  const committedNotReceived = useMemo(
    () =>
      visiblePos
        .filter((p) => OPEN_STATUSES.has(p.status))
        .reduce((sum, p) => {
          const t = poTotals.get(p.id)
          return sum + Math.max(0, (t?.ordered ?? 0) - (t?.received ?? 0))
        }, 0),
    [visiblePos, poTotals],
  )

  const groups = useMemo<PoGroup[]>(() => {
    if (groupMode === 'date') {
      const rows = [...visiblePos].sort((a, b) => b.issued_on.localeCompare(a.issued_on))
      if (rows.length === 0) return []
      const total = rows.reduce((sum, p) => sum + (poTotals.get(p.id)?.ordered ?? 0), 0)
      return [{ key: '__all__', site: 'All purchase orders', color: theme.inkFaint, rows, total }]
    }

    const map = new Map<string, PurchaseOrderRow[]>()
    for (const p of visiblePos) {
      const key = p.site_id ?? '__none__'
      const arr = map.get(key)
      if (arr) arr.push(p)
      else map.set(key, [p])
    }

    const out: PoGroup[] = []
    for (const [key, rows] of map) {
      rows.sort((a, b) => b.issued_on.localeCompare(a.issued_on))
      const total = rows.reduce((sum, p) => sum + (poTotals.get(p.id)?.ordered ?? 0), 0)
      out.push({
        key,
        site: key === '__none__' ? 'No job site' : siteName(key),
        color: key === '__none__' ? theme.inkFaint : siteColor(key),
        rows,
        total,
      })
    }
    // Named sites alphabetically; "No job site" always trails.
    out.sort((a, b) => (a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.site.localeCompare(b.site)))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePos, groupMode, poTotals, sites])

  const selectedPo = pos.find((p) => p.id === selectedId) ?? null
  const selectedLines = selectedId ? linesByPo.get(selectedId) ?? [] : []

  function selectPo(id: string) {
    if (id === selectedId) return // already viewing it — don't discard an in-progress receipt
    setSelectedId(id)
    setReceiving(false)
    setReceiveDraft({})
    setReceiveError(null)
    setDetailError(null)
  }

  // -------------------------------------------------------------- create PO

  function openCreate() {
    setForm({
      poNo: suggestPoNo(pos),
      vendor: '',
      siteId: sites[0]?.id ?? '',
      issuedOn: new Date().toISOString().slice(0, 10),
      expectedOn: '',
      note: '',
      status: 'draft',
      lines: [blankLine()],
    })
    setFormError(null)
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setForm((f) => (f ? { ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } : f))
  }

  function addLine() {
    setForm((f) => (f ? { ...f, lines: [...f.lines, blankLine()] } : f))
  }

  function removeLine(key: string) {
    setForm((f) => (f ? { ...f, lines: f.lines.filter((l) => l.key !== key) } : f))
  }

  async function createPo() {
    if (!form) return
    const poNo = form.poNo.trim()
    const vendor = form.vendor.trim()
    const usableLines = form.lines.filter((l) => l.name.trim())

    if (!poNo) {
      setFormError('A PO number is required.')
      return
    }
    if (!vendor) {
      setFormError('A vendor is required.')
      return
    }
    if (usableLines.length === 0) {
      setFormError('Add at least one line item.')
      return
    }

    setFormBusy(true)
    setFormError(null)
    const client = supabase()

    const { data: poRow, error: poErr } = await client
      .from('purchase_orders')
      .insert({
        // RLS also checks this matches the caller's own company.
        company_id: me.company_id,
        site_id: form.siteId || null,
        po_no: poNo,
        vendor,
        issued_on: form.issuedOn || new Date().toISOString().slice(0, 10),
        expected_on: form.expectedOn || null,
        status: form.status,
        note: form.note.trim() || null,
      })
      .select()
      .single()

    if (poErr || !poRow) {
      setFormBusy(false)
      // 23505 = unique_violation — (company_id, po_no) already exists.
      setFormError(
        poErr?.code === '23505'
          ? `PO number "${poNo}" is already used for this company — pick another.`
          : poErr?.message ?? 'Could not create the purchase order.',
      )
      return
    }

    const newPo = poRow as PurchaseOrderRow
    const { error: lineErr } = await client.from('po_lines').insert(
      usableLines.map((l, i) => ({
        po_id: newPo.id,
        name: l.name.trim(),
        ordered_qty: Number(l.orderedQty) || 0,
        unit: l.unit,
        unit_cost: Number(l.unitCost) || 0,
        cost_code: l.costCode || null,
        sort: i,
        // received_qty defaults to 0; line_total is generated — never sent.
      })),
    )

    if (lineErr) {
      // The PO shell saved but its lines didn't — leaving it behind would
      // show an empty, uneditable PO in the list, so undo it and let them
      // retry clean rather than surface a half-created record.
      await client.from('purchase_orders').delete().eq('id', newPo.id)
      setFormBusy(false)
      setFormError(lineErr.message)
      return
    }

    setFormBusy(false)
    setForm(null)
    setVendorFilter('')
    setSelectedId(newPo.id)
    await load()
    onChanged()
  }

  // ------------------------------------------------------------ status moves

  async function markSent() {
    if (!selectedPo) return
    setDetailBusy(true)
    setDetailError(null)
    const { error: err } = await supabase().from('purchase_orders').update({ status: 'sent' }).eq('id', selectedPo.id)
    setDetailBusy(false)
    if (err) {
      setDetailError(err.message)
      return
    }
    await load()
    onChanged()
  }

  async function cancelPo() {
    if (!selectedPo) return
    const ok = window.confirm(`Cancel ${selectedPo.po_no}? This can't be undone from here.`)
    if (!ok) return
    setDetailBusy(true)
    setDetailError(null)
    const { error: err } = await supabase()
      .from('purchase_orders')
      .update({ status: 'cancelled' })
      .eq('id', selectedPo.id)
    setDetailBusy(false)
    if (err) {
      setDetailError(err.message)
      return
    }
    await load()
    onChanged()
  }

  // --------------------------------------------------------- receive items

  function startReceiving() {
    if (!selectedPo) return
    const draft: Record<string, string> = {}
    for (const l of selectedLines) draft[l.id] = String(Number(l.received_qty))
    setReceiveDraft(draft)
    setReceiveError(null)
    setDetailError(null)
    setReceiving(true)
  }

  function cancelReceiving() {
    setReceiving(false)
    setReceiveDraft({})
    setReceiveError(null)
  }

  function fillAllReceived() {
    const draft: Record<string, string> = {}
    for (const l of selectedLines) draft[l.id] = String(Number(l.ordered_qty))
    setReceiveDraft(draft)
  }

  async function saveReceiving() {
    if (!selectedPo) return

    // Validate everything up front so a single bad edit can't half-save.
    const parsed: Record<string, number> = {}
    for (const l of selectedLines) {
      const raw = receiveDraft[l.id] ?? ''
      const n = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(n) || n < 0) {
        setReceiveError(`Enter a valid received quantity for "${l.name}".`)
        return
      }
      parsed[l.id] = n
    }

    setReceiveBusy(true)
    setReceiveError(null)
    const client = supabase()

    const changed = selectedLines.filter((l) => parsed[l.id] !== Number(l.received_qty))
    for (const l of changed) {
      const { error: err } = await client.from('po_lines').update({ received_qty: parsed[l.id] }).eq('id', l.id)
      if (err) {
        setReceiveError(err.message)
        setReceiveBusy(false)
        await load()
        return
      }
    }

    // Received in full only counts once every line clears its ordered qty;
    // anything landed but not everything means partially received.
    const allIn = selectedLines.length > 0 && selectedLines.every((l) => parsed[l.id]! >= Number(l.ordered_qty))
    const anyIn = selectedLines.some((l) => parsed[l.id]! > 0)
    const nextStatus: PurchaseOrderRow['status'] = allIn ? 'received' : anyIn ? 'partially_received' : selectedPo.status

    if (nextStatus !== selectedPo.status) {
      const { error: err } = await client
        .from('purchase_orders')
        .update({ status: nextStatus })
        .eq('id', selectedPo.id)
      if (err) {
        setReceiveError(err.message)
        setReceiveBusy(false)
        await load()
        return
      }
    }

    setReceiveBusy(false)
    setReceiving(false)
    setReceiveDraft({})
    await load()
    onChanged()
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg }}>
      {/* toolbar */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 40,
          padding: '0 12px',
          background: theme.panel,
          borderBottom: `1px solid ${theme.border}`,
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            flex: 'none',
            display: 'flex',
            height: 27,
            border: `1px solid ${theme.border}`,
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => setGroupMode('site')}
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              padding: '0 11px',
              border: 0,
              borderRight: `1px solid ${theme.border}`,
              font: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: groupMode === 'site' ? theme.accentFill : theme.panel,
              color: groupMode === 'site' ? theme.accent : theme.ink,
              fontWeight: groupMode === 'site' ? 600 : 400,
            }}
          >
            By job site
          </button>
          <button
            onClick={() => setGroupMode('date')}
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              padding: '0 11px',
              border: 0,
              font: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: groupMode === 'date' ? theme.accentFill : theme.panel,
              color: groupMode === 'date' ? theme.accent : theme.ink,
              fontWeight: groupMode === 'date' ? 600 : 400,
            }}
          >
            Newest first
          </button>
        </div>

        <label style={{ position: 'relative', flex: 'none', display: 'flex' }}>
          <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} style={vendorSelectStyle}>
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <span
            style={{
              position: 'absolute',
              right: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              opacity: 0.5,
              fontSize: 9,
              pointerEvents: 'none',
            }}
          >
            ▾
          </span>
        </label>

        <div style={{ flex: 'none', width: 1, height: 20, background: theme.border, margin: '0 4px' }} />

        <span
          style={{
            flex: 'none',
            fontSize: 12.5,
            color: theme.inkSoft,
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {money(committedNotReceived)} committed and not yet received
        </span>

        <div style={{ flex: 1 }} />

        {canEdit && !form && (
          <button onClick={openCreate} style={ctaToolbar}>
            NEW PURCHASE ORDER
          </button>
        )}
      </div>

      {/* scroll area */}
      <div data-scrollarea="1" style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px' }}>
        {form && (
          <div style={{ marginBottom: 14, padding: 14, background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New purchase order</div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="PO number" value={form.poNo} onChange={(v) => setForm({ ...form, poNo: v })} width={130} />
              <Field
                label="Vendor"
                value={form.vendor}
                onChange={(v) => setForm({ ...form, vendor: v })}
                placeholder="Pacific Truss Co."
                width={220}
              />
              <label style={fieldLabel}>
                Job site
                <select
                  value={form.siteId}
                  onChange={(e) => setForm({ ...form, siteId: e.target.value })}
                  style={{ ...fieldInput, width: 200 }}
                >
                  <option value="">No job site</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={fieldLabel}>
                Issued
                <input
                  type="date"
                  value={form.issuedOn}
                  onChange={(e) => setForm({ ...form, issuedOn: e.target.value })}
                  style={{ ...fieldInput, width: 145 }}
                />
              </label>
              <label style={fieldLabel}>
                Expected
                <input
                  type="date"
                  value={form.expectedOn}
                  onChange={(e) => setForm({ ...form, expectedOn: e.target.value })}
                  style={{ ...fieldInput, width: 145 }}
                />
              </label>
              <label style={fieldLabel}>
                Status
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as 'draft' | 'sent' })}
                  style={{ ...fieldInput, width: 120 }}
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                </select>
              </label>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ ...fieldLabel, marginBottom: 6 }}>Line items</div>
              {form.lines.map((l) => (
                <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 6, flexWrap: 'wrap' }}>
                  <Field
                    label="Item"
                    value={l.name}
                    onChange={(v) => updateLine(l.key, { name: v })}
                    placeholder="90x45 MGP10 truss"
                    width={220}
                  />
                  <Field
                    label="Ordered qty"
                    value={l.orderedQty}
                    onChange={(v) => updateLine(l.key, { orderedQty: v })}
                    width={90}
                  />
                  <label style={fieldLabel}>
                    Unit
                    <select
                      value={l.unit}
                      onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                      style={{ ...fieldInput, width: 90 }}
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="Unit cost"
                    value={l.unitCost}
                    onChange={(v) => updateLine(l.key, { unitCost: v })}
                    placeholder="8.42"
                    width={100}
                  />
                  <label style={fieldLabel}>
                    Cost code
                    <select
                      value={l.costCode}
                      onChange={(e) => updateLine(l.key, { costCode: e.target.value })}
                      style={{ ...fieldInput, width: 190 }}
                    >
                      <option value="">Uncoded</option>
                      {costCodes.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span
                    style={{
                      height: 32,
                      minWidth: 90,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      fontSize: 12.5,
                      color: theme.inkSoft,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {money2((Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0))}
                  </span>
                  <button onClick={() => removeLine(l.key)} disabled={form.lines.length === 1} style={formGhost}>
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={addLine} style={formGhost}>
                + Add line item
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 13 }}>
              Order total{' '}
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                {money2(form.lines.reduce((sum, l) => sum + (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0), 0))}
              </strong>
            </div>

            {formError && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{formError}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void createPo()} disabled={formBusy} style={formCta}>
                {formBusy ? 'SAVING…' : 'CREATE PURCHASE ORDER'}
              </button>
              <button
                onClick={() => {
                  setForm(null)
                  setFormError(null)
                }}
                style={formGhost}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && <div style={{ padding: 20, fontSize: 13, color: theme.inkSoft }}>Loading purchase orders…</div>}

        {!loading && error && <div style={{ ...cardStyle, color: theme.alert, fontSize: 12.5 }}>{error}</div>}

        {!loading && !error && pos.length === 0 && (
          <div style={{ ...cardStyle, padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No purchase orders yet</div>
            <p style={{ fontSize: 12.5, color: theme.inkSoft, margin: 0 }}>
              Raise one against a vendor and its committed cost shows up here before anything lands on site.
            </p>
          </div>
        )}

        {!loading && !error && pos.length > 0 && (
          <>
            {/* grouped list */}
            <div
              style={{
                background: theme.panel,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                overflowX: 'auto',
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  minWidth: 900,
                  display: 'grid',
                  columnGap: 10,
                  gridTemplateColumns: LIST_COLUMNS,
                  padding: '7px 14px',
                  background: '#FAFBFC',
                  borderBottom: `1px solid ${theme.border}`,
                }}
              >
                <span style={colHead}>PO</span>
                <span style={colHead}>VENDOR</span>
                <span style={colHead}>JOB SITE</span>
                <span style={colHead}>DATE</span>
                <span style={{ ...colHead, textAlign: 'right' }}>AMOUNT</span>
                <span style={{ ...colHead, textAlign: 'right' }}>STATUS</span>
              </div>

              {groups.length === 0 && (
                <div style={{ padding: '18px 14px', fontSize: 12.5, color: theme.inkSoft }}>
                  No purchase orders from this vendor.
                </div>
              )}

              {groups.map((g) => (
                <Fragment key={g.key}>
                  <div
                    style={{
                      minWidth: 900,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 14px',
                      background: '#F7F9FB',
                      borderBottom: '1px solid #EDEFF1',
                    }}
                  >
                    <span style={{ flex: 'none', width: 9, height: 9, borderRadius: 2, background: g.color }} />
                    <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{g.site}</span>
                    <span style={{ fontSize: 11.5, color: '#8B9096', whiteSpace: 'nowrap' }}>
                      {g.rows.length} PO{g.rows.length === 1 ? '' : 's'}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: '#8B9096', whiteSpace: 'nowrap' }}>Total</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {money(g.total)}
                    </span>
                  </div>

                  {g.rows.map((p) => {
                    const status = STATUS_META[p.status]
                    const selected = p.id === selectedId
                    const amount = poTotals.get(p.id)?.ordered ?? 0
                    const lineCount = linesByPo.get(p.id)?.length ?? 0
                    const note = (p.note ?? '').trim() || `${lineCount} item${lineCount === 1 ? '' : 's'}`
                    return (
                      <div
                        key={p.id}
                        onClick={() => selectPo(p.id)}
                        style={{
                          minWidth: 900,
                          display: 'grid',
                          columnGap: 10,
                          gridTemplateColumns: LIST_COLUMNS,
                          alignItems: 'center',
                          padding: '9px 14px',
                          borderBottom: '1px solid #F1F3F5',
                          background: selected ? theme.accentFill : theme.panel,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.accent }}>{p.po_no}</span>
                        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{p.vendor || 'Unnamed vendor'}</span>
                          <span style={{ fontSize: 11.5, color: '#8B9096' }}>{note}</span>
                        </span>
                        <span style={{ fontSize: 12.5, color: '#4A5057' }}>{siteName(p.site_id)}</span>
                        <span style={{ fontSize: 12.5, color: '#4A5057' }}>{fmtDate(p.issued_on)}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {money(amount)}
                        </span>
                        <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 9px',
                              borderRadius: 11,
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              background: status.bg,
                              color: status.fg,
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.fg }} />
                            {status.label}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>

            {/* PO detail */}
            {selectedPo &&
              (() => {
                const po = selectedPo
                const status = STATUS_META[po.status]
                // Anything short of received/cancelled is still in flight —
                // open to a cancellation or another round of receiving.
                const inFlight = po.status !== 'received' && po.status !== 'cancelled'
                const subtitle = [
                  siteName(po.site_id),
                  costCodeSummary(selectedLines),
                  `ordered ${fmtDate(po.issued_on)}`,
                  po.expected_on ? `delivery ${fmtDate(po.expected_on)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
                const totals = poTotals.get(po.id)
                const receivedValue = totals?.received ?? 0
                const orderedValue = totals?.ordered ?? 0
                const fullyInCount = selectedLines.filter((l) => Number(l.received_qty) >= Number(l.ordered_qty)).length
                const showBanner = receivedValue > 0

                return (
                  <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 14,
                        padding: '13px 15px',
                        borderBottom: `1px solid ${theme.border}`,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 16, fontWeight: 600 }}>
                            {po.po_no} · {po.vendor || 'Unnamed vendor'}
                          </span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 9px',
                              borderRadius: 11,
                              background: status.bg,
                              color: status.fg,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {status.label}
                          </span>
                        </span>
                        <span style={{ fontSize: 12.5, color: theme.inkSoft }}>{subtitle}</span>
                      </div>

                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {canEdit && inFlight && !receiving && (
                          <button onClick={() => void cancelPo()} disabled={detailBusy} style={ghostBtn}>
                            Cancel PO
                          </button>
                        )}
                        {canEdit && po.status === 'draft' && !receiving && (
                          <button onClick={() => void markSent()} disabled={detailBusy} style={ghostBtn}>
                            Mark as sent
                          </button>
                        )}
                        <button onClick={() => window.print()} style={ghostBtn}>
                          Print
                        </button>
                        {canEdit && inFlight && !receiving && (
                          <button onClick={startReceiving} style={ctaReceive}>
                            RECEIVE ITEMS
                          </button>
                        )}
                        {canEdit && receiving && (
                          <>
                            <button onClick={cancelReceiving} style={ghostBtn}>
                              Cancel
                            </button>
                            <button onClick={() => void saveReceiving()} disabled={receiveBusy} style={ctaReceive}>
                              {receiveBusy ? 'SAVING…' : 'SAVE RECEIPT'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {detailError && (
                      <div style={{ padding: '8px 15px', fontSize: 12, color: theme.alert, borderBottom: `1px solid ${theme.border}` }}>
                        {detailError}
                      </div>
                    )}
                    {receiveError && (
                      <div style={{ padding: '8px 15px', fontSize: 12, color: theme.alert, borderBottom: `1px solid ${theme.border}` }}>
                        {receiveError}
                      </div>
                    )}
                    {receiving && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 15px',
                          fontSize: 11.5,
                          color: theme.inkSoft,
                          borderBottom: `1px solid ${theme.border}`,
                        }}
                      >
                        Enter what's landed for each line below.
                        <button onClick={fillAllReceived} style={formGhost}>
                          Mark all as received
                        </button>
                      </div>
                    )}

                    <div style={{ overflowX: 'auto' }}>
                      <div
                        style={{
                          minWidth: 780,
                          display: 'grid',
                          columnGap: 10,
                          gridTemplateColumns: LINE_COLUMNS,
                          padding: '7px 15px',
                          background: '#FAFBFC',
                          borderBottom: `1px solid ${theme.border}`,
                        }}
                      >
                        <span style={colHead}>ITEM</span>
                        <span style={{ ...colHead, textAlign: 'right' }}>ORDERED</span>
                        <span style={{ ...colHead, textAlign: 'right' }}>RECEIVED</span>
                        <span style={{ ...colHead, textAlign: 'right' }}>UNIT</span>
                        <span style={{ ...colHead, textAlign: 'right' }}>TOTAL</span>
                      </div>

                      {selectedLines.length === 0 && (
                        <div style={{ padding: '18px 15px', fontSize: 12.5, color: theme.inkSoft }}>No line items on this order.</div>
                      )}

                      {selectedLines.map((l) => {
                        const ordered = Number(l.ordered_qty)
                        const received = Number(l.received_qty)
                        const progress = lineProgress(received, ordered)
                        return (
                          <div
                            key={l.id}
                            style={{
                              minWidth: 780,
                              display: 'grid',
                              columnGap: 10,
                              gridTemplateColumns: LINE_COLUMNS,
                              alignItems: 'center',
                              padding: '9px 15px',
                              borderBottom: '1px solid #F1F3F5',
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: progress.dot }} />
                              <span style={{ fontSize: 13, fontWeight: 500 }}>
                                {l.name}
                                {l.cost_code && <span style={{ color: theme.inkFaint, fontWeight: 400 }}> · {l.cost_code}</span>}
                              </span>
                            </span>
                            <span style={{ fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{ordered}</span>
                            {receiving ? (
                              <input
                                value={receiveDraft[l.id] ?? ''}
                                onChange={(e) => setReceiveDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                                aria-label={`Received quantity for ${l.name}`}
                                style={receiveInput}
                              />
                            ) : (
                              <span
                                style={{
                                  fontSize: 13,
                                  textAlign: 'right',
                                  fontWeight: 600,
                                  fontVariantNumeric: 'tabular-nums',
                                  color: progress.fg,
                                }}
                              >
                                {received}
                              </span>
                            )}
                            <span style={{ fontSize: 13, textAlign: 'right', color: '#4A5057' }}>{l.unit}</span>
                            <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                              {money2(Number(l.line_total))}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/*
                      The design's mock copy here describes an AP invoice
                      auto-matched against this PO — a feature this build has
                      no data for (no invoice-inbox / PO linkage in schema).
                      Same banner, same colours, real computed content instead.
                    */}
                    {showBanner && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 15px', background: '#EAF7EC', borderTop: '1px solid #C9E7CE' }}>
                        <svg width={17} height={17} viewBox="0 0 16 16" fill="none" stroke="#1B7A2C" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
                          <path d="M3 8.4l3.2 3.2L13 4.8" />
                        </svg>
                        <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: '#1B6B29' }}>
                          <b style={{ fontWeight: 700 }}>{po.status === 'received' ? 'All items received.' : 'Partially received.'}</b>{' '}
                          {po.status === 'received'
                            ? `Every line on this order landed — ${selectedLines.length} item${selectedLines.length === 1 ? '' : 's'} totalling ${money2(receivedValue)}.`
                            : `${fullyInCount} of ${selectedLines.length} line${selectedLines.length === 1 ? '' : 's'} fully in — ${money2(receivedValue)} landed against ${money2(orderedValue)} ordered.`}
                        </span>
                        {po.status !== 'received' && canEdit && !receiving && (
                          <button
                            onClick={startReceiving}
                            style={{
                              flex: 'none',
                              border: 'none',
                              background: 'none',
                              font: 'inherit',
                              fontSize: 12.5,
                              fontWeight: 500,
                              color: '#1B6B29',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Receive the rest →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  width = 170,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
}) {
  return (
    <label style={fieldLabel}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...fieldInput, width }} />
    </label>
  )
}

const cardStyle = {
  marginBottom: 14,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const colHead = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  color: theme.inkSoft,
} as const

const fieldLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: theme.inkFaint,
} as const

const fieldInput = {
  display: 'block',
  height: 32,
  marginTop: 4,
  padding: '0 9px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: 0,
  textTransform: 'none',
  color: theme.ink,
} as const

const formGhost = {
  padding: '4px 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
} as const

const formCta = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
} as const

// The two buttons below reproduce isPOs.html's literal CTA/ghost pixels —
// gradient direction, border, sizing — which differ from formCta/formGhost
// above (this codebase's usual form-button convention, used where the design
// has no opinion, e.g. inside the new-PO form).
const ctaToolbar = {
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
  color: '#1A1D21',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const ctaReceive = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  height: 29,
  padding: '0 13px',
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: '#1A1D21',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const ghostBtn = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 29,
  padding: '0 11px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const vendorSelectStyle = {
  flex: 'none',
  appearance: 'none',
  WebkitAppearance: 'none',
  height: 27,
  padding: '0 22px 0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  color: theme.ink,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const receiveInput = {
  width: '100%',
  height: 24,
  padding: '0 6px',
  borderRadius: 3,
  border: `1px solid ${theme.accent}`,
  font: 'inherit',
  fontSize: 12.5,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  color: theme.ink,
} as const
