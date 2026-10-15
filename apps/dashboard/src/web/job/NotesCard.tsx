/**
 * The job's notes: site_notes, the same notes the crew read and add on their
 * phones under Project details (Overview.tsx). Gate codes, where to park,
 * who to ask for.
 *
 * Writes are the phone's, read back:
 *  - Add inserts {company_id, site_id, body, author_id: me} and selects the
 *    row back; RLS lets anyone in the company add a note as themselves.
 *  - Delete is the author's, or anyone's for the office (site_notes_delete).
 *    A refused DELETE is a success with no rows, so the deleted row coming
 *    back is the only proof it went, as the phone checks it. No rows can
 *    also mean someone got there first (deleted on a phone while it was
 *    listed here), so the note is looked for again before anyone is told
 *    it was refused: gone is what was wanted, and it is said that way.
 * The website is the office's, so every note shows Delete; the rule is kept
 * anyway, so the card says the right thing if that ever changes.
 *
 * Refreshes with the page (focus, visibility, every 60 s), so a note added
 * on a phone shows here without a reload.
 */
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { useFresh } from '../data/useFresh'
import type { CrewLite } from '../data/useJobs'
import { supabase, type JobSiteRow, type WorkerRow } from '../phone'
import { useToast } from '../shell/Toast'
import { color, space, text } from '../tokens'
import { Button, CloseIcon, IconButton } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { TextArea } from '../ui/TextArea'
import { Card } from './ProjectCard'

export interface NoteRow {
  id: string
  body: string
  author_id: string | null
  created_at: string
}

const NOTE_COLS = 'id, body, author_id, created_at'
/** How many show before "Show all". */
const FIRST = 5

const when = (iso: string) => {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const date = d.toLocaleDateString('en-AU', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  return `${date}, ${time}`
}

/** May this person delete this note? The site_notes_delete policy, as the phone's screens assume it. */
const canDelete = (me: Pick<WorkerRow, 'id' | 'is_office'>, note: Pick<NoteRow, 'author_id'>) => me.is_office || note.author_id === me.id

export function NotesCard({ me, site, roster }: { me: WorkerRow; site: JobSiteRow; roster: Map<string, CrewLite> | null }) {
  const toast = useToast()
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<NoteRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase().from('site_notes').select(NOTE_COLS).eq('site_id', site.id).order('created_at', { ascending: false }).order('id')
    if (error) {
      setLoadError(error.message)
      return
    }
    setLoadError(null)
    setNotes((data ?? []) as NoteRow[])
  }, [site.id])

  useEffect(() => {
    void load()
  }, [load])
  useFresh(() => void load())

  const add = async () => {
    const body = draft.trim()
    if (!body || adding) return
    setAdding(true)
    setAddError(null)
    const { data, error } = await supabase()
      .from('site_notes')
      .insert({ company_id: me.company_id, site_id: site.id, body, author_id: me.id })
      .select(NOTE_COLS)
      .maybeSingle()
    setAdding(false)
    const row = data as NoteRow | null
    if (error || !row?.id) {
      setAddError(error?.message ?? 'The note was refused. Try again.')
      return
    }
    setDraft('')
    setNotes((prev) => [row, ...(prev ?? []).filter((n) => n.id !== row.id)])
    void load()
  }

  const remove = async () => {
    if (!deleting) return
    const id = deleting.id
    setDeleteBusy(true)
    setDeleteError(null)
    const c = supabase()
    const { data, error } = await c.from('site_notes').delete().eq('id', id).select('id')
    if (error) {
      setDeleteBusy(false)
      setDeleteError(error.message)
      return
    }
    let already = false
    if (!data || data.length === 0) {
      // Nothing deleted: refused, or already gone. Only the note still being there means refused.
      const still = await c.from('site_notes').select('id').eq('id', id).maybeSingle()
      if (still.error || still.data) {
        setDeleteBusy(false)
        setDeleteError(
          still.error
            ? `That note may not have deleted, and checking failed: ${still.error.message}`
            : canDelete(me, deleting)
              ? 'That note is still there: deleting it was refused. Reload the page and try again.'
              : 'That note did not delete: only the person who wrote it, or the office, can delete it.',
        )
        return
      }
      already = true
    }
    setDeleteBusy(false)
    setDeleting(null)
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== id))
    if (already) toast('That note had already been deleted, on a phone or in another window.')
    void load()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void add()
    }
  }

  const list = notes ?? []
  const shown = all ? list : list.slice(0, FIRST)
  const author = (n: NoteRow) =>
    n.author_id === me.id ? 'You' : !n.author_id ? 'Someone' : (roster?.get(n.author_id)?.name ?? (roster ? 'Someone no longer on the crew list' : '…'))

  return (
    <Card title="Notes" data-card="notes" action={list.length > 0 ? <span style={{ color: color.muted }}>{list.length}</span> : undefined}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: space.xs, paddingBottom: space.sm }}
      >
        <TextArea
          label="New note"
          hideLabel
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Gate code, where to park, who to ask for…"
          error={addError ?? undefined}
          data-note-input=""
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xs }}>
          <span style={{ ...text.xs, color: color.faint }}>The crew see these on their phones.</span>
          <Button type="submit" size="sm" variant="primary" loading={adding} disabled={!draft.trim()} data-note-add="">
            Add note
          </Button>
        </div>
      </form>

      {loadError && (
        <div role="alert" style={{ ...text.sm, color: color.red, padding: `${space.xs}px 0` }}>
          Notes did not load: {loadError}{' '}
          <button type="button" className="wb-link wb-link--button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {notes !== null && list.length === 0 && !loadError && <div style={{ ...text.sm, color: color.faint, padding: `${space.xs}px 0 ${space.sm}px` }}>Nothing yet</div>}

      {shown.length > 0 && (
        <ul data-notes="" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
          {shown.map((n) => (
            <li key={n.id} data-note={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: space.xs, padding: `${space.sm}px 0`, borderTop: `1px solid ${color.borderSoft}` }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span data-note-body="" style={{ ...text.base, color: color.ink, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {n.body}
                </span>
                <span style={{ ...text.xs, color: color.muted }}>
                  {author(n)} · {when(n.created_at)}
                </span>
              </div>
              {canDelete(me, n) && (
                <IconButton
                  label="Delete note"
                  size={28}
                  data-note-delete=""
                  onClick={() => {
                    setDeleteError(null)
                    setDeleting(n)
                  }}
                >
                  <CloseIcon size={11} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {list.length > FIRST && (
        <div style={{ padding: `${space.xs}px 0 ${space.xxs}px`, borderTop: `1px solid ${color.borderSoft}` }}>
          <button type="button" className="wb-link wb-link--button" style={{ ...text.sm }} onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${list.length}`}
          </button>
        </div>
      )}

      <Dialog
        open={deleting !== null}
        title="Delete this note?"
        confirmLabel="Delete"
        tone="danger"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => {
          setDeleting(null)
          setDeleteError(null)
        }}
      >
        <span style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: color.ink }}>“{deleting?.body}”</span>
        <span style={{ display: 'block', marginTop: space.xs }}>It goes from the crew's phones too.</span>
      </Dialog>
    </Card>
  )
}
