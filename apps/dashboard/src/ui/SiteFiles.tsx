import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../data/supabase'
import type { SiteFileRow, WorkerRow } from '../data/supabase'
import { BUCKET_FILES, objectPath, removeFile, signedUrl, uploadFile } from '../data/storage'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Job site folder — photos and plans/docs, both backed by the same site_files
 * table (kind='photo' | 'document'). Photos are tagged after the fact from
 * the lightbox rather than at upload time, matching how a crew actually
 * dumps a phone's camera roll and sorts it later. Documents instead carry a
 * version chain: uploading a file with a name that matches an existing doc
 * links the new row to the old one via `supersedes` rather than replacing it,
 * so nothing on a job site is ever silently gone.
 */

const MAX_BYTES = 25 * 1024 * 1024

const PHOTO_CATEGORIES = ['progress', 'issue', 'before', 'after', 'inspection'] as const
type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]

const DOC_CATEGORIES = ['plan', 'permit', 'drawing', 'change_order', 'survey', 'other'] as const
type DocCategory = (typeof DOC_CATEGORIES)[number]

const CATEGORY_LABEL: Record<string, string> = {
  progress: 'Progress',
  issue: 'Issue',
  before: 'Before',
  after: 'After',
  inspection: 'Inspection',
  plan: 'Plan',
  permit: 'Permit',
  drawing: 'Drawing',
  change_order: 'Change Order',
  survey: 'Survey',
  other: 'Other',
}

function formatSize(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface UploadTask {
  id: string
  name: string
  status: 'uploading' | 'done' | 'error'
  message?: string
}

export function SiteFiles({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [tab, setTab] = useState<'photos' | 'docs'>('photos')
  const [rows, setRows] = useState<SiteFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sites.length && !sites.some((s) => s.id === siteId)) setSiteId(sites[0].id)
  }, [sites, siteId])

  const load = useCallback(async () => {
    if (!siteId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase()
      .from('site_files')
      .select('*')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setRows((data ?? []) as SiteFileRow[])
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  const workerName = useCallback(
    (id: string | null) => workers.find((w) => w.id === id)?.name ?? 'Unknown',
    [workers],
  )
  const workerInitials = useCallback(
    (id: string | null) => workers.find((w) => w.id === id)?.initials ?? '?',
    [workers],
  )

  const photos = useMemo(() => rows.filter((r) => r.kind === 'photo'), [rows])
  const docs = useMemo(() => rows.filter((r) => r.kind === 'document'), [rows])

  async function afterWrite() {
    await load()
    onChanged()
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Site Files</h1>
          {sites.length > 0 ? (
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              style={{ ...selectStyle, marginLeft: 4 }}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 13, color: theme.inkSoft }}>No job sites yet</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 22, marginTop: 18, borderBottom: `1px solid ${theme.border}` }}>
          <button onClick={() => setTab('photos')} style={tabStyle(tab === 'photos')}>
            Photos{photos.length > 0 ? ` · ${photos.length}` : ''}
          </button>
          <button onClick={() => setTab('docs')} style={tabStyle(tab === 'docs')}>
            Plans &amp; Docs{docs.length > 0 ? ` · ${docs.length}` : ''}
          </button>
        </div>

        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: theme.alert }}>{error}</div>}

        {!siteId ? (
          <div style={{ marginTop: 20, fontSize: 13, color: theme.inkSoft, lineHeight: 1.6 }}>
            Add a job site first — files are organized by site.
          </div>
        ) : loading ? (
          <div style={{ marginTop: 20, fontSize: 13, color: theme.inkSoft }}>Loading…</div>
        ) : tab === 'photos' ? (
          <PhotosTab
            me={me}
            siteId={siteId}
            rows={photos}
            workerName={workerName}
            workerInitials={workerInitials}
            onChanged={afterWrite}
          />
        ) : (
          <DocsTab me={me} siteId={siteId} rows={docs} workerName={workerName} onChanged={afterWrite} />
        )}
      </div>
    </div>
  )
}

// -------------------------------------------------------------- photos tab

function PhotosTab({ me, siteId, rows, workerName, workerInitials, onChanged }: {
  me: WorkerRow
  siteId: string
  rows: SiteFileRow[]
  workerName: (id: string | null) => string
  workerInitials: (id: string | null) => string
  onChanged: () => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | PhotoCategory>('all')
  const [dragging, setDragging] = useState(false)
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [selected, setSelected] = useState<SiteFileRow | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.category === filter)),
    [rows, filter],
  )

  const groups = useMemo(() => {
    const map = new Map<string, SiteFileRow[]>()
    for (const row of filtered) {
      const key = new Date(row.taken_at ?? row.created_at).toDateString()
      const list = map.get(key)
      if (list) list.push(row)
      else map.set(key, [row])
    }
    return [...map.entries()]
  }, [filtered])

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    for (const file of list) {
      const id = crypto.randomUUID()
      setTasks((t) => [...t, { id, name: file.name, status: 'uploading' }])
      if (file.size > MAX_BYTES) {
        setTasks((t) =>
          t.map((x) => (x.id === id ? { ...x, status: 'error', message: 'Too large — 25 MB max' } : x)),
        )
        continue
      }
      try {
        const path = objectPath(me.company_id, siteId, file.name)
        await uploadFile(BUCKET_FILES, path, file)
        const { error: err } = await supabase()
          .from('site_files')
          .insert({
            company_id: me.company_id,
            site_id: siteId,
            uploaded_by: me.id,
            kind: 'photo',
            storage_path: path,
            name: file.name,
            mime: file.type || null,
            size_bytes: file.size,
            category: null,
            taken_at: new Date().toISOString(),
          })
        if (err) throw new Error(err.message)
        setTasks((t) => t.map((x) => (x.id === id ? { ...x, status: 'done' } : x)))
      } catch (e) {
        setTasks((t) =>
          t.map((x) =>
            x.id === id
              ? { ...x, status: 'error', message: e instanceof Error ? e.message : 'Upload failed' }
              : x,
          ),
        )
      }
    }
    await onChanged()
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          marginTop: 14,
          padding: 24,
          textAlign: 'center',
          borderRadius: 8,
          border: `2px dashed ${dragging ? theme.accent : theme.border}`,
          background: dragging ? theme.accentFill : theme.panel,
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 500 }}>Drag photos here, or click to select</div>
        <div style={{ fontSize: 11.5, color: theme.inkFaint, marginTop: 4 }}>
          Images only — up to 25 MB each
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files)
            e.target.value = ''
          }}
          style={{ display: 'none' }}
        />
      </div>

      <TaskList tasks={tasks} onDismiss={(id) => setTasks((t) => t.filter((x) => x.id !== id))} />

      <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={pillStyle(filter === 'all')}>
          All
        </button>
        {PHOTO_CATEGORIES.map((c) => (
          <button key={c} onClick={() => setFilter(c)} style={pillStyle(filter === c)}>
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      {groups.length === 0 && (
        <div style={{ marginTop: 20, fontSize: 13, color: theme.inkSoft }}>
          No photos {filter === 'all' ? 'yet' : `tagged ${CATEGORY_LABEL[filter]}`}.
        </div>
      )}

      {groups.map(([dateKey, list]) => (
        <div key={dateKey} style={{ marginTop: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: theme.inkFaint,
            }}
          >
            {new Date(dateKey).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 10,
              marginTop: 8,
            }}
          >
            {list.map((row) => (
              <PhotoTile
                key={row.id}
                row={row}
                initials={workerInitials(row.uploaded_by)}
                onClick={() => setSelected(row)}
              />
            ))}
          </div>
        </div>
      ))}

      {selected && (
        <PhotoLightbox
          me={me}
          row={selected}
          workerName={workerName}
          onClose={() => setSelected(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

function PhotoTile({ row, initials, onClick }: { row: SiteFileRow; initials: string; onClick: () => void }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void signedUrl(BUCKET_FILES, row.storage_path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [row.storage_path])

  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        padding: 0,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: theme.panel,
        cursor: 'pointer',
        aspectRatio: '1 / 1',
      }}
    >
      {url ? (
        <img
          src={url}
          alt={row.caption ?? row.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: theme.inkFaint,
          }}
        >
          Loading…
        </div>
      )}
      {row.category === 'issue' && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: theme.alert,
            border: `1.5px solid ${theme.panel}`,
          }}
        />
      )}
      <span
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '4px 6px',
          background: 'linear-gradient(0deg, rgba(0,0,0,.62), transparent)',
          color: '#fff',
          fontSize: 10.5,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{initials}</span>
        <span>{new Date(row.taken_at ?? row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      </span>
    </button>
  )
}

function PhotoLightbox({ me, row, workerName, onClose, onChanged }: {
  me: WorkerRow
  row: SiteFileRow
  workerName: (id: string | null) => string
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState(row.caption ?? '')
  const [category, setCategory] = useState<PhotoCategory>((row.category as PhotoCategory) ?? 'progress')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void signedUrl(BUCKET_FILES, row.storage_path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [row.storage_path])

  async function save() {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase()
      .from('site_files')
      .update({ caption: caption.trim() || null, category })
      .eq('id', row.id)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    await onChanged()
    onClose()
  }

  async function remove() {
    if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return
    setDeleting(true)
    setError(null)
    try {
      await removeFile(BUCKET_FILES, row.storage_path)
      const { error: err } = await supabase().from('site_files').delete().eq('id', row.id)
      if (err) throw new Error(err.message)
      await onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this photo.')
      setDeleting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.6)',
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
          overflow: 'hidden',
          display: 'flex',
          flexWrap: 'wrap',
          maxWidth: 920,
          width: '100%',
          maxHeight: '88vh',
        }}
      >
        <div
          style={{
            flex: '1 1 480px',
            background: '#0B0C0D',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 320,
          }}
        >
          {url ? (
            <img src={url} alt={row.name} style={{ maxWidth: '100%', maxHeight: '88vh', display: 'block' }} />
          ) : (
            <div style={{ color: '#fff', fontSize: 12 }}>Loading…</div>
          )}
        </div>
        <div style={{ flex: '0 0 280px', padding: 16, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>{row.name}</div>
          <div style={{ fontSize: 11.5, color: theme.inkSoft, marginTop: 2 }}>
            {workerName(row.uploaded_by)} · {new Date(row.taken_at ?? row.created_at).toLocaleDateString()}
          </div>

          <label style={fieldLabel}>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PhotoCategory)}
              style={fieldInput}
            >
              {PHOTO_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldLabel}>
            Caption
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder="Add a note about this photo…"
              style={{ ...fieldInput, height: 'auto', padding: 8, resize: 'vertical' }}
            />
          </label>

          {error && <div style={{ marginTop: 8, fontSize: 12, color: theme.alert }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 14 }}>
            <button onClick={() => void save()} disabled={saving} style={cta}>
              {saving ? 'SAVING…' : 'SAVE'}
            </button>
            <button onClick={onClose} style={ghost}>
              Close
            </button>
            {me.is_office && (
              <button
                onClick={() => void remove()}
                disabled={deleting}
                style={{ ...ghost, marginLeft: 'auto', color: theme.alert }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- docs tab

function DocsTab({ me, siteId, rows, workerName, onChanged }: {
  me: WorkerRow
  siteId: string
  rows: SiteFileRow[]
  workerName: (id: string | null) => string
  onChanged: () => Promise<void>
}) {
  const [category, setCategory] = useState<DocCategory>('plan')
  const [versionLabel, setVersionLabel] = useState('')
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const supersededIds = useMemo(
    () => new Set(rows.map((r) => r.supersedes).filter((id): id is string => Boolean(id))),
    [rows],
  )
  const current = useMemo(
    () =>
      rows
        .filter((r) => !supersededIds.has(r.id))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [rows, supersededIds],
  )

  function olderVersions(row: SiteFileRow): SiteFileRow[] {
    const chain: SiteFileRow[] = []
    let cursor = row.supersedes
    while (cursor) {
      const prev = byId.get(cursor)
      if (!prev) break
      chain.push(prev)
      cursor = prev.supersedes
    }
    return chain
  }

  async function download(row: SiteFileRow) {
    const url = await signedUrl(BUCKET_FILES, row.storage_path)
    if (url) window.open(url, '_blank')
    else setError("Couldn't generate a download link — try again.")
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter(
      (f) => f.type === 'application/pdf' || f.type.startsWith('image/'),
    )
    for (const file of list) {
      const id = crypto.randomUUID()
      setTasks((t) => [...t, { id, name: file.name, status: 'uploading' }])
      if (file.size > MAX_BYTES) {
        setTasks((t) =>
          t.map((x) => (x.id === id ? { ...x, status: 'error', message: 'Too large — 25 MB max' } : x)),
        )
        continue
      }
      try {
        // Same name as an existing current doc → link as a new version instead
        // of sitting beside it unrelated.
        const previous = current.find(
          (r) => r.name.trim().toLowerCase() === file.name.trim().toLowerCase(),
        )
        const path = objectPath(me.company_id, siteId, file.name)
        await uploadFile(BUCKET_FILES, path, file)
        const { error: err } = await supabase()
          .from('site_files')
          .insert({
            company_id: me.company_id,
            site_id: siteId,
            uploaded_by: me.id,
            kind: 'document',
            storage_path: path,
            name: file.name,
            mime: file.type || null,
            size_bytes: file.size,
            category,
            version: versionLabel.trim() || null,
            supersedes: previous?.id ?? null,
          })
        if (err) throw new Error(err.message)
        setTasks((t) => t.map((x) => (x.id === id ? { ...x, status: 'done' } : x)))
      } catch (e) {
        setTasks((t) =>
          t.map((x) =>
            x.id === id
              ? { ...x, status: 'error', message: e instanceof Error ? e.message : 'Upload failed' }
              : x,
          ),
        )
      }
    }
    setVersionLabel('')
    await onChanged()
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          marginTop: 14,
          padding: 14,
          background: theme.panel,
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
        }}
      >
        <label style={fieldLabel}>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as DocCategory)} style={fieldInput}>
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldLabel}>
          Version label (optional)
          <input
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder="Rev C"
            style={{ ...fieldInput, width: 150 }}
          />
        </label>
        <button onClick={() => inputRef.current?.click()} style={cta}>
          UPLOAD FILE
        </button>
        <span style={{ fontSize: 11, color: theme.inkFaint }}>PDF or image, up to 25 MB</span>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf,image/*"
          multiple
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files)
            e.target.value = ''
          }}
          style={{ display: 'none' }}
        />
      </div>

      <TaskList tasks={tasks} onDismiss={(id) => setTasks((t) => t.filter((x) => x.id !== id))} />
      {error && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{error}</div>}

      <div style={{ marginTop: 16, background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name', 'Category', 'Version', 'Uploaded by', 'Date', 'Size', ''].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {current.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                  No plans or documents yet.
                </td>
              </tr>
            )}
            {current.map((row) => {
              const older = olderVersions(row)
              const expanded = expandedId === row.id
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td style={{ ...td, fontWeight: 500 }}>{row.name}</td>
                    <td style={td}>{row.category ? CATEGORY_LABEL[row.category] ?? row.category : '—'}</td>
                    <td style={td}>{row.version ? <span style={versionBadge}>{row.version}</span> : '—'}</td>
                    <td style={{ ...td, color: theme.inkSoft }}>{workerName(row.uploaded_by)}</td>
                    <td style={td}>{new Date(row.created_at).toLocaleDateString()}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{formatSize(row.size_bytes)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => void download(row)} style={ghost}>
                        Download
                      </button>
                    </td>
                  </tr>
                  {older.length > 0 && (
                    <tr>
                      <td colSpan={7} style={{ ...td, paddingTop: 0 }}>
                        <button onClick={() => setExpandedId(expanded ? null : row.id)} style={linkBtn}>
                          {expanded ? 'Hide older versions' : `${older.length} older version${older.length > 1 ? 's' : ''}`}
                        </button>
                        {expanded && (
                          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {older.map((o) => (
                              <div
                                key={o.id}
                                style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: theme.inkSoft }}
                              >
                                <span style={{ width: 80 }}>{o.version ?? '—'}</span>
                                <span style={{ flex: 1 }}>{workerName(o.uploaded_by)}</span>
                                <span>{new Date(o.created_at).toLocaleDateString()}</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatSize(o.size_bytes)}</span>
                                <button onClick={() => void download(o)} style={{ ...ghost, padding: '2px 8px', fontSize: 10.5 }}>
                                  Download
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- shared

function TaskList({ tasks, onDismiss }: { tasks: UploadTask[]; onDismiss: (id: string) => void }) {
  if (tasks.length === 0) return null
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {tasks.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span
            style={{
              width: 7,
              height: 7,
              flex: 'none',
              borderRadius: '50%',
              background: t.status === 'done' ? theme.success : t.status === 'error' ? theme.alert : theme.warning,
            }}
          />
          <span style={{ flex: 1 }}>{t.name}</span>
          <span style={{ color: t.status === 'error' ? theme.alert : theme.inkSoft }}>
            {t.status === 'uploading' ? 'Uploading…' : t.status === 'done' ? 'Done' : t.message ?? 'Failed'}
          </span>
          {t.status !== 'uploading' && (
            <button onClick={() => onDismiss(t.id)} style={{ ...ghost, padding: '1px 7px', fontSize: 10.5 }}>
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function tabStyle(active: boolean) {
  return {
    padding: '8px 0',
    marginBottom: -1,
    border: 'none',
    borderBottom: active ? `2px solid ${theme.accent}` : '2px solid transparent',
    background: 'transparent',
    font: 'inherit',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? theme.ink : theme.inkSoft,
    cursor: 'pointer',
  } as const
}

function pillStyle(active: boolean) {
  return {
    padding: '4px 10px',
    borderRadius: 12,
    border: `1px solid ${active ? theme.accent : theme.border}`,
    background: active ? theme.accentFill : theme.panel,
    color: active ? theme.accent : theme.inkSoft,
    font: 'inherit',
    fontSize: 11.5,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
  } as const
}

const th = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  background: theme.appBg,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  textAlign: 'left' as const,
}

const td = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 13,
}

const ghost = {
  padding: '4px 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
}

const cta = {
  padding: '7px 13px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}

const selectStyle = {
  height: 30,
  padding: '0 8px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 12.5,
  color: theme.ink,
} as const

const fieldLabel = {
  display: 'block',
  marginTop: 10,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
}

const fieldInput = {
  display: 'block',
  width: '100%',
  height: 32,
  padding: '0 9px',
  marginTop: 4,
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const versionBadge = {
  display: 'inline-block',
  padding: '1px 7px',
  borderRadius: 3,
  fontSize: 10.5,
  fontWeight: 700,
  background: theme.accentFill,
  color: theme.accent,
} as const

const linkBtn = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: theme.accent,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
} as const
