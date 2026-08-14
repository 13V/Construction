/**
 * Projects — active jobs with their progress, then what is coming.
 *
 * The drawing's Projects screen also carries notifications and per-project
 * crew assignment; those arrive with the notification model. What ships now
 * is the register: every job, its progress bar, its defect chip, tappable
 * through to the same Job screen Home opens.
 */
import type { JobSiteRow, WorkerRow } from '../../data/supabase'
import { jobColour, s } from './stheme'
import type { SimpleData } from './data'

export function ProjectsScreen({
  me,
  data,
  onOpenJob,
}: {
  me: WorkerRow
  data: SimpleData
  onOpenJob: (site: JobSiteRow) => void
}) {
  const active = data.sites.filter((x) => x.status === 'active')
  const future = data.sites.filter((x) => x.status === 'starting_soon')

  const row = (site: JobSiteRow) => {
    const pct = data.progress.get(site.id)
    const defects = data.openDefects.get(site.id) ?? 0
    return (
      <button
        key={site.id}
        onClick={() => onOpenJob(site)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 14,
          background: s.panel,
          border: `1px solid ${s.border}`,
          borderRadius: 12,
          textAlign: 'left',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: jobColour(site.id) }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: s.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {site.name}
            </div>
            <div style={{ fontSize: 12.5, color: s.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {[site.address, site.job_type].filter(Boolean).join(' · ')}
            </div>
          </div>
          {defects > 0 && (
            <span style={{ flex: 'none', padding: '3px 9px', borderRadius: 11, background: s.redFill, color: s.red, fontSize: 11.5, fontWeight: 700 }}>
              {defects} defect{defects === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {pct !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: s.fill, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: jobColour(site.id) }} />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: s.body, fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)}%</span>
          </div>
        )}
      </button>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: s.appBg }}>
      <div style={{ padding: '14px 20px 10px' }}>
        <span style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: s.ink }}>Projects</span>
      </div>
      <div style={{ padding: '4px 20px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.11em', color: s.muted }}>
        ACTIVE PROJECTS
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 20px' }}>
        {active.map(row)}
        {active.length === 0 && !data.loading && (
          <div style={{ padding: '24px 4px', fontSize: 13.5, lineHeight: 1.5, color: s.muted }}>
            Nothing active. {me.is_office ? 'New projects are entered on the office dashboard for now.' : 'Jobs the office adds show up here.'}
          </div>
        )}
      </div>
      {future.length > 0 && (
        <>
          <div style={{ padding: '18px 20px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.11em', color: s.muted }}>
            FUTURE PROJECTS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 20px 20px' }}>{future.map(row)}</div>
        </>
      )}
      <div style={{ height: 20 }} />
    </div>
  )
}
