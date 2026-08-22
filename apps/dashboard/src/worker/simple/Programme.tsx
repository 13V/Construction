/**
 * The builder's programme — the PDF they issue and keep reissuing.
 *
 * "Can we add builders program as a PDF, and can be updated as they update
 * it." The second half is the whole problem: a builder does not send one
 * programme, they send Rev A in June and Rev C in August, and the damage is
 * done by a crew working to a revision that was replaced three weeks ago.
 *
 * So a new upload does not overwrite the old one — it supersedes it. The
 * database enforces exactly one current programme per job (a trigger from
 * schema_v21), the sheet shows which that is, and every revision before it
 * stays readable underneath, marked as replaced.
 *
 * The file goes in `programmes.storage_path` rather than becoming a site_files
 * row: the drawing register lists every document on a job, and a programme is
 * not a drawing to build from.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { BUCKET_FILES, objectPath, signedUrl, uploadFile } from '../../data/storage'
import { s, SAFE_BOTTOM } from './stheme'
import { viewFile } from './FileViewer'

export interface ProgrammeRow {
  id: string
  name: string
  revision: string | null
  issued_on: string | null
  received_on: string
  storage_path: string | null
  status: 'draft' | 'current' | 'superseded'
}

const COLS = 'id, name, revision, issued_on, received_on, storage_path, status'
const LOCALE = 'en-AU'
const shortDate = (v: string | null) =>
  v ? new Date(v.length > 10 ? v : `${v}T00:00:00`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useProgrammes(siteId: string) {
  const [rows, setRows] = useState<ProgrammeRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await supabase()
      .from('programmes')
      .select(COLS)
      .eq('site_id', siteId)
      .order('received_on', { ascending: false })
      .order('created_at', { ascending: false })
    setRows((data ?? []) as unknown as ProgrammeRow[])
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  const current = rows.find((r) => r.status === 'current') ?? null
  const history = rows.filter((r) => r.id !== current?.id)
  return { rows, current, history, loading, reload: load }
}

/** What the row on project details says without opening anything. */
export function programmeLine(current: ProgrammeRow | null, loading: boolean): string {
  if (loading) return ' '
  if (!current) return 'Not uploaded yet'
  return [current.revision?.trim() || null, `received ${shortDate(current.received_on)}`].filter(Boolean).join(' · ')
}

const card = { background: '#fff', border: '1px solid #E4E7EB', borderRadius: 11 } as const
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

/**
 * Every revision this job has been sent, newest first, with the current one
 * separated out — because "which one are we building to" is the only question
 * this screen exists to answer.
 */
export function ProgrammeSheet({
  me,
  site,
  onClose,
}: {
  me: WorkerRow
  site: JobSiteRow
  onClose: () => void
}) {
  const { current, history, loading, reload } = useProgrammes(site.id)
  const [revision, setRevision] = useState('')
  const [issuedOn, setIssuedOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Matches the table's own rule: the office, or the captain running this job.
  const canWrite = me.is_office || site.captain_id === me.id

  async function upload(list: FileList) {
    const file = list[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const path = objectPath(me.company_id, site.id, file.name)
      await uploadFile(BUCKET_FILES, path, file)
      // status 'current' fires the trigger that supersedes whatever was
      // current before, so the previous revision is demoted rather than lost.
      const { error: err } = await supabase().from('programmes').insert({
        company_id: me.company_id,
        site_id: site.id,
        name: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '),
        revision: revision.trim() || null,
        issued_on: issuedOn || null,
        received_on: todayISO(),
        source: 'pdf',
        storage_path: path,
        status: 'current',
        imported_by: me.id,
      })
      if (err) throw new Error(err.message)
      setRevision('')
      setIssuedOn('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that programme.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.5)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>Builder's programme</span>
            <span style={{ fontSize: 12.5, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
          </span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `15px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>}

            <span style={label}>CURRENT REVISION</span>
            {loading ? (
              <span style={{ ...card, padding: '15px', fontSize: 13.5, color: '#7B838B' }}>Loading…</span>
            ) : current ? (
              <ProgrammeCard row={current} current />
            ) : (
              <span style={{ ...card, padding: '15px', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
                Nothing here yet. When the builder issues a programme, put the PDF up and every
                revision after it stacks on top — the crew always opens the one that counts.
              </span>
            )}

            {canWrite && (
              <>
                <span style={{ ...label, marginTop: 4 }}>{current ? 'UPLOAD A NEW REVISION' : 'UPLOAD THE PROGRAMME'}</span>
                <span style={{ display: 'flex', gap: 9 }}>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#9AA1A9' }}>Revision</span>
                    <input value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="Rev C" style={input} />
                  </span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#9AA1A9' }}>Issued</span>
                    <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} style={input} />
                  </span>
                </span>
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 5,
                    padding: '17px 16px',
                    border: '1.5px dashed #C9CFD6',
                    borderRadius: 12,
                    background: '#FBFCFD',
                    cursor: 'pointer',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <input
                    type="file"
                    accept="application/pdf,image/*"
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
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: s.accent }}>{busy ? 'Uploading…' : 'Choose the PDF'}</span>
                  </span>
                  <span style={{ fontSize: 11.5, color: '#9AA1A9' }}>
                    {current ? 'The one above becomes superseded' : 'PDF or a photo of the printed programme'}
                  </span>
                </label>
              </>
            )}

            {!canWrite && (
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                The office and the job's captain put the programme up. If the builder has issued a
                newer revision than the one above, say so in the job chat.
              </span>
            )}

            {history.length > 0 && (
              <>
                <span style={{ ...label, marginTop: 4 }}>SUPERSEDED — DO NOT WORK TO THESE</span>
                {history.map((r) => (
                  <ProgrammeCard key={r.id} row={r} current={false} />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** One revision. Tapping it opens the PDF the builder actually sent. */
function ProgrammeCard({ row, current }: { row: ProgrammeRow; current: boolean }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!row.storage_path) return
    void signedUrl(BUCKET_FILES, row.storage_path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [row.storage_path])

  return (
    <span
      onClick={() => viewFile({ url, name: `${row.revision?.trim() || row.name}.pdf` })}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '12px 13px',
        background: current ? '#fff' : '#FAFBFC',
        border: `1px solid ${current ? '#E4E7EB' : '#E9EDF0'}`,
        borderRadius: 11,
        cursor: 'pointer',
      }}
    >
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 8, background: current ? '#EDEEF1' : '#F1F3F5' }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.03em', color: current ? '#5F666E' : '#9AA1A9' }}>PDF</span>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-.005em', color: current ? s.ink : '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.revision?.trim() || row.name}
        </span>
        <span style={{ fontSize: 12, lineHeight: 1.35, color: '#9AA1A9' }}>
          {[row.issued_on ? `Issued ${shortDate(row.issued_on)}` : null, `received ${shortDate(row.received_on)}`]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      {current ? (
        <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 11, background: '#EAF7EC', color: '#1B7A2C', fontSize: 10.5, fontWeight: 700 }}>
          Current
        </span>
      ) : (
        <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 11, background: '#F1F3F5', color: '#8B9096', fontSize: 10.5, fontWeight: 700 }}>
          Superseded
        </span>
      )}
    </span>
  )
}
