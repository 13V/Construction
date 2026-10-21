/**
 * Schedule, /schedule: the phone's own schedule (Quarter, Month, Week, Day)
 * at the page's full width.
 *
 * SimpleSchedule runs unchanged inside a Contained host, given exactly what
 * the phone gives it: useSimpleData(me), me, and an onOpenJob. Nothing is
 * redrawn for the desk, so a job's bar, its dates and who is rostered read
 * here exactly as they do on the crew's phones. Its "+" (Add to programme)
 * sheet is position:fixed, and the host's transform keeps it inside the
 * host rather than across the whole window.
 *
 * KEEPING IT FRESH. useFresh asks again when the window regains focus, when
 * the tab becomes visible, and every minute; so does the browser coming back
 * online. Two kinds of data sit on this page, and they refresh differently:
 *
 *  - useSimpleData (job names, progress, defects, flood-test holds) has a
 *    refresh(), called at each of those moments. It swaps rows in place, so
 *    nothing on screen moves. A load that fails is reported in a banner, and
 *    the schedule keeps the last load that came back whole until another
 *    one does: the retries in between change nothing on screen.
 *
 *  - The schedule's own rows (every job's bar, the week's bookings) are
 *    fetched inside SimpleSchedule once, when it mounts, and it takes no
 *    prop to ask again (adding one would change the iOS bundle). Mounting
 *    it again is the only way to reload them, and a fresh mount opens on
 *    this quarter, at the top, with no sheet open. So a new copy is mounted
 *    out of sight, and it takes the old one's place only once it has
 *    LOADED, and its load GOT THROUGH:
 *      · loaded: its chart shows job rows, or its own "Nothing in this
 *        window". While it is fetching it shows neither. However slow the
 *        connection, the chart on screen never goes blank.
 *      · got through: SimpleSchedule draws a failed fetch as an empty chart
 *        ("Nothing in this window", "Nobody rostered"), which looks exactly
 *        like an empty quarter, so its own result cannot say. So each copy
 *        sends one small read of its own, its witness, in the same moment as
 *        the copy's own requests, over the same connection and session. It
 *        must come back without an error, and the browser must say it is
 *        online. A laptop that wakes before its Wi-Fi is back fails both.
 *        The witness belongs to its copy alone: nothing that happens later
 *        (another refresh, the network coming back) can pass a copy whose
 *        own moment failed.
 *    A copy that has not done both within 30 s is dropped. The old copy
 *    stays, with its old "Updated" time, and the page tries again at the
 *    next minute, focus or return online. While a new copy is loading,
 *    those moments leave useSimpleData alone: the copy's own refresh of it
 *    is already under way, and asking again would only restart it.
 *
 *    A reload that nobody asked for also takes nothing from the person:
 *      · they have not touched the schedule since it loaded (it is still on
 *        that opening view), or they last touched it 30 minutes ago; and
 *      · no form is open in it (a half-typed programme line is never lost).
 *    And it happens only when it is worth it: they have come back after 15
 *    seconds or more away, what is shown is 5 minutes old, or the last try
 *    failed.
 *
 *  The header says when the copy on screen was loaded. Refresh loads a new
 *  copy at once and shows it as soon as it has loaded (back to this quarter:
 *  the person asked), or says that it could not. If they start using the
 *  schedule while it loads (open the sheet, pick a view, scroll, Tab into
 *  it), what they are doing wins: the new copy is not put up, and the header adds "not
 *  reloaded" to the time it still shows.
 *
 *  Opening /schedule always loads it fresh, as opening the Schedule tab does
 *  on the phone. That first copy is judged too: by its witness and its
 *  chart, or, once the person has touched it or moved it off its chart (Week
 *  and Day draw none), by its witness alone. If its witness failed, the
 *  header says "Did not load", and the next reload replaces it even if it
 *  has been touched: a chart drawn from requests that did not get through
 *  is empty, and not a view worth keeping. If nothing has answered either
 *  way after 30 s, the header says so too, but a view they have touched is
 *  kept on the usual terms: a slow answer is not a failed one.
 *
 * WHEN SOMETHING DID NOT LOAD, one banner says which, in plain words. The
 * server's own message ("TypeError: Failed to fetch") is in its tooltip only.
 *  - The copy on screen did not load (it failed, or is late): "The schedule
 *    did not load".
 *  - What is on screen is whole, but a refresh or Refresh did not get
 *    through: "The schedule did not reload", and the time it is from.
 *  - The chart loaded, but the job details it is drawn with never have
 *    (one view failing): "Part of the schedule did not load".
 *
 * THE LAYOUT is one column that fills the window under the header (and
 * under the rail's bar, on a narrow window): the schedule, and the banner
 * under it when there is one. The banner takes its
 * room from the schedule's bottom, so the window does not scroll, the +
 * sheet (fixed to the schedule's bottom) stays on screen, and the top of the
 * schedule does not move when the banner comes or goes.
 *
 * KEYBOARD. Focus in the schedule counts as using it, as a press does. A
 * swap, or the banner going, would leave focus on nothing; it goes back to
 * the same control in the new copy (or its first), or to Refresh. Refresh
 * and Try again stay focusable while they load.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useFresh } from '../data/useFresh'
import { supabase, useSimpleData, type JobSiteRow, type SimpleData } from '../phone'
import { SimpleSchedule, type PhoneJobTab } from '../phone-features'
import type { PageProps } from '../routes'
import { navigate, paths, type JobTab } from '../router'
import { Contained } from '../shell/Contained'
import { Page } from '../shell/PageHeader'
import { color, size, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button, Spinner } from '../ui/Button'

/**
 * The phone's job tabs, as the website's: every one has its own tab. A
 * Record, so a tab the phone adds later fails the type check here instead of
 * opening nowhere.
 */
const WEB_TAB: Record<PhoneJobTab, JobTab> = {
  overview: 'overview',
  safety: 'safety',
  crew: 'crew',
  photos: 'photos',
  chat: 'chat',
  money: 'money',
}

/** Back after this long away counts as coming back: reload if nothing is lost. */
const AWAY_MS = 15_000
/** Reload anyway, if nothing is lost, once what is shown is this old. */
const STALE_MS = 5 * 60_000
/** A view somebody chose is theirs until they have left it alone this long. */
const IDLE_MS = 30 * 60_000
/**
 * A copy that has not loaded by now counts as failed. supabase-js retries a
 * read that cannot connect after 1, 2 and 4 s, so a dead connection reports
 * in about 7 s; a slow one that still answers has well over three times that.
 */
const LOAD_MAX_MS = 30_000
/** How often a copy that is loading is looked at. */
const CHECK_MS = 200

/**
 * The page's body, the schedule and any banner under it, fills the window
 * from its own top (under the 64 px header, and below 768 px wide under the
 * rail's bar too) to above the page's 48 px foot. The schedule takes what
 * the banner leaves and scrolls inside itself, as it does on a phone; the
 * window does not scroll. Not below 480 px: a shorter window scrolls instead.
 */
const bodyHeight = (top: number) => `max(480px, calc(100vh - ${top + space.xxl}px))`

/**
 * The phone's own words, which say whether a copy's chart has loaded: the
 * heading of its job column (in Quarter and Month), with the job rows drawn
 * beside it, and what it says once loaded when no job falls in the window.
 * Read from its output, never changed. Nothing fails to compile if the phone
 * rewords either, so a test that reads the phone's source must pin both.
 */
const CHART_HEAD = 'PROJECT'
const CHART_EMPTY = 'Nothing in this window'

/** What can take keyboard focus in the phone's schedule. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const shownStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
// Not laid out and out of the accessibility tree, but mounted, so its queries run.
const loadingStyle: CSSProperties = { display: 'none' }

/** One mount of the phone's schedule loading out of sight. `forced`: Refresh asked for it. */
interface Load {
  gen: number
  startedAt: number
  forced: boolean
}

/**
 * The copy on screen. 'checking' until it is judged; 'ok' loaded and got
 * through; 'failed' its witness failed (or the browser was offline), so its
 * chart is empty; 'late' nothing either way after LOAD_MAX_MS. A late copy
 * is still judged, in case the answer comes after all.
 */
type ShownState = 'checking' | 'late' | 'ok' | 'failed'

/** A copy's witness: its one read, sent beside the copy's own requests. */
type Witness = 'pending' | 'ok' | 'failed'

/**
 * The chart's PROJECT column, in Quarter and Month, or null in Week and Day,
 * which draw no chart. Read from the phone's own output, never changed, as
 * formOpen below is.
 */
function projectColumn(copy: Element): Element | null {
  for (const span of copy.querySelectorAll('span')) {
    if (span.textContent === CHART_HEAD) return span.parentElement
  }
  return null
}

/**
 * Whether a copy's chart has finished loading: job rows under PROJECT, or
 * its own "Nothing in this window". Until then it shows neither. Should the
 * phone reword either, this stays false and a copy loading out of sight
 * counts as failed after LOAD_MAX_MS: the page keeps the chart it has and
 * never puts an empty one up.
 */
function chartLoaded(copy: Element): boolean {
  if (copy.textContent?.includes(CHART_EMPTY)) return true
  return (projectColumn(copy)?.childElementCount ?? 0) > 1
}

/**
 * Where focus goes in a new copy when the one it was in is swapped out: the
 * control with the same name (Week, Next, …), or else the copy's first.
 */
function counterpart(was: Element, copy: Element | null): HTMLElement | null {
  if (!copy) return null
  const all = [...copy.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute('disabled'))
  const same = (x: Element) => x.tagName === was.tagName && x.getAttribute('aria-label') === was.getAttribute('aria-label') && x.textContent === was.textContent
  return all.find(same) ?? all[0] ?? null
}

/** "3:41 pm" today, "14 Oct, 3:41 pm" on another day, in the phone's clock style. */
function loadedLabel(at: number) {
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  if (d.toDateString() === new Date().toDateString()) return time
  return `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}, ${time}`
}

export default function SchedulePage({ me }: PageProps) {
  const data = useSimpleData(me)

  // Each generation is one mount of the phone's schedule. `shown` is on
  // screen; `loading` is a newer one fetching out of sight, or null.
  const [gens, setGens] = useState<{ shown: number; loading: number | null }>({ shown: 0, loading: null })
  const nextGen = useRef(1)
  /** When the copy on screen started loading: what "Updated" says. */
  const [loadedAt, setLoadedAt] = useState(() => Date.now())
  const [shownState, setShownState] = useState<ShownState>('checking')
  /** The copy loading out of sight (mirrors gens.loading), with what it needs to be judged. */
  const pending = useRef<Load | null>(null)
  /** Each mounted copy's witness, by generation. */
  const witness = useRef(new Map<number, Witness>())
  /** Refresh's copy is loading: its button spins. */
  const [refreshing, setRefreshing] = useState(false)
  /** Refresh's copy did not load or did not get through. */
  const [refreshFailed, setRefreshFailed] = useState(false)
  /** Refresh's copy loaded, but the person had started using the schedule, so it was not put up. */
  const [setAside, setSetAside] = useState(false)
  /** The last reload was given up: try again at the next chance, stale or not. */
  const owed = useRef(false)

  const host = useRef<HTMLDivElement>(null)
  const banner = useRef<HTMLDivElement>(null)
  /** The body's top in the document: the header's foot, plus the rail's bar on a narrow window. */
  const body = useRef<HTMLDivElement>(null)
  const [bodyTop, setBodyTop] = useState<number>(size.header)
  const refreshButton = useRef<HTMLButtonElement>(null)
  /** When the person last pressed, typed, scrolled or moved focus in the schedule; null since it loaded. */
  const touchedAt = useRef<number | null>(null)
  /** When the window was left (blurred or hidden); null while they are here. */
  const awaySince = useRef<number | null>(null)

  /**
   * useSimpleData's last load that came back whole, and the error of the
   * last one that did not, until one comes back whole again. A failed load
   * empties its lists (the phone's own behaviour), and the schedule names its
   * week cards from them, so one dropped refresh would blank the bookings of
   * a copy that loaded fine. The hook also clears its error as each retry
   * starts while still holding the failed load's empty lists, so "is there
   * an error now" is not enough: from a failure until a whole load, the
   * schedule keeps the last whole one and the banner stays up, unmoved.
   */
  const lastWhole = useRef<SimpleData | null>(null)
  /** When lastWhole came back: a banner over it says how old it is. */
  const lastWholeAt = useRef(0)
  const lastError = useRef<string | null>(null)
  useEffect(() => {
    if (!data.loading && data.error === null) lastWhole.current = data
  })
  // useSimpleData sets loading and error together when a load ends, so the
  // error read here is that load's.
  useEffect(() => {
    if (data.loading) return
    if (data.error !== null) {
      lastError.current = data.error
      return
    }
    lastWholeAt.current = Date.now()
    if (lastError.current !== null) {
      lastError.current = null
      // A Refresh that failed while the data was failing too said nothing the
      // banner did not; with the data back, the reload it owes is on its way,
      // so it stays unsaid.
      setRefreshFailed(false)
    }
  }, [data.loading, data.error])
  const dataError = data.error ?? (data.loading ? lastError.current : null)
  const scheduleData = dataError !== null && lastWhole.current !== null ? lastWhole.current : data

  useEffect(() => {
    const leave = () => {
      if (awaySince.current === null) awaySince.current = Date.now()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave()
    }
    window.addEventListener('blur', leave)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', leave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Every copy's witness is sent as it mounts. Effects run child first, so
  // it leaves right behind the copy's own requests, in the same moment. A
  // copy that is gone takes its witness with it; a late answer finds nothing.
  useEffect(() => {
    const live = [gens.shown, gens.loading]
    for (const gen of [...witness.current.keys()]) if (!live.includes(gen)) witness.current.delete(gen)
    for (const gen of live) {
      if (gen === null || witness.current.has(gen)) continue
      witness.current.set(gen, 'pending')
      const settle = (seen: Witness) => {
        if (witness.current.get(gen) === 'pending') witness.current.set(gen, seen)
      }
      void supabase()
        .from('job_sites')
        .select('id')
        .limit(1)
        .then(
          ({ error }) => settle(error ? 'failed' : 'ok'),
          () => settle('failed'),
        )
    }
  }, [gens.shown, gens.loading])

  const touch = useCallback(() => {
    touchedAt.current = Date.now()
  }, [])

  const copyOf = (gen: number) => host.current?.querySelector(`[data-schedule-gen="${gen}"]`) ?? null

  // The only form fields in the phone's schedule are its Add to programme
  // sheet's. Read, never changed: this is how the page knows a sheet is open
  // without a prop on the phone component.
  const formOpen = () => !!copyOf(gens.shown)?.querySelector('input, textarea, select')

  /**
   * Whether a new copy may take the screen. Never over an open form. Over a
   * copy whose witness failed, always: its chart is empty. Otherwise only if
   * the person is not using the one there (a press, a key, a scroll, or
   * focus moving in it): for a reload nobody asked for, untouched since it
   * loaded or left alone 30 minutes; for Refresh's (`forcedAt`, when it was
   * pressed), not touched since then. Focus still in it when it goes moves
   * to the new copy (see focusWas).
   */
  const mayReplace = (now: number, forcedAt: number | null) => {
    if (formOpen()) return false
    const touched = touchedAt.current
    if (shownState === 'failed' || touched === null) return true
    return forcedAt !== null ? touched < forcedAt : now - touched >= IDLE_MS
  }

  /**
   * A copy that began loading at `startedAt`. `onScreen`: the first copy,
   * judged where the person can use it; a copy out of sight is untouched and
   * on its opening chart, so its chart can always be read.
   */
  const judge = (gen: number, startedAt: number, onScreen: boolean): 'wait' | 'late' | 'ok' | 'failed' => {
    const seen = witness.current.get(gen) ?? 'pending'
    if (seen === 'failed') return 'failed'
    const copy = copyOf(gen)
    if (seen === 'ok' && copy !== null) {
      if (chartLoaded(copy)) return 'ok'
      // Moved off its chart, or in use: its chart can no longer say, and a
      // timeout on the chart alone must not cost them the view they chose.
      if (onScreen && (touchedAt.current !== null || projectColumn(copy) === null)) return 'ok'
    }
    if (!navigator.onLine) return 'failed'
    return Date.now() - startedAt > LOAD_MAX_MS ? 'late' : 'wait'
  }

  /** Mount a new copy out of sight, with a fresh useSimpleData load beside it. */
  const startLoad = (forced: boolean) => {
    const gen = nextGen.current++
    pending.current = { gen, startedAt: Date.now(), forced }
    // Replaces any copy still loading: Refresh wants one begun now.
    setGens((g) => ({ ...g, loading: gen }))
    data.refresh()
    setRefreshing(forced)
    if (forced) {
      setRefreshFailed(false)
      setSetAside(false)
    }
  }

  /** Put the loaded copy on screen, or drop it and keep the one there. */
  const finishLoad = (load: Load, verdict: 'ok' | 'failed') => {
    pending.current = null
    setRefreshing(false)
    const drop = () => setGens((g) => (g.loading === load.gen ? { ...g, loading: null } : g))
    if (verdict === 'failed') {
      drop()
      owed.current = true
      // The banner says the schedule did not reload, and the time it is from.
      if (load.forced) setRefreshFailed(true)
      return
    }
    owed.current = false
    if (!mayReplace(Date.now(), load.forced ? load.startedAt : null)) {
      // What the person is doing wins; the header's time says how old the schedule is.
      drop()
      if (load.forced) setSetAside(true)
      return
    }
    setGens((g) => (g.loading === load.gen ? { shown: load.gen, loading: null } : g))
    setLoadedAt(load.startedAt)
    setShownState('ok')
    setRefreshFailed(false)
    setSetAside(false)
    touchedAt.current = null
  }

  /** Every CHECK_MS while a copy is being judged. */
  const check = () => {
    // The copy on screen first, so a copy swapped in below has the last word on shownState.
    if (shownState === 'checking' || shownState === 'late') {
      const verdict = judge(gens.shown, loadedAt, true)
      if (verdict !== 'wait' && verdict !== shownState) {
        setShownState(verdict)
        if (verdict !== 'ok') owed.current = true
      }
    }
    const load = pending.current
    if (load) {
      const verdict = judge(load.gen, load.startedAt, false)
      if (verdict === 'ok') finishLoad(load, 'ok')
      else if (verdict !== 'wait') finishLoad(load, 'failed')
    }
  }
  const latestCheck = useRef(check)
  useEffect(() => {
    latestCheck.current = check
  })
  const checking = gens.loading !== null || shownState === 'checking' || shownState === 'late'
  useEffect(() => {
    if (!checking) return
    const timer = window.setInterval(() => latestCheck.current(), CHECK_MS)
    return () => window.clearInterval(timer)
  }, [checking])

  /**
   * Refresh: a new copy now, on screen once it has loaded, back on this
   * quarter (the person asked), unless they start using the schedule meanwhile.
   */
  const reloadNow = () => {
    // Already loading one: pressing again would only start it over.
    if (!refreshing) startLoad(true)
  }

  /** useFresh's moments, and the browser coming back online. */
  const freshen = () => {
    const now = Date.now()
    const here = document.visibilityState === 'visible' && document.hasFocus()
    const cameBack = here && awaySince.current !== null && now - awaySince.current >= AWAY_MS
    if (here) awaySince.current = null
    // A copy is loading with its own useSimpleData load beside it: asking
    // again would only restart that load. If the copy fails, it is owed.
    if (pending.current !== null) return
    const due = owed.current || shownState === 'failed' || shownState === 'late' || cameBack || now - loadedAt >= STALE_MS
    if (due && navigator.onLine && mayReplace(now, null)) {
      startLoad(false)
      return
    }
    // Offline, a copy would only fail: try once the browser is back online.
    if (due && !navigator.onLine) owed.current = true
    data.refresh()
  }
  useFresh(freshen)
  const latestFreshen = useRef(freshen)
  useEffect(() => {
    latestFreshen.current = freshen
  })
  useEffect(() => {
    const onOnline = () => latestFreshen.current()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // Measured before the first paint, and again whenever what is above it can
  // change height: the window's width (the rail's bar wraps), late fonts.
  useLayoutEffect(() => {
    const measure = () => {
      const el = body.current
      if (el) setBodyTop(Math.round(el.getBoundingClientRect().top + window.scrollY))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(document.body)
    window.addEventListener('resize', measure)
    return () => {
      watch.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const openJob = useCallback((site: JobSiteRow, tab?: PhoneJobTab) => {
    navigate(paths.job(site.id, WEB_TAB[tab ?? 'overview']))
  }, [])

  // What had focus as this render began, if it was in the schedule or the
  // banner. This render may take it out of the page (a copy swapped out, the
  // banner gone), and the browser would leave focus on nothing; a keyboard
  // would start again from the top of the page.
  const active = document.activeElement
  const focusWas =
    active && host.current?.contains(active) ? { el: active, inHost: true } : active && banner.current?.contains(active) ? { el: active, inHost: false } : null
  useLayoutEffect(() => {
    if (!focusWas || focusWas.el.isConnected) return
    const now = document.activeElement
    if (now && now !== document.body) return
    ;((focusWas.inHost ? counterpart(focusWas.el, copyOf(gens.shown)) : null) ?? refreshButton.current)?.focus()
  })

  const status =
    shownState === 'checking'
      ? 'Loading…'
      : shownState === 'ok'
        ? `Updated ${loadedLabel(loadedAt)}${setAside ? ' · not reloaded' : ''}`
        : 'Did not load'
  // Not `loading`, which disables the button: a disabled button drops the
  // keyboard focus that pressed it. It spins, reads as unavailable, and ignores presses.
  const busy = refreshing ? { 'aria-disabled': true } : {}
  const tryAgain = (
    <Button size="sm" onClick={reloadNow} icon={refreshing ? <Spinner /> : undefined} {...busy}>
      Try again
    </Button>
  )
  /**
   * One banner, saying what is missing from what is on screen. The server's
   * message is not words for the person ("TypeError: Failed to fetch"), so it
   * is only in the tooltip. Through retries it keeps its element and words,
   * so it is not announced again.
   */
  const problem: { title: string; body: string; detail?: string } | null =
    shownState === 'failed' || shownState === 'late'
      ? // The chart on screen is empty, or still loading.
        { title: 'The schedule did not load', body: 'Check the connection, then try again.', detail: dataError ?? undefined }
      : shownState === 'checking'
        ? // Not judged yet: the header says "Loading…", and which of the above it is comes soon.
          null
        : dataError !== null && lastWhole.current === null
          ? // The chart loaded; the job details it is drawn with never have.
            { title: 'Part of the schedule did not load', body: 'Bookings, progress or defects may be missing. Check the connection, then try again.', detail: dataError }
          : dataError !== null || refreshFailed
            ? // Nothing is missing: it is all from the last load that got through.
              {
                title: 'The schedule did not reload',
                // Its chart's rows are from loadedAt, its job details from the last
                // whole load: the older of the two.
                body: `This is the schedule as it was at ${loadedLabel(dataError !== null ? Math.min(loadedAt, lastWholeAt.current || loadedAt) : loadedAt)}. Check the connection, then try again.`,
                detail: dataError ?? undefined,
              }
            : null

  return (
    <Page
      title="Schedule"
      actions={
        <>
          {/* Beside the button rather than under the title: a second header
              line would push the host below the fold. At a phone's width the
              end of a long status gives way before the page's title does. */}
          <span
            title={setAside && shownState === 'ok' ? 'You started using the schedule while Refresh was loading it, so the new copy was not put up. Press Refresh to load it again.' : undefined}
            style={{
              ...text.sm,
              color: shownState === 'failed' || shownState === 'late' ? color.red : color.muted,
              marginRight: space.xs,
              maxWidth: '32vw',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {status}
          </span>
          <Button
            ref={refreshButton}
            onClick={reloadNow}
            title="Load the schedule again, from this quarter"
            icon={refreshing ? <Spinner /> : <RefreshIcon />}
            {...busy}
          >
            Refresh
          </Button>
        </>
      }
    >
      <div ref={body} style={{ height: bodyHeight(bodyTop), display: 'flex', flexDirection: 'column', gap: space.md }}>
        <div
          ref={host}
          style={{ flex: 1, minHeight: 0 }}
          onPointerDownCapture={touch}
          onKeyDownCapture={touch}
          onWheelCapture={touch}
          onTouchStartCapture={touch}
          // Tab into the schedule is using it too: the keydown that moved
          // focus here happened outside it.
          onFocusCapture={touch}
        >
          <Contained height="100%" label="The schedule, as the crew see it">
            {[gens.shown, gens.loading].map((gen) =>
              gen === null ? null : (
                <div key={gen} data-schedule-gen={gen} style={gen === gens.shown ? shownStyle : loadingStyle}>
                  <SimpleSchedule data={scheduleData} me={me} onOpenJob={openJob} />
                </div>
              ),
            )}
          </Contained>
        </div>
        {problem && (
          <div ref={banner} style={{ flex: 'none' }}>
            <Banner tone="error" title={problem.title} action={tryAgain}>
              <span title={problem.detail && `Details: ${problem.detail}`}>{problem.body}</span>
            </Banner>
          </div>
        )}
      </div>
    </Page>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M11.6 5.4A4.9 4.9 0 0 0 2.6 4.6M2.4 8.6a4.9 4.9 0 0 0 9 .8M11.8 2.2v3.3H8.5M2.2 11.8V8.5h3.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
