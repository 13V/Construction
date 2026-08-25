import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../data/supabase'
import type { EstimateLineRow, EstimateRow, WorkerRow } from '../data/supabase'
import { costCodes } from '../data/seed'
import { DEFAULT_CENTER } from '../data/mapconfig'
import { theme } from '../theme'
import { money, money2 } from '../format'
import type { JobSite, Worker } from '../types'

/**
 * Estimates: quoting before there is a job, priced line by line and grouped
 * by cost code. Two rules from the schema drive almost everything here:
 *
 * - Every dollar on a line comes from `line_total`, a column Postgres
 *   generates as qty * unit_price * (1 + markup / 100). This file never
 *   computes that figure for anything it writes — only reads it back — so
 *   the number on screen can never drift from what is actually stored.
 * - A price the client has already seen is never edited in place. Creating
 *   a revision copies the estimate and its lines to a new row chained
 *   through parent_id, bumps the revision number, and only then marks the
 *   old row 'superseded' — a superseded row is evidence in a dispute, so
 *   nothing here writes to one again.
 *
 * The list below only shows the tip of each revision chain (the row nothing
 * else points at through parent_id); older revisions live inside the
 * detail view's Revisions card, which is read-only by design.
 */

type Status = EstimateRow['status']

interface Group {
  key: string
  code: string
  name: string
  items: EstimateLineRow[]
  subtotal: number
}

interface LineDraft {
  mode: 'line' | 'group'
  costCode: string
  name: string
  qty: string
  unit: string
  unitPrice: string
  markupPct: string
}

interface NewEstimateDraft {
  clientName: string
  title: string
  siteId: string
  note: string
}

const blankNewEstimate: NewEstimateDraft = { clientName: '', title: '', siteId: '', note: '' }

const UNITS = ['ea', 'lm', 'm', 'm²', 'm³', 'kg', 't', 'L', 'box', 'pack', 'sheet', 'hr']

// Canonical chart-of-accounts order, so groups read top-to-bottom the way an
// estimator expects rather than in whatever order lines happened to be added.
const CODE_ORDER = new Map(costCodes.map((c, i) => [c.code, i]))

// Pale-chip treatment for the status pill, matching the bg/fg pairings this
// design system already uses elsewhere (the amber pair is the literal one
// from this screen's own header; green/red are the same pairs isClockin,
// isCrewTime, isCrewMobile and isMap use) so a status added here reads as
// part of the same system instead of an invented colour.
const STATUS_CHIP: Record<Status, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: theme.appBg, fg: theme.inkSoft },
  awaiting_approval: { label: 'Awaiting approval', bg: '#FFF6DE', fg: '#8A6100' },
  approved: { label: 'Approved', bg: '#EAF7EC', fg: '#1B7A2C' },
  rejected: { label: 'Rejected', bg: '#FDECEE', fg: '#A00417' },
  superseded: { label: 'Superseded', bg: theme.appBg, fg: theme.inkSoft },
}

// Brighter, standalone dot colour — used where the dot carries the status on
// its own (the header chip, the Revisions timeline) rather than sitting next
// to same-colour text.
const STATUS_DOT: Record<Status, string> = {
  draft: theme.inkFaint,
  awaiting_approval: theme.warning,
  approved: theme.success,
  rejected: theme.alert,
  superseded: theme.inkFaint,
}

const qtyFmt = (n: number) => n.toLocaleString('en-AU', { maximumFractionDigits: 3 })
const pctFmt = (n: number) => `${n.toLocaleString('en-AU', { maximumFractionDigits: 2 })}%`

const disabledCss = (flag: boolean) =>
  flag ? { opacity: 0.5, cursor: 'not-allowed' as const } : {}

export function Estimates({ me, sites, workers: _workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  // `workers` is part of the shared feature-screen prop contract (every
  // screen in Dashboard.tsx gets the same bag), but nothing in schema_v4
  // links an estimate or its lines to a worker row, so the roster itself
  // isn't needed here.
  const canEdit = me.is_office

  const [estimates, setEstimates] = useState<EstimateRow[]>([])
  const [lines, setLines] = useState<EstimateLineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newDraft, setNewDraft] = useState<NewEstimateDraft | null>(null)
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()
    // estimate_lines has no company_id of its own — its read policy is
    // "estimate_id in (select id from estimates)", which is itself scoped to
    // the caller's company, so a plain select already comes back scoped.
    const [estRes, lineRes] = await Promise.all([
      client.from('estimates').select('*').order('created_at', { ascending: false }),
      client.from('estimate_lines').select('*').order('sort', { ascending: true }),
    ])
    if (estRes.error) {
      setError(estRes.error.message)
      setLoading(false)
      return
    }
    if (lineRes.error) {
      setError(lineRes.error.message)
      setLoading(false)
      return
    }
    setEstimates((estRes.data ?? []) as EstimateRow[])
    setLines((lineRes.data ?? []) as EstimateLineRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // A fresh detail view starts with no half-filled add-line form left over
  // from whichever estimate was open before.
  useEffect(() => {
    setLineDraft(null)
    setFormError(null)
  }, [selectedId])

  const byId = useMemo(() => new Map(estimates.map((e) => [e.id, e])), [estimates])

  const linesByEstimate = useMemo(() => {
    const map = new Map<string, EstimateLineRow[]>()
    for (const l of lines) {
      const arr = map.get(l.estimate_id)
      if (arr) arr.push(l)
      else map.set(l.estimate_id, [l])
    }
    return map
  }, [lines])

  const parentIds = useMemo(
    () => new Set(estimates.map((e) => e.parent_id).filter((x): x is string => x !== null)),
    [estimates],
  )

  const roots = useMemo(
    () => estimates.filter((e) => !e.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [estimates],
  )

  const tips = useMemo(() => estimates.filter((e) => !parentIds.has(e.id)), [estimates, parentIds])

  const isTip = (id: string): boolean => !parentIds.has(id)

  const rootOf = (e: EstimateRow): EstimateRow => {
    let cur = e
    while (cur.parent_id) {
      const parent = byId.get(cur.parent_id)
      if (!parent) break
      cur = parent
    }
    return cur
  }

  // No sequence column exists on estimates, so the human-readable number is
  // derived — position of the thread's root among all roots, created order —
  // rather than stored. Every revision in a thread shares this same number.
  const estimateNo = (e: EstimateRow): string => {
    const root = rootOf(e)
    const idx = roots.findIndex((r) => r.id === root.id)
    const year = new Date(root.created_at).getFullYear()
    return `EST-${year}-${idx >= 0 ? idx + 1 : root.id.slice(0, 4).toUpperCase()}`
  }

  const totalOf = (estimateId: string): number => {
    const arr = linesByEstimate.get(estimateId)
    return arr ? arr.reduce((sum, l) => sum + Number(l.line_total), 0) : 0
  }

  const siteNameOf = (id: string | null): string => sites.find((s) => s.id === id)?.name ?? '—'

  const revisionNote = (e: EstimateRow): string => {
    const created = new Date(e.created_at).toLocaleDateString('en-AU')
    if (e.note?.trim()) return `${created} · ${e.note.trim()}`
    if (e.status === 'superseded') return `${created} · Superseded`
    if (isTip(e.id)) return `${created} · Current revision`
    return created
  }

  const selected = selectedId ? byId.get(selectedId) ?? null : null
  const selectedLines = selectedId ? linesByEstimate.get(selectedId) ?? [] : []

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, EstimateLineRow[]>()
    for (const l of selectedLines) {
      const key = l.cost_code ?? ''
      const arr = map.get(key)
      if (arr) arr.push(l)
      else map.set(key, [l])
    }
    return [...map.entries()]
      .map(([key, items]) => {
        const found = costCodes.find((c) => c.code === key)
        return {
          key,
          code: key || '—',
          name: found ? found.name : key ? 'Other' : 'Uncoded',
          items: [...items].sort((a, b) => Number(a.sort) - Number(b.sort)),
          subtotal: items.reduce((sum, i) => sum + Number(i.line_total), 0),
        }
      })
      .sort(
        (a, b) =>
          (CODE_ORDER.get(a.key) ?? 999) - (CODE_ORDER.get(b.key) ?? 999) || a.key.localeCompare(b.key),
      )
  }, [selectedLines])

  const totals = useMemo(() => {
    const subtotal = selectedLines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unit_price), 0)
    const total = selectedLines.reduce((sum, l) => sum + Number(l.line_total), 0)
    return { subtotal, markup: total - subtotal, total }
  }, [selectedLines])

  const chain = useMemo(() => {
    if (!selected) return []
    let root = selected
    while (root.parent_id) {
      const parent = byId.get(root.parent_id)
      if (!parent) break
      root = parent
    }
    const result: EstimateRow[] = []
    const queue: EstimateRow[] = [root]
    while (queue.length) {
      const cur = queue.shift()
      if (!cur) break
      result.push(cur)
      for (const e of estimates) if (e.parent_id === cur.id) queue.push(e)
    }
    return result.sort((a, b) => Number(b.revision) - Number(a.revision))
  }, [selected, byId, estimates])

  const usedCodes = new Set(groups.map((g) => g.key).filter((k) => k !== ''))
  const unusedCodes = costCodes.filter((c) => !usedCodes.has(c.code))

  // You can only add to the tip of a revision chain — a superseded row (which
  // is, by construction, never a tip) stays exactly as it was when it was
  // superseded.
  const canEditLines = canEdit && selected !== null && isTip(selected.id)
  const canConvert =
    canEdit &&
    selected !== null &&
    isTip(selected.id) &&
    !selected.site_id &&
    selected.status !== 'approved' &&
    selected.status !== 'superseded'

  const draftCount = tips.filter((e) => e.status === 'draft').length
  const awaitingCount = tips.filter((e) => e.status === 'awaiting_approval').length
  const summaryText = `${tips.length} estimate${tips.length === 1 ? '' : 's'} · ${draftCount} draft · ${awaitingCount} awaiting approval`
  const summaryLine = `${selectedLines.length} line item${selectedLines.length === 1 ? '' : 's'} across ${groups.length} cost code${groups.length === 1 ? '' : 's'}`

  const totalsRows = [
    { k: 'Subtotal', v: money(totals.subtotal), bg: 'transparent', kFg: theme.inkSoft, fg: theme.ink, w: 400, size: 13 },
    { k: 'Markup', v: money(totals.markup), bg: 'transparent', kFg: theme.inkSoft, fg: theme.ink, w: 400, size: 13 },
    { k: 'Total', v: money(totals.total), bg: '#FAFBFC', kFg: theme.ink, fg: theme.ink, w: 700, size: 15 },
  ]

  function openAddForm(mode: LineDraft['mode']) {
    setFormError(null)
    if (mode === 'group') {
      const first = unusedCodes[0]
      if (!first) return
      setLineDraft({ mode, costCode: first.code, name: '', qty: '1', unit: 'ea', unitPrice: '', markupPct: '0' })
    } else {
      setLineDraft({ mode, costCode: groups[0]?.key ?? '', name: '', qty: '1', unit: 'ea', unitPrice: '', markupPct: '0' })
    }
  }

  async function createEstimate() {
    if (!newDraft) return
    if (!newDraft.title.trim()) {
      setError('A title is required.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase()
      .from('estimates')
      .insert({
        company_id: me.company_id,
        site_id: newDraft.siteId || null,
        client_name: newDraft.clientName.trim(),
        title: newDraft.title.trim(),
        revision: 1,
        parent_id: null,
        status: 'draft',
        note: newDraft.note.trim() || null,
      })
      .select('id')
      .single()
    if (err || !data) {
      setBusy(false)
      setError(err?.message ?? 'Could not create the estimate.')
      return
    }
    setNewDraft(null)
    await load()
    setBusy(false)
    setSelectedId((data as { id: string }).id)
    onChanged()
  }

  async function saveLine() {
    if (!lineDraft || !selected) return
    if (!lineDraft.name.trim()) {
      setFormError('A description is required.')
      return
    }
    const qty = Number(lineDraft.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError('Quantity must be a number greater than zero.')
      return
    }
    setBusy(true)
    setFormError(null)
    const nextSort = selectedLines.reduce((max, l) => Math.max(max, Number(l.sort)), -1) + 1
    const { error: err } = await supabase()
      .from('estimate_lines')
      .insert({
        estimate_id: selected.id,
        cost_code: lineDraft.costCode || null,
        name: lineDraft.name.trim(),
        qty,
        unit: lineDraft.unit.trim() || 'ea',
        unit_price: Number(lineDraft.unitPrice) || 0,
        markup_pct: Number(lineDraft.markupPct) || 0,
        sort: nextSort,
        // line_total is generated in Postgres — never included in the payload.
      })
    setBusy(false)
    if (err) {
      setFormError(err.message)
      return
    }
    setLineDraft(null)
    await load()
    onChanged()
  }

  async function duplicate(source: EstimateRow) {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase()
      .from('estimates')
      .insert({
        company_id: me.company_id,
        site_id: source.site_id,
        client_name: source.client_name,
        title: `${source.title} (copy)`,
        revision: 1,
        parent_id: null,
        status: 'draft',
        note: source.note,
      })
      .select('id')
      .single()
    if (err || !data) {
      setBusy(false)
      setError(err?.message ?? 'Could not duplicate the estimate.')
      return
    }
    const newId = (data as { id: string }).id
    const sourceLines = linesByEstimate.get(source.id) ?? []
    if (sourceLines.length) {
      const { error: linesErr } = await supabase()
        .from('estimate_lines')
        .insert(
          sourceLines.map((l) => ({
            estimate_id: newId,
            cost_code: l.cost_code,
            name: l.name,
            qty: l.qty,
            unit: l.unit,
            unit_price: l.unit_price,
            markup_pct: l.markup_pct,
            sort: l.sort,
          })),
        )
      if (linesErr) {
        setBusy(false)
        setError(linesErr.message)
        return
      }
    }
    await load()
    setBusy(false)
    setSelectedId(newId)
    onChanged()
  }

  async function createRevision(source: EstimateRow) {
    if (!canEdit || !isTip(source.id)) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase()
      .from('estimates')
      .insert({
        company_id: me.company_id,
        site_id: source.site_id,
        client_name: source.client_name,
        title: source.title,
        revision: Number(source.revision) + 1,
        parent_id: source.id,
        status: 'draft',
        note: source.note,
      })
      .select('id')
      .single()
    if (err || !data) {
      setBusy(false)
      setError(err?.message ?? 'Could not create the revision.')
      return
    }
    const newId = (data as { id: string }).id
    const sourceLines = linesByEstimate.get(source.id) ?? []
    if (sourceLines.length) {
      const { error: linesErr } = await supabase()
        .from('estimate_lines')
        .insert(
          sourceLines.map((l) => ({
            estimate_id: newId,
            cost_code: l.cost_code,
            name: l.name,
            qty: l.qty,
            unit: l.unit,
            unit_price: l.unit_price,
            markup_pct: l.markup_pct,
            sort: l.sort,
          })),
        )
      if (linesErr) {
        setBusy(false)
        setError(linesErr.message)
        return
      }
    }
    // Only flip the old revision once the new one and its lines exist —
    // its own line values are never touched, so the price it showed stays
    // intact if anyone needs to point back to it in a dispute.
    const { error: supErr } = await supabase()
      .from('estimates')
      .update({ status: 'superseded' })
      .eq('id', source.id)
    setBusy(false)
    if (supErr) {
      setError(supErr.message)
      return
    }
    await load()
    setSelectedId(newId)
    onChanged()
  }

  async function sendToClient(id: string) {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase()
      .from('estimates')
      .update({ status: 'awaiting_approval', sent_at: new Date().toISOString() })
      .eq('id', id)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged()
  }

  async function convertToJob(est: EstimateRow) {
    if (!canConvert) return
    setBusy(true)
    setError(null)
    const total = totalOf(est.id)
    const { data: site, error: siteErr } = await supabase()
      .from('job_sites')
      .insert({
        company_id: me.company_id,
        name: est.title,
        client_name: est.client_name,
        budget: total,
        // No address on file yet for a job born from an estimate — office
        // places it, and the geofence, from Job Sites once there's a location.
        lat: DEFAULT_CENTER.lat,
        lng: DEFAULT_CENTER.lng,
      })
      .select('id')
      .single()
    if (siteErr || !site) {
      setBusy(false)
      setError(siteErr?.message ?? 'Could not create the job site.')
      return
    }
    const { error: updErr } = await supabase()
      .from('estimates')
      .update({ status: 'approved', site_id: (site as { id: string }).id })
      .eq('id', est.id)
    setBusy(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await load()
    onChanged()
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: theme.appBg }}>
      {selected ? (
        <>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', background: theme.panel, borderBottom: `1px solid ${theme.border}`, overflowX: 'auto' }}>
            <button onClick={() => setSelectedId(null)} style={ghostBtn}>
              ← All estimates
            </button>
            <div style={{ flex: 'none', width: 1, height: 20, background: theme.border, margin: '0 4px' }} />
            <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {estimateNo(selected)} · {selected.title}
            </span>
            <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 11, background: theme.appBg, color: theme.inkSoft, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
              Rev {selected.revision}
            </span>
            <StatusChip status={selected.status} dot={STATUS_DOT[selected.status]} padding="3px 8px" />
            <div style={{ flex: 1 }} />
            <button
              onClick={() => void duplicate(selected)}
              disabled={!canEdit || busy}
              title={!canEdit ? 'Office access required' : undefined}
              style={{ ...ghostBtn, ...disabledCss(!canEdit || busy) }}
            >
              Duplicate
            </button>
            <button
              onClick={() => void sendToClient(selected.id)}
              disabled={!canEdit || busy || selected.status === 'superseded'}
              title={
                !canEdit
                  ? 'Office access required'
                  : selected.status === 'superseded'
                    ? "Superseded estimates can't be modified"
                    : undefined
              }
              style={{ ...goldCta, ...disabledCss(!canEdit || busy || selected.status === 'superseded') }}
            >
              SEND TO CLIENT
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px' }}>
            {error && <div style={{ marginBottom: 12, fontSize: 12.5, color: theme.alert }}>{error}</div>}

            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 880px', minWidth: 520, background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflowX: 'auto' }}>
                <div style={{ minWidth: 840, display: 'grid', columnGap: 10, gridTemplateColumns: '1fr 78px 62px 96px 74px 104px', padding: '7px 14px', background: '#FAFBFC', borderBottom: `1px solid ${theme.border}` }}>
                  <span style={colHead}>LINE ITEM</span>
                  <span style={{ ...colHead, textAlign: 'right' }}>QTY</span>
                  <span style={colHead}>UNIT</span>
                  <span style={{ ...colHead, textAlign: 'right' }}>UNIT PRICE</span>
                  <span style={{ ...colHead, textAlign: 'right' }}>MARKUP</span>
                  <span style={{ ...colHead, textAlign: 'right' }}>LINE TOTAL</span>
                </div>

                {loading && (
                  <div style={{ minWidth: 840, padding: '18px 14px', fontSize: 13, color: theme.inkSoft }}>Loading…</div>
                )}
                {!loading && groups.length === 0 && (
                  <div style={{ minWidth: 840, padding: '18px 14px', fontSize: 13, color: theme.inkSoft }}>
                    No line items yet — add a cost code below to get started.
                  </div>
                )}

                {groups.map((g) => (
                  <div key={g.key || 'uncoded'}>
                    <div style={{ minWidth: 840, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#F7F9FB', borderBottom: '1px solid #EDEFF1' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#8B9096' }}>{g.code}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{g.name}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money2(g.subtotal)}</span>
                    </div>
                    {g.items.map((i) => (
                      <div key={i.id} style={itemRow}>
                        <span style={{ fontSize: 13, paddingLeft: 14 }}>{i.name}</span>
                        <span style={{ fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{qtyFmt(Number(i.qty))}</span>
                        <span style={{ fontSize: 12.5, color: theme.inkSoft }}>{i.unit}</span>
                        <span style={{ fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money2(Number(i.unit_price))}</span>
                        <span style={{ fontSize: 13, textAlign: 'right', color: theme.inkSoft, fontVariantNumeric: 'tabular-nums' }}>{pctFmt(Number(i.markup_pct))}</span>
                        <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money2(Number(i.line_total))}</span>
                      </div>
                    ))}
                  </div>
                ))}

                <div style={{ minWidth: 840, display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: '#FAFBFC' }}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      if (canEditLines) openAddForm('line')
                    }}
                    title={!canEditLines ? 'Open the latest revision to add line items' : undefined}
                    style={{ fontSize: 12.5, fontWeight: 500, pointerEvents: canEditLines ? 'auto' : 'none', ...disabledCss(!canEditLines) }}
                  >
                    + Add line item
                  </a>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      if (canEditLines && unusedCodes.length > 0) openAddForm('group')
                    }}
                    title={
                      !canEditLines
                        ? 'Open the latest revision to add a cost code'
                        : unusedCodes.length === 0
                          ? 'Every cost code is already on this estimate'
                          : undefined
                    }
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      pointerEvents: canEditLines && unusedCodes.length > 0 ? 'auto' : 'none',
                      ...disabledCss(!canEditLines || unusedCodes.length === 0),
                    }}
                  >
                    + Add cost code
                  </a>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12.5, color: theme.inkSoft }}>{summaryLine}</span>
                </div>

                {lineDraft && canEditLines && (
                  <div style={{ minWidth: 840, padding: '12px 14px', borderTop: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {lineDraft.mode === 'group' ? 'Add a cost code' : 'Add a line item'}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <label style={fieldLabel}>
                        Cost code
                        <select
                          value={lineDraft.costCode}
                          onChange={(e) => setLineDraft({ ...lineDraft, costCode: e.target.value })}
                          style={{ ...fieldInput, width: 210 }}
                        >
                          {lineDraft.mode === 'line' && <option value="">Uncoded</option>}
                          {(lineDraft.mode === 'group' ? unusedCodes : costCodes).map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code} · {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field label="Description" value={lineDraft.name} onChange={(v) => setLineDraft({ ...lineDraft, name: v })} placeholder="Frame walk-in shower" width={220} />
                      <Field label="Qty" value={lineDraft.qty} onChange={(v) => setLineDraft({ ...lineDraft, qty: v })} width={70} />
                      <label style={fieldLabel}>
                        Unit
                        <select value={lineDraft.unit} onChange={(e) => setLineDraft({ ...lineDraft, unit: e.target.value })} style={{ ...fieldInput, width: 90 }}>
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field label="Unit price" value={lineDraft.unitPrice} onChange={(v) => setLineDraft({ ...lineDraft, unitPrice: v })} placeholder="0.00" width={100} />
                      <Field label="Markup %" value={lineDraft.markupPct} onChange={(v) => setLineDraft({ ...lineDraft, markupPct: v })} placeholder="0" width={90} />
                    </div>
                    <div style={{ fontSize: 12.5, color: theme.inkSoft }}>
                      Line total will be{' '}
                      <strong style={{ color: theme.ink, fontVariantNumeric: 'tabular-nums' }}>
                        {money2(
                          (Number(lineDraft.qty) || 0) *
                            (Number(lineDraft.unitPrice) || 0) *
                            (1 + (Number(lineDraft.markupPct) || 0) / 100),
                        )}
                      </strong>{' '}
                      — the database computes the final figure on save.
                    </div>
                    {formError && <div style={{ fontSize: 12, color: theme.alert }}>{formError}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => void saveLine()} disabled={busy} style={cta}>
                        {busy ? 'SAVING…' : 'SAVE'}
                      </button>
                      <button
                        onClick={() => {
                          setLineDraft(null)
                          setFormError(null)
                        }}
                        style={ghost}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ flex: '1 1 320px', minWidth: 290, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ padding: '11px 14px', borderBottom: `1px solid ${theme.border}`, fontSize: 15, fontWeight: 600 }}>Totals</div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {totalsRows.map((t) => (
                      <div key={t.k} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderBottom: '1px solid #F1F3F5', background: t.bg }}>
                        <span style={{ fontSize: 12.5, color: t.kFg, fontWeight: t.w }}>{t.k}</span>
                        <span style={{ fontSize: t.size, fontWeight: t.w, color: t.fg, fontVariantNumeric: 'tabular-nums' }}>{t.v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <button
                      onClick={() => void convertToJob(selected)}
                      disabled={!canConvert || busy}
                      title={
                        !canEdit
                          ? 'Office access required'
                          : selected.site_id
                            ? 'Already linked to a job site'
                            : selected.status === 'approved'
                              ? 'Already converted'
                              : !isTip(selected.id)
                                ? 'Open the latest revision to convert'
                                : undefined
                      }
                      style={{ width: '100%', height: 34, background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 3, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, ...disabledCss(!canConvert || busy) }}
                    >
                      Convert to job
                    </button>
                    <span style={{ fontSize: 11.5, lineHeight: 1.45, color: '#8B9096' }}>
                      Creates the job site, seeds the budget from these cost codes, and the geofence arms on the first scheduled shift.
                    </span>
                  </div>
                </div>

                <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ padding: '11px 14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>Revisions</span>
                    {canEditLines && (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          void createRevision(selected)
                        }}
                        style={{ fontSize: 11.5, fontWeight: 600, color: theme.accent }}
                      >
                        + New revision
                      </a>
                    )}
                  </div>
                  {chain.map((r) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F1F3F5' }}>
                      <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[r.status] }} />
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Rev {r.revision}</span>
                        <span style={{ fontSize: 11.5, color: '#8B9096' }}>{revisionNote(r)}</span>
                      </span>
                      <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(totalOf(r.id))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : selectedId ? (
        <>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', background: theme.panel, borderBottom: `1px solid ${theme.border}` }}>
            <button onClick={() => setSelectedId(null)} style={ghostBtn}>
              ← All estimates
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px', fontSize: 13, color: theme.inkSoft }}>
            {loading ? 'Loading…' : 'This estimate could not be found.'}
          </div>
        </>
      ) : (
        <>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', background: theme.panel, borderBottom: `1px solid ${theme.border}`, overflowX: 'auto' }}>
            <span style={{ flex: 'none', fontSize: 12.5, color: theme.inkSoft, whiteSpace: 'nowrap' }}>{summaryText}</span>
            <div style={{ flex: 1 }} />
            {loading && <span style={{ fontSize: 11.5, color: theme.inkSoft, whiteSpace: 'nowrap' }}>Loading…</span>}
            {canEdit && (
              <button onClick={() => setNewDraft(blankNewEstimate)} disabled={busy} style={goldCta}>
                NEW ESTIMATE
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px' }}>
            {error && <div style={{ marginBottom: 12, fontSize: 12.5, color: theme.alert }}>{error}</div>}

            {newDraft && (
              <div style={{ ...card, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New estimate</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Field label="Client" value={newDraft.clientName} onChange={(v) => setNewDraft({ ...newDraft, clientName: v })} placeholder="Priya Lindqvist" width={200} />
                  <Field label="Title" value={newDraft.title} onChange={(v) => setNewDraft({ ...newDraft, title: v })} placeholder="Harbor View 3B — bath addition" width={280} />
                  <label style={fieldLabel}>
                    Job site (optional)
                    <select value={newDraft.siteId} onChange={(e) => setNewDraft({ ...newDraft, siteId: e.target.value })} style={{ ...fieldInput, width: 200 }}>
                      <option value="">No site yet</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label style={{ ...fieldLabel, display: 'block', marginTop: 10 }}>
                  Note (optional)
                  <textarea
                    value={newDraft.note}
                    onChange={(e) => setNewDraft({ ...newDraft, note: e.target.value })}
                    rows={2}
                    style={{ ...fieldInput, width: '100%', height: 'auto', padding: 9, resize: 'vertical' as const }}
                  />
                </label>
                {error && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{error}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => void createEstimate()} disabled={busy} style={cta}>
                    {busy ? 'SAVING…' : 'CREATE ESTIMATE'}
                  </button>
                  <button
                    onClick={() => {
                      setNewDraft(null)
                      setError(null)
                    }}
                    style={ghost}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflowX: 'auto' }}>
              <div style={{ minWidth: 900, display: 'grid', columnGap: 10, gridTemplateColumns: '128px 1fr 150px 70px 100px 112px 150px', padding: '7px 14px', background: '#FAFBFC', borderBottom: `1px solid ${theme.border}` }}>
                <span style={colHead}>ESTIMATE</span>
                <span style={colHead}>CLIENT</span>
                <span style={colHead}>JOB SITE</span>
                <span style={colHead}>REV</span>
                <span style={colHead}>DATE</span>
                <span style={{ ...colHead, textAlign: 'right' }}>TOTAL</span>
                <span style={{ ...colHead, textAlign: 'right' }}>STATUS</span>
              </div>

              {loading && (
                <div style={{ minWidth: 900, padding: '20px 14px', fontSize: 13, color: theme.inkSoft }}>Loading…</div>
              )}
              {!loading && tips.length === 0 && (
                <div style={{ minWidth: 900, padding: '20px 14px', fontSize: 13, color: theme.inkSoft, lineHeight: 1.6 }}>
                  No estimates yet. Create the first one and its line items land in this same list once you send it.
                </div>
              )}

              {tips.map((row) => (
                <div
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  style={{ minWidth: 900, display: 'grid', columnGap: 10, gridTemplateColumns: '128px 1fr 150px 70px 100px 112px 150px', alignItems: 'center', padding: '9px 14px', borderBottom: '1px solid #F1F3F5', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.accent }}>{estimateNo(row)}</span>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.client_name || 'No client yet'}
                    </span>
                    <span style={{ fontSize: 11.5, color: '#8B9096', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.title}
                    </span>
                  </span>
                  <span style={{ fontSize: 12.5, color: '#4A5057' }}>{siteNameOf(row.site_id)}</span>
                  <span style={{ fontSize: 12.5, color: '#4A5057' }}>Rev {row.revision}</span>
                  <span style={{ fontSize: 12.5, color: '#4A5057' }}>{new Date(row.created_at).toLocaleDateString('en-AU')}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(totalOf(row.id))}</span>
                  <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <StatusChip status={row.status} dot={STATUS_CHIP[row.status].fg} padding="3px 9px" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatusChip({ status, dot, padding }: { status: Status; dot: string; padding: string }) {
  const meta = STATUS_CHIP[status]
  return (
    <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding, borderRadius: 11, background: meta.bg, color: meta.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
      {meta.label}
    </span>
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
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...fieldInput, width }}
      />
    </label>
  )
}

// ---- design-exact tokens (the estimate header bars, ported byte for byte
// from design/screens/isEstimates.html) -------------------------------------

const ghostBtn = {
  flex: 'none' as const,
  display: 'flex' as const,
  alignItems: 'center' as const,
  gap: 6,
  height: 27,
  padding: '0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer' as const,
  whiteSpace: 'nowrap' as const,
}

const goldCta = {
  flex: 'none' as const,
  display: 'flex' as const,
  alignItems: 'center' as const,
  height: 29,
  padding: '0 14px',
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: theme.ink,
  cursor: 'pointer' as const,
  whiteSpace: 'nowrap' as const,
}

const colHead = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  color: theme.inkSoft,
}

const itemRow = {
  minWidth: 840,
  display: 'grid' as const,
  columnGap: 10,
  gridTemplateColumns: '1fr 78px 62px 96px 74px 104px',
  alignItems: 'center' as const,
  padding: '8px 14px',
  borderBottom: '1px solid #F1F3F5',
}

// ---- generic form tokens (not in the design — mirrors Materials.tsx/
// Safety.tsx exactly, so the add-line and new-estimate forms match the rest
// of the app's own CRUD screens) --------------------------------------------

const card = {
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
}

const fieldLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
}

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
  textTransform: 'none' as const,
  color: theme.ink,
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
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}
