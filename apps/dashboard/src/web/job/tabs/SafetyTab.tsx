/**
 * The job's Safety tab. A STUB from the website's foundation, so the tab
 * route renders; the package that builds this tab replaces the whole file
 * and keeps the default export and its props (JobTabProps).
 */
import type { JobTabProps } from '../types'
import { Empty } from '../../ui/Empty'

export default function SafetyTab(_props: JobTabProps) {
  return (
    <Empty data-stub="tab-safety" compact title="Safety is on its way">
      Toolbox, SWMS, SDS and policy, beside the same panel the crew use on their phones.
    </Empty>
  )
}
