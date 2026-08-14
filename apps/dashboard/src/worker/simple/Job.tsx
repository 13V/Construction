/**
 * One job, six tabs — Photos · Plans · Waterproofing · Chat · Money · Crew.
 *
 * The dark header and the tab row are this design's job identity. Money is
 * not rendered for a captain or an employee — not disabled, absent, exactly
 * as the drawing's own caption puts it ("Only owners and the office see this
 * tab"), and exactly as RLS would answer anyway. Plans and Chat embed the
 * screens that already work rather than redrawing them this build.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase, type JobSiteRow, type SiteFileRow, type WorkerRow } from '../../data/supabase'
import { BUCKET_FILES, signedUrl } from '../../data/storage'
import { PlansScreen } from '../PlansScreen'
import { s } from './stheme'

type JobTab = 'photos' | 'plans' | 'waterproofing' | 'chat' | 'money' | 'crew'

const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(v))

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

// ------------------------------------------------------------------ photos

function PhotoGrid({ me, site, onTakePhoto }: { me: WorkerRow; site: JobSiteRow; onTakePhoto: () => void }) {
  const [files, setFiles] = useState<SiteFileRow[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('site_files')
      .select('*')
      .eq('site_id', site.id)
      .eq('kind', 'photo')
      .order('created_at', { ascending: false })
      .limit(60)
      .then(async ({ data }) => {
        if (cancelled) return
        const rows = (data as SiteFileRow[]) ?? []
        setFiles(rows)
        setLoading(false)
        for (const f of rows.slice(0, 30)) {
          const u = await signedUrl(BUCKET_FILES, f.storage_path)
          if (cancelled) return
          if (u) setUrls((p) => ({ ...p, [f.id]: u }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [site.id, me.id])

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: s.appBg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: s.panel, borderBottom: `1px solid ${s.borderSoft}` }}>
        <span style={{ fontSize: 13.5, color: s.body }}>
          {files.length === 60 ? '60+' : files.length} photo{files.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={onTakePhoto}
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px', borderRadius: 10, border: 0, background: s.inkDeep, color: '#fff', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}
        >
          Add
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: 2 }}>
        {files.map((f) => (
          <div key={f.id} style={{ position: 'relative', aspectRatio: '1 / 1', background: s.fill, overflow: 'hidden' }}>
            {urls[f.id] && (
              <img src={urls[f.id]} alt={f.caption ?? f.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
            {f.caption && (
              <span style={{ position: 'absolute', left: 5, bottom: 5, maxWidth: 'calc(100% - 10px)', padding: '2px 7px', borderRadius: 4, background: 'rgba(20,23,26,.72)', color: '#fff', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {f.caption}
              </span>
            )}
          </div>
        ))}
      </div>
      {!loading && files.length === 0 && (
        <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: s.muted }}>
          No photos on this job yet. Everything you take lands here stamped with who,
          when and where — the record that wins arguments later.
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------- waterproofing

interface WetSummary {
  area_count: number
  signed_off_count: number
  failed_count: number
  outstanding_count: number
}
interface WetRow {
  id: string
  area: string
  status: string
  flood_test_on: string | null
  signed_off_on: string | null
}

function WaterproofingTab({ site }: { site: JobSiteRow }) {
  const [summary, setSummary] = useState<WetSummary | null>(null)
  const [rows, setRows] = useState<WetRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      supabase().from('site_waterproofing_v').select('*').eq('site_id', site.id).maybeSingle(),
      supabase().from('waterproofing').select('id, area, status, flood_test_on, signed_off_on').eq('site_id', site.id).order('created_at', { ascending: false }),
    ]).then(([sum, list]) => {
      if (cancelled) return
      setSummary((sum.data as WetSummary) ?? null)
      setRows((list.data as WetRow[]) ?? [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [site.id])

  const chip = (r: WetRow) => {
    if (r.status === 'signed_off') return { label: 'Signed off', bg: s.greenFill, fg: s.green }
    if (r.status === 'failed') return { label: 'Failed', bg: s.redFill, fg: s.red }
    return { label: 'In progress', bg: s.amberFill, fg: s.amber }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: s.appBg, padding: '12px 16px 20px' }}>
      {summary && summary.area_count > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {[
            ['Areas', summary.area_count, s.ink],
            ['Signed off', summary.signed_off_count, s.green],
            ['Outstanding', summary.outstanding_count, summary.outstanding_count > 0 ? s.amber : s.ink],
          ].map(([label, value, colour]) => (
            <div key={String(label)} style={{ flex: 1, padding: '12px 14px', background: s.panel, border: `1px solid ${s.border}`, borderRadius: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', color: s.muted }}>{String(label).toUpperCase()}</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: String(colour) }}>{Number(value)}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => {
          const c = chip(r)
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', background: s.panel, border: `1px solid ${s.border}`, borderRadius: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: s.ink }}>{r.area}</div>
                <div style={{ fontSize: 12.5, color: s.muted }}>
                  {r.flood_test_on ? `Flood test ${new Date(r.flood_test_on).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : 'No flood test recorded'}
                </div>
              </div>
              <span style={{ flex: 'none', padding: '4px 10px', borderRadius: 12, background: c.bg, color: c.fg, fontSize: 11.5, fontWeight: 700 }}>{c.label}</span>
            </div>
          )
        })}
      </div>
      {!loading && rows.length === 0 && (
        <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: s.muted }}>
          No wet areas recorded on this job yet. A waterproofing record is what the
          certificate gets issued from — the office or your captain starts one.
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- money

interface ProfitRow {
  contract_sum_ex: number | null
  approved_variations: number | null
  job_value_ex: number | null
  claimed_ex: number | null
  labour_hours: number | null
  labour_cost: number | null
  material_cost: number | null
  expense_cost: number | null
  sublet_cost: number | null
  margin_pct: number | null
}

function MoneyTab({ site }: { site: JobSiteRow }) {
  const [row, setRow] = useState<ProfitRow | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      supabase().from('job_profit_v').select('*').eq('site_id', site.id).maybeSingle(),
      supabase().from('change_orders').select('id').eq('site_id', site.id).eq('status', 'pending_client'),
    ]).then(([p, co]) => {
      if (cancelled) return
      setRow((p.data as ProfitRow) ?? null)
      setPendingCount(co.data?.length ?? 0)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [site.id])

  if (loading) return <div style={{ flex: 1, background: s.appBg }} />
  if (!row) {
    return (
      <div style={{ flex: 1, background: s.appBg, padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: s.muted }}>
        No contract entered for this job yet — margin only works once it is. Enter
        the contract on the office dashboard and this tab comes alive.
      </div>
    )
  }

  const claimedPct =
    row.job_value_ex && row.claimed_ex ? Math.round((Number(row.claimed_ex) / Number(row.job_value_ex)) * 100) : null
  const marginTone = row.margin_pct === null ? s.onDarkMuted : Number(row.margin_pct) >= 0 ? '#5BD598' : '#FF8A80'

  const lines: Array<{ label: string; sub: string; value: string; warn?: boolean }> = [
    { label: 'Claimed', sub: claimedPct === null ? 'nothing claimed yet' : `${claimedPct}% of the job`, value: money(row.claimed_ex) },
    { label: 'Contractors & wages', sub: `${Number(row.labour_hours ?? 0).toFixed(0)} hrs on the clock`, value: money(row.labour_cost) },
    { label: 'Materials & hire', sub: 'materials, expenses and sublet', value: money(Number(row.material_cost ?? 0) + Number(row.expense_cost ?? 0) + Number(row.sublet_cost ?? 0)) },
    { label: 'Variations', sub: pendingCount > 0 ? `${pendingCount} with the builder` : 'none awaiting approval', value: money(row.approved_variations), warn: pendingCount > 0 },
  ]

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: s.appBg, padding: '12px 16px 20px' }}>
      <div style={{ display: 'flex', borderRadius: 14, background: s.inkDeep, padding: '16px 18px', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.1em', color: s.onDarkMuted }}>CONTRACT VALUE</div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', color: '#fff' }}>{money(row.job_value_ex)}</div>
        </div>
        <span style={{ width: 1, background: 'rgba(255,255,255,.12)', margin: '0 16px' }} />
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.1em', color: s.onDarkMuted }}>MARGIN AT TODAY</div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', color: marginTone }}>
            {row.margin_pct === null ? '—' : `${Number(row.margin_pct).toFixed(1)}%`}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.map((l) => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 15px', background: s.panel, border: `1px solid ${s.border}`, borderRadius: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: s.ink }}>{l.label}</div>
              <div style={{ fontSize: 12.5, color: l.warn ? s.amber : s.muted }}>{l.sub}</div>
            </div>
            <span style={{ fontSize: 15.5, fontWeight: 600, color: s.ink, fontVariantNumeric: 'tabular-nums' }}>{l.value}</span>
          </div>
        ))}
      </div>

      <p style={{ margin: '14px 4px 0', fontSize: 12.5, lineHeight: 1.5, color: s.muted }}>
        All figures ex GST. Only owners and the office see this tab.
      </p>
    </div>
  )
}

// -------------------------------------------------------------------- crew

function CrewTab({ site }: { site: JobSiteRow }) {
  const [rows, setRows] = useState<Array<{ name: string; initials: string; trade: string; since: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const t0 = new Date()
    t0.setHours(0, 0, 0, 0)
    void Promise.all([
      supabase().from('shifts').select('worker_id, started_at, ended_at').eq('site_id', site.id).gte('started_at', t0.toISOString()),
      supabase().from('crew_v').select('id, name, initials, trade'),
    ]).then(([sh, cv]) => {
      if (cancelled) return
      const people = new Map((cv.data ?? []).map((w: { id: string; name: string; initials: string; trade: string }) => [w.id, w]))
      const out: Array<{ name: string; initials: string; trade: string; since: string }> = []
      for (const r of (sh.data ?? []) as Array<{ worker_id: string; started_at: string; ended_at: string | null }>) {
        if (r.ended_at !== null) continue
        const w = people.get(r.worker_id)
        out.push({
          name: w?.name ?? 'Crew member',
          initials: w?.initials ?? '??',
          trade: w?.trade ?? '',
          since: timeOf(r.started_at),
        })
      }
      setRows(out)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [site.id])

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: s.appBg, padding: '12px 16px 20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: s.panel, border: `1px solid ${s.border}`, borderRadius: 12 }}>
            <span style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: '50%', background: s.charcoal, color: '#fff', fontSize: 12, fontWeight: 700 }}>
              {r.initials}
              <span style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: '50%', border: `2px solid ${s.panel}`, background: s.green }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: s.ink }}>{r.name}</div>
              <div style={{ fontSize: 12.5, color: s.muted }}>
                {[r.trade, `on since ${r.since}`].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        ))}
      </div>
      {!loading && rows.length === 0 && (
        <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: s.muted }}>
          Nobody on the clock here right now. Whoever the geofence clocks on shows up
          here the moment it happens.
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------- the shell

export function JobScreen({
  me,
  site,
  progressPct,
  onSiteCount,
  chat,
  onBack,
  onTakePhoto,
}: {
  me: WorkerRow
  site: JobSiteRow
  progressPct: number | null
  onSiteCount: number
  /** The existing ChatScreen, rendered by the shell so its props stay there. */
  chat: (onClose: () => void) => React.ReactNode
  onBack: () => void
  onTakePhoto: () => void
}) {
  const office = me.is_office
  const [tab, setTab] = useState<JobTab>('photos')

  const tabs = useMemo(() => {
    const all: Array<{ key: JobTab; label: string }> = [
      { key: 'photos', label: 'Photos' },
      { key: 'plans', label: 'Plans' },
      { key: 'waterproofing', label: 'Waterproofing' },
      { key: 'chat', label: 'Chat' },
      { key: 'money', label: 'Money' },
      { key: 'crew', label: 'Crew' },
    ]
    // Absent, not disabled. The database returns nothing for them anyway.
    return office ? all : all.filter((t) => t.key !== 'money')
  }, [office])

  const subLine = [site.address, site.job_type, site.client_name].filter(Boolean).join(' · ')

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* The dark header. */}
      <div style={{ flex: 'none', background: s.inkDeep, color: '#fff', padding: '10px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <button onClick={onBack} aria-label="Back" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 40, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
            <svg width="18" height="18" viewBox="0 0 10 10" style={{ transform: 'rotate(90deg)' }}>
              <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {site.name}
            </div>
            {subLine && (
              <div style={{ fontSize: 12.5, color: s.onDarkMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subLine}</div>
            )}
          </div>
          <button
            onClick={onTakePhoto}
            aria-label="Take photo"
            style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, background: 'none', border: 0, cursor: 'pointer' }}
          >
            <svg width="21" height="21" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.4">
              <path d="M2 5.6h2.6L6 3.8h4l1.4 1.8H14v7.6H2z" strokeLinejoin="round" />
              <circle cx="8" cy="9.2" r="2.6" />
            </svg>
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0 8px 44px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: s.onDarkMuted }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: onSiteCount > 0 ? '#E5484D' : s.onDarkFaint }} />
            {onSiteCount} on site{progressPct !== null ? ` · ${Math.round(progressPct)}% done` : ''}
          </span>
          {progressPct !== null && <span style={{ fontSize: 14, fontWeight: 700 }}>{Math.round(progressPct)}%</span>}
        </div>
        {/* Tab row. */}
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto', padding: '0 0 0 34px' }}>
          {tabs.map((t) => {
            const on = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  flex: 'none',
                  padding: '9px 10px 11px',
                  background: 'none',
                  border: 0,
                  borderBottom: `2px solid ${on ? s.accent : 'transparent'}`,
                  fontFamily: 'inherit',
                  fontSize: 13.5,
                  fontWeight: on ? 700 : 500,
                  color: on ? '#fff' : s.onDarkMuted,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'photos' && <PhotoGrid me={me} site={site} onTakePhoto={onTakePhoto} />}
      {tab === 'plans' && (
        <PlansScreen me={me} siteId={site.id} siteName={site.name} onClose={() => setTab('photos')} />
      )}
      {tab === 'waterproofing' && <WaterproofingTab site={site} />}
      {tab === 'chat' && chat(() => setTab('photos'))}
      {tab === 'money' && office && <MoneyTab site={site} />}
      {tab === 'crew' && <CrewTab site={site} />}
    </div>
  )
}
