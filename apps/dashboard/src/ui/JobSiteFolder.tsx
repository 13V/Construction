import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../data/supabase'
import type {
  DailyLogRow,
  EstimateLineRow,
  ExpenseRow,
  PlanPinRow,
  JobSiteRow,
  MaterialRow,
  ShiftRow,
  SiteFileRow,
  WorkerRow,
} from '../data/supabase'
import { BUCKET_FILES, objectPath, removeFile, signedUrl, uploadFile } from '../data/storage'
import { money, money2 } from '../format'
import { costCodes } from '../data/seed'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * The job site FOLDER — the piece the flat "Photos & Docs" screen lost: pick a
 * site, then move between Overview / Photos / Plans / Time / Budget without
 * leaving it. Ported from design/screens/{inJobSite,isOverview,isPhotos,
 * isPlans,isTime,isBudget}.html — structure, spacing and colour come from
 * those files, not from the old SiteFiles.tsx layout.
 *
 * Data stays inside the six tables the port brief calls out: job_sites,
 * site_files, shifts, materials, expenses, daily_logs (plus the workers/me
 * already handed down by Dashboard). Two things that follow from that:
 *
 *  - The design's "Schedule dates" panel is fed by milestones in the mockup,
 *    but there is no milestones table in scope here, so it shows the site's
 *    recent daily-log history instead — a real, dated record of the job that
 *    lives in an approved table, rather than reaching for schema_v4.
 *  - The Plans tab's floor-plan/pin viewer has no backing table for per-sheet
 *    pin coordinates. The design mock fills that space with a drawn floor plan
 *    carrying a title block, an address and three pinned issues. Shipping that
 *    would put fabricated drawings and fake issue reports in front of an owner
 *    who is about to show this to a client, so the viewer instead previews the
 *    document actually selected in the list above it. The pinning explainer
 *    band stays, because it describes a real intent rather than asserting a
 *    drawing exists.
 *
 * "← All sites" has nowhere external to go (the contract takes no nav
 * callback), so it opens an in-folder site switcher instead of leaving the
 * component — the only state in this file without a design source.
 */

const MAX_BYTES = 25 * 1024 * 1024

// Two greys the design leans on that theme.ts doesn't name: #8B9096 for
// eyebrow labels/captions, #4A5057 for secondary table-cell text. Both are
// literal, repeated hex values in the source screens, not one-offs.
const LABEL = '#8B9096'
const MUTED = '#4A5057'

const TAB_PAD = '16px 18px 40px'

type TabKey = 'overview' | 'photos' | 'plans' | 'time' | 'budget'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'photos', label: 'Photos' },
  { key: 'plans', label: 'Plans' },
  { key: 'time', label: 'Time' },
  { key: 'budget', label: 'Budget' },
]

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: '#EAF7EE', fg: '#1B7A32' },
  starting_soon: { label: 'Starting soon', bg: '#FFF6DF', fg: '#8A6100' },
  archived: { label: 'Archived', bg: '#F5F6F7', fg: '#696D74' },
}

const PHOTO_CATEGORIES = ['progress', 'issue', 'before', 'after', 'inspection'] as const
type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]
type PhotoFilter = 'all' | 'progress' | 'issue' | 'before_after' | 'inspection'

const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  progress: 'Progress',
  issue: 'Issue',
  before: 'Before',
  after: 'After',
  inspection: 'Inspection',
}

// A per-site colour tag — the design shows a distinct swatch per site but
// nothing in the schema carries one, so it's hashed from the id: stable
// across reloads, no migration needed.
const SITE_TAG_COLORS = ['#007BFF', '#8B5CF6', '#0EA5A5', '#F2733D', '#D2469B', '#5C6BC0', '#2E9E4F']
function siteTagColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return SITE_TAG_COLORS[h % SITE_TAG_COLORS.length]!
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Shift length in hours, counting an open shift as running to now. */
function hoursOf(row: ShiftRow): number {
  const end = row.ended_at ? new Date(row.ended_at).getTime() : Date.now()
  return Math.max(0, (end - new Date(row.started_at).getTime()) / 3_600_000)
}

/**
 * What a job has actually cost: labour at each worker's rate, materials that
 * haven't been returned, and expenses not already folded into a material
 * line. Mirrors Materials.tsx's roll-up exactly so the two screens never show
 * different numbers for the same site.
 */
function siteSpend(
  shifts: ShiftRow[],
  materials: MaterialRow[],
  expenses: ExpenseRow[],
  rateOf: (id: string) => number,
) {
  const labour = shifts.reduce((sum, s) => sum + hoursOf(s) * rateOf(s.worker_id), 0)
  const materialsCost = materials
    .filter((m) => m.status !== 'returned')
    .reduce((sum, m) => sum + Number(m.total_cost), 0)
  const linked = new Set(materials.map((m) => m.expense_id).filter((x): x is string => Boolean(x)))
  const other = expenses.filter((e) => !linked.has(e.id)).reduce((sum, e) => sum + Number(e.amount), 0)
  return { labour, materials: materialsCost, other, total: labour + materialsCost + other }
}

function relWhen(at: number): string {
  const d = new Date(at)
  const now = new Date()
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`
  return `${d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}, ${time}`
}

function dayHeading(dateKey: string): string {
  const d = new Date(dateKey)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })
}

interface ActivityItem {
  id: string
  at: number
  text: string
  initials: string
  thumb: boolean
}

/**
 * The Activity feed, built from the same tables everything else on this
 * screen reads — no separate event log in scope, so shifts double as the
 * clock-in/out record they already are.
 */
function buildActivity(
  files: SiteFileRow[],
  shifts: ShiftRow[],
  materials: MaterialRow[],
  expenses: ExpenseRow[],
  logs: DailyLogRow[],
  workers: Worker[],
): ActivityItem[] {
  const nameOf = (id: string | null) => workers.find((w) => w.id === id)?.name ?? 'Someone'
  const iniOf = (id: string | null) => workers.find((w) => w.id === id)?.initials ?? '?'
  const items: ActivityItem[] = []

  for (const s of shifts) {
    items.push({
      id: `${s.id}-in`,
      at: new Date(s.started_at).getTime(),
      text: `${nameOf(s.worker_id)} clocked in`,
      initials: iniOf(s.worker_id),
      thumb: false,
    })
    if (s.ended_at) {
      items.push({
        id: `${s.id}-out`,
        at: new Date(s.ended_at).getTime(),
        text: `${nameOf(s.worker_id)} clocked out`,
        initials: iniOf(s.worker_id),
        thumb: false,
      })
    }
  }
  for (const f of files) {
    items.push({
      id: f.id,
      at: new Date(f.created_at).getTime(),
      text: f.kind === 'photo' ? `${nameOf(f.uploaded_by)} uploaded a photo` : `${nameOf(f.uploaded_by)} uploaded ${f.name}`,
      initials: iniOf(f.uploaded_by),
      thumb: f.kind === 'photo',
    })
  }
  for (const m of materials) {
    items.push({
      id: m.id,
      at: new Date(m.created_at).getTime(),
      text: `${nameOf(m.created_by)} logged material — ${m.name}`,
      initials: iniOf(m.created_by),
      thumb: false,
    })
  }
  for (const e of expenses) {
    items.push({
      id: e.id,
      at: new Date(e.created_at).getTime(),
      text: `${nameOf(e.submitted_by)} logged an expense — ${e.vendor || 'Unlabeled'} · ${money(Number(e.amount))}`,
      initials: iniOf(e.submitted_by),
      thumb: false,
    })
  }
  for (const l of logs) {
    if (l.status === 'confirmed' && l.confirmed_at) {
      items.push({
        id: l.id,
        at: new Date(l.confirmed_at).getTime(),
        text: `${nameOf(l.confirmed_by)} confirmed the daily log for ${new Date(`${l.log_date}T00:00:00`).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}`,
        initials: iniOf(l.confirmed_by),
        thumb: false,
      })
    }
  }

  return items.sort((a, b) => b.at - a.at)
}

function exportHoursCsv(site: JobSite, shifts: ShiftRow[], workers: Worker[]) {
  const perWorker = new Map<string, number>()
  for (const s of shifts) perWorker.set(s.worker_id, (perWorker.get(s.worker_id) ?? 0) + hoursOf(s))
  const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [['Worker', 'Trade', 'Hours', 'Rate', 'Cost'].join(',')]
  for (const [workerId, hrs] of perWorker) {
    const w = workers.find((x) => x.id === workerId)
    const rate = w?.rate ?? 0
    lines.push(
      [w?.name ?? workerId, w?.trade ?? '', hrs.toFixed(2), rate.toFixed(2), (hrs * rate).toFixed(2)]
        .map((f) => csvField(String(f)))
        .join(','),
    )
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hours-${site.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ============================================================================
// Main component
// ============================================================================

export function JobSiteFolder({
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
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [tab, setTab] = useState<TabKey>('overview')
  const [pickerOpen, setPickerOpen] = useState(false)

  const [siteRow, setSiteRow] = useState<JobSiteRow | null>(null)
  const [files, setFiles] = useState<SiteFileRow[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [logs, setLogs] = useState<DailyLogRow[]>([])
  const [estLines, setEstLines] = useState<EstimateLineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Keep the selection valid if the sites list changes under us.
  useEffect(() => {
    if (sites.length && !sites.some((s) => s.id === siteId)) setSiteId(sites[0].id)
  }, [sites, siteId])

  const load = useCallback(async () => {
    if (!siteId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const client = supabase()
    const [siteRes, filesRes, shiftsRes, materialsRes, expensesRes, logsRes, estRes] = await Promise.all([
      client.from('job_sites').select('*').eq('id', siteId).maybeSingle(),
      client.from('site_files').select('*').eq('site_id', siteId).order('created_at', { ascending: false }),
      client.from('shifts').select('*').eq('site_id', siteId),
      client.from('materials').select('*').eq('site_id', siteId).order('delivered_on', { ascending: false }),
      client.from('expenses').select('*').eq('site_id', siteId).order('spent_on', { ascending: false }),
      client.from('daily_logs').select('*').eq('site_id', siteId).order('log_date', { ascending: false }).limit(60),
      // The approved estimate is the only place the schema says what a cost
      // code was sold for, which is what makes variance meaningful.
      client.from('estimates').select('id').eq('site_id', siteId).eq('status', 'approved'),
    ])
    const firstError =
      siteRes.error ?? filesRes.error ?? shiftsRes.error ?? materialsRes.error ?? expensesRes.error ?? logsRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }
    setSiteRow((siteRes.data as JobSiteRow | null) ?? null)
    setFiles((filesRes.data ?? []) as SiteFileRow[])
    setShifts((shiftsRes.data ?? []) as ShiftRow[])
    setMaterials((materialsRes.data ?? []) as MaterialRow[])
    setExpenses((expensesRes.data ?? []) as ExpenseRow[])
    setLogs((logsRes.data ?? []) as DailyLogRow[])

    const estIds = ((estRes.data ?? []) as Array<{ id: string }>).map((e) => e.id)
    if (estIds.length > 0) {
      const { data: el } = await client.from('estimate_lines').select('*').in('estimate_id', estIds)
      setEstLines((el ?? []) as EstimateLineRow[])
    } else {
      setEstLines([])
    }
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  async function afterWrite() {
    await load()
    onChanged()
  }

  const site = sites.find((s) => s.id === siteId) ?? null

  if (sites.length === 0) {
    return <NoSitesNotice />
  }
  if (!site) {
    // siteId hasn't caught up to the sites list yet — next render fixes it.
    return null
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: theme.appBg }}>
      <ActionBar shifts={shifts} onAllSites={() => setPickerOpen(true)} onExport={() => exportHoursCsv(site, shifts, workers)} />

      <div style={{ flex: 'none', background: theme.panel, borderBottom: `1px solid ${theme.border}` }}>
        <HeaderContent site={site} siteRow={siteRow} shifts={shifts} workers={workers} />
        <TabRow tab={tab} onChange={setTab} />
      </div>

      {error && (
        <div style={{ flex: 'none', padding: '8px 18px', fontSize: 12.5, color: theme.alert, background: '#FCE8EA' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.inkSoft, fontSize: 13 }}>
          Loading…
        </div>
      ) : tab === 'overview' ? (
        <OverviewTab
          site={site}
          siteRow={siteRow}
          files={files}
          shifts={shifts}
          materials={materials}
          expenses={expenses}
          logs={logs}
          workers={workers}
        />
      ) : tab === 'photos' ? (
        <PhotosTab me={me} siteId={siteId} rows={files.filter((f) => f.kind === 'photo')} workers={workers} onChanged={afterWrite} />
      ) : tab === 'plans' ? (
        <PlansTab me={me} siteId={siteId} rows={files.filter((f) => f.kind === 'document')} workers={workers} onChanged={afterWrite} />
      ) : tab === 'time' ? (
        <TimeTab site={site} shifts={shifts} workers={workers} />
      ) : (
        <BudgetTab
          site={site}
          siteRow={siteRow}
          shifts={shifts}
          materials={materials}
          expenses={expenses}
          workers={workers}
          estLines={estLines}
        />
      )}

      {pickerOpen && (
        <SitePickerOverlay
          sites={sites}
          activeId={siteId}
          onPick={(id) => {
            setSiteId(id)
            setTab('overview')
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Folder shell — action bar, header, tabs, site switcher
// ============================================================================

function NoSitesNotice() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.appBg, padding: 24 }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>No job sites yet</div>
        <p style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.55 }}>
          Add a job site first — the folder organises photos, plans, hours and budget per site.
        </p>
      </div>
    </div>
  )
}

function ActionBar({ shifts, onAllSites, onExport }: { shifts: ShiftRow[]; onAllSites: () => void; onExport: () => void }) {
  const onSiteCount = shifts.filter((s) => s.ended_at === null).length
  return (
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
      <button onClick={onAllSites} style={actionBtnStyle}>
        ← All sites
      </button>
      <div style={{ flex: 'none', width: 1, height: 20, background: theme.border, margin: '0 4px' }} />
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.inkSoft, whiteSpace: 'nowrap' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: onSiteCount > 0 ? theme.success : theme.inkFaint }} />
        {onSiteCount > 0 ? `${onSiteCount} on site now` : 'No one on site right now'}
      </span>
      <div style={{ flex: 1 }} />
      <button onClick={onExport} style={actionBtnStyle}>
        Export
      </button>
    </div>
  )
}

function Sep() {
  return <span style={{ width: 1, height: 12, background: theme.border, flex: 'none' }} />
}

function HeaderContent({
  site,
  siteRow,
  shifts,
  workers,
}: {
  site: JobSite
  siteRow: JobSiteRow | null
  shifts: ShiftRow[]
  workers: Worker[]
}) {
  const status = siteRow?.status ?? site.status
  const meta = STATUS_META[status] ?? STATUS_META.active!
  const color = siteTagColor(site.id)
  const dates = siteRow?.schedule_note?.trim() || '—'

  // The design labels this "Foreman", but no site has a stored foreman. Where
  // someone whose trade IS Foreman has worked here, name them and say so;
  // otherwise fall back to whoever has logged the most hours and label it
  // "Most hours" — calling a labourer the foreman is worse than not saying.
  const hoursByWorker = new Map<string, number>()
  for (const s of shifts) hoursByWorker.set(s.worker_id, (hoursByWorker.get(s.worker_id) ?? 0) + hoursOf(s))
  const ranked = [...hoursByWorker.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => workers.find((w) => w.id === id))
    .filter((w): w is Worker => Boolean(w))
  const actualForeman = ranked.find((w) => /foreman/i.test(w.trade))
  const leadLabel = actualForeman ? 'Foreman' : 'Most hours'
  const leadName = (actualForeman ?? ranked[0])?.name ?? '—'

  // Avatar stack: crew most recently active here, newest first.
  const lastSeen = new Map<string, number>()
  for (const s of shifts) {
    const t = new Date(s.started_at).getTime()
    lastSeen.set(s.worker_id, Math.max(lastSeen.get(s.worker_id) ?? 0, t))
  }
  const crewIds = [...lastSeen.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  const avatarIds = crewIds.slice(0, 5)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, padding: '15px 18px 13px' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: color, flex: 'none' }} />
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: '-.01em' }}>{site.name}</h1>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 9px',
              borderRadius: 11,
              fontSize: 11.5,
              fontWeight: 700,
              background: meta.bg,
              color: meta.fg,
            }}
          >
            {meta.label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: theme.inkSoft }}>{site.address || '—'}</span>
          <Sep />
          <span style={{ fontSize: 13, color: theme.inkSoft }}>{site.jobType || '—'}</span>
          <Sep />
          <span style={{ fontSize: 13, color: theme.inkSoft }}>{dates}</span>
          <Sep />
          <span style={{ fontSize: 13, color: theme.inkSoft }}>
            {leadLabel} <b style={{ fontWeight: 600, color: theme.ink }}>{leadName}</b>
          </span>
        </div>
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex' }}>
          {avatarIds.map((id, i) => {
            const w = workers.find((x) => x.id === id)
            return (
              <span
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  border: '2px solid #fff',
                  fontSize: 10,
                  fontWeight: 700,
                  marginLeft: i === 0 ? 0 : -8,
                  background: theme.railSoft,
                  color: '#fff',
                }}
              >
                {w?.initials ?? '?'}
              </span>
            )
          })}
        </div>
        <span style={{ fontSize: 12.5, color: LABEL, whiteSpace: 'nowrap' }}>
          {crewIds.length > 0 ? `${crewIds.length} crew assigned` : 'No crew yet'}
        </span>
      </div>
    </div>
  )
}

function TabRow({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 18px', overflowX: 'auto' }}>
      {TABS.map((t) => {
        const active = t.key === tab
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              flex: 'none',
              padding: '0 13px',
              height: 35,
              background: 'transparent',
              border: 0,
              borderBottom: `2px solid ${active ? theme.accent : 'transparent'}`,
              font: 'inherit',
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              color: active ? theme.ink : theme.inkSoft,
              fontWeight: active ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function SitePickerOverlay({
  sites,
  activeId,
  onPick,
  onClose,
}: {
  sites: JobSite[]
  activeId: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,29,33,.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.panel,
          borderRadius: 8,
          width: '100%',
          maxWidth: 420,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 30px rgba(0,0,0,.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${theme.border}` }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>All job sites</span>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', fontSize: 16, color: theme.inkSoft, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {sites.map((s) => {
            const meta = STATUS_META[s.status] ?? STATUS_META.active!
            return (
              <button
                key={s.id}
                onClick={() => onPick(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  padding: '10px 16px',
                  border: 'none',
                  borderBottom: `1px solid ${theme.border}`,
                  background: s.id === activeId ? theme.accentFill : 'transparent',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: 11, height: 11, borderRadius: 3, background: siteTagColor(s.id), flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: theme.ink }}>{s.name}</span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11.5,
                      color: theme.inkSoft,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.address || 'No address'}
                  </span>
                </span>
                <span
                  style={{
                    flex: 'none',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: meta.bg,
                    color: meta.fg,
                  }}
                >
                  {meta.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Shared tab chrome
// ============================================================================

const actionBtnStyle = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 27,
  padding: '0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const cardHead = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  padding: '11px 14px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const thStyle = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  color: theme.inkSoft,
} as const

const gridHead = {
  display: 'grid',
  columnGap: 10,
  padding: '7px 14px',
  background: '#FAFBFC',
  borderBottom: `1px solid ${theme.border}`,
} as const

const gridRow = {
  display: 'grid',
  columnGap: 10,
  alignItems: 'center',
  padding: '9px 14px',
  borderBottom: `1px solid #F1F3F5`,
} as const

const gridTotal = {
  display: 'grid',
  columnGap: 10,
  alignItems: 'center',
  padding: '10px 14px',
  background: '#FAFBFC',
} as const

function StatCard({
  label,
  value,
  note,
  tone,
  children,
}: {
  label: string
  value: string
  note?: string
  tone?: 'watch'
  children?: ReactNode
}) {
  const warn = tone === 'watch'
  return (
    <div
      style={{
        flex: 1,
        minWidth: 170,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '13px 15px',
        background: warn ? '#FFF9E8' : theme.panel,
        border: `1px solid ${warn ? '#F0DCA8' : theme.border}`,
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: warn ? '#8A6100' : LABEL }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 26,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: '-.02em',
          color: warn ? '#8A6100' : theme.ink,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      {children}
      {note && <span style={{ fontSize: 12, color: warn ? '#8A6100' : theme.inkSoft }}>{note}</span>}
    </div>
  )
}

function Avatar({ initials, size = 26, bg = theme.railSoft, fg = '#fff' }: { initials: string; size?: number; bg?: string; fg?: string }) {
  return (
    <span
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: fg,
        fontSize: size <= 22 ? 8.5 : size <= 26 ? 9.5 : 10,
        fontWeight: 700,
      }}
    >
      {initials}
    </span>
  )
}

// ============================================================================
// Overview
// ============================================================================

function OverviewTab({
  site,
  siteRow,
  files,
  shifts,
  materials,
  expenses,
  logs,
  workers,
}: {
  site: JobSite
  siteRow: JobSiteRow | null
  files: SiteFileRow[]
  shifts: ShiftRow[]
  materials: MaterialRow[]
  expenses: ExpenseRow[]
  logs: DailyLogRow[]
  workers: Worker[]
}) {
  const rateOf = useCallback(
    (id: string) => workers.find((w) => w.id === id)?.rate ?? 0,
    [workers],
  )
  const spend = useMemo(() => siteSpend(shifts, materials, expenses, rateOf), [shifts, materials, expenses, rateOf])
  const hours = useMemo(() => shifts.reduce((s, r) => s + hoursOf(r), 0), [shifts])
  const activity = useMemo(
    () => buildActivity(files, shifts, materials, expenses, logs, workers).slice(0, 12),
    [files, shifts, materials, expenses, logs, workers],
  )

  const openIssues = files.filter((f) => f.kind === 'photo' && f.category === 'issue').length
  const budget = site.budget
  const remaining = budget === null ? null : budget - spend.total
  const spentPct = budget && budget > 0 ? Math.min(100, (spend.total / budget) * 100) : 0

  const details: Array<[string, string]> = [
    ['Address', site.address || '—'],
    ['Job type', site.jobType || '—'],
    ['Client', siteRow?.client_name || '—'],
    ['Geofence radius', `${site.radiusM} m`],
    ['Progress', siteRow?.progress_pct === null || siteRow?.progress_pct === undefined ? '—' : `${siteRow.progress_pct}%`],
    ['Crew who have worked here', String(new Set(shifts.map((s) => s.worker_id)).size)],
  ]

  const clientName = siteRow?.client_name?.trim() || ''
  const clientIni =
    clientName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '—'

  // The design's "Schedule dates" panel is milestone-driven; milestones aren't
  // in this screen's table scope, so it shows the site's real log history.
  const recentLogs = logs.slice(0, 6)

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatCard
          label="HOURS TO DATE"
          value={hours.toFixed(1)}
          note={`${shifts.length} ${shifts.length === 1 ? 'shift' : 'shifts'} recorded`}
        />
        <StatCard label="SPEND TO DATE" value={money(spend.total)} note={`${money(spend.labour)} labour · ${money(spend.materials)} materials`} />
        <StatCard label="BUDGET REMAINING" value={remaining === null ? '—' : money(remaining)} note={budget ? `${Math.round(spentPct)}% of ${money(budget)} spent` : 'No budget set'}>
          <span style={{ display: 'block', width: '100%', height: 5, borderRadius: 3, background: '#EDEFF1', overflow: 'hidden' }}>
            <span
              style={{
                display: 'block',
                height: 5,
                borderRadius: 3,
                background: spentPct > 100 ? theme.alert : theme.accent,
                width: `${spentPct}%`,
              }}
            />
          </span>
        </StatCard>
        <StatCard label="OPEN ISSUES" value={String(openIssues)} note={openIssues === 0 ? 'Nothing flagged on site' : 'Photos tagged as an issue'} />
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 460px', minWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ ...cardHead, borderBottom: `1px solid ${theme.border}`, fontSize: 15, fontWeight: 600 }}>Job details</div>
            <div>
              {details.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 14, padding: '9px 14px', borderBottom: `1px solid #F1F3F5` }}>
                  <span style={{ flex: 'none', width: 132, fontSize: 12.5, color: LABEL }}>{k}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 14px' }}>
              <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: LABEL, marginBottom: 5 }}>
                SCHEDULE NOTE
              </span>
              <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                {siteRow?.schedule_note?.trim() || 'No schedule note yet.'}
              </p>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHead}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Client contact</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px' }}>
              <Avatar initials={clientIni} size={38} bg={theme.accentFill} fg={theme.accent} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{clientName || 'No client recorded'}</span>
                <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                  {clientName ? 'Invite them from Portals to share progress' : 'Add a client name on the job site'}
                </span>
              </div>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 9px',
                  borderRadius: 11,
                  background: theme.appBg,
                  color: theme.inkSoft,
                  fontSize: 11.5,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Free portal seat
              </span>
            </div>
          </div>
        </div>

        <div style={{ flex: '1 1 380px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHead}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Activity</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: LABEL }}>
                {new Date().toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div>
              {activity.length === 0 && (
                <div style={{ padding: '18px 14px', fontSize: 12.5, color: LABEL }}>
                  Nothing has happened on this site yet.
                </div>
              )}
              {activity.map((a) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderBottom: `1px solid #F1F3F5` }}>
                  <Avatar initials={a.initials} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, color: theme.ink }}>{a.text}</span>
                    <span style={{ fontSize: 11.5, color: LABEL }}>{relWhen(a.at)}</span>
                  </div>
                  {a.thumb && (
                    <span
                      style={{
                        flex: 'none',
                        width: 34,
                        height: 34,
                        borderRadius: 3,
                        background: 'repeating-linear-gradient(135deg,#E4E7EA 0 5px,#DADEE2 5px 10px)',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...cardStyle, gap: 9, padding: '13px 14px' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Recent daily logs</span>
            {recentLogs.length === 0 && <span style={{ fontSize: 12.5, color: LABEL }}>No logs written yet.</span>}
            {recentLogs.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    flex: 'none',
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: l.status === 'confirmed' ? theme.success : theme.warning,
                  }}
                />
                <span style={{ flex: 1, fontSize: 13 }}>
                  {l.status === 'confirmed' ? 'Confirmed' : 'Draft'} — {dayHeading(`${l.log_date}T00:00:00`)}
                </span>
                <span style={{ flex: 'none', fontSize: 12.5, color: theme.inkSoft }}>
                  {new Date(`${l.log_date}T00:00:00`).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Photos
// ============================================================================

const PHOTO_FILTERS: Array<{ key: PhotoFilter; label: string; match: (c: string | null) => boolean }> = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'progress', label: 'Progress', match: (c) => c === 'progress' },
  { key: 'issue', label: 'Issues', match: (c) => c === 'issue' },
  { key: 'before_after', label: 'Before & After', match: (c) => c === 'before' || c === 'after' },
  { key: 'inspection', label: 'Inspections', match: (c) => c === 'inspection' },
]

function PhotosTab({
  me,
  siteId,
  rows,
  workers,
  onChanged,
}: {
  me: WorkerRow
  siteId: string
  rows: SiteFileRow[]
  workers: Worker[]
  onChanged: () => Promise<void>
}) {
  const [filter, setFilter] = useState<PhotoFilter>('all')
  const [newest, setNewest] = useState(true)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // The bucket is private, so every tile needs its own short-lived signed URL.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      await Promise.all(
        rows.map(async (r) => {
          const u = await signedUrl(BUCKET_FILES, r.storage_path)
          if (u) next[r.id] = u
        }),
      )
      if (!cancelled) setUrls(next)
    })()
    return () => {
      cancelled = true
    }
  }, [rows])

  const counts = useMemo(() => {
    const c: Record<PhotoFilter, number> = { all: rows.length, progress: 0, issue: 0, before_after: 0, inspection: 0 }
    for (const r of rows) {
      for (const f of PHOTO_FILTERS) {
        if (f.key !== 'all' && f.match(r.category)) c[f.key]++
      }
    }
    return c
  }, [rows])

  const days = useMemo(() => {
    const active = PHOTO_FILTERS.find((f) => f.key === filter)!
    const shown = rows.filter((r) => active.match(r.category))
    const map = new Map<string, SiteFileRow[]>()
    for (const r of shown) {
      const key = new Date(r.taken_at ?? r.created_at).toDateString()
      const list = map.get(key)
      if (list) list.push(r)
      else map.set(key, [r])
    }
    const out = [...map.entries()].map(([key, tiles]) => ({
      key,
      label: dayHeading(key),
      at: new Date(key).getTime(),
      tiles: tiles.sort(
        (a, b) =>
          new Date(b.taken_at ?? b.created_at).getTime() - new Date(a.taken_at ?? a.created_at).getTime(),
      ),
    }))
    out.sort((a, b) => (newest ? b.at - a.at : a.at - b.at))
    return out
  }, [rows, filter, newest])

  const upload = async (list: FileList | null) => {
    if (!list?.length || busy) return
    setBusy(true)
    setNote(null)
    for (const file of Array.from(list)) {
      if (file.size > MAX_BYTES) {
        setNote(`${file.name} is over 25 MB — resize it or upload a smaller copy.`)
        continue
      }
      const path = objectPath(me.company_id, siteId, file.name)
      try {
        await uploadFile(BUCKET_FILES, path, file)
      } catch (e) {
        setNote(e instanceof Error ? e.message : `Could not upload ${file.name}.`)
        continue
      }
      const { error: rowErr } = await supabase().from('site_files').insert({
        company_id: me.company_id,
        site_id: siteId,
        uploaded_by: me.id,
        kind: 'photo',
        storage_path: path,
        name: file.name,
        mime: file.type || null,
        size_bytes: file.size,
        category: 'progress',
        taken_at: new Date(file.lastModified).toISOString(),
      })
      if (rowErr) setNote(rowErr.message)
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    await onChanged()
  }

  const setCategory = async (row: SiteFileRow, category: PhotoCategory) => {
    const { error: err } = await supabase().from('site_files').update({ category }).eq('id', row.id)
    if (err) setNote(err.message)
    else await onChanged()
  }

  const iniOf = (id: string | null) => workers.find((w) => w.id === id)?.initials ?? '?'

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', height: 28, border: `1px solid ${theme.border}`, borderRadius: 3, overflow: 'hidden', background: theme.panel }}>
          {PHOTO_FILTERS.map((f, i) => {
            const on = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 11px',
                  border: 'none',
                  borderLeft: i === 0 ? 'none' : `1px solid ${theme.border}`,
                  background: on ? theme.accentFill : theme.panel,
                  color: on ? theme.accent : theme.ink,
                  font: 'inherit',
                  fontSize: 12.5,
                  fontWeight: on ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {f.label} <span style={{ marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{counts[f.key]}</span>
              </button>
            )
          })}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setNewest((v) => !v)} style={actionBtnStyle}>
          {newest ? 'Newest first' : 'Oldest first'} <span style={{ opacity: 0.5, fontSize: 9 }}>▾</span>
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={busy} style={actionBtnStyle}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
      </div>

      {note && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: '#FDECEE', color: '#A00417', fontSize: 12.5 }}>
          {note}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void upload(e.dataTransfer.files)
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          height: 78,
          padding: '0 16px',
          marginBottom: 14,
          borderRadius: 8,
          background: dragging ? theme.accentFill : theme.panel,
          border: `1px ${dragging ? 'solid' : 'dashed'} ${dragging ? theme.accent : theme.border}`,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={LABEL} strokeWidth={1.5} style={{ flex: 'none' }}>
          <path d="M3 16.5V19a2 2 0 002 2h14a2 2 0 002-2v-2.5" strokeLinecap="round" />
          <path d="M12 3v12m0-12l-4.5 4.5M12 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Drop photos here, or they arrive from the crew's phones</span>
          <span style={{ fontSize: 12, color: LABEL }}>
            Every photo keeps its GPS location, timestamp and uploader. {rows.length}{' '}
            {rows.length === 1 ? 'photo' : 'photos'} on this site.
          </span>
        </div>
      </div>

      {days.length === 0 && (
        <div style={{ ...cardStyle, padding: '28px 16px', alignItems: 'center', color: LABEL, fontSize: 12.5 }}>
          No photos match this filter yet.
        </div>
      )}

      {days.map((day) => (
        <div key={day.key} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{day.label}</span>
            <span style={{ fontSize: 12, color: LABEL }}>
              {day.tiles.length} {day.tiles.length === 1 ? 'photo' : 'photos'}
            </span>
            <span style={{ flex: 1, height: 1, background: theme.border }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(196px,1fr))', gap: 11 }}>
            {day.tiles.map((p) => {
              const url = urls[p.id]
              const at = new Date(p.taken_at ?? p.created_at)
              return (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    style={{
                      position: 'relative',
                      height: 138,
                      background: url
                        ? `center/cover no-repeat url("${url}")`
                        : 'repeating-linear-gradient(135deg,#E4E7EA 0 7px,#DADEE2 7px 14px)',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        inset: '0 0 auto 0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        background: 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.42))',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: '#fff' }}>
                        {p.lat !== null && p.lng !== null && (
                          <>
                            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth={2}>
                              <path d="M8 14s5-4.6 5-8A5 5 0 003 6c0 3.4 5 8 5 8z" strokeLinejoin="round" />
                            </svg>
                            On site
                          </>
                        )}
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: '#fff' }}>
                        {at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </span>
                    <span style={{ position: 'absolute', left: 8, bottom: 8, display: 'flex', gap: 5 }}>
                      <span style={{ padding: '2px 7px', borderRadius: 3, background: 'rgba(26,29,33,.62)', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                        {(CATEGORY_LABEL[p.category as PhotoCategory] ?? 'Photo').toUpperCase()}
                      </span>
                      {p.category === 'issue' && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 3, background: theme.alert, color: '#fff', fontSize: 10, fontWeight: 700 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                          ISSUE
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                    <Avatar initials={iniOf(p.uploaded_by)} size={22} />
                    <span style={{ flex: 1, fontSize: 12, color: p.caption ? theme.ink : LABEL, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.caption || p.name}
                    </span>
                    <select
                      value={(p.category as PhotoCategory) ?? 'progress'}
                      onChange={(e) => void setCategory(p, e.target.value as PhotoCategory)}
                      title="Photo category"
                      style={{ flex: 'none', height: 20, border: `1px solid ${theme.border}`, borderRadius: 3, background: theme.panel, font: 'inherit', fontSize: 10.5, color: theme.inkSoft }}
                    >
                      {PHOTO_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Plans & documents
// ============================================================================

const DOC_COLUMNS = '1fr 150px 110px 78px 92px 64px'

function PlansTab({
  me,
  siteId,
  rows,
  workers,
  onChanged,
}: {
  me: WorkerRow
  siteId: string
  rows: SiteFileRow[]
  workers: Worker[]
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pins, setPins] = useState<PlanPinRow[]>([])
  const [placing, setPlacing] = useState(false)
  const [compareTo, setCompareTo] = useState<string | null>(null)
  const [compareUrl, setCompareUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const superseded = useMemo(
    () => new Set(rows.map((r) => r.supersedes).filter((x): x is string => Boolean(x))),
    [rows],
  )

  const selected = rows.find((r) => r.id === selectedId) ?? rows.find((r) => !superseded.has(r.id)) ?? null

  // Anything this sheet supersedes, walked back down the chain.
  const priorRevisions = useMemo(() => {
    const out: SiteFileRow[] = []
    let cursor = selected?.supersedes ?? null
    while (cursor) {
      const prev = rows.find((r) => r.id === cursor)
      if (!prev) break
      out.push(prev)
      cursor = prev.supersedes
    }
    return out
  }, [selected, rows])

  useEffect(() => {
    let cancelled = false
    if (!selected) {
      setPreviewUrl(null)
      return
    }
    void signedUrl(BUCKET_FILES, selected.storage_path).then((u) => {
      if (!cancelled) setPreviewUrl(u)
    })
    void supabase()
      .from('plan_pins')
      .select('*')
      .eq('file_id', selected.id)
      .then(({ data }) => {
        if (!cancelled) setPins((data ?? []) as PlanPinRow[])
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  // The revision this sheet supersedes, for a side-by-side.
  useEffect(() => {
    let cancelled = false
    if (!compareTo) {
      setCompareUrl(null)
      return
    }
    const prior = rows.find((r) => r.id === compareTo)
    if (!prior) return
    void signedUrl(BUCKET_FILES, prior.storage_path).then((u) => {
      if (!cancelled) setCompareUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [compareTo, rows])

  /**
   * Pins are stored as fractions of the sheet, so they stay on the same spot
   * whatever size the drawing renders at.
   */
  const addPin = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!placing || !selected) return
    const box = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - box.left) / box.width
    const y = (e.clientY - box.top) / box.height
    const label = window.prompt('What is at this spot?')
    if (label === null) {
      setPlacing(false)
      return
    }
    const { data, error: err } = await supabase()
      .from('plan_pins')
      .insert({
        company_id: me.company_id,
        site_id: siteId,
        file_id: selected.id,
        x: Math.min(1, Math.max(0, x)).toFixed(5),
        y: Math.min(1, Math.max(0, y)).toFixed(5),
        kind: /issue|leak|crack|water|damage/i.test(label) ? 'issue' : 'note',
        label: label.trim(),
        created_by: me.id,
      })
      .select()
      .single()
    setPlacing(false)
    if (err) setNote(err.message)
    else setPins((p) => [...p, data as PlanPinRow])
  }

  const removePin = async (pin: PlanPinRow) => {
    const { error: err } = await supabase().from('plan_pins').delete().eq('id', pin.id)
    if (err) setNote(err.message)
    else setPins((p) => p.filter((x) => x.id !== pin.id))
  }

  const upload = async (list: FileList | null, supersedesId: string | null) => {
    const file = list?.[0]
    if (!file || busy) return
    if (file.size > MAX_BYTES) {
      setNote(`${file.name} is over 25 MB — upload a smaller copy.`)
      return
    }
    setBusy(true)
    setNote(null)
    const path = objectPath(me.company_id, siteId, file.name)
    try {
      await uploadFile(BUCKET_FILES, path, file)
    } catch (e) {
      setNote(e instanceof Error ? e.message : `Could not upload ${file.name}.`)
      setBusy(false)
      return
    }
    // Versioning is a chain, not an overwrite: the old revision stays readable
    // because "what did the plan say when we built it" is the whole question
    // in a dispute.
    const prior = supersedesId ? rows.find((r) => r.id === supersedesId) : null
    const nextVersion = prior ? bumpVersion(prior.version) : 'Rev A'
    const { error: rowErr } = await supabase().from('site_files').insert({
      company_id: me.company_id,
      site_id: siteId,
      uploaded_by: me.id,
      kind: 'document',
      storage_path: path,
      name: file.name,
      mime: file.type || null,
      size_bytes: file.size,
      category: 'plan',
      version: nextVersion,
      supersedes: supersedesId,
    })
    if (rowErr) setNote(rowErr.message)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    await onChanged()
  }

  const remove = async (row: SiteFileRow) => {
    if (!me.is_office) return
    if (!window.confirm(`Delete ${row.name}? The file and its record both go.`)) return
    try {
      await removeFile(BUCKET_FILES, row.storage_path)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not delete that file.')
      return
    }
    const { error: rowErr } = await supabase().from('site_files').delete().eq('id', row.id)
    if (rowErr) setNote(rowErr.message)
    await onChanged()
  }

  const download = async (row: SiteFileRow) => {
    const u = await signedUrl(BUCKET_FILES, row.storage_path)
    if (u) window.open(u, '_blank', 'noopener')
    else setNote('Could not open that file.')
  }

  const nameOf = (id: string | null) => workers.find((w) => w.id === id)?.name ?? '—'
  const iniOf = (id: string | null) => workers.find((w) => w.id === id)?.initials ?? '?'
  const isImage = (r: SiteFileRow | null) => Boolean(r?.mime?.startsWith('image/'))
  const isPdf = (r: SiteFileRow | null) => r?.mime === 'application/pdf'

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={cardHead}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Plans &amp; documents</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={actionBtnStyle}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
          <input ref={fileRef} type="file" hidden onChange={(e) => void upload(e.target.files, null)} />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ ...gridHead, gridTemplateColumns: DOC_COLUMNS, minWidth: 720 }}>
            <span style={thStyle}>NAME</span>
            <span style={thStyle}>UPLOADED BY</span>
            <span style={thStyle}>DATE</span>
            <span style={thStyle}>SIZE</span>
            <span style={thStyle}>VERSION</span>
            <span />
          </div>

          {rows.length === 0 && (
            <div style={{ padding: '24px 14px', fontSize: 12.5, color: LABEL }}>
              No plans or documents yet. Upload a drawing set and every revision stays on the chain.
            </div>
          )}

          {rows.map((f) => {
            const stale = superseded.has(f.id)
            return (
              <div
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                style={{
                  ...gridRow,
                  gridTemplateColumns: DOC_COLUMNS,
                  minWidth: 720,
                  cursor: 'pointer',
                  background: selected?.id === f.id ? theme.accentFill : theme.panel,
                  opacity: stale ? 0.6 : 1,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={theme.inkSoft} strokeWidth={1.3} style={{ flex: 'none' }}>
                    <path d="M4 1.8h5l3 3v9.4H4z" strokeLinejoin="round" />
                    <path d="M9 1.8v3h3" strokeLinejoin="round" />
                  </svg>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                    {stale && <span style={{ fontSize: 11.5, color: LABEL }}>Superseded by a newer revision</span>}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: MUTED, minWidth: 0 }}>
                  <Avatar initials={iniOf(f.uploaded_by)} size={21} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(f.uploaded_by)}</span>
                </span>
                <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(f.created_at).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: '2-digit' })}
                </span>
                <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{formatSize(f.size_bytes)}</span>
                <span>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 11,
                      fontSize: 11,
                      fontWeight: 700,
                      background: stale ? theme.appBg : '#EAF7EE',
                      color: stale ? theme.inkSoft : '#1B7A32',
                    }}
                  >
                    {f.version ?? 'Rev A'}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button
                    title="Open"
                    onClick={(e) => {
                      e.stopPropagation()
                      void download(f)
                    }}
                    style={iconBtn}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}>
                      <path d="M8 2.6v7.6M8 10.2L5.2 7.4M8 10.2l2.8-2.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2.8 11.4v1.2a1 1 0 001 1h8.4a1 1 0 001-1v-1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                  {me.is_office && (
                    <button
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        void remove(f)
                      }}
                      style={{ ...iconBtn, color: theme.alert }}
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {selected && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{selected.name}</span>
              <span style={{ fontSize: 12.5, color: LABEL }}>
                {selected.version ?? 'Rev A'} · uploaded {new Date(selected.created_at).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })} ·{' '}
                {formatSize(selected.size_bytes)}
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setPlacing((v) => !v)}
              style={{
                ...actionBtnStyle,
                borderColor: placing ? theme.accent : theme.border,
                background: placing ? theme.accentFill : theme.panel,
                color: placing ? theme.accent : theme.ink,
              }}
            >
              {placing ? 'Click the drawing…' : `Pin a spot${pins.length ? ` · ${pins.length}` : ''}`}
            </button>
            {priorRevisions.length > 0 && (
              <select
                value={compareTo ?? ''}
                onChange={(e) => setCompareTo(e.target.value || null)}
                style={{ ...actionBtnStyle, padding: '0 8px' }}
              >
                <option value="">Compare to…</option>
                {priorRevisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.version ?? r.name}
                  </option>
                ))}
              </select>
            )}
            {me.is_office && (
              <button onClick={() => fileRef.current?.click()} style={actionBtnStyle}>
                Upload a new revision
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div
              onClick={(e) => void addPin(e)}
              style={{
                position: 'relative',
                flex: 1,
                height: 540,
                background: theme.panel,
                border: `1px solid ${placing ? theme.accent : theme.border}`,
                borderRadius: 8,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: placing ? 'crosshair' : 'default',
              }}
            >
              {previewUrl && isImage(selected) ? (
                <img src={previewUrl} alt={selected.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : previewUrl && isPdf(selected) ? (
                <iframe title={selected.name} src={previewUrl} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: placing ? 'none' : 'auto' }} />
              ) : (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>No preview for this file type</div>
                  <button onClick={() => void download(selected)} style={{ ...actionBtnStyle, margin: '0 auto' }}>
                    Open {selected.name}
                  </button>
                </div>
              )}

              {pins.map((pin, i) => (
                <span
                  key={pin.id}
                  title={pin.label}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`Remove the pin "${pin.label}"?`)) void removePin(pin)
                  }}
                  style={{
                    position: 'absolute',
                    left: `${Number(pin.x) * 100}%`,
                    top: `${Number(pin.y) * 100}%`,
                    transform: 'translate(-50%, -100%)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px 3px 5px',
                    borderRadius: 11,
                    background: pin.kind === 'issue' ? theme.alert : theme.rail,
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    boxShadow: '0 1px 4px rgba(0,0,0,.35)',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 15,
                      height: 15,
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,.25)',
                    }}
                  >
                    {i + 1}
                  </span>
                  {pin.label}
                </span>
              ))}
            </div>

            {compareTo && (
              <div
                style={{
                  flex: 1,
                  height: 540,
                  background: theme.panel,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {compareUrl ? (
                  isImage(rows.find((r) => r.id === compareTo) ?? null) ? (
                    <img src={compareUrl} alt="Earlier revision" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  ) : (
                    <iframe title="Earlier revision" src={compareUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
                  )
                ) : (
                  <span style={{ fontSize: 12.5, color: LABEL }}>Loading the earlier revision…</span>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', marginTop: 12, background: theme.accentFill, borderRadius: 8 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0A4E9E" strokeWidth={1.4} style={{ flex: 'none' }}>
              <path d="M8 14s5-4.6 5-8A5 5 0 003 6c0 3.4 5 8 5 8z" strokeLinejoin="round" />
              <circle cx="8" cy="6" r="1.7" />
            </svg>
            <span style={{ fontSize: 13, color: '#0A4E9E', lineHeight: 1.45 }}>
              Photos taken on site already carry their GPS fix, so a problem can be traced back to where on the job it
              was found — not just which job it was on.
            </span>
          </div>
        </>
      )}

      {note && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#FDECEE', color: '#A00417', fontSize: 12.5 }}>
          {note}
        </div>
      )}
    </div>
  )
}

/** "Rev A" → "Rev B". Anything else gets a numeric suffix rather than a guess. */
function bumpVersion(prev: string | null): string {
  const m = /^Rev ([A-Y])$/.exec((prev ?? '').trim())
  if (m) return `Rev ${String.fromCharCode(m[1]!.charCodeAt(0) + 1)}`
  const n = /^(.*?)(\d+)$/.exec((prev ?? '').trim())
  if (n) return `${n[1]}${Number(n[2]) + 1}`
  return 'Rev B'
}

const iconBtn = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  border: 'none',
  background: 'transparent',
  borderRadius: 3,
  color: theme.inkSoft,
  font: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
} as const

// ============================================================================
// Time
// ============================================================================

const TIME_COLUMNS = '1fr 92px 108px 128px 108px'

function TimeTab({ site, shifts, workers }: { site: JobSite; shifts: ShiftRow[]; workers: Worker[] }) {
  const perWorker = useMemo(() => {
    const map = new Map<string, { hours: number; codes: Set<string> }>()
    for (const s of shifts) {
      let e = map.get(s.worker_id)
      if (!e) {
        e = { hours: 0, codes: new Set() }
        map.set(s.worker_id, e)
      }
      e.hours += hoursOf(s)
      if (s.cost_code) e.codes.add(s.cost_code)
    }
    return [...map.entries()]
      .map(([id, v]) => {
        const w = workers.find((x) => x.id === id)
        const rate = w?.rate ?? 0
        return {
          id,
          name: w?.name ?? 'Unknown',
          trade: w?.trade ?? '',
          initials: w?.initials ?? '?',
          hours: v.hours,
          rate,
          cost: v.hours * rate,
          code: v.codes.size === 0 ? '—' : v.codes.size === 1 ? [...v.codes][0]! : `${v.codes.size} codes`,
        }
      })
      .sort((a, b) => b.hours - a.hours)
  }, [shifts, workers])

  const totalHours = perWorker.reduce((s, w) => s + w.hours, 0)
  const totalCost = perWorker.reduce((s, w) => s + w.cost, 0)
  const autoPct = shifts.length === 0 ? 0 : (shifts.filter((s) => s.source === 'auto').length / shifts.length) * 100

  // Last 14 days of work on this site, oldest to newest.
  const bars = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const s of shifts) {
      const key = new Date(s.started_at).toDateString()
      byDay.set(key, (byDay.get(key) ?? 0) + hoursOf(s))
    }
    const out: Array<{ key: string; label: string; hours: number }> = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toDateString()
      out.push({ key, label: d.toLocaleDateString('en-AU', { weekday: 'narrow' }), hours: byDay.get(key) ?? 0 })
    }
    const max = Math.max(...out.map((o) => o.hours), 1)
    return out.map((o) => ({ ...o, h: `${(o.hours / max) * 100}%` }))
  }, [shifts])

  const period = useMemo(() => {
    if (shifts.length === 0) return 'No hours logged yet'
    const times = shifts.map((s) => new Date(s.started_at).getTime())
    const from = new Date(Math.min(...times))
    const to = new Date(Math.max(...times))
    const f = (d: Date) => d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
    return `${f(from)} – ${f(to)}`
  }, [shifts])

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={cardHead}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Hours on {site.name}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: LABEL }}>{period}</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ ...gridHead, gridTemplateColumns: TIME_COLUMNS, minWidth: 660 }}>
            <span style={thStyle}>WORKER</span>
            <span style={{ ...thStyle, textAlign: 'right' }}>HOURS</span>
            <span style={{ ...thStyle, textAlign: 'right' }}>RATE</span>
            <span style={thStyle}>COST CODE</span>
            <span style={{ ...thStyle, textAlign: 'right' }}>COST</span>
          </div>

          {perWorker.length === 0 && (
            <div style={{ padding: '24px 14px', fontSize: 12.5, color: LABEL }}>
              Nobody has clocked onto this site yet.
            </div>
          )}

          {perWorker.map((t) => (
            <div key={t.id} style={{ ...gridRow, gridTemplateColumns: TIME_COLUMNS, minWidth: 660 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <Avatar initials={t.initials} size={24} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                  <span style={{ fontSize: 11, color: LABEL }}>{t.trade}</span>
                </span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {t.hours.toFixed(1)}
              </span>
              <span style={{ fontSize: 12.5, color: MUTED, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {t.rate > 0 ? `${money2(t.rate)}/hr` : '—'}
              </span>
              <span style={{ fontSize: 12, color: MUTED }}>{t.code}</span>
              <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {money(t.cost)}
              </span>
            </div>
          ))}

          <div style={{ ...gridTotal, gridTemplateColumns: TIME_COLUMNS, minWidth: 660 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Total</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {totalHours.toFixed(1)}
            </span>
            <span />
            <span />
            <span style={{ fontSize: 13.5, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {money(totalCost)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...cardStyle, flex: '1 1 520px', minWidth: 340, padding: 14, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Hours by day</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: LABEL }}>Last 14 days</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 132 }}>
            {bars.map((b) => (
              <div key={b.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                  {b.hours > 0 ? b.hours.toFixed(1) : ''}
                </span>
                <span style={{ display: 'flex', alignItems: 'flex-end', width: '100%', height: 86 }}>
                  <span
                    style={{
                      display: 'block',
                      width: '100%',
                      borderRadius: '2px 2px 0 0',
                      height: b.h,
                      background: b.hours > 0 ? theme.accent : '#EDEFF1',
                    }}
                  />
                </span>
                <span style={{ fontSize: 11, color: LABEL }}>{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...cardStyle, flex: '1 1 280px', minWidth: 250, padding: 14, gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Labour to date</span>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ flex: 1, fontSize: 13, color: theme.inkSoft }}>Hours logged</span>
            <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{totalHours.toFixed(1)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ flex: 1, fontSize: 13, color: theme.inkSoft }}>Labour cost</span>
            <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(totalCost)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ flex: 1, fontSize: 13, color: theme.inkSoft }}>Auto-captured</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#1B7A2C', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(autoPct)}%
            </span>
          </div>
          <div style={{ height: 1, background: '#EDEFF1' }} />
          <span style={{ fontSize: 11.5, color: LABEL, lineHeight: 1.45 }}>
            Every hour here traces to a GPS punch or a named office edit. That is what makes it defensible when someone
            disputes a timesheet.
          </span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Budget
// ============================================================================

// EST HRS / ACT HRS / EST COST / ACT COST / VARIANCE, as the design has it.
const BUDGET_COLUMNS = '1.6fr 84px 84px 112px 112px 122px'

function BudgetTab({
  site,
  siteRow,
  shifts,
  materials,
  expenses,
  workers,
  estLines,
}: {
  site: JobSite
  siteRow: JobSiteRow | null
  shifts: ShiftRow[]
  materials: MaterialRow[]
  expenses: ExpenseRow[]
  workers: Worker[]
  estLines: EstimateLineRow[]
}) {
  const rateOf = useCallback((id: string) => workers.find((w) => w.id === id)?.rate ?? 0, [workers])
  const spend = useMemo(() => siteSpend(shifts, materials, expenses, rateOf), [shifts, materials, expenses, rateOf])

  const budget = siteRow?.budget === null || siteRow?.budget === undefined ? site.budget : Number(siteRow.budget)
  const contract =
    siteRow?.contract_value === null || siteRow?.contract_value === undefined
      ? site.contractValue
      : Number(siteRow.contract_value)

  // Margin is contract minus cost. Comparing spend to `budget` only tells you
  // whether the job beat its own cost target, which is a different question.
  const margin = contract === null ? null : contract - spend.total
  const marginPct = contract && contract > 0 && margin !== null ? (margin / contract) * 100 : null
  const spentPct = budget && budget > 0 ? (spend.total / budget) * 100 : 0

  /**
   * Estimate versus actual, per cost code. Estimated hours are only knowable
   * for lines the estimate priced by the hour, so an EST HRS cell is blank
   * rather than zero when the line was priced another way.
   */
  const byCode = useMemo(() => {
    interface Row {
      hours: number
      labour: number
      materials: number
      other: number
      estCost: number
      estHours: number
    }
    const map = new Map<string, Row>()
    const get = (code: string) => {
      let e = map.get(code)
      if (!e) {
        e = { hours: 0, labour: 0, materials: 0, other: 0, estCost: 0, estHours: 0 }
        map.set(code, e)
      }
      return e
    }
    for (const l of estLines) {
      const e = get(l.cost_code ?? 'Uncoded')
      e.estCost += Number(l.line_total)
      if (/^(hr|hour|hrs)$/i.test(l.unit)) e.estHours += Number(l.qty)
    }
    for (const sh of shifts) {
      const e = get(sh.cost_code ?? 'Uncoded')
      const h = hoursOf(sh)
      e.hours += h
      e.labour += h * rateOf(sh.worker_id)
    }
    for (const m of materials) {
      if (m.status === 'returned') continue
      get(m.cost_code ?? 'Uncoded').materials += Number(m.total_cost)
    }
    const linked = new Set(materials.map((m) => m.expense_id).filter((x): x is string => Boolean(x)))
    for (const x of expenses) {
      if (linked.has(x.id)) continue
      get(x.cost_code ?? 'Uncoded').other += Number(x.amount)
    }
    return [...map.entries()]
      .map(([code, v]) => {
        const actual = v.labour + v.materials + v.other
        return {
          code,
          name: costCodes.find((c) => c.code === code)?.name ?? (code === 'Uncoded' ? 'Not coded' : '—'),
          estHours: v.estHours,
          hours: v.hours,
          estCost: v.estCost,
          actual,
          // Positive is money left on that line; negative is an overrun.
          variance: v.estCost > 0 ? v.estCost - actual : null,
        }
      })
      .sort((a, b) => b.actual - a.actual)
  }, [estLines, shifts, materials, expenses, rateOf])

  const totals = byCode.reduce(
    (t, r) => ({
      estHours: t.estHours + r.estHours,
      hours: t.hours + r.hours,
      estCost: t.estCost + r.estCost,
      actual: t.actual + r.actual,
    }),
    { estHours: 0, hours: 0, estCost: 0, actual: 0 },
  )
  const totalVariance = totals.estCost > 0 ? totals.estCost - totals.actual : null
  const overruns = byCode.filter((r) => r.variance !== null && r.variance < 0)
  const uncoded = byCode.find((r) => r.code === 'Uncoded')

  const varianceColour = (v: number | null) =>
    v === null ? theme.inkFaint : v < 0 ? theme.alert : '#1B7A2C'

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatCard
          label="CONTRACT VALUE"
          value={contract === null ? '—' : money(contract)}
          note={contract === null ? 'Set the agreed price on the job site' : 'What the client is paying'}
        />
        <StatCard
          label="COST TO DATE"
          value={money(spend.total)}
          note={`${money(spend.labour)} labour · ${money(spend.materials)} materials · ${money(spend.other)} other`}
        />
        <StatCard
          label="PROJECTED MARGIN"
          value={margin === null ? '—' : money(margin)}
          note={
            marginPct === null
              ? 'Needs a contract value'
              : `${marginPct.toFixed(1)}% of contract · ${budget ? `${Math.round(spentPct)}% of cost budget spent` : 'no cost budget set'}`
          }
          tone={margin !== null && margin < 0 ? 'watch' : undefined}
        />
        {overruns.length > 0 ? (
          <StatCard
            label="WATCH"
            value={money(overruns.reduce((t, r) => t + Math.abs(r.variance ?? 0), 0))}
            note={`${overruns.length} cost ${overruns.length === 1 ? 'code is' : 'codes are'} over the estimate`}
            tone="watch"
          />
        ) : uncoded && uncoded.actual > 0 ? (
          <StatCard
            label="WATCH"
            value={money(uncoded.actual)}
            note="Spend with no cost code — it lands on no line"
            tone="watch"
          />
        ) : (
          <StatCard
            label="VARIANCE"
            value={totalVariance === null ? '—' : money(totalVariance)}
            note={totalVariance === null ? 'No approved estimate for this job' : 'Estimate less actual, all codes'}
          />
        )}
      </div>

      <div style={cardStyle}>
        <div style={cardHead}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Job costing by cost code</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: LABEL }}>
            {estLines.length > 0
              ? 'Estimate from the approved quote · actuals from shifts, materials and expenses'
              : 'Actuals from shifts, materials and expenses — no approved estimate to compare against'}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ ...gridHead, gridTemplateColumns: BUDGET_COLUMNS, minWidth: 760 }}>
            <span style={thStyle}>COST CODE</span>
            <span style={{ ...thStyle, textAlign: 'right' }}>EST HRS</span>
            <span style={{ ...thStyle, textAlign: 'right' }}>ACT HRS</span>
            <span style={{ ...thStyle, textAlign: 'right' }}>EST COST</span>
            <span style={{ ...thStyle, textAlign: 'right' }}>ACT COST</span>
            <span style={{ ...thStyle, textAlign: 'right' }}>VARIANCE</span>
          </div>

          {byCode.length === 0 && (
            <div style={{ padding: '24px 14px', fontSize: 12.5, color: LABEL }}>
              Nothing has been costed to this job yet.
            </div>
          )}

          {byCode.map((b) => (
            <div key={b.code} style={{ ...gridRow, gridTemplateColumns: BUDGET_COLUMNS, minWidth: 760 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: LABEL }}>{b.code}</span>
                <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </span>
              </span>
              <span style={{ fontSize: 13, color: MUTED, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {b.estHours > 0 ? b.estHours.toFixed(1) : '—'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {b.hours > 0 ? b.hours.toFixed(1) : '—'}
              </span>
              <span style={{ fontSize: 13, color: MUTED, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {b.estCost > 0 ? money(b.estCost) : '—'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {money(b.actual)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: varianceColour(b.variance) }}>
                {b.variance === null ? '—' : `${b.variance < 0 ? '−' : '+'}${money(Math.abs(b.variance))}`}
              </span>
            </div>
          ))}

          <div style={{ ...gridTotal, gridTemplateColumns: BUDGET_COLUMNS, minWidth: 760 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Total</span>
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {totals.estHours > 0 ? totals.estHours.toFixed(1) : '—'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {totals.hours.toFixed(1)}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {totals.estCost > 0 ? money(totals.estCost) : '—'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {money(totals.actual)}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: varianceColour(totalVariance) }}>
              {totalVariance === null ? '—' : `${totalVariance < 0 ? '−' : '+'}${money(Math.abs(totalVariance))}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
