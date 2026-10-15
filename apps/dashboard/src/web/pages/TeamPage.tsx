/**
 * Team. A STUB from the website's foundation, so the route renders and
 * the rail can be walked; the package that builds this page replaces the
 * whole file and keeps the default export and its props.
 */
import type { PageProps } from '../routes'
import { Page } from '../shell/PageHeader'
import { Empty } from '../ui/Empty'

export default function TeamPage(_props: PageProps) {
  return (
    <Page
      title="Team"
    >
      <Empty data-stub="team" title="Team is on its way">
        The people in your company, their roles and their tickets, as the crew app's Team screen shows them.
      </Empty>
    </Page>
  )
}
