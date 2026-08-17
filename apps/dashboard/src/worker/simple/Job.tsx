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
import { avatarGrey, s, SAFE_BOTTOM, SAFE_TOP } from './stheme'

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

/** The drawing's tone colours for money notes and values. */
const M_FG = { r: '#A3282E', a: '#8A6100', g: '#1F7A4D' } as const
const M_CHIP = {
  r: { bg: '#FDECEE', fg: '#A3282E' },
  a: { bg: '#FFF6E3', fg: '#8A6100' },
  g: { bg: '#EAF6EF', fg: '#1F7A4D' },
  n: { bg: '#F1F3F5', fg: '#4A5057' },
} as const

interface MoneyLine {
  k: string
  v: string
  flag?: string
}

interface MoneyRowData {
  key: string
  k: string
  v: string
  note: string
  tone?: keyof typeof M_FG
  lines: MoneyLine[]
  empty: string
  ban?: { text: string; tone: keyof typeof M_CHIP }
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

const countWord = (n: number) =>
  ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'][n] ?? String(n)

function MoneyTab({
  site,
  floodHoldCount,
  onAddInvoice,
}: {
  site: JobSiteRow
  floodHoldCount: number
  onAddInvoice: () => void
}) {
  const [row, setRow] = useState<ProfitRow | null>(null)
  const [donePct, setDonePct] = useState<number | null>(null)
  const [claims, setClaims] = useState<Array<{ label: string; ex: number }>>([])
  const [pending, setPending] = useState<Array<{ description: string; cost_impact: number }>>([])
  const [mats, setMats] = useState<Array<{ name: string; supplier: string | null; total_cost: number; cost_code: string | null }>>([])
  const [exps, setExps] = useState<Array<{ vendor: string; category: string | null; amount: number; tax: number }>>([])
  const [sublets, setSublets] = useState<Array<{ name: string; cost: number }>>([])
  const [wageLines, setWageLines] = useState<MoneyLine[]>([])
  const [open, setOpen] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void Promise.all([
      client.from('job_profit_v').select('*').eq('site_id', site.id).maybeSingle(),
      client.from('site_progress_v').select('pct_complete').eq('site_id', site.id).maybeSingle(),
      client.from('invoices').select('invoice_no, period, issued_on, ex_tax').eq('site_id', site.id).in('status', ['sent', 'paid']).order('issued_on', { ascending: false }),
      client.from('change_orders').select('description, cost_impact').eq('site_id', site.id).eq('status', 'pending_client'),
      client.from('materials').select('name, supplier, total_cost, cost_code').eq('site_id', site.id).neq('status', 'returned'),
      client.from('expenses').select('vendor, category, amount, tax').eq('site_id', site.id),
      client.from('subcontract_work').select('cost, subcontractors(name)').eq('site_id', site.id),
      client.from('shifts').select('worker_id, started_at, ended_at, break_minutes').eq('site_id', site.id).not('ended_at', 'is', null),
      client.from('crew_v').select('id, name, trade, role'),
      client.from('worker_pay').select('worker_id, rate'),
    ]).then(([p, pr, inv, co, mt, ex, sw, sh, cv, pay]) => {
      if (cancelled) return
      setRow((p.data as ProfitRow) ?? null)
      setDonePct(pr.data?.pct_complete === undefined || pr.data?.pct_complete === null ? null : Number(pr.data.pct_complete))
      setClaims(
        ((inv.data as Array<{ invoice_no: string; period: string | null; issued_on: string; ex_tax: number }>) ?? []).map((i) => ({
          label: `${i.period || i.invoice_no} · ${shortDate(i.issued_on)}`,
          ex: Number(i.ex_tax ?? 0),
        })),
      )
      setPending(((co.data as Array<{ description: string; cost_impact: number }>) ?? []))
      setMats(((mt.data as Array<{ name: string; supplier: string | null; total_cost: number; cost_code: string | null }>) ?? []))
      setExps(((ex.data as Array<{ vendor: string; category: string | null; amount: number; tax: number }>) ?? []))
      const bySub = new Map<string, number>()
      // The embed's type depends on whether the client knows the FK is
      // many-to-one; accept both shapes rather than fighting the codegen.
      for (const r of (sw.data ?? []) as Array<{ cost: number; subcontractors: { name: string } | Array<{ name: string }> | null }>) {
        const rel = r.subcontractors
        const name = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? 'Subcontractor'
        bySub.set(name, (bySub.get(name) ?? 0) + Number(r.cost ?? 0))
      }
      setSublets([...bySub.entries()].map(([name, cost]) => ({ name, cost })))

      // Wages per person: closed shift hours × their rate. worker_pay is
      // office-only under RLS, which is exactly who can open this tab.
      const rates = new Map(((pay.data as Array<{ worker_id: string; rate: number }>) ?? []).map((r) => [r.worker_id, Number(r.rate)]))
      const people = new Map(
        ((cv.data as Array<{ id: string; name: string; trade: string | null; role: string }>) ?? []).map((w) => [w.id, w]),
      )
      const hours = new Map<string, number>()
      for (const r of (sh.data ?? []) as Array<{ worker_id: string; started_at: string; ended_at: string | null; break_minutes: number | null }>) {
        if (!r.ended_at) continue
        const h = Math.max(
          0,
          (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 3_600_000 - (r.break_minutes ?? 0) / 60,
        )
        hours.set(r.worker_id, (hours.get(r.worker_id) ?? 0) + h)
      }
      const wl: Array<{ k: string; cost: number }> = []
      for (const [workerId, h] of hours) {
        const w = people.get(workerId)
        if (!w || h <= 0) continue
        const role = w.role === 'captain' ? 'crew captain' : (w.trade || 'crew').toLowerCase()
        wl.push({ k: `${w.name} · ${role}`, cost: h * (rates.get(workerId) ?? 0) })
      }
      wl.sort((a, b) => b.cost - a.cost)
      setWageLines(wl.map((l) => ({ k: l.k, v: money(Math.round(l.cost)) })))
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

  const value = Number(row.job_value_ex ?? 0)
  const claimed = Number(row.claimed_ex ?? 0)
  const claimedPct = value > 0 && claimed > 0 ? Math.round((claimed / value) * 100) : null
  // "Margin at today" is margin on work actually done — earned value less
  // cost to date, over earned value. The view's margin_pct assumes no more
  // cost ever lands, which flatters every half-done job; with no progress
  // figure there is nothing earned to measure against, so the card shows a
  // dash rather than a number that cannot be defended.
  const totalCost = Number(row.labour_cost ?? 0) + Number(row.material_cost ?? 0) + Number(row.expense_cost ?? 0) + Number(row.sublet_cost ?? 0)
  const earned = donePct !== null && value > 0 ? (value * donePct) / 100 : null
  const marginPct = earned !== null && earned > 0 ? ((earned - totalCost) / earned) * 100 : null
  const marginFg = marginPct === null ? '#8A929B' : marginPct >= 15 ? '#4CC38A' : marginPct >= 8 ? '#E9A23B' : '#F2777C'

  /**
   * The claim band, in the order the trade actually worries: a covered
   * membrane with no water test freezes claiming outright; then it is the
   * claimed-vs-done conversation, in the drawing's own words.
   */
  let ban: MoneyRowData['ban']
  if (floodHoldCount > 0) {
    ban = {
      tone: 'r',
      text: `HELD UNTIL SIGN-OFF — ${countWord(floodHoldCount)} wet area${floodHoldCount === 1 ? '' : 's'} signed off with no flood test. Nothing on this job can be claimed until ${floodHoldCount === 1 ? 'it is' : 'they are'} done.`,
    }
  } else if (claims.length === 0) {
    const month = new Date().toLocaleDateString('en-AU', { month: 'long' })
    ban = { tone: 'n', text: `NOTHING CLAIMED YET — First claim goes out at the end of ${month}, on whatever is measured then.` }
  } else if (claimedPct !== null && donePct !== null) {
    const d = Math.round(donePct)
    if (claimedPct > d) {
      ban = { tone: 'r', text: `CLAIMED AHEAD OF THE WORK — Claimed ${claimedPct}% against ${d}% done. That is the conversation a builder’s QS opens with.` }
    } else if (d - claimedPct <= 2) {
      ban = { tone: 'g', text: `CLAIMED IN LINE WITH THE WORK — Claimed ${claimedPct}% against ${d}% done. Nothing to explain at the next claim.` }
    } else {
      const gap = Math.round(((d / 100) * value - claimed) / 100) * 100
      ban = { tone: 'a', text: `BEHIND ON CLAIMING — Claimed ${claimedPct}% against ${d}% done. There is ${money(gap)} of finished work not yet claimed.` }
    }
  }

  const tileMats = mats.filter((m) => m.cost_code === 'tiles')
  const otherMats = mats.filter((m) => m.cost_code !== 'tiles')
  const tileSum = tileMats.reduce((a, m) => a + Number(m.total_cost ?? 0), 0)
  const matLines: Array<{ k: string; cost: number }> = [
    ...otherMats.map((m) => ({ k: [m.supplier, m.name].filter(Boolean).join(' · '), cost: Number(m.total_cost ?? 0) })),
    ...exps.map((e) => ({ k: [e.vendor, e.category].filter(Boolean).join(' · '), cost: Number(e.amount ?? 0) - Number(e.tax ?? 0) })),
  ].sort((a, b) => b.cost - a.cost)
  const matSum = matLines.reduce((a, l) => a + l.cost, 0)
  const pendingSum = pending.reduce((a, v) => a + Number(v.cost_impact ?? 0), 0)
  const wageSum = Number(row.labour_cost ?? 0) + Number(row.sublet_cost ?? 0)

  const rows: MoneyRowData[] = [
    {
      key: 'claimed',
      k: 'Claimed',
      v: claims.length ? money(claimed) : '—',
      note: claimedPct !== null ? `${claimedPct}% of the job` : claims.length ? 'claimed to date' : 'nothing claimed yet',
      lines: claims.map((c) => ({ k: c.label, v: money(c.ex) })),
      empty: 'No claim has gone out yet.',
      ban,
    },
    {
      key: 'wages',
      k: 'Contractors & wages',
      v: wageSum > 0 ? money(wageSum) : '—',
      note: wageLines.length + sublets.length > 0 ? `${wageLines.length + sublets.length} people on the job` : 'nothing yet',
      lines: [...wageLines, ...sublets.map((x) => ({ k: x.name, v: money(Math.round(x.cost)) }))],
      empty: 'Nobody has booked time to this job.',
    },
    {
      key: 'tiles',
      k: 'Tile supply',
      v: tileSum > 0 ? money(tileSum) : '—',
      note: tileMats.length > 0 ? `${tileMats.length} order${tileMats.length === 1 ? '' : 's'}` : 'nothing ordered',
      lines: tileMats.map((m) => ({ k: [m.supplier, m.name].filter(Boolean).join(' · '), v: money(Number(m.total_cost ?? 0)) })),
      empty: 'No tile ordered against this job.',
    },
    {
      key: 'mats',
      k: 'Materials & hire',
      v: matSum > 0 ? money(matSum) : '—',
      note: matLines.length > 0 ? `${matLines.length} line${matLines.length === 1 ? '' : 's'}` : 'nothing yet',
      lines: matLines.map((l) => ({ k: l.k, v: money(Math.round(l.cost)) })),
      empty: 'No materials or hire booked.',
    },
    {
      key: 'vars',
      k: 'Variations',
      v: pendingSum > 0 ? money(pendingSum) : '—',
      note: pending.length > 0 ? `${pending.length} with the builder` : 'none raised',
      tone: pending.length > 0 ? 'a' : undefined,
      lines: pending.map((v) => ({ k: v.description, v: money(Number(v.cost_impact ?? 0)) })),
      empty: 'No variations raised on this job.',
    },
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
            {marginPct === null ? '—' : `${marginPct.toFixed(1)}%`}
          </span>
        </span>
      </div>

      {rows.map((r) => {
        const isOpen = open === r.key
        const noteFg = r.tone ? M_FG[r.tone] : '#8B9096'
        const vFg = r.tone ? M_FG[r.tone] : '#1A1D21'
        const chip = r.ban ? M_CHIP[r.ban.tone] : null
        return (
          <div key={r.key} style={{ flex: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${isOpen ? '#C3C9D0' : '#E1E5E9'}`, borderRadius: 10, boxShadow: '0 1px 2px rgba(16,20,24,.04)', overflow: 'hidden' }}>
            <span
              onClick={() => setOpen(isOpen ? '' : r.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 58, padding: '11px 13px 11px 15px', cursor: 'pointer' }}
            >
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em', color: s.ink }}>{r.k}</span>
                <span style={{ fontSize: 12.5, color: noteFg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</span>
              </span>
              <span style={{ flex: 'none', fontSize: 16, fontWeight: 600, color: vFg, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
              <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {isOpen && (
              <span style={{ display: 'flex', flexDirection: 'column', background: '#FAFBFC', borderTop: '1px solid #EDEFF1' }}>
                {r.ban && chip && (
                  <span style={{ padding: '11px 15px', fontSize: 13, lineHeight: 1.45, background: chip.bg, color: chip.fg, borderBottom: '1px solid #EDEFF1' }}>
                    {r.ban.text}
                  </span>
                )}
                {r.lines.map((l, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 46, padding: '9px 15px', borderBottom: '1px solid #EDEFF1' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: '#4A5057', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.k}</span>
                    {l.flag && (
                      <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 10, background: '#FFF6E3', fontSize: 11, fontWeight: 700, color: '#8A6100' }}>
                        {l.flag}
                      </span>
                    )}
                    <span style={{ flex: 'none', fontSize: 13.5, fontWeight: 600, color: s.ink, fontVariantNumeric: 'tabular-nums' }}>{l.v}</span>
                  </span>
                ))}
                {r.lines.length === 0 && (
                  <span style={{ padding: '13px 15px', fontSize: 13, color: '#8B9096' }}>{r.empty}</span>
                )}
              </span>
            )}
          </div>
        )
      })}

      <div style={{ flex: 'none', display: 'flex', gap: 9, paddingTop: 3 }}>
        <button
          onClick={onAddInvoice}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, padding: '0 12px', background: '#1A1D21', border: 0, borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap', cursor: 'pointer' }}
        >
          <CameraGlyph size={17} />
          ADD INVOICE
        </button>
        <button
          onClick={onAddInvoice}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, padding: '0 12px', background: '#fff', border: '1px solid #DCE0E6', borderRadius: 10, color: '#1A1D21', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap', cursor: 'pointer' }}
        >
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="#1A1D21" strokeWidth="1.8" strokeLinecap="round">
            <path d="M10 4.6v10.8M4.6 10h10.8" />
          </svg>
          ADD A COST
        </button>
      </div>

      <span style={{ flex: 'none', fontSize: 13, lineHeight: 1.5, color: '#696D74' }}>
        Tap any line for the full rundown. Photograph a supplier invoice and Crewline reads
        the total, then files it against this job. Only owners and the office see this tab.
      </span>
    </div>
  )
}

// -------------------------------------------------------------------- crew

interface CrewMember {
  id: string
  name: string
  initials: string
  trade: string
  /** On the clock right now, versus rostered here today. */
  onClock: boolean
  /** The time that fact happened — clocked on at, or booked to start. */
  at: string
  sortKey: string
}

interface Ticket {
  id: string
  name: string
  expiresOn: string | null
}

/** Same window the office's certifications tab warns inside. */
const CERT_WARN_DAYS = 30

const TICKET_HELD = { bg: '#EAF7EC', fg: '#1B7A2C' }
const TICKET_MISSING = { bg: '#FDECEE', fg: '#A3282E' }

/**
 * Green means they hold it, red means they do not. A ticket that lapsed is
 * red for the same reason a missing one is: on the day it matters, they
 * cannot do the work. The countdown on one about to lapse stays in the
 * label, so it still reads as a warning while it is still theirs.
 */
function ticketTone(expiresOn: string | null): { bg: string; fg: string; suffix: string } {
  if (!expiresOn) return { ...TICKET_HELD, suffix: '' }
  const days = Math.round((new Date(`${expiresOn}T00:00:00`).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { ...TICKET_MISSING, suffix: ' · lapsed' }
  if (days <= CERT_WARN_DAYS) return { ...TICKET_HELD, suffix: ` · ${days}d left` }
  return { ...TICKET_HELD, suffix: '' }
}

/**
 * Who is on this job, and what each of them is ticketed to do.
 *
 * The list is everyone rostered here today, not only whoever the geofence
 * has clocked on — a supervisor asking "can anyone here run the scissor
 * lift" needs an answer at 7am and at 7pm alike. Certifications are
 * company-readable by RLS, so the tickets come back for the whole crew.
 */
function CrewTab({ site }: { site: JobSiteRow }) {
  const [rows, setRows] = useState<CrewMember[]>([])
  const [tickets, setTickets] = useState<Map<string, Ticket[]>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const t0 = new Date()
    t0.setHours(0, 0, 0, 0)
    const t1 = new Date(t0.getTime() + 86_400_000)
    void Promise.all([
      supabase().from('shifts').select('worker_id, started_at, ended_at').eq('site_id', site.id).gte('started_at', t0.toISOString()),
      supabase()
        .from('assignments')
        .select('worker_id, starts_at')
        .eq('site_id', site.id)
        .eq('published', true)
        .gte('starts_at', t0.toISOString())
        .lt('starts_at', t1.toISOString()),
      supabase().from('crew_v').select('id, name, initials, trade'),
      supabase().from('certifications').select('id, worker_id, name, expires_on'),
    ]).then(([sh, asg, cv, certs]) => {
      if (cancelled) return
      const people = new Map(
        (cv.data ?? []).map((w: { id: string; name: string; initials: string; trade: string }) => [w.id, w]),
      )
      const byWorker = new Map<string, CrewMember>()
      const add = (workerId: string, onClock: boolean, at: string) => {
        const existing = byWorker.get(workerId)
        // Clocked on outranks booked — the fact beats the plan.
        if (existing && (existing.onClock || !onClock)) return
        const w = people.get(workerId)
        byWorker.set(workerId, {
          id: workerId,
          name: w?.name ?? 'Crew member',
          initials: w?.initials ?? '??',
          trade: w?.trade ?? '',
          onClock,
          at: timeOf(at),
          sortKey: `${onClock ? '0' : '1'}${at}`,
        })
      }
      for (const r of (sh.data ?? []) as Array<{ worker_id: string; started_at: string; ended_at: string | null }>) {
        if (r.ended_at !== null) continue
        add(r.worker_id, true, r.started_at)
      }
      for (const a of (asg.data ?? []) as Array<{ worker_id: string; starts_at: string }>) {
        add(a.worker_id, false, a.starts_at)
      }
      const out = [...byWorker.values()]
      // On the clock first, then earliest — the drawing reads a crew list as
      // the day arrived.
      out.sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))

      const held = new Map<string, Ticket[]>()
      for (const c of (certs.data ?? []) as Array<{ id: string; worker_id: string; name: string; expires_on: string | null }>) {
        if (!byWorker.has(c.worker_id)) continue
        held.set(c.worker_id, [...(held.get(c.worker_id) ?? []), { id: c.id, name: c.name, expiresOn: c.expires_on }])
      }
      // Anything lapsed or expiring rides at the front of its own row.
      for (const list of held.values()) {
        list.sort((a, b) => (a.expiresOn ?? '9999') < (b.expiresOn ?? '9999') ? -1 : 1)
      }

      setRows(out)
      setTickets(held)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [site.id])

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 16px 20px' }}>
      {rows.map((r, i) => {
        const held = tickets.get(r.id) ?? []
        return (
          <div key={r.id} style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 10, padding: '11px 13px 12px 15px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 10, boxShadow: '0 1px 2px rgba(16,20,24,.04)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: avatarGrey(i), color: '#fff', fontSize: 11.5, fontWeight: 700 }}>
                {r.initials}
                {r.onClock && (
                  <span style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: '50%', border: '2px solid #fff', background: '#4CC38A' }} />
                )}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em', color: s.ink }}>{r.name}</span>
                <span style={{ fontSize: 12.5, color: '#7B838B' }}>
                  {[r.trade, r.onClock ? `on since ${r.at}` : `booked ${r.at}`].filter(Boolean).join(' · ')}
                </span>
              </span>
            </span>

            {/* What this person is ticketed to do. A lapsed ticket is the
                whole point of showing them, so it colours itself. */}
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {held.length === 0 ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 11, background: TICKET_MISSING.bg, fontSize: 11.5, fontWeight: 700, color: TICKET_MISSING.fg }}>
                  No tickets on file
                </span>
              ) : (
                held.map((c) => {
                  const tone = ticketTone(c.expiresOn)
                  return (
                    <span
                      key={c.id}
                      style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 11, background: tone.bg, fontSize: 11.5, fontWeight: 700, color: tone.fg }}
                    >
                      {c.name}
                      {tone.suffix}
                    </span>
                  )
                })
              )}
            </span>
          </div>
        )
      })}
      {!loading && rows.length === 0 && (
        <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
          Nobody rostered here today. Whoever the office books, or the geofence
          clocks on, shows up here with the tickets they hold.
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------- the shell

/**
 * Same rule as Home: the suburb carries the line, unless the job is named
 * after its suburb — then the street does.
 */
const localeOf = (site: { name: string; address: string }) => {
  const m = site.address.match(/,\s*([^,\d]+?)\s+SA\b/)
  const suburb = m?.[1]?.trim()
  if (suburb && suburb !== site.name) return suburb
  const street = (site.address.split(',')[0] ?? '').trim()
  // An address that is just the job's own name carries no locale at all.
  return street.startsWith(site.name) ? '' : street
}

/** The drawing's status-dot palette. */
const DOT_TONE = {
  g: { dot: '#4CC38A', halo: 'rgba(76,195,138,.16)' },
  a: { dot: '#E9A23B', halo: 'rgba(233,162,59,.16)' },
  r: { dot: '#E5484D', halo: 'rgba(229,72,77,.16)' },
  n: { dot: '#8A929B', halo: 'rgba(138,146,155,.16)' },
} as const

export function JobScreen({
  me,
  site,
  progressPct,
  onSiteCount,
  floodHoldCount = 0,
  tone = 'n',
  chat,
  onBack,
  onTakePhoto,
  onAddInvoice,
  initialTab,
}: {
  me: WorkerRow
  site: JobSiteRow
  progressPct: number | null
  onSiteCount: number
  /** Covered wet areas with no flood test — turns the state line red. */
  floodHoldCount?: number
  /** The attention tone the shell computed for this job: drives the dot. */
  tone?: keyof typeof DOT_TONE
  /** The existing ChatScreen, rendered by the shell so its props stay there. */
  chat: (onClose: () => void) => React.ReactNode
  onBack: () => void
  onTakePhoto: () => void
  onAddInvoice: () => void
  initialTab?: JobTab
}) {
  const office = me.is_office
  const [tab, setTab] = useState<JobTab>(initialTab ?? 'photos')

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

  const sub = [localeOf(site), site.job_type, site.client_name].filter(Boolean).join(' · ')
  const { dot, halo } = DOT_TONE[tone]
  // The drawing's state line: the thing that needs you beats the tally, and a
  // job that has not started says when it will.
  const state =
    site.status === 'starting_soon'
      ? `${site.schedule_note || 'Starting soon'} · nobody on site`
      : floodHoldCount > 0
        ? `${onSiteCount} on site · flood test overdue`
        : `${onSiteCount} on site${progressPct !== null ? ` · ${Math.round(progressPct)}% done` : ''}`

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Charcoal header — 48px, back 44, camera 44. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4, height: `calc(48px + ${SAFE_TOP})`, padding: `${SAFE_TOP} 8px 0 4px`, background: '#2B2F33', color: '#fff' }}>
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

      <div style={{ flex: 1, minHeight: 0, background: '#F5F6F7', paddingBottom: SAFE_BOTTOM }}>
        {tab === 'photos' && <PhotoGrid me={me} site={site} onTakePhoto={onTakePhoto} />}
        {tab === 'plans' && <PlansScreen me={me} siteId={site.id} siteName={site.name} onClose={() => setTab('photos')} />}
        {tab === 'waterproofing' && <WaterproofingTab site={site} />}
        {tab === 'chat' && chat(() => setTab('photos'))}
        {tab === 'money' && office && <MoneyTab site={site} floodHoldCount={floodHoldCount} onAddInvoice={onAddInvoice} />}
        {tab === 'crew' && <CrewTab site={site} />}
      </div>
    </div>
  )
}
