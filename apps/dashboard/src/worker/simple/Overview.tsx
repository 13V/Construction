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
import { PlansScreen } from '../PlansScreen'
import { WaterproofingButton, WaterproofingSheet } from './Waterproofing'
import { s } from './stheme'

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

export function OverviewTab({ me, site }: { me: WorkerRow; site: JobSiteRow }) {
  const office = me.is_office
  const [rows, setRows] = useState<SelectionRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [open, setOpen] = useState<{ line: ScopeLine; row: SelectionRow | null } | null>(null)
  const [wetOpen, setWetOpen] = useState(false)
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
    const { error: err } = await supabase().from('site_files').delete().eq('id', id)
    if (err) {
      setError(err.message)
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
    const { error: err } = await supabase().from('site_notes').delete().eq('id', id)
    if (err) {
      setError(err.message)
      return
    }
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', paddingBottom: 26 }}>
      {/* Drawings first — the sheet is what everything below describes. */}
      <span style={sectionLabel}>DRAWINGS</span>
      <div style={{ margin: '0 18px', ...card }}>
        <PlansScreen me={me} siteId={site.id} siteName={site.name} embedded onClose={() => {}} />
      </div>

      {/* Waterproofing under the drawings, as one door rather than a list —
          it is the thing that holds up every claim, so it gets the weight. */}
      <span style={sectionLabel}>WATERPROOFING</span>
      <WaterproofingButton site={site} onOpen={() => setWetOpen(true)} />

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

        {/* The tally the client drew under the list. */}
        <span style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid #E1E5E9', background: '#FAFBFC' }}>
          {(['chosen', 'pending', 'not_applicable'] as const).map((k, i) => (
            <span key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '11px 4px', borderLeft: i === 0 ? 'none' : '1px solid #E9EDF0' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: STATUS_META[k].fg }}>
                {STATUS_META[k].glyph}
                {STATUS_META[k].label}
              </span>
              <span style={{ fontSize: 15, fontWeight: 700, color: s.ink }}>{counts[k]}</span>
            </span>
          ))}
        </span>
      </div>

      {!office && (
        <span style={{ display: 'block', padding: '9px 18px 0', fontSize: 12.5, lineHeight: 1.45, color: '#8B9096' }}>
          The office confirms these. Anything wrong or missing, say so in the job chat.
        </span>
      )}

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

      <ProjectDetails site={site} office={office} />

      {error && (
        <span style={{ display: 'block', padding: '12px 18px 0', fontSize: 13, lineHeight: 1.45, color: '#A3282E' }}>{error}</span>
      )}

      {wetOpen && <WaterproofingSheet me={me} site={site} onClose={() => setWetOpen(false)} />}

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
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 7, overflow: 'hidden', background: isImage ? 'repeating-linear-gradient(135deg,#E4E7EA 0 6px,#DADEE2 6px 12px)' : '#EEF1F4', textDecoration: 'none' }}
      >
        {isImage && url ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.03em', color: '#5F666E' }}>
            {(file.name.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase()}
          </span>
        )}
      </a>
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: s.ink, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {file.name}
      </a>
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
  name: string
  role: string | null
  mobile: string | null
  email: string | null
}

/**
 * Who and where — assembled from what the job already knows: the builder's
 * supervisor from `builder_contacts`, the crew captain as the job's manager
 * with the mobile they set on their own profile.
 */
function ProjectDetails({ site, office }: { site: JobSiteRow; office: boolean }) {
  const [supervisor, setSupervisor] = useState<Contact | null>(null)
  const [manager, setManager] = useState<Contact | null>(null)
  const [editing, setEditing] = useState(false)
  const [client, setClient] = useState(site.client_name ?? '')
  const [address, setAddress] = useState(site.address ?? '')
  const [shown, setShown] = useState({ client: site.client_name ?? '', address: site.address ?? '' })
  const [saveError, setSaveError] = useState<string | null>(null)

  async function saveDetails() {
    setSaveError(null)
    const { error } = await supabase()
      .from('job_sites')
      .update({ client_name: client.trim() || null, address: address.trim() })
      .eq('id', site.id)
    if (error) {
      setSaveError(error.message)
      return
    }
    setShown({ client: client.trim(), address: address.trim() })
    setEditing(false)
  }

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void (async () => {
      const [sup, cap] = await Promise.all([
        site.supervisor_contact_id
          ? client.from('builder_contacts').select('name, role, mobile, email').eq('id', site.supervisor_contact_id).maybeSingle()
          : Promise.resolve({ data: null }),
        site.captain_id
          ? client.from('workers').select('id, name, trade').eq('id', site.captain_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      setSupervisor((sup.data as Contact | null) ?? null)
      const capRow = cap.data as { id: string; name: string; trade: string } | null
      if (!capRow) return
      const { data: prof } = await client.from('worker_profiles').select('phone').eq('worker_id', capRow.id).maybeSingle()
      if (cancelled) return
      setManager({
        name: capRow.name,
        role: capRow.trade || 'Crew captain',
        mobile: (prof as { phone: string | null } | null)?.phone ?? null,
        email: null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [site.supervisor_contact_id, site.captain_id])

  const row = (label: string, glyph: ReactNode, body: ReactNode) => (
    <span style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 15px', borderBottom: '1px solid #EDEFF1' }}>
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, marginTop: 1 }}>{glyph}</span>
      <span style={{ flex: 'none', width: 88, fontSize: 12.5, color: '#7B838B', paddingTop: 2 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 14, color: s.ink }}>{body}</span>
    </span>
  )

  const pin = (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#8B9096" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M10 17.4S4.6 12.4 4.6 8.6a5.4 5.4 0 0 1 10.8 0c0 3.8-5.4 8.8-5.4 8.8z" />
      <circle cx="10" cy="8.5" r="1.9" />
    </svg>
  )

  const contactBlock = (c: Contact) => (
    <>
      <span style={{ fontWeight: 600 }}>{c.name}</span>
      {c.email && (
        <a href={`mailto:${c.email}`} style={{ fontSize: 13, color: s.accent, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {c.email}
        </a>
      )}
      {c.mobile && (
        <a href={`tel:${c.mobile.replace(/\s/g, '')}`} style={{ fontSize: 13, fontWeight: 600, color: s.accent, textDecoration: 'none' }}>
          {c.mobile}
        </a>
      )}
      {!c.email && !c.mobile && <span style={{ fontSize: 13, color: '#9AA1A9' }}>No contact details on file</span>}
    </>
  )

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '18px 18px 9px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>PROJECT DETAILS</span>
        {office && !editing && (
          <span onClick={() => setEditing(true)} style={{ fontSize: 13.5, fontWeight: 600, color: s.accent, cursor: 'pointer' }}>
            Edit details
          </span>
        )}
      </div>
      <div style={{ margin: '0 18px', ...card }}>
        {editing ? (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 15px 16px' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' }}>CLIENT</span>
              <input
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="Who the job is for"
                style={{ width: '100%', height: 48, padding: '0 13px', boxSizing: 'border-box', background: '#F5F6F7', border: '1px solid #DCE0E6', borderRadius: 10, font: 'inherit', fontSize: 16, color: s.ink, outline: 'none' }}
              />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' }}>ADDRESS</span>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
                placeholder="Street, suburb, state, postcode"
                style={{ width: '100%', padding: '11px 13px', boxSizing: 'border-box', background: '#F5F6F7', border: '1px solid #DCE0E6', borderRadius: 10, fontFamily: 'inherit', fontSize: 16, lineHeight: 1.4, color: s.ink, resize: 'none', outline: 'none' }}
              />
            </span>
            {saveError && <span style={{ fontSize: 13, color: '#A3282E' }}>{saveError}</span>}
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#8B9096' }}>
              The supervisor and job manager are set where the job is set up, on the office
              dashboard — this keeps one list of contacts rather than two.
            </span>
            <span style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={() => void saveDetails()}
                style={{ flex: 1, height: 46, border: 0, borderRadius: 10, background: '#1A1D21', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, letterSpacing: '.03em', color: '#fff', cursor: 'pointer' }}
              >
                SAVE DETAILS
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setClient(shown.client)
                  setAddress(shown.address)
                  setSaveError(null)
                }}
                style={{ flex: 'none', height: 46, padding: '0 16px', border: '1px solid #DCE0E6', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: '#4A5057', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </span>
          </span>
        ) : (
          <>
        {row(
          'Client',
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#8B9096" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M4.6 3.4h10.8v13.2H4.6z" />
            <path d="M7.2 6.6h5.6M7.2 9.6h5.6M7.2 12.6h3" />
          </svg>,
          <span style={{ fontWeight: 600 }}>{shown.client || '—'}</span>,
        )}
        {row('Address', pin, <span style={{ lineHeight: 1.4 }}>{shown.address || '—'}</span>)}
        {row(
          'Site supervisor',
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#8B9096" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M3.6 9.4a6.4 6.4 0 0 1 12.8 0z" />
            <path d="M2.6 9.4h14.8" />
          </svg>,
          supervisor ? contactBlock(supervisor) : <span style={{ fontSize: 13, color: '#9AA1A9' }}>Not set for this job</span>,
        )}
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 15px' }}>
          <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, marginTop: 1 }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#8B9096" strokeWidth="1.6" strokeLinejoin="round">
              <circle cx="10" cy="6.8" r="2.9" />
              <path d="M4.4 16.4a5.6 5.6 0 0 1 11.2 0z" />
            </svg>
          </span>
          <span style={{ flex: 'none', width: 88, fontSize: 12.5, color: '#7B838B', paddingTop: 2 }}>Job manager</span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 14, color: s.ink }}>
            {manager ? contactBlock(manager) : <span style={{ fontSize: 13, color: '#9AA1A9' }}>No captain on this job</span>}
          </span>
        </span>
          </>
        )}
      </div>
    </>
  )
}
