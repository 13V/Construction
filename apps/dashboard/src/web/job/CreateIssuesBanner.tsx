/**
 * What did not save when this job was made, and a way to try it again.
 *
 * createJob (data/jobs.ts) is several requests, not one transaction: the job
 * is made first, then the builder's people, the supervisor link, the crew
 * booking and any other jobs to link. A step that fails after the job exists
 * never undoes the job; it comes back as an issue, which the job form
 * stashes in sessionStorage (crewline.createIssues.<siteId>) before it opens
 * this page. This banner names each one in the job page's words ("Site
 * supervisor", "Crew booking") with the reason, and Retry runs them again
 * through retryIssue, which reads every write back.
 *
 * The stash is read without being taken, and rewritten with whatever is
 * still outstanding after a retry, so reloading the page does not lose what
 * did not save. Dismiss clears it.
 *
 * An issue on the job's own columns ('job': the job saved, but a column
 * read back other than as entered) is not a thing that failed to save, so
 * it is never in the "Not saved" list: it is its own line, "Saved
 * differently", with nothing to retry and a link to Edit job, where it is
 * fixed. On its own it makes the banner a warning, not an error.
 */
import { useEffect, useState } from 'react'
import { issueLabel, peekCreateIssues, retryIssue, stashCreateIssues, type CreateIssue } from '../data/jobs'
import type { JobSiteRow, WorkerRow } from '../phone'
import { linkProps, paths } from '../router'
import { useToast } from '../shell/Toast'
import { space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'

export interface CreateIssuesBannerProps {
  me: WorkerRow
  site: JobSiteRow
  /** After a retry saved something: reload the job, and whatever on the page shows what was saved (the crew booked, the supervisor). */
  onSaved: () => void
}

/** "Site supervisor", "Site supervisor and Crew booking", "Builder, Site supervisor and Crew booking". */
function listOf(words: string[]): string {
  const unique = [...new Set(words)]
  return unique.length <= 1 ? (unique[0] ?? '') : `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
}

export function CreateIssuesBanner({ me, site, onSaved }: CreateIssuesBannerProps) {
  const toast = useToast()
  const [issues, setIssues] = useState<CreateIssue[]>(() => peekCreateIssues(site.id))
  const [busy, setBusy] = useState(false)

  // A different job on the same page component (Back from one job to another).
  useEffect(() => {
    setIssues(peekCreateIssues(site.id))
  }, [site.id])

  if (issues.length === 0) return null

  // Did not save, and Retry tries again.
  const missing = issues.filter((i) => i.step !== 'job')
  // Saved, but not as entered: fixed on Edit job.
  const differs = issues.filter((i) => i.step === 'job')

  const keep = (left: CreateIssue[]) => {
    stashCreateIssues(site.id, left)
    setIssues(left)
  }

  const retry = async () => {
    setBusy(true)
    const left: CreateIssue[] = []
    const notes: string[] = []
    let saved = 0
    // In order: a builder found on retry is what a contact retry then saves against.
    for (const issue of issues) {
      if (issue.step === 'job') {
        left.push(issue)
        continue
      }
      const out = await retryIssue(me, site, issue)
      if (out.left.length === 0) saved += 1
      left.push(...out.left)
      if (out.note) notes.push(out.note)
    }
    keep(left)
    setBusy(false)
    if (saved > 0) onSaved()
    const still = left.filter((i) => i.step !== 'job')
    if (still.length === 0) {
      const what = listOf(missing.map(issueLabel))
      toast(notes.length ? `Saved: ${what}. ${notes.join(' ')}` : `Saved: ${what}`, { tone: 'success' })
    } else {
      toast(`Still not saved: ${listOf(still.map(issueLabel))}`, { tone: 'error' })
    }
  }

  const editLink = (
    <a {...linkProps(paths.jobEdit(site.id))} className="wb-link" style={{ color: 'inherit' }}>
      Fix on Edit job
    </a>
  )

  return (
    <div data-create-issues="" style={{ marginTop: space.md }}>
      <Banner
        tone={missing.length > 0 ? 'error' : 'warn'}
        title={missing.length > 0 ? `Not saved: ${listOf(missing.map(issueLabel))}` : 'Saved differently'}
        action={
          missing.length > 0 ? (
            <Button size="sm" variant="primary" loading={busy} onClick={() => void retry()} data-retry="">
              Retry
            </Button>
          ) : undefined
        }
        onDismiss={busy ? undefined : () => keep([])}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.xxs }}>
          {missing.length > 0 && (
            <>
              <span>The job itself is saved. These did not save with it:</span>
              <ul style={{ margin: 0, paddingLeft: space.md, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {missing.map((issue, i) => (
                  <li key={`${issue.step}-${i}`} data-issue={issue.step} style={{ ...text.sm }}>
                    <strong style={{ fontWeight: 700 }}>{issueLabel(issue)}</strong>
                    {issue.step === 'contact' && issue.draft.name.trim() ? ` (${issue.draft.name.trim()})` : ''}: {issue.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {differs.map((issue, i) => (
            <span key={`job-${i}`} data-issue="job" style={{ ...text.sm }}>
              {missing.length > 0 && <strong style={{ fontWeight: 700 }}>Saved differently: </strong>}
              {issue.message} {editLink}
            </span>
          ))}
        </div>
      </Banner>
    </div>
  )
}
