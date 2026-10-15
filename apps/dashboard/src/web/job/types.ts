import type { JobSiteRow, WorkerRow } from '../phone'

/**
 * What every tab of the job page is given. The job page loads the row once
 * (archived jobs included) and hands it down; a tab that changes the job's
 * own row calls reloadJob() so the header and the other tabs see it.
 */
export interface JobTabProps {
  me: WorkerRow
  site: JobSiteRow
  reloadJob: () => void
}
