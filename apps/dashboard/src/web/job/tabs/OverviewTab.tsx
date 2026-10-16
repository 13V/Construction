/**
 * The job's Overview: three columns, read left to right as the questions the
 * office asks of a job.
 *   Project        what and where it is, when, for whom, and who to ring
 *   Ready to start what is still missing, each item linking to its fix
 *   People         who is there now and who is coming, and the job's notes
 * At 1440 the columns are about 365 px each; a narrower window gives two and
 * then one, by the grid's own auto-fit, with no breakpoint to keep in step.
 *
 * The job page hands this tab the job it has already loaded (useJob: the
 * row, the builder record, the contacts as the phone picks them) and the
 * job's dates, so the header and the Project card always say the same
 * thing. Rendered on its own with just JobTabProps (the tab contract), it
 * loads them itself.
 *
 * The crew list (crew_v) is read once here for the three cards that name
 * people: the captain, who is on site or booked, and who wrote each note.
 */
import { useCallback, useEffect, useState } from 'react'
import { useFresh } from '../../data/useFresh'
import { useJob, type JobData } from '../../data/useJob'
import type { CrewLite } from '../../data/useJobs'
import { supabase } from '../../phone'
import { space } from '../../tokens'
import { useJobDates, type JobDates } from '../JobHeader'
import { NotesCard } from '../NotesCard'
import { PeopleCard } from '../PeopleCard'
import { ProjectCard } from '../ProjectCard'
import { ReadinessCard } from '../ReadinessCard'
import type { JobTabProps } from '../types'

export interface OverviewTabProps extends JobTabProps {
  /** The job as the job page loaded it. Without it, the tab loads its own. */
  job?: Pick<JobData, 'contacts' | 'drift' | 'contract'>
  dates?: JobDates
  /**
   * Moves when something was saved on the job page that the job row does not
   * carry (a create issue retried: a crew booking, a supervisor). People and
   * Ready to start read again then, rather than at the next focus or minute.
   */
  refresh?: number
}

/**
 * The company's crew by id, for naming people; refreshed with the page.
 * Null until the first answer, so a card can tell "nobody" from "not yet".
 */
function useRoster(): Map<string, CrewLite> | null {
  const [roster, setRoster] = useState<Map<string, CrewLite> | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase().from('crew_v').select('id, name, initials')
    // A failed refresh keeps the names already on screen; a failed first load names nobody.
    if (!error) setRoster(new Map(((data ?? []) as CrewLite[]).map((w) => [w.id, w])))
    else setRoster((r) => r ?? new Map())
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useFresh(() => void load())
  return roster
}

export default function OverviewTab(props: OverviewTabProps) {
  if (props.job && props.dates) return <Overview {...props} job={props.job} dates={props.dates} />
  return <OverviewOnItsOwn {...props} />
}

function OverviewOnItsOwn(props: JobTabProps) {
  const job = useJob(props.site.id)
  const dates = useJobDates(props.site)
  return <Overview {...props} job={job} dates={dates} />
}

function Overview({ me, site, job, dates, refresh = 0 }: JobTabProps & Required<Pick<OverviewTabProps, 'job' | 'dates'>> & Pick<OverviewTabProps, 'refresh'>) {
  const roster = useRoster()
  return (
    <div data-overview="" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: space.lg, alignItems: 'start' }}>
      <ProjectCard site={site} job={job} dates={dates} roster={roster} />
      <ReadinessCard site={site} refresh={refresh} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg, minWidth: 0 }}>
        <PeopleCard me={me} site={site} roster={roster} refresh={refresh} />
        <NotesCard me={me} site={site} roster={roster} />
      </div>
    </div>
  )
}
