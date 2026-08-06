import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type ShiftRow, type WorkerRow } from '../data/supabase'
import { costCodes } from '../data/seed'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Timesheets reads and writes the `shifts` table directly rather than taking
 * a snapshot prop — approvals and edits have to survive a reload, and the
 * only way to prove that is to round-trip through Supabase every time.
 * RLS does the access control for us: shifts_office_write means field users'
 * writes are rejected server-side, so the UI only needs to hide the controls,
 * not enforce the rule.
 */

const DAY_MS = 86_400_000
const NO_CLOCKOUT_MS = 12 * 3_600_000
const LONG_SHIFT_MS = 14 * 3_600_000
const OVERTIME_MS = 40 * 3_600_000

const pad2 = (n: number) => String(n).padStart(2, '0')
const hours = (ms: number) => (ms / 3_600_000).toFixed(2)
const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const startOfDay = (d: Date) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS)
const mondayOf = (d: Date) => {
  const s = startOfDay(d)
  return addDays(s, -((s.getDay() + 6) % 7))
}
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`

const defaultCostCode = (trade?: string) => {
  if (trade === 'Electrician') return costCodes[5].code
  if (trade === 'Finish carpenter') return costCodes[3].code
  return costCodes[2].code
}

const durationMs = (row: ShiftRow) =>
  Math.max(0, (row.ended_at ? new Date(row.ended_at).getTime() : Date.now()) - new Date(row.started_at).getTime())

/** Auto vs manual is the whole trust story — it gets an icon on every row. */
function Provenance({ source, edited }: { source: 'auto' | 'manual'; edited: boolean }) {
  const auto = source === 'auto' && !edited
  return (
    <span
      title={auto ? 'Captured automatically by GPS' : 'Entered or edited by hand'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 7px',
        borderRadius: 3,
        fontSize: 11,
        whiteSpace: 'nowrap',
        background: auto ? theme.accentFill : '#FFF6DF',
        color: auto ? theme.accent : '#8A6100',
      }}
    >
      {auto ? '⌖' : '✎'} {auto ? 'GPS' : 'Manual'}
    </span>
  )
}

interface EditDraft {
  siteId: string
  costCode: string
  start: string
  end: string
}

const blankAdd = { workerId: '', siteId: '', costCode: '', start: '', end: '' }

export function Timesheets({
  me,
  sites,
  workers,
  onChanged,
}: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const canEdit = me.is_office

  const [view, setView] = useState<'day' | 'week'>('day')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))

  const [rows, setRows] = useState<ShiftRow[]>([])
  const [openWatch, setOpenWatch] = useState<ShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState(blankAdd)
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [editTarget, setEditTarget] = useState<ShiftRow | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Ticks the clock so open shifts keep accruing hours on screen without a manual refresh.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const dayStart = startOfDay(anchor)
  const weekStart = mondayOf(anchor)
  const rangeStart = view === 'day' ? dayStart : weekStart
  const rangeEnd = view === 'day' ? addDays(dayStart, 1) : addDays(weekStart, 7)
  const rangeStartMs = rangeStart.getTime()
  const rangeEndMs = rangeEnd.getTime()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()
    const [main, open] = await Promise.all([
      client
        .from('shifts')
        .select('*')
        .gte('started_at', new Date(rangeStartMs).toISOString())
        .lt('started_at', new Date(rangeEndMs).toISOString())
        .order('started_at', { ascending: true }),
      client.from('shifts').select('*').is('ended_at', null).order('started_at', { ascending: false }).limit(200),
    ])
    const firstError = main.error ?? open.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }
    setRows((main.data ?? []) as ShiftRow[])
    setOpenWatch((open.data ?? []) as ShiftRow[])
    setLoading(false)
  }, [rangeStartMs, rangeEndMs])

  useEffect(() => {
    void load()
  }, [load])

  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites])
  const visibleWorkers = useMemo(
    () => (canEdit ? workers : workers.filter((w) => w.id === me.id)),
    [workers, canEdit, me.id],
  )

  const dateLabel =
    view === 'day'
      ? dayStart.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
      : `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`

  const step = view === 'day' ? 1 : 7

  const now = Date.now()
  const noClockOut = openWatch.filter((r) => now - new Date(r.started_at).getTime() > NO_CLOCKOUT_MS)
  const longShifts = rows.filter((r) => r.ended_at && durationMs(r) > LONG_SHIFT_MS)

  type Exception = { row: ShiftRow; text: string; canApprove: boolean }
  const exceptions: Exception[] = [
    ...noClockOut.map((row) => {
      const worker = workerById.get(row.worker_id)
      const site = row.site_id ? siteById.get(row.site_id) : undefined
      return {
        row,
        text: `${worker?.name ?? row.worker_id} — clocked in ${new Date(row.started_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} at ${site?.name ?? 'an unknown site'}, never clocked out`,
        canApprove: false,
      }
    }),
    ...longShifts.map((row) => {
      const worker = workerById.get(row.worker_id)
      return {
        row,
        text: `${worker?.name ?? row.worker_id} — ${hours(durationMs(row))} h in one shift — check for a missed clock-out`,
        canApprove: true,
      }
    }),
  ]

  const openEdit = (row: ShiftRow) => {
    setAdding(false)
    setEditError(null)
    setEditTarget(row)
    setEditDraft({
      siteId: row.site_id ?? '',
      costCode: row.cost_code ?? '',
      start: toLocalInput(new Date(row.started_at)),
      end: row.ended_at ? toLocalInput(new Date(row.ended_at)) : '',
    })
  }
  const closeEdit = () => {
    setEditTarget(null)
    setEditDraft(null)
    setEditError(null)
  }

  async function saveEdit() {
    if (!editTarget || !editDraft) return
    const start = new Date(editDraft.start)
    if (Number.isNaN(start.getTime())) {
      setEditError('Start time is invalid.')
      return
    }
    const end = editDraft.end ? new Date(editDraft.end) : null
    if (end && Number.isNaN(end.getTime())) {
      setEditError('End time is invalid.')
      return
    }
    if (end && end.getTime() <= start.getTime()) {
      setEditError('End must be after start.')
      return
    }

    const wasGps = editTarget.source === 'auto' && !editTarget.edited
    const startChanged = start.getTime() !== new Date(editTarget.started_at).getTime()
    const endChanged = (end?.getTime() ?? null) !== (editTarget.ended_at ? new Date(editTarget.ended_at).getTime() : null)
    if (wasGps && (startChanged || endChanged)) {
      const ok = window.confirm(
        'This shift was captured automatically by GPS. Overwriting the time replaces that record with a manual entry — the kind of edit that ends up in a wage dispute. Continue?',
      )
      if (!ok) return
    }

    setEditBusy(true)
    setEditError(null)
    const { error: err } = await supabase()
      .from('shifts')
      .update({
        started_at: start.toISOString(),
        ended_at: end ? end.toISOString() : null,
        site_id: editDraft.siteId || null,
        cost_code: editDraft.costCode || null,
        source: 'manual',
        edited: true,
      })
      .eq('id', editTarget.id)
    setEditBusy(false)
    if (err) {
      setEditError(err.message)
      return
    }
    closeEdit()
    await load()
    onChanged()
  }

  async function toggleApprove(row: ShiftRow) {
    setApproving((prev) => new Set(prev).add(row.id))
    const patch = row.approved_at
      ? { approved_at: null, approved_by: null }
      : { approved_at: new Date().toISOString(), approved_by: me.id }
    const { error: err } = await supabase().from('shifts').update(patch).eq('id', row.id)
    setApproving((prev) => {
      const next = new Set(prev)
      next.delete(row.id)
      return next
    })
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged()
  }

  async function approveAll() {
    const ids = rows.filter((r) => !r.approved_at).map((r) => r.id)
    if (ids.length === 0) return
    setBulkBusy(true)
    const { error: err } = await supabase()
      .from('shifts')
      .update({ approved_at: new Date().toISOString(), approved_by: me.id })
      .in('id', ids)
    setBulkBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged()
  }

  async function addShift() {
    if (!addDraft.workerId || !addDraft.start) {
      setAddError('A worker and a start time are required.')
      return
    }
    const start = new Date(addDraft.start)
    if (Number.isNaN(start.getTime())) {
      setAddError('Start time is invalid.')
      return
    }
    const end = addDraft.end ? new Date(addDraft.end) : null
    if (end && Number.isNaN(end.getTime())) {
      setAddError('End time is invalid.')
      return
    }
    if (end && end.getTime() <= start.getTime()) {
      setAddError('End must be after start.')
      return
    }

    setAddBusy(true)
    setAddError(null)
    const { error: err } = await supabase()
      .from('shifts')
      .insert({
        company_id: me.company_id,
        worker_id: addDraft.workerId,
        site_id: addDraft.siteId || null,
        cost_code: addDraft.costCode || null,
        started_at: start.toISOString(),
        ended_at: end ? end.toISOString() : null,
        source: 'manual',
      })
    setAddBusy(false)
    if (err) {
      setAddError(err.message)
      return
    }
    setAdding(false)
    setAddDraft(blankAdd)
    await load()
    onChanged()
  }

  function exportCsv() {
    const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const header = ['Worker', 'Date', 'Site', 'Cost code', 'Start', 'End', 'Hours', 'Source', 'Approved']
    const lines = [header.join(',')]
    for (const row of rows) {
      const worker = workerById.get(row.worker_id)
      const site = row.site_id ? siteById.get(row.site_id) : undefined
      const start = new Date(row.started_at)
      const end = row.ended_at ? new Date(row.ended_at) : null
      const fields = [
        worker?.name ?? row.worker_id,
        start.toLocaleDateString(),
        site?.name ?? '',
        row.cost_code ?? defaultCostCode(worker?.trade),
        hhmm(start),
        end ? hhmm(end) : 'Open',
        hours(durationMs(row)),
        row.source === 'auto' && !row.edited ? 'GPS' : 'Manual',
        row.approved_at ? 'Yes' : 'No',
      ]
      lines.push(fields.map((f) => csvField(String(f))).join(','))
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const label = view === 'day' ? ymd(rangeStart) : `${ymd(rangeStart)}_to_${ymd(addDays(rangeEnd, -1))}`
    const a = document.createElement('a')
    a.href = url
    a.download = `timesheets-${label}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const totalMs = rows.reduce((sum, r) => sum + durationMs(r), 0)
  const totalCost = rows.reduce((sum, r) => sum + (durationMs(r) / 3_600_000) * (workerById.get(r.worker_id)?.rate ?? 0), 0)
  const approvedCount = rows.filter((r) => r.approved_at).length

  // ---------------------------------------------------------------- week grid
  const weekDays = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)), [weekStart])

  const weekCell = (workerId: string, day: Date) =>
    rows.filter((r) => r.worker_id === workerId && startOfDay(new Date(r.started_at)).getTime() === day.getTime())

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Timesheets</h1>

          <div style={{ display: 'flex', border: `1px solid ${theme.border}`, borderRadius: 4, overflow: 'hidden' }}>
            {(['day', 'week'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '5px 12px',
                  border: 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '.05em',
                  textTransform: 'uppercase',
                  background: view === v ? theme.accentFill : theme.panel,
                  color: view === v ? theme.accent : theme.inkSoft,
                }}
              >
                {v}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button style={ghost} onClick={() => setAnchor((a) => addDays(a, -step))}>
              ‹
            </button>
            <span style={{ fontSize: 13, color: theme.inkSoft, minWidth: 150, textAlign: 'center' }}>{dateLabel}</span>
            <button style={ghost} onClick={() => setAnchor((a) => addDays(a, step))}>
              ›
            </button>
            <button style={ghost} onClick={() => setAnchor(startOfDay(new Date()))}>
              Today
            </button>
          </div>

          {canEdit && !adding && !editTarget && (
            <button onClick={() => { setEditTarget(null); setAdding(true); setAddDraft(blankAdd); setAddError(null) }} style={cta}>
              ADD SHIFT
            </button>
          )}

          {!canEdit && (
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: theme.inkSoft }}>
              Showing your own hours — read only.
            </span>
          )}
        </div>

        {error && (
          <div style={{ margin: '10px 0', fontSize: 12.5, color: theme.alert }}>{error}</div>
        )}

        {exceptions.length > 0 && (
          <div
            style={{
              margin: '12px 0',
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderLeft: `3px solid ${theme.alert}`,
              borderRadius: 6,
              padding: '10px 14px',
            }}
          >
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em', color: theme.alert, marginBottom: 6 }}>
              NEEDS ATTENTION · {exceptions.length}
            </div>
            {exceptions.map((ex) => (
              <div key={ex.row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0', fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{ex.text}</span>
                {canEdit && (
                  <>
                    <button style={ghost} onClick={() => openEdit(ex.row)}>
                      Edit
                    </button>
                    {ex.canApprove && !ex.row.approved_at && (
                      <button style={ghost} onClick={() => void toggleApprove(ex.row)}>
                        Approve
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {adding && canEdit && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add a manual shift</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <SelectField
                label="Worker"
                value={addDraft.workerId}
                onChange={(v) => setAddDraft({ ...addDraft, workerId: v })}
                options={[{ value: '', label: 'Select…' }, ...workers.map((w) => ({ value: w.id, label: `${w.name} · ${w.trade}` }))]}
                width={200}
              />
              <SelectField
                label="Job site"
                value={addDraft.siteId}
                onChange={(v) => setAddDraft({ ...addDraft, siteId: v })}
                options={[{ value: '', label: 'No site' }, ...sites.map((s) => ({ value: s.id, label: s.name }))]}
                width={170}
              />
              <SelectField
                label="Cost code"
                value={addDraft.costCode}
                onChange={(v) => setAddDraft({ ...addDraft, costCode: v })}
                options={[{ value: '', label: 'Use trade default' }, ...costCodes.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))]}
                width={200}
              />
              <TimeField label="Start" value={addDraft.start} onChange={(v) => setAddDraft({ ...addDraft, start: v })} />
              <TimeField label="End (blank = still on clock)" value={addDraft.end} onChange={(v) => setAddDraft({ ...addDraft, end: v })} />
            </div>
            {addError && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{addError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void addShift()} disabled={addBusy} style={cta}>
                {addBusy ? 'SAVING…' : 'ADD SHIFT'}
              </button>
              <button onClick={() => setAdding(false)} style={ghost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {editTarget && editDraft && canEdit && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              Editing {workerById.get(editTarget.worker_id)?.name ?? editTarget.worker_id}'s shift
              {editTarget.source === 'auto' && !editTarget.edited && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: theme.inkSoft }}>
                  — currently GPS-captured
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <SelectField
                label="Job site"
                value={editDraft.siteId}
                onChange={(v) => setEditDraft({ ...editDraft, siteId: v })}
                options={[{ value: '', label: 'No site' }, ...sites.map((s) => ({ value: s.id, label: s.name }))]}
                width={170}
              />
              <SelectField
                label="Cost code"
                value={editDraft.costCode}
                onChange={(v) => setEditDraft({ ...editDraft, costCode: v })}
                options={[{ value: '', label: 'Use trade default' }, ...costCodes.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))]}
                width={200}
              />
              <TimeField label="Start" value={editDraft.start} onChange={(v) => setEditDraft({ ...editDraft, start: v })} />
              <TimeField label="End (blank = still on clock)" value={editDraft.end} onChange={(v) => setEditDraft({ ...editDraft, end: v })} />
            </div>
            {editError && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{editError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void saveEdit()} disabled={editBusy} style={cta}>
                {editBusy ? 'SAVING…' : 'SAVE CHANGES'}
              </button>
              <button onClick={closeEdit} style={ghost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {view === 'day' ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={head}>Worker</th>
                  <th style={head}>Job site</th>
                  <th style={head}>Cost code</th>
                  <th style={head}>In</th>
                  <th style={head}>Out</th>
                  <th style={{ ...head, textAlign: 'right' }}>Hours</th>
                  <th style={head}>Source</th>
                  {canEdit && <th style={{ ...head, textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 8 : 7} style={{ ...cell, color: theme.inkSoft, padding: 24 }}>
                      No shifts for this day.
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={canEdit ? 8 : 7} style={{ ...cell, color: theme.inkSoft, padding: 24 }}>
                      Loading…
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const worker = workerById.get(row.worker_id)
                  const site = row.site_id ? siteById.get(row.site_id) : undefined
                  const open = row.ended_at === null
                  const isApproved = Boolean(row.approved_at)
                  const code = row.cost_code ?? defaultCostCode(worker?.trade)
                  const isApproving = approving.has(row.id)
                  return (
                    <Fragment key={row.id}>
                      <tr style={isApproved ? { background: '#F5FBF6' } : undefined}>
                        <td style={{ ...cell, fontWeight: 500 }}>
                          {worker?.name ?? row.worker_id}
                          <span style={{ color: theme.inkFaint, fontWeight: 400 }}> · {worker?.trade}</span>
                        </td>
                        <td style={cell}>{site?.name ?? '—'}</td>
                        <td style={{ ...cell, color: theme.inkSoft, fontSize: 12 }}>{code}</td>
                        <td style={cell}>{hhmm(new Date(row.started_at))}</td>
                        <td style={{ ...cell, color: open ? theme.success : theme.ink }}>
                          {open ? 'On the clock' : hhmm(new Date(row.ended_at!))}
                        </td>
                        <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                          {hours(durationMs(row))}
                        </td>
                        <td style={cell}>
                          <Provenance source={row.source} edited={row.edited} />
                        </td>
                        {canEdit && (
                          <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button style={{ ...ghost, marginRight: 6 }} onClick={() => openEdit(row)}>
                              Edit
                            </button>
                            <button
                              onClick={() => void toggleApprove(row)}
                              disabled={isApproving}
                              style={{
                                ...ghost,
                                borderColor: isApproved ? theme.success : theme.border,
                                background: isApproved ? '#EAF7EE' : theme.panel,
                                color: isApproved ? '#1B7A32' : theme.ink,
                              }}
                            >
                              {isApproved ? '✓ Approved' : 'Approve'}
                            </button>
                          </td>
                        )}
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={head}>Worker</th>
                    {weekDays.map((d) => (
                      <th key={d.getTime()} style={{ ...head, textAlign: 'right' }}>
                        {d.toLocaleDateString([], { weekday: 'short' })}
                        <br />
                        {d.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </th>
                    ))}
                    <th style={{ ...head, textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWorkers.length === 0 && (
                    <tr>
                      <td colSpan={weekDays.length + 2} style={{ ...cell, color: theme.inkSoft, padding: 24 }}>
                        No crew to show.
                      </td>
                    </tr>
                  )}
                  {visibleWorkers.map((worker) => {
                    let weekMs = 0
                    const dayCells = weekDays.map((day) => {
                      const shiftsThatDay = weekCell(worker.id, day)
                      const ms = shiftsThatDay.reduce((sum, s) => sum + durationMs(s), 0)
                      weekMs += ms
                      const allAuto = shiftsThatDay.length > 0 && shiftsThatDay.every((s) => s.source === 'auto' && !s.edited)
                      return { ms, count: shiftsThatDay.length, allAuto }
                    })
                    const overtime = weekMs > OVERTIME_MS
                    return (
                      <tr key={worker.id}>
                        <td style={{ ...cell, fontWeight: 500 }}>
                          {worker.name}
                          <span style={{ color: theme.inkFaint, fontWeight: 400 }}> · {worker.trade}</span>
                        </td>
                        {dayCells.map((c, i) => (
                          <td key={weekDays[i]!.getTime()} style={{ ...cell, textAlign: 'right' }}>
                            {c.count === 0 ? (
                              <span style={{ color: theme.inkFaint }}>—</span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{hours(c.ms)}</span>
                                <Provenance source={c.allAuto ? 'auto' : 'manual'} edited={!c.allAuto} />
                              </span>
                            )}
                          </td>
                        ))}
                        <td
                          style={{
                            ...cell,
                            textAlign: 'right',
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            color: overtime ? theme.alert : theme.ink,
                          }}
                        >
                          {hours(weekMs)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '10px 14px', background: theme.appBg, fontSize: 12.5, flexWrap: 'wrap' }}>
            <span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{hours(totalMs)}</strong> hours
            </span>
            <span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>${Math.round(totalCost).toLocaleString()}</strong> labour cost
            </span>
            <span style={{ color: theme.inkSoft }}>
              {approvedCount} of {rows.length} approved
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {canEdit && (
                <button style={ghost} onClick={() => void approveAll()} disabled={bulkBusy || rows.every((r) => r.approved_at)}>
                  {bulkBusy ? 'Approving…' : 'Approve all'}
                </button>
              )}
              <button style={cta} onClick={exportCsv} disabled={rows.length === 0}>
                EXPORT TO PAYROLL
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
  width = 170,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  width?: number
}) {
  return (
    <label style={fieldLabel}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...fieldInput, width }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={fieldLabel}>
      {label}
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...fieldInput, width: 200 }} />
    </label>
  )
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
  font: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: 0,
  textTransform: 'none' as const,
  color: theme.ink,
  background: theme.panel,
} as const

const cell = {
  padding: '7px 10px',
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 13,
  verticalAlign: 'middle',
} as const

const head = {
  ...cell,
  position: 'sticky' as const,
  top: 0,
  background: theme.appBg,
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const,
}

const card = {
  margin: '14px 0',
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const ghost = {
  padding: '4px 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
} as const

const cta = {
  padding: '5px 12px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
} as const
