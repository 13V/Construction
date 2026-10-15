/**
 * The job's Drawings tab. A STUB from the website's foundation, so the tab
 * route renders; the package that builds this tab replaces the whole file
 * and keeps the default export and its props (JobTabProps).
 */
import type { JobTabProps } from '../types'
import { Empty } from '../../ui/Empty'

export default function DrawingsTab(_props: JobTabProps) {
  return (
    <Empty data-stub="tab-drawings" compact title="Drawings is on its way">
      The drawing register with its revisions, and the builder's programme.
    </Empty>
  )
}
