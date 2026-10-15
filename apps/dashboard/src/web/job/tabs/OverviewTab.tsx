/**
 * The job's Overview tab. A STUB from the website's foundation, so the tab
 * route renders; the package that builds this tab replaces the whole file
 * and keeps the default export and its props (JobTabProps).
 */
import type { JobTabProps } from '../types'
import { Empty } from '../../ui/Empty'

export default function OverviewTab(_props: JobTabProps) {
  return (
    <Empty data-stub="tab-overview" compact title="Overview is on its way">
      The project, whether it is ready to start, and who is on it: builder, address, fence, dates, contacts, readiness and notes.
    </Empty>
  )
}
