/**
 * Drawings — a door, not a list.
 *
 * "Each section should have its own tab like waterproofing, because the list
 * could get long — I do a 10 storey apartment building, that's 3 drawings per
 * level." Thirty sheets printed straight onto the Overview page push the scope
 * of works, the notes and the project details below anything anyone will
 * scroll to. So the register moves behind a button that says how many there
 * are and whether any of them want attention, and opens as its own sheet.
 *
 * The register itself is still PlansScreen — the same list, the same viewer,
 * the same pins — because a drawing you can mark up is the whole point of
 * having it on the phone, and forking that would mean two of them.
 */
import { useEffect, useState } from 'react'
import { supabase, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { PlansScreen } from '../PlansScreen'
import { s, SAFE_BOTTOM } from './stheme'

/**
 * What the button says, without mounting the register to find out: how many
 * sheets are current, and how many marks are still open on them.
 */
function useDrawingCount(siteId: string) {
  const [state, setState] = useState<{ sheets: number; superseded: number; pins: number; loading: boolean }>({
    sheets: 0,
    superseded: 0,
    pins: 0,
    loading: true,
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const client = supabase()
      const [f, p] = await Promise.all([
        client
          .from('site_files')
          .select('id, supersedes')
          .eq('site_id', siteId)
          .eq('kind', 'document')
          .is('selection_id', null)
          .is('waterproofing_package_id', null),
        client.from('plan_pins').select('id').eq('site_id', siteId).is('resolved_at', null),
      ])
      if (cancelled) return
      const rows = (f.data ?? []) as Array<{ id: string; supersedes: string | null }>
      const superseded = new Set(rows.map((r) => r.supersedes).filter(Boolean) as string[])
      setState({
        sheets: rows.filter((r) => !superseded.has(r.id)).length,
        superseded: rows.filter((r) => superseded.has(r.id)).length,
        pins: (p.data ?? []).length,
        loading: false,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [siteId])

  return state
}

const chevron = (
  <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
    <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function DrawingsButton({ site, onOpen }: { site: JobSiteRow; onOpen: () => void }) {
  const { sheets, superseded, pins, loading } = useDrawingCount(site.id)

  // A superseded sheet still on the job is the one that gets built from by
  // mistake, so it is the only state here that raises its voice.
  const alarm = superseded > 0
  const line = loading
    ? ' '
    : sheets === 0
      ? 'No drawings yet'
      : [
          `${sheets} sheet${sheets === 1 ? '' : 's'}`,
          pins > 0 ? `${pins} open mark${pins === 1 ? '' : 's'}` : null,
          superseded > 0 ? `${superseded} superseded` : null,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        margin: '0 18px',
        padding: '15px 15px 15px 16px',
        borderRadius: 12,
        background: alarm ? '#FFF6F6' : '#fff',
        border: `1px solid ${alarm ? '#F3C9CC' : '#E1E5E9'}`,
        boxShadow: '0 1px 2px rgba(16,20,24,.05)',
        cursor: 'pointer',
      }}
    >
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 12, background: alarm ? '#FDE7E8' : '#EFEBFB' }}>
        <svg width="23" height="23" viewBox="0 0 20 20" fill="none" stroke={alarm ? '#A3282E' : '#6E56CF'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
          <path d="M5 2.8h6.4L15.6 7v10.2H5z" />
          <path d="M11.2 2.8V7h4.4" />
          <path d="M7.4 10.2h5M7.4 13h3.2" />
        </svg>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: '-.01em', color: s.ink }}>Drawings</span>
        <span style={{ fontSize: 13, color: alarm ? '#A3282E' : '#7B838B', fontWeight: alarm ? 600 : 400 }}>{line}</span>
      </span>
      {chevron}
    </div>
  )
}

/** The register, over the job. Searchable and grouped by level once it is big. */
export function DrawingsSheet({ me, site, onClose }: { me: WorkerRow; site: JobSiteRow; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.45)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 13px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>Drawings</span>
            <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
          </span>
          <span
            onClick={onClose}
            style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: `calc(20px + ${SAFE_BOTTOM})` }}>
          <PlansScreen me={me} siteId={site.id} siteName={site.name} embedded onClose={onClose} />
        </div>
      </div>
    </div>
  )
}
