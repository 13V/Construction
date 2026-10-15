/**
 * The job's Scope of works tab: the phone's scope list, as a table a desk
 * can work down in one pass.
 *
 * The seven standard lines come first, in the phone's order, then any line
 * the office added for this job. Each row sets where the line stands
 * (Required / Confirmed / Not applicable), what was chosen, and its
 * paperwork, in place. The crew see the same list under Overview › Scope of
 * works on their phones, with the same words and colours, and the strip at
 * the top is the phone's readiness bar under that list.
 *
 * Every write is the phone's (data/scope.ts): a line gets a row only when it
 * is first changed; Confirmed needs what was chosen and is refused without
 * it, before anything is sent; attachments are documents filed against the
 * line, so they never turn up in Drawings or Photos. Every write is read
 * back, and the list reloads after it.
 *
 * "What was chosen" saves when Confirmed is pressed or Enter is, and, on a
 * line already Confirmed, when the field is left. Text typed on a line that
 * is not Confirmed is kept on screen and marked unsaved, never written as a
 * selection nobody confirmed. Moving a Confirmed line to Required or Not
 * applicable clears the record, as the phone does, but leaves what it held
 * in the field, unsaved: Required sits right beside Confirmed, and one stray
 * click must not lose a product name that pressing Confirmed can put back.
 *
 * A drop of several files where some are refused (too big, wrong type) or
 * turned away says so on the line and in the toast, beside the ones that
 * went on.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { SCOPE_STATUS, scopeCounts, type ScopeStatus } from '../../data/contract'
import {
  addExtraLine,
  ATTACH_ACCEPT,
  attachFiles,
  leftOutNote,
  MAX_ATTACHMENT_BYTES,
  NEEDS_CHOSEN,
  removeAttachment,
  removeExtraLine,
  restoredDate,
  scopeEntries,
  selectionLost,
  setLineStatus,
  useScope,
  type ScopeCtx,
  type ScopeEntry,
  type ScopeFile,
} from '../../data/scope'
import { BUCKET_FILES, signedUrl, viewFile } from '../../phone'
import { PageLoading } from '../../routes'
import { useToast } from '../../shell/Toast'
import { color, radius, shadow, space, text } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button, CloseIcon, IconButton, PlusIcon, Spinner } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { DropZone } from '../../ui/DropZone'
import { Field } from '../../ui/Field'
import type { JobTabProps } from '../types'

/** Left to right, the way a line moves: still to decide, decided, or not on this job. */
const PICK_ORDER: ScopeStatus[] = ['pending', 'chosen', 'not_applicable']

/**
 * Layout by the tab's own width (the window's, less the rail and the page
 * padding). From TABLE_FROM (a 1366 px window): four columns. Below it each
 * line is a card of two columns, the line and where it stands, then what
 * was chosen and its attachments. Below SIDE_FROM (a 768 px window, a
 * phone) everything is one column: beside a fixed-width picker the line
 * would be left a few letters wide.
 */
const TABLE_FROM = 1060
const SIDE_FROM = 640
type Tier = 'table' | 'side' | 'stack'
/** The status picker's column: its three buttons (316 px in Chromium) and room over for other fonts. */
const STATUS_W = 336

type Note = { tone: 'error' | 'unsaved' | 'saved'; text: string }
type Kept = NonNullable<ReturnType<typeof selectionLost>>
type Removing = { kind: 'file'; file: ScopeFile; lineName: string } | { kind: 'line'; entry: ScopeEntry; files: number }

export default function ScopeTab({ me, site }: JobTabProps) {
  const scope = useScope(site.id)
  const toast = useToast()
  const ctx: ScopeCtx = useMemo(() => ({ company_id: me.company_id, site_id: site.id, worker_id: me.id }), [me.company_id, me.id, site.id])

  const rows = useMemo(() => scope.data?.rows ?? [], [scope.data])
  const entries = useMemo(() => scopeEntries(rows), [rows])
  const counts = useMemo(() => scopeCounts(rows), [rows])

  // What has been typed into "What was chosen" and not yet saved, by line key.
  // Kept apart from the rows, so a refresh landing mid-sentence keeps it.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, 'status' | 'files'>>({})
  const [notes, setNotes] = useState<Record<string, Note>>({})
  const [removing, setRemoving] = useState<Removing | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const inputs = useRef(new Map<string, HTMLTextAreaElement>())
  // What a line held when it was moved off Confirmed (selectionLost), by
  // line key, while its field still offers it back.
  const kept = useRef(new Map<string, Kept>())
  // Files the drop zone refused from a drop, by line key. DropZone hands
  // those over first and the accepted ones straight after, in the same call,
  // so attach() takes them up and reports both together. Dropped at the end
  // of that call (a microtask), so they never stick to a later drop.
  const refused = useRef(new Map<string, string[]>())
  const savedTimers = useRef(new Map<string, number>())
  useEffect(() => {
    const timers = savedTimers.current
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])

  const [wrap, tier] = useTier()

  const note = useCallback((key: string, n: Note | null) => {
    window.clearTimeout(savedTimers.current.get(key))
    setNotes((all) => {
      const next = { ...all }
      if (n) next[key] = n
      else delete next[key]
      return next
    })
    if (n?.tone === 'saved') {
      savedTimers.current.set(
        key,
        window.setTimeout(() => setNotes((all) => (all[key]?.tone === 'saved' ? omit(all, key) : all)), 2500),
      )
    }
  }, [])
  const setDraft = (key: string, value: string | null) => setDrafts((all) => (value === null ? omit(all, key) : { ...all, [key]: value }))
  const mark = (key: string, what: 'status' | 'files' | null) => setBusy((all) => (what ? { ...all, [key]: what } : omit(all, key)))

  const valueOf = (e: ScopeEntry) => drafts[e.key] ?? e.row?.chosen ?? ''
  const isDirty = (e: ScopeEntry) => drafts[e.key] !== undefined && drafts[e.key]!.trim() !== (e.row?.chosen ?? '').trim()

  /** Set where a line stands. Confirmed takes the text in its field, and is refused (nothing sent) without any. */
  async function pick(e: ScopeEntry, status: ScopeStatus) {
    if (busy[e.key]) return
    if (status === e.status && !(status === 'chosen' && isDirty(e))) return
    const chosen = valueOf(e)
    if (status === 'chosen' && !chosen.trim()) {
      note(e.key, { tone: 'error', text: NEEDS_CHOSEN })
      inputs.current.get(e.key)?.focus()
      return
    }
    // Off Confirmed, the record is cleared (the phone's patch) and what it
    // held stays in the field. A line already moved off keeps offering it
    // while the field still shows it, through Required to Not applicable.
    const prior = kept.current.get(e.key)
    const keep = selectionLost(e.row, status) ?? (status !== 'chosen' && prior && chosen.trim() === prior.chosen.trim() ? prior : null)
    mark(e.key, 'status')
    note(e.key, null)
    try {
      // Confirmed on the kept text is the put-back: it keeps its first date.
      scope.put(await setLineStatus(ctx, e, status, chosen, { now: status === 'chosen' ? restoredDate(prior, chosen) : undefined }))
      if (keep) {
        kept.current.set(e.key, keep)
        setDraft(e.key, keep.chosen)
        note(e.key, { tone: 'unsaved', text: `Saved as ${SCOPE_STATUS[status].label}. ${keptNote(keep)}` })
      } else {
        kept.current.delete(e.key)
        setDraft(e.key, null)
        note(e.key, { tone: 'saved', text: 'Saved' })
      }
    } catch (err) {
      note(e.key, { tone: 'error', text: messageOf(err) })
    } finally {
      mark(e.key, null)
      await scope.reload()
    }
  }

  /** Leaving the field: a Confirmed line saves its new text; any other keeps it and says it is not saved. */
  function leave(e: ScopeEntry) {
    if (!isDirty(e) || busy[e.key]) return
    const value = valueOf(e)
    if (e.status === 'chosen') {
      if (value.trim()) void pick(e, 'chosen')
      else note(e.key, { tone: 'error', text: NEEDS_CHOSEN })
    } else if (value.trim()) {
      const prior = kept.current.get(e.key)
      note(e.key, { tone: 'unsaved', text: prior && prior.chosen.trim() === value.trim() ? keptNote(prior) : 'Not saved yet. Press Confirmed, or Enter, to record it.' })
    } else {
      setDraft(e.key, null)
      note(e.key, null)
    }
  }

  /** The drop zone refused some of a drop: say so now, and hold the reasons for the accepted rest, if any. */
  function reject(e: ScopeEntry, reasons: string[]) {
    refused.current.set(e.key, reasons)
    queueMicrotask(() => refused.current.delete(e.key))
    note(e.key, { tone: 'error', text: leftOutNote(reasons)! })
  }

  async function attach(e: ScopeEntry, files: File[]) {
    // Refused from this same drop: reported with the rest, never wiped by it.
    const refusedNow = refused.current.get(e.key) ?? []
    refused.current.delete(e.key)
    if (busy[e.key]) return
    mark(e.key, 'files')
    note(e.key, refusedNow.length ? { tone: 'error', text: leftOutNote(refusedNow)! } : null)
    try {
      const res = await attachFiles(ctx, e, files)
      if (res.row && !e.row) scope.put(res.row)
      const left = leftOutNote(refusedNow, res.failed)
      if (left) note(e.key, { tone: 'error', text: left })
      if (res.added.length) {
        const what = res.added.length === 1 ? res.added[0]!.name : `${res.added.length} files`
        const out = refusedNow.length + res.failed.length
        toast(
          out ? `${what} attached to ${e.line.name}. ${out === 1 ? '1 file was' : `${out} files were`} not; the reason is on the line.` : `${what} attached to ${e.line.name}`,
          { tone: out ? 'error' : 'success' },
        )
      }
    } catch (err) {
      note(e.key, { tone: 'error', text: [leftOutNote(refusedNow), messageOf(err)].filter(Boolean).join(' ') })
    } finally {
      mark(e.key, null)
      await scope.reload()
    }
  }

  async function confirmRemove() {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      if (removing.kind === 'file') {
        const { objectRemoved } = await removeAttachment(removing.file)
        toast(
          objectRemoved ? `${removing.file.name} removed` : `${removing.file.name} is off the line, but the stored file could not be deleted.`,
          { tone: objectRemoved ? 'success' : 'error' },
        )
      } else {
        const { objectsRemoved } = await removeExtraLine(ctx, removing.entry.row!)
        toast(
          objectsRemoved ? `${removing.entry.line.name} removed` : `${removing.entry.line.name} is removed, but some of its stored files could not be deleted.`,
          { tone: objectsRemoved ? 'success' : 'error' },
        )
      }
      setRemoving(null)
    } catch (err) {
      setRemoveError(messageOf(err))
    } finally {
      setRemoveBusy(false)
      await scope.reload()
    }
  }

  if (!scope.data) {
    if (!scope.error) return <PageLoading />
    return (
      <Banner tone="error" title="Could not load the scope of works" action={<Button size="sm" onClick={() => void scope.reload()}>Try again</Button>}>
        {scope.error}
      </Banner>
    )
  }
  const files = scope.data.files

  return (
    <div ref={wrap} data-scope-tab style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 560 }}>
          <h2 style={{ margin: 0, ...text.md, fontWeight: 600, color: color.ink }}>Scope of works</h2>
          <p style={{ margin: 0, ...text.sm, color: color.muted }}>
            What has to be settled before the tiles go down. Crews see this list on their phones under Overview › Scope of works.
          </p>
        </div>
        <CountsStrip counts={counts} />
      </div>

      {scope.error && (
        <Banner tone="warn" title="Showing the scope as last loaded" action={<Button size="sm" onClick={() => void scope.reload()}>Try again</Button>}>
          {scope.error}
        </Banner>
      )}

      <div style={{ background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg, boxShadow: shadow.card }}>
        <div role="table" aria-label="Scope of works">
          {/* Stacked, the columns have no headings on screen; a screen reader still gets them. */}
          <div role="row" className={tier === 'table' ? undefined : 'wb-sr-only'} style={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: space.md, minHeight: 36, alignItems: 'center', padding: `0 ${space.md}px`, background: color.rowFill, borderBottom: `1px solid ${color.borderSoft}`, borderRadius: `${radius.lg}px ${radius.lg}px 0 0` }}>
            {['Line', 'Where it stands', 'What was chosen', 'Attachments'].map((h) => (
              <div key={h} role="columnheader" style={{ ...text.label, fontSize: 11, color: color.muted }}>
                {h}
              </div>
            ))}
          </div>

          {entries.map((e, i) => {
            const lineFiles = (e.row && files.get(e.row.id)) || []
            const n = notes[e.key]
            const b = busy[e.key]
            return (
              <div
                key={e.key}
                role="row"
                data-line={e.key}
                data-status={e.status}
                style={{ ...gridOf(tier, Boolean(n && n.tone !== 'saved')), padding: `${space.sm + 2}px ${space.md}px`, borderTop: i === 0 ? undefined : `1px solid ${color.borderSoft}` }}
              >
                <div role="cell" style={{ gridArea: 'line', display: 'flex', alignItems: 'flex-start', gap: space.sm, minWidth: 0 }}>
                  <LineIcon lineKey={e.index === null ? null : e.key} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* break-word, not anywhere: a word is split only when it alone is wider than the cell. */}
                    <span style={{ ...text.base, fontWeight: 600, color: color.ink, overflowWrap: 'break-word' }}>{e.line.name}</span>
                    {e.line.detail && <span style={{ ...text.sm, color: color.muted, overflowWrap: 'break-word' }}>{e.line.detail}</span>}
                    {e.index === null && (
                      // Under the name, not beside it, so the name keeps the cell's whole width.
                      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm, ...text.xs, color: color.faint }}>
                        Added for this job
                        <button
                          type="button"
                          className="wb-link wb-link--button"
                          aria-label={`Remove the line ${e.line.name}`}
                          onClick={() => {
                            setRemoveError(null)
                            setRemoving({ kind: 'line', entry: e, files: lineFiles.length })
                          }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...text.xs, fontWeight: 600, color: color.muted }}
                        >
                          <TrashIcon />
                          Remove
                        </button>
                      </span>
                    )}
                  </div>
                </div>

                <div role="cell" style={{ gridArea: 'status', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <StatusPicker
                    lineKey={e.key}
                    lineName={e.line.name}
                    value={e.status}
                    busy={b === 'status'}
                    onPick={(s) => void pick(e, s)}
                    onLeave={(to) => {
                      // Tabbed from the field to these buttons and on past them
                      // without choosing: the field's text is settled as if the
                      // field itself had been left.
                      if (to !== inputs.current.get(e.key)) leave(e)
                    }}
                  />
                  {/* Stacked, an empty one would leave a gap under the picker; elsewhere it holds the row still when "Saving…" comes. */}
                  <span aria-live="polite" style={{ minHeight: tier === 'stack' ? 0 : 16, display: 'inline-flex', alignItems: 'center', gap: 5, ...text.xs, color: color.muted }}>
                    {b === 'status' ? (
                      <>
                        <Spinner size={11} /> Saving…
                      </>
                    ) : n?.tone === 'saved' ? (
                      <span style={{ color: color.green }}>✓ Saved</span>
                    ) : null}
                  </span>
                </div>

                <div role="cell" style={{ gridArea: 'chosen', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <ChosenField
                    fieldRef={(el) => {
                      if (el) inputs.current.set(e.key, el)
                      else inputs.current.delete(e.key)
                    }}
                    strong={e.status === 'chosen' && !isDirty(e)}
                    aria-label={`What was chosen for ${e.line.name}`}
                    aria-invalid={n?.tone === 'error' && n.text === NEEDS_CHOSEN ? true : undefined}
                    value={valueOf(e)}
                    placeholder={e.status === 'not_applicable' ? 'Not on this job' : 'e.g. Mapei Ultracolour 114'}
                    readOnly={b === 'status'}
                    onChange={(ev) => {
                      // One line, as on the phone: a pasted line break is a space.
                      setDraft(e.key, ev.target.value.replace(/[\r\n]+/g, ' '))
                      if (n && n.tone !== 'saved') note(e.key, null)
                    }}
                    onKeyDown={(ev) => {
                      // Enter that ends an IME composition is the composition's, not a save.
                      if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) {
                        ev.preventDefault()
                        void pick(e, 'chosen')
                      } else if (ev.key === 'Escape' && drafts[e.key] !== undefined) {
                        ev.preventDefault()
                        kept.current.delete(e.key)
                        setDraft(e.key, null)
                        note(e.key, null)
                      }
                    }}
                    onBlur={(ev) => {
                      // Moving to this line's own status buttons is a choice
                      // about to be made; that click decides what is saved.
                      const to = ev.relatedTarget as HTMLElement | null
                      if (to?.closest(`[data-picker="${CSS.escape(e.key)}"]`)) return
                      leave(e)
                    }}
                  />
                  {e.row?.status === 'chosen' && e.row.chosen_at && !isDirty(e) && (
                    <span style={{ ...text.xs, color: color.muted }}>Confirmed {dateOf(e.row.chosen_at)}</span>
                  )}
                </div>

                <div role="cell" style={{ gridArea: 'files', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  {lineFiles.map((f) => (
                    <AttachmentChip
                      key={f.id}
                      file={f}
                      onRemove={() => {
                        setRemoveError(null)
                        setRemoving({ kind: 'file', file: f, lineName: e.line.name })
                      }}
                      onOpenFailed={() => toast(`${f.name} could not be opened.`, { tone: 'error' })}
                    />
                  ))}
                  <DropZone
                    compact
                    accept={ATTACH_ACCEPT}
                    maxBytes={MAX_ATTACHMENT_BYTES}
                    disabled={b === 'files'}
                    label={
                      b === 'files' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Spinner size={12} /> Uploading…
                        </span>
                      ) : (
                        'Drop files here'
                      )
                    }
                    buttonLabel="Choose files"
                    onFiles={(fs) => void attach(e, fs)}
                    onReject={(r) => reject(e, r.map((x) => x.reason))}
                  />
                </div>

                {n && n.tone !== 'saved' && (
                  <div role="cell" aria-colspan={4} style={{ gridArea: 'note' }}>
                    <div role={n.tone === 'error' ? 'alert' : 'status'} data-note={n.tone} style={{ ...text.sm, color: n.tone === 'error' ? color.red : color.amber }}>
                      {n.text}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, padding: `${space.sm}px ${space.md}px`, borderTop: `1px solid ${color.borderSoft}`, background: color.rowFill, borderRadius: `0 0 ${radius.lg}px ${radius.lg}px` }}>
          <Button size="sm" variant="secondary" icon={<PlusIcon size={12} />} onClick={() => setAdding(true)}>
            Add line
          </Button>
          <span style={{ ...text.xs, color: color.muted }}>
            PDFs, photos, Word and Excel files, up to 25 MB each. They stay with their line, out of Drawings and Photos.
          </span>
        </div>
      </div>

      <AddLineDialog
        open={adding}
        onCancel={() => setAdding(false)}
        onAdd={async (input) => {
          await addExtraLine(ctx, rows, input)
          setAdding(false)
          toast(`${input.name.trim()} added`, { tone: 'success' })
          await scope.reload()
        }}
      />

      <Dialog
        open={removing !== null}
        title={removing?.kind === 'file' ? `Remove ${removing.file.name}?` : removing ? `Remove the line ${removing.entry.line.name}?` : ''}
        confirmLabel={removing?.kind === 'line' ? 'Remove line' : 'Remove'}
        tone="danger"
        busy={removeBusy}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      >
        {removing?.kind === 'file'
          ? `It comes off ${removing.lineName} and the stored file is deleted. Crews will no longer see it.`
          : removing
            ? `It comes off this job's scope${removing.files ? `, with its ${removing.files === 1 ? 'attachment' : `${removing.files} attachments`}` : ''}. Crews will no longer see it.`
            : null}
      </Dialog>
    </div>
  )
}

// ------------------------------------------------------------------ layout

/**
 * One grid for the header and every line, so the columns line up: the line,
 * where it stands, what was chosen, attachments, and a note under all four.
 * Where it stands is the picker's width and attachments the drop zone's
 * (one line), so what is left goes to the two text columns, the larger share to
 * what was chosen: a product name is the thing a desk reads down this table
 * for, and it wraps in full (ChosenField) rather than being cut off.
 */
const COLUMNS = `minmax(0, 1fr) ${STATUS_W}px minmax(0, 1.3fr) 248px`

function gridOf(tier: Tier, withNote: boolean): CSSProperties {
  if (tier === 'table') {
    return {
      display: 'grid',
      gridTemplateColumns: COLUMNS,
      gridTemplateAreas: `"line status chosen files"${withNote ? ' "note note note note"' : ''}`,
      columnGap: space.md,
      rowGap: 6,
      alignItems: 'start',
    }
  }
  if (tier === 'side') {
    return {
      display: 'grid',
      gridTemplateColumns: `minmax(0, 1fr) ${STATUS_W}px`,
      gridTemplateAreas: `"line status" "chosen files"${withNote ? ' "note note"' : ''}`,
      columnGap: space.md,
      rowGap: space.sm,
      alignItems: 'start',
    }
  }
  return {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateAreas: `"line" "status" "chosen" "files"${withNote ? ' "note"' : ''}`,
    rowGap: space.sm,
  }
}

/** [ref for the tab's container, the layout its width calls for]. */
function useTier(): [(el: HTMLDivElement | null) => void, Tier] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [tier, setTier] = useState<Tier>('table')
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      setTier(w >= TABLE_FROM ? 'table' : w >= SIDE_FROM ? 'side' : 'stack')
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, tier]
}

// ------------------------------------------------------------------ pieces

/** The phone's readiness bar under its scope list, the same three cells and words. */
function CountsStrip({ counts }: { counts: Record<ScopeStatus, number> & { total: number } }) {
  const cells: Array<{ k: ScopeStatus; label: string }> = [
    { k: 'chosen', label: 'Complete' },
    { k: 'pending', label: 'Required' },
    { k: 'not_applicable', label: 'Not applicable' },
  ]
  const decided = counts.chosen + counts.not_applicable
  return (
    <div
      role="group"
      aria-label={`${decided} of ${counts.total} lines decided`}
      data-counts={`${counts.chosen}/${counts.pending}/${counts.not_applicable}`}
      style={{ display: 'flex', alignItems: 'stretch', background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg, boxShadow: shadow.card }}
    >
      {cells.map(({ k, label }, i) => (
        <div
          key={k}
          data-count={k}
          style={{ minWidth: 112, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: `${space.xs}px ${space.md}px`, borderLeft: i === 0 ? 'none' : `1px solid ${color.borderSoft}` }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: SCOPE_STATUS[k].fg }}>
            <StatusGlyph status={k} />
            {label}
          </span>
          <span style={{ fontSize: 18, lineHeight: '24px', fontWeight: 800, letterSpacing: '-.01em', color: color.ink }}>{counts[k]}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Required · Confirmed · Not applicable, each a real button. Pressing one is
 * the decision, so the arrow keys do not move it (a radio group's arrows
 * would write on every key press). The chosen one wears the phone's colours
 * for that status.
 */
function StatusPicker({
  lineKey,
  lineName,
  value,
  busy,
  onPick,
  onLeave,
}: {
  lineKey: string
  lineName: string
  value: ScopeStatus
  busy: boolean
  onPick: (s: ScopeStatus) => void
  /** Focus left the group for `to` (null: nowhere in particular). */
  onLeave: (to: Element | null) => void
}) {
  return (
    <div
      role="group"
      aria-label={`Where ${lineName} stands`}
      data-picker={lineKey}
      onBlur={(ev) => {
        const to = ev.relatedTarget as Element | null
        if (!to || !ev.currentTarget.contains(to)) onLeave(to)
      }}
      // The cell's full width, the three sharing it, so it lines up with the
      // attachments under it on a card; a font wider than this one wraps the
      // last button rather than pushing out of the cell.
      style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: 3, background: color.fill, borderRadius: radius.md, opacity: busy ? 0.7 : 1 }}
    >
      {PICK_ORDER.map((k) => {
        const on = value === k
        const meta = SCOPE_STATUS[k]
        return (
          <button
            key={k}
            type="button"
            className="wb-seg-item"
            aria-pressed={on}
            aria-disabled={busy || undefined}
            data-pick={k}
            // Keeps focus in "What was chosen" when the pointer presses a
            // status: the field's blur would otherwise save first, and this
            // press would land while that save is still running.
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => {
              if (!busy) onPick(k)
            }}
            style={{
              flex: '1 1 auto',
              height: 30,
              // Tight enough that the three fit one line in a 390 px window;
              // wider, flex shares out the room.
              padding: '0 7px',
              gap: 5,
              whiteSpace: 'nowrap',
              ...text.sm,
              fontWeight: on ? 700 : 500,
              // Not applicable's own fill is this track's grey; on white it
              // still reads as the one chosen.
              background: on ? (meta.bg === color.fill ? color.panel : meta.bg) : 'transparent',
              color: on ? meta.fg : color.body,
              boxShadow: on ? `0 0 0 1px ${meta.fg}40, ${shadow.card}` : undefined,
              cursor: busy ? 'progress' : 'pointer',
            }}
          >
            <StatusGlyph status={k} muted={!on} />
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}

/** The line's field padding and type, shared by the field and its sizer so the two wrap identically. */
const CHOSEN_BOX: CSSProperties = {
  gridArea: '1 / 1',
  boxSizing: 'border-box',
  minWidth: 0,
  minHeight: 34,
  // Five lines, then the field scrolls: a pasted essay must not push every line below it away.
  maxHeight: 6 + 20 * 5 + 6 + 2,
  margin: 0,
  padding: '6px 12px',
  fontSize: 14,
  lineHeight: '20px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
}

/**
 * "What was chosen": one line of text, as on the phone, shown in full. The
 * field wraps and grows with its text, so a long product name is read in the
 * table, not behind a cut-off box only clicking in can scroll. The height
 * comes from a hidden copy of the text in the same grid cell (no measuring
 * in script), so it follows a column resize too. Enter confirms rather than
 * starting a new line; the caller turns a pasted line break into a space.
 */
function ChosenField({
  fieldRef,
  strong,
  value,
  placeholder,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'style' | 'className' | 'rows'> & {
  fieldRef: (el: HTMLTextAreaElement | null) => void
  value: string
  placeholder: string
  /** The phone's green, bold "this was decided" style. */
  strong: boolean
}) {
  const weight = strong ? 600 : 400
  return (
    <div style={{ display: 'grid', minWidth: 0 }}>
      <div aria-hidden="true" style={{ ...CHOSEN_BOX, fontWeight: weight, border: '1px solid transparent', visibility: 'hidden', overflow: 'hidden' }}>
        {`${value || placeholder} `}
      </div>
      <textarea
        ref={fieldRef}
        rows={1}
        data-chosen=""
        // Product names and colour codes, not prose: no red squiggles under "Ultracolour".
        spellCheck={false}
        className="wb-input"
        value={value}
        placeholder={placeholder}
        {...rest}
        style={{ ...CHOSEN_BOX, fontWeight: weight, resize: 'none', overflowY: 'auto', ...(strong ? { color: color.green } : null) }}
      />
    </div>
  )
}

function AttachmentChip({ file, onRemove, onOpenFailed }: { file: ScopeFile; onRemove: () => void; onOpenFailed: () => void }) {
  const [opening, setOpening] = useState(false)
  const ext = (file.name.split('.').pop() ?? 'file').slice(0, 4).toUpperCase()
  return (
    <div
      data-attachment={file.name}
      style={{ display: 'flex', alignItems: 'center', gap: space.xs, minHeight: 32, padding: '3px 3px 3px 6px', background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.sm }}
    >
      <span aria-hidden="true" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 20, padding: '0 4px', borderRadius: 4, background: color.fill, fontSize: 9.5, fontWeight: 800, letterSpacing: '.03em', color: color.body }}>
        {ext}
      </span>
      <button
        type="button"
        className="wb-link wb-link--button"
        title={`${file.name}${file.size_bytes ? ` · ${sizeOf(file.size_bytes)}` : ''}`}
        disabled={opening}
        onClick={async () => {
          setOpening(true)
          const url = await signedUrl(BUCKET_FILES, file.storage_path)
          setOpening(false)
          if (url) viewFile({ url, name: file.name })
          else onOpenFailed()
        }}
        style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...text.sm, fontWeight: 500, color: color.ink }}
      >
        {file.name}
      </button>
      <IconButton label={`Remove ${file.name}`} size={26} onClick={onRemove}>
        <CloseIcon size={11} />
      </IconButton>
    </div>
  )
}

function AddLineDialog({ open, onCancel, onAdd }: { open: boolean; onCancel: () => void; onAdd: (input: { name: string; detail: string }) => Promise<void> }) {
  const [name, setName] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A fresh form each time it opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setDetail('')
      setError(null)
    }
  }
  return (
    <Dialog
      open={open}
      title="Add a line to this job's scope"
      confirmLabel="Add line"
      busy={busy}
      error={error}
      confirmDisabled={!name.trim()}
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true)
        setError(null)
        try {
          await onAdd({ name, detail })
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, paddingTop: space.xs }}>
        <span style={{ ...text.sm, color: color.body }}>It goes after the seven standard lines, as Required, and shows on the crew's phones with them.</span>
        <Field label="Line" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="e.g. Shower niche" maxLength={120} />
        <Field label="What to confirm" optional value={detail} onChange={(ev) => setDetail(ev.target.value)} placeholder="e.g. Niche size, tile and trim" maxLength={240} />
      </div>
    </Dialog>
  )
}

// ------------------------------------------------------------------ glyphs

/** The phone's status glyphs (Overview.tsx STATUS_META), so a status reads the same on both. */
function StatusGlyph({ status, muted = false }: { status: ScopeStatus; muted?: boolean }) {
  const c = muted ? color.ghost : SCOPE_STATUS[status].fg
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={c} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="10" cy="10" r="7.6" strokeWidth="1.7" />
      {status === 'chosen' && <path d="M6.6 10.2l2.4 2.3 4.4-4.6" strokeWidth="2.2" />}
      {status === 'pending' && (
        <>
          <path d="M10 6.2v5" strokeWidth="1.9" />
          <path d="M10 13.6v.2" strokeWidth="1.9" />
        </>
      )}
      {status === 'not_applicable' && <path d="M6.4 10h7.2" strokeWidth="1.8" />}
    </svg>
  )
}

/**
 * The phone's tile-square icon for each standard line (Overview.tsx ICON),
 * so the office and the crew recognise a line by the same mark. A line added
 * by hand gets a plain one.
 */
const LINE_ICON: Record<string, { bg: string; stroke: string; path: ReactNode }> = {
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

function LineIcon({ lineKey }: { lineKey: string | null }) {
  const icon = lineKey ? LINE_ICON[lineKey] : undefined
  return (
    <span aria-hidden="true" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, background: icon?.bg ?? color.fill }}>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={icon?.stroke ?? color.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {icon?.path ?? (
          <>
            <path d="M4 5.5h12M4 10h12M4 14.5h7" />
          </>
        )}
      </svg>
    </span>
  )
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5.2 5.5l.8 10.7h8l.8-10.7M8.4 8.6v4.8M11.6 8.6v4.8" />
    </svg>
  )
}

// ------------------------------------------------------------------ helpers

function omit<T>(all: Record<string, T>, key: string): Record<string, T> {
  const next = { ...all }
  delete next[key]
  return next
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** What a line moved off Confirmed says about the selection still in its field. */
const keptNote = (k: Kept) => `“${k.chosen}” is no longer recorded; press Confirmed to put it back.`

const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

const sizeOf = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${Math.round((n / 1024 / 1024) * 10) / 10} MB`)
