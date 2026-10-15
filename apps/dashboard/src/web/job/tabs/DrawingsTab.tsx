/**
 * The job's Drawings tab: the drawing register the crew build from, and the
 * builder's programme beside it.
 *
 * The register is the phone's own (PlansScreen): the same rows, the same
 * current/superseded rule, the same REV chips, the same level groups once
 * there are nine or more current sheets, the same open-pin counts. What the
 * phone cannot do is put anything on it ("The office uploads sheets to the
 * job"), and since the old office dashboard is going this is now the only
 * place sheets come from:
 *  - drop a drawing set, and each file goes up as Rev A
 *  - "Upload revision" on a row puts the next revision up over that sheet,
 *    and the one it replaces moves under Superseded, red on every phone
 *  - "Remove" takes the newest revision back off, as if it had never gone up
 *
 * A dropped file named like a sheet on the job (current or superseded), like
 * a file still going up, or like another file in the same drop is held back
 * and asked about: put up as another Rev A, the crew would see two current
 * sheets of the same name, or an old revision back as current, and could
 * build from either.
 *
 * The programme is the phone's too (Programme.tsx): the current revision, the
 * ones it replaced, and an upload that supersedes rather than overwrites.
 *
 * All the data rules are in data/drawings.ts and data/programme.ts, pinned
 * to the phone's source by their tests; this file only draws them.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import {
  bumpVersion,
  DRAWING_ACCEPT,
  DRAWING_MAX_BYTES,
  holdBack,
  loadRegister,
  nameClash,
  nameKey,
  openSheet,
  registerOf,
  removeDrawing,
  sheetChip,
  sizeLabel,
  uploadDrawing,
  type NameClash,
  type RegisterRows,
  type Sheet,
} from '../../data/drawings'
import { loadProgrammes, openProgramme, PROGRAMME_ACCEPT, PROGRAMME_MAX_BYTES, uploadProgramme, type ProgrammeRow, type Programmes } from '../../data/programme'
import { useFresh } from '../../data/useFresh'
import { levelOf, programmeLine } from '../../phone-features'
import { useToast } from '../../shell/Toast'
import { color, radius, shadow, space, text } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button, CloseIcon, IconButton } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Dialog } from '../../ui/Dialog'
import { DropZone, screenFiles, type Rejected } from '../../ui/DropZone'
import { Field } from '../../ui/Field'
import { Table, type Column } from '../../ui/Table'
import type { JobTabProps } from '../types'

/**
 * Below this much room the programme goes under the register instead of
 * beside it. Beside it, the programme (312 px) and the gap take 336 px, and
 * the register needs about 640 for every column with the sheet names still
 * readable. Measured on the tab, not the window: the rail and the page's
 * padding take their share first, and the window's width cannot say what
 * is left.
 */
const STACK_BELOW = 980

export default function DrawingsTab(props: JobTabProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const stacked = width !== null && width < STACK_BELOW
  return (
    <div ref={ref} data-drawings-tab="" data-stacked={stacked ? '' : undefined} className="wb-split" style={stacked ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
      <Register {...props} />
      <ProgrammePanel {...props} />
    </div>
  )
}

// ------------------------------------------------------------------ shared

const LOCALE = 'en-AU'
/** "15 Oct 2026", as the phone prints an issued date. A bare date is local, not UTC. */
const dateLabel = (v: string) => new Date(v.length > 10 ? v : `${v}T00:00:00`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })

const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: space.md,
  padding: space.lg,
  background: color.panel,
  border: `1px solid ${color.borderSoft}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
}
const heading: CSSProperties = { margin: 0, ...text.md, fontWeight: 600, color: color.ink }
const label: CSSProperties = { margin: 0, ...text.label, color: color.muted }
const oneLine: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/** The phone register's sheet icon: a page with a folded corner, red when superseded. */
function SheetIcon({ superseded }: { superseded: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={superseded ? color.red : color.faint} strokeWidth={1.6} aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The width an element is laid out at, followed as it changes (the window
 * resizing, the rail folding away, the programme moving under the register).
 */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/**
 * State the event handlers read as it is now, not as it was at the last
 * render. Two drops a moment apart must each see what the other started,
 * and an upload must be on the register the moment it is stored, so the
 * name check never looks at a list from before either. Every change goes
 * through `set`, which updates both at once.
 */
function useLive<T>(initial: T) {
  const ref = useRef(initial)
  const [value, setValue] = useState(initial)
  const set = useCallback((next: (prev: T) => T) => {
    ref.current = next(ref.current)
    setValue(ref.current)
  }, [])
  return [value, ref, set] as const
}

// ----------------------------------------------------------------- register

/** One dropped file, from the drop to the read-back. */
interface Upload {
  key: string
  file: File
  /** queued → uploading → done | failed; held: named like another sheet, waiting for the office to say which it is. */
  state: 'queued' | 'uploading' | 'done' | 'failed' | 'held'
  message?: string
}

/** Not on the register yet, and not given up on: what a new drop's names are checked against besides the register. */
const OUTSTANDING: ReadonlySet<Upload['state']> = new Set(['queued', 'uploading', 'held'])

/** Why a held file is held. */
type Hold =
  /** Named like a sheet on the job, current or superseded. */
  | { kind: 'sheet'; clash: NameClash<Sheet> }
  /** Named like an earlier file that has not reached the register: going up, or held itself. */
  | { kind: 'upload'; other: Upload }
  /** Whatever it was named like has gone (failed, skipped, removed). */
  | { kind: 'clear' }

/**
 * Worked out afresh each time, not stored at the drop: what a file was named
 * like may since have gone up (it is now a sheet this can be the revision
 * of), failed, or been skipped.
 */
function holdOf(u: Upload, sheets: ReadonlyArray<Sheet>, uploads: ReadonlyArray<Upload>): Hold {
  const clash = nameClash(u.file, sheets)
  if (clash) return { kind: 'sheet', clash }
  const key = nameKey(u.file.name)
  const at = uploads.findIndex((x) => x.key === u.key)
  const other = uploads.find((x, i) => i < at && OUTSTANDING.has(x.state) && nameKey(x.file.name) === key)
  return other ? { kind: 'upload', other } : { kind: 'clear' }
}

/** A sheet into the register in name order, where the next read will put it. */
const placed = (sheets: ReadonlyArray<Sheet>, s: Sheet) => {
  const rest = sheets.filter((x) => x.id !== s.id)
  const at = rest.findIndex((x) => x.name.localeCompare(s.name) > 0)
  return at < 0 ? [...rest, s] : [...rest.slice(0, at), s, ...rest.slice(at)]
}

/**
 * How much of a row fits. From 640 px every column has its own; below that
 * the revision chip and the pins move under the sheet's name, so the name
 * keeps its room; below 440 the buttons go under it too. The tables follow
 * the register's own width.
 */
type Fit = 'wide' | 'compact' | 'tight'
const fitOf = (w: number | null): Fit => (w === null || w >= 640 ? 'wide' : w >= 440 ? 'compact' : 'tight')

/** Column widths, the same in both tables so their columns line up. The last holds both buttons side by side. */
const COL = { rev: 104, pins: 88, end: 232 } as const

let uploadSeq = 0

function Register({ me, site }: JobTabProps) {
  const toast = useToast()
  const [rows, rowsNow, setRows] = useLive<RegisterRows | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [uploads, uploadsNow, setUploads] = useLive<Upload[]>([])
  const [revise, setRevise] = useState<{ prior: Sheet; file: File } | null>(null)
  const [reviseBusy, setReviseBusy] = useState(false)
  const [reviseError, setReviseError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Sheet | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const reviseInput = useRef<HTMLInputElement>(null)
  const reviseFor = useRef<Sheet | null>(null)
  const searchId = useId()
  const [sectionRef, width] = useWidth<HTMLElement>()
  const fit = fitOf(width)

  // A slow read that lands after a newer one must not put older rows back.
  const seq = useRef(0)
  const load = useCallback(async () => {
    const n = ++seq.current
    try {
      const r = await loadRegister(site.id)
      if (n !== seq.current) return
      setRows(() => r)
      setLoadError(null)
    } catch (e) {
      if (n === seq.current) setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [site.id, setRows])

  useEffect(() => {
    void load()
  }, [load])
  useFresh(() => void load())

  /**
   * A write this tab made, read back, on the register at once (so the next
   * drop is checked against it). A read already on its way started before
   * the write and would put the register back as it was, so it is dropped;
   * the caller reads again after.
   */
  const wrote = (change: (sheets: ReadonlyArray<Sheet>) => Sheet[]) => {
    seq.current++
    setRows((r) => (r ? { ...r, sheets: change(r.sheets) } : r))
  }

  const reg = useMemo(() => (rows ? registerOf(rows.sheets, rows.pins, levelOf, rows.sheets.length >= 9 ? query : '') : null), [rows, query])
  const currentCount = useMemo(() => (rows ? registerOf(rows.sheets, [], levelOf).current.length : 0), [rows])

  const patch = (key: string, change: Partial<Upload>) => setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...change } : u)))

  /** Put each file up in turn (so a set goes up in order and each says how it went), then read the register again. */
  const send = async (items: Array<{ key: string; file: File; prior?: Sheet | null }>) => {
    for (const it of items) {
      patch(it.key, { state: 'uploading', message: undefined })
      const res = await uploadDrawing({ me, siteId: site.id, file: it.file, prior: it.prior ?? null })
      if (res.ok) {
        wrote((sheets) => placed(sheets, res.value))
        patch(it.key, { state: 'done', message: `On the register as ${res.value.version}${it.prior ? `, over ${it.prior.version ?? 'the old sheet'}` : ''}` })
      } else patch(it.key, { state: 'failed', message: res.message })
    }
    await load()
  }

  const onFiles = (files: File[]) => {
    const now = rowsNow.current
    if (!now) return // the drop zone is off until the register has been read
    // Every sheet on the job, current or superseded, whatever the search
    // shows; every file from earlier drops not on it yet; and each earlier
    // file of this drop.
    const outstanding = uploadsNow.current.filter((u) => OUTSTANDING.has(u.state)).map((u) => u.file)
    const hold = holdBack(files, now.sheets, outstanding)
    const fresh: Upload[] = files.map((file, i) => ({ key: `u${++uploadSeq}`, file, state: hold[i] ? 'held' : 'queued' }))
    setUploads((all) => [...all.filter((u) => u.state !== 'done'), ...fresh])
    void send(fresh.filter((u) => u.state === 'queued'))
  }

  // Refused before anything is sent: over 25 MB, or not a PDF or an image.
  const onReject = (rejected: Rejected[]) =>
    setUploads((all) => [...all.filter((u) => u.state !== 'done'), ...rejected.map((r) => ({ key: `u${++uploadSeq}`, file: r.file, state: 'failed' as const, message: `Not sent. ${r.reason}` }))])

  /** The office's answer for a held file, checked against the register and the uploads as they are now. */
  const decide = (u: Upload, how: 'revise' | 'new' | 'skip') => {
    // A second press before the list redraws must not send it twice.
    if (uploadsNow.current.find((x) => x.key === u.key)?.state !== 'held') return
    if (how === 'skip') {
      setUploads((all) => all.filter((x) => x.key !== u.key))
      return
    }
    let prior: Sheet | null = null
    if (how === 'revise') {
      const now = rowsNow.current
      const hold = now ? holdOf(u, now.sheets, uploadsNow.current) : null
      if (hold?.kind !== 'sheet') return
      // On top of the chain: over the current revision, whatever it is called.
      prior = hold.clash.head
    }
    void send([{ key: u.key, file: u.file, prior }])
  }

  const startRevision = (prior: Sheet) => {
    reviseFor.current = prior
    reviseInput.current?.click()
  }

  const pickedRevision = (list: FileList | null) => {
    const prior = reviseFor.current
    const file = list?.[0]
    if (!prior || !file) return
    const { rejected } = screenFiles([file], { accept: DRAWING_ACCEPT, maxBytes: DRAWING_MAX_BYTES })
    if (rejected.length) {
      toast(`Not sent. ${rejected[0]!.reason}`, { tone: 'error' })
      return
    }
    setReviseError(null)
    setRevise({ prior, file })
  }

  const confirmRevision = async () => {
    if (!revise) return
    setReviseBusy(true)
    setReviseError(null)
    const res = await uploadDrawing({ me, siteId: site.id, file: revise.file, prior: revise.prior })
    setReviseBusy(false)
    if (!res.ok) {
      setReviseError(res.message)
      return
    }
    wrote((sheets) => placed(sheets, res.value))
    toast(`${res.value.name} is now ${res.value.version}. ${revise.prior.version ?? 'The old sheet'} is superseded.`, { tone: 'success' })
    setRevise(null)
    await load()
  }

  const confirmRemove = async () => {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveError(null)
    const res = await removeDrawing(removing)
    setRemoveBusy(false)
    if (!res.ok) {
      setRemoveError(res.message)
      return
    }
    wrote((sheets) => sheets.filter((s) => s.id !== removing.id))
    const prior = reg?.replaces.get(removing.id)
    toast(`${removing.version ?? removing.name} of ${removing.name} removed.${prior ? ` ${prior.version ?? prior.name} is current again.` : ''}`, { tone: 'success' })
    if (res.warning) toast(res.warning, { tone: 'error' })
    setRemoving(null)
    await load()
  }

  const open = async (s: Sheet) => {
    if (!(await openSheet(s))) toast(`Could not open ${s.name}. Try again in a moment.`, { tone: 'error' })
  }

  const all = reg?.all ?? []
  const supersededCount = all.length - currentCount
  const openPins = reg ? [...reg.openPins.entries()].filter(([id]) => all.some((s) => s.id === id)).reduce((n, [, c]) => n + c, 0) : 0
  const summary = !reg
    ? loadError
      ? ' '
      : 'Loading…'
    : all.length === 0
      ? 'No drawings yet'
      : [plural(currentCount, 'current sheet'), supersededCount ? `${supersededCount} superseded` : null, openPins ? plural(openPins, 'open pin') : null].filter(Boolean).join(' · ')

  /** Open pins on a sheet: "2 open" in its own column, "2 open pins" under the name. */
  const pinsOf = (s: Sheet, inColumn: boolean): ReactNode => {
    if (rows?.pinsError) return inColumn ? <span style={{ color: color.faint }}>?</span> : null
    const n = reg?.openPins.get(s.id) ?? 0
    if (!n) return inColumn ? <span style={{ color: color.ghost }}>—</span> : null
    return (
      <span data-pins={n} title={plural(n, 'open pin')}>
        {inColumn ? `${n} open` : plural(n, 'open pin')}
      </span>
    )
  }

  const chipOf = (s: Sheet, superseded: boolean) => (
    <Chip size="sm" tone={superseded ? 'red' : 'green'}>
      <span data-chip="">{sheetChip(s.version, superseded)}</span>
    </Chip>
  )

  /** What replaced a superseded sheet: its revision, and its name when that changed. */
  const replacedWords = (s: Sheet) => {
    const newer = reg?.replacedBy.get(s.id)
    return newer ? { what: `${newer.version ?? 'A newer sheet'}${newer.name !== s.name ? ` · ${newer.name}` : ''}`, when: dateLabel(newer.created_at) } : null
  }

  /**
   * The sheet's name (which opens it) and the line under it. When the row is
   * too narrow for their own columns, the chip and the pins join that line;
   * `below` is what goes under it all when even the buttons have no column.
   */
  const nameCell = (s: Sheet, superseded: boolean, below?: ReactNode) => {
    const inline = fit !== 'wide'
    const prior = reg?.replaces.get(s.id)
    // The phone's words under a superseded sheet, and which revision it was.
    // Beside a SUPERSEDED chip, the revision and the warning are enough.
    const sub = superseded
      ? inline
        ? [s.version, 'do not use']
        : ['Superseded — do not use', s.version]
      : [`Issued ${dateLabel(s.created_at)}`, prior ? `replaces ${prior.version ?? prior.name}${prior.name !== s.name ? ` (${prior.name})` : ''}` : null]
    const pins = inline ? pinsOf(s, false) : null
    return (
      <span style={{ display: 'flex', alignItems: below ? 'flex-start' : 'center', gap: space.sm, minWidth: 0, padding: below ? `${space.sm}px 0` : undefined }}>
        <SheetIcon superseded={superseded} />
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <button
            type="button"
            className="wb-link wb-link--button"
            data-open-sheet={s.name}
            onClick={() => void open(s)}
            title={`Open ${s.name}`}
            style={{ ...text.base, fontWeight: 600, color: color.ink, textAlign: 'left', ...oneLine, maxWidth: '100%' }}
          >
            {s.name}
          </button>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, marginTop: inline ? 2 : 0, ...text.xs, color: superseded ? color.red : color.muted }}>
            {inline && <span style={{ flex: 'none', display: 'inline-flex' }}>{chipOf(s, superseded)}</span>}
            {/* Ahead of the date, which is the part that gives way when the line runs out of room. */}
            {pins && <span style={{ flex: 'none', color: superseded ? color.muted : color.ink }}>{pins} ·</span>}
            <span style={{ minWidth: 0, ...oneLine }}>{sub.filter(Boolean).join(' · ')}</span>
          </span>
          {below}
        </span>
      </span>
    )
  }

  const actionButtons = (s: Sheet) => (
    <>
      <Button size="sm" data-revise={s.name} onClick={() => startRevision(s)} title={`Put ${bumpVersion(s.version)} up over this sheet`}>
        Upload revision
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-remove={s.name}
        aria-label={`Remove ${s.version ?? ''} ${s.name}`.replace(/\s+/g, ' ')}
        onClick={() => {
          setRemoveError(null)
          setRemoving(s)
        }}
      >
        Remove
      </Button>
    </>
  )

  const revColumn = (superseded: boolean): Column<Sheet> => ({ key: 'rev', header: 'Revision', width: COL.rev, render: (s) => chipOf(s, superseded) })
  const pinsColumn: Column<Sheet> = { key: 'pins', header: 'Pins', width: COL.pins, render: (s) => pinsOf(s, true) }

  const currentColumns: Column<Sheet>[] =
    fit === 'tight'
      ? [{ key: 'sheet', header: 'Sheet', render: (s) => nameCell(s, false, <span style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>{actionButtons(s)}</span>) }]
      : [
          { key: 'sheet', header: 'Sheet', render: (s) => nameCell(s, false) },
          ...(fit === 'wide' ? [revColumn(false), pinsColumn] : []),
          {
            key: 'actions',
            header: <span className="wb-sr-only">Actions</span>,
            width: COL.end,
            align: 'right',
            render: (s) => <span style={{ display: 'inline-flex', gap: space.xs }}>{actionButtons(s)}</span>,
          },
        ]

  // Where the current table has its actions: a superseded sheet has none
  // (only the newest revision can come off), so this says what replaced it.
  const oldColumns: Column<Sheet>[] =
    fit === 'tight'
      ? [
          {
            key: 'sheet',
            header: 'Sheet',
            render: (s) => {
              const r = replacedWords(s)
              return nameCell(s, true, r ? <span style={{ ...text.xs, color: color.muted, marginTop: 2, ...oneLine }}>Replaced by {r.what}, {r.when}</span> : undefined)
            },
          },
        ]
      : [
          { key: 'sheet', header: 'Sheet', render: (s) => nameCell(s, true) },
          ...(fit === 'wide' ? [revColumn(true), pinsColumn] : []),
          {
            key: 'replaced',
            header: 'Replaced by',
            width: COL.end,
            render: (s) => {
              const r = replacedWords(s)
              if (!r) return null
              return (
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ ...text.sm, color: color.ink, ...oneLine }}>{r.what}</span>
                  <span style={{ ...text.xs, color: color.muted }}>{r.when}</span>
                </span>
              )
            },
          },
        ]

  const rowHeight = fit === 'tight' ? 64 : 56
  const finished = uploads.filter((u) => u.state === 'done' || u.state === 'failed').length

  return (
    <section ref={sectionRef} aria-labelledby="wb-drawings-h" data-register="" data-fit={fit} style={{ display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.md }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <h2 id="wb-drawings-h" style={heading}>
            Drawings
          </h2>
          <div data-register-summary="" style={{ ...text.sm, color: color.muted }}>
            {summary}
          </div>
        </div>
        {all.length >= 9 && (
          <Field
            id={searchId}
            label="Search sheets"
            hideLabel
            type="search"
            placeholder={`Search ${all.length} sheets`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 240, maxWidth: '100%' }}
          />
        )}
      </div>

      {loadError && (
        <Banner tone={rows ? 'warn' : 'error'} title={rows ? 'Showing the drawings as last loaded' : 'Could not load the drawings'} action={<Button size="sm" onClick={() => void load()}>Try again</Button>}>
          {loadError}
        </Banner>
      )}

      <div style={{ background: color.panel, borderRadius: radius.md }}>
        <DropZone
          accept={DRAWING_ACCEPT}
          maxBytes={DRAWING_MAX_BYTES}
          onFiles={onFiles}
          onReject={onReject}
          disabled={!rows}
          label={all.length === 0 ? 'Drop the drawing set here. Each sheet goes up as Rev A.' : 'Drop more sheets here. Each goes up as Rev A.'}
          hint={
            all.length === 0
              ? "The crew see them on their phones under Drawings straight away. PDF or image, up to 25 MB each."
              : 'PDF or image, up to 25 MB each. For a new revision of a sheet use Upload revision on its row, so the old one is marked superseded.'
          }
          buttonLabel="Choose sheets"
        />
      </div>

      {uploads.length > 0 && (
        <UploadList
          uploads={uploads}
          holdFor={(u) => holdOf(u, rows?.sheets ?? [], uploads)}
          finished={finished}
          onClear={() => setUploads((all) => all.filter((u) => u.state !== 'done' && u.state !== 'failed'))}
          onDecide={decide}
        />
      )}

      {rows?.pinsError && (
        <div style={{ ...text.sm, color: color.muted }}>Pin counts could not be read ({rows.pinsError}). The sheets below are up to date.</div>
      )}

      {reg && reg.shown.length === 0 && all.length > 0 && <div style={{ ...text.base, color: color.muted }}>Nothing matches “{query}”.</div>}

      {reg && reg.current.length > 0 && (
        <div data-current="" style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          {reg.levels ? (
            reg.levels.map(([lv, g]) => (
              <div key={lv} data-level={lv} style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
                <h3 style={label}>
                  {lv} · {g.sheets.length}
                </h3>
                <Table label={`${lv} drawings`} columns={currentColumns} rows={g.sheets} rowKey={(s) => s.id} rowHeight={rowHeight} />
              </div>
            ))
          ) : (
            <>
              <h3 style={label}>Current</h3>
              <Table label="Current drawings" columns={currentColumns} rows={reg.current} rowKey={(s) => s.id} rowHeight={rowHeight} />
            </>
          )}
        </div>
      )}

      {reg && reg.superseded.length > 0 && (
        <div data-superseded="" style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
          <h3 style={{ ...label, color: color.red }}>Superseded — do not build from</h3>
          <div style={{ ...text.sm, color: color.muted, marginBottom: space.xxs }}>
            Kept for the record. The crew see these in red with &ldquo;Do not build from it&rdquo;.
          </div>
          <Table label="Superseded drawings" columns={oldColumns} rows={reg.superseded} rowKey={(s) => s.id} rowHeight={rowHeight} rowStyle={() => ({ background: color.rowFill })} />
        </div>
      )}

      <input
        ref={reviseInput}
        type="file"
        accept={DRAWING_ACCEPT}
        hidden
        tabIndex={-1}
        data-revise-input=""
        onChange={(e) => {
          pickedRevision(e.target.files)
          e.target.value = ''
        }}
      />

      <Dialog
        open={!!revise}
        title={revise ? `Upload a revision of ${revise.prior.name}?` : ''}
        confirmLabel={revise ? `Upload as ${bumpVersion(revise.prior.version)}` : 'Upload'}
        busy={reviseBusy}
        error={reviseError}
        onConfirm={() => void confirmRevision()}
        onCancel={() => setRevise(null)}
      >
        {revise && (
          <>
            <strong style={{ color: color.ink }}>{revise.file.name}</strong> ({sizeLabel(revise.file.size)}) goes up as{' '}
            <strong style={{ color: color.ink }}>{bumpVersion(revise.prior.version)}</strong>.{' '}
            {revise.prior.version ?? 'The sheet it replaces'} moves under Superseded, and the crew&apos;s phones mark it red: do not build from it.
          </>
        )}
      </Dialog>

      <Dialog
        open={!!removing}
        title={removing ? `Remove ${removing.version ? `${removing.version} of ` : ''}${removing.name}?` : ''}
        confirmLabel="Remove"
        tone="danger"
        busy={removeBusy}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      >
        {removing && <RemoveWords sheet={removing} prior={reg?.replaces.get(removing.id) ?? null} pins={reg?.openPins.get(removing.id) ?? 0} />}
      </Dialog>
    </section>
  )
}

function RemoveWords({ sheet, prior, pins }: { sheet: Sheet; prior: Sheet | null; pins: number }) {
  return (
    <>
      The file and its record both go.{' '}
      {prior
        ? `${prior.version ?? prior.name}${prior.name !== sheet.name ? ` (${prior.name})` : ''} becomes the current sheet again on the crew's phones.`
        : "The sheet leaves the register on the crew's phones."}
      {pins > 0 && ` Its ${plural(pins, 'open pin')} go${pins === 1 ? 'es' : ''} with it.`}
    </>
  )
}

function UploadList({
  uploads,
  holdFor,
  finished,
  onClear,
  onDecide,
}: {
  uploads: Upload[]
  holdFor: (u: Upload) => Hold
  finished: number
  onClear: () => void
  onDecide: (u: Upload, how: 'revise' | 'new' | 'skip') => void
}) {
  const held = uploads.filter((u) => u.state === 'held').length
  return (
    <div data-uploads="" style={{ ...card, gap: 0, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px`, borderBottom: `1px solid ${color.borderSoft}` }}>
        <span style={{ flex: 1, ...text.sm, fontWeight: 600, color: color.ink }}>{held ? `${plural(held, 'file')} named like another sheet. Which is it?` : 'Uploads'}</span>
        {finished > 0 && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear finished
          </Button>
        )}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {uploads.map((u, i) => {
          const hold = u.state === 'held' ? holdFor(u) : null
          return (
            <li
              key={u.key}
              data-upload={u.file.name}
              data-state={u.state}
              data-hold={hold?.kind}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: `${space.xs}px ${space.sm}px`,
                minHeight: 44,
                padding: `${space.xs}px ${space.md}px`,
                borderTop: i === 0 ? undefined : `1px solid ${color.borderSoft}`,
              }}
            >
              {/* The buttons go under the words when there is not room for both. */}
              <span style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...text.base, color: color.ink, ...oneLine }}>
                  {u.file.name} <span style={{ ...text.xs, color: color.muted }}>{sizeLabel(u.file.size)}</span>
                </span>
                <UploadStatus u={u} hold={hold} />
              </span>
              {hold && (
                <span style={{ flex: 'none', display: 'inline-flex', flexWrap: 'wrap', gap: space.xs }}>
                  {hold.kind === 'sheet' && (
                    <Button size="sm" variant="primary" onClick={() => onDecide(u, 'revise')}>
                      Upload as {bumpVersion(hold.clash.head.version)}
                    </Button>
                  )}
                  <Button size="sm" variant={hold.kind === 'clear' ? 'primary' : 'secondary'} onClick={() => onDecide(u, 'new')}>
                    {hold.kind === 'clear' ? 'Upload as Rev A' : 'Add as another sheet'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDecide(u, 'skip')}>
                    Skip
                  </Button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** What a held file is named like, in words, and the question. */
function holdWords(u: Upload, hold: Hold): string {
  if (hold.kind === 'sheet') {
    const { sheet, head, superseded } = hold.clash
    if (!superseded) return `${sheet.name} is on the register as ${sheet.version ?? 'a current sheet'}. A revision of it, or a different sheet with the same name?`
    return `${sheet.name}${sheet.version ? ` ${sheet.version}` : ''} was superseded by ${head.version ?? 'a newer sheet'}${head.name !== sheet.name ? ` (${head.name})` : ''}. A newer revision, or a different sheet with the same name?`
  }
  if (hold.kind === 'upload') {
    return `Another ${hold.other.file.name} ${hold.other.state === 'held' ? 'is waiting for an answer above' : 'is still going up'}. The same sheet twice, or a different sheet with the same name?`
  }
  return `Nothing on the register is called ${u.file.name} now.`
}

function UploadStatus({ u, hold }: { u: Upload; hold: Hold | null }) {
  const words: Record<Upload['state'], ReactNode> = {
    queued: 'Waiting…',
    uploading: 'Uploading…',
    done: u.message,
    failed: u.message,
    held: hold ? holdWords(u, hold) : null,
  }
  const tone = u.state === 'failed' ? color.red : u.state === 'done' ? color.green : u.state === 'held' ? color.amber : color.muted
  return (
    <span role={u.state === 'failed' ? 'alert' : undefined} style={{ ...text.xs, color: tone }}>
      {words[u.state]}
    </span>
  )
}

// ---------------------------------------------------------------- programme

function ProgrammePanel({ me, site }: JobTabProps) {
  const toast = useToast()
  const [data, setData] = useState<Programmes | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [revision, setRevision] = useState('')
  const [issuedOn, setIssuedOn] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seq = useRef(0)
  const load = useCallback(async () => {
    const n = ++seq.current
    try {
      const p = await loadProgrammes(site.id)
      if (n !== seq.current) return
      setData(p)
      setLoadError(null)
    } catch (e) {
      if (n === seq.current) setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [site.id])

  useEffect(() => {
    void load()
  }, [load])
  useFresh(() => void load())

  const current = data?.current ?? null
  const upload = async () => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    const res = await uploadProgramme({ me, siteId: site.id, file, revision, issuedOn })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    toast(`${res.row.revision?.trim() || res.row.name} is now the current programme.${res.superseded.length ? ' The one before is superseded.' : ''}`, { tone: 'success' })
    if (res.warning) toast(res.warning, { tone: 'error' })
    setRevision('')
    setIssuedOn('')
    setFile(null)
    await load()
  }

  const open = async (row: ProgrammeRow) => {
    if (!(await openProgramme(row))) toast(row.storage_path ? 'Could not open that programme. Try again in a moment.' : 'This revision has no file.', { tone: 'error' })
  }

  return (
    <aside aria-labelledby="wb-programme-h" data-programme="" style={{ display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 }}>
      <section style={card}>
        <div>
          <h2 id="wb-programme-h" style={heading}>
            Builder&apos;s programme
          </h2>
          {/* The line the phone's Project details shows, in the phone's own words. */}
          <div data-programme-line="" style={{ ...text.sm, color: color.muted }}>
            {data ? programmeLine(current, false) : loadError ? ' ' : 'Loading…'}
          </div>
        </div>

        {loadError && (
          <Banner tone={data ? 'warn' : 'error'} title={data ? 'Showing the programme as last loaded' : 'Could not load the programme'} action={<Button size="sm" onClick={() => void load()}>Try again</Button>}>
            {loadError}
          </Banner>
        )}

        {current && <ProgrammeCard row={current} current onOpen={() => void open(current)} />}
        {data && !current && (
          <div style={{ ...text.sm, color: color.body }}>
            Nothing here yet. When the builder issues a programme, put it up here; every revision after it stacks on top, and the crew always open the one that counts.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, paddingTop: space.sm, borderTop: `1px solid ${color.borderSoft}` }}>
          <h3 style={label}>{current ? 'Upload a new revision' : 'Upload the programme'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)', gap: space.xs }}>
            <Field label="Revision" placeholder="Rev C" value={revision} onChange={(e) => setRevision(e.target.value)} data-programme-revision="" />
            <Field label="Issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} data-programme-issued="" />
          </div>
          {file ? (
            <div data-programme-file="" style={{ display: 'flex', alignItems: 'center', gap: space.xs, padding: `${space.xs}px ${space.xs}px ${space.xs}px ${space.sm}px`, background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.md }}>
              <span style={{ flex: 1, minWidth: 0, ...text.sm, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name} <span style={{ color: color.muted }}>{sizeLabel(file.size)}</span>
              </span>
              <IconButton label="Choose a different file" size={28} onClick={() => setFile(null)} disabled={busy}>
                <CloseIcon size={12} />
              </IconButton>
            </div>
          ) : (
            <DropZone
              multiple={false}
              accept={PROGRAMME_ACCEPT}
              maxBytes={PROGRAMME_MAX_BYTES}
              onFiles={(f) => {
                setRefused(null)
                setError(null)
                setFile(f[0] ?? null)
              }}
              onReject={(r) => setRefused(`Not sent. ${r[0]!.reason}`)}
              label="Drop the programme here"
              hint="PDF, or a photo of the printed programme"
              buttonLabel="Choose the PDF"
            />
          )}
          {refused && !file && (
            <div role="alert" style={{ ...text.sm, color: color.red }}>
              {refused}
            </div>
          )}
          {error && (
            <div role="alert" style={{ ...text.sm, color: color.red }}>
              {error}
            </div>
          )}
          <Button variant="primary" block disabled={!file} loading={busy} onClick={() => void upload()} data-programme-upload="">
            {current ? 'Upload as the current revision' : 'Upload as the current programme'}
          </Button>
          {current && <div style={{ ...text.xs, color: color.muted }}>{current.revision?.trim() || current.name} above becomes superseded. It stays readable underneath.</div>}
        </div>
      </section>

      {data && data.history.length > 0 && (
        <section aria-labelledby="wb-programme-old" data-programme-history="" style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
          <h3 id="wb-programme-old" style={label}>
            Superseded — do not work to these
          </h3>
          {data.history.map((r) => (
            <ProgrammeCard key={r.id} row={r} current={false} onOpen={() => void open(r)} />
          ))}
        </section>
      )}
    </aside>
  )
}

/** One revision; pressing it opens the file the builder sent. */
function ProgrammeCard({ row, current, onOpen }: { row: ProgrammeRow; current: boolean; onOpen: () => void }) {
  const when = [row.issued_on ? `Issued ${dateLabel(row.issued_on)}` : null, `received ${dateLabel(row.received_on)}`].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      className="wb-focus"
      onClick={onOpen}
      data-programme-row={row.status}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space.sm,
        width: '100%',
        padding: `${space.sm}px`,
        background: current ? color.panel : color.rowFill,
        border: `1px solid ${current ? color.border : color.borderSoft}`,
        borderRadius: radius.md,
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden="true" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: radius.sm, background: color.fill, fontSize: 9.5, fontWeight: 800, letterSpacing: '.03em', color: current ? color.body : color.faint }}>
        {/\.pdf$/i.test(row.storage_path ?? '.pdf') ? 'PDF' : 'IMG'}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...text.base, fontWeight: 600, color: current ? color.ink : color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.revision?.trim() || row.name}</span>
        <span style={{ ...text.xs, color: color.muted }}>{when}</span>
      </span>
      <Chip size="sm" tone={current ? 'green' : 'neutral'}>
        {current ? 'Current' : 'Superseded'}
      </Chip>
    </button>
  )
}
