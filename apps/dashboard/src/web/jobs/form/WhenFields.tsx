/**
 * When the job runs and who runs it: the dates, Future or Active, the
 * captain, and (on a new job) a first crew booking.
 *
 * The dates are what the phone's Project details and Schedule show for the
 * job (typed dates win over anything worked out from bookings), so an end
 * before the start is refused as it is typed.
 *
 * Future or Active now is asked only when the job is made: the phone files
 * a new job under Future until somebody marks it active, and nothing ever
 * moves it by itself. On an existing job the status moves from the job
 * page's header, where Mark active, Archive and Restore are, each asked
 * first; this form never changes it.
 *
 * The captain is one of the crew whose role is captain: captains_site()
 * lets them upload the programme and see the crew's clock on this job.
 *
 * The crew booking is the Crew tab's picker (CrewPicker), on the job's own
 * dates until its own are changed. It books when the job is made; on an
 * existing job, booking is the Crew tab's.
 */
import { localISO } from '../../data/contract'
import { linkProps, paths } from '../../router'
import { color, radius, space, text } from '../../tokens'
import { Field } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { Select } from '../../ui/Select'
import { CrewPicker, type CrewPick } from '../CrewPicker'
import type { CrewOption, FieldErrors, FormMode } from './useJobForm'

export interface WhenFieldsProps {
  mode: FormMode
  /** Editing: the job's id, for the Crew tab link. */
  siteId: string | null
  startsOn: string
  endsOn: string
  onStartsOn: (v: string) => void
  onEndsOn: (v: string) => void
  status: 'starting_soon' | 'active'
  onStatus: (v: 'starting_soon' | 'active') => void
  /** Editing: the job's status now, said rather than offered. */
  currentStatus: 'starting_soon' | 'active' | 'archived' | null
  captainId: string
  onCaptain: (id: string) => void
  captains: CrewOption[]
  crewLoading: boolean
  bookCrew: boolean
  onBookCrew: (on: boolean) => void
  crew: CrewPick
  onCrew: (next: CrewPick) => void
  /** The colour this job is drawn in on the booking grid. */
  colour: string
  errors: FieldErrors
}

const STATUS_WORDS: Record<'starting_soon' | 'active' | 'archived', string> = {
  starting_soon: 'Future: under Future projects on the crew’s phones.',
  active: 'Active: under Active projects on the crew’s phones.',
  archived: 'Archived: off the crew’s phones.',
}

export function WhenFields(p: WhenFieldsProps) {
  const today = localISO(new Date())
  const captainOptions = p.captains.map((w) => ({
    value: w.id,
    label: w.role === 'captain' && w.active ? w.name : `${w.name} (${!w.active ? 'no longer active' : 'not a captain now'})`,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space.sm }}>
        <Field
          label="Start date"
          type="date"
          name="startsOn"
          optional
          value={p.startsOn}
          onChange={(e) => p.onStartsOn(e.target.value)}
          error={p.errors.startsOn}
        />
        <Field
          label="End date"
          type="date"
          name="endsOn"
          optional
          value={p.endsOn}
          min={p.startsOn || undefined}
          onChange={(e) => p.onEndsOn(e.target.value)}
          error={p.errors.endsOn}
        />
      </div>

      {p.mode === 'create' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...text.label, color: color.muted }}>Status</span>
          <div>
            <Segmented
              label="Status"
              value={p.status}
              onChange={p.onStatus}
              options={[
                { value: 'starting_soon', label: 'Future' },
                { value: 'active', label: 'Active now' },
              ]}
            />
          </div>
          <span style={{ ...text.sm, color: color.muted }}>
            {p.status === 'active'
              ? 'Under Active projects on the crew’s phones from the start.'
              : 'Under Future projects on the crew’s phones until it is marked active. Nothing marks it active by itself.'}
            {p.status === 'starting_soon' && p.startsOn && p.startsOn <= today ? ' The start date has already come: Active now may be what you mean.' : ''}
          </span>
        </div>
      ) : p.currentStatus ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...text.label, color: color.muted }}>Status</span>
          <span data-status-note="" style={{ ...text.base, color: color.body }}>
            {STATUS_WORDS[p.currentStatus]}{' '}
            <span style={{ ...text.sm, color: color.muted }}>Mark active, Archive and Restore are on the job page, at the top.</span>
          </span>
        </div>
      ) : null}

      <Select
        label="Captain"
        name="captain"
        optional
        value={p.captainId}
        onChange={(e) => p.onCaptain(e.target.value)}
        placeholder={p.crewLoading ? 'Loading the crew…' : 'No captain'}
        options={captainOptions}
        hint={
          p.captains.length === 0 && !p.crewLoading
            ? 'Nobody is a captain yet. Make someone a captain on the Team page.'
            : 'They can upload the programme and see who is clocked on, for this job.'
        }
        error={p.errors.captain}
      />

      {p.mode === 'create' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: space.xs, cursor: 'pointer', ...text.base, color: color.ink }}>
            <input
              type="checkbox"
              className="wb-focus"
              checked={p.bookCrew}
              onChange={(e) => p.onBookCrew(e.target.checked)}
              data-book-crew=""
              style={{ flex: 'none', width: 16, height: 16, margin: '2px 0 0', accentColor: color.ink }}
            />
            <span>
              Book crew now
              <span style={{ display: 'block', ...text.sm, color: color.muted }}>Optional. Crew can be booked later, from the job’s Crew tab.</span>
            </span>
          </label>
          {p.bookCrew && (
            <div style={{ padding: space.sm, border: `1px solid ${p.errors.crew ? color.redEdge : color.borderSoft}`, borderRadius: radius.md, background: color.rowFill }}>
              <CrewPicker value={p.crew} onChange={p.onCrew} site={null} colour={p.colour} />
              {p.errors.crew && (
                <div role="alert" style={{ marginTop: space.xs, ...text.sm, color: color.red }}>
                  {p.errors.crew}
                </div>
              )}
            </div>
          )}
        </div>
      ) : p.siteId ? (
        <div style={{ ...text.sm, color: color.muted }}>
          Book or take people off this job on its{' '}
          <a {...linkProps(paths.job(p.siteId, 'crew'))} className="wb-link">
            Crew tab
          </a>
          .
        </div>
      ) : null}
    </div>
  )
}
