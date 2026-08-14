/**
 * One job — a transcription of the design's isJob block. Charcoal header at
 * 48px, the state row with its halo dot, the 58px charcoal tab row with 3px
 * underline bars, then the six tabs: Photos · Plans · Waterproofing · Chat ·
 * Money · Crew. Money renders only for the office — absent, not disabled,
 * which is the drawing's own caption and what RLS answers anyway.
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

const CameraGlyph = ({ size, opacity = 1, stroke = '#fff' }: { size: number; opacity?: number; stroke?: string }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth="1.6" strokeLinejoin="round">
    <path d="M2.6 6.2h3.1l1.3-1.9h6l1.3 1.9h3.1v9.6H2.6z" />
    <circle cx="10" cy="10.8" r="3" />
  </svg>
)

const Chevron = ({ colour = '#B7BCC2' }: { colour?: string }) => (
  <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
    <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={colour} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ------------------------------------------------------------------ photos

const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upper = d
    .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '')
    .toUpperCase()
  return d.getTime() >= today.getTime() ? `TODAY · ${upper}` : upper
}

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

  const groups = useMemo(() => {
    const by = new Map<string, SiteFileRow[]>()
    for (const f of files) {
      const key = (f.taken_at ?? '').slice(0, 10) || 'unknown'
      by.set(key, [...(by.get(key) ?? []), f])
    }
    return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [files])

  const areas = useMemo(() => new Set(files.map((f) => f.caption).filter(Boolean)).size, [files])
  const countLine = `${files.length === 60 ? '60+' : files.length} photo${files.length === 1 ? '' : 's'}${areas ? ` · ${areas} area${areas === 1 ? '' : 's'}` : ''}`

  // The drawing's placeholder shades — tiles cycle through them until the
  // signed URL arrives, so the grid never flashes white.
  const shades = ['#C9CFD5', '#BFC6CD', '#D2D7DC', '#C3CAD1', '#CDD3D9', '#B9C1C9']

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 20px', background: '#fff', borderBottom: '1px solid #ECEFF2' }}>
        <span style={{ flex: 1, fontSize: 14, color: '#4A5057' }}>{countLine}</span>
        <button
          onClick={onTakePhoto}
          style={{ display: 'flex', alignItems: 'center', gap: 7, height: 44, padding: '0 15px', background: '#1A1D21', border: 0, borderRadius: 8, color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, letterSpacing: '.03em', cursor: 'pointer' }}
        >
          <CameraGlyph size={17} />
          Add
        </button>
      </div>
      {groups.map(([day, rows]) => (
        <div key={day} style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px 4px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.11em', color: '#7B838B' }}>
            {day === 'unknown' ? 'UNDATED' : dayLabel(day)}
          </span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {rows.map((f, i) => (
              <span key={f.id} style={{ position: 'relative', flex: 'none', width: 'calc((100% - 12px) / 3)', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: shades[i % shades.length] }}>
                {urls[f.id] ? (
                  <img src={urls[f.id]} alt={f.caption ?? f.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}>
                    <CameraGlyph size={26} opacity={0.55} />
                  </span>
                )}
                {f.caption && (
                  <span style={{ position: 'absolute', left: 5, bottom: 5, right: 5, display: 'flex' }}>
                    <span style={{ maxWidth: '100%', padding: '3px 7px', borderRadius: 6, background: 'rgba(20,23,26,.72)', color: '#fff', fontSize: 10.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.caption}
                    </span>
                  </span>
                )}
              </span>
            ))}
          </span>
        </div>
      ))}
      {!loading && files.length === 0 && (
        <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
          No photos on this job yet. Everything you take lands here stamped with who,
          when and where — the record that wins arguments later.
        </div>
      )}
      <div style={{ height: 14 }} />
    </div>
  )
}

// ----------------------------------------------------------- waterproofing

interface WetRow {
  id: string
  area: string
  status: string
  flood_test_on: string | null
  signed_off_on: string | null
}

function WaterproofingTab({ site }: { site: JobSiteRow }) {
  const [rows, setRows] = useState<WetRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('waterproofing')
      .select('id, area, status, flood_test_on, signed_off_on')
      .eq('site_id', site.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return
        setRows((data as WetRow[]) ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [site.id])

  const chip = (r: WetRow) =>
    r.status === 'signed_off'
      ? { label: 'Signed off', bg: '#EAF6EF', fg: '#1F7A4D' }
      : r.status === 'failed'
        ? { label: 'Failed', bg: '#FDECEE', fg: '#A3282E' }
        : { label: 'In progress', bg: '#FFF6E3', fg: '#8A6100' }

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 16px 20px' }}>
      {rows.map((r) => {
        const c = chip(r)
        return (
          <div key={r.id} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 11, minHeight: 58, padding: '11px 13px 11px 15px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 10, boxShadow: '0 1px 2px rgba(16,20,24,.04)' }}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em', color: s.ink }}>{r.area}</span>
              <span style={{ fontSize: 12.5, color: '#7B838B' }}>
                {r.flood_test_on
                  ? `Flood test ${new Date(r.flood_test_on).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
                  : 'No flood test recorded'}
              </span>
            </span>
            <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', height: 23, padding: '0 9px', borderRadius: 12, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 700 }}>
              {c.label}
            </span>
          </div>
        )
      })}
      {!loading && rows.length === 0 && (
        <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
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

function MoneyTab({ site, onAddInvoice }: { site: JobSiteRow; onAddInvoice: () => void }) {
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

  if (loading) return <div style={{ height: '100%' }} />
  if (!row) {
    return (
      <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
        No contract entered for this job yet — margin only works once it is. Enter the
        contract on the office dashboard and this tab comes alive.
      </div>
    )
  }

  const claimedPct =
    row.job_value_ex && row.claimed_ex ? Math.round((Number(row.claimed_ex) / Number(row.job_value_ex)) * 100) : null
  const marginFg = row.margin_pct === null ? '#8A929B' : Number(row.margin_pct) >= 0 ? '#4CC38A' : '#E5484D'

  const lines: Array<{ k: string; note: string; v: string; warn?: boolean }> = [
    { k: 'Claimed', note: claimedPct === null ? 'nothing claimed yet' : `${claimedPct}% of the job`, v: money(row.claimed_ex) },
    { k: 'Contractors & wages', note: `${Number(row.labour_hours ?? 0).toFixed(0)} hrs on the clock`, v: money(row.labour_cost) },
    { k: 'Materials & hire', note: 'materials, expenses and sublet', v: money(Number(row.material_cost ?? 0) + Number(row.expense_cost ?? 0) + Number(row.sublet_cost ?? 0)) },
    { k: 'Variations', note: pendingCount > 0 ? `${pendingCount} with the builder` : 'none awaiting approval', v: money(row.approved_variations), warn: pendingCount > 0 },
  ]

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 16px 20px' }}>
      {/* The dark summary card. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'stretch', background: 'linear-gradient(#23272C,#15181C)', borderRadius: 12, boxShadow: '0 8px 20px rgba(16,20,24,.18), 0 1px 0 rgba(255,255,255,.06) inset' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7, padding: '15px 15px 16px' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.13em', color: '#8A929B' }}>CONTRACT VALUE</span>
          <span style={{ fontSize: 25, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1, color: '#fff' }}>{money(row.job_value_ex)}</span>
        </span>
        <span style={{ flex: 'none', width: 1, background: 'rgba(255,255,255,.13)', margin: '14px 0' }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7, padding: '15px 15px 16px' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.13em', color: '#8A929B' }}>MARGIN AT TODAY</span>
          <span style={{ fontSize: 25, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1, color: marginFg }}>
            {row.margin_pct === null ? '—' : `${Number(row.margin_pct).toFixed(1)}%`}
          </span>
        </span>
      </div>

      {lines.map((l) => (
        <div key={l.k} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 11, minHeight: 58, padding: '11px 13px 11px 15px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 10, boxShadow: '0 1px 2px rgba(16,20,24,.04)' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em', color: s.ink }}>{l.k}</span>
            <span style={{ fontSize: 12.5, color: l.warn ? '#8A6100' : '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.note}</span>
          </span>
          <span style={{ flex: 'none', fontSize: 16, fontWeight: 600, color: s.ink, fontVariantNumeric: 'tabular-nums' }}>{l.v}</span>
          <Chevron />
        </div>
      ))}

      <div style={{ flex: 'none', display: 'flex', gap: 9, paddingTop: 3 }}>
        <button
          onClick={onAddInvoice}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, background: '#1A1D21', border: 0, borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, letterSpacing: '.04em', cursor: 'pointer' }}
        >
          <CameraGlyph size={17} />
          ADD INVOICE
        </button>
        <button
          onClick={onAddInvoice}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 50, background: '#fff', border: '1px solid #DCE0E6', borderRadius: 10, color: s.ink, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, letterSpacing: '.04em', cursor: 'pointer' }}
        >
          + ADD A COST
        </button>
      </div>

      <p style={{ margin: '4px 4px 0', fontSize: 13, lineHeight: 1.5, color: '#7B838B' }}>
        Tap any line for the full rundown. Photograph a supplier invoice and Crewline reads
        the total, then files it against this job. Only owners and the office see this tab.
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
      const people = new Map(
        (cv.data ?? []).map((w: { id: string; name: string; initials: string; trade: string }) => [w.id, w]),
      )
      const out: Array<{ name: string; initials: string; trade: string; since: string }> = []
      for (const r of (sh.data ?? []) as Array<{ worker_id: string; started_at: string; ended_at: string | null }>) {
        if (r.ended_at !== null) continue
        const w = people.get(r.worker_id)
        out.push({ name: w?.name ?? 'Crew member', initials: w?.initials ?? '??', trade: w?.trade ?? '', since: timeOf(r.started_at) })
      }
      setRows(out)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [site.id])

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 16px 20px' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, minHeight: 58, padding: '11px 13px 11px 15px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 10, boxShadow: '0 1px 2px rgba(16,20,24,.04)' }}>
          <span style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: s.charcoal, color: '#fff', fontSize: 11.5, fontWeight: 700 }}>
            {r.initials}
            <span style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: '50%', border: '2px solid #fff', background: '#4CC38A' }} />
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em', color: s.ink }}>{r.name}</span>
            <span style={{ fontSize: 12.5, color: '#7B838B' }}>{[r.trade, `on since ${r.since}`].filter(Boolean).join(' · ')}</span>
          </span>
        </div>
      ))}
      {!loading && rows.length === 0 && (
        <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
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
  onAddInvoice,
}: {
  me: WorkerRow
  site: JobSiteRow
  progressPct: number | null
  onSiteCount: number
  /** The existing ChatScreen, rendered by the shell so its props stay there. */
  chat: (onClose: () => void) => React.ReactNode
  onBack: () => void
  onTakePhoto: () => void
  onAddInvoice: () => void
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
    return office ? all : all.filter((t) => t.key !== 'money')
  }, [office])

  const sub = [site.address, site.job_type, site.client_name].filter(Boolean).join(' · ')
  // The drawing's dot: green running to plan, red when something needs you —
  // driven here by whether anyone is on the clock.
  const dot = onSiteCount > 0 ? '#4CC38A' : '#8A929B'
  const halo = onSiteCount > 0 ? 'rgba(76,195,138,.16)' : 'rgba(138,146,155,.16)'
  const state = `${onSiteCount} on site${progressPct !== null ? ` · ${Math.round(progressPct)}% done` : ''}`

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Charcoal header — 48px, back 44, camera 44. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4, height: 48, padding: '0 8px 0 4px', background: '#2B2F33', color: '#fff' }}>
        <span onClick={onBack} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.2 4.4 6.6 10l5.6 5.6" />
          </svg>
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
          {sub && (
            <span style={{ fontSize: 12.5, color: '#A7AEB6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
          )}
        </span>
        <span onClick={onTakePhoto} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, cursor: 'pointer' }}>
          <CameraGlyph size={21} />
        </span>
      </div>

      {/* State row. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 9, padding: '4px 20px 13px', background: '#2B2F33' }}>
        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: dot, boxShadow: `0 0 0 4px ${halo}` }} />
        <span style={{ flex: 1, fontSize: 14, color: '#B4BBC2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state}</span>
        {progressPct !== null && <span style={{ flex: 'none', fontSize: 14, fontWeight: 600, color: '#fff' }}>{Math.round(progressPct)}%</span>}
      </div>

      {/* Tab row — 58px charcoal, 3px underline bars. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'stretch', justifyContent: 'space-between', gap: 2, height: 58, padding: '0 6px', background: '#2B2F33', boxShadow: '0 6px 16px rgba(16,20,24,.16)', overflowX: 'auto' }}>
        {tabs.map((t) => {
          const on = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                position: 'relative',
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                height: 58,
                padding: '0 3px',
                background: 'none',
                border: 0,
                fontFamily: 'inherit',
                fontSize: 13,
                letterSpacing: '-.02em',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                color: on ? '#FFFFFF' : '#8A929B',
                fontWeight: on ? 700 : 500,
              }}
            >
              {t.label}
              <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, borderRadius: '2px 2px 0 0', background: on ? s.accent : 'transparent' }} />
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, background: '#F5F6F7' }}>
        {tab === 'photos' && <PhotoGrid me={me} site={site} onTakePhoto={onTakePhoto} />}
        {tab === 'plans' && <PlansScreen me={me} siteId={site.id} siteName={site.name} onClose={() => setTab('photos')} />}
        {tab === 'waterproofing' && <WaterproofingTab site={site} />}
        {tab === 'chat' && chat(() => setTab('photos'))}
        {tab === 'money' && office && <MoneyTab site={site} onAddInvoice={onAddInvoice} />}
        {tab === 'crew' && <CrewTab site={site} />}
      </div>
    </div>
  )
}
