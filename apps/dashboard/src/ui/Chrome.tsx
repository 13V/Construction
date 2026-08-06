import type { ReactNode } from 'react'
import { theme } from '../theme'
import type { JobSite } from '../types'

const NAV = [
  'Map',
  'Schedule',
  'Timesheets',
  'Job Sites',
  'Expenses',
  'Daily Logs',
  'Crew',
  'Equipment',
  'Safety',
] as const

export type NavItem = (typeof NAV)[number]

const btn = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 26,
  padding: '0 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: `inherit`,
  fontSize: 12,
  cursor: 'pointer',
} as const

export function TopBar({
  toolbar,
  company,
  userName,
  onSignOut,
}: {
  toolbar?: ReactNode
  company: string
  userName: string
  onSignOut: () => void
}) {
  const mark =
    company
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '··'

  return (
    <div style={{ flex: 'none', background: theme.panel }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          height: 46,
          padding: '0 14px',
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: theme.rail,
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            {mark}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{company || "Your company"}</span>
          <span style={{ color: theme.inkFaint, fontSize: 10 }}>▾</span>
        </div>

        <input
          placeholder="Search sites, crew, photos, files"
          style={{
            flex: '0 1 320px',
            height: 28,
            padding: '0 10px',
            borderRadius: 3,
            border: `1px solid ${theme.border}`,
            background: theme.appBg,
            font: 'inherit',
            fontSize: 12.5,
            color: theme.ink,
            outline: 'none',
          }}
        />

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 12.5,
            color: theme.inkSoft,
          }}
        >
          <span style={{ color: theme.ink, fontWeight: 500 }}>{userName}</span>
          <button
            onClick={onSignOut}
            style={{
              border: 'none',
              background: 'none',
              color: theme.accent,
              font: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 40,
          padding: '0 14px',
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        {toolbar}
      </div>
    </div>
  )
}

export function ToolbarButton({
  children,
  onClick,
  active,
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...btn,
        borderColor: active ? theme.accent : theme.border,
        background: active ? theme.accentFill : theme.panel,
        color: active ? theme.accent : theme.ink,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  )
}

export function Sidebar({
  active,
  sites,
  onNavigate,
}: {
  active: NavItem
  sites: JobSite[]
  onNavigate: (item: NavItem) => void
}) {
  return (
    <nav
      style={{
        flex: 'none',
        width: 190,
        background: theme.panel,
        borderRight: `1px solid ${theme.border}`,
        padding: '8px 0',
        overflowY: 'auto',
      }}
    >
      {NAV.map((item) => {
        const on = item === active
        return (
          <button
            key={item}
            onClick={() => onNavigate(item)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              width: '100%',
              height: 30,
              padding: '0 14px',
              border: 'none',
              background: on ? theme.accentFill : 'transparent',
              color: on ? theme.accent : theme.ink,
              fontWeight: on ? 600 : 400,
              font: 'inherit',
              fontSize: 13,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {item}
          </button>
        )
      })}

      <div
        style={{
          margin: '10px 14px 6px',
          paddingTop: 10,
          borderTop: `1px solid ${theme.border}`,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '.12em',
          color: theme.inkFaint,
        }}
      >
        JOB SITES
      </div>
      {sites.map((site) => (
        <div
          key={site.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 26,
            padding: '0 14px',
            fontSize: 12.5,
            color: theme.inkSoft,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: site.status === 'active' ? theme.success : theme.inkFaint,
            }}
          />
          {site.name}
        </div>
      ))}
    </nav>
  )
}
