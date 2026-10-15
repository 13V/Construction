/**
 * Team, /team: the phone's own "Your crew" sheet (TeamSheet), unchanged, in
 * a 560 px column.
 *
 * Adding someone, the email they will sign up with, their role, removing and
 * restoring: all of it is the phone's code, so a person added here is the
 * same row, with the same checks and read-backs, as one added from the Me
 * tab on a phone. Closing the sheet goes back to the jobs board.
 *
 * HostedSheet, the column itself, is exported for CompanyPage.tsx, which
 * hosts the phone's Business sheet the same way. It belongs in shell/ by
 * rights; it lives here because this package owns only the two page files,
 * and it can move there unchanged.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useFresh } from '../data/useFresh'
import { WEB_BRAND } from '../marker'
import { supabase, type WorkerRow } from '../phone'
import { TeamSheet } from '../phone-features'
import type { PageProps } from '../routes'
import { navigate, paths } from '../router'
import { Contained } from '../shell/Contained'
import { Page } from '../shell/PageHeader'
import { color, radius, shadow, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'

/**
 * The columns TeamSheet reads (Team.tsx's COLS), in its order, so the page
 * can tell when the roster has changed under the sheet. A column the sheet
 * adds later and this misses only means a change to it is noticed late.
 */
const ROSTER_COLS = 'id, name, initials, trade, role, active, invite_email, auth_user_id'

/** A row as TeamSheet reads it (Team.tsx's Member). */
interface Member {
  id: string
  name: string
  initials: string
  trade: string | null
  role: WorkerRow['role']
  active: boolean
  invite_email: string | null
  auth_user_id: string | null
}

/**
 * The sheet's controls that write, by their text as Team.tsx draws them.
 * Everything else in it (Add someone, Cancel, Show removed, a trade, a role,
 * the title) only changes what is on screen. If the phone renames one, its
 * writes are taken as made elsewhere and the sheet is reloaded once it has
 * been left alone: needless, never wrong. rosterExplains uses these labels.
 */
const TEAM_WRITES = ['ADD TO CREW', 'Remove', 'Restore'] as const

export default function TeamPage({ me }: PageProps) {
  const read = useCallback(async () => {
    // By id within a name as well, so two people with one name cannot swap
    // places between reads and look like a change.
    const { data, error } = await supabase().from('workers').select(ROSTER_COLS).order('name').order('id')
    if (error) throw error
    return (data ?? []) as unknown as Member[]
  }, [])

  return (
    <Page title="Team" subtitle="Everyone on your books. Add someone and they can be booked onto jobs straight away.">
      <HostedSheet
        label="Your crew, as the app shows it"
        read={read}
        writes={TEAM_WRITES}
        explains={rosterExplains}
        check={rosterCheck}
        failed="Could not load your crew"
      >
        <TeamSheet me={me} onClose={() => navigate(paths.jobs)} />
      </HostedSheet>
    </Page>
  )
}

/**
 * Whether the sheet's own presses account for the whole of a change to the
 * roster. A press only counts when the sheet plainly did what it says: a
 * press that wrote nothing (a blank name, a bad or taken email, a refusal, a
 * Remove cancelled at its confirm) accounts for nothing, so a change found
 * after it is taken as made elsewhere and the sheet is reloaded.
 *
 * Add to crew: once the row is in, the sheet closes its form and reads its
 * whole list again (Team.tsx's add() ends in load()), so it shows everything
 * up to that moment, whatever else changed. It wrote when its form has
 * closed and the list has a new row by the name that was typed; a refused
 * add leaves the form open with an error in it.
 *
 * Remove and Restore read nothing: the sheet flips that one row's `active`
 * in its own list. So every row that changed must be one of the rows whose
 * control was pressed, flipped the way that control flips it, with nothing
 * else about it changed; anything more came from elsewhere.
 */
function rosterExplains(before: Member[], after: Member[], presses: readonly SheetPress[], sheet: HTMLElement | null): boolean {
  const was = new Map(before.map((w) => [w.id, w]))

  const added = after.filter((w) => !was.has(w.id))
  const addWrote =
    !!sheet &&
    !hasForm(sheet) &&
    presses.some((p) => p.label === 'ADD TO CREW' && added.some((w) => p.typed.some((t) => t.trim() === w.name)))
  if (addWrote) return true

  if (added.length > 0 || after.length !== before.length) return false
  const flips = presses.filter((p) => p.label !== 'ADD TO CREW')
  for (const w of after) {
    const b = was.get(w.id)
    if (!b) return false
    // Same select, same key order, so the JSON compares field by field.
    if (JSON.stringify({ ...b, active: w.active }) !== JSON.stringify(w)) return false
    if (b.active === w.active) continue
    // The press on this row's own control; each press flips one row once.
    const i = flips.findIndex((p) => p.label === (w.active ? 'Restore' : 'Remove') && p.row.includes(w.name.trim()))
    if (i < 0) return false
    flips.splice(i, 1)
  }
  return true
}

/**
 * The sheet's own line, "4 people on the books", against the read. Every
 * write the sheet makes changes that line as it lands, so when the two
 * disagree the sheet is behind, whatever anyone pressed. (A read that
 * crosses one of the sheet's own writes, or its reload after an add, can
 * find them apart for a moment; the sheet is then reloaded for nothing.) A
 * sheet whose own read failed shows "0 people", and its error, for a company
 * that has at least its owner on the books, so 0 against a read with people
 * in it means it loaded nothing. Null when the line is not there to read.
 */
function rosterCheck(sheet: HTMLElement, rows: Member[]): 'empty' | 'behind' | null {
  let shown: number | null = null
  for (const el of sheet.querySelectorAll('span')) {
    const m = el.childElementCount === 0 ? /^(\d+) (?:people|person) on the books$/.exec(el.textContent ?? '') : null
    if (m) {
      shown = Number(m[1])
      break
    }
  }
  if (shown === null) return null
  const active = rows.filter((w) => w.active).length
  if (shown === active) return null
  return shown === 0 ? 'empty' : 'behind'
}

// ------------------------------------------------------------- the column

/** The column's width: wider than a phone, so the sheet's rows breathe, and still one column. */
const COLUMN_W = 560
/** The phone's sheets are at most 92% of the screen (maxHeight '92%', Team.tsx and Business.tsx). */
const SHEET_SHARE = 0.92
/** And round their top corners by 16 px. */
const SHEET_RADIUS = 16
/** Below this the add form has no room. */
const MIN_VISIBLE = 420
/**
 * How the column cuts the host to the panel: clip where the browser has it
 * (nothing can scroll a clip), else hidden (Safari 15 has no clip, and would
 * show the host whole). See HostedSheet.
 */
const CUT = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('overflow', 'clip') ? 'clip' : 'hidden'
/** Under the column: the page's own bottom padding (Page, space.xxl) and the column's two border pixels. */
const BOTTOM_GAP = space.xxl + 2

/** How long the sheet must stay still after a change before the page reads again. */
const SETTLE_MS = 600
/** A read made this long after a press on one of `writes` can still find that press's own write. */
const PRESS_MS = 5_000
/** A sheet with no form open, somebody has used, is theirs until they leave it alone this long (they may be reading it). */
const IDLE_MS = 30_000
/**
 * A form left exactly as it loaded or was saved holds nothing to lose, and
 * Save would put stale details back over somebody else's, so it is reloaded
 * once it has been left alone this long. More than SWAP_MS, so a press while
 * a new copy loads always stops the swap.
 */
const QUIET_MS = 3_000
/** How long a new copy loads out of sight before it replaces the one on screen. */
const SWAP_MS = 1_500

/**
 * For a sheet that is one form over one row (the Business sheet). Both are
 * read-only: the form is read off the sheet's fields, never set.
 */
export interface SheetForm<T> {
  /** What the sheet's form holds, as one string; null when it shows no form (loading, or its read failed). */
  read: (sheet: HTMLElement) => string | null
  /** The same string for a read: what the form holds once it has loaded that row, or once Save has written it. */
  of: (data: T) => string
}

/** A press on one of the sheet's `writes`, as the sheet stood at that moment (read off it, never changed). */
export interface SheetPress {
  /** The control's text: 'ADD TO CREW', 'Remove'. */
  label: string
  /** The text of each element in the control's row, the control's own excepted: for a Remove, that person's initials, name and trade line. */
  row: readonly string[]
  /** What each field in the sheet held: for Add to crew, the name and email typed. */
  typed: readonly string[]
}

export interface HostedSheetProps<T> {
  /** What a screen reader calls the column. */
  label: string
  /**
   * Reads from the database what the sheet shows (the same rows and columns
   * it reads itself), or throws. Compared as JSON from one read to the next.
   */
  read: () => Promise<T>
  /** Every successful read, for whatever the page shows beside the sheet. */
  onRead?: (data: T) => void
  /** The sheet's controls that write, by their text exactly as it draws them ('SAVE', 'Remove'). */
  writes: readonly string[]
  /**
   * Whether the presses on `writes` since the last change account for all of
   * a change, given the reads before and after it and the copy on screen as
   * it is now. Without it, any change the read after such a press finds is
   * taken as theirs.
   */
  explains?: (before: T, after: T, presses: readonly SheetPress[], sheet: HTMLElement | null) => boolean
  /** For a sheet that is one form over the read: then whether a change is on screen is read off the form itself. */
  form?: SheetForm<T>
  /**
   * Reads the copy on screen, once it has finished loading, against a read
   * that worked: 'empty' when it plainly loaded nothing (its own read failed
   * while the page's worked), 'behind' when it plainly shows something other
   * than the read, null when it agrees or that cannot be told. Asked after
   * every read, whether or not the read found a change, and for 'empty'
   * also when the copy finishes loading.
   */
  check?: (sheet: HTMLElement, data: T) => 'empty' | 'behind' | null
  /**
   * Shown above the column when the sheet is behind the database and cannot
   * be reloaded quietly, because somebody has typed in it. `action` labels
   * the button that reloads it anyway. Without this the page waits until the
   * sheet can be reloaded without taking anything from anyone.
   */
  behind?: { title: string; body: ReactNode; action: string }
  /** The title of the banner shown when the page cannot read, and the sheet has most likely loaded nothing either. */
  failed: string
  /** The phone's sheet, mounted as it is. */
  children: ReactNode
}

/**
 * One of the phone's full-screen sheets, in a column on a page.
 *
 * WHAT IS SHOWN. The sheet is position:fixed, inset 0, with its panel at the
 * bottom and a dimmed backdrop above it; tapping the backdrop closes it. In a
 * Contained host it fills the host instead of the window. A host as tall as
 * the window would be mostly backdrop over a short crew list, and a click on
 * that dark space would leave the page. So the column shows only the panel:
 * the host is made tall enough that the panel's 92% can reach the room the
 * window has, and the column is cut to the panel's measured height, from the
 * bottom, with its corners rounded as the panel's are. The backdrop is
 * outside the cut and cannot be clicked; the sheet's own X still closes it.
 * Nothing in the sheet is touched: it is measured and read, never styled.
 *
 * The cut is made with overflow clip where the browser has it (Safari 16+):
 * nothing, not even a focused field, can scroll a clip. Safari 15 (the last
 * on macOS Catalina) drops it and would show the whole host, backdrop and
 * all, over the page's title; there it is overflow hidden, which cuts the
 * same, and has nothing to scroll to, since the host overflows the column
 * only upwards.
 *
 * KEEPING IT FRESH. The sheet reads its rows once, when it mounts, and takes
 * no prop to read again (a new prop would change the iOS bundle). So the
 * page reads the same rows itself, through useFresh (focus, a visible tab
 * again, every minute), and once the sheet goes still after a press on one
 * of its `writes`. Each read is compared with the last, and a change it
 * finds is either already on screen or the sheet is behind:
 *
 *  - With `form`, that is read off the sheet: the change is on screen when
 *    the form shows it, or showed it when one of `writes` (Save) was
 *    pressed, because that is what the save wrote. Nothing is timed.
 *  - Without it, only the read that follows a press on one of `writes`
 *    (Add to crew, Remove, Restore), made once the sheet has gone still and
 *    within PRESS_MS of the press, can find the person's own write, and
 *    `explains` says whether the press accounts for all of the change: only
 *    a press that plainly wrote counts, read off the sheet (the form closed,
 *    the very row pressed flipped). A read on focus, on a visible tab or on
 *    the minute always takes a change as made elsewhere. So at worst the
 *    person's own write is reloaded for nothing.
 *  - And `check`, after every read, compares what the sheet itself shows
 *    with the read (Team: its "4 people on the books" line), whoever made
 *    the change and whenever it was found.
 *
 * What can still be missed, on Team: a change from elsewhere that leaves the
 * number of people as it was (a rename, an email), made in the second
 * between an add's own reload of the list and the page's read after it. It
 * shows when the sheet is next reloaded for any reason, or the page opened.
 *
 * A sheet that is behind is reloaded: a new copy is mounted to read again,
 * out of sight, and swapped in once it has loaded, so nothing flashes. That
 * happens only when it takes nothing from the person: nobody has used the
 * copy on screen; or it holds a form exactly as loaded or saved, with no
 * field focused, and has been left alone QUIET_MS; or it holds no form and
 * has been left alone IDLE_MS. A form somebody has typed in, or clicked into
 * (a reload would take the cursor out from under them), or one the page
 * cannot read, like Team's add form, is never reloaded under them; the page
 * shows `behind` instead, if given, and waits.
 *
 * WHEN IT CANNOT READ. A copy that mounted while reads were failing has most
 * likely loaded nothing (the Business sheet is then a blank card), so the
 * page says so, with Try again, until a read works; and when one does, it
 * reloads that copy quietly. A copy whose own read failed while the page's
 * worked is found by `check` ('empty') and reloaded quietly too, at most
 * once per read the page makes, so a sheet that keeps failing is not
 * reloaded in a loop. A failed read after the copy on screen has loaded is
 * a blip: what it shows stays, and the next read tries again.
 */
export function HostedSheet<T>({
  label,
  read,
  onRead,
  writes,
  explains,
  form,
  check,
  behind: behindBanner,
  failed,
  children,
}: HostedSheetProps<T>) {
  const frame = useRef<HTMLDivElement>(null)
  const shownCopy = useRef<HTMLDivElement>(null)

  // Each generation is one mount of the sheet. `shown` is on screen;
  // `loading` is a newer one reading out of sight, or null.
  const [gens, setGens] = useState<{ shown: number; loading: number | null }>({ shown: 0, loading: null })
  const gensNow = useRef(gens)
  const nextGen = useRef(1)

  /** The room the window has for the column, and the panel's height in it (null: not measurable). */
  const [avail, setAvail] = useState(MIN_VISIBLE)
  const [panelH, setPanelH] = useState<number | null>(null)

  /** The copy on screen does not show a change found in the database; and when that was last found. */
  const [behind, setBehind] = useState(false)
  const behindSince = useRef(0)
  /** It is behind and holds typing, so only the person can end that: the moment for the `behind` banner. */
  const [stuck, setStuck] = useState(false)
  /** The copy on screen may have loaded nothing and a read has since worked: reload it. */
  const [recover, setRecover] = useState(false)
  /** The last read failed and nothing has vouched for the copy on screen: the moment for the `failed` banner. */
  const [cannotRead, setCannotRead] = useState(false)
  const [retrying, setRetrying] = useState(false)
  /** Bumped after every read, each time the sheet goes still, when a field is let go of and when a wait runs out: a moment to reload a sheet that is behind. */
  const [checks, setChecks] = useState(0)

  // About the copy on screen; reset whenever a new one is shown.
  /** When somebody last pressed, typed or scrolled in it; null if nobody has. */
  const touchedAt = useRef<number | null>(null)
  /** Presses on one of `writes` that no read has yet found a change after. */
  const presses = useRef<Array<SheetPress & { at: number }>>([])
  /** What its form held each time one of `writes` was pressed: what the save wrote, if it wrote. */
  const saves = useRef<string[]>([])
  /** What its form holds when nobody has typed in it: the row it loaded, or last saved. */
  const base = useRef<string | null>(null)
  /** A read has worked since it mounted; a read has failed since it mounted. */
  const vouched = useRef(false)
  const failedSinceShown = useRef(false)

  /** The last successful read, as JSON and as it came; null before the first. */
  const seen = useRef<string | null>(null)
  const seenData = useRef<{ data: T } | null>(null)
  /** How many reads have worked, and at which of them `check` last found a copy that loaded nothing. */
  const readsDone = useRef(0)
  const emptyAt = useRef(-1)
  const reading = useRef(false)
  const again = useRef(false)
  /** A read after a press was asked for while another read was in flight. */
  const settleAsked = useRef(false)
  const alive = useRef(true)
  const swapTimer = useRef<number | null>(null)

  const latest = useRef({ read, onRead, writes, explains, form, check })
  useEffect(() => {
    latest.current = { read, onRead, writes, explains, form, check }
    gensNow.current = gens
  })

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (swapTimer.current !== null) window.clearTimeout(swapTimer.current)
    }
  }, [])

  const touch = useCallback(() => {
    touchedAt.current = Date.now()
  }, [])

  // A field let go of may be what a waiting reload was waiting for.
  const recheck = useCallback(() => setChecks((n) => n + 1), [])

  // Clicks, so a keyboard's Enter or Space on Save counts too. Captured
  // before the sheet's own handler runs, so the form is read as it is saved.
  const press = useCallback((e: MouseEvent) => {
    const control = writeControl(e.target, latest.current.writes, frame.current)
    if (control === null) return
    const copy = shownCopy.current
    const snap = copy && latest.current.form ? latest.current.form.read(copy) : null
    if (snap !== null) saves.current = [...saves.current.slice(-4), snap]
    const entry = { label: control.label, row: rowTexts(control.el), typed: fieldValues(copy), at: Date.now() }
    presses.current = [...presses.current.filter((p) => usedWithin(p.at, PRESS_MS)), entry]
    // Timed from when the click has been dealt with: Remove asks first
    // (window.confirm), and nothing runs until that is answered.
    window.setTimeout(() => {
      entry.at = Date.now()
    }, 0)
  }, [])

  /**
   * What the copy on screen holds that a reload would take: 'typing' (a form
   * with something not saved in it, a field somebody has clicked into, or a
   * form that cannot be read, like Team's add form), 'form' (a form exactly
   * as loaded or saved) or 'nothing'.
   */
  const holds = useCallback((): 'typing' | 'form' | 'nothing' => {
    const copy = shownCopy.current
    if (!copy || !hasForm(copy)) return 'nothing'
    // Clicked into and not typed in yet: the next keystroke is theirs, and a
    // new copy would drop it on the floor (focus goes back to the page).
    const focus = document.activeElement
    if (focus && copy.contains(focus) && focus.matches(FIELDS)) return 'typing'
    const now = latest.current.form ? latest.current.form.read(copy) : null
    return now !== null && now === base.current ? 'form' : 'typing'
  }, [])

  /**
   * How long until the copy on screen can be swapped without taking anything
   * from anyone: 0 now, a wait in ms, or null while it holds typing, which
   * only the person can end. A copy that may have loaded nothing (`recovering`)
   * has no reading to protect, so it waits only QUIET_MS.
   */
  const freeIn = useCallback(
    (recovering: boolean): number | null => {
      const at = touchedAt.current
      if (at === null) return 0
      const held = holds()
      if (held === 'typing') return null
      return Math.max(0, at + (held === 'form' || recovering ? QUIET_MS : IDLE_MS) - Date.now())
    },
    [holds],
  )

  /** A new copy is on screen, loaded from about `from`: nobody has used it yet. */
  const freshCopy = useCallback((from: { data: T } | null) => {
    touchedAt.current = null
    presses.current = []
    saves.current = []
    const f = latest.current.form
    base.current = f && from ? f.of(from.data) : null
  }, [])

  const reloadQuietly = useCallback(
    (recovering: boolean) => {
      if (gensNow.current.loading !== null) return
      const gen = nextGen.current++
      const startedAt = Date.now()
      const from = seenData.current
      gensNow.current = { ...gensNow.current, loading: gen }
      setGens((g) => ({ ...g, loading: gen }))
      swapTimer.current = window.setTimeout(() => {
        swapTimer.current = null
        // Used or typed in while the new copy loaded: what they are doing wins.
        if (freeIn(recovering) !== 0) {
          setGens((g) => (g.loading === gen ? { ...g, loading: null } : g))
          return
        }
        setGens((g) => (g.loading === gen ? { shown: gen, loading: null } : g))
        freshCopy(from)
        // It loaded straight after a read that worked.
        vouched.current = true
        failedSinceShown.current = false
        setRecover(false)
        // A change found after the new copy started reading may not be in it:
        // still behind, and the next check reloads again.
        setBehind(behindSince.current > startedAt)
      }, SWAP_MS)
    },
    [freeIn, freshCopy],
  )

  /** A fresh copy now, on screen. The person asked, so what they typed goes. */
  const reloadNow = () => {
    if (swapTimer.current !== null) window.clearTimeout(swapTimer.current)
    swapTimer.current = null
    setGens({ shown: nextGen.current++, loading: null })
    freshCopy(seenData.current)
    setBehind(false)
    setRecover(false)
  }

  const readNow = useCallback(
    async (afterPress = false) => {
      if (afterPress) settleAsked.current = true
      if (reading.current) {
        again.current = true
        return
      }
      reading.current = true
      try {
        do {
          again.current = false
          const settle = settleAsked.current
          settleAsked.current = false
          let data: T
          try {
            data = await latest.current.read()
          } catch {
            if (!alive.current) return
            // Offline, or a blip. A copy that has loaded keeps what it shows
            // and the next read tries again; one nothing has vouched for
            // most likely loaded nothing either, so the page says so.
            failedSinceShown.current = true
            setCannotRead(!vouched.current)
            break
          }
          if (!alive.current) return
          const { form: f, explains: explain, check: drawn, onRead: tell } = latest.current
          tell?.(data)
          setCannotRead(false)
          readsDone.current++
          const copy = shownCopy.current
          const onScreen = f && copy ? f.read(copy) : null
          // Reads were failing when the copy on screen loaded: unless its form
          // shows exactly this, it has nothing, or something old.
          if (!vouched.current && failedSinceShown.current && !(f && onScreen === f.of(data))) setRecover(true)
          vouched.current = true
          // What the sheet itself shows, against this read, change or not.
          const sheetSays = copy && drawn && !loadingNow(copy) ? drawn(copy, data) : null
          if (sheetSays === 'empty') {
            emptyAt.current = readsDone.current
            setRecover(true)
          } else if (sheetSays === 'behind') {
            behindSince.current = Date.now()
            setBehind(true)
          }

          const print = JSON.stringify(data)
          const last = seen.current
          const before = seenData.current
          seen.current = print
          seenData.current = { data }
          if (last === null) {
            if (f && base.current === null) base.current = f.of(data)
            continue
          }
          if (last === print) continue

          // A change. Whose, and is it on screen?
          const pressed = presses.current.filter((p) => usedWithin(p.at, PRESS_MS))
          presses.current = []
          if (f && onScreen !== null) {
            const want = f.of(data)
            const shows = onScreen === want || saves.current.includes(want)
            if (shows) base.current = want
            else behindSince.current = Date.now()
            setBehind(!shows)
          } else {
            const theirs = settle && pressed.length > 0 && (!explain || !before || explain(before.data, data, pressed, copy))
            // Never clears `behind`: a change of theirs says nothing about an
            // earlier one from elsewhere that the copy on screen still lacks.
            if (!theirs) {
              behindSince.current = Date.now()
              setBehind(true)
            }
          }
        } while (again.current)
      } finally {
        reading.current = false
        if (alive.current) {
          setChecks((n) => n + 1)
          setRetrying(false)
        }
      }
    },
    [],
  )

  /** The `failed` banner's button: a fresh copy reads again, and so does the page. */
  const tryAgain = () => {
    reloadNow()
    vouched.current = false
    failedSinceShown.current = false
    setRetrying(true)
    void readNow()
  }

  useEffect(() => {
    void readNow()
  }, [readNow])

  useFresh(() => void readNow())

  // A sheet that is behind, or may have loaded nothing, is reloaded as soon
  // as that takes nothing from anyone: checked when it falls behind, after
  // every read, each time the sheet goes still (its add form closing, say),
  // when a field is let go of, and when the wait for it to be left alone
  // runs out.
  useEffect(() => {
    if (gens.loading !== null || (!behind && !recover)) {
      setStuck(false)
      return
    }
    const wait = freeIn(recover)
    setStuck(wait === null)
    if (wait === null) return
    if (wait === 0) {
      reloadQuietly(recover)
      return
    }
    const timer = window.setTimeout(() => setChecks((n) => n + 1), wait + 50)
    return () => window.clearTimeout(timer)
  }, [behind, recover, gens.loading, checks, freeIn, reloadQuietly])

  // Read again once the sheet goes still after a press on one of `writes`:
  // a save, an add or a removal always ends in a redraw (a message, a
  // reloaded list). Anything else that redraws it (a form opening, the copy
  // loading out of sight) needs no read, only a check; and if that redraw
  // was the copy on screen finishing its own read with nothing to show
  // (its read failed, the page's had worked), it is reloaded, once for the
  // page's last read: the next try waits for the page's next read.
  useEffect(() => {
    const el = frame.current
    if (!el || typeof MutationObserver === 'undefined') return
    let timer: number | undefined
    const watch = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (presses.current.some((p) => usedWithin(p.at, PRESS_MS))) {
          void readNow(true)
          return
        }
        const copy = shownCopy.current
        const last = seenData.current
        const drawn = latest.current.check
        if (copy && last && drawn && emptyAt.current !== readsDone.current && !loadingNow(copy) && drawn(copy, last.data) === 'empty') {
          emptyAt.current = readsDone.current
          setRecover(true)
        }
        setChecks((n) => n + 1)
      }, SETTLE_MS)
    })
    watch.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      watch.disconnect()
      window.clearTimeout(timer)
    }
  }, [readNow])

  const showBehind = !!behindBanner && behind && stuck && gens.loading === null

  // The room from the column's top edge to the window's bottom. Measured
  // after every render, because what sits above it (the page's header line,
  // a banner) changes height; setting the same number again is a no-op.
  const fit = useCallback(() => {
    const el = frame.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    setAvail(Math.max(MIN_VISIBLE, Math.floor(window.innerHeight - top - BOTTOM_GAP)))
  }, [])
  useLayoutEffect(fit)
  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit])

  // The panel: the sheet's fixed backdrop's first child, sitting on its
  // bottom edge. Checked rather than assumed; if the sheet is ever drawn
  // another way the column shows the whole host instead of cutting blind.
  useLayoutEffect(() => {
    const backdrop = shownCopy.current?.firstElementChild as HTMLElement | null | undefined
    const panel = backdrop?.firstElementChild as HTMLElement | null | undefined
    if (!backdrop || !panel || typeof ResizeObserver === 'undefined' || getComputedStyle(backdrop).position !== 'fixed') {
      setPanelH(null)
      return
    }
    const measure = () => {
      const b = backdrop.getBoundingClientRect()
      const p = panel.getBoundingClientRect()
      setPanelH(Math.abs(b.bottom - p.bottom) <= 1 ? Math.ceil(p.height) : null)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(panel)
    watch.observe(backdrop)
    return () => watch.disconnect()
  }, [gens.shown])

  const fitted = panelH !== null
  // Tall enough that the panel's 92% can use all the room there is, and no taller.
  const hostH = fitted ? Math.floor(avail / SHEET_SHARE) : avail
  const visibleH = fitted ? Math.min(panelH, avail) : avail

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, width: COLUMN_W, maxWidth: '100%' }}>
      {cannotRead && (
        <Banner
          tone="error"
          title={failed}
          action={
            <Button size="sm" loading={retrying} onClick={tryAgain}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </Banner>
      )}
      {showBehind && behindBanner && (
        <Banner tone="warn" title={behindBanner.title} action={<Button size="sm" onClick={reloadNow}>{behindBanner.action}</Button>}>
          {behindBanner.body}
        </Banner>
      )}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, marginBottom: space.xs, ...text.sm, fontWeight: 600, color: color.body }}>
          <PhoneIcon />
          Same screen as the {WEB_BRAND} app
        </div>
        <div
          ref={frame}
          data-sheet-column=""
          onPointerDownCapture={touch}
          onKeyDownCapture={touch}
          onWheelCapture={touch}
          onInputCapture={touch}
          onClickCapture={press}
          onBlurCapture={recheck}
          style={{
            position: 'relative',
            // The height is the panel's; the border goes outside it.
            boxSizing: 'content-box',
            height: visibleH,
            overflow: CUT,
            background: color.appBg,
            border: `1px solid ${color.border}`,
            // One more than the panel's own radii, so the curves meet inside the border.
            borderRadius: fitted
              ? `${SHEET_RADIUS + 1}px ${SHEET_RADIUS + 1}px ${radius.lg + 1}px ${radius.lg + 1}px`
              : radius.lg + 1,
            boxShadow: shadow.card,
          }}
        >
          <Contained
            label={label}
            height={hostH}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, border: 0, borderRadius: 0, background: 'transparent' }}
          >
            {[gens.shown, gens.loading].map((gen) =>
              gen === null ? null : (
                // display:contents, so the sheet is laid out as the host's own
                // child while this element marks one copy. The copy loading
                // out of sight is display:none: mounted, so it reads, but not
                // drawn and out of the accessibility tree.
                <div
                  key={gen}
                  ref={gen === gens.shown ? shownCopy : undefined}
                  data-sheet-gen={gen}
                  style={{ display: gen === gens.shown ? 'contents' : 'none' }}
                >
                  {children}
                </div>
              ),
            )}
          </Contained>
        </div>
      </div>
    </div>
  )
}

/** Somebody used the sheet less than `ms` ago. */
const usedWithin = (at: number | null, ms: number) => at !== null && Date.now() - at < ms

/** The sheets' form fields. */
const FIELDS = 'input, textarea, select'

/** A form is open in the sheet: the phone's sheets have form fields only in their own forms. Read, never changed. */
const hasForm = (el: HTMLElement | null) => !!el?.querySelector(FIELDS)

/** What each field in the sheet holds, in order. */
const fieldValues = (el: HTMLElement | null) =>
  el ? [...el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(FIELDS)].map((f) => f.value) : []

/** The copy is still reading its rows: both phone sheets say exactly this, alone in an element, until they have. */
const loadingNow = (el: HTMLElement) => [...el.querySelectorAll('span')].some((s) => s.childElementCount === 0 && s.textContent === 'Loading…')

/**
 * The control pressed, if it is one of `writes`, with its label: the element
 * clicked or one of its nearest parents (the sheet's controls hold their
 * text directly, or around an icon). Stops at the column.
 */
function writeControl(target: EventTarget, writes: readonly string[], stop: Element | null): { label: string; el: Element } | null {
  let el = target instanceof Element ? target : null
  for (let i = 0; el && el !== stop && i < 4; i++, el = el.parentElement) {
    const t = el.textContent?.trim() ?? ''
    if (writes.includes(t)) return { label: t, el }
  }
  return null
}

/**
 * The text of each innermost element in the control's row (its parent),
 * the control's own excepted. For the crew sheet's Remove, the row is the
 * person's: their initials, name and trade line.
 */
function rowTexts(control: Element): string[] {
  const row = control.parentElement
  if (!row) return []
  const out: string[] = []
  for (const el of row.querySelectorAll('*')) {
    if (el.childElementCount > 0 || control.contains(el)) continue
    const t = el.textContent?.trim()
    if (t) out.push(t)
  }
  return out
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="3.5" y="1" width="7" height="12" rx="1.6" fill="none" stroke={color.muted} strokeWidth="1.3" />
      <path d="M6.2 10.8h1.6" stroke={color.muted} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
