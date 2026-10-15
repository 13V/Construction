/**
 * The job's Waterproofing tab: where the six steps stand, with the crew's own
 * screen beside it.
 *
 * Left, a desktop summary worked out by the phone's own rules
 * (useWaterproofing, stepsOf), so "2 of 6" here is the number the foreman
 * sees on site. Right, the phone's WaterproofingPanel, mounted unchanged in a
 * 440 px Contained host: step editing, evidence uploads and the certificate
 * behave exactly as they do on the phone, and their sheets open inside the
 * host. Editing happens there in v1 (the owner approved hosting the phone's
 * panels); a desktop editor is later work.
 *
 * PanelBeside, the two-column frame with the refresh rules, is exported for
 * SafetyTab.tsx, which hosts the phone's Safety tab the same way.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useFresh } from '../../data/useFresh'
import { stepsOf, useWaterproofing, WaterproofingPanel, type Step } from '../../phone-features'
import { BUCKET_FILES, signedUrl, supabase, viewFile } from '../../phone'
import { Contained } from '../../shell/Contained'
import { color, radius, shadow, space, text } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button } from '../../ui/Button'
import { Chip, type ChipTone } from '../../ui/Chip'
import type { JobTabProps } from '../types'

export default function WaterproofingTab({ me, site }: JobTabProps) {
  const wp = useWaterproofing(site)

  return (
    <PanelBeside
      label="Waterproofing, as the crew see it"
      live={wp.loading ? null : wp}
      reload={wp.reload}
      print={wpPrint}
      recheck={(read, trusted) => wpRecheck(site.id, read, trusted)}
      summary={(view) => <WaterproofingSummary view={view} />}
      panel={
        // On the phone the panel sits in Overview's scroller with 26 px under
        // it (Overview.tsx); the host's own scroller stands in for that one.
        <div style={{ paddingBottom: 26 }}>
          <WaterproofingPanel me={me} site={site} />
        </div>
      }
    />
  )
}

type Wp = ReturnType<typeof useWaterproofing>

/** Everything the summary draws from, so the frame can tell when a re-read found something new (see PanelBeside). */
const wpPrint = (wp: Wp) => JSON.stringify([wp.pkg, wp.files.map((f) => [f.id, f.wp_step, f.category, f.kind]), wp.wet])

/**
 * What to ask again before a read is believed (see PanelBeside): each of the
 * hook's three reads that came back empty where the last trusted read had
 * rows, or, before there is one, might have. An empty package is the one that
 * matters most: it reads as "Nothing recorded yet", and the panel's step 1
 * would then try to start a second package.
 */
function wpRecheck(siteId: string, read: Wp, trusted: Wp | null): Recount[] {
  const asks: Recount[] = []
  if (!read.pkg && (!trusted || trusted.pkg)) {
    asks.push(() => supabase().from('waterproofing_packages').select('id', { count: 'exact', head: true }).eq('site_id', siteId))
  }
  // The evidence is read by package, so it can only be asked after for a package known of.
  const pkgId = read.pkg?.id ?? trusted?.pkg?.id
  if (pkgId && read.files.length === 0 && trusted?.files.length !== 0) {
    asks.push(() => supabase().from('site_files').select('id', { count: 'exact', head: true }).eq('waterproofing_package_id', pkgId))
  }
  if (read.wet.length === 0 && trusted?.wet.length !== 0) {
    asks.push(() => supabase().from('waterproofing').select('id', { count: 'exact', head: true }).eq('site_id', siteId))
  }
  return asks
}

// ------------------------------------------------------------------ the frame

/** A phone is 390-430 px wide and the panels are drawn for that. */
const HOST_W = 440
/** Below this a step sheet has no room for its form. */
const HOST_MIN_H = 520
/** The "Same screens as the crew app" line over the host, and the gap under it. */
const CAPTION_H = 20 + space.xs
/** How long the panel must stay still before the summary reads again. */
const SETTLE_MS = 600

/** A count query (`head: true`): how many rows there are, or why it could not say. */
export type Recount = () => PromiseLike<{ count: number | null; error: unknown }>

/** What the summary is given to draw. */
export interface SummaryView<T> {
  /** The latest read the page believes, or null before there is one. */
  data: T | null
  /** The last read failed. `data`, if there is any, is the one before it, read at `readAt`. */
  failed: boolean
  readAt: number | null
  /** A read, or the check on one, is under way. */
  busy: boolean
  /** Read again now. */
  retry: () => void
}

export interface PanelBesideProps<T> {
  /** The desktop summary, on the left. */
  summary: (view: SummaryView<T>) => ReactNode
  /** The phone's own screen, mounted as it is. */
  panel: ReactNode
  /** What a screen reader calls the host. */
  label: string
  /** The summary's hook data, or null until its first read has landed. */
  live: T | null
  /** Re-read everything the summary shows. */
  reload: () => Promise<void>
  /** The data as one string, so a re-read that found something new can be told apart from one that did not. */
  print: (data: T) => string
  /** The count queries that decide whether a read with empty parts is right. None: it is shown as it is. */
  recheck: (read: T, trusted: T | null) => Recount[]
}

/**
 * The summary on the left, the phone's panel in a 440 px host on the right.
 * Below 1024 px the host goes under the summary (web.css's wb-split); between
 * that and about 1200 px the summary column is narrow (about 260 px at 1024),
 * and the summaries are laid out to wrap rather than squeeze.
 *
 * The panel keeps its own copy of the data and tells the page nothing: it has
 * no callback, and giving it one would change the iOS bundle. So the two
 * halves are kept in step from outside, by watching the panel's DOM (read
 * only, nothing in it is touched):
 *
 *  - The summary re-reads when the panel goes still for SETTLE_MS after any
 *    change. Every save, upload or removal in the panel ends in a redraw (its
 *    sheet closes, its list reloads), so this is when the summary catches up
 *    with what was done in the panel. The Safety tab's own upload button,
 *    which has no sheet, is caught the same way.
 *  - It also re-reads through useFresh: when the window regains focus, when
 *    the tab is shown again, and every minute while it is visible.
 *  - If a re-read found new data while the panel's own screen (its sheets
 *    aside) has not changed since the last one, the change came from
 *    somewhere else, a crew member on site, and the panel has not seen it. The
 *    panel is then remounted so it reads again. A change the panel did draw
 *    is its own, and needs nothing: after each of its own writes the panel
 *    re-reads everything, so it is up to date at that point anyway.
 *  - That is only judged while none of the panel's sheets is open and no
 *    upload of its own is going. A save takes longer than SETTLE_MS, so with
 *    a sheet open (or an upload under way) the panel may be part way through
 *    one, its data written but not yet drawn; and remounting then would throw
 *    away a half-filled form or the upload's last step. The first re-read
 *    judged after that compares with the last one before it, so a crew change
 *    made meanwhile still counts. (A write of the panel's own that changes
 *    nothing it draws costs one needless remount.)
 *
 * A read that failed is never believed. The phone's hooks swallow their
 * errors: a query that failed leaves its part of the data empty, which looks
 * exactly like a job with nothing recorded. So a read with a part empty that
 * the last believed read had rows in (or, for the first read, any empty part)
 * is checked first, with count queries whose errors are seen (`recheck`). If
 * they find rows, or fail, the read failed: the summary keeps the last
 * believed read and says it could not refresh, and the panel is left alone.
 * Remounting it then would only have it read the same failure, where left
 * alone it keeps the data it had. Only when the counts confirm the parts are
 * empty (the last document was removed on site) is the read shown. If the
 * page's very first read failed, the panel's own first read, made at the same
 * moment, probably did too, so the panel is remounted once a read succeeds.
 */
export function PanelBeside<T>({ summary, panel, label, live, reload, print, recheck }: PanelBesideProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [hostH, setHostH] = useState(HOST_MIN_H)
  // Re-reads of the summary finished, re-reads under way, and times the panel went still.
  const [reads, setReads] = useState(0)
  const [rereading, setRereading] = useState(0)
  const [settles, setSettles] = useState(0)
  // Goes up to remount the panel, so it reads again.
  const [generation, setGeneration] = useState(0)
  // The last read believed: what the summary shows.
  const [trusted, setTrusted] = useState<{ data: T; at: number } | null>(null)
  // What the check on a doubted read found, for that read (its number and print).
  const [verdict, setVerdict] = useState<{ read: number; print: string; ok: boolean } | null>(null)
  // A read failed, and none has been believed since.
  const [failing, setFailing] = useState(false)
  // The summary's data and the panel's screen as of the last re-read judged.
  const seen = useRef<{ print: string; text: string } | null>(null)
  // The first read failed, so the panel's own first read may have too.
  const resync = useRef(false)

  // The host fills the window below where it starts, so a sheet anchored to
  // its bottom edge is on screen without scrolling. Measured, not a fixed
  // calc(), because the job page's header above it is not this tab's.
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const fit = () => {
      const top = grid.getBoundingClientRect().top + window.scrollY
      setHostH(Math.max(HOST_MIN_H, Math.floor(window.innerHeight - top - CAPTION_H - space.lg)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const latest = useRef({ reload, recheck, live, trusted })
  useEffect(() => {
    latest.current = { reload, recheck, live, trusted }
  })
  // `reads` is set after the re-read's own state updates, so the render that
  // sees it already has the new data.
  const reread = useCallback(() => {
    setRereading((n) => n + 1)
    const done = () => {
      setRereading((n) => n - 1)
      setReads((n) => n + 1)
    }
    void latest.current.reload().then(done, done)
  }, [])

  useFresh(reread)

  useEffect(() => {
    const el = panelRef.current
    if (!el || typeof MutationObserver === 'undefined') return
    let timer: number | undefined
    const watch = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setSettles((n) => n + 1), SETTLE_MS)
    })
    watch.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      watch.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (settles > 0) reread()
  }, [settles, reread])

  // Is the read in hand to be believed? Worked out while rendering, so a
  // failed read is never drawn, not even for a frame.
  const livePrint = live === null ? null : print(live)
  const doubted = live !== null && recheck(live, trusted?.data ?? null).length > 0
  const checked = verdict && verdict.read === reads && verdict.print === livePrint ? verdict.ok : null
  const believed = live !== null && (!doubted || checked === true)
  const checkKey = live !== null && doubted && checked === null ? `${reads}\n${livePrint}` : null
  const acceptKey = believed ? `${reads}\n${livePrint}` : null

  // Check a doubted read. A newer read makes this one's answer moot. (The
  // key changes whenever `reads` or `livePrint` do, unless it is null.)
  useEffect(() => {
    if (checkKey === null) return
    const { live: read, recheck: asks, trusted: before } = latest.current
    if (read === null) return
    const at = reads
    const p = livePrint ?? ''
    let gone = false
    void Promise.all(asks(read, before?.data ?? null).map(foundNone)).then((all) => {
      if (gone) return
      const ok = all.every(Boolean)
      setVerdict({ read: at, print: p, ok })
      if (!ok) {
        setFailing(true)
        if (!before) resync.current = true
      }
    })
    return () => {
      gone = true
    }
  }, [checkKey, reads, livePrint])

  // A read believed: the summary shows it, and is there news the panel's
  // screen does not show? Once per read, as above.
  useEffect(() => {
    if (acceptKey === null) return
    const read = latest.current.live
    if (read === null) return
    setTrusted({ data: read, at: Date.now() })
    setFailing(false)
    const root = panelRef.current
    if (reads === 0 || !root || sheetOpen(root) || uploading(root)) return
    const now = { print: livePrint ?? '', text: screenText(root) }
    const last = seen.current
    if (resync.current || (last && last.print !== now.print && last.text === now.text)) {
      resync.current = false
      setGeneration((n) => n + 1)
    }
    seen.current = now
  }, [acceptKey, reads, livePrint])

  const view: SummaryView<T> = believed
    ? { data: live, failed: false, readAt: null, busy: rereading > 0, retry: reread }
    : { data: trusted?.data ?? null, failed: failing || checked === false, readAt: trusted?.at ?? null, busy: rereading > 0 || checkKey !== null, retry: reread }

  return (
    <div ref={gridRef} className="wb-split" style={{ '--wb-side-w': `${HOST_W}px` } as CSSProperties}>
      <div style={{ minWidth: 0 }}>{summary(view)}</div>
      <div style={{ position: 'sticky', top: space.md, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, marginBottom: space.xs, ...text.sm, fontWeight: 600, color: color.body }}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flex: 'none' }}>
            <rect x="3.5" y="1" width="7" height="12" rx="1.6" fill="none" stroke={color.muted} strokeWidth="1.3" />
            <path d="M6.2 10.8h1.6" stroke={color.muted} strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Same screens as the crew app
        </div>
        <Contained width={HOST_W} height={hostH} label={label}>
          {/* display:contents, so the panel lays out as a child of the host's
              own column (the Safety tab scrolls itself as a flex child) while
              this element still gives the watcher one root to observe. */}
          <div ref={panelRef} data-panel-root="" style={{ display: 'contents' }}>
            <Fragment key={generation}>{panel}</Fragment>
          </div>
        </Contained>
      </div>
    </div>
  )
}

/** Whether a count came back, and found no rows. A failure is not "no rows". */
async function foundNone(ask: Recount): Promise<boolean> {
  try {
    const { count, error } = await ask()
    return !error && count === 0
  } catch {
    return false
  }
}

/**
 * The panel's open bottom sheets. In the phone's panels the sheets are the
 * only things drawn position:fixed (Waterproofing.tsx, Safety.tsx), always as
 * an inline style.
 */
function sheetsIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => el.style.position === 'fixed')
}

const sheetOpen = (root: HTMLElement | null) => sheetsIn(root).length > 0

/**
 * An upload of the panel's own is under way. The phone disables a file input
 * only while its upload, and the re-read after it, are going (the Safety
 * tab's sheet-less "Upload document" among them).
 */
const uploading = (root: HTMLElement) => root.querySelector('input[type="file"]:disabled') !== null

/** What the panel's screen says, its open sheets left out. */
function screenText(root: HTMLElement | null): string {
  let all = root?.textContent ?? ''
  for (const sheet of sheetsIn(root)) {
    const part = sheet.textContent ?? ''
    const at = part ? all.indexOf(part) : -1
    // A sheet opened from inside another is already gone with its parent.
    if (at >= 0) all = all.slice(0, at) + all.slice(at + part.length)
  }
  return all
}

/**
 * Over a summary whose last read failed. With an older read to show it says
 * so and when that was; with none, that nothing could be read. It never shows
 * a failed read as an empty record.
 */
export function ReadFailed({ view, what }: { view: SummaryView<unknown>; what: string }) {
  if (!view.failed) return null
  const retry = (
    <Button size="sm" loading={view.busy} onClick={view.retry}>
      Try again
    </Button>
  )
  return (
    <div data-read-failed="">
      {view.data && view.readAt ? (
        <Banner tone="warn" title="Could not refresh" action={retry}>
          This is {what} as read at {new Date(view.readAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}. It is
          read again every minute, and when you come back to this tab.
        </Banner>
      ) : (
        <Banner tone="error" title={`Could not load ${what}`} action={retry}>
          The database did not answer. It is tried again every minute, and when you come back to this tab.
        </Banner>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the summary

/** The phone's words for a step's state (its stepChip), in the website's chip tones. */
const STEP_CHIP: Record<Step['state'], { label: string; tone: ChipTone }> = {
  complete: { label: 'Complete', tone: 'green' },
  required: { label: 'Required', tone: 'amber' },
  pending: { label: 'Pending', tone: 'neutral' },
}

/** The six steps' names, for the rows drawn before there is a record to judge them by. */
const NAMES = stepsOf(null, [])

const day = (v: string | null) =>
  v ? new Date(v.length > 10 ? v : `${v}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

const card: CSSProperties = {
  background: color.panel,
  border: `1px solid ${color.borderSoft}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
  overflow: 'hidden',
}
const heading: CSSProperties = { margin: 0, ...text.label, color: color.muted }

function WaterproofingSummary({ view }: { view: SummaryView<Wp> }) {
  const wp = view.data
  const steps = wp?.steps ?? NAMES
  const total = steps.length
  const done = wp?.done ?? 0

  // The one state the phone's Overview card turns red for (WaterproofingButton):
  // the membrane is down and the flood test has not passed, which is what
  // holds up every claim on the job.
  const covered = Boolean(wp?.pkg?.installed_on) || Boolean(wp?.wet.some((r) => r.status === 'complete' || r.status === 'signed_off'))
  const floodHold = Boolean(wp) && covered && (wp?.pkg ? wp.pkg.flood_test_result !== 'pass' : Boolean(wp?.wet.some((r) => !r.flood_tested)))

  const status = !wp
    ? view.failed
      ? null
      : 'Loading…'
    : done === total
      ? wp.pkg?.certificate_sent_at
        ? `All six done. Certificate sent ${day(wp.pkg.certificate_sent_at)}${wp.pkg.certificate_sent_to ? ` to ${wp.pkg.certificate_sent_to}` : ''}.`
        : 'All six done. Ready to issue the certificate.'
      : !wp.pkg
        ? 'Nothing recorded yet. Saving any step in the panel starts the record.'
        : `Outstanding: ${wp.outstanding.map((st) => st.short).join(', ')}.`

  return (
    <div data-wp-summary="" style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <ReadFailed view={view} what="the waterproofing record" />

      <section aria-label="Waterproofing progress" style={{ ...card, padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.sm }}>
        <h2 style={heading}>Waterproofing</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.xs }}>
          <span data-wp-done={wp ? done : undefined} style={{ ...text.display, color: color.ink }}>
            {wp ? `${done} of ${total}` : '–'}
          </span>
          <span style={{ ...text.base, color: color.muted }}>steps complete</span>
        </div>
        <Meter steps={steps} blank={!wp} />
        {status && (
          <p data-wp-status="" style={{ margin: 0, ...text.base, color: color.body }}>
            {status}
          </p>
        )}
      </section>

      {floodHold && (
        <Banner tone="error" title="Flood test not passed">
          The membrane is down and the flood test has not passed. Nothing on this job can be claimed until it does.
        </Banner>
      )}

      <section aria-label="The six steps" style={card}>
        <h2 style={{ ...heading, padding: `${space.md}px ${space.lg}px ${space.xs}px` }}>The six steps</h2>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {steps.map((st) => (
            <StepRow key={st.key} step={st} blank={!wp} />
          ))}
        </ol>
      </section>

      {wp && <CertificateCard wp={wp} />}

      <p style={{ margin: 0, ...text.sm, color: color.muted }}>
        Steps are changed on the crew’s own screen, under “Same screens as the crew app”. What is saved there is what
        the crew see on site.
      </p>
    </div>
  )
}

/** Six segments in step order: green for a done step, grey for the rest, as the phone's ring is. */
function Meter({ steps, blank }: { steps: Step[]; blank: boolean }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: 4 }}>
      {steps.map((st) => (
        <span
          key={st.key}
          style={{ flex: 1, height: 6, borderRadius: radius.pill, background: !blank && st.state === 'complete' ? color.green : color.borderSoft }}
        />
      ))}
    </div>
  )
}

/** One step. `blank`: no record has been read yet, so only its name is drawn. */
function StepRow({ step, blank }: { step: Step; blank: boolean }) {
  const chip = STEP_CHIP[step.state]
  const done = !blank && step.state === 'complete'
  return (
    <li
      data-step={step.key}
      data-state={blank ? undefined : step.state}
      style={{ display: 'flex', alignItems: 'flex-start', gap: space.sm, padding: `${space.sm}px ${space.lg}px`, borderTop: `1px solid ${color.borderSoft}` }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          marginTop: 1,
          boxSizing: 'border-box',
          borderRadius: '50%',
          border: done ? 0 : `1.5px solid ${color.border}`,
          background: done ? color.green : color.panel,
          color: done ? color.onDark : color.muted,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {done ? (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2.6 6.2l2.2 2.1 4.6-4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          step.n
        )}
      </span>
      {/* The words and the state share one wrapping line. In a narrow column
          (a window of 1024 to about 1200 px, where the host still sits
          beside the summary) the state drops under the words instead of
          squeezing them to a word a line. */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: space.sm, rowGap: space.xxs }}>
        <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ ...text.base, fontWeight: 600, color: color.ink }}>
            <span className="wb-sr-only">Step {step.n}: </span>
            {step.title}
          </div>
          {!blank &&
            step.lines.map((l, i) => (
              <div key={i} style={{ ...text.sm, color: l.tone === 'green' ? color.green : l.tone === 'amber' ? color.amber : color.muted }}>
                {l.text}
              </div>
            ))}
        </div>
        {!blank && (
          // Shrinks and wraps too, for the narrowest column: "No documents
          // yet" and a chip are wider than its words column at 1024 px.
          <div style={{ flex: '0 1 auto', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: space.xs, rowGap: space.xxs, minHeight: 22 }}>
            {step.count && <span style={{ ...text.xs, color: color.muted }}>{step.count}</span>}
            <Chip size="sm" tone={chip.tone}>
              {chip.label}
            </Chip>
          </div>
        )}
      </div>
    </li>
  )
}

/** What the certificate will say and where it is up to: the part a builder asks about. */
function CertificateCard({ wp }: { wp: Wp }) {
  const { pkg, files, wet } = wp
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)
  const supplier = files.some((f) => f.wp_step === 'certificates' && f.category === 'supplier_warranty')
  const scope = pkg?.scope_of_work?.trim() || (wet.length ? `waterproofing to ${wet.map((r) => r.area.toLowerCase()).join(' + ')}` : '')

  async function open(path: string, name: string) {
    setOpening(true)
    setFailed(false)
    const url = await signedUrl(BUCKET_FILES, path)
    setOpening(false)
    if (url) viewFile({ url, name })
    else setFailed(true)
  }

  const rows: Array<[string, ReactNode]> = [
    ['Certificate', pkg?.certificate_no ? `${pkg.certificate_no} · generated ${day(pkg.certificate_generated_at)}` : 'Not generated yet'],
    ['Sent to the builder', pkg?.certificate_sent_at ? `${day(pkg.certificate_sent_at)}${pkg.certificate_sent_to ? ` · ${pkg.certificate_sent_to}` : ''}` : 'Not sent'],
    ['Supplier warranty', supplier ? 'On file' : 'Not uploaded'],
    ['Scope of work', scope || 'Not written yet'],
  ]

  return (
    <section aria-label="Certificate" style={{ ...card, padding: `${space.md}px ${space.lg}px` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm, rowGap: space.xs, marginBottom: space.xs }}>
        <h2 style={{ ...heading, flex: '1 1 auto' }}>Certificate of compliance</h2>
        {pkg?.certificate_path && (
          <Button size="sm" loading={opening} onClick={() => void open(pkg.certificate_path!, `${pkg.certificate_no ?? 'Certificate'}.pdf`)}>
            View certificate
          </Button>
        )}
      </div>
      {/* Each row wraps on its own: in a narrow column the value goes under
          its label rather than into a sliver beside a 160 px one. */}
      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: space.xs }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexWrap: 'wrap', columnGap: space.md }}>
            <dt style={{ flex: '0 0 160px', ...text.sm, color: color.muted }}>{k}</dt>
            <dd style={{ flex: '1 1 160px', minWidth: 0, margin: 0, ...text.sm, color: color.ink, overflowWrap: 'anywhere' }}>{v}</dd>
          </div>
        ))}
      </dl>
      {failed && <p style={{ margin: `${space.xs}px 0 0`, ...text.sm, color: color.red }}>The certificate could not be opened. Try again in a moment.</p>}
    </section>
  )
}
