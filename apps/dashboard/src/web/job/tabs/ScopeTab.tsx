/**
 * The job's Scope of works tab. A STUB from the website's foundation, so the tab
 * route renders; the package that builds this tab replaces the whole file
 * and keeps the default export and its props (JobTabProps).
 */
import type { JobTabProps } from '../types'
import { Empty } from '../../ui/Empty'

export default function ScopeTab(_props: JobTabProps) {
  return (
    <Empty data-stub="tab-scope" compact title="Scope of works is on its way">
      The seven standard lines and any extras, each Required, Confirmed or Not applicable, with attachments.
    </Empty>
  )
}
