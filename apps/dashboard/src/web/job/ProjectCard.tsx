/**
 * The Overview's Project column: the facts the crew's phones show under
 * Project details (Overview.tsx ProjectDetails), read the phone's way, plus
 * what the office needs to see that the phone never says.
 *
 *  - Builder: the name the phone shows (builderOf), whether the job is linked
 *    to a builder record, and the drift hint when the phone's Project details
 *    has renamed it away from the record (data/builders.ts driftOf).
 *  - Address and fence, with Move fence going to the edit page: the only
 *    place in either app where a fence can be moved after creation.
 *  - Dates, typed or derived (siteSpan, from the job page's one load).
 *  - The builder's programme line (the phone's useProgrammes and
 *    programmeLine), with a link to upload it on Drawings.
 *  - Project manager, site supervisor and contract administrator, picked the
 *    phone's way (useJob → contactsOf), with tel: and mailto: links. The
 *    tel: link is the phone's: the mobile with its spaces taken out.
 *  - The captain.
 *
 * Nothing here writes. Every fact is changed on Edit job (or its tab), so
 * the one form that sets what the phone shows stays the one place it is set.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import type { ContactRow } from '../data/builders'
import { CONTACT_LABEL, CONTACT_ROLES, type ContactRole } from '../data/contract'
import { fencePlaced } from '../data/readiness'
import { useFresh } from '../data/useFresh'
import type { JobData } from '../data/useJob'
import type { CrewLite } from '../data/useJobs'
import type { JobSiteRow } from '../phone'
import { programmeLine, useProgrammes } from '../phone-features'
import { linkProps, paths } from '../router'
import { color, radius, shadow, space, text } from '../tokens'
import { spanWords, type JobDates } from './JobHeader'

/**
 * The frame every Overview column is drawn in: a white card on the page's
 * grey, its title in the phone's tracked caps ("PROJECT DETAILS"), and one
 * link or button on the right. Kept here, with the first card, so the four
 * cards share one look without a file of their own.
 */
export function Card({
  title,
  action,
  children,
  style,
  ...rest
}: { title: ReactNode; action?: ReactNode; children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section
      {...rest}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        padding: `${space.md}px ${space.lg}px ${space.sm}px`,
        background: color.panel,
        border: `1px solid ${color.borderSoft}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xs, minHeight: 28, marginBottom: space.xs }}>
        <h2 style={{ margin: 0, ...text.label, color: color.muted }}>{title}</h2>
        {action && <div style={{ flex: 'none', ...text.sm }}>{action}</div>}
      </div>
      {children}
    </section>
  )
}

export interface ProjectCardProps {
  site: JobSiteRow
  job: Pick<JobData, 'contacts' | 'drift'>
  dates: JobDates
  /** Null until the crew list has loaded. */
  roster: Map<string, CrewLite> | null
}

/** The phone's tel: link: the number as typed, without its spaces. */
const telHref = (mobile: string) => `tel:${mobile.replace(/\s/g, '')}`

function Row({ label, children, action, data }: { label: string; children: ReactNode; action?: ReactNode; data?: string }) {
  return (
    <div data-row={data} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: `${space.sm}px 0`, borderTop: `1px solid ${color.borderSoft}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.xs }}>
        <span style={{ ...text.xs, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: color.muted }}>{label}</span>
        {action && <span style={{ flex: 'none', ...text.sm }}>{action}</span>}
      </div>
      <div style={{ ...text.base, color: color.ink, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  )
}

const quiet = (s: ReactNode) => <span style={{ color: color.faint }}>{s}</span>
const note = (s: ReactNode, tone: 'muted' | 'amber' | 'red' | 'green' = 'muted') => (
  <div style={{ ...text.sm, marginTop: 1, color: tone === 'muted' ? color.muted : color[tone] }}>{s}</div>
)

function Person({ role, who }: { role: ContactRole; who: ContactRow | null }) {
  if (!who) return <div data-contact={role}>{quiet('Not set for this job')}</div>
  return (
    <div data-contact={role} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span data-contact-name="">{who.name}</span>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `2px ${space.sm}px`, ...text.sm }}>
        {who.mobile && (
          <a href={telHref(who.mobile)} className="wb-link" data-tel="">
            {who.mobile}
          </a>
        )}
        {who.email && (
          <a href={`mailto:${who.email}`} className="wb-link" data-mail="" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {who.email}
          </a>
        )}
        {!who.mobile && !who.email && quiet('No contact details on file')}
      </span>
    </div>
  )
}

export function ProjectCard({ site, job, dates, roster }: ProjectCardProps) {
  const { current, loading, reload } = useProgrammes(site.id)
  useFresh(() => void reload())

  const builder = (site.client_name ?? '').trim()
  const placed = fencePlaced(site)
  const captain = site.captain_id ? roster?.get(site.captain_id) : null
  const edit = (label: string) => (
    <a {...linkProps(paths.jobEdit(site.id))} className="wb-link">
      {label}
    </a>
  )

  return (
    <Card title="Project" data-card="project" action={edit('Edit details')}>
      <Row label="Builder" data="builder">
        {builder || quiet('No builder yet')}
        {site.builder_id
          ? note('Linked to the builder record', 'green')
          : builder
            ? note("Typed on the job, not linked to a builder record. Pick the builder on Edit job to link it, so its people show on every job for them.", 'amber')
            : null}
        {job.drift &&
          note(
            <>
              The crew's phones show “{job.drift.onJob}”, but the builder record is “{job.drift.record}”: someone renamed it on a phone. Pick the builder again on Edit job to make them
              agree.
            </>,
            'amber',
          )}
      </Row>

      <Row
        label="Site address"
        data="address"
        action={
          site.address.trim() ? (
            <a href={`https://www.google.com/maps/search/?api=1&query=${site.lat},${site.lng}`} target="_blank" rel="noreferrer" className="wb-link">
              Map
            </a>
          ) : undefined
        }
      >
        {site.address.trim() || quiet('No address')}
      </Row>

      <Row label="Fence" data="fence" action={edit('Move fence')}>
        {site.radius_m} m around the pin
        {placed
          ? note(`${site.lat.toFixed(5)}, ${site.lng.toFixed(5)}. Crews clock on inside it.`)
          : note('The pin is still where the map opens, in the middle of Adelaide. Place it on the site, or nobody can clock on there.', 'red')}
      </Row>

      <Row label="Dates" data="dates">
        {dates.span ? spanWords(dates.span) : quiet(dates.loading ? ' ' : 'No dates yet')}
        {dates.source === 'typed'
          ? note('Set on the job')
          : dates.source === 'derived'
            ? note('Worked out from our programme lines, the bookings and clock-ons, as the phone does. Set them on Edit job to fix them.')
            : dates.loading
              ? null
              : note('Set them on Edit job, or book the crew.')}
      </Row>

      <Row
        label="Builder's programme"
        data="programme"
        action={
          <a {...linkProps(paths.job(site.id, 'drawings'))} className="wb-link">
            {current ? 'Drawings' : 'Upload'}
          </a>
        }
      >
        {current ? programmeLine(current, loading) : quiet(loading ? ' ' : programmeLine(null, false))}
      </Row>

      {CONTACT_ROLES.map((role) => (
        <Row key={role} label={CONTACT_LABEL[role]} data={role}>
          <Person role={role} who={job.contacts[role]} />
        </Row>
      ))}

      <Row label="Captain" data="captain">
        {site.captain_id ? (captain?.name ?? quiet(roster ? 'No longer on the crew list' : ' ')) : quiet('No captain')}
      </Row>
    </Card>
  )
}
