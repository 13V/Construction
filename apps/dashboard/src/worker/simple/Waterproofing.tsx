/**
 * Waterproofing — the six steps a Certificate of Compliance is issued from.
 *
 * This screen is the client's, drawn by them and reproduced: a status card
 * with an n/6 ring, six numbered steps, a summary strip. The order is the
 * order the work happens in, which is also the order it gets argued about
 * afterwards — products, install date, flood test, builder sign-off,
 * certificates, photos.
 *
 * Why a package and not the wet areas: their certificate covers an apartment
 * ("waterproofing to bathroom + ensuite + wc + balcony + laundry"), carries
 * one number and one signature. The per-wet-area register in `waterproofing`
 * is the AS 3740 detail behind it and stays where it is — listed at the foot
 * of this sheet, because when a flood test is outstanding the next question is
 * always "which one".
 *
 * A job with no package yet still shows all six steps, empty. The row is
 * written on the first edit, the same way a scope line is: reading a checklist
 * should never need write access.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { BUCKET_FILES, objectPath, signedUrl, uploadFile } from '../../data/storage'
import { certificateNo, wpCertificatePdf, type CompanyDetails } from '../../data/documents'
import { viewFile } from './FileViewer'
import { s, SAFE_BOTTOM } from './stheme'

// ------------------------------------------------------------------- the data

export type FloodResult = 'not_completed' | 'pass' | 'fail'

export interface WpPackageRow {
  id: string
  unit: string | null
  product_internal: string | null
  product_external: string | null
  installed_on: string | null
  installed_by: string | null
  flood_test_on: string | null
  flood_test_result: FloodResult
  flood_test_hours: number | null
  builder_signed_name: string | null
  builder_signed_at: string | null
  certificate_no: string | null
  certificate_generated_at: string | null
  certificate_path: string | null
  certificate_sent_at: string | null
  certificate_sent_to: string | null
  scope_of_work: string | null
  completion_on: string | null
  warranty_years: number
}

const PKG_COLS =
  'id, unit, product_internal, product_external, installed_on, installed_by, flood_test_on, ' +
  'flood_test_result, flood_test_hours, builder_signed_name, builder_signed_at, certificate_no, ' +
  'certificate_generated_at, certificate_path, certificate_sent_at, certificate_sent_to, ' +
  'scope_of_work, completion_on, warranty_years'

export type StepKey = 'products' | 'install' | 'flood_test' | 'signoff' | 'certificates' | 'photos'

export interface WpFile {
  id: string
  name: string
  mime: string | null
  storage_path: string
  kind: 'photo' | 'document'
  category: string | null
  wp_step: StepKey | null
}

interface WetRow {
  id: string
  area: string
  status: string
  flood_tested: boolean
  completed_on: string | null
  flood_test_on: string | null
}

const LOCALE = 'en-AU'
const shortDate = (v: string | null) =>
  v ? new Date(`${v}T00:00:00`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Everything this screen reads, in one hook, so the button on Overview and the
 * sheet behind it cannot disagree about how many steps are done.
 */
export function useWaterproofing(site: JobSiteRow) {
  const [pkg, setPkg] = useState<WpPackageRow | null>(null)
  const [files, setFiles] = useState<WpFile[]>([])
  const [wet, setWet] = useState<WetRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const client = supabase()
    const { data: p } = await client
      .from('waterproofing_packages')
      .select(PKG_COLS)
      .eq('site_id', site.id)
      .order('created_at')
      .limit(1)
      .maybeSingle()
    const row = (p as WpPackageRow | null) ?? null
    const [f, w] = await Promise.all([
      row
        ? client
            .from('site_files')
            .select('id, name, mime, storage_path, kind, category, wp_step')
            .eq('waterproofing_package_id', row.id)
            .order('created_at')
        : Promise.resolve({ data: [] }),
      client
        .from('waterproofing')
        .select('id, area, status, flood_tested, completed_on, flood_test_on')
        .eq('site_id', site.id)
        .order('area'),
    ])
    setPkg(row)
    setFiles((f.data ?? []) as WpFile[])
    setWet((w.data ?? []) as WetRow[])
    setLoading(false)
  }, [site.id])

  useEffect(() => {
    void load()
  }, [load])

  const steps = useMemo(() => stepsOf(pkg, files), [pkg, files])
  const done = steps.filter((x) => x.state === 'complete').length
  const outstanding = steps.filter((x) => x.state !== 'complete')

  return { pkg, files, wet, loading, steps, done, outstanding, reload: load }
}

// ------------------------------------------------------------------ the steps

type StepState = 'complete' | 'required' | 'pending'

export interface Step {
  key: StepKey
  n: number
  title: string
  /** What the row says under its title, top line first. */
  lines: Array<{ text: string; tone?: 'green' | 'amber' }>
  state: StepState
  /** "12 photos" / "2 documents" — the client's own count line. */
  count: string | null
  countKind: 'photo' | 'document'
  /** Short name for the outstanding-item sentence. */
  short: string
}

const stepChip: Record<StepState, { label: string; bg: string; fg: string }> = {
  complete: { label: 'Complete', bg: '#EAF7EC', fg: '#1B7A2C' },
  required: { label: 'Required', bg: '#FFF4E5', fg: '#B26A00' },
  pending: { label: 'Pending', bg: '#F1F3F5', fg: '#6B7278' },
}

function countLabel(n: number, kind: 'photo' | 'document'): string | null {
  if (kind === 'photo') return n === 0 ? 'No photos yet' : `${n} photo${n === 1 ? '' : 's'}`
  return n === 0 ? 'No documents yet' : `${n} document${n === 1 ? '' : 's'}`
}

/**
 * The six rows, computed from the record rather than stored. "5/6 complete" is
 * then a fact about the paperwork instead of a number that can be left behind
 * by the next edit.
 */
export function stepsOf(pkg: WpPackageRow | null, files: WpFile[]): Step[] {
  const at = (k: StepKey) => files.filter((f) => f.wp_step === k)
  const photos = files.filter((f) => f.kind === 'photo')
  const hasCert = (cat: string) => files.some((f) => f.wp_step === 'certificates' && f.category === cat)
  const installerIssued = Boolean(pkg?.certificate_generated_at)
  const supplierWarranty = hasCert('supplier_warranty')

  const products: Step = {
    key: 'products',
    n: 1,
    title: 'Products Specified',
    lines: [
      { text: 'Products specified - internal and external' },
      ...(pkg?.product_internal ? [{ text: `Internal: ${pkg.product_internal}`, tone: 'green' as const }] : []),
      ...(pkg?.product_external ? [{ text: `External: ${pkg.product_external}`, tone: 'green' as const }] : []),
      ...(!pkg?.product_internal && !pkg?.product_external ? [{ text: 'Not specified yet' }] : []),
    ],
    state: pkg?.product_internal && pkg?.product_external ? 'complete' : 'required',
    count: countLabel(at('products').length, 'document'),
    countKind: 'document',
    short: 'products',
  }

  const install: Step = {
    key: 'install',
    n: 2,
    title: 'Date Installed',
    lines: pkg?.installed_on
      ? [{ text: shortDate(pkg.installed_on) }, { text: `Installed by: ${pkg.installed_by ?? 'not recorded'}` }]
      : [{ text: 'Membrane not recorded as installed' }],
    state: pkg?.installed_on ? 'complete' : 'required',
    count: countLabel(at('install').length, 'photo'),
    countKind: 'photo',
    short: 'install date',
  }

  const flood: Step = {
    key: 'flood_test',
    n: 3,
    title: 'Flood Test',
    lines: [
      { text: pkg?.flood_test_on ? `Test date: ${shortDate(pkg.flood_test_on)}` : 'No test date set' },
      {
        text: `Status: ${
          pkg?.flood_test_result === 'pass' ? 'Passed' : pkg?.flood_test_result === 'fail' ? 'FAILED' : 'Not completed'
        }`,
        tone: pkg?.flood_test_result === 'pass' ? 'green' : 'amber',
      },
    ],
    state: pkg?.flood_test_result === 'pass' ? 'complete' : 'required',
    count: countLabel(at('flood_test').length, 'photo'),
    countKind: 'photo',
    short: 'flood test',
  }

  const signoff: Step = {
    key: 'signoff',
    n: 4,
    title: 'Builder Sign-off',
    lines: [
      { text: 'Builder to sign off waterproofing' },
      pkg?.builder_signed_at
        ? { text: `Signed by ${pkg.builder_signed_name ?? 'the builder'}`, tone: 'green' }
        : { text: 'Not signed' },
    ],
    state: pkg?.builder_signed_at ? 'complete' : 'pending',
    count: null,
    countKind: 'document',
    short: 'builder sign-off',
  }

  const certificates: Step = {
    key: 'certificates',
    n: 5,
    title: 'Certificates',
    lines: [
      { text: 'Installer Warranty Certificate', tone: installerIssued ? 'green' : undefined },
      { text: 'Supplier Warranty Certificate', tone: supplierWarranty ? 'green' : undefined },
    ],
    state: installerIssued && supplierWarranty ? 'complete' : 'pending',
    count: countLabel(at('certificates').length, 'document'),
    countKind: 'document',
    short: 'certificates',
  }

  const photoStep: Step = {
    key: 'photos',
    n: 6,
    title: 'Photos',
    lines: [{ text: 'All waterproofing photos' }],
    state: photos.length > 0 ? 'complete' : 'required',
    count: countLabel(photos.length, 'photo'),
    countKind: 'photo',
    short: 'photos',
  }

  return [products, install, flood, signoff, certificates, photoStep]
}

/** The brand both products share, for the summary strip's "Mapei System". */
function systemOf(pkg: WpPackageRow | null): { name: string; scope: string } | null {
  const inner = pkg?.product_internal?.trim()
  const outer = pkg?.product_external?.trim()
  if (!inner && !outer) return null
  const brand = (inner ?? outer ?? '').split(/\s+/)[0]
  const same = Boolean(inner && outer && inner.split(/\s+/)[0] === outer.split(/\s+/)[0])
  return {
    name: same || !outer || !inner ? `${brand} System` : 'Mixed system',
    scope: inner && outer ? 'Internal & External' : inner ? 'Internal only' : 'External only',
  }
}

// ------------------------------------------------------------------- the ring

/**
 * n of six, as a ring. Green for what is done and amber for what is not, so
 * the shape carries the message before the number is read.
 */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const R = 29
  const C = 2 * Math.PI * R
  const frac = total === 0 ? 0 : done / total
  const green = C * frac
  const amber = C - green

  /**
   * Two things were wrong with this ring, and both showed worst at 0 of 6.
   *
   * The amber arc was drawn at cx/cy 33 while everything else moved to 37 when
   * the ring grew — so it sat four pixels off centre and the two arcs did not
   * share a circle. And a zero-length arc with a round cap is not nothing, it
   * is a dot: at 0 complete that put a green pip on top of an all-amber ring.
   *
   * Now both arcs come from one function, an arc with no length is not drawn,
   * and a full circle loses its caps so they do not overlap at the join.
   */
  const arc = (colour: string, length: number, offset: number) =>
    length < 0.5 ? null : (
      <circle
        cx="37"
        cy="37"
        r={R}
        fill="none"
        stroke={colour}
        strokeWidth="6"
        strokeLinecap={length >= C - 0.5 ? 'butt' : 'round'}
        strokeDasharray={`${length} ${C}`}
        strokeDashoffset={offset}
      />
    )

  return (
    <span style={{ position: 'relative', flex: 'none', width: 74, height: 74 }}>
      <svg width="74" height="74" viewBox="0 0 74 74" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="37" cy="37" r={R} fill="none" stroke="#E6E9EC" strokeWidth="6" />
        {arc('#E08600', amber, -green)}
        {arc('#1B7A2C', green, 0)}
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', color: s.ink, lineHeight: 1 }}>
          {done}
          <span style={{ fontSize: 11, fontWeight: 700, color: '#7B838B' }}>/{total}</span>
        </span>
        <span style={{ marginTop: 2, fontSize: 8.5, fontWeight: 600, letterSpacing: '.02em', color: '#7B838B' }}>Complete</span>
      </span>
    </span>
  )
}

// --------------------------------------------------------------- the furniture

const STEP_ICON: Record<StepKey, ReactNode> = {
  products: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#1B7A2C" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M3.2 6.4L10 3.4l6.8 3v7.2L10 16.6l-6.8-3z" />
      <path d="M3.2 6.4L10 9.4l6.8-3M10 9.4v7.2" />
    </svg>
  ),
  install: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#2F5FD7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <rect x="3.2" y="4.6" width="13.6" height="12" rx="2" />
      <path d="M3.2 8.2h13.6M6.8 3.2v2.8M13.2 3.2v2.8" />
    </svg>
  ),
  flood_test: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#C4700A" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 7.2c1.4-1.4 2.8-1.4 4.2 0s2.8 1.4 4.2 0 2.8-1.4 4.2 0" />
      <path d="M3 10.6c1.4-1.4 2.8-1.4 4.2 0s2.8 1.4 4.2 0 2.8-1.4 4.2 0" />
      <path d="M3 14c1.4-1.4 2.8-1.4 4.2 0s2.8 1.4 4.2 0 2.8-1.4 4.2 0" />
    </svg>
  ),
  signoff: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#6E56CF" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <circle cx="10" cy="7" r="3" />
      <path d="M4.4 16.6a5.6 5.6 0 0 1 11.2 0" />
    </svg>
  ),
  certificates: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#0E8074" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M4.6 3.4h8l3 3v10H4.6z" />
      <path d="M7.2 7.6h4M7.2 10.4h5.6" />
      <circle cx="13.4" cy="14" r="2.1" />
    </svg>
  ),
  photos: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#2F5FD7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <rect x="2.8" y="5.6" width="14.4" height="10.2" rx="2" />
      <circle cx="10" cy="10.7" r="2.7" />
      <path d="M7.4 5.6l1-1.8h3.2l1 1.8" />
    </svg>
  ),
}

const STEP_TILE: Record<StepKey, string> = {
  products: '#E8F6EC',
  install: '#E7EEFB',
  flood_test: '#FDF0DF',
  signoff: '#EFEBFB',
  certificates: '#E4F3F1',
  photos: '#E7EEFB',
}

const card = { background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, overflow: 'hidden' } as const
const sectionLabel = {
  display: 'block',
  padding: '17px 16px 8px',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.12em',
  color: '#7B838B',
} as const
const chevron = (
  <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
    <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const closeGlyph = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
)
const tick = (colour: string) => (
  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke={colour} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
    <circle cx="10" cy="10" r="7.6" strokeWidth="1.7" />
    <path d="M6.6 10.2l2.4 2.3 4.4-4.6" />
  </svg>
)

const field = {
  width: '100%',
  height: 48,
  padding: '0 13px',
  boxSizing: 'border-box' as const,
  background: '#F5F6F7',
  border: '1px solid #DCE0E6',
  borderRadius: 10,
  font: 'inherit',
  fontSize: 16,
  color: s.ink,
  outline: 'none',
}
const fieldLabel = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' } as const
const primaryBtn = {
  width: '100%',
  height: 48,
  border: 0,
  borderRadius: 10,
  background: '#1A1D21',
  fontFamily: 'inherit',
  fontSize: 14.5,
  fontWeight: 700,
  letterSpacing: '.03em',
  color: '#fff',
  cursor: 'pointer',
} as const
const ghostBtn = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
  height: 46,
  boxSizing: 'border-box' as const,
  border: '1px solid #DCE0E6',
  borderRadius: 10,
  background: '#fff',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  color: s.accent,
  cursor: 'pointer',
} as const

// ------------------------------------------------------------------ the button

/**
 * Waterproofing on the Overview page: one card that says how far the
 * paperwork is and turns red when the thing holding the claim is outstanding.
 */
export function WaterproofingButton({ site, onOpen }: { site: JobSiteRow; onOpen: () => void }) {
  const { pkg, loading, done, outstanding, wet } = useWaterproofing(site)

  // A flood test that has not passed after the membrane went on is the one
  // thing here that stops money, so it is the only state that shouts.
  const covered = Boolean(pkg?.installed_on) || wet.some((r) => r.status === 'complete' || r.status === 'signed_off')
  const alarm = covered && (pkg ? pkg.flood_test_result !== 'pass' : wet.some((r) => !r.flood_tested))

  const line = loading
    ? ' '
    : !pkg && wet.length === 0
      ? 'Nothing recorded yet'
      : !pkg
        ? `${wet.length} wet area${wet.length === 1 ? '' : 's'} · no record started`
        : pkg.certificate_sent_at
          ? `Certificate sent ${shortDate(pkg.certificate_sent_at.slice(0, 10))}`
          : done === 6
            ? 'All 6 steps complete'
            : `${done}/6 complete · ${outstanding[0]?.short ?? ''} outstanding`

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        margin: '0 18px',
        padding: '15px 15px 15px 16px',
        borderRadius: 12,
        background: alarm ? '#FFF6F6' : '#fff',
        border: `1px solid ${alarm ? '#F3C9CC' : '#E1E5E9'}`,
        boxShadow: '0 1px 2px rgba(16,20,24,.05)',
        cursor: 'pointer',
      }}
    >
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 12, background: alarm ? '#FDE7E8' : '#E7F1FB' }}>
        <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke={alarm ? '#A3282E' : '#2F5FD7'} strokeWidth="1.6" strokeLinejoin="round">
          <path d="M10 3.2c2.7 3.1 4.5 5.2 4.5 7.5a4.5 4.5 0 0 1-9 0c0-2.3 1.8-4.4 4.5-7.5z" />
        </svg>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: '-.01em', color: s.ink }}>Waterproofing</span>
        <span style={{ fontSize: 13, color: alarm ? '#A3282E' : '#7B838B', fontWeight: alarm ? 600 : 400 }}>{line}</span>
      </span>
      {chevron}
    </div>
  )
}

// ------------------------------------------------------------------- the sheet

/**
 * The whole waterproofing record as its own sheet over the job — the client's
 * page, top to bottom: where it is up to, the six steps, what the certificate
 * will say, and the wet areas it covers.
 */
export function WaterproofingPanel({ me, site }: { me: WorkerRow; site: JobSiteRow }) {
  const wp = useWaterproofing(site)
  const { pkg, files, wet, loading, steps, done, outstanding } = wp
  const [step, setStep] = useState<StepKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * The row is created on the first edit rather than on open: a foreman
   * reading the checklist should not be writing to the database, and a job
   * that never had waterproofing should not collect an empty record.
   *
   * The scope of work is seeded from the wet areas already on the job, because
   * that sentence is exactly what the certificate has to carry and retyping it
   * is how it ends up wrong.
   */
  const ensurePackage = useCallback(async (): Promise<WpPackageRow | null> => {
    if (pkg) return pkg
    const areas = wet.map((r) => r.area.toLowerCase())
    const { data, error: err } = await supabase()
      .from('waterproofing_packages')
      .insert({
        company_id: me.company_id,
        site_id: site.id,
        scope_of_work: areas.length ? `waterproofing to ${areas.join(' + ')}` : null,
        created_by: me.id,
      })
      .select(PKG_COLS)
      .single()
    if (err) {
      setError(err.message)
      return null
    }
    return data as unknown as WpPackageRow
  }, [pkg, wet, me.company_id, me.id, site.id])

  /** Every step sheet saves through here, so every save reloads the same way. */
  const patch = useCallback(
    async (values: Record<string, unknown>) => {
      setError(null)
      const row = await ensurePackage()
      if (!row) return false
      const { error: err } = await supabase().from('waterproofing_packages').update(values).eq('id', row.id)
      if (err) {
        setError(err.message)
        return false
      }
      await wp.reload()
      return true
    },
    [ensurePackage, wp],
  )

  const system = systemOf(pkg)
  const certCount = files.filter((f) => f.wp_step === 'certificates').length
  const allDone = done === 6

  return (
    <>
        <div>
          {error && (
            <span style={{ display: 'block', margin: '12px 16px 0', padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>
          )}

          {/* ------------------------------------------------- status card */}
          <span style={sectionLabel}>WATERPROOFING STATUS</span>
          <div style={{ margin: '0 16px', ...card, display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px' }}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {loading ? (
                <span style={{ fontSize: 15, color: '#7B838B' }}>Loading…</span>
              ) : allDone ? (
                <>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {tick('#1B7A2C')}
                    <span style={{ fontSize: 17.5, fontWeight: 800, letterSpacing: '-.015em', color: '#1B7A2C' }}>All complete</span>
                  </span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, color: '#4A5057' }}>
                    {pkg?.certificate_sent_at ? 'Certificate issued and sent to the builder.' : 'Ready to issue the certificate.'}
                  </span>
                </>
              ) : (
                <>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="20" height="20" viewBox="0 0 20 20" style={{ flex: 'none' }}>
                      <circle cx="10" cy="10" r="9" fill="#E08600" />
                      <path d="M10 5.4v5.2M10 13.4v.9" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span style={{ fontSize: 17.5, fontWeight: 800, letterSpacing: '-.015em', color: '#B26A00' }}>
                      {outstanding.length} item{outstanding.length === 1 ? '' : 's'} outstanding
                    </span>
                  </span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, color: '#4A5057' }}>{outstandingLine(outstanding)}</span>
                </>
              )}
            </span>
            <ProgressRing done={done} total={6} />
          </div>

          {/* --------------------------------------------------- the steps */}
          <div style={{ margin: '14px 16px 0', ...card }}>
            {steps.map((st, i) => (
              <StepRow key={st.key} step={st} last={i === steps.length - 1} onOpen={() => setStep(st.key)} />
            ))}
          </div>

          {/* ------------------------------------------------- the summary */}
          <span style={sectionLabel}>WATERPROOFING SUMMARY</span>
          <div style={{ margin: '0 16px', ...card, display: 'flex', alignItems: 'stretch', padding: '13px 0' }}>
            <SummaryCell
              label="Installed"
              value={pkg?.installed_on ? shortDate(pkg.installed_on) : '—'}
              sub={pkg?.installed_by ? `by ${pkg.installed_by}` : 'not recorded'}
              glyph={STEP_ICON.install}
            />
            <span style={{ flex: 'none', width: 1, margin: '2px 0', background: '#EDEFF1' }} />
            <SummaryCell
              label="System"
              value={system?.name ?? '—'}
              sub={system?.scope ?? 'no products specified'}
              tone={system ? '#1F7A4D' : undefined}
              glyph={
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="#8B9096" strokeWidth="1.5" strokeLinejoin="round">
                  <path d="M10 3.4c2.5 2.9 4.2 4.9 4.2 7a4.2 4.2 0 0 1-8.4 0c0-2.1 1.7-4.1 4.2-7z" />
                </svg>
              }
            />
            <span style={{ flex: 'none', width: 1, margin: '2px 0', background: '#EDEFF1' }} />
            <SummaryCell
              label="Warranty"
              value={pkg?.certificate_generated_at ? 'Available' : '—'}
              sub={certCount === 0 ? 'no certificates' : `${certCount} certificate${certCount === 1 ? '' : 's'}`}
              tone={pkg?.certificate_generated_at ? '#1F7A4D' : undefined}
              glyph={
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="#8B9096" strokeWidth="1.5" strokeLinejoin="round">
                  <path d="M10 3.2l5.4 2v4.6c0 3.2-2.3 5.6-5.4 6.6-3.1-1-5.4-3.4-5.4-6.6V5.2z" />
                </svg>
              }
            />
          </div>

          {/* ------------------------------------------------- the wet areas */}
          {wet.length > 0 && (
            <>
              <span style={sectionLabel}>WET AREAS COVERED</span>
              <div style={{ margin: '0 16px', ...card }}>
                {wet.map((r, i) => {
                  const c = wetChip(r)
                  return (
                    <span key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderBottom: i === wet.length - 1 ? 0 : '1px solid #EDEFF1' }}>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-.005em', color: s.ink }}>{r.area}</span>
                        <span style={{ fontSize: 12.5, lineHeight: 1.35, color: '#7B838B' }}>{wetLine(r)}</span>
                      </span>
                      <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 11, background: c.bg, color: c.fg, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {c.label}
                      </span>
                    </span>
                  )
                })}
              </div>
              <span style={{ display: 'block', padding: '9px 18px 0', fontSize: 12, lineHeight: 1.5, color: '#8B9096' }}>
                The areas this certificate covers, as recorded on the job. The scope of work on the
                certificate is written from these.
              </span>
            </>
          )}

          {!loading && !pkg && wet.length === 0 && (
            <span style={{ display: 'block', margin: '14px 16px 0', padding: '14px 15px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, fontSize: 13, lineHeight: 1.5, color: '#7B838B' }}>
              Nothing is recorded on this job yet. Fill in a step above and the record starts itself —
              the certificate is generated from what is on these six lines.
            </span>
          )}
        </div>

      {step && (
        <StepSheet
          stepKey={step}
          me={me}
          site={site}
          pkg={pkg}
          files={files}
          wet={wet}
          onClose={() => setStep(null)}
          onPatch={patch}
          ensurePackage={ensurePackage}
          reload={wp.reload}
        />
      )}
    </>
  )
}

/** "Flood test needs to be completed." — name it, do not just count it. */
function outstandingLine(outstanding: Step[]): string {
  if (outstanding.length === 0) return 'Everything on this record is done.'
  const first = outstanding[0]
  const rest = outstanding.length - 1
  const what =
    first.key === 'flood_test'
      ? 'Flood test needs to be completed.'
      : first.key === 'signoff'
        ? 'The builder still has to sign off.'
        : first.key === 'certificates'
          ? 'The certificates are not issued yet.'
          : first.key === 'products'
            ? 'The products have not been specified.'
            : first.key === 'install'
              ? 'The install date is not recorded.'
              : 'No waterproofing photos on file.'
  return rest > 0 ? `${what} ${rest} more after that.` : what
}

function SummaryCell({ label, value, sub, glyph, tone }: { label: string; value: string; sub: string; glyph: ReactNode; tone?: string }) {
  return (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 11px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ flex: 'none', display: 'flex', width: 17, height: 17, opacity: 0.75 }}>{glyph}</span>
        <span style={{ fontSize: 11.5, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-.01em', color: tone ?? s.ink, lineHeight: 1.25 }}>{value}</span>
      <span style={{ fontSize: 11, lineHeight: 1.3, color: '#8B9096' }}>{sub}</span>
    </span>
  )
}

/** One numbered step, as drawn: tile, title, its facts, its chip, its count. */
function StepRow({ step, last, onOpen }: { step: Step; last: boolean; onOpen: () => void }) {
  const chip = stepChip[step.state]
  return (
    <span
      onClick={onOpen}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 13px 13px 14px', borderBottom: last ? 0 : '1px solid #EDEFF1', cursor: 'pointer' }}
    >
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, marginTop: 1, borderRadius: 10, background: STEP_TILE[step.key] }}>
        {STEP_ICON[step.key]}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-.01em', color: s.ink }}>
          {step.n}. {step.title}
        </span>
        {step.lines.map((l, i) => (
          <span
            key={i}
            style={{
              fontSize: 12.5,
              lineHeight: 1.35,
              color: l.tone === 'green' ? '#1B7A2C' : l.tone === 'amber' ? '#B26A00' : '#7B838B',
              fontWeight: l.tone ? 600 : 400,
            }}
          >
            {step.key === 'certificates' && <span style={{ color: l.tone === 'green' ? '#1B7A2C' : '#B7BCC2' }}>{l.tone === 'green' ? '✓ ' : '○ '}</span>}
            {l.text}
          </span>
        ))}
        {step.count && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 12.5, fontWeight: 600, color: s.accent }}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.6" strokeLinejoin="round">
              {step.countKind === 'photo' ? (
                <>
                  <rect x="2.8" y="4.6" width="14.4" height="10.8" rx="2" />
                  <path d="M2.8 12.4l4-3.4 3.4 2.8 2.6-2.2 4.4 3.6" />
                </>
              ) : (
                <>
                  <path d="M5.4 3.4h6l3.2 3.2v10H5.4z" />
                  <path d="M7.8 8.4h4.4M7.8 11.4h4.4" />
                </>
              )}
            </svg>
            {step.count}
          </span>
        )}
      </span>
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 23, padding: '0 9px', borderRadius: 12, background: chip.bg, color: chip.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {step.state === 'complete' && (
            <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke={chip.fg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.4 10.4l3.4 3.2 7.8-8" />
            </svg>
          )}
          {step.state === 'required' && (
            <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke={chip.fg} strokeWidth="1.8" strokeLinecap="round">
              <circle cx="10" cy="10" r="7.4" />
              <path d="M10 6.2v4.4M10 13.2v.9" />
            </svg>
          )}
          {step.state === 'pending' && (
            <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke={chip.fg} strokeWidth="1.8" strokeLinecap="round">
              <circle cx="10" cy="10" r="7.4" />
              <path d="M10 6.2V10l2.6 1.8" />
            </svg>
          )}
          {chip.label}
        </span>
        {chevron}
      </span>
    </span>
  )
}

/**
 * A covered wet area with no flood test is the thing that holds up every claim
 * on the job, so it says so rather than reading "complete".
 */
function wetChip(r: WetRow) {
  const covered = r.status === 'complete' || r.status === 'signed_off'
  if (covered && !r.flood_tested) return { label: 'Flood test overdue', bg: '#FDECEE', fg: '#A3282E' }
  if (r.status === 'signed_off') return { label: 'Signed off', bg: '#EAF6EF', fg: '#1F7A4D' }
  if (r.status === 'failed') return { label: 'Failed', bg: '#FDECEE', fg: '#A3282E' }
  if (r.status === 'complete') return { label: 'Flood tested', bg: '#EAF6EF', fg: '#1F7A4D' }
  return { label: 'In progress', bg: '#FFF6E3', fg: '#8A6100' }
}

/**
 * A flood-test date on an area that has not been tested is the date it is DUE,
 * not the date it happened — printing it as the latter is how a record comes to
 * report the opposite of the truth.
 */
function wetLine(r: WetRow) {
  if (r.flood_tested) return r.flood_test_on ? `Flood tested ${shortDate(r.flood_test_on)}` : 'Flood tested'
  if (r.completed_on) {
    const due = r.flood_test_on ? `, due ${shortDate(r.flood_test_on)}` : ''
    return `Covered ${shortDate(r.completed_on)} · no flood test${due}`
  }
  return 'Membrane not finished'
}

// ------------------------------------------------------------ the step sheets

const STEP_TITLE: Record<StepKey, string> = {
  products: 'Products Specified',
  install: 'Date Installed',
  flood_test: 'Flood Test',
  signoff: 'Builder Sign-off',
  certificates: 'Certificates',
  photos: 'Photos',
}

/**
 * One step, open. Each is a short form and its evidence — and the evidence is
 * the point: "every one of them would require multiple uploads and attach PDF".
 * So the same uploader appears on every step, taking photos from the camera or
 * files from the phone, as many as they like.
 */
function StepSheet({
  stepKey,
  me,
  site,
  pkg,
  files,
  wet,
  onClose,
  onPatch,
  ensurePackage,
  reload,
}: {
  stepKey: StepKey
  me: WorkerRow
  site: JobSiteRow
  pkg: WpPackageRow | null
  files: WpFile[]
  wet: WetRow[]
  onClose: () => void
  onPatch: (values: Record<string, unknown>) => Promise<boolean>
  ensurePackage: () => Promise<WpPackageRow | null>
  reload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // step 1
  const [inner, setInner] = useState(pkg?.product_internal ?? '')
  const [outer, setOuter] = useState(pkg?.product_external ?? '')
  // step 2
  const [installedOn, setInstalledOn] = useState(pkg?.installed_on ?? '')
  const [installedBy, setInstalledBy] = useState(pkg?.installed_by ?? '')
  // step 3
  const [testOn, setTestOn] = useState(pkg?.flood_test_on ?? '')
  const [hours, setHours] = useState(pkg?.flood_test_hours ? String(pkg.flood_test_hours) : '24')
  // step 4
  const [builderName, setBuilderName] = useState(pkg?.builder_signed_name ?? '')

  const mine = files.filter((f) => f.wp_step === stepKey)
  const allPhotos = files.filter((f) => f.kind === 'photo')
  // site_files DELETE is office-only under RLS, so a crew member's × would
  // always be refused — better not to draw a control that always lies.
  const canRemove = me.is_office

  /**
   * Uploads land in site_files against the package and the step, so a data
   * sheet on Products never turns up in the flood-test photos and none of them
   * turn up in the job's Photos grid — that screen asks for kind='photo' with
   * no package, which is the day's site photos and nothing else.
   */
  async function attach(list: FileList, category: string | null = null) {
    setBusy(true)
    setError(null)
    try {
      const row = await ensurePackage()
      if (!row) return
      const client = supabase()
      for (const file of Array.from(list)) {
        const path = objectPath(me.company_id, site.id, file.name)
        await uploadFile(BUCKET_FILES, path, file)
        const isImage = /^image\//.test(file.type)
        const { error: err } = await client.from('site_files').insert({
          company_id: me.company_id,
          site_id: site.id,
          waterproofing_package_id: row.id,
          wp_step: stepKey === 'photos' ? 'install' : stepKey,
          uploaded_by: me.id,
          kind: isImage ? 'photo' : 'document',
          category,
          storage_path: path,
          name: file.name,
          mime: file.type || null,
          size_bytes: file.size,
        })
        if (err) throw new Error(err.message)
      }
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach that file.')
    } finally {
      setBusy(false)
    }
  }

  async function removeFileRow(id: string) {
    // A refused DELETE still matches zero rows rather than erroring, and
    // PostgREST reports that as success — so the row coming back is the only
    // proof it actually went, same shape as the pin close in PlansScreen.
    const { data, error: err } = await supabase().from('site_files').delete().eq('id', id).select('id')
    if (err || !data || data.length === 0) {
      setError(err?.message ?? 'That did not delete. Tell the office.')
      return
    }
    await reload()
  }

  const save = async (values: Record<string, unknown>) => {
    setBusy(true)
    const ok = await onPatch(values)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.5)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 17px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: STEP_TILE[stepKey] }}>
            {STEP_ICON[stepKey]}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>{STEP_TITLE[stepKey]}</span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            {closeGlyph}
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `15px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          {/* The scroller must not be the flex column itself: a card taller
              than the space left would shrink instead of scrolling, which cut
              the certificate details off mid-list. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>}

          {stepKey === 'products' && (
            <>
              <Field label="INTERNAL — WET AREAS INSIDE" value={inner} onChange={setInner} placeholder="Mapei Mapelastic AquaDefense" />
              <Field label="EXTERNAL — BALCONIES AND DECKS" value={outer} onChange={setOuter} placeholder="Mapei Mapelastic Smart" />
              <Note>
                What goes on the certificate and what the supplier warranty is written against. The
                product data sheets belong here too — a builder's handover file asks for them.
              </Note>
              <Uploader label="Attach data sheet or photo" busy={busy} onFiles={(l) => void attach(l)} />
              <FileList files={mine} onRemove={canRemove ? (id) => void removeFileRow(id) : undefined} />
              <button
                disabled={busy}
                onClick={() => void save({ product_internal: inner.trim() || null, product_external: outer.trim() || null })}
                style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'SAVING…' : 'SAVE PRODUCTS'}
              </button>
            </>
          )}

          {stepKey === 'install' && (
            <>
              <Field label="DATE INSTALLED" value={installedOn} onChange={setInstalledOn} type="date" />
              <Field label="INSTALLED BY" value={installedBy} onChange={setInstalledBy} placeholder="Proven Tiling Solutions" />
              <Note>
                The date the membrane went on. Photographs taken before it was covered are the only
                evidence that survives the tiler — take more than you think you need.
              </Note>
              <Uploader label="Add membrane photos" busy={busy} camera onFiles={(l) => void attach(l)} />
              <FileList files={mine} onRemove={canRemove ? (id) => void removeFileRow(id) : undefined} />
              <button
                disabled={busy}
                onClick={() => void save({ installed_on: installedOn || null, installed_by: installedBy.trim() || null })}
                style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'SAVING…' : 'SAVE INSTALL DETAILS'}
              </button>
            </>
          )}

          {stepKey === 'flood_test' && (
            <>
              <Field label="TEST DATE" value={testOn} onChange={setTestOn} type="date" />
              <Field label="HELD FOR (HOURS)" value={hours} onChange={setHours} type="number" placeholder="24" />
              <Note>
                AS 3740 clause 3.7 wants the water held and the result recorded. Until this passes,
                nothing on the job can be claimed — which is why it is the one step that turns the
                Overview card red.
              </Note>
              <Uploader label="Add flood test photos" busy={busy} camera onFiles={(l) => void attach(l)} />
              <FileList files={mine} onRemove={canRemove ? (id) => void removeFileRow(id) : undefined} />
              {pkg?.flood_test_result !== 'not_completed' && pkg && (
                <span style={{ padding: '11px 13px', background: pkg.flood_test_result === 'pass' ? '#EAF7EC' : '#FDECEE', borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: pkg.flood_test_result === 'pass' ? '#1B7A2C' : '#A3282E' }}>
                  Recorded as {pkg.flood_test_result === 'pass' ? 'PASSED' : 'FAILED'}
                  {pkg.flood_test_on ? ` on ${shortDate(pkg.flood_test_on)}` : ''}.
                </span>
              )}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void save({
                      flood_test_on: testOn || todayISO(),
                      flood_test_hours: Number(hours) || null,
                      flood_test_result: 'pass',
                    })
                  }
                  style={{ ...primaryBtn, background: '#1B7A2C', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? 'SAVING…' : 'RECORD A PASS'}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void save({ flood_test_on: testOn || todayISO(), flood_test_hours: Number(hours) || null, flood_test_result: 'fail' })}
                  style={{ ...ghostBtn, color: '#A3282E', borderColor: '#F3C9CC' }}
                >
                  Record a fail
                </button>
                <button disabled={busy} onClick={() => void save({ flood_test_on: testOn || null })} style={ghostBtn}>
                  {testOn ? 'Just save the test date' : 'Schedule the flood test'}
                </button>
              </span>
            </>
          )}

          {stepKey === 'signoff' && (
            <>
              <Field label="BUILDER'S NAME" value={builderName} onChange={setBuilderName} placeholder="Who inspected it" />
              <Note>
                What they are acknowledging: that they inspected the waterproofing before tiling
                started. Their written signature goes on the printed certificate — this records who
                it was and when, on the day, while they are standing there.
              </Note>
              {pkg?.builder_signed_at && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', background: '#EAF7EC', borderRadius: 10, fontSize: 13.5, color: '#1B7A2C' }}>
                  {tick('#1B7A2C')}
                  Signed by {pkg.builder_signed_name ?? 'the builder'} on{' '}
                  {new Date(pkg.builder_signed_at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
              <button
                disabled={busy || !builderName.trim()}
                onClick={() => void save({ builder_signed_name: builderName.trim(), builder_signed_at: new Date().toISOString() })}
                style={{ ...primaryBtn, opacity: busy || !builderName.trim() ? 0.5 : 1 }}
              >
                {busy ? 'SAVING…' : 'RECORD THE SIGN-OFF'}
              </button>
              {pkg?.builder_signed_at && (
                <button disabled={busy} onClick={() => void save({ builder_signed_name: null, builder_signed_at: null })} style={ghostBtn}>
                  Clear the sign-off
                </button>
              )}
            </>
          )}

          {stepKey === 'certificates' && (
            <CertificateStep
              me={me}
              site={site}
              pkg={pkg}
              files={files}
              wet={wet}
              busy={busy}
              onPatch={onPatch}
              onAttach={(l, cat) => attach(l, cat)}
              onRemove={(id) => void removeFileRow(id)}
            />
          )}

          {stepKey === 'photos' && (
            <>
              <Note>
                Every waterproofing photo on this job, whichever step it was taken for. This is the
                set that goes with the certificate.
              </Note>
              <Uploader label="Add photos" busy={busy} camera onFiles={(l) => void attach(l)} />
              {allPhotos.length === 0 ? (
                <span style={{ padding: '14px 15px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, fontSize: 13, lineHeight: 1.5, color: '#7B838B' }}>
                  No waterproofing photos yet.
                </span>
              ) : (
                <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                  {allPhotos.map((f) => (
                    <PhotoTile key={f.id} file={f} onRemove={canRemove ? () => void removeFileRow(f.id) : undefined} />
                  ))}
                </span>
              )}
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ the pieces

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'date' | 'number'
}) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={fieldLabel}>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={field} />
    </span>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>{children}</span>
}

/**
 * One control, two ways in: the camera for what is in front of you, the file
 * picker for a PDF that came by email. Both accept several at once.
 */
function Uploader({ label, busy, camera, onFiles }: { label: string; busy: boolean; camera?: boolean; onFiles: (l: FileList) => void }) {
  return (
    <span style={{ display: 'flex', gap: 9 }}>
      {camera && (
        <label style={{ ...ghostBtn, flex: 'none', width: 54, padding: 0 }}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.length) onFiles(e.target.files)
              e.target.value = ''
            }}
            style={{ display: 'none' }}
          />
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
            <rect x="2.6" y="5.4" width="14.8" height="10.4" rx="2" />
            <circle cx="10" cy="10.6" r="2.8" />
            <path d="M7.2 5.4l1-1.8h3.6l1 1.8" />
          </svg>
        </label>
      )}
      <label style={{ ...ghostBtn, flex: 1, opacity: busy ? 0.6 : 1 }}>
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files)
            e.target.value = ''
          }}
          style={{ display: 'none' }}
        />
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 4v12M4 10h12" />
        </svg>
        {busy ? 'Uploading…' : label}
      </label>
    </span>
  )
}

function FileList({ files, onRemove }: { files: WpFile[]; onRemove?: (id: string) => void }) {
  if (files.length === 0) return null
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {files.map((f) => (
        <AttachmentTile key={f.id} file={f} onRemove={onRemove ? () => onRemove(f.id) : undefined} />
      ))}
    </span>
  )
}

/** One attached file: a thumbnail if it is an image, its name either way. */
function AttachmentTile({ file, onRemove }: { file: WpFile; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const isImage = /^image\//.test(file.mime ?? '') || /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i.test(file.name)

  useEffect(() => {
    let cancelled = false
    void signedUrl(BUCKET_FILES, file.storage_path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [file.storage_path])

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: '#fff', border: '1px solid #E7EAEE' }}>
      <span
        onClick={() => viewFile({ url, name: file.name })}
        style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 7, overflow: 'hidden', background: isImage ? '#E4E7EA' : '#EEF1F4', cursor: 'pointer' }}
      >
        {isImage && url ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.03em', color: '#5F666E' }}>{(file.name.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase()}</span>
        )}
      </span>
      <span onClick={() => viewFile({ url, name: file.name })} style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: s.ink, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.name}
      </span>
      {onRemove && (
        <span onClick={onRemove} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, cursor: 'pointer' }}>
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="#9AA1A9" strokeWidth="2" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </span>
      )}
    </span>
  )
}

function PhotoTile({ file, onRemove }: { file: WpFile; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void signedUrl(BUCKET_FILES, file.storage_path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [file.storage_path])
  return (
    <span style={{ position: 'relative', display: 'block', aspectRatio: '1', borderRadius: 9, overflow: 'hidden', background: '#E4E7EA' }}>
      {url && (
        <img
          src={url}
          alt=""
          onClick={() => viewFile({ url, name: file.name })}
          style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
        />
      )}
      {onRemove && (
        <span
          onClick={onRemove}
          style={{ position: 'absolute', top: 4, right: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(16,20,24,.6)', cursor: 'pointer' }}
        >
          <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </span>
      )}
    </span>
  )
}

// -------------------------------------------------------------- the certificate

/**
 * The certificate, as the client drew it: what it will say, whether the
 * checklist behind it holds, and the three things you do with it — download it,
 * email it to the builder, mark it sent.
 *
 * Generating it is not a formatting step. It allocates the number the builder
 * will file this under, writes the PDF into the project's documents and stamps
 * when that happened, and the database will not let that number be changed
 * afterwards. So it is deliberately gated on the other five steps: a
 * Certificate of Compliance for an apartment whose flood test never passed is
 * a document somebody can be prosecuted over.
 */
function CertificateStep({
  me,
  site,
  pkg,
  files,
  wet,
  busy,
  onPatch,
  onAttach,
  onRemove,
}: {
  me: WorkerRow
  site: JobSiteRow
  pkg: WpPackageRow | null
  files: WpFile[]
  wet: WetRow[]
  busy: boolean
  onPatch: (values: Record<string, unknown>) => Promise<boolean>
  onAttach: (l: FileList, category: string | null) => Promise<void>
  onRemove: (id: string) => void
}) {
  const [company, setCompany] = useState<CompanyDetails | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [builderEmail, setBuilderEmail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void (async () => {
      const [co, contact] = await Promise.all([
        client.from('companies').select('*').eq('id', me.company_id).maybeSingle(),
        site.supervisor_contact_id
          ? client.from('builder_contacts').select('email').eq('id', site.supervisor_contact_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      setCompany((co.data as CompanyDetails | null) ?? null)
      setBuilderEmail(((contact.data as { email: string | null } | null)?.email) ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [me.company_id, site.supervisor_contact_id])

  const steps = stepsOf(pkg, files)
  // The certificate row itself is excluded — it cannot be a precondition of
  // its own issue.
  const blockers = steps.filter((st) => st.key !== 'certificates' && st.state !== 'complete')
  const supplier = files.find((f) => f.wp_step === 'certificates' && f.category === 'supplier_warranty')
  const installer = files.find((f) => f.wp_step === 'certificates' && f.category === 'installer_warranty')
  const issued = Boolean(pkg?.certificate_generated_at)
  // The number and the sent-at are office actions under wp_package_guard —
  // generating and sending are gated on this rather than on the trigger's
  // rejection, so a crew member never uploads a certificate the package
  // refuses to record.
  const office = me.is_office

  const scope =
    pkg?.scope_of_work?.trim() ||
    (wet.length ? `waterproofing to ${wet.map((r) => r.area.toLowerCase()).join(' + ')}` : 'waterproofing')
  const completion = pkg?.completion_on ?? pkg?.flood_test_on ?? pkg?.installed_on ?? null

  function build(): Blob | null {
    if (!company || !pkg) return null
    return wpCertificatePdf({
      company,
      pkg: {
        unit: pkg.unit,
        scope_of_work: scope,
        completion_on: completion,
        warranty_years: pkg.warranty_years,
        certificate_no: pkg.certificate_no,
        builder_signed_name: pkg.builder_signed_name,
        builder_signed_at: pkg.builder_signed_at,
      },
      siteName: site.name,
      siteAddress: site.address,
      builderName: site.client_name,
      signatoryName: company.certifier_name?.trim() || me.name,
      issuedOn: new Date(),
    })
  }

  /**
   * Generate, file and stamp — one action, because a certificate that exists as
   * a download but not in the project's documents is a certificate nobody can
   * find in two years. The number is allocated from the day's count so two
   * jobs certified on the same afternoon do not collide.
   */
  async function generate() {
    if (!company || !pkg || !office) return
    setWorking('generate')
    setError(null)
    try {
      const client = supabase()
      const on = new Date()
      const dayStart = new Date(on.getFullYear(), on.getMonth(), on.getDate()).toISOString()
      const { count } = await client
        .from('waterproofing_packages')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', me.company_id)
        .gte('certificate_generated_at', dayStart)
      const no = certificateNo(company.name, on, (count ?? 0) + 1)

      const blob = wpCertificatePdf({
        company,
        pkg: {
          unit: pkg.unit,
          scope_of_work: scope,
          completion_on: completion,
          warranty_years: pkg.warranty_years,
          certificate_no: no,
          builder_signed_name: pkg.builder_signed_name,
          builder_signed_at: pkg.builder_signed_at,
        },
        siteName: site.name,
        siteAddress: site.address,
        builderName: site.client_name,
        signatoryName: company.certifier_name?.trim() || me.name,
        issuedOn: on,
      })

      const name = `${no}.pdf`
      const path = objectPath(me.company_id, site.id, name)
      await uploadFile(BUCKET_FILES, path, new File([blob], name, { type: 'application/pdf' }))
      const { error: fileErr } = await client.from('site_files').insert({
        company_id: me.company_id,
        site_id: site.id,
        waterproofing_package_id: pkg.id,
        wp_step: 'certificates',
        uploaded_by: me.id,
        kind: 'document',
        category: 'installer_warranty',
        storage_path: path,
        name,
        mime: 'application/pdf',
        size_bytes: blob.size,
      })
      if (fileErr) throw new Error(fileErr.message)

      const ok = await onPatch({
        certificate_no: no,
        certificate_generated_at: on.toISOString(),
        certificate_path: path,
        scope_of_work: scope,
        completion_on: completion,
      })
      if (!ok) throw new Error('The certificate was filed but the record did not update.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the certificate.')
    } finally {
      setWorking(null)
    }
  }

  /**
   * There is no mail server behind this app and there should not be one: the
   * builder's reply has to land in Giuseppe's own inbox. So the phone's mail
   * app is handed the address, the subject and a signed link to the filed PDF —
   * which is also why generating uploads it first.
   */
  async function emailToBuilder() {
    if (!pkg?.certificate_path) return
    setWorking('email')
    setError(null)
    try {
      const url = await signedUrl(BUCKET_FILES, pkg.certificate_path, 60 * 60 * 24 * 14)
      const subject = `Waterproofing Certificate of Compliance — ${site.name}${pkg.unit ? ` ${pkg.unit}` : ''}`
      const body = [
        `Certificate of Compliance ${pkg.certificate_no ?? ''} for ${site.name}${pkg.unit ? `, ${pkg.unit}` : ''}.`,
        '',
        scope.charAt(0).toUpperCase() + scope.slice(1) + '.',
        completion ? `Date of completion: ${shortDate(completion)}.` : '',
        '',
        url ? `The certificate is here (link valid for 14 days):\n${url}` : '',
        '',
        'Please acknowledge receipt and confirm the waterproofing was inspected prior to tiling.',
      ]
        .filter((l) => l !== undefined)
        .join('\n')
      window.location.href = `mailto:${builderEmail ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the email.')
    } finally {
      setWorking(null)
    }
  }

  const detail = (label: string, value: string) => (
    <span style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 14px', borderBottom: '1px solid #EDEFF1' }}>
      <span style={{ flex: 'none', width: 108, fontSize: 12, color: '#7B838B', paddingTop: 1 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.4, fontWeight: 600, color: value === '—' ? '#9AA1A9' : s.ink }}>{value}</span>
    </span>
  )

  return (
    <>
      {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>}

      {/* ----------------------------------------------- installer certificate */}
      <span style={{ ...fieldLabel, marginTop: 2 }}>INSTALLER CERTIFICATE</span>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '13px 14px',
          background: issued ? '#EAF7EC' : '#fff',
          border: `1px solid ${issued ? '#C8E6D0' : '#E1E5E9'}`,
          borderRadius: 11,
        }}
      >
        {issued ? (
          tick('#1B7A2C')
        ) : (
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#B26A00" strokeWidth="1.8" strokeLinecap="round" style={{ flex: 'none' }}>
            <circle cx="10" cy="10" r="7.4" />
            <path d="M10 6.2v4.4M10 13.2v.9" />
          </svg>
        )}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: issued ? '#1B7A2C' : s.ink }}>
            {issued ? 'Certificate generated' : blockers.length ? 'Not ready yet' : 'Ready to generate'}
          </span>
          <span style={{ fontSize: 12.5, lineHeight: 1.4, color: issued ? '#2F6B43' : '#7B838B' }}>
            {issued
              ? pkg?.certificate_sent_at
                ? `Sent ${shortDate(pkg.certificate_sent_at.slice(0, 10))}`
                : 'Ready to preview and send'
              : blockers.length
                ? `${blockers.map((b) => b.short).join(', ')} still outstanding`
                : 'Everything it needs is recorded'}
          </span>
        </span>
      </span>

      {/* --------------------------------------------- certificate details */}
      <span style={fieldLabel}>CERTIFICATE DETAILS</span>
      <span style={{ ...card, display: 'flex', flexDirection: 'column' }}>
        {detail('Project', site.name)}
        {detail('Builder', site.client_name || '—')}
        {detail('Site address', site.address || '—')}
        {detail('Date of completion', completion ? shortDate(completion) : '—')}
        {detail('Scope of work', scope)}
        {detail('Warranty period', `${pkg?.warranty_years ?? 2} years`)}
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 14px' }}>
          <span style={{ flex: 'none', width: 108, fontSize: 12, color: '#7B838B', paddingTop: 1 }}>Certificate no.</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, letterSpacing: '.01em', color: pkg?.certificate_no ? s.ink : '#9AA1A9' }}>
            {pkg?.certificate_no ?? 'not issued'}
          </span>
        </span>
      </span>

      {/* ------------------------------------------------ status checklist */}
      <span style={fieldLabel}>STATUS CHECKLIST</span>
      <span style={{ ...card, display: 'flex', flexDirection: 'column' }}>
        {steps
          .filter((st) => st.key !== 'certificates')
          .map((st) => (
            <span key={st.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderBottom: '1px solid #EDEFF1' }}>
              {st.state === 'complete' ? (
                tick('#1B7A2C')
              ) : (
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="#C9CED4" strokeWidth="1.7" style={{ flex: 'none' }}>
                  <circle cx="10" cy="10" r="7.6" />
                </svg>
              )}
              <span style={{ flex: 1, fontSize: 13.5, color: st.state === 'complete' ? s.ink : '#8B9096' }}>{st.title}</span>
            </span>
          ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px' }}>
          {issued ? (
            tick('#1B7A2C')
          ) : (
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="#C9CED4" strokeWidth="1.7" style={{ flex: 'none' }}>
              <circle cx="10" cy="10" r="7.6" />
            </svg>
          )}
          <span style={{ flex: 1, fontSize: 13.5, color: issued ? s.ink : '#8B9096' }}>Certificate generated</span>
        </span>
      </span>

      {/* ------------------------------------------------ supplier warranty */}
      <span style={fieldLabel}>SUPPLIER WARRANTY CERTIFICATE</span>
      {supplier ? (
        <AttachmentTile file={supplier} onRemove={office ? () => onRemove(supplier.id) : undefined} />
      ) : (
        <>
          <Note>The manufacturer's own warranty for the membrane — Mapei's, on their letterhead. Attach the PDF they issue.</Note>
          <Uploader label="Attach supplier warranty" busy={busy} onFiles={(l) => void onAttach(l, 'supplier_warranty')} />
        </>
      )}

      {/* ------------------------------------------------------- the actions */}
      {!issued ? (
        office ? (
          <button
            disabled={busy || working !== null || blockers.length > 0 || !company || !pkg}
            onClick={() => void generate()}
            style={{ ...primaryBtn, marginTop: 4, opacity: busy || working !== null || blockers.length > 0 || !pkg ? 0.5 : 1 }}
          >
            {working === 'generate' ? 'GENERATING…' : 'GENERATE CERTIFICATE'}
          </button>
        ) : (
          <span style={{ display: 'block', marginTop: 4, fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
            The office issues this certificate. Say so in the job chat once everything above is
            ticked.
          </span>
        )
      ) : (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 }}>
          <button
            onClick={() => {
              const blob = build()
              if (blob) viewFile({ blob, name: `${pkg?.certificate_no ?? 'certificate'}.pdf` })
            }}
            style={ghostBtn}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.2" y="2.8" width="13.6" height="14.4" rx="2" />
              <path d="M6.6 6.8h6.8M6.6 10h6.8M6.6 13.2h4.2" />
            </svg>
            View the certificate
          </button>
          <button onClick={() => void emailToBuilder()} disabled={working !== null} style={ghostBtn}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.7" strokeLinejoin="round">
              <rect x="2.8" y="5" width="14.4" height="10" rx="2" />
              <path d="M3.2 6l6.8 5 6.8-5" />
            </svg>
            {working === 'email' ? 'Opening mail…' : 'Email to builder'}
          </button>
          {pkg?.certificate_sent_at ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', background: '#EAF7EC', borderRadius: 10, fontSize: 13, color: '#1B7A2C' }}>
              {tick('#1B7A2C')}
              Marked sent {shortDate(pkg.certificate_sent_at.slice(0, 10))}
              {pkg.certificate_sent_to ? ` to ${pkg.certificate_sent_to}` : ''}
            </span>
          ) : office ? (
            <button
              disabled={working !== null}
              onClick={() => void onPatch({ certificate_sent_at: new Date().toISOString(), certificate_sent_to: builderEmail ?? site.client_name })}
              style={{ ...primaryBtn, background: s.accent }}
            >
              MARK AS SENT
            </button>
          ) : (
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
              The office marks it as sent. Say so in the job chat once it has gone out.
            </span>
          )}
        </span>
      )}

      {installer && (
        <>
          <span style={fieldLabel}>FILED IN PROJECT DOCUMENTS</span>
          <AttachmentTile file={installer} onRemove={office ? () => onRemove(installer.id) : undefined} />
        </>
      )}
      <Note>
        The certificate is stored in the project's documents when it is generated, so the copy the
        builder gets and the copy on file are the same document.
      </Note>
    </>
  )
}
