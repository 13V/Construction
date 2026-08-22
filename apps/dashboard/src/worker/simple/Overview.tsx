/**
 * Overview — what this job is, in the order it gets asked about.
 *
 * A tiling job is lost on the things nobody wrote down: which grout, which
 * silicone, what the mitres do at the return, which grate goes in the floor
 * waste. So the tab reads top to bottom as: the drawings, the scope lines and
 * whether each is confirmed, the notes anyone left for the team, and the
 * project's own details.
 *
 * The lines are `selections` rows — the same table the builder portal already
 * shows the client, so confirming one here and confirming it there are the
 * same fact. A line nobody has touched yet has no row: the seven standard
 * lines are rendered from the template below and only written when somebody
 * sets one, which keeps a read from needing write access.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { BUCKET_FILES, objectPath, signedUrl, uploadFile } from '../../data/storage'
import { siteSpan, type SpanRows } from './data'
import { DrawingsPanel } from './Drawings'
import { ProgrammeSheet, programmeLine, useProgrammes } from './Programme'
import { WaterproofingPanel } from './Waterproofing'
import { s, SAFE_BOTTOM } from './stheme'
import { viewFile } from './FileViewer'

type ScopeStatus = 'pending' | 'chosen' | 'not_applicable'

const STATUS_META: Record<ScopeStatus, { label: string; bg: string; fg: string; glyph: ReactNode }> = {
  chosen: {
    label: 'Confirmed',
    bg: '#EAF7EC',
    fg: '#1B7A2C',
    glyph: (
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="#1B7A2C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7.6" strokeWidth="1.7" />
        <path d="M6.6 10.2l2.4 2.3 4.4-4.6" />
      </svg>
    ),
  },
  pending: {
    label: 'Required',
    bg: '#FFF4E5',
    fg: '#B26A00',
    glyph: (
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="#B26A00" strokeWidth="1.9" strokeLinecap="round">
        <circle cx="10" cy="10" r="7.6" strokeWidth="1.7" />
        <path d="M10 6.2v5" />
        <path d="M10 13.6v.2" />
      </svg>
    ),
  },
  not_applicable: {
    label: 'Not applicable',
    bg: '#F1F3F5',
    fg: '#696D74',
    glyph: (
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="#696D74" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="10" cy="10" r="7.6" strokeWidth="1.7" />
        <path d="M6.4 10h7.2" />
      </svg>
    ),
  },
}

/** The tile-square icons from the client's list, one per line. */
const ICON: Record<string, { bg: string; stroke: string; path: ReactNode }> = {
  tiles: {
    bg: '#EAF0FE',
    stroke: '#2F5FD7',
    path: (
      <>
        <rect x="3.2" y="3.2" width="5.6" height="5.6" rx="1.2" />
        <rect x="11.2" y="3.2" width="5.6" height="5.6" rx="1.2" />
        <rect x="3.2" y="11.2" width="5.6" height="5.6" rx="1.2" />
        <rect x="11.2" y="11.2" width="5.6" height="5.6" rx="1.2" />
      </>
    ),
  },
  grout: {
    bg: '#F3EDFE',
    stroke: '#6E56CF',
    path: (
      <>
        <path d="M10 3.2a6.8 6.8 0 1 0 0 13.6c1 0 1.6-.6 1.6-1.4 0-1.5 1-1.6 2-1.6 1.8 0 3.2-1.2 3.2-3.1C16.8 6.4 13.8 3.2 10 3.2z" />
        <circle cx="7" cy="8" r=".9" fill="#6E56CF" stroke="none" />
        <circle cx="10.4" cy="6.4" r=".9" fill="#6E56CF" stroke="none" />
        <circle cx="6.2" cy="11.4" r=".9" fill="#6E56CF" stroke="none" />
      </>
    ),
  },
  silicone: {
    bg: '#E7F6F3',
    stroke: '#0F8A76',
    path: (
      <>
        <path d="M12.4 3.6l4 4-8.2 8.2-4-4z" />
        <path d="M6 10l4 4" />
        <path d="M4.2 15.8l-1 1" />
      </>
    ),
  },
  angles: {
    bg: '#FFF4E0',
    stroke: '#C2740C',
    path: (
      <>
        <path d="M4 4h9v3.4H7.4V16H4z" />
        <path d="M9.6 10.4h6.8" />
      </>
    ),
  },
  mitres: {
    bg: '#FDECEF',
    stroke: '#C33B4E',
    path: (
      <>
        <path d="M3.6 16.4L16.4 3.6" />
        <path d="M3.6 10.4v6h6" />
        <path d="M16.4 9.6v-6h-6" />
      </>
    ),
  },
  grates: {
    bg: '#ECEEFE',
    stroke: '#4B54C9',
    path: (
      <>
        <rect x="3.4" y="4.6" width="13.2" height="10.8" rx="1.6" />
        <path d="M7 7.4v5.2M10 7.4v5.2M13 7.4v5.2" />
      </>
    ),
  },
  strip_drains: {
    bg: '#E6F5F8',
    stroke: '#0E7C99',
    path: (
      <>
        <rect x="2.8" y="7.4" width="14.4" height="5.2" rx="1.4" />
        <path d="M6 9v2M8.4 9v2M10.8 9v2M13.2 9v2" />
      </>
    ),
  },
}

interface ScopeLine {
  key: string
  name: string
  detail: string
}

/**
 * The seven the client asked for, in the order the trade works in. A job may
 * carry more — anything the office adds by hand appears after these.
 */
const SCOPE_TEMPLATE: ScopeLine[] = [
  { key: 'tiles', name: 'Tile selections + Data', detail: 'Confirm tile selections and provide all relevant product data.' },
  { key: 'grout', name: 'Grout colours', detail: 'Select and confirm grout colour for all areas.' },
  { key: 'silicone', name: 'Silicone colours', detail: 'Select and confirm silicone colour.' },
  { key: 'angles', name: 'Angles colour', detail: 'Confirm angles colour selection.' },
  { key: 'mitres', name: 'Mitres', detail: 'Confirm mitre type and finishes.' },
  { key: 'grates', name: 'Grates', detail: 'Confirm grate type, size and finish.' },
  { key: 'strip_drains', name: 'Strip drains', detail: 'Confirm strip drain type, length and location.' },
]

interface SelectionRow {
  id: string
  scope_key: string | null
  name: string
  detail: string | null
  status: ScopeStatus
  chosen: string | null
}

interface AttachmentRow {
  id: string
  selection_id: string | null
  name: string
  mime: string | null
  storage_path: string
}

interface NoteRow {
  id: string
  body: string
  author_id: string | null
  created_at: string
}

const card = {
  background: '#fff',
  border: '1px solid #E1E5E9',
  borderRadius: 12,
  overflow: 'hidden',
} as const

const sectionLabel = {
  display: 'block',
  padding: '18px 18px 9px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.12em',
  color: '#7B838B',
} as const

// ------------------------------------------------------------ the sub-tabs

/**
 * "Like this across the top."
 *
 * Overview was one long scroll — drawings, waterproofing, scope, notes,
 * details — and each of those grew until the one below it was unreachable.
 * Thirty drawings will do that on their own. So the page splits into the four
 * things it was always four of, and the row across the top is how you get
 * between them.
 */
export type OverviewSection = 'details' | 'scope' | 'drawings' | 'waterproofing'

const SECTIONS: Array<{ key: OverviewSection; label: string; glyph: (c: string) => ReactNode }> = [
  {
    key: 'details',
    label: 'Project details',
    glyph: (c) => (
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        <path d="M3.4 4.6h13.2v8.8H10l-3.2 2.8v-2.8H3.4z" />
      </svg>
    ),
  },
  {
    key: 'scope',
    label: 'Scope of works',
    glyph: (c) => (
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        <path d="M5.4 3.4h6l3.2 3.2v10.4H5.4z" />
        <path d="M11.2 3.4v3.4h3.4M7.8 10h4.4M7.8 12.8h3" />
      </svg>
    ),
  },
  {
    key: 'drawings',
    label: 'Drawings',
    glyph: (c) => (
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        <path d="M5 2.8h6.4L15.6 7v10.2H5z" />
        <path d="M11.2 2.8V7h4.4M7.4 10.2h5M7.4 13h3.2" />
      </svg>
    ),
  },
  {
    key: 'waterproofing',
    label: 'Waterproofing',
    glyph: (c) => (
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round">
        <path d="M10 3.2c2.7 3.1 4.5 5.2 4.5 7.5a4.5 4.5 0 0 1-9 0c0-2.3 1.8-4.4 4.5-7.5z" />
      </svg>
    ),
  },
]

function SectionTabs({ current, onPick }: { current: OverviewSection; onPick: (s: OverviewSection) => void }) {
  return (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'stretch', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
      {SECTIONS.map((sec) => {
        const on = sec.key === current
        return (
          <span
            key={sec.key}
            onClick={() => onPick(sec.key)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '9px 2px 0',
              cursor: 'pointer',
            }}
          >
            {sec.glyph(on ? s.accent : '#98A0A8')}
            <span
              style={{
                fontSize: 10,
                fontWeight: on ? 700 : 500,
                letterSpacing: '-.01em',
                color: on ? s.accent : '#7B838B',
                textAlign: 'center',
                lineHeight: 1.2,
              }}
            >
              {sec.label}
            </span>
            <span style={{ width: '100%', height: 2.5, marginTop: 5, borderRadius: '2px 2px 0 0', background: on ? s.accent : 'transparent' }} />
          </span>
        )
      })}
    </div>
  )
}

/**
 * The tally the client drew along the foot of the screen. It counts the scope
 * of works, because those three words ARE the scope statuses — a line is
 * confirmed, still required, or does not apply to this job. It stays put while
 * you move between sections so the answer to "what is left on this job" does
 * not disappear when you go looking at a drawing.
 */
function ReadinessBar({ counts }: { counts: Record<ScopeStatus, number> }) {
  const CELLS: Array<{ k: ScopeStatus; label: string }> = [
    { k: 'chosen', label: 'Complete' },
    { k: 'pending', label: 'Required' },
    { k: 'not_applicable', label: 'Not applicable' },
  ]
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'stretch',
        background: '#fff',
        borderTop: '1px solid #E1E5E9',
      }}
    >
      {CELLS.map(({ k, label }, i) => (
        <span
          key={k}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '9px 4px 10px', borderLeft: i === 0 ? 'none' : '1px solid #EDEFF1' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: STATUS_META[k].fg }}>
            {STATUS_META[k].glyph}
            {label}
          </span>
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.01em', color: s.ink }}>{counts[k]}</span>
        </span>
      ))}
    </div>
  )
}

export function OverviewTab({ me, site }: { me: WorkerRow; site: JobSiteRow }) {
  const office = me.is_office
  const [rows, setRows] = useState<SelectionRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [open, setOpen] = useState<{ line: ScopeLine; row: SelectionRow | null } | null>(null)
  const [section, setSection] = useState<OverviewSection>('details')
  const [notesOpen, setNotesOpen] = useState(false)
  const [noting, setNoting] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [files, setFiles] = useState<Map<string, AttachmentRow[]>>(new Map())
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const client = supabase()
    const [sel, note, crew, att] = await Promise.all([
      client.from('selections').select('id, scope_key, name, detail, status, chosen').eq('site_id', site.id),
      client.from('site_notes').select('id, body, author_id, created_at').eq('site_id', site.id).order('created_at', { ascending: false }),
      client.from('crew_v').select('id, name'),
      client
        .from('site_files')
        .select('id, selection_id, name, mime, storage_path')
        .eq('site_id', site.id)
        .not('selection_id', 'is', null)
        .order('created_at'),
    ])
    setRows((sel.data ?? []) as SelectionRow[])
    setNotes((note.data ?? []) as NoteRow[])
    setPeople(new Map(((crew.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name])))
    const byLine = new Map<string, AttachmentRow[]>()
    for (const f of (att.data ?? []) as AttachmentRow[]) {
      if (!f.selection_id) continue
      byLine.set(f.selection_id, [...(byLine.get(f.selection_id) ?? []), f])
    }
    setFiles(byLine)
  }, [site.id])

  useEffect(() => {
    void load()
  }, [load])

  const byKey = new Map(rows.filter((r) => r.scope_key).map((r) => [r.scope_key!, r]))
  const extras = rows.filter((r) => !r.scope_key)

  /** Template first, then anything added by hand. */
  const lines: Array<{ line: ScopeLine; row: SelectionRow | null }> = [
    ...SCOPE_TEMPLATE.map((line) => ({ line, row: byKey.get(line.key) ?? null })),
    ...extras.map((r) => ({ line: { key: r.id, name: r.name, detail: r.detail ?? '' }, row: r })),
  ]

  const counts = { chosen: 0, pending: 0, not_applicable: 0 }
  for (const { row } of lines) counts[row?.status ?? 'pending'] += 1

  async function setStatus(line: ScopeLine, row: SelectionRow | null, status: ScopeStatus, chosen: string) {
    setError(null)
    const client = supabase()
    const patch = {
      status,
      chosen: chosen.trim() || null,
      chosen_at: status === 'chosen' ? new Date().toISOString() : null,
    }
    const res = row
      ? await client.from('selections').update(patch).eq('id', row.id)
      : await client.from('selections').insert({
          company_id: me.company_id,
          site_id: site.id,
          scope_key: SCOPE_TEMPLATE.some((t) => t.key === line.key) ? line.key : null,
          name: line.name,
          detail: line.detail,
          sort: SCOPE_TEMPLATE.findIndex((t) => t.key === line.key),
          ...patch,
        })
    if (res.error) {
      setError(res.error.message)
      return
    }
    setOpen(null)
    await load()
  }

  /**
   * A scope line's evidence: the data sheet, the sample photo, the builder's
   * marked-up schedule. Filed as documents so they stay out of the day's
   * photos, and against the line so they travel with the decision. An
   * untouched line has no row yet, so the first upload creates one.
   */
  async function attach(line: ScopeLine, row: SelectionRow | null, list: FileList) {
    setUploading(line.key)
    setError(null)
    try {
      const client = supabase()
      let selectionId = row?.id ?? null
      if (!selectionId) {
        const { data, error: err } = await client
          .from('selections')
          .insert({
            company_id: me.company_id,
            site_id: site.id,
            scope_key: SCOPE_TEMPLATE.some((t) => t.key === line.key) ? line.key : null,
            name: line.name,
            detail: line.detail,
            sort: SCOPE_TEMPLATE.findIndex((t) => t.key === line.key),
            status: 'pending',
          })
          .select('id')
          .single()
        if (err) throw new Error(err.message)
        selectionId = (data as { id: string }).id
      }
      for (const file of Array.from(list)) {
        const path = objectPath(me.company_id, site.id, file.name)
        await uploadFile(BUCKET_FILES, path, file)
        const { error: err } = await client.from('site_files').insert({
          company_id: me.company_id,
          site_id: site.id,
          selection_id: selectionId,
          uploaded_by: me.id,
          kind: 'document',
          storage_path: path,
          name: file.name,
          mime: file.type || null,
          size_bytes: file.size,
        })
        if (err) throw new Error(err.message)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach that file.')
    } finally {
      setUploading(null)
    }
  }

  async function removeAttachment(id: string) {
    // A refused DELETE matches zero rows rather than erroring, and PostgREST
    // reports that as success — so the row coming back is the only proof it
    // actually went. site_files DELETE is office-only, which is why a crew
    // member tapping × here used to watch nothing happen, twice.
    const { data, error: err } = await supabase().from('site_files').delete().eq('id', id).select('id')
    if (err || !data || data.length === 0) {
      setError(err?.message ?? 'That did not delete — the office removes attachments.')
      return
    }
    await load()
  }

  async function addNote() {
    const body = noteDraft.trim()
    if (!body) return
    setError(null)
    const { error: err } = await supabase()
      .from('site_notes')
      .insert({ company_id: me.company_id, site_id: site.id, body, author_id: me.id })
    if (err) {
      setError(err.message)
      return
    }
    setNoteDraft('')
    setNoting(false)
    await load()
  }

  async function removeNote(id: string) {
    // Same trap: site_notes DELETE is the author's or the office's, so
    // somebody removing another person's note gets a silent no-op unless the
    // row is read back.
    const { data, error: err } = await supabase().from('site_notes').delete().eq('id', id).select('id')
    if (err || !data || data.length === 0) {
      setError(err?.message ?? 'That note is not yours to delete.')
      return
    }
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SectionTabs current={section} onPick={setSection} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingBottom: 26 }}>
      {section === 'details' && (
        <ProjectDetails me={me} site={site} office={office} notes={notes} onOpenNotes={() => setNotesOpen(true)} />
      )}

      {section === 'drawings' && <DrawingsPanel me={me} site={site} />}

      {section === 'waterproofing' && <WaterproofingPanel me={me} site={site} />}

      {section === 'scope' && (
        <>
      {/* The scope lines. */}
      <span style={sectionLabel}>SCOPE OF WORKS</span>
      <div style={{ margin: '0 18px', ...card }}>
        {lines.map(({ line, row }, i) => {
          const status: ScopeStatus = row?.status ?? 'pending'
          const meta = STATUS_META[status]
          const icon = ICON[line.key] ?? ICON.tiles!
          return (
            <span
              key={line.key}
              onClick={() => office && setOpen({ line, row })}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 13px 13px 15px', borderBottom: i === lines.length - 1 ? 'none' : '1px solid #EDEFF1', cursor: office ? 'pointer' : 'default' }}
            >
              <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: icon.bg }}>
                <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke={icon.stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {icon.path}
                </svg>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-.005em', color: s.ink }}>{line.name}</span>
                <span style={{ fontSize: 12.5, lineHeight: 1.35, color: '#7B838B' }}>{line.detail}</span>
                {row?.chosen && (
                  <span style={{ marginTop: 2, fontSize: 12.5, fontWeight: 600, color: '#1B7A2C' }}>{row.chosen}</span>
                )}
                {(() => {
                  const n = (row && files.get(row.id)?.length) || 0
                  if (n === 0) return null
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 12, color: '#7B838B' }}>
                      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="#8B9096" strokeWidth="1.7" strokeLinejoin="round">
                        <path d="M4.6 2.8h7l4 4v10.4H4.6z" />
                        <path d="M11.4 2.8v4.2h4.2" />
                      </svg>
                      {n} {n === 1 ? 'attachment' : 'attachments'}
                    </span>
                  )
                })()}
              </span>
              <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, paddingTop: 2 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', borderRadius: 11, background: meta.bg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', color: meta.fg }}>
                  {meta.glyph}
                  {meta.label}
                </span>
                {office && (
                  <svg width="10" height="10" viewBox="0 0 10 10" style={{ flex: 'none' }}>
                    <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            </span>
          )
        })}
      </div>

      {!office && (
        <span style={{ display: 'block', padding: '9px 18px 0', fontSize: 12.5, lineHeight: 1.45, color: '#8B9096' }}>
          The office confirms these. Anything wrong or missing, say so in the job chat.
        </span>
      )}

        </>
      )}

      {error && (
        <span style={{ display: 'block', padding: '12px 18px 0', fontSize: 13, lineHeight: 1.45, color: '#A3282E' }}>{error}</span>
      )}
      </div>

      <ReadinessBar counts={counts} />


      {notesOpen && (
        <div
          onClick={() => setNotesOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.45)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxHeight: '90%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
          >
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>Notes</span>
              <span
                onClick={() => setNotesOpen(false)}
                style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}
              >
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: `calc(20px + ${SAFE_BOTTOM})` }}>
      {/* Notes for whoever is next on the job. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '18px 18px 9px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>NOTES</span>
        {!noting && (
          <span onClick={() => setNoting(true)} style={{ fontSize: 13.5, fontWeight: 600, color: s.accent, cursor: 'pointer' }}>
            Add note
          </span>
        )}
      </div>
      <div style={{ margin: '0 18px', ...card }}>
        {notes.map((n, i) => (
          <span key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 13px 12px 15px', borderBottom: i === notes.length - 1 && !noting ? 'none' : '1px solid #EDEFF1' }}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 14.5, lineHeight: 1.45, color: s.ink, whiteSpace: 'pre-wrap' }}>{n.body}</span>
              <span style={{ fontSize: 12, color: '#8B9096' }}>
                {[people.get(n.author_id ?? '') ?? 'Someone', new Date(n.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })].join(' · ')}
              </span>
            </span>
            {(office || n.author_id === me.id) && (
              <span onClick={() => void removeNote(n.id)} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, cursor: 'pointer' }}>
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="#9AA1A9" strokeWidth="2" strokeLinecap="round">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </span>
            )}
          </span>
        ))}

        {noting ? (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '13px 15px 15px' }}>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              autoFocus
              rows={3}
              placeholder="Anything the next person on this job needs to know…"
              style={{ width: '100%', padding: '11px 13px', boxSizing: 'border-box', background: '#F5F6F7', border: '1px solid #DCE0E6', borderRadius: 10, fontFamily: 'inherit', fontSize: 16, lineHeight: 1.45, color: s.ink, resize: 'none', outline: 'none' }}
            />
            <span style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={() => void addNote()}
                disabled={!noteDraft.trim()}
                style={{ flex: 1, height: 46, border: 0, borderRadius: 10, background: noteDraft.trim() ? '#1A1D21' : '#C3C9D0', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, letterSpacing: '.03em', color: '#fff', cursor: noteDraft.trim() ? 'pointer' : 'default' }}
              >
                SAVE NOTE
              </button>
              <button
                onClick={() => {
                  setNoting(false)
                  setNoteDraft('')
                }}
                style={{ flex: 'none', height: 46, padding: '0 16px', border: '1px solid #DCE0E6', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: '#4A5057', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </span>
          </span>
        ) : (
          notes.length === 0 && (
            <span style={{ display: 'block', padding: '15px', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
              Nothing yet. A note here is read by everyone on the job — the thing you would
              otherwise have to say twice.
            </span>
          )
        )}
      </div>
            </div>
          </div>
        </div>
      )}

      {open && (
        <ScopeSheet
          line={open.line}
          row={open.row}
          attachments={open.row ? files.get(open.row.id) ?? [] : []}
          uploading={uploading === open.line.key}
          onAttach={(list) => void attach(open.line, open.row, list)}
          onRemoveAttachment={(id) => void removeAttachment(id)}
          onCancel={() => setOpen(null)}
          onSave={(status, chosen) => void setStatus(open.line, open.row, status, chosen)}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------ the drill-in

/** One line, opened: what it is, what was chosen, and where it stands. */
function ScopeSheet({
  line,
  row,
  attachments,
  uploading,
  onAttach,
  onRemoveAttachment,
  onCancel,
  onSave,
}: {
  line: ScopeLine
  row: SelectionRow | null
  attachments: AttachmentRow[]
  uploading: boolean
  onAttach: (list: FileList) => void
  onRemoveAttachment: (id: string) => void
  onCancel: () => void
  onSave: (status: ScopeStatus, chosen: string) => void
}) {
  const [status, setStatus] = useState<ScopeStatus>(row?.status ?? 'pending')
  const [chosen, setChosen] = useState(row?.chosen ?? '')

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.45)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '86%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding: `20px 18px calc(22px + env(safe-area-inset-bottom, 0px))`, background: '#fff', borderRadius: '16px 16px 0 0' }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>{line.name}</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: '#7B838B' }}>{line.detail}</span>
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' }}>WHAT WAS CHOSEN</span>
          <input
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            placeholder="e.g. Mapei Ultracolour 114 — Anthracite"
            style={{ width: '100%', height: 50, padding: '0 13px', boxSizing: 'border-box', background: '#F5F6F7', border: '1px solid #DCE0E6', borderRadius: 10, font: 'inherit', fontSize: 16, color: s.ink, outline: 'none' }}
          />
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' }}>WHERE IT STANDS</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {(['chosen', 'pending', 'not_applicable'] as const).map((k) => {
              const on = status === k
              const meta = STATUS_META[k]
              return (
                <span
                  key={k}
                  onClick={() => setStatus(k)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 48, padding: '0 13px', borderRadius: 10, background: on ? meta.bg : '#fff', border: `1.5px solid ${on ? meta.fg : '#DCE0E6'}`, fontSize: 14.5, fontWeight: on ? 700 : 500, color: on ? meta.fg : '#4A5057', cursor: 'pointer' }}
                >
                  {meta.glyph}
                  {meta.label}
                </span>
              )
            })}
          </span>
        </span>

        {/* The paperwork: as many photos and PDFs as the line needs. */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' }}>
            ATTACHMENTS {attachments.length > 0 && `· ${attachments.length}`}
          </span>
          {attachments.map((f) => (
            <AttachmentTile key={f.id} file={f} onRemove={() => onRemoveAttachment(f.id)} />
          ))}
          <span style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 46, borderRadius: 10, background: '#F1F3F5', border: '1px solid #DCE0E6', fontSize: 14, fontWeight: 600, color: '#1A1D21', cursor: uploading ? 'default' : 'pointer' }}>
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="1.6" strokeLinejoin="round">
                <path d="M2.6 6.2h3.1l1.3-1.9h6l1.3 1.9h3.1v9.6H2.6z" />
                <circle cx="10" cy="10.8" r="3" />
              </svg>
              {uploading ? 'Uploading…' : 'Photos'}
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploading}
                onChange={(e) => {
                  const l = e.target.files
                  if (l && l.length) onAttach(l)
                  e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
            </label>
            <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 46, borderRadius: 10, background: '#F1F3F5', border: '1px solid #DCE0E6', fontSize: 14, fontWeight: 600, color: '#1A1D21', cursor: uploading ? 'default' : 'pointer' }}>
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="1.6" strokeLinejoin="round">
                <path d="M4.6 2.8h7l4 4v10.4H4.6z" />
                <path d="M11.4 2.8v4.2h4.2" />
              </svg>
              PDF or file
              <input
                type="file"
                accept="application/pdf,.pdf,.doc,.docx,.xls,.xlsx,image/*"
                multiple
                disabled={uploading}
                onChange={(e) => {
                  const l = e.target.files
                  if (l && l.length) onAttach(l)
                  e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
            </label>
          </span>
        </span>

        <button
          onClick={() => onSave(status, chosen)}
          style={{ width: '100%', minHeight: 52, marginTop: 2, border: 0, borderRadius: 10, background: '#1A1D21', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, letterSpacing: '.03em', color: '#fff', cursor: 'pointer' }}
        >
          SAVE
        </button>
        <button
          onClick={onCancel}
          style={{ width: '100%', minHeight: 46, border: 0, background: 'none', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: '#8B9096', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** One attached file: a thumbnail if it is an image, its name either way. */
function AttachmentTile({ file, onRemove }: { file: AttachmentRow; onRemove: () => void }) {
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
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: '#F8F9FA', border: '1px solid #E7EAEE' }}>
      <span
        onClick={() => viewFile({ url, name: file.name })}
        style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 7, overflow: 'hidden', background: isImage ? 'repeating-linear-gradient(135deg,#E4E7EA 0 6px,#DADEE2 6px 12px)' : '#EEF1F4', cursor: 'pointer' }}
      >
        {isImage && url ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.03em', color: '#5F666E' }}>
            {(file.name.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase()}
          </span>
        )}
      </span>
      <span
        onClick={() => viewFile({ url, name: file.name })}
        style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: s.ink, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {file.name}
      </span>
      <span onClick={onRemove} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, cursor: 'pointer' }}>
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="#9AA1A9" strokeWidth="2" strokeLinecap="round">
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </span>
    </span>
  )
}

// -------------------------------------------------------- project details

interface Contact {
  id: string
  name: string
  role: 'project_manager' | 'supervisor' | 'contract_admin' | 'accounts' | 'estimator' | 'other'
  mobile: string | null
  email: string | null
  note: string | null
}

/**
 * The project, as the client's screen names it: who it is for, where it is,
 * when it runs, and the three people on the builder's side you ring when
 * something is wrong. Everything here is one tap from doing something —
 * the phone numbers dial and the addresses are the addresses.
 */
function ProjectDetails({
  me,
  site,
  office,
  notes,
  onOpenNotes,
}: {
  me: WorkerRow
  site: JobSiteRow
  office: boolean
  notes: NoteRow[]
  onOpenNotes: () => void
}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [dates, setDates] = useState<{ start: string | null; end: string | null }>({ start: null, end: null })
  const [editRow, setEditRow] = useState<EditRow | null>(null)
  const [programmeOpen, setProgrammeOpen] = useState(false)
  const { current: programme, loading: programmeLoading } = useProgrammes(site.id)
  const [shown, setShown] = useState({ client: site.client_name ?? '', address: site.address ?? '' })

  const reloadDetails = useCallback(() => {
    let cancelled = false
    const c = supabase()
    void (async () => {
      /**
       * The job's own fields are re-read rather than taken from the prop.
       * Editing a contact can link this job to a builder for the first time,
       * and editing the dates writes to the row — both of which the copy of
       * the job held further up the tree knows nothing about, so trusting it
       * showed "not set" one second after saving a name.
       */
      const fresh = await c
        .from('job_sites')
        .select('builder_id, supervisor_contact_id, starts_on, ends_on')
        .eq('id', site.id)
        .maybeSingle()
      const job = (fresh.data as Pick<JobSiteRow, 'builder_id' | 'supervisor_contact_id' | 'starts_on' | 'ends_on'> | null) ?? site

      /**
       * The builder's people. The job points at one contact directly (its
       * supervisor); the rest belong to the builder, so the supervisor is
       * also how we find out which builder that is when the job has not been
       * linked to one yet.
       */
      const sup = job.supervisor_contact_id
        ? await c.from('builder_contacts').select('id, name, role, mobile, email, note, builder_id').eq('id', job.supervisor_contact_id).maybeSingle()
        : { data: null }
      const supRow = sup.data as (Contact & { builder_id: string }) | null
      const builderId = job.builder_id ?? supRow?.builder_id ?? null
      const all = builderId
        ? await c.from('builder_contacts').select('id, name, role, mobile, email, note').eq('builder_id', builderId)
        : { data: [] }
      if (cancelled) return
      const rows = (all.data ?? []) as Contact[]
      // The job's own supervisor wins over anyone else holding that role.
      setContacts(supRow ? [supRow, ...rows.filter((r) => r.id !== supRow.id)] : rows)

      // When the job runs, by the same rule the Schedule draws its bar with.
      const [pt, asg, sh] = await Promise.all([
        c.from('programme_tasks').select('starts_on, ends_on').eq('site_id', site.id).eq('is_ours', true),
        c.from('assignments').select('starts_at, ends_at').eq('site_id', site.id),
        c.from('shifts').select('started_at').eq('site_id', site.id),
      ])
      if (cancelled) return
      const span = siteSpan({
        tasks: (pt.data ?? []) as SpanRows['tasks'],
        assignments: (asg.data ?? []) as SpanRows['assignments'],
        shifts: (sh.data ?? []) as SpanRows['shifts'],
        set: { starts_on: job.starts_on, ends_on: job.ends_on },
      })
      // Local parts, not toISOString(): a programme date is a calendar date in
      // Adelaide, and UTC midnight is the previous afternoon here — which
      // printed every start date a day early.
      const iso = (n: number) => {
        const d = new Date(n)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      setDates({ start: span ? iso(span.s) : null, end: span ? iso(span.e) : null })
    })()
    return () => {
      cancelled = true
    }
  }, [site.id, site.supervisor_contact_id, site.builder_id, site.starts_on, site.ends_on])

  useEffect(() => reloadDetails(), [reloadDetails])

  const byRole = (role: Contact['role']) => contacts.find((x) => x.role === role) ?? null
  const longDate = (v: string | null) =>
    v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

  /**
   * One card per fact, as drawn — not one card with hairlines through it. The
   * difference matters on a phone: each row is its own tap target and its own
   * thing, and the ones that go somewhere say so with a chevron.
   */
  const rowCard = (glyph: ReactNode, label: string, body: ReactNode, onTap?: () => void) => (
    <span
      onClick={onTap}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        margin: '0 16px 8px',
        padding: '11px 12px 11px 12px',
        background: '#fff',
        border: '1px solid #E4E7EB',
        borderRadius: 10,
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: '#EDEEF1' }}>
        {glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.005em', color: s.ink }}>{label}</span>
        {body}
      </span>
      {onTap && (
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ flex: 'none' }}>
          <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )

  const value = (v: string) => (
    <span style={{ fontSize: 12, lineHeight: 1.35, color: v === '—' ? '#9AA1A9' : '#6B7278' }}>{v}</span>
  )

  /** Name, then the two ways to reach them side by side, as the client drew. */
  const person = (c: Contact | null, missing: string) =>
    c ? (
      <>
        <span style={{ fontSize: 12, color: '#6B7278' }}>{c.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, minWidth: 0 }}>
          {c.mobile && (
            <a
              href={`tel:${c.mobile.replace(/\s/g, '')}`}
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', fontSize: 11.5, fontWeight: 600, color: s.accent, textDecoration: 'none' }}
            >
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.8" strokeLinejoin="round">
                <path d="M6.4 3.4l2 3-1.6 1.6a9 9 0 0 0 4.2 4.2L12.6 10.6l3 2-1.2 2.4a1.6 1.6 0 0 1-1.8.8C8.4 14.8 5.2 11.6 4.2 6.4a1.6 1.6 0 0 1 .8-1.8z" />
              </svg>
              {c.mobile}
            </a>
          )}
          {c.mobile && c.email && <span style={{ flex: 'none', width: 1, height: 11, background: '#DCE0E6' }} />}
          {c.email && (
            <a
              href={`mailto:${c.email}`}
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, fontSize: 11.5, color: s.accent, textDecoration: 'none' }}
            >
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.8" strokeLinejoin="round" style={{ flex: 'none' }}>
                <rect x="2.8" y="5" width="14.4" height="10" rx="2" />
                <path d="M3.2 6l6.8 5 6.8-5" />
              </svg>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</span>
            </a>
          )}
          {!c.mobile && !c.email && <span style={{ fontSize: 11.5, color: '#9AA1A9' }}>No contact details on file</span>}
        </span>
      </>
    ) : (
      <span style={{ fontSize: 12, color: '#9AA1A9' }}>{missing}</span>
    )

  const glyph = (path: ReactNode) => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      {path}
    </svg>
  )

  /** Directions, because an address on a phone is a place you have to get to. */
  const mapsHref = shown.address
    ? `https://maps.apple.com/?q=${encodeURIComponent(shown.address)}`
    : null

  return (
    <>
      <div style={{ padding: '15px 18px 8px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>PROJECT DETAILS</span>
      </div>

      {(
        <>
          {rowCard(
            glyph(
              <>
                <path d="M4.6 3.4h10.8v13.2H4.6z" />
                <path d="M7.2 6.6h5.6M7.2 9.6h5.6M7.2 12.6h3" />
              </>,
            ),
            'Builder',
            value(shown.client || '—'),
            () => setEditRow('builder'),
          )}

          {rowCard(
            glyph(
              <>
                <path d="M10 17.4S4.6 12.4 4.6 8.6a5.4 5.4 0 0 1 10.8 0c0 3.8-5.4 8.8-5.4 8.8z" />
                <circle cx="10" cy="8.5" r="1.9" />
              </>,
            ),
            'Site address',
            value(shown.address || '—'),
            () => setEditRow('address'),
          )}

          {rowCard(
            glyph(
              <>
                <rect x="3.2" y="4.6" width="13.6" height="12" rx="2" />
                <path d="M3.2 8.2h13.6M6.8 3.2v2.8M13.2 3.2v2.8" />
              </>,
            ),
            'Project dates',
            <span style={{ display: 'flex', gap: 20 }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 11, color: '#9AA1A9' }}>Start date</span>
                {value(longDate(dates.start))}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 11, color: '#9AA1A9' }}>End date</span>
                {value(longDate(dates.end))}
              </span>
            </span>,
            () => setEditRow('dates'),
          )}

          {/* Under the dates, because it is where the dates come from. */}
          {rowCard(
            glyph(
              <>
                <path d="M5 3.4h7.4l2.6 2.6v10.6H5z" />
                <path d="M7.6 8.4h5.2M7.6 11h3.8M7.6 13.4h2.4" />
              </>,
            ),
            "Builder's programme",
            <span style={{ fontSize: 12, lineHeight: 1.35, color: programme ? '#6B7278' : '#9AA1A9' }}>
              {programmeLine(programme, programmeLoading)}
            </span>,
            () => setProgrammeOpen(true),
          )}

          {rowCard(
            glyph(
              <>
                <circle cx="10" cy="7" r="3" />
                <path d="M4.4 16.6a5.6 5.6 0 0 1 11.2 0" />
              </>,
            ),
            'Project manager',
            person(byRole('project_manager'), 'Not set for this job'),
            () => setEditRow('project_manager'),
          )}

          {rowCard(
            glyph(
              <>
                <path d="M3.6 12.4a6.4 6.4 0 0 1 12.8 0z" />
                <path d="M2.6 12.4h14.8M10 6V3.4" />
              </>,
            ),
            'Site supervisor',
            person(byRole('supervisor'), 'Not set for this job'),
            () => setEditRow('supervisor'),
          )}

          {rowCard(
            glyph(
              <>
                <path d="M5.4 3.4h6l3.2 3.2v10.4H5.4z" />
                <path d="M7.8 9h4.4M7.8 12h3" />
              </>,
            ),
            'Contract administrator',
            person(byRole('contract_admin'), 'Not set for this job'),
            () => setEditRow('contract_admin'),
          )}

          {rowCard(
            glyph(
              <>
                <path d="M5 3.4h7.4l2.6 2.6v10.6H5z" />
                <path d="M7.6 8h6M7.6 11h4.4M7.6 13.8h3" />
              </>,
            ),
            'Notes',
            notes.length === 0 ? (
              <span style={{ fontSize: 12, color: '#9AA1A9' }}>Nothing yet</span>
            ) : (
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {notes.slice(0, 3).map((n) => (
                  <span
                    key={n.id}
                    style={{ fontSize: 12, lineHeight: 1.35, color: '#6B7278', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {n.body}
                  </span>
                ))}
                {notes.length > 3 && (
                  <span style={{ fontSize: 11.5, color: '#9AA1A9' }}>+{notes.length - 3} more</span>
                )}
              </span>
            ),
            onOpenNotes,
          )}
        </>
      )}

      {programmeOpen && <ProgrammeSheet me={me} site={site} onClose={() => setProgrammeOpen(false)} />}

      {editRow && (
        <DetailEditor
          row={editRow}
          site={site}
          office={office}
          contact={editRow === 'builder' || editRow === 'address' || editRow === 'dates' ? null : byRole(editRow)}
          mapsHref={mapsHref}
          onClose={() => setEditRow(null)}
          onSaved={(patch) => {
            if (patch) setShown((prev) => ({ ...prev, ...patch }))
            setEditRow(null)
            void reloadDetails()
          }}
        />
      )}
    </>
  )
}

// -------------------------------------------------------- editing a detail

/**
 * Every row on the project details screen opens, on the client's instruction:
 * "I should be able to edit all of these if I tap on the box."
 *
 * One sheet does all seven because they are the same shape — a title, the
 * thing you would do with this fact on site, and the fields behind it. The
 * doing comes first: a supervisor's number is more often rung than corrected,
 * and an address is more often navigated to than retyped.
 */
type EditRow = 'builder' | 'address' | 'dates' | 'project_manager' | 'supervisor' | 'contract_admin'

const EDIT_TITLE: Record<EditRow, string> = {
  builder: 'Builder',
  address: 'Site address',
  dates: 'Project dates',
  project_manager: 'Project manager',
  supervisor: 'Site supervisor',
  contract_admin: 'Contract administrator',
}

function DetailEditor({
  row,
  site,
  office,
  contact,
  mapsHref,
  onClose,
  onSaved,
}: {
  row: EditRow
  site: JobSiteRow
  office: boolean
  contact: Contact | null
  mapsHref: string | null
  onClose: () => void
  onSaved: (patch?: { client?: string; address?: string }) => void
}) {
  const isContact = row === 'project_manager' || row === 'supervisor' || row === 'contract_admin'
  const [builder, setBuilder] = useState(site.client_name ?? '')
  const [address, setAddress] = useState(site.address ?? '')
  const [startOn, setStartOn] = useState(site.starts_on ?? '')
  const [endOn, setEndOn] = useState(site.ends_on ?? '')
  const [name, setName] = useState(contact?.name ?? '')
  const [mobile, setMobile] = useState(contact?.mobile ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * A contact belongs to a builder, and a job that has never been linked to
   * one has nowhere to put a name. So the first contact saved on such a job
   * creates the builder from what the job already calls it, and links them —
   * which is what the office dashboard would have done eventually anyway.
   */
  async function builderIdFor(c: ReturnType<typeof supabase>): Promise<string | null> {
    if (site.builder_id) return site.builder_id
    const named = (site.client_name ?? '').trim()
    if (!named) {
      setError('Set the builder on this job first — a contact has to belong to one.')
      return null
    }
    const found = await c.from('builders').select('id').eq('name', named).maybeSingle()
    let id = (found.data as { id: string } | null)?.id ?? null
    if (!id) {
      const made = await c.from('builders').insert({ company_id: site.company_id, name: named }).select('id').single()
      if (made.error) {
        setError(made.error.message)
        return null
      }
      id = (made.data as { id: string }).id
    }
    const link = await c.from('job_sites').update({ builder_id: id }).eq('id', site.id)
    if (link.error) {
      setError(link.error.message)
      return null
    }
    return id
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const c = supabase()
      if (row === 'builder') {
        const { error: err } = await c.from('job_sites').update({ client_name: builder.trim() || null }).eq('id', site.id)
        if (err) throw new Error(err.message)
        onSaved({ client: builder.trim() })
        return
      }
      if (row === 'address') {
        const { error: err } = await c.from('job_sites').update({ address: address.trim() }).eq('id', site.id)
        if (err) throw new Error(err.message)
        onSaved({ address: address.trim() })
        return
      }
      if (row === 'dates') {
        const { error: err } = await c
          .from('job_sites')
          .update({ starts_on: startOn || null, ends_on: endOn || null })
          .eq('id', site.id)
        if (err) throw new Error(err.message)
        onSaved()
        return
      }

      // A contact. Blank name means "there is nobody in this role" — which is
      // a real answer, and clears the row rather than leaving a ghost.
      if (!name.trim()) {
        if (contact) {
          const { error: err } = await c.from('builder_contacts').delete().eq('id', contact.id)
          if (err) throw new Error(err.message)
        }
        onSaved()
        return
      }
      const builderId = await builderIdFor(c)
      if (!builderId) return
      const patch = { name: name.trim(), mobile: mobile.trim() || null, email: email.trim() || null }
      let contactId = contact?.id ?? null
      if (contactId) {
        const { error: err } = await c.from('builder_contacts').update(patch).eq('id', contactId)
        if (err) throw new Error(err.message)
      } else {
        const { data, error: err } = await c
          .from('builder_contacts')
          .insert({ company_id: site.company_id, builder_id: builderId, role: row, ...patch })
          .select('id')
          .single()
        if (err) throw new Error(err.message)
        contactId = (data as { id: string }).id
      }
      // The job points at its supervisor directly, so that link has to follow.
      if (row === 'supervisor' && contactId !== site.supervisor_contact_id) {
        const { error: err } = await c.from('job_sites').update({ supervisor_contact_id: contactId }).eq('id', site.id)
        if (err) throw new Error(err.message)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const label = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' } as const
  const input = {
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
  const action = {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 11,
    fontFamily: 'inherit',
    fontSize: 14.5,
    fontWeight: 700,
    textDecoration: 'none',
  } as const

  const field = (l: string, v: string, set: (x: string) => void, opts: { type?: string; placeholder?: string; area?: boolean } = {}) => (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={label}>{l}</span>
      {opts.area ? (
        <textarea
          value={v}
          onChange={(e) => set(e.target.value)}
          rows={2}
          placeholder={opts.placeholder}
          disabled={!office}
          style={{ ...input, height: 'auto', padding: '11px 13px', fontFamily: 'inherit', lineHeight: 1.4, resize: 'none' }}
        />
      ) : (
        <input
          type={opts.type ?? 'text'}
          value={v}
          onChange={(e) => set(e.target.value)}
          placeholder={opts.placeholder}
          disabled={!office}
          style={input}
        />
      )}
    </span>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.5)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>{EDIT_TITLE[row]}</span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `15px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>}

            {/* What you would do with this, before what you would change. */}
            {isContact && contact && (contact.mobile || contact.email) && (
              <span style={{ display: 'flex', gap: 10 }}>
                {contact.mobile && (
                  <a href={`tel:${contact.mobile.replace(/\s/g, '')}`} style={{ ...action, background: '#1A1D21', color: '#fff' }}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round">
                      <path d="M6.4 3.4l2 3-1.6 1.6a9 9 0 0 0 4.2 4.2L12.6 10.6l3 2-1.2 2.4a1.6 1.6 0 0 1-1.8.8C8.4 14.8 5.2 11.6 4.2 6.4a1.6 1.6 0 0 1 .8-1.8z" />
                    </svg>
                    Call
                  </a>
                )}
                {contact.email && (
                  <a href={`mailto:${contact.email}`} style={{ ...action, background: '#fff', border: '1px solid #DCE0E6', color: s.accent }}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.accent} strokeWidth="1.7" strokeLinejoin="round">
                      <rect x="2.8" y="5" width="14.4" height="10" rx="2" />
                      <path d="M3.2 6l6.8 5 6.8-5" />
                    </svg>
                    Email
                  </a>
                )}
              </span>
            )}
            {row === 'address' && mapsHref && (
              <a href={mapsHref} target="_blank" rel="noreferrer" style={{ ...action, background: '#1A1D21', color: '#fff' }}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round">
                  <path d="M10 17.4S4.6 12.4 4.6 8.6a5.4 5.4 0 0 1 10.8 0c0 3.8-5.4 8.8-5.4 8.8z" />
                  <circle cx="10" cy="8.5" r="1.9" />
                </svg>
                Directions
              </a>
            )}

            {row === 'builder' && field('BUILDER', builder, setBuilder, { placeholder: 'Who the job is for' })}
            {row === 'address' && field('SITE ADDRESS', address, setAddress, { area: true, placeholder: 'Street, suburb, state, postcode' })}
            {row === 'dates' && (
              <>
                {field('START DATE', startOn, setStartOn, { type: 'date' })}
                {field('END DATE', endOn, setEndOn, { type: 'date' })}
                <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                  Leave both blank and the dates come off the builder's programme, or off when the
                  crew is booked when there is no programme. Fill them in and they are the job's
                  dates everywhere — here and on the schedule.
                </span>
              </>
            )}
            {isContact && (
              <>
                {field('NAME', name, setName, { placeholder: 'Their name' })}
                {field('MOBILE', mobile, setMobile, { type: 'tel', placeholder: '04…' })}
                {field('EMAIL', email, setEmail, { type: 'email', placeholder: 'name@builder.com.au' })}
                <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                  {contact
                    ? 'Clearing the name removes them from this job.'
                    : 'Saved against the builder, so the same person shows on every job of theirs.'}
                </span>
              </>
            )}

            {office ? (
              <button
                disabled={busy}
                onClick={() => void save()}
                style={{ width: '100%', height: 48, border: 0, borderRadius: 10, background: '#1A1D21', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, letterSpacing: '.03em', color: '#fff', opacity: busy ? 0.6 : 1, cursor: 'pointer' }}
              >
                {busy ? 'SAVING…' : 'SAVE'}
              </button>
            ) : (
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                The office keeps these up to date. If something here is wrong, say so in the job
                chat — it is quicker than it reaching them any other way.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
