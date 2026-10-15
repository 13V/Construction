/**
 * Company. A STUB from the website's foundation, so the route renders and
 * the rail can be walked; the package that builds this page replaces the
 * whole file and keeps the default export and its props.
 */
import type { PageProps } from '../routes'
import { Page } from '../shell/PageHeader'
import { Empty } from '../ui/Empty'

export default function CompanyPage(_props: PageProps) {
  return (
    <Page
      title="Company"
    >
      <Empty data-stub="company" title="Company is on its way">
        Your business details, and what SWMS and certificates still need, as the crew app's Business screen shows them.
      </Empty>
    </Page>
  )
}
