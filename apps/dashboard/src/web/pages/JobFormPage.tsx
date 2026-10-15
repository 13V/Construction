/**
 * New job (/jobs/new) and Edit job (/jobs/:id/edit): one page in the end.
 *
 * For now /jobs/:id/edit is "Move fence": the job's address and its fence on
 * a map that fills the page, and Save. It is the only place in either app
 * where a fence can be moved once a job exists (the phone sets a fence when
 * it makes a job and never again), so it comes first. The full form (the
 * job, the builder and their people, the dates, the crew) takes this page
 * over later and keeps the editor; until then /jobs/new says it is coming.
 *
 * Saving writes the address, the pin and the radius together, in one update
 * that is read back (data/jobs.ts updateJob): they are one fact, where the
 * job is. Nothing else on the row is touched. Two saves ask first, because
 * each is what a fence left in the wrong place looks like: a pin within
 * 100 m of where the map opens (nobody placed it), and a new address with
 * the pin left where it was (the address was searched, but no result was
 * picked), whatever the radius did. Clock-on goes by the fence, never the
 * address.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { updateJob } from '../data/jobs'
import { useJob } from '../data/useJob'
import { FenceEditor, useOtherFences } from '../map/FenceEditor'
import { formatPoint, nearDefaultCentre, samePoint, type FenceValue } from '../map/fenceGeometry'
import { useAddressSearch } from '../map/geocode'
import { addressLine, builderOf, railOf, type JobSiteRow } from '../phone'
import { PageLoading, type PageProps } from '../routes'
import { navigate, paths } from '../router'
import { Page } from '../shell/PageHeader'
import { useToast } from '../shell/Toast'
import { color, radius, size, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Empty } from '../ui/Empty'
import { Field } from '../ui/Field'

/** The saves that ask first (see the top of this file). */
type Check = 'address' | 'cbd'

export interface JobFormPageProps extends PageProps {
  /** The job being edited; absent for a new job. */
  id?: string
}

export default function JobFormPage({ id }: JobFormPageProps) {
  if (id) return <MoveFence id={id} />
  return (
    <Page
      title="New job"
      actions={
        <Button variant="secondary" href={paths.jobs}>
          Cancel
        </Button>
      }
    >
      <Empty data-stub="job-new" title="The New job form is on its way">
        One page with the job, the builder and their people, the site on a map with its fence, the dates, and who is on it.
      </Empty>
    </Page>
  )
}

function MoveFence({ id }: { id: string }) {
  // Not refreshed on focus: the page holds an edit, and the row it was
  // started from is the one the save is worked out against.
  const job = useJob(id, { fresh: false })
  if (job.state === 'loading') return <PageLoading />
  if (job.state === 'ready' && job.site) return <MoveFenceForm site={job.site} />
  const missing = job.state === 'missing'
  return (
    <Page title="Move fence">
      <Empty
        title={missing ? 'This job is not here' : 'This job could not be loaded'}
        action={
          missing ? (
            <Button href={paths.jobs}>Back to jobs</Button>
          ) : (
            <Button variant="primary" onClick={() => void job.reload()}>
              Try again
            </Button>
          )
        }
      >
        {missing ? 'It may have been deleted, or it belongs to another company.' : job.error}
      </Empty>
    </Page>
  )
}

/**
 * The narrowest window that has the form beside the map. Below it, a map
 * next to the form's 360 px column is under 520 px wide (344 px at 1024):
 * the search hits cover all of it, and the map's credit wraps. So up to here
 * the map goes under the address instead, at the page's full width.
 */
const SIDE_BY_SIDE = 1200

/**
 * True while the window is narrower than `px`. (web.css owns the media
 * queries for shared layouts; this page's two columns are its own.)
 */
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

function MoveFenceForm({ site }: { site: JobSiteRow }) {
  const stored = useMemo<FenceValue>(() => ({ lat: site.lat, lng: site.lng, radiusM: site.radius_m }), [site])
  const [fence, setFence] = useState<FenceValue>(stored)
  const [address, setAddress] = useState(site.address ?? '')
  const search = useAddressSearch()
  const others = useOtherFences(site.id)
  const toast = useToast()
  const stacked = useNarrower(SIDE_BY_SIDE)

  /** The question open, and the ones already answered "save" on the way to it. */
  const [asking, setAsking] = useState<{ kind: Check | 'leave'; sure: Check[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Where crew clock on is the pin; the radius only says how far round it.
  // So "has the fence moved" is the pin alone: a radius nudged after a new
  // address was searched still leaves the fence at the old site, and must not
  // switch off the question below or read as a move in the toast.
  const pinMoved = !samePoint(fence, stored)
  const radiusChanged = fence.radiusM !== stored.radiusM
  const fenceChanged = pinMoved || radiusChanged
  const addressChanged = address.trim() !== (site.address ?? '').trim()
  /** A new address searched, but no result picked and the map not clicked: the pin is still at the old site. */
  const pinLeftBehind = addressChanged && !pinMoved
  const dirty = fenceChanged || addressChanged
  const back = paths.job(site.id)
  const title = addressLine(site) || site.name
  const subtitle = [addressLine(site) ? site.name : null, builderOf(site) || null].filter(Boolean).join(' · ')

  const save = useCallback(
    async (sure: Check[] = []) => {
      if (!dirty || saving) return
      // A new address searched but no result picked leaves the fence at the
      // old site, where nobody will be clocking on.
      if (pinLeftBehind && !sure.includes('address')) {
        setAsking({ kind: 'address', sure })
        return
      }
      if (nearDefaultCentre(fence) && !sure.includes('cbd')) {
        setAsking({ kind: 'cbd', sure })
        return
      }
      setAsking(null)
      setSaving(true)
      setError(null)
      try {
        await updateJob(site, { lat: fence.lat, lng: fence.lng, radius_m: fence.radiusM, address: address.trim() })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setSaving(false)
        return
      }
      toast(savedNote({ address: addressChanged, pin: pinMoved, radius: radiusChanged }), { tone: 'success' })
      navigate(back)
    },
    [address, addressChanged, back, dirty, fence, pinLeftBehind, pinMoved, radiusChanged, saving, site, toast],
  )

  // Cmd+Enter (Ctrl+Enter) saves from anywhere on the page, as the job form will.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || asking) return
      e.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asking, save])

  const fenceCard = (
    <Card title="The fence">
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs, ...text.sm, color: color.body }}>
        <div>
          <span style={{ color: color.muted }}>Saved: </span>
          {stored.radiusM} m at <Mono>{formatPoint(stored)}</Mono>
        </div>
        {fenceChanged && (
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: space.xs }}>
            <span style={{ color: color.ink, fontWeight: 600 }}>
              New: {fence.radiusM} m at <Mono>{formatPoint(fence)}</Mono>
            </span>
            <button type="button" className="wb-link wb-link--button" onClick={() => setFence(stored)} style={{ ...text.sm }}>
              Put it back
            </button>
          </div>
        )}
        {pinLeftBehind && (
          <p data-fence-unmoved="" style={{ margin: 0, color: color.amber }}>
            {radiusChanged
              ? 'The address has changed but the pin has not moved, only the radius.'
              : 'The address has changed but the fence has not moved.'}{' '}
            Pick the right search result, or click the map, to move it.
          </p>
        )}
        <p style={{ margin: `${space.xxs}px 0 0`, color: color.muted }}>
          Crew can only clock on inside this circle. Cover the building and its parking, not the whole street: a fence that reaches the road clocks
          people on as they drive past.
        </p>
        <p style={{ margin: 0, color: color.muted }}>Click the map to move the pin, or drag it. Drag the white handle, or use the slider, for the radius.</p>
        {others.error && <p style={{ margin: 0, color: color.amber }}>Other jobs' fences could not be loaded, so overlaps are not being checked.</p>}
      </div>
    </Card>
  )

  return (
    <Page
      width="full"
      title="Move fence"
      subtitle={subtitle ? `${title} · ${subtitle}` : title}
      actions={
        <>
          <Button
            variant="secondary"
            href={back}
            onClick={(e) => {
              if (!dirty) return
              e.preventDefault()
              setAsking({ kind: 'leave', sure: [] })
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" data-save-fence="" disabled={!dirty} loading={saving} onClick={() => void save()} title="Save (Cmd+Enter)">
            Save
          </Button>
        </>
      }
    >
      <div
        data-layout={stacked ? 'stacked' : 'side'}
        style={{
          display: 'grid',
          gridTemplateColumns: stacked ? 'minmax(0, 1fr)' : `${size.side + 48}px minmax(0, 1fr)`,
          gap: stacked ? space.md : space.lg,
          // The map takes the rest of the window under the header, and never less than 600 px.
          height: stacked ? undefined : `max(600px, calc(100vh - ${size.header + space.xxl + space.md}px))`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0, overflowY: stacked ? undefined : 'auto' }}>
          {error && (
            <Banner tone="error" title="The fence was not saved" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          )}

          <Card title="Where the job is">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                search.search(address)
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}
            >
              <Field
                label="Address"
                data-fence-address=""
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="1 Moseley Square, Glenelg SA 5045"
                hint="Street, suburb SA postcode. Press Enter to find it on the map."
                autoComplete="off"
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
                <Button type="submit" data-fence-search="" loading={search.busy}>
                  Search
                </Button>
                {search.note && <div style={{ ...text.sm, color: color.amber }}>{search.note}</div>}
              </div>
            </form>
          </Card>

          {!stacked && fenceCard}
        </div>

        {/* Stacked, the map comes straight after the address it is searched
            from, and the fence's summary after the map. The editor stays the
            grid's second child either way, so a resize never restarts the map. */}
        <FenceEditor
          value={fence}
          onChange={setFence}
          colour={railOf(site)}
          others={others.fences}
          search={search}
          style={stacked ? { height: 560 } : { height: '100%', minHeight: 600 }}
        />
        {stacked && fenceCard}
      </div>

      {/* A radius changed with the address is still a fence at the old site,
          so the question is the same; it only names what else is saved. */}
      <Dialog
        open={asking?.kind === 'address'}
        title={radiusChanged ? 'Save the new address without moving the pin?' : 'Save the new address without moving the fence?'}
        confirmLabel={radiusChanged ? 'Save address and radius' : 'Save address only'}
        cancelLabel="Keep editing"
        onConfirm={() => void save([...(asking?.sure ?? []), 'address'])}
        onCancel={() => setAsking(null)}
      >
        {radiusChanged ? (
          <>
            The pin stays where it is, at {formatPoint(stored)}
            {site.address ? `, ${site.address}` : ''}; only the radius changes, from {stored.radiusM} m to {fence.radiusM} m.
          </>
        ) : (
          <>
            The fence stays where it is: {stored.radiusM} m at {formatPoint(stored)}
            {site.address ? `, ${site.address}` : ''}.
          </>
        )}{' '}
        Crew clock on by the fence, not the address, so if the job has moved, nobody can clock on at the new site. To move the fence, pick the right
        search result or click the map.
      </Dialog>

      <Dialog
        open={asking?.kind === 'cbd'}
        title="Is the job really in the middle of Adelaide?"
        confirmLabel="Save it here"
        onConfirm={() => void save([...(asking?.sure ?? []), 'cbd'])}
        onCancel={() => setAsking(null)}
      >
        The pin is within 100 m of where the map opens, in Adelaide's CBD. A fence left there by mistake means nobody can clock on at the real site.
      </Dialog>

      <Dialog
        open={asking?.kind === 'leave'}
        title="Leave without saving?"
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={() => navigate(back)}
        onCancel={() => setAsking(null)}
      >
        The job keeps its saved fence: {stored.radiusM} m at {formatPoint(stored)}
        {site.address ? `, ${site.address}` : ''}.
      </Dialog>
    </Page>
  )
}

/**
 * The toast after a save. It says what changed, so an address saved with the
 * pin where it was (on its own, or with a new radius) never reads as a fence
 * moved. api/ping.ts reads the fence afresh on every location check, so a
 * new circle is the one clock-on uses straight away.
 */
function savedNote(changed: { address: boolean; pin: boolean; radius: boolean }): string {
  if (changed.pin) return `${changed.address ? 'Address and fence' : 'Fence'} saved. Clock-on uses the new circle from now on.`
  if (changed.address) return changed.radius ? 'Address and radius saved. The pin has not moved.' : 'Address saved. The fence has not moved.'
  return 'Fence saved. Clock-on uses the new circle from now on.'
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: space.sm, padding: space.md, background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg }}>
      <h2 style={{ margin: 0, ...text.label, color: color.muted }}>{title}</h2>
      {children}
    </section>
  )
}

const Mono = ({ children }: { children: ReactNode }) => (
  <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums' }}>{children}</span>
)
