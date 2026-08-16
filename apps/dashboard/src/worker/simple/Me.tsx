/**
 * Me — the drawn identity card and the personal surface, transcribed from
 * the isMe block: the 76px avatar on the dark gradient, the CONTACT card,
 * and the settings rows. The drawing's MY DOCUMENTS section (tickets and
 * licences) waits on a table to hold them — nothing is rendered that the
 * database cannot back.
 */
import { useEffect, useState } from 'react'
import { supabase, type WorkerRow } from '../../data/supabase'
import { HoursTab } from '../HoursTab'
import { s, SAFE_TOP } from './stheme'

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
  trackingOn,
  onOpenClock,
  onShowAccount,
}: {
  me: WorkerRow
  sites: TrackerSite[]
  trackingOn: boolean
  onOpenClock: () => void
  onShowAccount: () => void
}) {
  const [showHours, setShowHours] = useState(false)
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void Promise.all([
      client.auth.getUser(),
      client.from('companies').select('name').maybeSingle(),
    ]).then(([u, c]) => {
      if (cancelled) return
      setEmail(u.data.user?.email ?? '')
      setCompany((c.data as { name: string } | null)?.name ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [me.id])

  if (showHours) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <button
          onClick={() => setShowHours(false)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `calc(10px + ${SAFE_TOP}) 16px 10px`, background: s.panel, border: 0, borderBottom: `1px solid ${s.borderSoft}`, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: s.accent, cursor: 'pointer' }}
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

  const settingsRow = (k: string, v: string, opts: { red?: boolean; onTap?: () => void; last?: boolean } = {}) => (
    <span
      key={k}
      onClick={opts.onTap}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '11px 15px', borderBottom: opts.last ? 'none' : '1px solid #EDEFF1', cursor: opts.onTap ? 'pointer' : 'default' }}
    >
      <span style={{ flex: 1, fontSize: 15.5, color: opts.red ? '#A3282E' : s.ink, fontWeight: opts.red ? 600 : 500 }}>{k}</span>
      <span style={{ fontSize: 14, color: '#8B9096' }}>{v}</span>
    </span>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#F5F6F7', paddingTop: SAFE_TOP }}>
      {/* Identity — the 76px avatar on the dark gradient card. */}
      <div style={{ padding: '6px 18px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, padding: 18, borderRadius: 14, background: 'linear-gradient(#23272C,#15181C)', boxShadow: '0 10px 24px rgba(16,20,24,.20), 0 1px 0 rgba(255,255,255,.06) inset' }}>
          <span style={{ flex: 'none', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 76, height: 76, borderRadius: '50%', background: '#4A5057', color: '#fff', fontSize: 23, fontWeight: 600, letterSpacing: '.02em' }}>
            {me.initials}
            <span style={{ position: 'absolute', right: -2, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: '#fff', border: '2.5px solid #1B1F23' }}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#14171A" strokeWidth="1.7" strokeLinejoin="round">
                <path d="M2.6 6.2h3.1l1.3-1.9h6l1.3 1.9h3.1v9.6H2.6z" />
                <circle cx="10" cy="10.8" r="3" />
              </svg>
            </span>
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.02em', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.name}</span>
            <span style={{ fontSize: 14, lineHeight: 1.35, color: '#98A0A8' }}>
              {[ROLE_LABEL[me.role], company || me.trade].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
      </div>

      {/* CONTACT. */}
      <div style={{ padding: '16px 18px 9px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>CONTACT</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', margin: '0 18px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, overflow: 'hidden' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, padding: '11px 15px' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '.05em', color: '#7B838B' }}>EMAIL</span>
            <span style={{ fontSize: 15.5, color: s.ink }}>{email || '—'}</span>
          </span>
        </span>
      </div>

      {/* Settings — the drawn rows, plus the personal surfaces they open. */}
      <div style={{ display: 'flex', flexDirection: 'column', margin: 18, background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, overflow: 'hidden' }}>
        {settingsRow('My hours', 'Every shift', { onTap: () => setShowHours(true) })}
        {settingsRow('Location while working', trackingOn ? 'On' : 'Off', { onTap: onOpenClock })}
        {settingsRow('Account & privacy', '', { onTap: onShowAccount })}
        {settingsRow('Sign out', '', { red: true, last: true, onTap: () => void supabase().auth.signOut() })}
      </div>
    </div>
  )
}
