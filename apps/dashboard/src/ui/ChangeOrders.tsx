import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type ChangeOrderLineRow, type ChangeOrderRow, type WorkerRow } from '../data/supabase'
import { costCodes } from '../data/seed'
import { money, money2 } from '../format'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Variations — scope and price changes to the contract, tracked from draft
 * through the builder's approval. Grouped by job site because that is how the
 * office actually reads exposure on a job: "what's still unapproved here" is a
 * per-site question, not a per-variation one.
 *
 * Called "variations" throughout, and numbered VO-n, because that is the word
 * used on every Australian site — a builder asks for a VO, never a CO. The
 * table is still `change_orders` (schema_v4) and existing CO-n numbers are left
 * alone; renaming rows would break the builder's own references to them.
 *
 * The cost impact is always the sum of its scope lines rather than a number
 * typed in separately — a variation's whole job is to trace a price back to an
 * itemised scope, and that trace can never be allowed to drift once a builder
 * has approved against it.
 *
 * Approving one is no longer just a status change. Since schema_v17 an approved
 * variation joins the contract sum: `job_value_v` adds it, the Contract tab
 * shows it on the value ladder, and the Budget tab's margin is measured against
 * the total. That is what the client meant by a variation "going on the
 * contract", and it is why the approval date is stamped by the database rather
 * than inferred from whenever the signature was scanned back.
 */

type SortMode = 'site' | 'date'

interface LineDraft {
  costCode: string
  name: string
  detail: string
  amount: string
}

interface CoFormState {
  coNo: string
  siteId: string
  description: string
  detail: string
  raisedOn: string
  daysImpact: string
  lines: LineDraft[]
}

interface CoGroup {
  key: string
  site: string
  color: string
  rows: ChangeOrderRow[]
  total: number
}

interface Step {
  name: string
  when: string
  done: boolean
  wait: boolean
  fg: string
}

interface ImpactTile {
  k: string
  v: string
  fg: string
  note: string
}

const STATUS_META: Record<ChangeOrderRow['status'], { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: theme.appBg, fg: theme.inkFaint },
  pending_client: { label: 'Pending builder', bg: '#FFF6DE', fg: '#8A6100' },
  approved: { label: 'On the contract', bg: '#EAF7EE', fg: '#1B7A32' },
  rejected: { label: 'Declined', bg: '#FCE8EA', fg: theme.alert },
}

// A categorical palette for the small per-job-site dot in the group header.
// Cycled by the site's position in `sites`, so a given job keeps the same
// colour for as long as it exists rather than reshuffling on every load.
const GROUP_COLORS = [
  '#007BFF', '#28A745', '#8A6100', '#D2051E', '#6F42C1', '#0E7C86', '#C2410C', '#4C51BF',
]

const blankLine = (): LineDraft => ({ costCode: '', name: '', detail: '', amount: '' })

const blankForm = (coNo: string): CoFormState => ({
  coNo,
  siteId: '',
  description: '',
  detail: '',
  raisedOn: new Date().toISOString().slice(0, 10),
  daysImpact: '0',
  lines: [blankLine()],
})

/**
 * Next unused "VO-N", derived from what's already on the job — never invented
 * out of thin air. Both prefixes count towards the high-water mark: a company
 * that raised CO-1 through CO-7 before this screen was relabelled must not get
 * a VO-1 that reads like the first variation on the job.
 */
function nextCoNo(rows: ChangeOrderRow[]): string {
  let max = 0
  for (const r of rows) {
    const m = /^(?:VO|CO)-(\d+)$/i.exec(r.co_no.trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `VO-${max + 1}`
}

function colorForSite(siteId: string, sites: JobSite[]): string {
  const idx = sites.findIndex((s) => s.id === siteId)
  return GROUP_COLORS[(idx < 0 ? 0 : idx) % GROUP_COLORS.length]
}

function listDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
}

function signedWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(`${isoDate}T00:00:00`).getTime()) / 86400000)
}

function fmtDays(n: number): string {
  const v = Number(n) || 0
  if (v === 0) return '—'
  return v > 0 ? `+${v}` : `${v}`
}

// A credit (a negative cost impact, money handed back to the client) reads
// as good news, so it borrows the same green as "approved". An addition
// stays neutral ink — the status chip already carries whatever urgency the
// row has; this figure doesn't need to shout too.
function costColor(n: number): string {
  return Number(n) < 0 ? theme.success : theme.ink
}

function statusNote(co: ChangeOrderRow): string {
  switch (co.status) {
    case 'draft':
      return 'not sent to the builder yet'
    case 'pending_client':
      return 'awaiting the builder’s approval'
    case 'approved':
      return co.signature ? `approved by ${co.signature.name}` : 'approved'
    case 'rejected':
      return 'declined by the builder'
    default:
      return ''
  }
}

function buildImpactTiles(co: ChangeOrderRow, lines: ChangeOrderLineRow[]): ImpactTile[] {
  const lineCount = lines.length
  const st = STATUS_META[co.status]
  const ageDays = daysSince(co.raised_on)
  const days = Number(co.days_impact) || 0
  const scheduleFg = days > 0 ? STATUS_META.pending_client.fg : days < 0 ? STATUS_META.approved.fg : theme.inkFaint

  return [
    {
      k: 'COST IMPACT',
      v: money2(Number(co.cost_impact)),
      fg: costColor(co.cost_impact),
      note: lineCount ? `${lineCount} scope line${lineCount === 1 ? '' : 's'}` : 'no scope lines added',
    },
    {
      k: 'SCHEDULE IMPACT',
      v: days === 0 ? 'No change' : `${days > 0 ? '+' : ''}${days} day${Math.abs(days) === 1 ? '' : 's'}`,
      fg: scheduleFg,
      note: days === 0 ? 'schedule unaffected' : days > 0 ? 'added to the schedule' : 'pulled in on the schedule',
    },
    {
      k: 'STATUS',
      v: st.label,
      fg: st.fg,
      note: statusNote(co),
    },
    {
      k: 'RAISED',
      v: listDate(co.raised_on),
      fg: theme.ink,
      note: ageDays <= 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`,
    },
  ]
}

function buildSteps(co: ChangeOrderRow): Step[] {
  const raised: Step = {
    name: 'Variation raised',
    when: listDate(co.raised_on),
    done: true,
    wait: false,
    fg: theme.ink,
  }

  const sent: Step =
    co.status === 'draft'
      ? { name: 'Sent for approval', when: 'Not sent yet', done: false, wait: false, fg: theme.inkFaint }
      : { name: 'Sent for approval', when: 'Visible in the portal', done: true, wait: false, fg: theme.ink }

  let signature: Step
  if (co.status === 'approved' && co.signature) {
    signature = {
      name: `Signed by ${co.signature.name}`,
      when: signedWhen(co.signature.signed_at),
      done: true,
      wait: false,
      fg: theme.ink,
    }
  } else if (co.status === 'pending_client') {
    signature = {
      name: 'Awaiting the signature',
      when: 'No signature yet',
      done: false,
      wait: true,
      fg: theme.ink,
    }
  } else if (co.status === 'rejected') {
    signature = {
      name: 'Declined',
      when: 'No signature was recorded',
      done: false,
      wait: false,
      fg: theme.alert,
    }
  } else {
    signature = {
      name: 'Signature',
      when: 'Send it for approval first',
      done: false,
      wait: false,
      fg: theme.inkFaint,
    }
  }

  // The step that used to be missing. Approving a variation adds its value to
  // the contract sum (schema_v17), which is what makes it billable — and the
  // reason "approved" is worth a separate line from "signed".
  let onContract: Step
  if (co.status === 'approved') {
    onContract = {
      name: 'On the contract',
      when: co.approved_on
        ? `Added to the contract sum ${listDate(co.approved_on)}`
        : 'Added to the contract sum',
      done: true,
      wait: false,
      fg: theme.ink,
    }
  } else if (co.status === 'rejected') {
    onContract = {
      name: 'Not on the contract',
      when: 'Declined, so it adds nothing and cannot be billed',
      done: false,
      wait: false,
      fg: theme.inkFaint,
    }
  } else {
    onContract = {
      name: 'On the contract',
      when: 'Approve it to add its value to the contract sum',
      done: false,
      wait: false,
      fg: theme.inkFaint,
    }
  }

  return [raised, sent, signature, onContract]
}

/** Real, computed urgency — never the fabricated schedule narrative from the mockup. */
function waitingCopy(raisedOn: string): string {
  const days = daysSince(raisedOn)
  const since = days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
  return `Raised ${since} and still waiting on approval. It adds nothing to the contract sum until then, so work covered by this variation shouldn't proceed and it can't be billed.`
}

export function ChangeOrders({
  me,
  sites,
  workers: _workers, // shared feature-screen contract — schema v4 change orders don't reference a worker
  onChanged,
}: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [rows, setRows] = useState<ChangeOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('site')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lineCache, setLineCache] = useState<Map<string, ChangeOrderLineRow[]>>(new Map())
  const [linesLoading, setLinesLoading] = useState(false)

  const [form, setForm] = useState<CoFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [signName, setSignName] = useState('')
  const [confirmingReject, setConfirmingReject] = useState(false)
  const [reminderNoted, setReminderNoted] = useState(false)

  // site_id -> contract_id, so a new variation is stamped with the contract it
  // varies at insert time rather than being reconciled later. One contract per
  // site is a unique constraint (schema_v17), so this map is unambiguous.
  const [contractBySite, setContractBySite] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()
    const [coRes, contractRes] = await Promise.all([
      client.from('change_orders').select('*').order('raised_on', { ascending: false }),
      client.from('contracts').select('id, site_id'),
    ])
    if (coRes.error) {
      setError(coRes.error.message)
      setLoading(false)
      return
    }
    setRows((coRes.data ?? []) as ChangeOrderRow[])
    // A missing contracts read is not fatal: a variation without a contract_id
    // is still counted on the value ladder, which sums by site.
    setContractBySite(
      new Map(
        ((contractRes.data ?? []) as Array<{ id: string; site_id: string }>).map((c) => [c.site_id, c.id]),
      ),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Default to the first row once data is in, and whenever the current
  // selection disappears — the detail panel below the list should never be
  // left pointed at nothing while rows exist.
  useEffect(() => {
    if (loading) return
    if (selectedId && rows.some((r) => r.id === selectedId)) return
    setSelectedId(rows[0]?.id ?? null)
  }, [loading, rows, selectedId])

  // Transient per-row UI (the reject confirm step, the reminder note, a
  // half-typed signer name) shouldn't survive a jump to a different CO.
  useEffect(() => {
    setConfirmingReject(false)
    setReminderNoted(false)
    setSignName('')
    setActionError(null)
  }, [selectedId])

  // Scope lines are fetched lazily, per selection, and cached — the list and
  // its totals never need them, only the open detail view does.
  useEffect(() => {
    if (!selectedId || lineCache.has(selectedId)) return
    const id = selectedId
    let cancelled = false
    setLinesLoading(true)
    void supabase()
      .from('change_order_lines')
      .select('*')
      .eq('change_order_id', id)
      .order('sort', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        setLinesLoading(false)
        if (err) setActionError(err.message)
        else setLineCache((prev) => new Map(prev).set(id, (data ?? []) as ChangeOrderLineRow[]))
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, lineCache])

  const siteName = (id: string | null) =>
    id ? sites.find((s) => s.id === id)?.name ?? 'Unknown site' : 'No job site'

  // The task pins grouping to job site (a hard requirement), so this control
  // never flattens the list — it only changes how the GROUPS are ordered:
  // alphabetically by site name, or by whichever site raised a change order
  // most recently. Rows inside a group are always newest-first either way.
  const groups = useMemo<CoGroup[]>(() => {
    const map = new Map<string, ChangeOrderRow[]>()
    for (const r of rows) {
      const key = r.site_id ?? ''
      const bucket = map.get(key)
      if (bucket) bucket.push(r)
      else map.set(key, [r])
    }
    const list: CoGroup[] = Array.from(map.entries()).map(([key, groupRows]) => {
      const sortedRows = [...groupRows].sort((a, b) => b.raised_on.localeCompare(a.raised_on))
      return {
        key,
        site: key ? siteName(key) : 'No job site',
        color: key ? colorForSite(key, sites) : theme.inkFaint,
        rows: sortedRows,
        total: sortedRows.reduce((s, r) => s + (Number(r.cost_impact) || 0), 0),
      }
    })
    if (sortMode === 'site') {
      list.sort((a, b) => {
        if (!a.key) return 1
        if (!b.key) return -1
        return a.site.localeCompare(b.site)
      })
    } else {
      list.sort((a, b) => (b.rows[0]?.raised_on ?? '').localeCompare(a.rows[0]?.raised_on ?? ''))
    }
    return list
  }, [rows, sites, sortMode])

  // Draft is excluded on purpose — it isn't a commitment yet, so it doesn't
  // belong in a rollup of money that's approved, awaiting signature, or dead.
  const summary = useMemo(() => {
    let approved = 0
    let pending = 0
    let rejected = 0
    for (const r of rows) {
      const amt = Number(r.cost_impact) || 0
      if (r.status === 'approved') approved += amt
      else if (r.status === 'pending_client') pending += amt
      else if (r.status === 'rejected') rejected += amt
    }
    return { approved, pending, rejected }
  }, [rows])

  const selected = rows.find((r) => r.id === selectedId) ?? null
  const selectedLines = selectedId ? lineCache.get(selectedId) ?? [] : []
  const impactTiles = selected ? buildImpactTiles(selected, selectedLines) : []
  const steps = selected ? buildSteps(selected) : []

  async function createChangeOrder() {
    if (!form) return
    if (!form.coNo.trim()) {
      setFormError('A CO number is required.')
      return
    }
    if (!form.description.trim()) {
      setFormError('A description is required.')
      return
    }
    setSaving(true)
    setFormError(null)

    const client = supabase()
    const cleanLines = form.lines.filter((l) => l.name.trim())
    // The cost impact is never typed in separately — it IS the lines, so the
    // number a client signs can never disagree with its own backup.
    const costImpact = cleanLines.reduce((s, l) => s + (Number(l.amount) || 0), 0)

    const { data: co, error: err } = await client
      .from('change_orders')
      .insert({
        company_id: me.company_id,
        site_id: form.siteId || null,
        contract_id: (form.siteId && contractBySite.get(form.siteId)) || null,
        co_no: form.coNo.trim(),
        description: form.description.trim(),
        detail: form.detail.trim() || null,
        cost_impact: costImpact,
        days_impact: Number(form.daysImpact) || 0,
        status: 'draft',
        raised_on: form.raisedOn,
      })
      .select('*')
      .single()

    if (err || !co) {
      setSaving(false)
      // co_no is unique per company (schema_v4) — a 23505 here is always a
      // duplicate number, not a server problem worth alarming anyone over.
      setFormError(
        err?.code === '23505'
          ? `Number "${form.coNo.trim()}" is already used on another variation — pick a different one.`
          : err?.message ?? 'Could not save the variation.',
      )
      return
    }

    const saved = co as ChangeOrderRow

    if (cleanLines.length) {
      const { error: lineErr } = await client.from('change_order_lines').insert(
        cleanLines.map((l, i) => ({
          change_order_id: saved.id,
          cost_code: l.costCode || null,
          name: l.name.trim(),
          detail: l.detail.trim() || null,
          amount: Number(l.amount) || 0,
          sort: i,
        })),
      )
      if (lineErr) {
        setSaving(false)
        setFormError(`The variation saved, but its scope lines failed: ${lineErr.message}`)
        return
      }
    }

    setSaving(false)
    setForm(null)
    setSelectedId(saved.id)
    await load()
    onChanged()
  }

  async function sendToClient(co: ChangeOrderRow) {
    setActionBusy(true)
    setActionError(null)
    const { error: err } = await supabase().from('change_orders').update({ status: 'pending_client' }).eq('id', co.id)
    setActionBusy(false)
    if (err) setActionError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  // The signature is the record of authority to bill this change order, so
  // the name is always typed by a human here, never pre-filled with `me`
  // (the office user recording it) or any other guess.
  async function approve(co: ChangeOrderRow) {
    const name = signName.trim()
    if (!name) {
      setActionError("Type the client's name exactly as it should read on the signature before recording it.")
      return
    }
    setActionBusy(true)
    setActionError(null)
    const { error: err } = await supabase()
      .from('change_orders')
      .update({ status: 'approved', signature: { name, signed_at: new Date().toISOString() } })
      .eq('id', co.id)
    setActionBusy(false)
    if (err) setActionError(err.message)
    else {
      setSignName('')
      await load()
      onChanged()
    }
  }

  async function reject(co: ChangeOrderRow) {
    setActionBusy(true)
    setActionError(null)
    const { error: err } = await supabase().from('change_orders').update({ status: 'rejected' }).eq('id', co.id)
    setActionBusy(false)
    setConfirmingReject(false)
    if (err) setActionError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  function patchLine(i: number, changes: Partial<LineDraft>) {
    setForm((f) => (f ? { ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...changes } : l)) } : f))
  }
  function addLine() {
    setForm((f) => (f ? { ...f, lines: [...f.lines, blankLine()] } : f))
  }
  function removeLine(i: number) {
    setForm((f) => (f ? { ...f, lines: f.lines.filter((_, idx) => idx !== i) } : f))
  }

  const formCostImpact = form ? form.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) : 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg }}>
      <style>{`
        .co-row { background: #fff; }
        .co-row:hover { background: ${HOVER_BG}; }
        .co-reminder-btn { background: #fff; border: 1px solid ${theme.border}; }
        .co-reminder-btn:hover { background: #F5F6F7; border-color: ${DASH_BORDER}; }
      `}</style>

      {/* toolbar */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 40,
          padding: '0 12px',
          background: '#fff',
          borderBottom: `1px solid ${theme.border}`,
          overflowX: 'auto',
        }}
      >
        <div style={{ flex: 'none', display: 'flex', height: 27, border: `1px solid ${theme.border}`, borderRadius: 3, overflow: 'hidden' }}>
          <button
            onClick={() => setSortMode('site')}
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              padding: '0 11px',
              border: 0,
              borderRight: `1px solid ${theme.border}`,
              fontFamily: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: sortMode === 'site' ? theme.accentFill : '#fff',
              color: sortMode === 'site' ? theme.accent : theme.ink,
              fontWeight: sortMode === 'site' ? 600 : 400,
            }}
          >
            By job site
          </button>
          <button
            onClick={() => setSortMode('date')}
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              padding: '0 11px',
              border: 0,
              fontFamily: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: sortMode === 'date' ? theme.accentFill : '#fff',
              color: sortMode === 'date' ? theme.accent : theme.ink,
              fontWeight: sortMode === 'date' ? 600 : 400,
            }}
          >
            Newest first
          </button>
        </div>

        <div style={{ flex: 'none', width: 1, height: 20, background: theme.border, margin: '0 4px' }} />

        <span style={{ flex: 'none', fontSize: 12.5, color: theme.inkSoft, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {money(summary.approved)} on the contract · {money(summary.pending)} awaiting approval · {money(summary.rejected)} declined
        </span>

        <div style={{ flex: 1 }} />

        {me.is_office && (
          <button
            onClick={() => {
              if (form) return
              setFormError(null)
              setForm(blankForm(nextCoNo(rows)))
            }}
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
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
              cursor: form ? 'default' : 'pointer',
              opacity: form ? 0.55 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            NEW VARIATION
          </button>
        )}
      </div>

      {/* scroll area */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px' }}>
        {error && (
          <div
            style={{
              marginBottom: 14,
              padding: '10px 14px',
              background: WARN_BG,
              border: `1px solid ${WARN_BORDER}`,
              borderRadius: 8,
              fontSize: 12.5,
              color: WARN_TEXT,
            }}
          >
            {error}
          </div>
        )}

        {form && (
          <div style={{ background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>New variation</div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...formLabel, marginTop: 0 }}>
                Variation no
                <input
                  value={form.coNo}
                  onChange={(e) => setForm((f) => (f ? { ...f, coNo: e.target.value } : f))}
                  style={{ ...formField, width: 120 }}
                />
              </label>
              <label style={{ ...formLabel, marginTop: 0 }}>
                Job site
                <select
                  value={form.siteId}
                  onChange={(e) => setForm((f) => (f ? { ...f, siteId: e.target.value } : f))}
                  style={{ ...formField, width: 200 }}
                >
                  <option value="">No job site</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...formLabel, marginTop: 0 }}>
                Raised on
                <input
                  type="date"
                  value={form.raisedOn}
                  onChange={(e) => setForm((f) => (f ? { ...f, raisedOn: e.target.value } : f))}
                  style={{ ...formField, width: 150 }}
                />
              </label>
              <label style={{ ...formLabel, marginTop: 0 }}>
                Schedule days impact
                <input
                  value={form.daysImpact}
                  onChange={(e) => setForm((f) => (f ? { ...f, daysImpact: e.target.value } : f))}
                  placeholder="0"
                  style={{ ...formField, width: 110, textAlign: 'right' }}
                />
              </label>
            </div>

            <label style={formLabel}>
              Description
              <input
                value={form.description}
                onChange={(e) => setForm((f) => (f ? { ...f, description: e.target.value } : f))}
                placeholder="Relocate laundry to second floor"
                style={{ ...formField, width: '100%' }}
              />
            </label>

            <label style={formLabel}>
              Scope of the change (optional)
              <textarea
                value={form.detail}
                onChange={(e) => setForm((f) => (f ? { ...f, detail: e.target.value } : f))}
                rows={3}
                placeholder="What's changing and why — this is shown to the client alongside the price."
                style={{ ...formField, width: '100%', height: 'auto', padding: 9, resize: 'vertical' as const }}
              />
            </label>

            <div style={{ ...formLabel, marginTop: 14 }}>Scope lines</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  {['Cost code', 'Name', 'Detail', 'Amount', ''].map((h, i) => (
                    <th key={h + i} style={{ ...lineTh, textAlign: i === 3 ? 'right' : 'left' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i}>
                    <td style={lineTd}>
                      <select
                        value={l.costCode}
                        onChange={(e) => patchLine(i, { costCode: e.target.value })}
                        style={{ ...formField, marginTop: 0, width: 120 }}
                      >
                        <option value="">Uncoded</option>
                        {costCodes.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={lineTd}>
                      <input
                        value={l.name}
                        onChange={(e) => patchLine(i, { name: e.target.value })}
                        placeholder="Wet wall + rough-in"
                        style={{ ...formField, marginTop: 0, width: '100%' }}
                      />
                    </td>
                    <td style={lineTd}>
                      <input
                        value={l.detail}
                        onChange={(e) => patchLine(i, { detail: e.target.value })}
                        placeholder="2nd floor hall"
                        style={{ ...formField, marginTop: 0, width: '100%' }}
                      />
                    </td>
                    <td style={{ ...lineTd, textAlign: 'right' }}>
                      <input
                        value={l.amount}
                        onChange={(e) => patchLine(i, { amount: e.target.value })}
                        placeholder="0.00"
                        style={{ ...formField, marginTop: 0, width: 100, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ ...lineTd, textAlign: 'right' }}>
                      {form.lines.length > 1 && (
                        <button onClick={() => removeLine(i)} style={ghostSmall}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, fontSize: 12.5 }}>
              <button onClick={addLine} style={ghostSmall}>
                Add a line
              </button>
              <span>
                Cost impact <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money2(formCostImpact)}</strong> — the sum
                of the lines above. This is the number the client will sign.
              </span>
            </div>

            {formError && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{formError}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void createChangeOrder()} disabled={saving} style={cta}>
                {saving ? 'SAVING…' : 'SAVE AS DRAFT'}
              </button>
              <button
                onClick={() => {
                  setForm(null)
                  setFormError(null)
                }}
                style={ghost}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* list panel */}
        <div style={{ background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 8, overflowX: 'auto', marginBottom: 14 }}>
          <div
            style={{
              minWidth: 880,
              display: 'grid',
              columnGap: 10,
              gridTemplateColumns: '76px 1fr 148px 100px 108px 92px 132px',
              padding: '7px 14px',
              background: HEAD_BG,
              borderBottom: `1px solid ${theme.border}`,
            }}
          >
            <span style={colHead}>VO</span>
            <span style={colHead}>DESCRIPTION</span>
            <span style={colHead}>JOB SITE</span>
            <span style={colHead}>RAISED</span>
            <span style={{ ...colHead, textAlign: 'right' }}>COST</span>
            <span style={{ ...colHead, textAlign: 'right' }}>DAYS</span>
            <span style={{ ...colHead, textAlign: 'right' }}>STATUS</span>
          </div>

          {loading && (
            <div style={{ padding: '28px 14px', textAlign: 'center', fontSize: 12.5, color: theme.inkSoft }}>Loading…</div>
          )}
          {!loading && groups.length === 0 && (
            <div style={{ padding: '28px 14px', textAlign: 'center', fontSize: 12.5, color: theme.inkSoft }}>
              {me.is_office ? 'No variations raised yet — raise the first one with New Variation above.' : 'No variations raised yet.'}
            </div>
          )}

          {groups.map((g) => (
            <Fragment key={g.key || 'none'}>
              <div
                style={{
                  minWidth: 880,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 14px',
                  background: GROUP_BG,
                  borderBottom: `1px solid ${GROUP_BORDER}`,
                }}
              >
                <span style={{ flex: 'none', width: 9, height: 9, borderRadius: 2, background: g.color }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{g.site}</span>
                <span style={{ fontSize: 11.5, color: LABEL, whiteSpace: 'nowrap' }}>
                  {g.rows.length} variation{g.rows.length === 1 ? '' : 's'}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: LABEL, whiteSpace: 'nowrap' }}>cost impact</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {money(g.total)}
                </span>
              </div>

              {g.rows.map((c) => {
                const isSelected = c.id === selectedId
                return (
                  <div
                    key={c.id}
                    className="co-row"
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      minWidth: 880,
                      display: 'grid',
                      columnGap: 10,
                      gridTemplateColumns: '76px 1fr 148px 100px 108px 92px 132px',
                      alignItems: 'center',
                      padding: '9px 14px',
                      borderBottom: `1px solid ${ROW_BORDER}`,
                      cursor: 'pointer',
                      background: isSelected ? theme.accentFill : undefined,
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.accent }}>{c.co_no}</span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {c.description}
                    </span>
                    <span style={{ fontSize: 12.5, color: TEXT2 }}>{siteName(c.site_id)}</span>
                    <span style={{ fontSize: 12.5, color: TEXT2 }}>{listDate(c.raised_on)}</span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        textAlign: 'right',
                        color: costColor(c.cost_impact),
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {money2(Number(c.cost_impact))}
                    </span>
                    <span style={{ fontSize: 13, textAlign: 'right', color: TEXT2, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtDays(c.days_impact)}
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <StatusChip status={c.status} dot />
                    </span>
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>

        {/* detail view */}
        {selected && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div
              style={{
                flex: '1 1 560px',
                minWidth: 420,
                background: '#fff',
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '13px 15px',
                  borderBottom: `1px solid ${theme.border}`,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>
                    {selected.co_no} · {selected.description}
                  </span>
                  <StatusChip status={selected.status} />
                </span>
                <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                  {siteName(selected.site_id)} · raised {listDate(selected.raised_on)}
                </span>
              </div>

              <div style={{ padding: '14px 15px', borderBottom: `1px solid ${theme.border}` }}>
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: LABEL, marginBottom: 6 }}>
                  SCOPE OF THE CHANGE
                </span>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: TEXT2, textWrap: 'pretty' }}>
                  {selected.detail || 'No scope notes recorded for this variation.'}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 1, background: theme.border }}>
                {impactTiles.map((t) => (
                  <div key={t.k} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px', background: '#fff' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: LABEL, whiteSpace: 'nowrap' }}>
                      {t.k}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 600, color: t.fg, fontVariantNumeric: 'tabular-nums' }}>{t.v}</span>
                    <span style={{ fontSize: 11.5, color: LABEL }}>{t.note}</span>
                  </div>
                ))}
              </div>

              <div style={{ overflowX: 'auto', borderTop: `1px solid ${theme.border}` }}>
                {linesLoading && (
                  <div style={{ padding: '14px 15px', fontSize: 12.5, color: theme.inkSoft }}>Loading scope lines…</div>
                )}
                {!linesLoading && selectedLines.length === 0 && (
                  <div style={{ padding: '14px 15px', fontSize: 12.5, color: theme.inkSoft }}>No scope lines recorded.</div>
                )}
                {selectedLines.map((l) => (
                  <div
                    key={l.id}
                    style={{
                      minWidth: 520,
                      display: 'grid',
                      columnGap: 10,
                      gridTemplateColumns: '1fr 118px 108px',
                      alignItems: 'center',
                      padding: '9px 15px',
                      borderBottom: `1px solid ${ROW_BORDER}`,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: LABEL }}>{l.cost_code || '—'}</span>
                      <span style={{ fontSize: 13 }}>{l.name}</span>
                    </span>
                    <span style={{ fontSize: 12.5, color: theme.inkSoft, textAlign: 'right' }}>{l.detail || '—'}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {money2(Number(l.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '11px 14px', borderBottom: `1px solid ${theme.border}`, fontSize: 15, fontWeight: 600 }}>
                  Client approval
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {steps.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '11px 14px',
                        borderBottom: `1px solid ${ROW_BORDER}`,
                      }}
                    >
                      {s.done ? (
                        <svg
                          width="17"
                          height="17"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke={theme.success}
                          strokeWidth={2.1}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ flex: 'none', marginTop: 1 }}
                        >
                          <path d="M3 8.4l3.2 3.2L13 4.8" />
                        </svg>
                      ) : s.wait ? (
                        <span
                          style={{
                            flex: 'none',
                            display: 'block',
                            width: 17,
                            height: 17,
                            marginTop: 1,
                            borderRadius: '50%',
                            border: `2px solid ${theme.warning}`,
                          }}
                        />
                      ) : (
                        <span style={{ flex: 'none', width: 17, height: 17, marginTop: 1 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: s.fg }}>{s.name}</span>
                        <span style={{ fontSize: 11.5, color: LABEL }}>{s.when}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '13px 14px' }}>
                  {selected.status === 'draft' && (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: 82,
                          border: `1.5px dashed ${DASH_BORDER}`,
                          borderRadius: 4,
                          background: HEAD_BG,
                        }}
                      >
                        <span style={{ fontSize: 12.5, color: LABEL }}>Not sent for approval yet</span>
                      </div>
                      <span style={{ fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
                        Send it once the scope and cost are ready. It is signed in the portal — nothing to print or scan.
                        Approving it is what adds its value to the contract sum.
                      </span>
                      {me.is_office && (
                        <button onClick={() => void sendToClient(selected)} disabled={actionBusy} style={ctaFullStyle}>
                          {actionBusy ? 'SENDING…' : 'SEND TO CLIENT'}
                        </button>
                      )}
                    </>
                  )}

                  {selected.status === 'pending_client' && (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: 82,
                          border: `1.5px dashed ${DASH_BORDER}`,
                          borderRadius: 4,
                          background: HEAD_BG,
                        }}
                      >
                        <span style={{ fontSize: 12.5, color: LABEL }}>Awaiting approval</span>
                      </div>
                      <span style={{ fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
                        Signed in the portal — no printing, no scanning. The signed PDF lands in Plans &amp; Docs.
                      </span>

                      {me.is_office && (
                        <>
                          <button className="co-reminder-btn" onClick={() => setReminderNoted(true)} style={reminderBtnStyle}>
                            Send reminder
                          </button>
                          {reminderNoted && (
                            <span style={{ fontSize: 11, color: theme.inkSoft }}>
                              Reminders aren't automated yet — call or message the client directly.
                            </span>
                          )}

                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 9,
                              marginTop: 5,
                              paddingTop: 10,
                              borderTop: `1px solid ${ROW_BORDER}`,
                            }}
                          >
                            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: LABEL }}>
                              RECORD THE SIGNATURE
                            </span>
                            <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
                              This becomes the record of authority to bill this variation — type the client's name
                              exactly as they signed. Never guess or pre-fill it.
                            </p>
                            <input
                              value={signName}
                              onChange={(e) => setSignName(e.target.value)}
                              placeholder="Client's full name"
                              style={signInputStyle}
                            />
                            <button
                              onClick={() => void approve(selected)}
                              disabled={actionBusy || !signName.trim()}
                              style={ctaFullStyle}
                            >
                              {actionBusy ? 'RECORDING…' : 'APPROVE — ADD TO THE CONTRACT'}
                            </button>

                            {confirmingReject ? (
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  onClick={() => void reject(selected)}
                                  disabled={actionBusy}
                                  style={{ ...ghostFullStyle, borderColor: theme.alert, color: theme.alert }}
                                >
                                  {actionBusy ? 'DECLINING…' : 'CONFIRM DECLINE'}
                                </button>
                                <button onClick={() => setConfirmingReject(false)} style={ghostFullStyle}>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmingReject(true)} style={{ ...ghostFullStyle, color: theme.alert }}>
                                Decline variation
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {selected.status === 'approved' && (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 2,
                          height: 82,
                          border: `1.5px solid ${theme.border}`,
                          borderRadius: 4,
                          background: STATUS_META.approved.bg,
                        }}
                      >
                        {selected.signature ? (
                          <>
                            <span style={{ fontSize: 16, fontWeight: 600, fontStyle: 'italic', color: theme.ink }}>
                              {selected.signature.name}
                            </span>
                            <span style={{ fontSize: 11, color: theme.inkSoft }}>{signedWhen(selected.signature.signed_at)}</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 12.5, color: theme.inkSoft }}>Approved — no signature on file</span>
                        )}
                      </div>
                      <span style={{ fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
                        This signature is the record of authority to bill this variation. Its value is on the contract sum.
                      </span>
                    </>
                  )}

                  {selected.status === 'rejected' && (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: 82,
                          border: `1.5px dashed ${DASH_BORDER}`,
                          borderRadius: 4,
                          background: HEAD_BG,
                        }}
                      >
                        <span style={{ fontSize: 12.5, color: theme.alert }}>Declined — no signature recorded</span>
                      </div>
                      <span style={{ fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
                        Revise the scope or cost and raise a new variation if the work still needs doing.
                      </span>
                    </>
                  )}

                  {actionError && <div style={{ fontSize: 11.5, color: theme.alert }}>{actionError}</div>}
                </div>
              </div>

              {selected.status === 'pending_client' && (
                <div style={{ display: 'flex', gap: 10, padding: '13px 14px', background: WARN_BG, border: `1px solid ${WARN_BORDER}`, borderRadius: 8 }}>
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke={theme.alert}
                    strokeWidth={1.5}
                    style={{ flex: 'none', marginTop: 1 }}
                  >
                    <path d="M8 2.6L14.4 13H1.6z" strokeLinejoin="round" />
                    <path d="M8 6.4v3.1" strokeLinecap="round" />
                    <path d="M8 11.4h.01" strokeWidth={1.8} strokeLinecap="round" />
                  </svg>
                  <span style={{ fontSize: 12.5, lineHeight: 1.5, color: WARN_TEXT }}>{waitingCopy(selected.raised_on)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status, dot = false }: { status: ChangeOrderRow['status']; dot?: boolean }) {
  const st = STATUS_META[status]
  return (
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
        background: st.bg,
        color: st.fg,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.fg }} />}
      {st.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Colour and spacing tokens below are lifted directly from
// design/screens/isChangeOrders.html. Values that already exist in `theme`
// are reused from there; the rest are literal hexes this screen introduces
// that don't have a home in the shared palette.

const LABEL = '#8B9096'
const TEXT2 = '#4A5057'
const HEAD_BG = '#FAFBFC'
const GROUP_BG = '#F7F9FB'
const GROUP_BORDER = '#EDEFF1'
const ROW_BORDER = '#F1F3F5'
const HOVER_BG = '#FAFCFF'
const DASH_BORDER = '#C3C9D0'
const WARN_BG = '#FDECEE'
const WARN_BORDER = '#F3C4CB'
const WARN_TEXT = '#6E3B41'

const colHead = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: theme.inkSoft } as const

const ctaFullStyle = {
  width: '100%',
  height: 32,
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: '.02em',
  color: theme.ink,
  cursor: 'pointer',
} as const

const ghostFullStyle = {
  width: '100%',
  height: 32,
  background: '#fff',
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  color: theme.ink,
  cursor: 'pointer',
} as const

const reminderBtnStyle = {
  width: '100%',
  height: 32,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
} as const

const signInputStyle = {
  display: 'block',
  width: '100%',
  height: 32,
  padding: '0 9px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: '#fff',
  fontFamily: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const cta = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: theme.ink,
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
} as const

const ghost = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: '#fff',
  color: theme.ink,
  fontFamily: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
} as const

const ghostSmall = { ...ghost, padding: '4px 10px' } as const

const formLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  display: 'block',
  marginTop: 8,
} as const

const formField = {
  display: 'block',
  height: 32,
  padding: '0 9px',
  marginTop: 4,
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: '#fff',
  fontFamily: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const lineTd = { padding: '5px 8px', borderBottom: `1px solid ${theme.border}` } as const

const lineTh = {
  padding: '6px 8px',
  borderBottom: `1px solid ${theme.border}`,
  background: theme.appBg,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
} as const
