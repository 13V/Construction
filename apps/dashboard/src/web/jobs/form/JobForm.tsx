/**
 * New job and Edit job: one page, a form column on the left and the map on
 * the right, with Cancel and Create job (or Save changes) in a footer that
 * is always on screen.
 *
 * The form is everything the crew's phones show about a job, in the order
 * somebody setting one up thinks of it: the job (name, what the work is,
 * colour), the builder and their people, the builder's contract (owners
 * only: the value, ex or inc GST, the contract and order numbers, retention
 * and payment terms), where it is, when it runs and who runs it. The card at
 * the top is the job as the phone's Projects list will show it, redrawn as
 * it is typed. The map is the fence: nothing saves a new job until a pin has
 * been put down on purpose (FenceEditor). Opened at /jobs/:id/edit#contract
 * (the Project card's Change), the page starts at the contract.
 *
 * Keys: Cmd+Enter (Ctrl+Enter) saves from anywhere on the page. Esc leaves,
 * and with anything unsaved asks first; so does any link out of the page
 * (the rail, Cancel), the browser's Back and closing the tab. Enter in the
 * address box searches the map, because that is what somebody pressing
 * Enter there means.
 *
 * Two saves ask first, because each is what a fence left in the wrong place
 * looks like: a pin within 100 m of where the map opens (nobody placed it),
 * and, editing, a new address with the pin left where it was (the address
 * was searched, but no result was picked). Clock-on goes by the fence, never
 * the address.
 *
 * useJobForm.ts decides what is saved and how; this file draws it and asks.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { FenceEditor, useOtherFences } from '../../map/FenceEditor'
import { formatPoint } from '../../map/fenceGeometry'
import { useAddressSearch } from '../../map/geocode'
import { addressLine, builderOf, JOB_COLOURS, railOf, type WorkerRow } from '../../phone'
import { navigate, paths } from '../../router'
import { PageHeader } from '../../shell/PageHeader'
import { useToast } from '../../shell/Toast'
import { color, radius, shadow, size, space, text, z } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { TextArea } from '../../ui/TextArea'
import { BuilderField } from './BuilderField'
import { ColourField } from './ColourField'
import { ContactsFields } from './ContactsFields'
import { PhonePreview } from './PhonePreview'
import { useJobForm, type Check, type EditSource, type FieldKey } from './useJobForm'
import { WhenFields } from './WhenFields'

export interface JobFormProps {
  me: WorkerRow
  /** The job being edited, as loaded; null for a new job. */
  source: EditSource | null
}

/**
 * The narrowest window with the form beside the map. Below it the map next
 * to a 480 px column is under about 400 px wide: the search hits cover all
 * of it and its credit wraps. So up to here the map goes under the form, at
 * the page's full width, and a search scrolls it into view.
 */
const SIDE_BY_SIDE = 1200

/**
 * Narrower than this, the contract value's box and its ex or inc GST choice
 * go one above the other: side by side, the box is too narrow for its label.
 */
const VALUE_BESIDE_GST = 460

/** The phone's own placeholder for what the work is (Projects.tsx NewProjectSheet). */
const WORK_PLACEHOLDER = 'e.g. Bathrooms and ensuites, tiling + waterproofing'

/** True while the window is narrower than `px`. */
function useNarrower(px: number): boolean {
  const query = `(max-width: ${px - 1}px)`
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

/** Where each field is on the page, for taking somebody to the first thing to fix. */
const FIELD_SELECTOR: Partial<Record<FieldKey, string>> = {
  name: '[name="name"]',
  workType: '[name="workType"]',
  builder: '[name="builder"]',
  contractValue: '[name="contractValue"]',
  contractNo: '[name="contractNo"]',
  orderNo: '[name="orderNo"]',
  retentionPct: '[name="retentionPct"]',
  paymentTermsDays: '[name="paymentTermsDays"]',
  address: '[name="address"]',
  fence: '[data-fence-address]',
  startsOn: '[name="startsOn"]',
  endsOn: '[name="endsOn"]',
  captain: '[name="captain"]',
  crew: '[data-crew-picker]',
  colour: '[data-colour-field]',
  'contact.project_manager': '[name="project_manager.name"]',
  'contact.supervisor': '[name="supervisor.name"]',
  'contact.contract_admin': '[name="contract_admin.name"]',
}

/** Two boxes side by side, one above the other when the column is narrow. */
const PAIR = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: space.sm, alignItems: 'start' } as const

/** `steps`: the question came from the browser's Back, and Leave goes that many entries back. */
type Asking = { kind: Check; sure: Check[] } | { kind: 'leave'; to: string; steps?: number }

/** The history entry the page keeps on top while anything is unsaved (see "Back" below). */
type Spare = { token: string; href: string }
const spareToken = (state: unknown): string | null =>
  state && typeof state === 'object' && typeof (state as { wbFormSpare?: unknown }).wbFormSpare === 'string' ? (state as { wbFormSpare: string }).wbFormSpare : null

export function JobForm({ me, source }: JobFormProps) {
  const f = useJobForm({ me, source })
  const { values, set, site, mode } = f
  const search = useAddressSearch()
  const others = useOtherFences(site?.id ?? null)
  const toast = useToast()
  const stacked = useNarrower(SIDE_BY_SIDE)
  const gstUnder = useNarrower(VALUE_BESIDE_GST)
  const column = useRef<HTMLDivElement>(null)
  const mapBox = useRef<HTMLDivElement>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  /** Set once a save has landed and the page is on its way out, so nothing asks "leave without saving?". */
  const done = useRef(false)

  const back = site ? paths.job(site.id) : paths.jobs
  const rail = values.colour ?? (site ? railOf(site) : JOB_COLOURS[0]!)
  const stored = f.stored

  // ---------------------------------------------------------------- leaving

  const unsaved = f.dirty && !done.current
  /** The same, for listeners that live as long as the page. */
  const unsavedNow = useRef(unsaved)
  useEffect(() => {
    unsavedNow.current = unsaved
  })

  // Back (the browser's button, a trackpad swipe, Alt+Left or Cmd+[) asks
  // too. A Back cannot be cancelled, so while anything is unsaved the page
  // keeps a spare history entry on top of its own, at the same address. Back
  // then lands on the page's own entry: the address is unchanged, so the
  // router leaves the page (and what was typed) alone, the spare goes back on
  // top and the question is asked. Leave goes back past both; Keep editing
  // has nothing to undo. Every other way out (Save, Cancel, a link, Esc)
  // replaces the spare instead of adding after it, so history ends up as it
  // would have without it.
  const spare = useRef<Spare | null>(null)
  const arm = useCallback((href: string = window.location.href) => {
    const token = Math.random().toString(36).slice(2)
    window.history.pushState({ wbFormSpare: token }, '', href)
    spare.current = { token, href }
  }, [])
  useEffect(() => {
    if (unsaved && !spare.current) arm()
  }, [unsaved, arm])

  /** Out of the page, within the website: over the spare entry when history is on it. */
  const go = useCallback((to: string) => {
    const onSpare = !!spare.current && spareToken(window.history.state) === spare.current.token
    navigate(to, { replace: onSpare })
    // navigate() keeps the scroll on a replace, which is for redirects; this is a new page.
    if (onSpare) window.scrollTo(0, 0)
  }, [])

  /** Set while Leave is going back: what to do if there was nothing to go back to. */
  const fallback = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(fallback.current), [])
  /** Leave the way the person was going when they pressed Back. */
  const goBack = useCallback(
    (steps: number) => {
      window.history.go(-steps)
      // Opened in a tab of its own, the page has nothing before it, and go() does nothing:
      // go where Cancel goes instead. Going back unmounts the page (or unloads it), which stops this.
      fallback.current = window.setTimeout(() => navigate(back, { replace: true }), 1000)
    },
    [back],
  )

  useEffect(() => {
    const onPop = () => {
      const was = spare.current
      if (!was || done.current) return
      if (spareToken(window.history.state) === was.token) return // Forward, back onto the spare
      spare.current = null
      const ownEntry = window.location.href === was.href
      if (!unsavedNow.current) {
        // Nothing to lose. On the page's own entry, the Back has not gone anywhere yet: carry it on.
        if (ownEntry) window.history.back()
        return
      }
      if (ownEntry) {
        arm()
        setAsking({ kind: 'leave', to: back, steps: 2 })
      } else {
        // Several entries back at once (the Back button's list): bring the page's address back, then ask.
        arm(was.href)
        setAsking({ kind: 'leave', to: back, steps: 1 })
      }
    }
    // Capturing, so this runs before the router's own listener: by the time it reads the address, the page's is back.
    window.addEventListener('popstate', onPop, true)
    return () => window.removeEventListener('popstate', onPop, true)
  }, [arm, back])

  const leave = useCallback(
    (to: string) => {
      if (f.dirty && !done.current) setAsking({ kind: 'leave', to })
      else go(to)
    },
    [f.dirty, go],
  )

  // Any link out of the page while something is unsaved asks first: the
  // rail, Cancel, the Crew tab link. Caught before the router's own click
  // handler, so the page stays put until the answer. With nothing unsaved
  // but the spare entry still on top, the link replaces it (go).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!unsavedNow.current && !spare.current) return
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      e.preventDefault()
      e.stopPropagation()
      const to = url.pathname + url.search + url.hash
      if (unsavedNow.current) setAsking({ kind: 'leave', to })
      else go(to)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [go])

  // Closing the tab or reloading: the browser's own question. Not once Leave
  // was pressed (the crew app is another page load), or a save has landed.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      // Leave going back to another site: it is leaving, so the fallback must not run.
      window.clearTimeout(fallback.current)
      if (done.current || !unsavedNow.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  // ---------------------------------------------------------------- saving

  /** Take somebody to the first field that needs fixing. */
  const showFirst = useCallback((keys: FieldKey[]) => {
    const order = Object.keys(FIELD_SELECTOR) as FieldKey[]
    const first = order.find((k) => keys.includes(k))
    const el = first ? document.querySelector<HTMLElement>(FIELD_SELECTOR[first]!) : null
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (el.matches('input, textarea, select')) el.focus({ preventScroll: true })
  }, [])

  // Opened from the Project card's contract (…/edit#contract): start at the contract.
  useEffect(() => {
    if (window.location.hash !== '#contract') return
    const section = document.getElementById('contract')
    section?.scrollIntoView({ block: 'start' })
    section?.querySelector<HTMLInputElement>('input[name="contractValue"]')?.focus({ preventScroll: true })
  }, [])

  const submit = useCallback(
    async (sure: Check[] = []) => {
      if (f.saving) return
      if (f.blocker && mode === 'edit') return
      // A new job missing its name or fence: say which, rather than nothing.
      const errs = f.validate()
      const keys = Object.keys(errs) as FieldKey[]
      if (keys.length) {
        showFirst(keys)
        return
      }
      if (f.blocker) return
      const due = f.checksDue().filter((c) => !sure.includes(c))
      if (due.length) {
        setAsking({ kind: due[0]!, sure })
        return
      }
      setAsking(null)
      const out = await f.save()
      if (!out) {
        column.current?.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      done.current = true
      toast(out.message, { tone: out.tone === 'success' ? 'success' : 'neutral' })
      go(paths.job(out.siteId))
    },
    [f, mode, showFirst, toast, go],
  )

  // Cmd+Enter saves from anywhere on the page; Esc leaves (asking first if
  // anything is unsaved). A dialog, or a list open in a field, has Esc first:
  // they mark the key handled, and it stops there.
  const keys = useRef({ submit, leave, back, asking, search })
  useEffect(() => {
    keys.current = { submit, leave, back, asking, search }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      if (k.asking || e.defaultPrevented) return
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void k.submit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // The search results on the map close first.
        if (k.search.hits) k.search.dismiss()
        else k.leave(k.back)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const runSearch = () => {
    search.search(values.address)
    // Stacked, the map is under the form: bring it up to show the results.
    if (stacked) mapBox.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  // ---------------------------------------------------------------- drawing

  const title = mode === 'create' ? 'New job' : 'Edit job'
  const subtitle =
    mode === 'create'
      ? 'Everything the crew’s phones show about the job, set in one place.'
      : [site ? addressLine(site) || site.name : null, site && addressLine(site) ? site.name : null, site ? builderOf(site) || null : null].filter(Boolean).join(' · ')

  const hint = f.saving
    ? mode === 'create'
      ? 'Creating the job…'
      : 'Saving…'
    : (f.blocker ??
      (mode === 'create' ? 'Crew phones show it the next time the app is opened.' : f.pinLeftBehind ? 'The address has changed, but the fence has not moved.' : 'Unsaved changes.'))

  return (
    <div
      data-job-form={mode}
      data-layout={stacked ? 'stacked' : 'side'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        // Side by side, the page is the window: the form scrolls in its column and the map fills the rest.
        height: stacked ? undefined : '100vh',
        minHeight: stacked ? undefined : 640,
        padding: `0 clamp(16px, 4vw, ${size.gutter}px)`,
        boxSizing: 'border-box',
      }}
    >
      <PageHeader title={title} subtitle={subtitle} />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: stacked ? 'minmax(0, 1fr)' : `${size.form}px minmax(0, 1fr)`,
          // One row the height the window leaves, so the column scrolls inside it rather than the page.
          gridTemplateRows: stacked ? undefined : 'minmax(0, 1fr)',
          gap: stacked ? space.md : space.lg,
        }}
      >
        <div
          ref={column}
          data-form-column=""
          style={{
            // Positioned, so what is absolutely placed inside (a screen-reader-only label, a list
            // open under a field) is placed and clipped in here, not against the page, which would scroll.
            position: 'relative',
            minHeight: 0,
            minWidth: 0,
            overflowY: stacked ? 'visible' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: space.md,
            // Room for the focus halo and the scrollbar, without the cards touching it.
            padding: stacked ? `0 0 ${space.md}px` : `2px 10px ${space.lg}px 2px`,
            margin: stacked ? 0 : '-2px -10px 0 -2px',
          }}
        >
          <PhonePreview
            mode={mode}
            name={values.name}
            address={values.address}
            // As saved: a name on the list keeps the spelling it has there (ResolvedBuilder.name).
            builder={f.resolved.name}
            rail={rail}
            status={mode === 'create' ? values.status : (site?.status ?? 'starting_soon')}
            scheduleNote={site?.schedule_note ?? null}
            startsOn={values.startsOn}
            endsOn={values.endsOn}
            people={mode === 'create' ? (values.bookCrew ? values.crew.workerIds.length : 0) : null}
          />

          {f.saveError && (
            <Banner tone="error" title={mode === 'create' ? 'The job was not created' : 'The changes were not saved'} onDismiss={f.clearSaveError}>
              {f.saveError}
            </Banner>
          )}
          {f.loadError && (
            <Banner
              tone="warn"
              title="Part of the form could not be loaded"
              action={
                <Button size="sm" onClick={f.retryLoad}>
                  Try again
                </Button>
              }
            >
              The builder list, the colours other jobs use or the captains may be missing. {f.loadError}
            </Banner>
          )}

          <Section title="The job">
            <Field
              label="Project name"
              name="name"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Maple Ridge"
              autoFocus={mode === 'create'}
              autoComplete="off"
              required
              error={f.errors.name}
              hint="The crew’s phones list a job by its address, and by this name when it has none."
            />
            <Field
              label="What the work is"
              name="workType"
              optional
              value={values.workType}
              onChange={(e) => set('workType', e.target.value)}
              placeholder={WORK_PLACEHOLDER}
              autoComplete="off"
              error={f.errors.workType}
              hint="Heads the job on the schedule, and is the job description on every SWMS."
            />
            <ColourField value={values.colour} onChange={f.pickColour} automatic={site && !site.colour ? railOf({ id: site.id }) : null} counts={f.counts} error={f.errors.colour} />
          </Section>

          <Section title="Builder">
            <BuilderField
              mode={mode}
              value={values.builder}
              onChange={(t) => set('builder', t)}
              onPick={f.setPicked}
              suggestions={f.suggestions}
              resolved={f.resolved}
              changed={f.builderChanged}
              switched={f.builderSwitched}
              hadSupervisor={!!site?.supervisor_contact_id}
              drift={f.source?.drift ?? null}
              candidates={f.candidates}
              linkOthers={values.linkOthers}
              onLinkOthers={(v) => set('linkOthers', v)}
              loadError={f.loadError}
              error={f.errors.builder}
            />
            <ContactsFields
              mode={mode}
              builderName={f.resolved.name}
              values={values.contacts}
              onChange={f.setContact}
              onFile={f.onFile}
              supervisors={f.supervisors}
              fallbackSupervisor={
                f.source && f.resolved.original && !site?.supervisor_contact_id ? (f.source.allContacts.find((c) => c.role === 'supervisor') ?? null) : null
              }
              errors={f.errors}
              loadError={f.peopleError}
            />
          </Section>

          <Section title="Contract" id="contract" intro="The builder’s contract for this job. Only owners see it: here, on the job page and on the phone’s Money tab.">
            <div
              data-contract-value=""
              style={{ display: 'flex', flexDirection: gstUnder ? 'column' : 'row', alignItems: gstUnder ? 'stretch' : 'flex-start', gap: space.sm }}
            >
              <Field
                label="Contract value"
                name="contractValue"
                optional
                inputMode="decimal"
                value={values.contractValue}
                onChange={(e) => set('contractValue', e.target.value)}
                placeholder="e.g. 48,500"
                autoComplete="off"
                error={f.errors.contractValue}
                hint="What the job is worth. The Money tab measures the margin against it."
                style={{ flex: 1, minWidth: 0 }}
              />
              {/* Beside the box, level with it (under its label); under the hint when narrow. */}
              <div style={{ flex: 'none', paddingTop: gstUnder ? 0 : 23 }}>
                <Segmented
                  label="Whether the contract value includes GST"
                  value={values.contractGstInclusive ? 'inc' : 'ex'}
                  onChange={(v) => set('contractGstInclusive', v === 'inc')}
                  block={gstUnder}
                  options={[
                    { value: 'ex', label: 'ex GST' },
                    { value: 'inc', label: 'inc GST' },
                  ]}
                />
              </div>
            </div>
            <div data-contract-refs="" style={PAIR}>
              <Field
                label="Contract number"
                name="contractNo"
                optional
                value={values.contractNo}
                onChange={(e) => set('contractNo', e.target.value)}
                placeholder="e.g. C-2291"
                autoComplete="off"
                error={f.errors.contractNo}
                hint="The builder’s number for the contract."
              />
              <Field
                label="Order number"
                name="orderNo"
                optional
                value={values.orderNo}
                onChange={(e) => set('orderNo', e.target.value)}
                placeholder="e.g. PO 88401"
                autoComplete="off"
                error={f.errors.orderNo}
                hint="Their purchase order, if they sent one."
              />
            </div>
            <div data-contract-terms="" style={PAIR}>
              <Field
                label="Retention"
                name="retentionPct"
                optional
                inputMode="decimal"
                value={values.retentionPct}
                onChange={(e) => set('retentionPct', e.target.value)}
                placeholder="e.g. 5%"
                autoComplete="off"
                error={f.errors.retentionPct}
                hint="Kept from each claim until the job is done. Blank is none."
              />
              <Field
                label="Payment terms"
                name="paymentTermsDays"
                optional
                inputMode="numeric"
                value={values.paymentTermsDays}
                onChange={(e) => set('paymentTermsDays', e.target.value)}
                placeholder="e.g. 30 days"
                autoComplete="off"
                error={f.errors.paymentTermsDays}
                hint="Days from the invoice date until it is due. Blank is 30."
              />
            </div>
          </Section>

          <Section title="Site">
            <TextArea
              label="Site address"
              name="address"
              data-fence-address=""
              optional
              rows={2}
              value={values.address}
              onChange={(e) => set('address', e.target.value)}
              onKeyDown={(e) => {
                // Enter finds the address on the map; Shift+Enter is a new line; Cmd+Enter saves (the page's).
                if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
                e.preventDefault()
                runSearch()
              }}
              placeholder="e.g. 14 Mitton Ave, Glenelg North SA 5045"
              autoComplete="off"
              error={f.errors.address}
              hint="Street, suburb SA postcode. Enter or Search finds it on the map; pick the right result to put the fence there."
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <Button data-fence-search="" loading={search.busy} onClick={runSearch}>
                Search
              </Button>
              {search.note && <span style={{ ...text.sm, color: color.amber }}>{search.note}</span>}
            </div>
            <FenceSummary
              mode={mode}
              fence={values.fence}
              stored={stored}
              pinMoved={f.pinMoved}
              radiusChanged={f.radiusChanged}
              pinLeftBehind={f.pinLeftBehind}
              error={f.errors.fence}
              othersError={others.error}
              onPutBack={stored ? () => set('fence', stored) : null}
            />
          </Section>

          <Section title="When and who">
            <WhenFields
              mode={mode}
              siteId={site?.id ?? null}
              startsOn={values.startsOn}
              endsOn={values.endsOn}
              onStartsOn={(v) => set('startsOn', v)}
              onEndsOn={(v) => set('endsOn', v)}
              status={values.status}
              onStatus={(v) => set('status', v)}
              currentStatus={site?.status ?? null}
              captainId={values.captainId}
              onCaptain={(v) => set('captainId', v)}
              captains={f.captains}
              crewLoading={f.loading}
              bookCrew={values.bookCrew}
              onBookCrew={(v) => set('bookCrew', v)}
              crew={values.crew}
              onCrew={f.setCrew}
              colour={rail}
              errors={f.errors}
            />
          </Section>
        </div>

        {/* The editor stays the grid's second child in both layouts, so a resize never restarts the map. */}
        <div ref={mapBox} style={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', scrollMarginTop: space.md }}>
          <FenceEditor
            value={values.fence}
            onChange={(v) => set('fence', v)}
            colour={rail}
            others={others.fences}
            search={search}
            style={stacked ? { height: 560 } : { flex: 1, minHeight: 0 }}
          />
        </div>
      </div>

      <footer
        data-form-footer=""
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: z.sticky,
          display: 'flex',
          alignItems: 'center',
          gap: space.sm,
          minHeight: size.header,
          marginTop: space.md,
          padding: `${space.sm}px 0`,
          boxSizing: 'border-box',
          background: color.appBg,
          borderTop: `1px solid ${color.border}`,
        }}
      >
        <span data-form-hint="" aria-live="polite" style={{ flex: 1, minWidth: 0, ...text.sm, color: f.pinLeftBehind && !f.blocker ? color.amber : color.muted }}>
          {hint}
        </span>
        <Button variant="secondary" href={back} data-cancel="">
          Cancel
        </Button>
        <Button
          variant="primary"
          data-submit=""
          disabled={!!f.blocker}
          loading={f.saving}
          onClick={() => void submit()}
          title={`${mode === 'create' ? 'Create job' : 'Save changes'} (Cmd+Enter)`}
          aria-keyshortcuts="Meta+Enter Control+Enter"
        >
          {mode === 'create' ? 'Create job' : 'Save changes'}
        </Button>
      </footer>

      {/* A radius changed with the address is still a fence at the old site, so
          the question is the same; it only names what else is saved. */}
      <Dialog
        open={asking?.kind === 'address'}
        title={f.radiusChanged ? 'Save the new address without moving the pin?' : 'Save the new address without moving the fence?'}
        confirmLabel={f.radiusChanged ? 'Save address and radius' : 'Save address only'}
        cancelLabel="Keep editing"
        onConfirm={() => void submit([...(asking?.kind === 'address' ? asking.sure : []), 'address'])}
        onCancel={() => setAsking(null)}
      >
        {stored && (
          <>
            {f.radiusChanged ? (
              <>
                The pin stays where it is, at {formatPoint(stored)}
                {site?.address ? `, ${site.address}` : ''}; only the radius changes, from {stored.radiusM} m to {values.fence?.radiusM} m.
              </>
            ) : (
              <>
                The fence stays where it is: {stored.radiusM} m at {formatPoint(stored)}
                {site?.address ? `, ${site.address}` : ''}.
              </>
            )}{' '}
          </>
        )}
        Crew clock on by the fence, not the address, so if the job has moved, nobody can clock on at the new site. To move the fence, pick the right search
        result or click the map.
      </Dialog>

      <Dialog
        open={asking?.kind === 'cbd'}
        title="Is the job really in the middle of Adelaide?"
        confirmLabel={mode === 'create' ? 'Create it here' : 'Save it here'}
        onConfirm={() => void submit([...(asking?.kind === 'cbd' ? asking.sure : []), 'cbd'])}
        onCancel={() => setAsking(null)}
      >
        The pin is within 100 m of where the map opens, in Adelaide’s CBD. A fence left there by mistake means nobody can clock on at the real site.
      </Dialog>

      <Dialog
        open={asking?.kind === 'leave'}
        title={mode === 'create' ? 'Leave without creating the job?' : 'Leave without saving?'}
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          const a = asking?.kind === 'leave' ? asking : { to: back, steps: undefined }
          done.current = true
          setAsking(null)
          if (a.steps) goBack(a.steps)
          else go(a.to)
        }}
        onCancel={() => setAsking(null)}
      >
        {mode === 'create'
          ? 'Nothing has been saved yet: the job is only made when you press Create job.'
          : 'What you changed here is lost. The job stays as it was saved.'}
      </Dialog>
    </div>
  )
}

/**
 * A white card, titled. The fields inside carry the phone's tracked-caps
 * labels, so the card's title is a plain heading above them. `intro` is a
 * line under the title about the whole card; `id` is where a link can open
 * the page at (…#contract).
 */
function Section({ title, id, intro, children }: { title: string; id?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section
      id={id}
      data-section={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: space.md,
        padding: `${space.md}px ${space.md}px ${space.lg}px`,
        background: color.panel,
        border: `1px solid ${color.borderSoft}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        // Opened at its id, it sits just below the column's top, not flush against it.
        scrollMarginTop: space.xs,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.xxs }}>
        <h2 style={{ margin: 0, ...text.md, fontWeight: 600, letterSpacing: '-.01em', color: color.ink }}>{title}</h2>
        {intro && <p style={{ margin: 0, ...text.sm, color: color.muted }}>{intro}</p>}
      </div>
      {children}
    </section>
  )
}

/** Where the fence is, in words under the address: placed or not, saved or moved, and how to undo a move. */
function FenceSummary({
  mode,
  fence,
  stored,
  pinMoved,
  radiusChanged,
  pinLeftBehind,
  error,
  othersError,
  onPutBack,
}: {
  mode: 'create' | 'edit'
  fence: { lat: number; lng: number; radiusM: number } | null
  stored: { lat: number; lng: number; radiusM: number } | null
  pinMoved: boolean
  radiusChanged: boolean
  pinLeftBehind: boolean
  error?: string
  othersError: string | null
  onPutBack: (() => void) | null
}) {
  const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums' } as const
  return (
    <div data-fence-summary="" style={{ display: 'flex', flexDirection: 'column', gap: space.xxs, ...text.sm, color: color.body }}>
      {mode === 'create' ? (
        fence ? (
          <div>
            <span style={{ color: color.green, fontWeight: 600 }}>Fence placed: </span>
            {fence.radiusM} m at <span style={mono}>{formatPoint(fence)}</span>
          </div>
        ) : (
          <div style={{ color: error ? color.red : color.muted }} role={error ? 'alert' : undefined}>
            {error ?? 'No fence yet. Search the address and pick the right result, or click the map where the job is.'}
          </div>
        )
      ) : (
        stored && (
          <>
            <div>
              <span style={{ color: color.muted }}>Saved fence: </span>
              {stored.radiusM} m at <span style={mono}>{formatPoint(stored)}</span>
            </div>
            {fence && (pinMoved || radiusChanged) && (
              <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: space.xs }}>
                <span style={{ color: color.ink, fontWeight: 600 }}>
                  New: {fence.radiusM} m at <span style={mono}>{formatPoint(fence)}</span>
                </span>
                {onPutBack && (
                  <button type="button" className="wb-link wb-link--button" onClick={onPutBack} style={{ ...text.sm }}>
                    Put it back
                  </button>
                )}
              </div>
            )}
            {pinLeftBehind && (
              <p data-fence-unmoved="" style={{ margin: 0, color: color.amber }}>
                {radiusChanged ? 'The address has changed but the pin has not moved, only the radius.' : 'The address has changed but the fence has not moved.'} Pick
                the right search result, or click the map, to move it.
              </p>
            )}
          </>
        )
      )}
      <p style={{ margin: 0, color: color.muted }}>
        Crew can only clock on inside the circle. Cover the building and its parking, not the whole street: a fence that reaches the road clocks people on as
        they drive past.
      </p>
      {othersError && <p style={{ margin: 0, color: color.amber }}>Other jobs’ fences could not be loaded, so overlaps are not being checked.</p>}
    </div>
  )
}
