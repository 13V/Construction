/**
 * The job's Crew tab. A STUB from the website's foundation, so the tab
 * route renders; the package that builds this tab replaces the whole file
 * and keeps the default export and its props (JobTabProps).
 */
import type { JobTabProps } from '../types'
import { Empty } from '../../ui/Empty'

export default function CrewTab(_props: JobTabProps) {
  return (
    <Empty data-stub="tab-crew" compact title="Crew is on its way">
      Who is booked on this job over the next six weeks, booking more, and taking people off.
    </Empty>
  )
}
