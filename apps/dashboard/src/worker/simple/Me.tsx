/**
 * Me — who you are, your hours, your account.
 *
 * The design draws Me as identity plus the personal surfaces. Hours moved
 * here from the old root tab: they are the worker's own record, which is
 * exactly what this tab is for. Account & privacy opens the existing sheet —
 * deletion, sign-out and the privacy policy all already live there.
 */
import { useState } from 'react'
import type { WorkerRow } from '../../data/supabase'
import { HoursTab } from '../HoursTab'
import { s } from './stheme'

/** The shape HoursTab wants for the tracker's site list. */
interface TrackerSite {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
}

const ROLE_LABEL: Record<WorkerRow['role'], string> = {
  owner: 'Owner',
  captain: 'Crew captain',
  employee: 'Crew',
}

export function MeScreen({
  me,
  sites,
  onShowAccount,
}: {
  me: WorkerRow
  sites: TrackerSite[]
  onShowAccount: () => void
}) {
  const [showHours, setShowHours] = useState(false)

  if (showHours) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <button
          onClick={() => setShowHours(false)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: s.panel, border: 0, borderBottom: `1px solid ${s.borderSoft}`, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: s.accent, cursor: 'pointer' }}
        >
          <svg width="14" height="14" viewBox="0 0 10 10" style={{ transform: 'rotate(90deg)' }}>
            <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke={s.accent} strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          Me
        </button>
        <HoursTab me={me} sites={sites} />
      </div>
    )
  }

  const row = (label: string, sub: string, onTap: () => void) => (
    <button
      onClick={onTap}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', background: s.panel, border: `1px solid ${s.border}`, borderRadius: 12, textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: s.ink }}>{label}</div>
        <div style={{ fontSize: 12.5, color: s.muted }}>{sub}</div>
      </div>
      <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
        <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={s.ghost} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: s.appBg }}>
      <div style={{ padding: '14px 20px 10px' }}>
        <span style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: s.ink }}>Me</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '4px 20px 14px', padding: 16, background: s.inkDeep, borderRadius: 14 }}>
        <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: '50%', background: s.charcoal, color: '#fff', fontSize: 17, fontWeight: 700 }}>
          {me.initials}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{me.name}</div>
          <div style={{ fontSize: 13, color: s.onDarkMuted }}>
            {[ROLE_LABEL[me.role], me.trade].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 20px 20px' }}>
        {row('My hours', 'Every shift, and how it was recorded', () => setShowHours(true))}
        {row('Account & privacy', 'Tracking, your data, sign out', onShowAccount)}
      </div>
    </div>
  )
}
