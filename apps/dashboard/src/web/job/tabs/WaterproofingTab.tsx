/**
 * The job's Waterproofing tab. A STUB from the website's foundation, so the tab
 * route renders; the package that builds this tab replaces the whole file
 * and keeps the default export and its props (JobTabProps).
 */
import type { JobTabProps } from '../types'
import { Empty } from '../../ui/Empty'

export default function WaterproofingTab(_props: JobTabProps) {
  return (
    <Empty data-stub="tab-waterproofing" compact title="Waterproofing is on its way">
      The six waterproofing steps, beside the same panel the crew use on their phones.
    </Empty>
  )
}
