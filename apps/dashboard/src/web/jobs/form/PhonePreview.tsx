/**
 * "On the crew's phones": the job as the phone's Projects list will show it,
 * redrawn from the form on every keystroke.
 *
 * The website is where a job is typed; the phone is where it is read, by
 * somebody on a site with a phone in one hand. The phone lists a job by
 * where it is and who it is for (addressLine and builderOf, with the state
 * and postcode taken off and a name that only repeats the address dropped),
 * so what is typed here is not quite what they see. This card is that
 * difference, shown before it is saved: the phone's own formatters, the
 * phone's own row (Projects.tsx, the Future list's row and the Active list's
 * card, same sizes, same greys, same amber chip), at the phone's width, so
 * an address that will be cut short on a phone is cut short here too.
 *
 * It also says when the crew will see it: the phone has no live updates, so
 * a running app shows a new or changed job the next time it is opened.
 */
import { addressLine, builderOf, s } from '../../phone'
import { color, radius, space, text } from '../../tokens'

export interface PhonePreviewProps {
  name: string
  address: string
  builder: string
  /** The rail colour the job will wear (railOf). */
  rail: string
  status: 'starting_soon' | 'active' | 'archived'
  /** What a Future job's chip says instead of "Starting soon", if anybody wrote it (phone-made jobs only). */
  scheduleNote?: string | null
  /** Local YYYY-MM-DD, or ''. */
  startsOn: string
  endsOn: string
  /** People being booked with the new job (the Active card counts them); null when this form does not know (editing). */
  people: number | null
  mode: 'create' | 'edit'
}

/** The phone's Project details date: "1 March 2027". */
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

/** The phone's content width at 430 px (Projects.tsx pads its lists 18 px each side). */
const PHONE_LIST_WIDTH = 394

export function PhonePreview({ name, address, builder, rail, status, scheduleNote, startsOn, endsOn, people, mode }: PhonePreviewProps) {
  const site = { name: name.trim(), address: address.trim(), client_name: builder.trim() || null }
  const title = addressLine(site) || site.name
  const who = builderOf(site)
  const where = status === 'active' ? 'Projects › Active' : status === 'archived' ? 'Not listed: archived' : 'Projects › Future'
  const dates = startsOn || endsOn ? `${startsOn ? longDate(startsOn) : '—'} to ${endsOn ? longDate(endsOn) : '—'}` : null

  return (
    <section
      data-phone-preview=""
      aria-label="How the crew's phones will show this job"
      style={{ display: 'flex', flexDirection: 'column', gap: space.xs, padding: `${space.sm}px ${space.md}px ${space.md}px`, background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.xs }}>
        <h2 style={{ margin: 0, ...text.label, color: color.muted }}>On the crew’s phones</h2>
        <span data-preview-where="" style={{ ...text.xs, color: color.muted }}>
          {where}
        </span>
      </div>

      {/* The phone's list, on the phone's background, at the phone's width. */}
      <div style={{ padding: '10px 0', background: s.appBg, borderRadius: radius.md, display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: PHONE_LIST_WIDTH, padding: '0 10px', boxSizing: 'border-box', opacity: status === 'archived' ? 0.5 : 1 }}>
          {status === 'active' ? <ActiveCard title={title} who={who} rail={rail} people={people} /> : <FutureRow title={title} who={who} rail={rail} chip={scheduleNote || 'Starting soon'} />}
        </div>
      </div>

      <div style={{ ...text.xs, color: color.muted }}>
        {dates ? (
          <>
            Project details: <span data-preview-dates="">{dates}</span>.{' '}
          </>
        ) : null}
        {mode === 'create' ? 'A phone shows a new job the next time the app is opened.' : 'A phone shows the changes the next time the app is opened.'}
      </div>
    </section>
  )
}

/** Projects.tsx, the Future list's row (one row of the list's card). */
function FutureRow({ title, who, rail, chip }: { title: string; who: string; rail: string; chip: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', overflow: 'hidden' }}>
      <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, minHeight: 68, padding: '11px 14px 11px 19px', boxSizing: 'border-box' }}>
        <span data-preview-rail={rail} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: rail }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span data-preview-title="" style={{ fontSize: 15.5, fontWeight: 600, color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title || <span style={{ color: s.ghost }}>Project name</span>}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            {who && (
              <span data-preview-builder="" style={{ flex: '0 1 auto', fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {who}
              </span>
            )}
            <span
              data-preview-status=""
              style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 700, background: '#FFF6E3', color: '#8A6100' }}
            >
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#8A6100' }} />
              {chip}
            </span>
          </span>
        </span>
      </span>
    </div>
  )
}

/** Projects.tsx, the Active list's card: where, who for, and who is on it. */
function ActiveCard({ title, who, rail, people }: { title: string; who: string; rail: string; people: number | null }) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', overflow: 'hidden' }}>
      <span data-preview-rail={rail} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: rail, zIndex: 1 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 14px 13px 19px' }}>
        <span data-preview-title="" style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.015em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title || <span style={{ color: s.ghost }}>Project name</span>}
        </span>
        {who && (
          <span data-preview-builder="" style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {who}
          </span>
        )}
      </span>
      {people !== null && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '8px 14px 8px 19px', borderTop: '1px solid #EDEFF1' }}>
          <span data-preview-status="" style={{ flex: 1, fontSize: 13.5, color: '#4A5057', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {people ? `${people} ${people === 1 ? 'person' : 'people'} assigned` : 'Nobody assigned yet'}
          </span>
          <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, color: s.accent }}>Manage</span>
        </span>
      )}
    </div>
  )
}
