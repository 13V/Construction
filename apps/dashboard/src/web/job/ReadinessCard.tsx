/**
 * Ready to start: the job's checklist, worked out from rows it already has
 * (data/readiness.ts), so a supervisor saved on site or a scope line
 * confirmed on a phone counts the moment it is made, with no column of its
 * own to fall out of step.
 *
 * Every item is a link to the place that fixes it: a job tab, or Edit job
 * for the fence, builder, dates, supervisor and captain. Done items link
 * too, to see what is there. The waterproofing certificate's six steps sit
 * under the list rather than in it: waterproofing is finished during a job,
 * not before it starts, so it never holds the job's start up.
 *
 * useReadiness refreshes with the page (focus, visibility, every 60 s) and
 * whenever the job's builder or supervisor changes; a load that answers late
 * never puts an older count back. It also reads again when `refresh` moves:
 * the job page's Retry can book the crew, which changes no column of the
 * job row, so nothing else would tell this card until the next focus.
 */
import { useEffect, useRef } from 'react'
import { useReadiness, type ReadyItem } from '../data/readiness'
import { siteSpan, type JobSiteRow } from '../phone'
import { linkProps, paths, type JobTab } from '../router'
import { color, radius, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { spanWords } from './JobHeader'
import { Card } from './ProjectCard'

const hrefOf = (site: JobSiteRow, fix: JobTab | 'edit') => (fix === 'edit' ? paths.jobEdit(site.id) : paths.job(site.id, fix))

/**
 * The line under an item. Typed dates are written the way the header and
 * the Project card write them ("19 Oct – 20 Nov 2026"), so one page never
 * shows the same dates two ways.
 */
function detailOf(site: JobSiteRow, item: ReadyItem): string {
  if (item.key === 'dates' && item.done && site.starts_on) {
    return spanWords(siteSpan({ tasks: [], assignments: [], shifts: [], set: { starts_on: site.starts_on, ends_on: site.ends_on } }))
  }
  return item.detail
}

function Tick({ done }: { done: boolean }) {
  return done ? (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: 'none', marginTop: 1 }}>
      <circle cx="9" cy="9" r="9" fill={color.greenFill} />
      <path d="M5.2 9.3l2.5 2.5 5-5.4" fill="none" stroke={color.green} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: 'none', marginTop: 1 }}>
      <circle cx="9" cy="9" r="8" fill="none" stroke={color.ghost} strokeWidth="1.6" strokeDasharray="3 2.4" />
    </svg>
  )
}

function Item({ site, item }: { site: JobSiteRow; item: ReadyItem }) {
  return (
    <li style={{ listStyle: 'none' }}>
      <a
        {...linkProps(hrefOf(site, item.fix))}
        className="wb-row wb-row--link wb-focus"
        data-ready={item.key}
        data-done={item.done ? 'yes' : 'no'}
        style={{ display: 'flex', alignItems: 'flex-start', gap: space.sm, padding: `${space.xs}px ${space.xs}px`, margin: `0 -${space.xs}px`, borderRadius: radius.sm, textDecoration: 'none', color: 'inherit' }}
      >
        <Tick done={item.done} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ ...text.base, fontWeight: 600, color: color.ink }}>{item.label}</span>
          <span style={{ ...text.sm, color: item.done ? color.muted : color.body }}>{detailOf(site, item)}</span>
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ flex: 'none', marginTop: 5 }}>
          <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={color.ghost} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </li>
  )
}

export function ReadinessCard({ site, refresh = 0 }: { site: JobSiteRow; refresh?: number }) {
  const { readiness, loading, error, reload } = useReadiness(site)
  // Only a move of `refresh`: useReadiness already loads on mount and when the job's builder or supervisor changes.
  const seen = useRef(refresh)
  useEffect(() => {
    if (seen.current === refresh) return
    seen.current = refresh
    void reload()
  }, [refresh, reload])

  const meter = readiness ? (
    <div aria-hidden="true" style={{ display: 'flex', gap: 3, margin: `${space.xxs}px 0 ${space.sm}px` }}>
      {readiness.items.map((i) => (
        <span key={i.key} style={{ flex: 1, height: 4, borderRadius: 2, background: i.done ? color.green : color.fill }} />
      ))}
    </div>
  ) : null

  return (
    <Card
      title="Ready to start"
      data-card="readiness"
      action={readiness ? <span data-ready-count="" style={{ fontWeight: 600, color: readiness.done === readiness.total ? color.green : color.body }}>{readiness.done} of {readiness.total}</span> : undefined}
    >
      {error && !readiness && (
        <Banner tone="warn" title="Could not work out the checklist" action={<Button size="sm" onClick={() => void reload()}>Try again</Button>}>
          {error}
        </Banner>
      )}
      {!readiness && !error && <div style={{ ...text.sm, color: color.faint, padding: `${space.sm}px 0` }}>{loading ? 'Checking…' : ' '}</div>}
      {readiness && (
        <>
          {meter}
          <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {readiness.items.map((item) => (
              <Item key={item.key} site={site} item={item} />
            ))}
          </ul>
          <div style={{ marginTop: space.sm, paddingTop: space.sm, borderTop: `1px solid ${color.borderSoft}` }}>
            <a
              {...linkProps(paths.job(site.id, 'waterproofing'))}
              className="wb-row wb-row--link wb-focus"
              data-ready="waterproofing"
              style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.xs}px`, margin: `0 -${space.xs}px`, borderRadius: radius.sm, textDecoration: 'none', color: 'inherit' }}
            >
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ ...text.base, fontWeight: 600, color: color.ink }}>
                  Waterproofing certificate: {readiness.waterproofing.done} of {readiness.waterproofing.total} steps
                </span>
                <span style={{ ...text.sm, color: color.muted }}>Done on site during the job, so it is not part of being ready.</span>
              </span>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ flex: 'none' }}>
                <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={color.ghost} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </>
      )}
    </Card>
  )
}
