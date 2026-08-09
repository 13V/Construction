import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  supabase,
  type CertificationRow,
  type ShiftCorrectionRow,
  type ShiftRow,
  type TimeOffRow,
  type WorkerRow,
} from '../data/supabase'
import { theme } from '../theme'
import { CrewsPanel } from './CrewsPanel'
import { money2, shortDate } from '../format'
import type { JobSite, Worker } from '../types'

/**
 * Crew roster plus a per-person detail view, ported from
 * design/screens/isCrew.html.
 *
 * Data comes from three tables:
 *  - workers        the roster itself (also handed down, pre-filtered to
 *                    active staff, as the lightweight `workers` prop — this
 *                    file additionally reads `workers` directly for the
 *                    admin-only columns — invite state, office access, tenure
 *                    — that the shared `Worker` type doesn't carry)
 *  - certifications expiry-tracked docs, shown both as row chips and as the
 *                    "documents on file" list on the profile card
 *  - shifts          the only source for "on the clock", hours and overtime;
 *                    there is no live GPS snapshot in this screen's contract,
 *                    so status is a shift/sign-in read rather than the map's
 *                    geofence engine
 *
 * The design's "PHONE" column has no backing table (no phone number on
 * `workers`), so that column is left out rather than filled with something
 * that looks real. Everything else on this screen reads from Supabase.
 *
 * Time off and punch corrections are real (schema_v6): the crew raise them
 * from the worker app, the office decides here, and the decision is stamped
 * with who made it.
 */

const DAY_MS = 86_400_000
const NO_CLOCKOUT_MS = 12 * 3_600_000 // matches Timesheets.tsx's own "forgot to clock out" threshold
/** Matches Timesheets and payroll: the NES week is 38 hours, not 40. */
const OVERTIME_WEEKLY_MS_HRS = 38
const NEARING_WEEKLY_HRS = 38
const CERT_WARNING_DAYS = 30

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
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const startOfNextMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1)
const hhmm = (d: Date) => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
const monthDay = (d: Date) => d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
const monthYear = (d: Date) => d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
const weekday = (d: Date) => d.toLocaleDateString('en-AU', { weekday: 'short' })

const durationHrs = (row: ShiftRow, nowMs: number) =>
  Math.max(
    0,
    (row.ended_at ? new Date(row.ended_at).getTime() : nowMs) -
      new Date(row.started_at).getTime() -
      (row.break_minutes ?? 0) * 60_000,
  ) / 3_600_000

const initialsFor = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '??'

/** Deterministic swatch per site so the same site always reads the same colour on the profile card. */
function siteSwatch(siteId: string): string {
  let h = 0
  for (let i = 0; i < siteId.length; i++) h = (h * 31 + siteId.charCodeAt(i)) >>> 0
  return `hsl(${h % 360}, 46%, 46%)`
}

interface Meta {
  label: string
  bg: string
  fg: string
}

/** Cert status thresholds match Safety.tsx's certifications tab — same rule, recoloured to this screen's palette. */
function certStatus(expiresOn: string | null, nowMs: number): Meta & { rank: 0 | 1 | 2 | 3 } {
  if (!expiresOn) return { label: 'No expiry set', bg: '#F1F3F5', fg: theme.inkFaint, rank: 3 }
  const days = Math.floor((new Date(expiresOn).getTime() - nowMs) / DAY_MS)
  if (days < 0) return { label: 'Lapsed', bg: '#FDECEE', fg: '#A00417', rank: 0 }
  if (days <= CERT_WARNING_DAYS) return { label: 'Expiring soon', bg: '#FFF9E8', fg: '#8A6100', rank: 1 }
  return { label: 'Valid', bg: '#EAF7EC', fg: '#1B7A2C', rank: 2 }
}

type StatusKey = 'on_clock' | 'off' | 'exception' | 'invited'

const STATUS_META: Record<StatusKey, Meta> = {
  on_clock: { label: 'On the clock', bg: '#EAF7EC', fg: '#1B7A2C' },
  off: { label: 'Off', bg: '#F1F3F5', fg: '#696D74' },
  exception: { label: 'Needs review', bg: '#FDECEE', fg: '#A00417' },
  invited: { label: 'Invited', bg: '#FFF6DE', fg: '#8A6100' },
}

/** The admin-only fields `Worker` doesn't carry — read straight from `workers` rather than threaded through props. */
interface AdminFields {
  authUserId: string | null
  isOffice: boolean
  role: WorkerRow['role']
  createdAt: string | null
}
const DEFAULT_ADMIN: AdminFields = { authUserId: null, isOffice: false, role: 'employee', createdAt: null }

/**
 * The three tiers, in the words the client used. `is_office` is still what
 * every money policy reads, and the database keeps the two in step by trigger
 * (schema_v18) — so this screen writes the role and never the boolean.
 */
const ROLES: Array<{ key: WorkerRow['role']; label: string; blurb: string }> = [
  {
    key: 'employee',
    label: 'Employee',
    blurb: 'Their own hours, the jobs they are rostered on, photos and safety. Nothing else.',
  },
  {
    key: 'captain',
    label: 'Crew captain',
    blurb:
      'Everything an employee has, plus the jobs they run: variations, materials, the daily log, and approving their crew’s timesheets. No pay rates, no invoices, no contract sums — on any job.',
  },
  {
    key: 'owner',
    label: 'Owner',
    blurb: 'The whole company, including every pay rate, invoice, contract and margin.',
  },
]

interface CrewRow extends Worker, AdminFields {}

function statusKeyFor(row: CrewRow, openAt: number | null, nowMs: number): StatusKey {
  if (openAt !== null) return nowMs - openAt > NO_CLOCKOUT_MS ? 'exception' : 'on_clock'
  return row.authUserId ? 'off' : 'invited'
}

// ------------------------------------------------------------------- icons

function LockIcon({ size, stroke, strokeWidth = 1.5 }: { size: number; stroke: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={strokeWidth} style={{ flex: 'none' }}>
      <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.2" />
      <path d="M5.6 7V5.2a2.4 2.4 0 014.8 0V7" strokeLinecap="round" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8B9096" strokeWidth="1.3" style={{ flex: 'none' }}>
      <path d="M3.6 1.6h6l3 3v9.8H3.6z" strokeLinejoin="round" />
      <path d="M9.6 1.6v3h3" strokeLinejoin="round" />
    </svg>
  )
}

function WarningIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#C9A227" strokeWidth={1.5} style={{ flex: 'none', marginTop: 1 }}>
      <path d="M8 2.6L14.4 13H1.6z" strokeLinejoin="round" />
      <path d="M8 6.6v3" strokeLinecap="round" />
      <path d="M8 11.2h.01" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

// The design ships isCrewTime/isCrewMobile as phone frames. A previous pass
// reproduced them here as static pictures inside the OFFICE app, with
// hardcoded distances in miles, a California meal-break rule, and an approver
// who is not a user of this system. They are worker flows, so they are now
// built for real in src/worker/WorkerApp.tsx against shift_corrections and
// time_off_requests, and this screen shows the office side of them.

/** One row of the weekly sign-off table — a real day of a real worker's week. */
interface SignoffDay {
  day: string
  site: string
  times: string
  hrs: string
  auto: boolean
}

// ------------------------------------------------------------------ forms

const blankMember = { name: '', trade: '', rate: '', email: '', role: 'employee' as WorkerRow['role'] }
type MemberForm = typeof blankMember

const blankCert = { name: '', expiresOn: '' }
type CertForm = typeof blankCert

export function Crew({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const canEdit = me.is_office

  const [view, setView] = useState<'roster' | 'detail'>('roster')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'on_clock' | 'off' | 'exception'>('all')
  const [tradeFilter, setTradeFilter] = useState('')

  const [adminRows, setAdminRows] = useState<
    Array<{ id: string; auth_user_id: string | null; is_office: boolean; role: WorkerRow['role']; created_at: string }>
  >([])
  const [certs, setCerts] = useState<CertificationRow[]>([])
  const [corrections, setCorrections] = useState<ShiftCorrectionRow[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffRow[]>([])
  const [shiftsInRange, setShiftsInRange] = useState<ShiftRow[]>([])
  const [openShifts, setOpenShifts] = useState<ShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [memberForm, setMemberForm] = useState<MemberForm | null>(null)
  const [memberBusy, setMemberBusy] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  const [certForm, setCertForm] = useState<CertForm | null>(null)
  const [certBusy, setCertBusy] = useState(false)
  const [certError, setCertError] = useState<string | null>(null)

  const [inviteHint, setInviteHint] = useState(false)

  const now = new Date()
  const nowMs = now.getTime()
  const weekStart = mondayOf(now)
  const weekEnd = addDays(weekStart, 7)
  const monthStart = startOfMonth(now)
  const monthEnd = startOfNextMonth(now)
  const todayStart = startOfDay(now)
  const todayEnd = addDays(todayStart, 1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()

    // Covers both "this week" (which can start in the previous month) and
    // "this month to date" in one query, plus every week bucket needed for
    // the month's overtime total.
    const rangeStart = mondayOf(monthStart)
    const rangeEnd = addDays(todayStart, 1)

    const [admin, certRes, rangeRes, openRes, corrRes, leaveRes] = await Promise.all([
      client
        .from('workers')
        .select('id, auth_user_id, is_office, role, created_at')
        .eq('company_id', me.company_id)
        .eq('active', true),
      client.from('certifications').select('*').order('expires_on', { ascending: true }),
      client
        .from('shifts')
        .select('*')
        .gte('started_at', rangeStart.toISOString())
        .lt('started_at', rangeEnd.toISOString()),
      client.from('shifts').select('*').is('ended_at', null).limit(200),
      client.from('shift_corrections').select('*').order('created_at', { ascending: false }),
      client.from('time_off_requests').select('*').order('starts_on', { ascending: false }),
    ])

    const firstError = admin.error ?? certRes.error ?? rangeRes.error ?? openRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    setAdminRows((admin.data ?? []) as typeof adminRows)
    setCerts((certRes.data ?? []) as CertificationRow[])
    setCorrections((corrRes.data ?? []) as ShiftCorrectionRow[])
    setTimeOff((leaveRes.data ?? []) as TimeOffRow[])
    setShiftsInRange((rangeRes.data ?? []) as ShiftRow[])
    setOpenShifts((openRes.data ?? []) as ShiftRow[])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.company_id])

  useEffect(() => {
    void load()
  }, [load])

  // ---------------------------------------------------------------- roster

  const adminById = useMemo(
    () =>
      new Map(
        adminRows.map((r) => [
          r.id,
          { authUserId: r.auth_user_id, isOffice: r.is_office, role: r.role, createdAt: r.created_at },
        ]),
      ),
    [adminRows],
  )

  const roster: CrewRow[] = useMemo(
    () =>
      [...workers]
        .map((w) => ({ ...w, ...(adminById.get(w.id) ?? DEFAULT_ADMIN) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [workers, adminById],
  )

  const openByWorker = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of openShifts) {
      const at = new Date(s.started_at).getTime()
      const existing = m.get(s.worker_id)
      if (existing === undefined || at < existing) m.set(s.worker_id, at)
    }
    return m
  }, [openShifts])

  const pendingLeave = useMemo(() => timeOff.filter((t) => t.status === 'pending'), [timeOff])

  const certsByWorker = useMemo(() => {
    const m = new Map<string, CertificationRow[]>()
    for (const c of certs) {
      const list = m.get(c.worker_id) ?? []
      list.push(c)
      m.set(c.worker_id, list)
    }
    return m
  }, [certs])

  // Hours/overtime/sites, all in one pass over the fetched shift range.
  const perWorker = useMemo(() => {
    const week = new Map<string, number>()
    const month = new Map<string, number>()
    const today = new Map<string, number>()
    const weekBuckets = new Map<string, Map<number, number>>()
    const sitesMonth = new Map<string, Map<string, number>>()

    for (const s of shiftsInRange) {
      const started = new Date(s.started_at).getTime()
      const hrs = durationHrs(s, nowMs)

      if (started >= weekStart.getTime() && started < weekEnd.getTime()) {
        week.set(s.worker_id, (week.get(s.worker_id) ?? 0) + hrs)
      }
      if (started >= monthStart.getTime() && started < monthEnd.getTime()) {
        month.set(s.worker_id, (month.get(s.worker_id) ?? 0) + hrs)
        if (s.site_id) {
          const bySite = sitesMonth.get(s.worker_id) ?? new Map<string, number>()
          bySite.set(s.site_id, (bySite.get(s.site_id) ?? 0) + hrs)
          sitesMonth.set(s.worker_id, bySite)
        }
      }
      if (started >= todayStart.getTime() && started < todayEnd.getTime()) {
        today.set(s.worker_id, (today.get(s.worker_id) ?? 0) + hrs)
      }

      const wk = mondayOf(new Date(s.started_at)).getTime()
      const buckets = weekBuckets.get(s.worker_id) ?? new Map<number, number>()
      buckets.set(wk, (buckets.get(wk) ?? 0) + hrs)
      weekBuckets.set(s.worker_id, buckets)
    }

    /*
     * Only weeks that start inside the month count. The fetched range begins
     * on the Monday before the 1st so a part-week is not truncated, but
     * summing those extra days here produced an overtime figure larger than
     * the "hours this month" it sits next to.
     */
    const overtimeMonth = new Map<string, number>()
    const monthFirstWeek = mondayOf(monthStart).getTime()
    for (const [workerId, buckets] of weekBuckets) {
      let total = 0
      for (const [wk, hrs] of buckets) {
        if (wk < monthFirstWeek) continue
        total += Math.max(0, hrs - OVERTIME_WEEKLY_MS_HRS)
      }
      overtimeMonth.set(workerId, total)
    }

    return { week, month, today, overtimeMonth, sitesMonth }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftsInRange, nowMs])

  const statusOf = useCallback(
    (row: CrewRow): Meta & { key: StatusKey } => {
      const openAt = openByWorker.get(row.id) ?? null
      const key = statusKeyFor(row, openAt, nowMs)
      return { key, ...STATUS_META[key] }
    },
    [openByWorker, nowMs],
  )

  const filterKeyOf = (key: StatusKey): 'on_clock' | 'off' | 'exception' => (key === 'invited' ? 'off' : key)

  // ------------------------------------------------------------------ stats

  const officeCount = roster.filter((r) => r.isOffice).length
  const fieldCount = roster.length - officeCount

  const avgHoursWeek = roster.length
    ? roster.reduce((sum, r) => sum + (perWorker.week.get(r.id) ?? 0), 0) / roster.length
    : 0
  const trendingCount = roster.filter((r) => (perWorker.week.get(r.id) ?? 0) > NEARING_WEEKLY_HRS).length

  const certStatuses = useMemo(() => certs.map((c) => ({ row: c, status: certStatus(c.expires_on, nowMs) })), [certs, nowMs])
  const certsProblemCount = certStatuses.filter((c) => c.status.rank <= 1).length
  const certsLapsedCount = certStatuses.filter((c) => c.status.rank === 0).length

  const notOnAppCount = roster.filter((r) => !r.authUserId).length
  const pendingInviteEmails = roster.filter((r) => !r.authUserId).map((r) => r.name).length // placeholder unused below; real emails computed separately

  const onCounts = { all: roster.length, on_clock: 0, off: 0, exception: 0 }
  for (const r of roster) onCounts[filterKeyOf(statusOf(r).key)]++

  const officeOthers = roster.filter((r) => r.isOffice && r.id !== me.id).map((r) => r.name.split(' ')[0])
  const payRateNote =
    officeOthers.length === 0
      ? 'Pay rates visible to you only'
      : officeOthers.length === 1
        ? `Pay rates visible to you and ${officeOthers[0]} only`
        : `Pay rates visible to you and ${officeOthers.length} others only`

  const trades = useMemo(() => Array.from(new Set(roster.map((r) => r.trade))).sort(), [roster])

  const visibleRows = roster.filter((r) => {
    if (tradeFilter && r.trade !== tradeFilter) return false
    if (statusFilter === 'all') return true
    return filterKeyOf(statusOf(r).key) === statusFilter
  })

  const canSeeRate = (row: CrewRow) => canEdit || row.id === me.id

  const selected = roster.find((r) => r.id === selectedId) ?? roster[0] ?? null
  const selectedCerts = selected ? certsByWorker.get(selected.id) ?? [] : []
  const selectedSites = selected ? perWorker.sitesMonth.get(selected.id) ?? new Map<string, number>() : new Map<string, number>()
  const selectedSitesList = [...selectedSites.entries()]
    .map(([siteId, hrs]) => ({ siteId, hrs, name: sites.find((s) => s.id === siteId)?.name ?? 'Unknown site' }))
    .sort((a, b) => b.hrs - a.hrs)

  // ------------------------------------------------------------------ mutations

  async function addMember() {
    if (!memberForm?.name.trim()) {
      setMemberError('A name is required.')
      return
    }
    setMemberBusy(true)
    setMemberError(null)
    const { data: created, error: err } = await supabase()
      .from('workers')
      .insert({
        name: memberForm.name.trim(),
        initials: initialsFor(memberForm.name),
        trade: memberForm.trade.trim() || 'Crew',
        invite_email: memberForm.email.trim().toLowerCase() || null,
        // The role is written, never is_office: the trigger derives the
        // boolean from it, and writing both invites them to disagree.
        role: memberForm.role,
        // RLS additionally checks this matches the caller's own company.
        company_id: me.company_id,
      })
      .select('id')
      .single()
    if (err) {
      setMemberBusy(false)
      setMemberError(err.message)
      return
    }

    // Two writes because the wage lives in its own table — see schema_v24. It
    // is separate precisely so that everyone can read the crew list without
    // reading what anyone is paid, which RLS cannot do inside one row.
    //
    // Upsert rather than insert: schema_v24 gives every existing worker a
    // worker_pay row, and a future trigger may well do the same for new ones,
    // so "already there" must not read as a failure.
    const { error: payErr } = await supabase()
      .from('worker_pay')
      .upsert(
        { worker_id: created.id, company_id: me.company_id, rate: Number(memberForm.rate) || 0 },
        { onConflict: 'worker_id' },
      )
    setMemberBusy(false)
    if (payErr) {
      // The person exists; only their rate did not save. Say exactly that,
      // because "failed" would send someone off to add them a second time.
      setMemberError(`${memberForm.name.trim()} was added, but their rate did not save: ${payErr.message}`)
      await load()
      onChanged()
      return
    }
    setMemberForm(null)
    await load()
    onChanged()
  }

  async function setRole(id: string, role: WorkerRow['role']) {
    setMemberBusy(true)
    const { error: err } = await supabase().from('workers').update({ role }).eq('id', id)
    setMemberBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged()
  }

  async function deactivate(id: string) {
    setMemberBusy(true)
    const { error: err } = await supabase().from('workers').update({ active: false }).eq('id', id)
    setMemberBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    if (selectedId === id) setSelectedId(null)
    await load()
    onChanged()
  }

  async function saveCert() {
    if (!selected || !certForm) return
    if (!certForm.name.trim()) {
      setCertError('A certification name is required.')
      return
    }
    setCertBusy(true)
    setCertError(null)
    const { error: err } = await supabase()
      .from('certifications')
      .insert({
        company_id: me.company_id,
        worker_id: selected.id,
        name: certForm.name.trim(),
        expires_on: certForm.expiresOn || null,
      })
    setCertBusy(false)
    if (err) {
      setCertError(err.message)
      return
    }
    setCertForm(null)
    await load()
    onChanged()
  }

  /**
   * Accepting a correction applies the worker's requested times and stamps the
   * shift as an office edit, so the audit trail shows a human decided it — the
   * GPS record is never silently rewritten.
   */
  async function resolveCorrection(row: ShiftCorrectionRow, status: 'accepted' | 'rejected') {
    if (!canEdit) return
    const client = supabase()
    if (status === 'accepted' && row.shift_id && (row.requested_start || row.requested_end)) {
      const patch: Record<string, unknown> = { source: 'manual', edited: true }
      if (row.requested_start) patch.started_at = row.requested_start
      if (row.requested_end) patch.ended_at = row.requested_end
      const { error: shiftErr } = await client.from('shifts').update(patch).eq('id', row.shift_id)
      if (shiftErr) {
        setError(shiftErr.message)
        return
      }
    }
    const { error: err } = await client
      .from('shift_corrections')
      .update({ status, resolved_by: me.id, resolved_at: new Date().toISOString() })
      .eq('id', row.id)
    if (err) setError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  async function decideLeave(row: TimeOffRow, status: 'approved' | 'declined') {
    if (!canEdit) return
    const { error: err } = await supabase()
      .from('time_off_requests')
      .update({ status, decided_by: me.id, decided_at: new Date().toISOString() })
      .eq('id', row.id)
    if (err) setError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  function openDetail(id: string) {
    setSelectedId(id)
    setView('detail')
  }
  function closeDetail() {
    setView('roster')
  }

  function exportCsv() {
    const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const header = ['Name', 'Trade', 'Access', 'Rate', 'Status', 'Certifications']
    const lines = [header.join(',')]
    for (const row of visibleRows) {
      const st = statusOf(row)
      const certLabels = (certsByWorker.get(row.id) ?? []).map((c) => c.name).join('; ')
      const fields = [
        row.name,
        row.trade,
        ROLES.find((r) => r.key === row.role)?.label ?? 'Employee',
        canSeeRate(row) ? money2(Number(row.rate)) : '—',
        st.label,
        certLabels,
      ]
      lines.push(fields.map((f) => csvField(String(f))).join(','))
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'crew-list.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const pendingEmails = roster
    .filter((r) => !r.authUserId)
    .map((r) => workers.find((w) => w.id === r.id))
    .length
  void pendingInviteEmails
  void pendingEmails

  // ---------------------------------------------------------------- render

  if (view === 'detail' && selected) {
    const weekHrs = perWorker.week.get(selected.id) ?? 0
    const regularHrs = Math.min(weekHrs, OVERTIME_WEEKLY_MS_HRS)
    const overtimeHrs = Math.max(0, weekHrs - OVERTIME_WEEKLY_MS_HRS)
    const days: SignoffDay[] = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i)
      const dayShifts = shiftsInRange.filter((s) => {
        const st = new Date(s.started_at)
        return s.worker_id === selected.id && st >= day && st < addDays(day, 1)
      })
      const hrs = dayShifts.reduce((sum, s) => sum + durationHrs(s, nowMs), 0)
      const primary = [...dayShifts].sort((a, b) => durationHrs(b, nowMs) - durationHrs(a, nowMs))[0]
      const site = primary?.site_id ? sites.find((s) => s.id === primary.site_id)?.name ?? 'Unassigned' : '—'
      const times = primary
        ? `${hhmm(new Date(primary.started_at))} – ${primary.ended_at ? hhmm(new Date(primary.ended_at)) : 'now'}`
        : ''
      const auto = dayShifts.length > 0 && dayShifts.every((s) => s.source === 'auto' && !s.edited)
      return { day: weekday(day), site, times, hrs: hrs.toFixed(1), auto }
    })
    const weekLabel = `${weekday(weekStart)} ${monthDay(weekStart)} – ${weekday(addDays(weekStart, 6))} ${monthDay(addDays(weekStart, 6))}`

    const openCorrections = corrections.filter((c) => c.worker_id === selected.id && c.status === 'open')
    const workerLeave = timeOff.filter((t) => t.worker_id === selected.id)
    const certs = certsByWorker.get(selected.id) ?? []
    const siteHours = new Map<string, number>()
    for (const sh of shiftsInRange) {
      if (sh.worker_id !== selected.id || !sh.site_id) continue
      siteHours.set(sh.site_id, (siteHours.get(sh.site_id) ?? 0) + durationHrs(sh, nowMs))
    }

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg, overflow: 'hidden' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', background: '#fff', borderBottom: '1px solid #DCE0E6', overflowX: 'auto' }}>
          <button onClick={closeDetail} style={navBtn}>← Back to crew</button>
          <div style={{ flex: 'none', width: 1, height: 20, background: '#DCE0E6', margin: '0 4px' }} />
          <span style={{ flex: 'none', fontSize: 12.5, color: '#696D74', whiteSpace: 'nowrap' }}>
            {selected.name} · {selected.trade}
          </span>
          <div style={{ flex: 1 }} />
          {openCorrections.length > 0 && (
            <span style={{ ...pill, background: '#FDECEE', color: '#A00417' }}>
              {openCorrections.length} correction{openCorrections.length === 1 ? '' : 's'} to review
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '20px 22px 44px' }}>
          {/* Crews sit above the roster: who works together is the thing the
              office schedules with, and the roster below is the consequence. */}
          <CrewsPanel me={me} workers={workers} onChanged={onChanged} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 620px', minWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={detailCard}>
                <div style={detailHead}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>Week of {weekLabel}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12.5, color: '#8B9096' }}>
                    {regularHrs.toFixed(1)} regular
                    {overtimeHrs > 0 && ` · ${overtimeHrs.toFixed(1)} overtime`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '14px 15px 10px' }}>
                  <span style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {weekHrs.toFixed(1)}
                  </span>
                  <span style={{ fontSize: 13, color: '#696D74' }}>hours this week</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {money2(weekHrs * selected.rate)}
                  </span>
                </div>
                {days.map((d) => (
                  <div key={d.day} style={dayRow}>
                    <span style={{ width: 42, fontSize: 12.5, fontWeight: 600, color: '#4A5057' }}>{d.day}</span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 13, fontWeight: d.times ? 600 : 400, color: d.times ? theme.ink : '#B7BCC2' }}>
                        {d.times ? d.site : '—'}
                      </span>
                      {d.times && <span style={{ fontSize: 11.5, color: '#8B9096' }}>{d.times}</span>}
                    </span>
                    {d.times && (
                      <span style={{ ...pill, background: d.auto ? '#EAF7EC' : '#FFF6DE', color: d.auto ? '#1B7A2C' : '#8A6100' }}>
                        {d.auto ? 'GPS' : 'Edited'}
                      </span>
                    )}
                    <span style={{ width: 52, textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: d.times ? theme.ink : '#B7BCC2' }}>
                      {d.hrs}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 15px', borderTop: '1px solid #DCE0E6' }}>
                  <LockIcon size={14} stroke="#8B9096" />
                  <span style={{ flex: 1, fontSize: 11.5, lineHeight: 1.45, color: '#696D74' }}>
                    Every one of these came from a GPS punch or a named office edit. Change a time in Timesheets and it
                    is stamped with who changed it.
                  </span>
                </div>
              </div>

              <div style={detailCard}>
                <div style={detailHead}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>Correction requests</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12.5, color: '#8B9096' }}>Raised from the worker app</span>
                </div>
                {corrections.filter((c) => c.worker_id === selected.id).length === 0 && (
                  <div style={{ padding: '18px 15px', fontSize: 12.5, color: '#8B9096' }}>
                    {selected.name} has not disputed any punch.
                  </div>
                )}
                {corrections
                  .filter((c) => c.worker_id === selected.id)
                  .map((c) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 15px', borderTop: '1px solid #F1F3F5' }}>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{CORRECTION_REASON[c.reason_code]}</span>
                        {c.detail && <span style={{ fontSize: 12, color: '#4A5057', lineHeight: 1.45 }}>{c.detail}</span>}
                        <span style={{ fontSize: 11.5, color: '#8B9096' }}>Raised {shortDate(c.created_at)}</span>
                      </span>
                      {c.status === 'open' && canEdit ? (
                        <span style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => void resolveCorrection(c, 'rejected')} style={smallGhost}>Reject</button>
                          <button onClick={() => void resolveCorrection(c, 'accepted')} style={smallCta}>Accept</button>
                        </span>
                      ) : (
                        <span style={{ ...pill, background: c.status === 'accepted' ? '#EAF7EC' : c.status === 'rejected' ? '#FDECEE' : '#FFF6DE', color: c.status === 'accepted' ? '#1B7A2C' : c.status === 'rejected' ? '#A00417' : '#8A6100' }}>
                          {c.status === 'open' ? 'Open' : c.status === 'accepted' ? 'Accepted' : 'Rejected'}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            <div style={{ flex: '1 1 340px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={detailCard}>
                <div style={detailHead}><span style={{ fontSize: 15, fontWeight: 600 }}>Sites this month</span></div>
                {siteHours.size === 0 && (
                  <div style={{ padding: '16px 15px', fontSize: 12.5, color: '#8B9096' }}>No hours logged yet.</div>
                )}
                {[...siteHours.entries()].sort((a, b) => b[1] - a[1]).map(([id, hrs]) => (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 15px', borderTop: '1px solid #F1F3F5' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: siteSwatch(id), flex: 'none' }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{sites.find((s) => s.id === id)?.name ?? 'Unassigned'}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{hrs.toFixed(1)}</span>
                  </div>
                ))}
              </div>

              <div style={detailCard}>
                <div style={detailHead}><span style={{ fontSize: 15, fontWeight: 600 }}>Documents on file</span></div>
                {certs.length === 0 && (
                  <div style={{ padding: '16px 15px', fontSize: 12.5, color: '#8B9096' }}>Nothing on file.</div>
                )}
                {certs.map((c) => {
                  const meta = certStatus(c.expires_on, nowMs)
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 15px', borderTop: '1px solid #F1F3F5' }}>
                      <DocIcon />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{c.name}</span>
                      <span style={{ ...pill, background: meta.bg, color: meta.fg }}>{meta.label}</span>
                    </div>
                  )
                })}
              </div>

              <div style={detailCard}>
                <div style={detailHead}><span style={{ fontSize: 15, fontWeight: 600 }}>Time off</span></div>
                {workerLeave.length === 0 && (
                  <div style={{ padding: '16px 15px', fontSize: 12.5, color: '#8B9096' }}>
                    No requests. {selected.name} raises these from the worker app.
                  </div>
                )}
                {workerLeave.map((t) => (
                  <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 15px', borderTop: '1px solid #F1F3F5' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
                        {shortDate(t.starts_on)} – {shortDate(t.ends_on)}
                      </span>
                      <span style={{ ...pill, background: LEAVE_META[t.status].bg, color: LEAVE_META[t.status].fg }}>
                        {LEAVE_META[t.status].label}
                      </span>
                    </div>
                    {t.reason && <span style={{ fontSize: 12, color: '#4A5057' }}>{t.reason}</span>}
                    {t.status === 'pending' && canEdit && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => void decideLeave(t, 'declined')} style={smallGhost}>Decline</button>
                        <button onClick={() => void decideLeave(t, 'approved')} style={smallCta}>Approve</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg, overflow: 'hidden' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', background: '#fff', borderBottom: '1px solid #DCE0E6', overflowX: 'auto' }}>
        <div style={{ flex: 'none', display: 'flex', height: 27, border: '1px solid #DCE0E6', borderRadius: 3, overflow: 'hidden' }}>
          {(
            [
              ['all', `All ${onCounts.all}`],
              ['on_clock', `On the clock ${onCounts.on_clock}`],
              ['off', `Off ${onCounts.off}`],
              ['exception', `Exceptions ${onCounts.exception}`],
            ] as const
          ).map(([key, label], i) => {
            const active = statusFilter === key
            const isException = key === 'exception'
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                style={{
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: isException ? 5 : 0,
                  padding: '0 11px',
                  background: active ? '#E7F1FF' : '#fff',
                  border: 'none',
                  borderLeft: i === 0 ? 'none' : '1px solid #DCE0E6',
                  font: 'inherit',
                  fontSize: 12.5,
                  fontWeight: active || isException ? 600 : 400,
                  color: isException ? '#A00417' : active ? '#007BFF' : '#1A1D21',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {isException && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#D2051E' }} />}
                {label}
              </button>
            )
          })}
        </div>

        <div style={{ position: 'relative', flex: 'none' }}>
          <select
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            style={{
              appearance: 'none',
              boxSizing: 'border-box',
              flex: 'none',
              height: 27,
              padding: '0 22px 0 10px',
              background: '#fff',
              border: '1px solid #DCE0E6',
              borderRadius: 3,
              font: 'inherit',
              fontSize: 12.5,
              fontWeight: 500,
              color: '#1A1D21',
              cursor: 'pointer',
            }}
          >
            <option value="">All trades</option>
            {trades.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: 9, pointerEvents: 'none' }}>▾</span>
        </div>

        <div style={{ flex: 'none', width: 1, height: 20, background: '#DCE0E6', margin: '0 4px' }} />

        {canEdit && (
          <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8B9096', whiteSpace: 'nowrap' }}>
            <LockIcon size={13} stroke="#8B9096" />
            {payRateNote}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <button onClick={exportCsv} style={navBtn}>Export list</button>
        {canEdit && !memberForm && (
          <button onClick={() => setMemberForm(blankMember)} style={addBtn}>
            ADD CREW MEMBER
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 900px', minWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {error && (
              <div style={{ padding: '8px 12px', borderRadius: 4, background: '#FDECEE', color: '#A00417', fontSize: 12.5 }}>{error}</div>
            )}

            {memberForm && (
              <div style={formCard}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add a crew member</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <FormField label="Name" value={memberForm.name} onChange={(v) => setMemberForm({ ...memberForm, name: v })} placeholder="Danny Whitfield" />
                  <FormField label="Trade" value={memberForm.trade} onChange={(v) => setMemberForm({ ...memberForm, trade: v })} placeholder="Framer" />
                  <FormField label="Hourly rate" value={memberForm.rate} onChange={(v) => setMemberForm({ ...memberForm, rate: v })} placeholder="54" width={110} />
                  <FormField label="Email to invite" value={memberForm.email} onChange={(v) => setMemberForm({ ...memberForm, email: v })} placeholder="danny@example.com" width={230} />
                </div>
                <div style={{ marginTop: 12 }}>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8B9096' }}>
                    What they can see
                  </span>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {ROLES.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setMemberForm({ ...memberForm, role: r.key })}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 15,
                          border: `1px solid ${memberForm.role === r.key ? '#1A1D21' : '#DCE0E6'}`,
                          background: memberForm.role === r.key ? '#1A1D21' : '#fff',
                          color: memberForm.role === r.key ? '#fff' : '#1A1D21',
                          font: 'inherit',
                          fontSize: 12.5,
                          cursor: 'pointer',
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: 11.5, color: '#8B9096', lineHeight: 1.5, margin: '8px 0 0' }}>
                    {ROLES.find((r) => r.key === memberForm.role)?.blurb}
                  </p>
                </div>
                <p style={{ fontSize: 11.5, color: '#8B9096', lineHeight: 1.5, margin: '10px 0 0' }}>
                  They sign up at <code>/worker</code> with that email address and their account links to this record
                  automatically — no invite token to send or expire.
                </p>
                {memberError && <div style={{ marginTop: 10, fontSize: 12, color: '#A00417' }}>{memberError}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => void addMember()} disabled={memberBusy} style={cta}>
                    {memberBusy ? 'SAVING…' : 'ADD TO CREW'}
                  </button>
                  <button onClick={() => setMemberForm(null)} style={ghost}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatTile label="HEADCOUNT" value={String(roster.length)} sub={`${fieldCount} field · ${officeCount} office`} />
              <StatTile label="AVG HOURS / WEEK" value={avgHoursWeek.toFixed(1)} sub={`${trendingCount} trending into overtime`} />
              <StatTile
                label="CERTS EXPIRING"
                value={String(certsProblemCount)}
                sub={`${certsLapsedCount} already lapsed`}
                warn
              />
              <StatTile
                label="TIME OFF PENDING"
                value={String(pendingLeave.length)}
                sub={
                  pendingLeave.length === 0
                    ? 'Nothing pending'
                    : pendingLeave
                        .slice(0, 2)
                        .map((t) => `${roster.find((r) => r.id === t.worker_id)?.name.split(' ')[0] ?? 'Crew'} · ${shortDate(t.starts_on)}`)
                        .join(', ')
                }
              />
            </div>

            <div style={{ background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8, overflowX: 'auto' }}>
              <div style={{ minWidth: 840, display: 'grid', columnGap: 10, gridTemplateColumns: '1.5fr 104px 116px 92px 1.4fr 74px', padding: '7px 14px', background: '#FAFBFC', borderBottom: '1px solid #DCE0E6' }}>
                <span style={theadCell}>WORKER</span>
                <span style={theadCell}>PHONE</span>
                <span style={theadCell}>TODAY</span>
                <span style={{ ...theadCell, textAlign: 'right' }}>RATE</span>
                <span style={theadCell}>CERTIFICATIONS</span>
                <span style={{ ...theadCell, textAlign: 'right' }}>PTO</span>
              </div>

              {visibleRows.length === 0 && (
                <div style={{ padding: 24, fontSize: 13, color: '#696D74' }}>
                  {loading ? 'Loading crew…' : 'No one matches this filter.'}
                </div>
              )}

              {visibleRows.map((row) => {
                const st = statusOf(row)
                const rowCerts = certsByWorker.get(row.id) ?? []
                return (
                  <div
                    key={row.id}
                    onClick={() => openDetail(row.id)}
                    style={{
                      minWidth: 840,
                      display: 'grid',
                      columnGap: 10,
                      gridTemplateColumns: '1.5fr 104px 116px 92px 1.4fr 74px',
                      alignItems: 'center',
                      padding: '9px 14px',
                      borderBottom: '1px solid #EDEFF1',
                      background: selected?.id === row.id ? '#F2F8FF' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <span style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: '#3F454B', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                        {row.initials}
                        <span style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: '50%', border: '2px solid #fff', background: st.fg }} />
                      </span>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</span>
                        <span style={{ fontSize: 11, color: '#8B9096', whiteSpace: 'nowrap' }}>{row.trade}</span>
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, color: '#4A5057', whiteSpace: 'nowrap' }}>—</span>
                    <span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 11, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', background: st.bg, color: st.fg }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.fg }} />
                        {st.label}
                      </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      <LockIcon size={11} stroke="#B7BCC2" strokeWidth={1.6} />
                      {canSeeRate(row) ? money2(Number(row.rate)) : '—'}
                    </span>
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {rowCerts.map((c) => {
                        const s = certStatus(c.expires_on, nowMs)
                        return (
                          <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 3, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap', background: s.bg, color: s.fg }}>
                            {c.name}
                          </span>
                        )
                      })}
                    </span>
                    <span style={{ fontSize: 12.5, textAlign: 'right', color: '#4A5057', whiteSpace: 'nowrap' }}>—</span>
                  </div>
                )
              })}

              <div style={{ minWidth: 840, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', background: '#FAFBFC' }}>
                <span style={{ fontSize: 12.5, color: '#696D74' }}>
                  {roster.length} people · {notOnAppCount} not yet on the app
                </span>
                {notOnAppCount > 0 ? (
                  <a
                    href={`mailto:?bcc=${encodeURIComponent(
                      roster.filter((r) => !r.authUserId).map((r) => workers.find((w) => w.id === r.id)).length
                        ? ''
                        : '',
                    )}`}
                    onClick={(e) => {
                      e.preventDefault()
                      setInviteHint((v) => !v)
                    }}
                    style={{ fontSize: 12.5, fontWeight: 500, color: theme.accent, cursor: 'pointer' }}
                  >
                    Send app invites →
                  </a>
                ) : (
                  <span style={{ fontSize: 12.5, color: '#B7BCC2' }}>Everyone's on the app →</span>
                )}
              </div>
              {inviteHint && (
                <div style={{ padding: '8px 14px 12px', background: '#FAFBFC', fontSize: 11.5, color: '#696D74', lineHeight: 1.5 }}>
                  There's nothing to send from here — anyone you've added signs up at <code>/worker</code> with the
                  email you invited them on, and their account claims this row automatically.
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: '1 1 330px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {selected ? (
              <>
                <div style={{ background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderBottom: '1px solid #DCE0E6' }}>
                    <span style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: '#3F454B', color: '#fff', fontSize: 15, fontWeight: 700 }}>
                      {selected.initials}
                      <span style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: '50%', border: '2px solid #fff', background: statusOf(selected).fg }} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{selected.name}</span>
                      <span style={{ fontSize: 12.5, color: '#696D74' }}>
                        {selected.trade}
                        {selected.createdAt ? ` · with you since ${monthYear(new Date(selected.createdAt))}` : ''}
                      </span>
                    </div>
                    {canEdit && selected.id !== me.id && (
                      <>
                        {/*
                          Changing a role changes what this person can see the
                          moment it saves — RLS reads it directly. Only shown to
                          an owner, and never for themselves: an owner who
                          demotes their own account locks themselves out of the
                          screen they would need to undo it.
                        */}
                        <select
                          value={selected.role}
                          disabled={memberBusy}
                          onChange={(e) => void setRole(selected.id, e.target.value as WorkerRow['role'])}
                          style={{ ...ghost, height: 30, padding: '0 8px' }}
                          title={ROLES.find((r) => r.key === selected.role)?.blurb}
                        >
                          {ROLES.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <button onClick={() => void deactivate(selected.id)} disabled={memberBusy} style={ghost}>
                          Deactivate
                        </button>
                      </>
                    )}
                  </div>

                  {canEdit && (
                    <div style={{ padding: '9px 14px', background: '#FAFBFC', borderBottom: '1px solid #DCE0E6', fontSize: 11.5, lineHeight: 1.5, color: '#696D74' }}>
                      {ROLES.find((r) => r.key === selected.role)?.blurb}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: '#DCE0E6' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '11px 13px', background: '#fff' }}>
                      <span style={statCellLabel}>HRS / MONTH</span>
                      <span style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {(perWorker.month.get(selected.id) ?? 0).toFixed(1)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '11px 13px', background: '#fff' }}>
                      <span style={statCellLabel}>OVERTIME</span>
                      <span
                        style={{
                          fontSize: 17,
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: (perWorker.overtimeMonth.get(selected.id) ?? 0) > 0 ? '#D2051E' : theme.ink,
                        }}
                      >
                        {(perWorker.overtimeMonth.get(selected.id) ?? 0).toFixed(1)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '11px 13px', background: '#fff' }}>
                      <span style={statCellLabel}>SITES</span>
                      <span style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{selectedSitesList.length}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 14px', borderTop: '1px solid #DCE0E6' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>SITES WORKED THIS MONTH</span>
                    {selectedSitesList.length === 0 && <span style={{ fontSize: 12.5, color: '#B7BCC2' }}>No shifts recorded this month.</span>}
                    {selectedSitesList.map((p) => (
                      <div key={p.siteId} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: siteSwatch(p.siteId) }} />
                        <span style={{ flex: 1, fontSize: 12.5 }}>{p.name}</span>
                        <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{p.hrs.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderTop: '1px solid #DCE0E6' }}>
                    <span style={{ padding: '13px 14px 8px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>DOCUMENTS ON FILE</span>
                    {selectedCerts.length === 0 && (
                      <span style={{ padding: '0 14px 10px', fontSize: 12.5, color: '#B7BCC2' }}>No certifications on file.</span>
                    )}
                    {selectedCerts.map((c) => {
                      const s = certStatus(c.expires_on, nowMs)
                      return (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid #F1F3F5' }}>
                          <DocIcon />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                          <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 11, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', background: s.bg, color: s.fg }}>
                            {s.label}
                          </span>
                        </div>
                      )
                    })}
                    {canEdit && (
                      <div style={{ padding: '10px 14px', borderTop: '1px solid #F1F3F5' }}>
                        {certForm ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <FormField label="Certification" value={certForm.name} onChange={(v) => setCertForm({ ...certForm, name: v })} placeholder="White Card" width={150} />
                              <label style={fieldLabel}>
                                Expires
                                <input
                                  type="date"
                                  value={certForm.expiresOn}
                                  onChange={(e) => setCertForm({ ...certForm, expiresOn: e.target.value })}
                                  style={{ ...fieldInput, width: 140 }}
                                />
                              </label>
                            </div>
                            {certError && <div style={{ fontSize: 11.5, color: '#A00417' }}>{certError}</div>}
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button onClick={() => void saveCert()} disabled={certBusy} style={cta}>
                                {certBusy ? 'SAVING…' : 'SAVE'}
                              </button>
                              <button onClick={() => setCertForm(null)} style={ghost}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <a href="#" onClick={(e) => { e.preventDefault(); setCertForm(blankCert) }} style={{ fontSize: 12.5, color: theme.accent, cursor: 'pointer' }}>
                            Upload a document
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {(() => {
                  const pending = timeOff.filter((t) => t.status === 'pending')
                  if (pending.length === 0) return null
                  return (
                    <div style={{ background: '#fff', border: '1px solid #DCE0E6', borderLeft: '3px solid #FFC107', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 13px', borderBottom: '1px solid #DCE0E6' }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>
                          Time off {pending.length === 1 ? 'request' : 'requests'}
                        </span>
                        <span style={{ ...pill, background: '#FFF6DE', color: '#8A6100' }}>Awaiting you</span>
                      </div>
                      {pending.map((t) => {
                        const who = roster.find((r) => r.id === t.worker_id)
                        return (
                          <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 13, borderTop: '1px solid #F1F3F5' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                              <span style={{ fontSize: 12.5, color: '#696D74' }}>{who?.name ?? 'Crew'}</span>
                              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                                {shortDate(t.starts_on)} – {shortDate(t.ends_on)}
                              </span>
                            </div>
                            {t.hours !== null && (
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 12.5, color: '#696D74' }}>Hours</span>
                                <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                  {Number(t.hours).toFixed(1)}
                                </span>
                              </div>
                            )}
                            {t.reason && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                <span style={{ fontSize: 12.5, color: '#696D74' }}>Reason</span>
                                <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{t.reason}</span>
                              </div>
                            )}
                            {(() => {
                              // A real clash check, not a claim: is anyone else rostered
                              // on the days they want off?
                              const from = new Date(`${t.starts_on}T00:00:00`).getTime()
                              const to = new Date(`${t.ends_on}T23:59:59`).getTime()
                              const others = new Set(
                                shiftsInRange
                                  .filter((sh) => {
                                    const at = new Date(sh.started_at).getTime()
                                    return at >= from && at <= to && sh.worker_id !== t.worker_id
                                  })
                                  .map((sh) => sh.worker_id),
                              )
                              if (others.size > 0) return null
                              return (
                                <div style={{ display: 'flex', gap: 9, padding: '10px 11px', background: '#FFF9E8', borderRadius: 4 }}>
                                  <WarningIcon />
                                  <span style={{ fontSize: 12, lineHeight: 1.45, color: '#8A6100' }}>
                                    Nobody else has worked those days recently. Check the roster before approving.
                                  </span>
                                </div>
                              )
                            })()}
                            {canEdit && (
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => void decideLeave(t, 'declined')} style={{ flex: 1, height: 32, background: '#fff', border: '1px solid #DCE0E6', borderRadius: 3, font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                                  Decline
                                </button>
                                <button onClick={() => void decideLeave(t, 'approved')} style={{ flex: 1, height: 32, background: theme.cta, border: `1px solid ${theme.ctaBorder}`, borderRadius: 3, font: 'inherit', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', color: theme.ink, cursor: 'pointer' }}>
                                  APPROVE
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8, padding: 20, fontSize: 12.5, color: '#696D74', lineHeight: 1.6 }}>
                {loading ? 'Loading crew…' : 'Add your first crew member to see their profile here.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- small bits

function StatTile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 150,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '12px 14px',
        background: warn ? '#FFF9E8' : '#fff',
        border: `1px solid ${warn ? '#F0DCA8' : '#DCE0E6'}`,
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: warn ? '#8A6100' : '#8B9096', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1, color: warn ? '#8A6100' : theme.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 11.5, color: warn ? '#8A6100' : '#696D74' }}>{sub}</span>
    </div>
  )
}

function FormField({ label, value, onChange, placeholder, width = 170 }: {
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

// ------------------------------------------------------------------ styles

const theadCell: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: '#696D74' }

const statCellLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: '#8B9096', whiteSpace: 'nowrap' }

const navBtn: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 27,
  padding: '0 10px',
  background: '#fff',
  border: '1px solid #DCE0E6',
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  color: '#1A1D21',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
}

const addBtn: React.CSSProperties = {
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
}

const formCard: React.CSSProperties = {
  padding: 14,
  background: '#fff',
  border: '1px solid #DCE0E6',
  borderRadius: 8,
}

const fieldLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: '#8B9096',
}

const fieldInput: React.CSSProperties = {
  display: 'block',
  height: 32,
  marginTop: 4,
  padding: '0 9px',
  borderRadius: 3,
  border: '1px solid #DCE0E6',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: 0,
  textTransform: 'none',
  color: theme.ink,
  boxSizing: 'border-box',
}

const ghost: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 3,
  border: '1px solid #DCE0E6',
  background: '#fff',
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const cta: React.CSSProperties = {
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

// ------------------------------------------- office side of the worker flows

const CORRECTION_REASON: Record<ShiftCorrectionRow['reason_code'], string> = {
  parked_offsite: 'Parked off-site and walked in',
  access_changed: 'Site access point had changed',
  blocked: 'Truck or equipment was blocking the usual spot',
  forgot: 'Forgot to start or stop the clock',
  other: 'Something else',
}

const LEAVE_META: Record<TimeOffRow['status'], Meta> = {
  pending: { label: 'Awaiting you', bg: '#FFF6DE', fg: '#8A6100' },
  approved: { label: 'Approved', bg: '#EAF7EC', fg: '#1B7A2C' },
  declined: { label: 'Declined', bg: '#FDECEE', fg: '#A00417' },
  cancelled: { label: 'Withdrawn', bg: '#F1F3F5', fg: '#696D74' },
}

const detailCard = {
  display: 'flex',
  flexDirection: 'column',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const detailHead = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  padding: '11px 15px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const dayRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 15px',
  borderTop: '1px solid #F1F3F5',
} as const

const pill = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 11,
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: 'nowrap',
} as const

const smallGhost = {
  height: 25,
  padding: '0 10px',
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  background: theme.panel,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
} as const

const smallCta = {
  height: 25,
  padding: '0 12px',
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  background: theme.cta,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  color: theme.ink,
  cursor: 'pointer',
} as const
