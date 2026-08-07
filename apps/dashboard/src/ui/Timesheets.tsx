import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { supabase, type ShiftRow, type WorkerRow } from '../data/supabase'
import { costCodes } from '../data/seed'
import { theme } from '../theme'
import { money, money2 } from '../format'
import type { JobSite, Worker } from '../types'

/**
 * Timesheets reads and writes the `shifts` table directly rather than taking
 * a snapshot prop — approvals and edits have to survive a reload, and the
 * only way to prove that is to round-trip through Supabase every time.
 * RLS does the access control for us: shifts_office_write means field users'
 * writes are rejected server-side, and shifts_read means a field user's
 * `rows`/`openWatch` never contain anyone else's shifts in the first place —
 * the UI still narrows the view for them so the layout reads sensibly.
 *
 * Colours below that aren't already on `theme` are lifted verbatim from
 * design/screens/isTimesheets.html — that file, not this comment, is the
 * source of truth if the two ever disagree.
 */

const MUTED = '#8B9096'
const INK2 = '#4A5057'
const HAIRLINE = '#EDEFF1'
const HAIRLINE2 = '#F1F3F5'
const PANEL_ALT = '#FAFBFC'
const ALERT_FILL = '#FDECEE'
const ALERT_DARK = '#A00417'
const MANUAL_FILL = '#FFF6DE'
const MANUAL_BORDER = '#F0DCA8'
const OVER_BORDER = '#F3C4CB'
const PIN_STROKE = '#9AA0A6'
const PENCIL_STROKE = '#B98A13'
const PENCIL_LEGEND = '#8A6100'
const PIN_LEGEND = '#4A5057'
const APPROVED_GREEN = '#1B7A2C'
/** Distinct dot colours for job-site chips in the split-shift breakdown — cycled by site order. */
const SITE_DOT_COLORS = ['#4C7FB8', '#5C8A63', '#B8864C', '#8A6FB0', '#4CA0A6', '#B85C7A']

const DAY_MS = 86_400_000
const NO_CLOCKOUT_MS = 12 * 3_600_000
const LONG_SHIFT_MS = 14 * 3_600_000
/**
 * Ordinary hours in an Australian working week. The NES caps ordinary hours at
 * 38 and the on-site construction award follows it — 40 is the US week, and
 * using it silently underpays overtime by two hours.
 */
const ORDINARY_WEEKLY_HRS = 38
const OVERTIME_MS = ORDINARY_WEEKLY_HRS * 3_600_000

const pad2 = (n: number) => String(n).padStart(2, '0')
/** Two-decimal hours, kept only for the CSV export — payroll wants the precision. */
const hours = (ms: number) => (ms / 3_600_000).toFixed(2)
/** One-decimal hours for on-screen figures, matching the density of the design. */
const fmtHrs1 = (ms: number) => (ms / 3_600_000).toFixed(1)
const hhmm = (d: Date) => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
const shortDate = (d: Date) =>
  `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${d.toLocaleDateString('en-AU', { month: 'short' })} ${d.getDate()}`

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
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`

const defaultCostCode = (trade?: string) => {
  if (trade === 'Electrician') return costCodes[5].code
  if (trade === 'Finish carpenter') return costCodes[3].code
  return costCodes[2].code
}

/** Paid time: clock-to-clock, less any unpaid break the worker recorded. */
const durationMs = (row: ShiftRow) => {
  const gross = Math.max(
    0,
    (row.ended_at ? new Date(row.ended_at).getTime() : Date.now()) - new Date(row.started_at).getTime(),
  )
  return Math.max(0, gross - (row.break_minutes ?? 0) * 60_000)
}

const fmtApprovedStamp = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
}

// -------------------------------------------------------------------- icons
// Every icon below is traced from isTimesheets.html's inline <svg> markup —
// same viewBox, same path data, same stroke widths — just parametrised for
// the couple of places each one is reused at a different size or colour.

function PinIcon({ size = 11, stroke = PIN_STROKE, strokeWidth = 1.6, circleR = 1.6 }: { size?: number; stroke?: string; strokeWidth?: number; circleR?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={strokeWidth} style={{ flex: 'none' }}>
      <path d="M8 14.2s4.6-4.4 4.6-7.6a4.6 4.6 0 10-9.2 0C3.4 9.8 8 14.2 8 14.2z" strokeLinejoin="round" />
      <circle cx="8" cy="6.4" r={circleR} />
    </svg>
  )
}

function PencilIcon({ size = 11, stroke = PENCIL_STROKE, strokeWidth = 1.7 }: { size?: number; stroke?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={strokeWidth} style={{ flex: 'none' }}>
      <path d="M11.2 2.4l2.4 2.4-8 8H3.2v-3z" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon({ size = 11, color = APPROVED_GREEN }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.4l3.2 3.2L13 4.8" />
    </svg>
  )
}

function InfoIcon({ size = 12, stroke = MUTED }: { size?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.4} style={{ flex: 'none' }}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5.2v.01M8 7.4v3.4" strokeLinecap="round" strokeWidth={1.6} />
    </svg>
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

  const [view, setView] = useState<'day' | 'week'>('week')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [siteFilter, setSiteFilter] = useState('')
  const [crewFilter, setCrewFilter] = useState('')

  const [rows, setRows] = useState<ShiftRow[]>([])
  const [openWatch, setOpenWatch] = useState<ShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [expanded, setExpanded] = useState<{ workerId: string; dayMs: number } | null>(null)

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
  const siteDotColor = useCallback(
    (siteId: string | null) => {
      if (!siteId) return theme.inkFaint
      const idx = sites.findIndex((s) => s.id === siteId)
      return SITE_DOT_COLORS[(idx < 0 ? 0 : idx) % SITE_DOT_COLORS.length]!
    },
    [sites],
  )

  // Site/crew pickers and the office/field visibility rule both narrow the
  // same base set, so every downstream figure — grid, footer, CSV — agrees.
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) => (!siteFilter || r.site_id === siteFilter) && (!crewFilter || r.worker_id === crewFilter),
      ),
    [rows, siteFilter, crewFilter],
  )
  const filteredOpenWatch = useMemo(
    () =>
      openWatch.filter(
        (r) => (!siteFilter || r.site_id === siteFilter) && (!crewFilter || r.worker_id === crewFilter),
      ),
    [openWatch, siteFilter, crewFilter],
  )
  const visibleRows = useMemo(
    () => (canEdit ? filteredRows : filteredRows.filter((r) => r.worker_id === me.id)),
    [filteredRows, canEdit, me.id],
  )

  const dateLabel = view === 'day' ? shortDate(dayStart) : `${shortDate(weekStart)} – ${shortDate(addDays(weekStart, 6))}`
  const step = view === 'day' ? 1 : 7

  const now = Date.now()
  const noClockOut = filteredOpenWatch.filter((r) => now - new Date(r.started_at).getTime() > NO_CLOCKOUT_MS)
  // Already-approved long shifts don't belong on a "clear these" list — that's the whole point of clearing them.
  const longShifts = filteredRows.filter((r) => r.ended_at && !r.approved_at && durationMs(r) > LONG_SHIFT_MS)

  type Exception = { row: ShiftRow; ini: string; name: string; what: string; day: string; canApprove: boolean }
  const exceptions: Exception[] = [
    ...noClockOut.map((row): Exception => {
      const worker = workerById.get(row.worker_id)
      const site = row.site_id ? siteById.get(row.site_id) : undefined
      return {
        row,
        ini: worker?.initials ?? '??',
        name: worker?.name ?? row.worker_id,
        what: `clocked in ${new Date(row.started_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })} at ${site?.name ?? 'an unknown site'}, never clocked out`,
        day: new Date(row.started_at).toLocaleDateString('en-AU', { weekday: 'short' }),
        canApprove: false,
      }
    }),
    ...longShifts.map((row): Exception => {
      const worker = workerById.get(row.worker_id)
      return {
        row,
        ini: worker?.initials ?? '??',
        name: worker?.name ?? row.worker_id,
        what: `${fmtHrs1(durationMs(row))} h in one shift — check for a missed clock-out`,
        day: new Date(row.started_at).toLocaleDateString('en-AU', { weekday: 'short' }),
        canApprove: true,
      }
    }),
  ]
  const exceptionIds = new Set(exceptions.map((e) => e.row.id))

  const openAdd = () => {
    setEditTarget(null)
    setAdding(true)
    setAddDraft(blankAdd)
    setAddError(null)
  }
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

  /** Approves every not-yet-approved shift a single worker has in the displayed range — the grid's per-row APPROVE action. */
  async function approveWorkerRange(workerId: string) {
    const ids = filteredRows.filter((r) => r.worker_id === workerId && !r.approved_at).map((r) => r.id)
    if (ids.length === 0) return
    setApproving((prev) => new Set(prev).add(workerId))
    const { error: err } = await supabase()
      .from('shifts')
      .update({ approved_at: new Date().toISOString(), approved_by: me.id })
      .in('id', ids)
    setApproving((prev) => {
      const next = new Set(prev)
      next.delete(workerId)
      return next
    })
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged()
  }

  /** "Approve all with notes" — bulk-clears the exceptions that are actually approvable, with one shared note attached to each. */
  async function approveExceptionsWithNote() {
    const approvable = exceptions.filter((ex) => ex.canApprove && !ex.row.approved_at)
    if (approvable.length === 0) {
      window.alert('None of the current exceptions can be approved directly — a missing clock-out needs an edit first.')
      return
    }
    const note = window.prompt(
      `Approve ${approvable.length} exception${approvable.length === 1 ? '' : 's'} with a note for the record:`,
      '',
    )
    if (note === null) return
    setBulkBusy(true)
    const { error: err } = await supabase()
      .from('shifts')
      .update({ approved_at: new Date().toISOString(), approved_by: me.id, note: note || null })
      .in(
        'id',
        approvable.map((ex) => ex.row.id),
      )
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

  /**
   * Payroll export.
   *
   * Three shapes, because a builder's bookkeeper uses one of two packages and
   * an auditor wants the third:
   *  - Detailed  every shift, with GPS-or-edited provenance. The audit trail.
   *  - Xero      one line per employee per earnings rate per day.
   *  - MYOB      AccountRight timesheet shape, activity + job per day.
   *
   * Ordinary and overtime are split at 38 hours in the week, per the NES.
   * Earnings-rate and activity names have to match what is set up in the
   * payroll package — they are named conventionally here and surfaced in the
   * UI so a mismatch is obvious before import rather than after.
   */
  const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

  function download(name: string, lines: string[][]) {
    const body = lines.map((l) => l.map((f) => csvField(String(f))).join(',')).join('\r\n')
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /** ISO date, which both packages accept unambiguously. */
  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  /**
   * Split each worker's visible shifts into ordinary and overtime, walking the
   * week in order so the 38th hour is the boundary — not a per-day guess.
   */
  function splitOrdinaryOvertime() {
    const byWorkerWeek = new Map<string, ShiftRow[]>()
    for (const row of visibleRows) {
      const key = `${row.worker_id}|${mondayOf(new Date(row.started_at)).getTime()}`
      const list = byWorkerWeek.get(key)
      if (list) list.push(row)
      else byWorkerWeek.set(key, [row])
    }
    const out: Array<{ row: ShiftRow; ordinaryHrs: number; overtimeHrs: number }> = []
    for (const list of byWorkerWeek.values()) {
      list.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
      let running = 0
      for (const row of list) {
        const hrs = durationMs(row) / 3_600_000
        const roomLeft = Math.max(0, ORDINARY_WEEKLY_HRS - running)
        const ordinaryHrs = Math.min(hrs, roomLeft)
        out.push({ row, ordinaryHrs, overtimeHrs: hrs - ordinaryHrs })
        running += hrs
      }
    }
    return out
  }

  function exportDetailed() {
    const lines: string[][] = [
      ['Worker', 'Date', 'Site', 'Cost code', 'Start', 'End', 'Break (min)', 'Paid hours', 'Source', 'Approved'],
    ]
    for (const row of visibleRows) {
      const worker = workerById.get(row.worker_id)
      const site = row.site_id ? siteById.get(row.site_id) : undefined
      const start = new Date(row.started_at)
      const end = row.ended_at ? new Date(row.ended_at) : null
      lines.push([
        worker?.name ?? row.worker_id,
        isoDay(start),
        site?.name ?? '',
        row.cost_code ?? defaultCostCode(worker?.trade),
        hhmm(start),
        end ? hhmm(end) : 'Open',
        String(row.break_minutes ?? 0),
        hours(durationMs(row)),
        row.source === 'auto' && !row.edited ? 'GPS' : 'Manual',
        row.approved_at ? 'Yes' : 'No',
      ])
    }
    download('timesheet-detailed.csv', lines)
  }

  function exportXero() {
    const lines: string[][] = [['Employee', 'Earnings Rate', 'Tracking Option', 'Date', 'Units']]
    for (const { row, ordinaryHrs, overtimeHrs } of splitOrdinaryOvertime()) {
      const worker = workerById.get(row.worker_id)
      const site = row.site_id ? siteById.get(row.site_id) : undefined
      const day = isoDay(new Date(row.started_at))
      if (ordinaryHrs > 0) {
        lines.push([worker?.name ?? row.worker_id, 'Ordinary Hours', site?.name ?? '', day, ordinaryHrs.toFixed(2)])
      }
      if (overtimeHrs > 0) {
        lines.push([worker?.name ?? row.worker_id, 'Overtime Hours', site?.name ?? '', day, overtimeHrs.toFixed(2)])
      }
    }
    download('timesheet-xero.csv', lines)
  }

  function exportMyob() {
    const lines: string[][] = [['Last Name', 'First Name', 'Activity', 'Job', 'Date', 'Units', 'Notes']]
    for (const { row, ordinaryHrs, overtimeHrs } of splitOrdinaryOvertime()) {
      const worker = workerById.get(row.worker_id)
      const parts = (worker?.name ?? '').split(/\s+/)
      const first = parts.shift() ?? ''
      const last = parts.join(' ') || first
      const site = row.site_id ? siteById.get(row.site_id) : undefined
      const day = isoDay(new Date(row.started_at))
      const note = row.source === 'auto' && !row.edited ? 'GPS verified' : 'Office edit'
      if (ordinaryHrs > 0) lines.push([last, first, 'Ordinary Hours', site?.name ?? '', day, ordinaryHrs.toFixed(2), note])
      if (overtimeHrs > 0) lines.push([last, first, 'Overtime Hours', site?.name ?? '', day, overtimeHrs.toFixed(2), note])
    }
    download('timesheet-myob.csv', lines)
  }

  // ---------------------------------------------------------------- week grid
  const weekDays = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)), [weekStart])
  const todayMs = startOfDay(new Date()).getTime()
  const tsDays = weekDays.map((d) => ({
    date: d,
    label: `${d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()} ${d.getDate()}`,
    fg: d.getTime() === todayMs ? theme.accent : theme.inkSoft,
  }))

  const tsRows = visibleWorkers.map((worker) => {
    const workerShifts = filteredRows.filter((r) => r.worker_id === worker.id)
    const dayCells = weekDays.map((day) => {
      const shifts = workerShifts.filter((r) => startOfDay(new Date(r.started_at)).getTime() === day.getTime())
      return { day, shifts, ms: shifts.reduce((sum, s) => sum + durationMs(s), 0) }
    })
    const weekMs = dayCells.reduce((sum, c) => sum + c.ms, 0)
    const flagCount = exceptions.filter((e) => e.row.worker_id === worker.id).length
    const overtime = weekMs > OVERTIME_MS
    const allApproved = workerShifts.length > 0 && workerShifts.every((r) => r.approved_at)
    const latestApproved = allApproved
      ? workerShifts.reduce((latest, r) => (r.approved_at! > latest ? r.approved_at! : latest), workerShifts[0]!.approved_at!)
      : null
    return { worker, dayCells, weekMs, workerShifts, flagCount, overtime, allApproved, latestApproved }
  })

  const gridCols = `196px repeat(7,minmax(58px,1fr)) 72px 118px${canEdit ? ' 112px' : ''}`
  const gridMinWidth = canEdit ? 1150 : 1038

  const weekWorkersWithShifts = tsRows.filter((r) => r.workerShifts.length > 0)
  const weekTotalMs = tsRows.reduce((s, r) => s + r.weekMs, 0)
  const weekOtMs = tsRows.reduce((s, r) => s + Math.max(0, r.weekMs - OVERTIME_MS), 0)
  const weekRegularMs = weekTotalMs - weekOtMs
  const weekCost = tsRows.reduce((s, r) => s + (r.weekMs / 3_600_000) * r.worker.rate, 0)
  const weekApprovedCount = weekWorkersWithShifts.filter((r) => r.allApproved).length
  const weekPendingCount = weekWorkersWithShifts.length - weekApprovedCount

  const dayTotalMs = visibleRows.reduce((s, r) => s + durationMs(r), 0)
  const dayCost = visibleRows.reduce((s, r) => s + (durationMs(r) / 3_600_000) * (workerById.get(r.worker_id)?.rate ?? 0), 0)
  const dayApprovedCount = visibleRows.filter((r) => r.approved_at).length

  const pctScope = view === 'week' ? tsRows.flatMap((r) => r.workerShifts) : visibleRows
  const pctTotalMs = pctScope.reduce((s, r) => s + durationMs(r), 0)
  const pctAutoMs = pctScope.filter((r) => r.source === 'auto' && !r.edited).reduce((s, r) => s + durationMs(r), 0)
  const autoPct = pctTotalMs > 0 ? Math.round((pctAutoMs / pctTotalMs) * 100) : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg }}>
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
        <div style={{ flex: 'none', display: 'flex', height: 27, border: `1px solid ${theme.border}`, borderRadius: 3, overflow: 'hidden' }}>
          {(['day', 'week'] as const).map((v, i) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 11px',
                background: view === v ? theme.accentFill : theme.panel,
                color: view === v ? theme.accent : theme.ink,
                fontWeight: view === v ? 600 : 500,
                fontSize: 12.5,
                border: 'none',
                borderLeft: i > 0 ? `1px solid ${theme.border}` : 'none',
                fontFamily: 'inherit',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {v === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
        </div>

        <div style={{ flex: 'none', display: 'flex', height: 27, border: `1px solid ${theme.border}`, borderRadius: 3, overflow: 'hidden' }}>
          <span onClick={() => setAnchor((a) => addDays(a, -step))} style={arrowBtn}>
            ‹
          </span>
          <span style={dateLabelStyle}>{dateLabel}</span>
          <span onClick={() => setAnchor((a) => addDays(a, step))} style={arrowBtn}>
            ›
          </span>
        </div>

        <button onClick={() => setAnchor(startOfDay(new Date()))} style={toolbarGhost}>
          {view === 'week' ? 'This week' : 'Today'}
        </button>

        <div style={divider} />

        <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} style={filterSelect}>
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {canEdit && (
          <select value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)} style={filterSelect}>
            <option value="">All crew</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}

        <div style={divider} />

        {exceptions.length > 0 && (
          <span
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 27,
              padding: '0 10px',
              borderRadius: 3,
              background: ALERT_FILL,
              fontSize: 12.5,
              fontWeight: 600,
              color: ALERT_DARK,
              whiteSpace: 'nowrap',
            }}
          >
            {exceptions.length} exception{exceptions.length === 1 ? '' : 's'}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 9 }}>
          {canEdit && (
            <button onClick={openAdd} style={toolbarGhost}>
              Add shift
            </button>
          )}
          <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>
              {canEdit
                ? `Ordinary hours split at ${ORDINARY_WEEKLY_HRS}/week · breaks deducted`
                : 'Showing your own hours — read only.'}
            </span>
          </div>
          {canEdit && (
            <select
              value=""
              disabled={visibleRows.length === 0}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'xero') exportXero()
                else if (v === 'myob') exportMyob()
                else if (v === 'detailed') exportDetailed()
                e.currentTarget.value = ''
              }}
              style={{ ...cta, appearance: 'none', paddingRight: 22 }}
              title="Downloads a CSV — earnings rate names must match your payroll setup"
            >
              <option value="">EXPORT TO PAYROLL ▾</option>
              <option value="xero">Xero timesheet</option>
              <option value="myob">MYOB timesheet</option>
              <option value="detailed">Detailed (audit trail)</option>
            </select>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px 40px' }}>
        {error && <div style={{ marginBottom: 12, fontSize: 12.5, color: theme.alert }}>{error}</div>}

        {exceptions.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderLeft: `3px solid ${theme.alert}`,
              borderRadius: 8,
              overflow: 'hidden',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px', borderBottom: `1px solid ${theme.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                Exceptions — clear these before you export
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 9,
                    background: theme.alert,
                    color: '#fff',
                    fontSize: 10.5,
                    fontWeight: 700,
                  }}
                >
                  {exceptions.length}
                </span>
              </span>
              {canEdit && (
                <button onClick={() => void approveExceptionsWithNote()} disabled={bulkBusy} style={linkBtn}>
                  Approve all with notes
                </button>
              )}
            </div>

            {exceptions.map((ex) => (
              <div key={ex.row.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', borderBottom: `1px solid ${HAIRLINE2}` }}>
                <span style={avatar(24, 9)}>{ex.ini}</span>
                <span style={{ flex: 'none', width: 148, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ex.name}</span>
                <span style={{ flex: 1, fontSize: 12.5, color: INK2, minWidth: 0 }}>{ex.what}</span>
                <span style={{ flex: 'none', fontSize: 12, color: MUTED, width: 62 }}>{ex.day}</span>
                {canEdit && (
                  <span style={{ flex: 'none', display: 'flex', gap: 6 }}>
                    {ex.canApprove && !ex.row.approved_at && (
                      <button style={excRowBtn} onClick={() => void toggleApprove(ex.row)}>
                        Approve
                      </button>
                    )}
                    <button style={excRowBtn} onClick={() => openEdit(ex.row)}>
                      Edit
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {adding && canEdit && (
          <div style={formCard}>
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
              <button onClick={() => setAdding(false)} style={toolbarGhost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {editTarget && editDraft && canEdit && (
          <div style={formCard}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              Editing {workerById.get(editTarget.worker_id)?.name ?? editTarget.worker_id}&rsquo;s shift
              {editTarget.source === 'auto' && !editTarget.edited && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: MUTED }}> — currently GPS-captured</span>
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
              <button onClick={closeEdit} style={toolbarGhost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {view === 'week' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 2px 9px', flexWrap: 'wrap' }}>
            <span style={legendItem}>
              <PinIcon size={13} stroke={PIN_LEGEND} strokeWidth={1.4} circleR={1.7} />
              Auto-captured by GPS
            </span>
            <span style={legendItem}>
              <PencilIcon size={13} stroke={PENCIL_LEGEND} strokeWidth={1.4} />
              Manually edited <Swatch bg={MANUAL_FILL} border={MANUAL_BORDER} />
            </span>
            <span style={legendItem}>
              <Swatch bg={ALERT_FILL} border={OVER_BORDER} />
              Over 40 hrs
            </span>
          </div>
        )}

        <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflowX: 'auto' }}>
          {view === 'day' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', padding: '7px 11px', background: PANEL_ALT, borderBottom: `1px solid ${theme.border}`, minWidth: 760 }}>
                <span style={{ ...dayHead, width: 190 }}>WORKER</span>
                <span style={{ ...dayHead, flex: 1 }}>SITE</span>
                <span style={{ ...dayHead, width: 120 }}>COST CODE</span>
                <span style={{ ...dayHead, width: 64, textAlign: 'right' }}>IN</span>
                <span style={{ ...dayHead, width: 64, textAlign: 'right' }}>OUT</span>
                <span style={{ ...dayHead, width: 56, textAlign: 'right' }}>HOURS</span>
                <span style={{ ...dayHead, width: 34 }} />
                {canEdit && <span style={{ ...dayHead, width: 168, textAlign: 'right' }}>ACTIONS</span>}
              </div>

              {loading && <div style={emptyRow}>Loading…</div>}
              {!loading && visibleRows.length === 0 && <div style={emptyRow}>No shifts for this day.</div>}

              {visibleRows.map((row) => {
                const worker = workerById.get(row.worker_id)
                const site = row.site_id ? siteById.get(row.site_id) : undefined
                const open = row.ended_at === null
                const code = row.cost_code ?? defaultCostCode(worker?.trade)
                const pin = row.source === 'auto' && !row.edited
                const edited = row.source === 'manual' || row.edited
                const isApproved = Boolean(row.approved_at)
                const isApproving = approving.has(row.id)
                return (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'center', padding: '7px 11px', borderBottom: `1px solid ${HAIRLINE}`, minWidth: 760 }}>
                    <span style={{ width: 190, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={avatar(25, 9.5)}>{worker?.initials ?? '??'}</span>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{worker?.name ?? row.worker_id}</span>
                        <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{worker?.trade ?? '—'}</span>
                      </span>
                    </span>
                    <span style={{ flex: 1, fontSize: 12.5, color: INK2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site?.name ?? '—'}</span>
                    <span style={{ width: 120, fontSize: 12, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{code}</span>
                    <span style={{ width: 64, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{hhmm(new Date(row.started_at))}</span>
                    <span style={{ width: 64, textAlign: 'right', fontSize: 12.5, color: open ? APPROVED_GREEN : theme.ink, fontVariantNumeric: 'tabular-nums' }}>
                      {open ? 'Now' : hhmm(new Date(row.ended_at!))}
                    </span>
                    <span style={{ width: 56, textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtHrs1(durationMs(row))}</span>
                    <span style={{ width: 34, display: 'flex', alignItems: 'center', gap: 3 }}>
                      {pin && <PinIcon />}
                      {edited && <PencilIcon />}
                    </span>
                    {canEdit && (
                      <span style={{ width: 168, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button style={excRowBtn} onClick={() => openEdit(row)}>
                          Edit
                        </button>
                        <button
                          style={isApproved ? { ...excRowBtn, borderColor: APPROVED_GREEN, background: '#EAF7EC', color: APPROVED_GREEN } : excRowBtn}
                          onClick={() => void toggleApprove(row)}
                          disabled={isApproving}
                        >
                          {isApproved ? 'Approved' : isApproving ? '…' : 'Approve'}
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </>
          ) : (
            <>
              <div style={{ display: 'grid', minWidth: gridMinWidth, gridTemplateColumns: gridCols, background: PANEL_ALT, borderBottom: `1px solid ${theme.border}` }}>
                <div style={gridHead}>WORKER</div>
                {tsDays.map((d) => (
                  <div key={d.date.getTime()} style={{ ...gridHead, borderLeft: `1px solid ${HAIRLINE}`, color: d.fg, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {d.label}
                  </div>
                ))}
                <div style={{ ...gridHead, borderLeft: `1px solid ${theme.border}`, textAlign: 'right' }}>TOTAL</div>
                <div style={{ ...gridHead, borderLeft: `1px solid ${HAIRLINE}`, padding: '7px 9px' }}>COMPLIANCE</div>
                {canEdit && <div style={{ ...gridHead, borderLeft: `1px solid ${HAIRLINE}`, padding: '7px 9px', textAlign: 'right' }}>APPROVE</div>}
              </div>

              {loading && <div style={emptyRow}>Loading…</div>}
              {!loading && tsRows.length === 0 && <div style={emptyRow}>No crew to show.</div>}

              {tsRows.map(({ worker, dayCells, weekMs, workerShifts, flagCount, overtime, allApproved, latestApproved }) => {
                const isPending = workerShifts.length > 0 && !allApproved
                const isApproving = approving.has(worker.id)
                return (
                  <Fragment key={worker.id}>
                    <div style={{ display: 'grid', minWidth: gridMinWidth, gridTemplateColumns: gridCols, borderBottom: `1px solid ${HAIRLINE}`, alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', minWidth: 0 }}>
                        <span style={avatar(25, 9.5)}>{worker.initials}</span>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{worker.name}</span>
                          <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>
                            {worker.trade} · {money2(worker.rate)}/hr
                          </span>
                        </div>
                      </div>

                      {dayCells.map((cell) => {
                        const isExpanded = expanded?.workerId === worker.id && expanded.dayMs === cell.day.getTime()
                        const canExpand = cell.shifts.length >= 2
                        const pin = cell.shifts.some((s) => s.source === 'auto' && !s.edited)
                        const edited = cell.shifts.some((s) => s.source === 'manual' || s.edited)
                        const hasFlag = cell.shifts.some((s) => exceptionIds.has(s.id))
                        return (
                          <div
                            key={cell.day.getTime()}
                            onClick={
                              canExpand
                                ? () => setExpanded(isExpanded ? null : { workerId: worker.id, dayMs: cell.day.getTime() })
                                : undefined
                            }
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              gap: 4,
                              padding: '7px 8px',
                              borderLeft: `1px solid ${HAIRLINE}`,
                              background: isExpanded ? theme.accentFill : 'transparent',
                              cursor: canExpand ? 'pointer' : 'default',
                            }}
                          >
                            {pin && <PinIcon />}
                            {edited && <PencilIcon />}
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: cell.ms > 0 ? 600 : 400,
                                color: cell.ms === 0 ? theme.inkFaint : hasFlag ? theme.alert : theme.ink,
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {cell.ms > 0 ? fmtHrs1(cell.ms) : '—'}
                            </span>
                          </div>
                        )
                      })}

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          padding: '7px 8px',
                          borderLeft: `1px solid ${theme.border}`,
                          background: overtime ? ALERT_FILL : 'transparent',
                        }}
                      >
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: overtime ? theme.alert : theme.ink, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtHrs1(weekMs)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', padding: '7px 9px', borderLeft: `1px solid ${HAIRLINE}` }}>
                        {flagCount > 0 ? (
                          <span style={compliancePill(ALERT_FILL, ALERT_DARK)}>
                            {flagCount} flag{flagCount > 1 ? 's' : ''}
                          </span>
                        ) : overtime ? (
                          <span style={compliancePill(MANUAL_FILL, PENCIL_LEGEND)}>Overtime</span>
                        ) : null}
                      </div>

                      {canEdit && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '7px 9px', borderLeft: `1px solid ${HAIRLINE}` }}>
                          {allApproved && latestApproved ? (
                            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: APPROVED_GREEN }}>
                                <CheckIcon /> Approved
                              </span>
                              <span style={{ fontSize: 10.5, color: MUTED }}>{fmtApprovedStamp(latestApproved)}</span>
                            </span>
                          ) : isPending ? (
                            <button onClick={() => void approveWorkerRange(worker.id)} disabled={isApproving} style={gridApproveBtn}>
                              {isApproving ? '…' : 'Approve'}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {expanded && expanded.workerId === worker.id && (
                      <ExpandPanel
                        shifts={dayCells.find((c) => c.day.getTime() === expanded.dayMs)?.shifts ?? []}
                        day={new Date(expanded.dayMs)}
                        defaultCode={defaultCostCode(worker.trade)}
                        siteById={siteById}
                        siteDotColor={siteDotColor}
                        onCollapse={() => setExpanded(null)}
                      />
                    )}
                  </Fragment>
                )
              })}
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 26, padding: '11px 13px', background: PANEL_ALT, borderTop: `1px solid ${theme.border}`, flexWrap: 'wrap', rowGap: 10 }}>
            <Stat label="TOTAL HOURS" value={fmtHrs1(view === 'week' ? weekTotalMs : dayTotalMs)} />
            {view === 'week' && (
              <Stat
                label="REGULAR / OT"
                value={
                  weekOtMs > 0 ? (
                    <>
                      {fmtHrs1(weekRegularMs)} <span style={{ color: theme.alert }}>/ {fmtHrs1(weekOtMs)}</span>
                    </>
                  ) : (
                    fmtHrs1(weekRegularMs)
                  )
                }
              />
            )}
            <Stat label="TOTAL LABOUR COST" value={money(view === 'week' ? weekCost : dayCost)} />
            <Stat
              label="APPROVED"
              value={view === 'week' ? `${weekApprovedCount} of ${weekWorkersWithShifts.length}` : `${dayApprovedCount} of ${visibleRows.length}`}
              color={APPROVED_GREEN}
            />
            {view === 'week' && <Stat label="PENDING" value={String(weekPendingCount)} color={PENCIL_LEGEND} />}
            <div style={{ flex: 1 }} />
            {autoPct !== null && (
              <span style={{ fontSize: 11.5, color: MUTED }}>
                {autoPct}% of hours captured automatically. {100 - autoPct}% edited by office.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ pieces

function ExpandPanel({
  shifts,
  day,
  defaultCode,
  siteById,
  siteDotColor,
  onCollapse,
}: {
  shifts: ShiftRow[]
  day: Date
  defaultCode: string
  siteById: Map<string, JobSite>
  siteDotColor: (siteId: string | null) => string
  onCollapse: () => void
}) {
  const totalMs = shifts.reduce((sum, s) => sum + durationMs(s), 0)
  const allAuto = shifts.length > 0 && shifts.every((s) => s.source === 'auto' && !s.edited)
  const sorted = [...shifts].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
  let gapMin = 0
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1]!.ended_at ? new Date(sorted[i - 1]!.ended_at!).getTime() : null
    const curStart = new Date(sorted[i]!.started_at).getTime()
    if (prevEnd && curStart > prevEnd) gapMin += Math.round((curStart - prevEnd) / 60_000)
  }
  const note = allAuto
    ? `Split created automatically from GPS site changes.${gapMin > 0 ? ` Travel between sites (${gapMin} min) is unpaid per company policy.` : ''}`
    : 'Includes a manually entered or edited segment.'
  const wd = day.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()
  const mo = day.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase()

  return (
    <div style={{ borderBottom: `1px solid ${HAIRLINE}`, background: PANEL_ALT, padding: '2px 11px 10px 46px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 6px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: theme.inkSoft, whiteSpace: 'nowrap' }}>
          {wd} {mo} {day.getDate()} — {fmtHrs1(totalMs)} HRS BROKEN OUT
        </span>
        <span style={{ flex: 1, height: 1, background: theme.border }} />
        <button onClick={onCollapse} style={linkBtnSm}>
          Collapse
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map((s) => {
          const site = s.site_id ? siteById.get(s.site_id) : undefined
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 4 }}>
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: siteDotColor(s.site_id) }} />
              <span style={{ flex: 'none', width: 150, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{site?.name ?? 'No site'}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: INK2, minWidth: 0 }}>{s.cost_code ?? defaultCode}</span>
              <span style={{ flex: 'none', fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
                {hhmm(new Date(s.started_at))} – {s.ended_at ? hhmm(new Date(s.ended_at)) : 'Open'}
              </span>
              <span style={{ flex: 'none', width: 52, textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtHrs1(durationMs(s))}</span>
            </div>
          )
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 0' }}>
          <InfoIcon />
          <span style={{ fontSize: 11.5, color: MUTED }}>{note}</span>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: MUTED, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 600, color: color ?? theme.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function Swatch({ bg, border }: { bg: string; border: string }) {
  return <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 2, background: bg, border: `1px solid ${border}` }} />
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

// ------------------------------------------------------------------ styles

const avatar = (size: number, fontSize: number): CSSProperties => ({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: size,
  height: size,
  borderRadius: '50%',
  background: theme.railSoft,
  color: '#fff',
  fontSize,
  fontWeight: 700,
})

const compliancePill = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 7px',
  borderRadius: 10,
  fontSize: 10.5,
  fontWeight: 600,
  lineHeight: 1.25,
  background: bg,
  color: fg,
})

const divider: CSSProperties = { flex: 'none', width: 1, height: 20, background: theme.border, margin: '0 4px' }

const arrowBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 9px',
  background: theme.panel,
  color: INK2,
  fontSize: 13,
  cursor: 'pointer',
}

const dateLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 11px',
  background: theme.panel,
  borderLeft: `1px solid ${theme.border}`,
  borderRight: `1px solid ${theme.border}`,
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const filterSelect: CSSProperties = {
  flex: 'none',
  height: 27,
  padding: '0 8px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  color: theme.ink,
  cursor: 'pointer',
}

const toolbarGhost: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 27,
  padding: '0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  color: theme.ink,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const excRowBtn: CSSProperties = {
  height: 24,
  padding: '0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  color: theme.ink,
  cursor: 'pointer',
}

const gridApproveBtn: CSSProperties = {
  height: 25,
  padding: '0 11px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  color: theme.ink,
  cursor: 'pointer',
}

const linkBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  color: theme.accent,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  padding: 0,
}

const linkBtnSm: CSSProperties = { ...linkBtn, fontSize: 11.5 }

const cta: CSSProperties = {
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
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const legendItem: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: theme.inkSoft, whiteSpace: 'nowrap' }

const gridHead: CSSProperties = {
  padding: '7px 11px',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  color: theme.inkSoft,
}

const dayHead: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  color: theme.inkSoft,
  whiteSpace: 'nowrap',
}

const emptyRow: CSSProperties = { padding: 24, textAlign: 'center', fontSize: 13, color: theme.inkSoft }

const formCard: CSSProperties = {
  marginBottom: 12,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
}

const fieldLabel: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: MUTED,
}

const fieldInput: CSSProperties = {
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
  textTransform: 'none',
  color: theme.ink,
  background: theme.panel,
}
