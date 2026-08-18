/**
 * Safety — four shelves and what is on them.
 *
 * The client drew this: a counter card, then Toolbox, Safe work method
 * statement, SDS and Company policy, each with a state and a last-updated
 * line, then somewhere to drop a PDF. The shelves are what a builder asks for
 * when he asks for "your safety paperwork", in the order he asks.
 *
 * Two of them are only ever uploads — "SDS - just requires to upload PDF",
 * "Company policies - just requires upload pdfs" — and one of them is not: a
 * SWMS is issued per job, and the only things that change are the project, the
 * builder and the date. So the body lives in a company template and issuing a
 * SWMS copies it, stamps those three facts on the front, renders the PDF and
 * files it. Same shape as the waterproofing certificate, because it is the
 * same job: a document somebody outside this company has to be handed.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { BUCKET_FILES, objectPath, signedUrl, uploadFile } from '../../data/storage'
import { swmsPdf, swmsReference, type CompanyDetails } from '../../data/documents'
import { downloadPdf } from '../../data/pdf'
import { s, SAFE_BOTTOM } from './stheme'

// ------------------------------------------------------------------- the data

export type ShelfKind = 'induction' | 'swms' | 'sds' | 'policy'

export interface SafetyDoc {
  id: string
  kind: ShelfKind
  site_id: string | null
  title: string
  body: string | null
  version: string
  expires_on: string | null
  updated_at: string
  updated_by: string | null
  storage_path: string | null
  file_name: string | null
  mime: string | null
  size_bytes: number | null
  is_template: boolean
  builder_name: string | null
  document_date: string | null
  reference: string | null
  issued_at: string | null
  sent_at: string | null
  sent_to: string | null
  active: boolean
}

const DOC_COLS =
  'id, kind, site_id, title, body, version, expires_on, updated_at, updated_by, storage_path, ' +
  'file_name, mime, size_bytes, is_template, builder_name, document_date, reference, issued_at, ' +
  'sent_at, sent_to, active'

/** The four shelves, in the client's order and with the client's words. */
export const SHELVES: Array<{ kind: ShelfKind; title: string; detail: string }> = [
  { kind: 'induction', title: 'Toolbox', detail: 'Site inductions and toolbox talks' },
  { kind: 'swms', title: 'Safe work method statement', detail: 'SWMS and safe work methods' },
  { kind: 'sds', title: 'SDS', detail: 'Safety data sheets' },
  { kind: 'policy', title: 'Company policy', detail: 'Company policies and procedures' },
]

const LOCALE = 'en-AU'
const DAY = 86_400_000
const WARN_DAYS = 30

const shortDate = (v: string | null) =>
  v ? new Date(v.length > 10 ? v : `${v}T00:00:00`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type DocState = 'current' | 'expiring' | 'overdue'

/** Days left on a document, and what that makes it. */
export function docState(d: SafetyDoc): { state: DocState; days: number | null } {
  if (!d.expires_on) return { state: 'current', days: null }
  const days = Math.round((new Date(`${d.expires_on}T00:00:00`).getTime() - Date.now()) / DAY)
  if (days < 0) return { state: 'overdue', days }
  if (days < WARN_DAYS) return { state: 'expiring', days }
  return { state: 'current', days }
}

const STATE_CHIP: Record<DocState | 'none', { label: string; bg: string; fg: string }> = {
  current: { label: 'Current', bg: '#EAF7EC', fg: '#1B7A2C' },
  expiring: { label: 'Expiring', bg: '#FFF4E5', fg: '#B26A00' },
  overdue: { label: 'Overdue', bg: '#FDECEE', fg: '#A3282E' },
  none: { label: 'Not required', bg: '#F1F3F5', fg: '#6B7278' },
}

/**
 * A shelf reads as its worst document. An empty shelf is "not required for
 * this job" rather than a problem — anything else turns every new job red on
 * the day it is created, which teaches everyone to ignore the colour.
 */
export function shelfState(docs: SafetyDoc[]): DocState | 'none' {
  if (docs.length === 0) return 'none'
  const states = docs.map((d) => docState(d).state)
  if (states.includes('overdue')) return 'overdue'
  if (states.includes('expiring')) return 'expiring'
  return 'current'
}

/**
 * Everything the tab reads: the job's own documents plus the company-wide ones
 * (a policy is not filed per job), and the templates, which are never listed.
 */
export function useSafety(site: JobSiteRow | null) {
  const [docs, setDocs] = useState<SafetyDoc[]>([])
  const [templates, setTemplates] = useState<SafetyDoc[]>([])
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const client = supabase()
    const [d, crew] = await Promise.all([
      client.from('safety_documents').select(DOC_COLS).eq('active', true).order('updated_at', { ascending: false }),
      client.from('crew_v').select('id, name'),
    ])
    const all = ((d.data ?? []) as unknown as SafetyDoc[])
    setTemplates(all.filter((x) => x.is_template))
    // A document with no site is company-wide and belongs on every job's
    // shelves; one with a site belongs only to that job.
    setDocs(all.filter((x) => !x.is_template && (x.site_id === null || x.site_id === site?.id)))
    setPeople(new Map(((crew.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name])))
    setLoading(false)
  }, [site?.id])

  useEffect(() => {
    void load()
  }, [load])

  const byKind = (k: ShelfKind) => docs.filter((x) => x.kind === k)
  const counts = {
    current: docs.filter((x) => docState(x).state === 'current').length,
    expiring: docs.filter((x) => docState(x).state === 'expiring').length,
    overdue: docs.filter((x) => docState(x).state === 'overdue').length,
    notRequired: SHELVES.filter((sh) => byKind(sh.kind).length === 0).length,
  }

  return { docs, templates, people, loading, byKind, counts, reload: load }
}

// -------------------------------------------------------------- the furniture

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

const SHELF_ICON: Record<ShelfKind, ReactNode> = {
  induction: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#6E56CF" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <rect x="2.8" y="6.2" width="14.4" height="9.6" rx="1.8" />
      <path d="M7.4 6.2V4.8a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.4M2.8 10.2h14.4M9 10.2v1.8h2v-1.8" />
    </svg>
  ),
  swms: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#0E8074" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M5 3.2h6.2L15 6.6v10.2H5z" />
      <path d="M11 3.2v3.6h3.8M7.4 10h5.2M7.4 12.8h3.4" />
    </svg>
  ),
  sds: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#2F5FD7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8.4 3.4h3.2v4l3 6.2a2 2 0 0 1-1.8 2.9H7.2a2 2 0 0 1-1.8-2.9l3-6.2z" />
      <path d="M7.4 3.4h5.2M6.6 12.4h6.8" />
    </svg>
  ),
  policy: (
    <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#1B7A2C" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M10 3.2l5.4 2v4.6c0 3.2-2.3 5.6-5.4 6.6-3.1-1-5.4-3.4-5.4-6.6V5.2z" />
      <path d="M7.6 10l1.8 1.8 3.2-3.6" />
    </svg>
  ),
}

const SHELF_TILE: Record<ShelfKind, string> = {
  induction: '#EFEBFB',
  swms: '#E4F3F1',
  sds: '#E7EEFB',
  policy: '#E8F6EC',
}

const COUNTER: Array<{ key: 'current' | 'expiring' | 'overdue' | 'notRequired'; label: string; sub: string; fg: string; ring: string; glyph: ReactNode }> = [
  {
    key: 'current',
    label: 'Current',
    sub: 'Up to date',
    fg: '#1B7A2C',
    ring: '#D7EEDC',
    glyph: (
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#1B7A2C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.6 10.4l3.4 3.2 7.6-7.8" />
      </svg>
    ),
  },
  {
    key: 'expiring',
    label: 'Expiring',
    sub: 'In 30 days',
    fg: '#B26A00',
    ring: '#F7E2C4',
    glyph: (
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#B26A00" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7.4" />
        <path d="M10 5.8V10l2.8 2" />
      </svg>
    ),
  },
  {
    key: 'overdue',
    label: 'Overdue',
    sub: 'Action required',
    fg: '#A3282E',
    ring: '#F6D2D5',
    glyph: (
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#A3282E" strokeWidth="1.9" strokeLinecap="round">
        <circle cx="10" cy="10" r="7.4" />
        <path d="M10 5.8v4.8M10 13.4v.9" />
      </svg>
    ),
  },
  {
    key: 'notRequired',
    label: 'Not required',
    sub: 'For this job',
    fg: '#6B7278',
    ring: '#E1E5E9',
    glyph: (
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#6B7278" strokeWidth="2" strokeLinecap="round">
        <circle cx="10" cy="10" r="7.4" strokeWidth="1.7" />
        <path d="M6.6 10h6.8" />
      </svg>
    ),
  },
]

// -------------------------------------------------------------------- the tab

/**
 * The Safety tab as drawn: what the paperwork adds up to, the four shelves,
 * and somewhere to put a PDF.
 */
export function SafetyTab({ me, site }: { me: WorkerRow; site: JobSiteRow }) {
  const sf = useSafety(site)
  const { byKind, counts, people, loading } = sf
  const [shelf, setShelf] = useState<ShelfKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Uploading from the tab rather than from inside a shelf: the file decides
   * which shelf it lands on, because the person holding a safety data sheet
   * has already decided what it is. An SDS by name goes to SDS; anything else
   * lands in Company policy, which is the shelf you can move it off.
   */
  async function upload(list: FileList) {
    setBusy(true)
    setError(null)
    try {
      const client = supabase()
      for (const file of Array.from(list)) {
        const guessed: ShelfKind = /sds|safety.?data/i.test(file.name)
          ? 'sds'
          : /swms|method.?statement/i.test(file.name)
            ? 'swms'
            : /induction|toolbox/i.test(file.name)
              ? 'induction'
              : 'policy'
        await addDocument(client, me, site, guessed, file)
      }
      await sf.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that document.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#F5F6F7', paddingBottom: `calc(28px + ${SAFE_BOTTOM})` }}>
      {error && (
        <span style={{ display: 'block', margin: '12px 16px 0', padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>
      )}

      {/* ------------------------------------------------------- the counters */}
      <span style={sectionLabel}>TOOLBOX OVERVIEW</span>
      <div style={{ margin: '0 16px', ...card, display: 'flex', alignItems: 'stretch', padding: '15px 0 14px' }}>
        {COUNTER.map((c) => (
          <span key={c.key} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '0 3px' }}>
            <span
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', border: `1.8px solid ${c.ring}` }}
            >
              {c.glyph}
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', color: s.ink, lineHeight: 1.1 }}>{loading ? '—' : counts[c.key]}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: c.fg, textAlign: 'center' }}>{c.label}</span>
            <span style={{ fontSize: 9.5, color: '#8B9096', textAlign: 'center', lineHeight: 1.2 }}>{c.sub}</span>
          </span>
        ))}
      </div>

      {/* --------------------------------------------------------- the shelves */}
      <span style={sectionLabel}>SAFETY DOCUMENTS</span>
      <div style={{ margin: '0 16px', ...card }}>
        {SHELVES.map((sh, i) => {
          const docs = byKind(sh.kind)
          const state = shelfState(docs)
          const chip = STATE_CHIP[state]
          const worst = docs
            .map((d) => ({ d, ...docState(d) }))
            .sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9))[0]
          const latest = docs.reduce<SafetyDoc | null>((acc, d) => (!acc || d.updated_at > acc.updated_at ? d : acc), null)
          const who = latest?.updated_by === me.id ? 'You' : latest?.updated_by ? people.get(latest.updated_by) ?? 'the office' : null
          return (
            <span
              key={sh.kind}
              onClick={() => setShelf(sh.kind)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 13px 13px 14px', borderBottom: i === SHELVES.length - 1 ? 0 : '1px solid #EDEFF1', cursor: 'pointer' }}
            >
              <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 10, background: SHELF_TILE[sh.kind] }}>
                {SHELF_ICON[sh.kind]}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', color: s.ink }}>{sh.title}</span>
                <span style={{ fontSize: 12.5, lineHeight: 1.35, color: '#7B838B' }}>{sh.detail}</span>
                <span style={{ fontSize: 11.5, color: '#9AA1A9' }}>
                  {latest ? `Updated ${shortDate(latest.updated_at)}${who ? ` · ${who}` : ''}` : 'Nothing on this shelf yet'}
                </span>
              </span>
              <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 23, padding: '0 9px', borderRadius: 12, background: chip.bg, color: chip.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {state === 'current' && (
                    <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke={chip.fg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.4 10.4l3.4 3.2 7.8-8" />
                    </svg>
                  )}
                  {state === 'expiring' && (
                    <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke={chip.fg} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="10" cy="10" r="7.4" />
                      <path d="M10 5.8V10l2.8 2" />
                    </svg>
                  )}
                  {state === 'overdue' && (
                    <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke={chip.fg} strokeWidth="1.9" strokeLinecap="round">
                      <circle cx="10" cy="10" r="7.4" />
                      <path d="M10 5.8v4.8M10 13.4v.9" />
                    </svg>
                  )}
                  {state === 'expiring' && worst?.days != null ? `${worst.days} days` : chip.label}
                </span>
                {chevron}
              </span>
            </span>
          )
        })}
      </div>

      {/* ---------------------------------------------------------- the drop */}
      {me.is_office ? (
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
            margin: '13px 16px 0',
            padding: '17px 16px',
            border: '1.5px dashed #C9CFD6',
            borderRadius: 12,
            background: '#FBFCFD',
            cursor: 'pointer',
          }}
        >
          <input
            type="file"
            accept="application/pdf,image/*"
            multiple
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files)
              e.target.value = ''
            }}
            style={{ display: 'none' }}
          />
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
              <path d="M5.4 14.6a3.4 3.4 0 0 1 .5-6.8 4.6 4.6 0 0 1 8.8-.6 3.2 3.2 0 0 1-.3 7.4" />
              <path d="M10 8.4v6M7.6 10.6L10 8.2l2.4 2.4" />
            </svg>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: s.accent }}>{busy ? 'Uploading…' : 'Upload document'}</span>
          </span>
          <span style={{ fontSize: 11.5, color: '#9AA1A9' }}>PDF, JPG, PNG up to 50MB</span>
        </label>
      ) : (
        <span style={{ display: 'block', margin: '13px 18px 0', fontSize: 12, lineHeight: 1.5, color: '#9AA1A9' }}>
          Safety documents are put up by the office. If something on this job is missing or out of
          date, say so in the job chat — it is quicker than it reaching them any other way.
        </span>
      )}

      {shelf && <ShelfSheet kind={shelf} me={me} site={site} safety={sf} onClose={() => setShelf(null)} />}
    </div>
  )
}

/**
 * One upload becomes one document. Filed against the job unless it is a policy,
 * which is the company's and belongs on every job — putting a copy on each one
 * is how four jobs end up with four different versions of the same policy.
 */
async function addDocument(
  client: ReturnType<typeof supabase>,
  me: WorkerRow,
  site: JobSiteRow,
  kind: ShelfKind,
  file: File,
  extra: Record<string, unknown> = {},
) {
  const path = objectPath(me.company_id, site.id, file.name)
  await uploadFile(BUCKET_FILES, path, file)
  const { error } = await client.from('safety_documents').insert({
    company_id: me.company_id,
    site_id: kind === 'policy' ? null : site.id,
    kind,
    title: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '),
    storage_path: path,
    file_name: file.name,
    mime: file.type || null,
    size_bytes: file.size,
    updated_by: me.id,
    created_by: me.id,
    ...extra,
  })
  if (error) throw new Error(error.message)
}

// ------------------------------------------------------------- one shelf, open

/**
 * A shelf's documents, and the two things you do with them: put one up, take
 * one down. The SWMS shelf has a third — issue one for this job — because that
 * is the only one of the four that is written rather than collected.
 */
function ShelfSheet({
  kind,
  me,
  site,
  safety,
  onClose,
}: {
  kind: ShelfKind
  me: WorkerRow
  site: JobSiteRow
  safety: ReturnType<typeof useSafety>
  onClose: () => void
}) {
  const shelf = SHELVES.find((x) => x.kind === kind)!
  const docs = safety.byKind(kind)
  const template = safety.templates.find((t) => t.kind === kind) ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const office = me.is_office

  async function upload(list: FileList) {
    setBusy(true)
    setError(null)
    try {
      const client = supabase()
      for (const file of Array.from(list)) await addDocument(client, me, site, kind, file)
      await safety.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that document.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    // Struck, not deleted: a safety document that was on site last month is
    // part of what happened last month.
    const { error: err } = await supabase().from('safety_documents').update({ active: false }).eq('id', id)
    if (err) {
      setError(err.message)
      return
    }
    await safety.reload()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.45)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 17px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: SHELF_TILE[kind] }}>
            {SHELF_ICON[kind]}
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>{shelf.title}</span>
            <span style={{ fontSize: 12.5, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shelf.detail}</span>
          </span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            {closeGlyph}
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `14px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>}

            {kind === 'swms' && office && (
              <button onClick={() => setIssuing(true)} style={{ ...primaryBtn }}>
                ISSUE A SWMS FOR THIS JOB
              </button>
            )}
            {kind === 'swms' && office && !template && (
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#B26A00' }}>
                There is no SWMS template set up yet, so an issued one would have a cover page and
                no method. Put the generic statement in as the template first — it is written once
                and every job copies it.
              </span>
            )}

            {docs.length === 0 && (
              <span style={{ padding: '15px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, fontSize: 13, lineHeight: 1.5, color: '#7B838B' }}>
                Nothing on this shelf for {site.name}. A builder asking for your safety paperwork
                asks for these four things, so an empty shelf is worth filling before he does.
              </span>
            )}

            {docs.map((d) => (
              <DocRow key={d.id} doc={d} me={me} people={safety.people} onRemove={office ? () => void remove(d.id) : undefined} />
            ))}

            {office && (
              <label style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.files?.length) void upload(e.target.files)
                    e.target.value = ''
                  }}
                  style={{ display: 'none' }}
                />
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 4v12M4 10h12" />
                </svg>
                {busy ? 'Uploading…' : `Add to ${shelf.title}`}
              </label>
            )}

            {kind === 'policy' && (
              <span style={{ fontSize: 12, lineHeight: 1.5, color: '#9AA1A9' }}>
                Company policies are the company's, not the job's — one copy shows on every job, so
                there is never a stale version on the job nobody looked at.
              </span>
            )}
          </div>
        </div>
      </div>

      {issuing && (
        <IssueSwmsSheet
          me={me}
          site={site}
          template={template}
          onClose={() => setIssuing(false)}
          onIssued={async () => {
            setIssuing(false)
            await safety.reload()
          }}
        />
      )}
    </div>
  )
}

/** One document on a shelf: what it is, what state it is in, how to open it. */
function DocRow({ doc, me, people, onRemove }: { doc: SafetyDoc; me: WorkerRow; people: Map<string, string>; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const { state, days } = docState(doc)
  const chip = STATE_CHIP[state]
  const who = doc.updated_by === me.id ? 'You' : doc.updated_by ? people.get(doc.updated_by) ?? 'the office' : null
  const isImage = /^image\//.test(doc.mime ?? '')

  useEffect(() => {
    let cancelled = false
    if (!doc.storage_path) return
    void signedUrl(BUCKET_FILES, doc.storage_path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [doc.storage_path])

  return (
    <span style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 12px 12px 13px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 11 }}>
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 8, overflow: 'hidden', background: isImage ? '#E4E7EA' : '#EEF1F4', textDecoration: 'none' }}
      >
        {isImage && url ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.03em', color: '#5F666E' }}>
            {(doc.file_name?.split('.').pop() ?? 'DOC').slice(0, 4).toUpperCase()}
          </span>
        )}
      </a>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <a
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-.005em', color: s.ink, textDecoration: 'none' }}
        >
          {doc.title}
        </a>
        {doc.reference && <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.01em', color: '#7B838B' }}>{doc.reference}</span>}
        <span style={{ fontSize: 11.5, lineHeight: 1.35, color: '#9AA1A9' }}>
          Updated {shortDate(doc.updated_at)}
          {who ? ` · ${who}` : ''}
        </span>
        {doc.expires_on && (
          <span style={{ fontSize: 11.5, color: state === 'current' ? '#9AA1A9' : chip.fg, fontWeight: state === 'current' ? 400 : 600 }}>
            {state === 'overdue'
              ? `Review was due ${shortDate(doc.expires_on)}`
              : `Review due ${shortDate(doc.expires_on)}${days != null && state === 'expiring' ? ` · ${days} days` : ''}`}
          </span>
        )}
        {doc.sent_at && <span style={{ fontSize: 11.5, color: '#1B7A2C', fontWeight: 600 }}>Sent {shortDate(doc.sent_at)}</span>}
      </span>
      <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 11, background: chip.bg, color: chip.fg, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {chip.label}
        </span>
        {onRemove && (
          <span onClick={onRemove} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, cursor: 'pointer' }}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="#9AA1A9" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </span>
        )}
      </span>
    </span>
  )
}

// ---------------------------------------------------------- issuing a SWMS

/**
 * "Each SWMS will require the project, the builder, the date. The rest stays
 * the same."
 *
 * So this asks for the three, takes the rest from the template, renders the
 * PDF, files it against the job with a reference, and offers to email it —
 * exactly the path the waterproofing certificate takes, because a builder
 * receives both the same way.
 */
function IssueSwmsSheet({
  me,
  site,
  template,
  onClose,
  onIssued,
}: {
  me: WorkerRow
  site: JobSiteRow
  template: SafetyDoc | null
  onClose: () => void
  onIssued: () => Promise<void>
}) {
  const [builder, setBuilder] = useState(site.client_name ?? '')
  const [docDate, setDocDate] = useState(todayISO())
  const [review, setReview] = useState('')
  const [company, setCompany] = useState<CompanyDetails | null>(null)
  const [builderEmail, setBuilderEmail] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ doc: SafetyDoc; blob: Blob } | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      setBuilderEmail((contact.data as { email: string | null } | null)?.email ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [me.company_id, site.supervisor_contact_id])

  const title = template?.title ?? 'Safe work method statement'
  const body = template?.body ?? ''

  function render(reference: string | null): Blob | null {
    if (!company) return null
    return swmsPdf({
      company,
      title,
      body,
      reference,
      siteName: site.name,
      siteAddress: site.address,
      builderName: builder.trim() || null,
      documentDate: docDate || null,
      version: template?.version ?? '1',
      preparedBy: company.certifier_name?.trim() || me.name,
    })
  }

  async function issue() {
    if (!company) return
    setWorking('issue')
    setError(null)
    try {
      const client = supabase()
      const on = new Date()
      const dayStart = new Date(on.getFullYear(), on.getMonth(), on.getDate()).toISOString()
      const { count } = await client
        .from('safety_documents')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', me.company_id)
        .eq('kind', 'swms')
        .gte('issued_at', dayStart)
      const reference = swmsReference(company.name, on, (count ?? 0) + 1)

      const blob = render(reference)
      if (!blob) throw new Error('Company details are still loading.')
      const name = `${reference}.pdf`
      const path = objectPath(me.company_id, site.id, name)
      await uploadFile(BUCKET_FILES, path, new File([blob], name, { type: 'application/pdf' }))

      const { data, error: err } = await client
        .from('safety_documents')
        .insert({
          company_id: me.company_id,
          site_id: site.id,
          kind: 'swms',
          title: `${title} — ${site.name}`,
          body,
          version: template?.version ?? '1',
          template_id: template?.id ?? null,
          builder_name: builder.trim() || null,
          document_date: docDate || null,
          expires_on: review || null,
          reference,
          issued_at: on.toISOString(),
          storage_path: path,
          file_name: name,
          mime: 'application/pdf',
          size_bytes: blob.size,
          created_by: me.id,
          updated_by: me.id,
          // A SWMS is the document the sign-on gate is about, so an issued one
          // has to be signed before anybody starts on this job.
          resign_after_hours: null,
        })
        .select(DOC_COLS)
        .single()
      if (err) throw new Error(err.message)
      setIssued({ doc: data as unknown as SafetyDoc, blob })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not issue that SWMS.')
    } finally {
      setWorking(null)
    }
  }

  async function email() {
    if (!issued?.doc.storage_path) return
    setWorking('email')
    try {
      const url = await signedUrl(BUCKET_FILES, issued.doc.storage_path, 60 * 60 * 24 * 14)
      const subject = `Safe work method statement — ${site.name}`
      const lines = [
        `${title} for ${site.name}${builder.trim() ? `, ${builder.trim()}` : ''}.`,
        '',
        `Reference: ${issued.doc.reference ?? ''}`,
        docDate ? `Dated: ${shortDate(docDate)}` : '',
        '',
        url ? `The statement is here (link valid for 14 days):\n${url}` : '',
        '',
        'Our crew sign on to this before starting. Let us know if site conditions change and it needs revising.',
      ]
      window.location.href = `mailto:${builderEmail ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`
      await supabase()
        .from('safety_documents')
        .update({ sent_at: new Date().toISOString(), sent_to: builderEmail ?? (builder.trim() || null) })
        .eq('id', issued.doc.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the email.')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.5)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 17px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>
            {issued ? 'SWMS issued' : 'Issue a SWMS'}
          </span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            {closeGlyph}
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `15px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>}

            {!issued ? (
              <>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={fieldLabel}>PROJECT</span>
                  <span style={{ ...field, display: 'flex', alignItems: 'center', color: '#4A5057', background: '#EEF1F4' }}>{site.name}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={fieldLabel}>BUILDER</span>
                  <input value={builder} onChange={(e) => setBuilder(e.target.value)} placeholder="Who the job is for" style={field} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={fieldLabel}>DATE</span>
                  <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} style={field} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={fieldLabel}>REVIEW DUE (OPTIONAL)</span>
                  <input type="date" value={review} onChange={(e) => setReview(e.target.value)} style={field} />
                </span>
                <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                  Everything else comes from the company's statement — the method, the hazards, the
                  controls — so the copy this job gets is the copy every job gets. Change the method
                  once, on the template, and the next one issued carries it.
                </span>
                {!template && (
                  <span style={{ padding: '11px 13px', background: '#FFF4E5', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5, color: '#B26A00' }}>
                    No template is set up yet, so this would issue a cover page with nothing behind
                    it. Worth putting the generic statement in first.
                  </span>
                )}
                <button
                  disabled={working !== null || !company}
                  onClick={() => void issue()}
                  style={{ ...primaryBtn, opacity: working !== null || !company ? 0.5 : 1 }}
                >
                  {working === 'issue' ? 'ISSUING…' : 'ISSUE AND FILE'}
                </button>
              </>
            ) : (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', background: '#EAF7EC', border: '1px solid #C8E6D0', borderRadius: 11 }}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#1B7A2C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
                    <circle cx="10" cy="10" r="7.6" strokeWidth="1.7" />
                    <path d="M6.6 10.2l2.4 2.3 4.4-4.6" />
                  </svg>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: '#1B7A2C' }}>{issued.doc.reference}</span>
                    <span style={{ fontSize: 12.5, color: '#2F6B43' }}>Filed against {site.name}</span>
                  </span>
                </span>
                <button onClick={() => downloadPdf(issued.blob, `${issued.doc.reference ?? 'swms'}.pdf`)} style={ghostBtn}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 3.6v9M6.4 9.2L10 12.8l3.6-3.6M4 15.6h12" />
                  </svg>
                  Download PDF
                </button>
                <button onClick={() => void email()} disabled={working !== null} style={ghostBtn}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.7" strokeLinejoin="round">
                    <rect x="2.8" y="5" width="14.4" height="10" rx="2" />
                    <path d="M3.2 6l6.8 5 6.8-5" />
                  </svg>
                  {working === 'email' ? 'Opening mail…' : 'Email to builder'}
                </button>
                <button onClick={() => void onIssued()} style={primaryBtn}>
                  DONE
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
