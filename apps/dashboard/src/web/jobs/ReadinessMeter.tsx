/**
 * How ready a job is to start, small enough for a board row: "7/10" over a
 * bar filled by the share of the checklist (data/readiness.ts) that is done.
 *
 * The checklist is worked out from rows the job already has (a fence that
 * is not where the map opens, a builder, dates, a supervisor, scope,
 * drawings, the programme, a SWMS, crew, a captain), so the phone's own
 * edits move the meter the moment they are made. The job page's Ready to
 * start card is the same list with a line per item; this is its summary.
 *
 * Hovering names what is still missing. A screen reader hears it as a meter
 * ("Ready to start, 7 of 10") with the missing items as its description.
 *
 * While the rows are on their way the meter is a faint empty bar rather
 * than "0/10": a count of nothing done that is really "not loaded yet"
 * would send somebody to fix a job that is fine.
 */
import { useId } from 'react'
import type { Readiness } from '../data/readiness'
import { color } from '../tokens'

export interface ReadinessMeterProps {
  /** The job's checklist; null or undefined while it loads (or if it could not be). */
  readiness: Readiness | null | undefined
  /** True while the checklist is on its way; false when it could not be worked out. */
  loading?: boolean
}

export function ReadinessMeter({ readiness, loading = false }: ReadinessMeterProps) {
  const descId = useId()

  if (!readiness) {
    return (
      <span
        data-ready={loading ? 'loading' : 'unknown'}
        aria-label={loading ? 'Ready to start: loading' : 'Ready to start: not known'}
        role="img"
        title={loading ? undefined : 'Could not work out what this job still needs. Open it to see.'}
        style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}
      >
        <span style={{ fontSize: 13, lineHeight: '16px', fontWeight: 600, color: color.ghost }}>{loading ? '' : '—'}</span>
        <Bar done={0} total={10} faint />
      </span>
    )
  }

  const { done, total, items } = readiness
  const missing = items.filter((i) => !i.done).map((i) => i.label)
  const complete = total > 0 && done === total
  const said = complete ? 'Everything on the checklist is done.' : `Still to do: ${missing.join(', ')}.`

  return (
    <span
      role="meter"
      aria-label="Ready to start"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total}`}
      aria-describedby={descId}
      data-ready={`${done}/${total}`}
      title={`Ready to start: ${done} of ${total}. ${said}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%', minWidth: 0 }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', fontSize: 13, lineHeight: '16px', fontWeight: 600, color: complete ? color.green : color.ink }}>
        {done}
        <span style={{ fontWeight: 500, color: color.muted }}>/{total}</span>
      </span>
      <Bar done={done} total={total} complete={complete} />
      <span id={descId} className="wb-sr-only">
        {said}
      </span>
    </span>
  )
}

/**
 * The bar: a track with the done share filled. One piece rather than a
 * segment per item: in a 56 px cell ten segments come out as dots, which
 * read as a loading indicator, not a count; the count is the number above.
 */
function Bar({ done, total, complete = false, faint = false }: { done: number; total: number; complete?: boolean; faint?: boolean }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <span aria-hidden="true" style={{ display: 'block', height: 4, borderRadius: 2, background: faint ? color.borderSoft : color.border, overflow: 'hidden' }}>
      <span style={{ display: 'block', width: `${pct}%`, height: '100%', borderRadius: 2, background: complete ? color.green : color.ink }} />
    </span>
  )
}
