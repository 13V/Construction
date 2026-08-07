import type { ReactNode } from 'react'
import { theme } from '../theme'
import type { JobSite } from '../types'
import { demoMode } from '../data/demo'
import type { NotificationRow } from '../data/supabase'

const NAV = [
  'Map',
  'Schedule',
  'Timesheets',
  'Job Sites',
  'Expenses',
  'Materials',
  'Daily Logs',
  'Chat',
  'Crew',
  'Estimates',
  'Purchase Orders',
  'Invoices',
  'Change Orders',
  'Safety',
  'Portals',
] as const

export type NavItem = (typeof NAV)[number]

/** Runtime copy of the nav list, for validating a stored nav name. */
export const NAV_ITEMS: readonly string[] = NAV

/** One row in the global search dropdown. */
export interface SearchHit {
  id: string
  label: string
  sub: string
  nav: NavItem
}


/** Icon paths from the reference design system, one per nav item. */
const ICONS: Record<NavItem, string> = {
  Map: 'M2 4.4L6 2.8l4 1.6 4-1.6v9L10 13.4l-4-1.6-4 1.6z|M6 2.8v9M10 4.4v9',
  Schedule: 'RECT|M2.2 6.6h11.6M5.4 2v2.6M10.6 2v2.6',
  Timesheets: 'CIRCLE|M8 4.4V8l2.7 1.7',
  'Job Sites': 'M2 4h4.2l1.4 1.7H14v8.1H2z',
  Expenses: 'M8 2.2v11.6|M10.7 5.2H6.9a1.9 1.9 0 000 3.7h2.3a1.9 1.9 0 010 3.8H5.3',
  'Daily Logs': 'M3.4 2.2h9.2v11.6H3.4z|M5.7 8.2h4.6M5.7 10.7h4.6M5.7 5.6h4.6',
  Chat: 'M2.4 3.4h11.2v7.4H7.2L4 13.4v-2.6H2.4z',
  Crew: 'M6 7.6a2.4 2.4 0 100-4.8 2.4 2.4 0 000 4.8|M1.8 13.4c0-2.3 1.9-3.6 4.2-3.6s4.2 1.3 4.2 3.6|M11 3.2a2.2 2.2 0 010 4.3M12.2 9.9c1.4.4 2.4 1.4 2.4 3.1',
  Materials: 'M2.2 5.4L8 2.6l5.8 2.8-5.8 2.8z|M2.2 8.2L8 11l5.8-2.8M2.2 11L8 13.8 13.8 11',
  Safety: 'M8 2.2l5 2v4c0 3-2.1 4.9-5 5.6-2.9-.7-5-2.6-5-5.6v-4z|M6 8.1l1.5 1.5L10.3 6.8',
  Estimates: 'M3.4 2.2h9.2v11.6H3.4z|M5.8 5.4h4.4M5.8 8h4.4M5.8 10.6h2.6',
  'Purchase Orders': 'M2.4 3.2h2l1.7 7.4h6.4l1.3-5.4H5.2|M6.8 13a.9.9 0 100-1.8.9.9 0 000 1.8M11.4 13a.9.9 0 100-1.8.9.9 0 000 1.8',
  Invoices: 'M3.6 2.2h8.8v11.6l-1.8-1.2-1.7 1.2-1.7-1.2-1.8 1.2z|M6 5.6h4M6 8.2h4',
  'Change Orders': 'M3 5.8a5.2 5.2 0 018.9-2.4M13 10.2a5.2 5.2 0 01-8.9 2.4|M11.6 2.2v3.4H8.2M4.4 13.8v-3.4h3.4',
  Portals: 'M8 2.1a5.9 5.9 0 100 11.8A5.9 5.9 0 008 2.1z|M2.1 8h11.8M8 2.1c1.6 1.7 2.4 3.7 2.4 5.9S9.6 12.2 8 13.9c-1.6-1.7-2.4-3.7-2.4-5.9S6.4 3.8 8 2.1z',
}

function NavIcon({ item }: { item: NavItem }) {
  const spec = ICONS[item]
  const parts = spec.split('|')
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      style={{ flex: 'none' }}
    >
      {parts.map((d, i) =>
        d === 'RECT' ? (
          <rect key={i} x="2.2" y="3.4" width="11.6" height="10.4" rx="1" />
        ) : d === 'CIRCLE' ? (
          <circle key={i} cx="8" cy="8" r="5.9" />
        ) : (
          <path key={i} d={d} strokeLinejoin="round" strokeLinecap="round" />
        ),
      )}
    </svg>
  )
}

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
  search,
  onSearch,
  results,
  onPickResult,
  notices,
  unread,
  onOpenNotices,
  noticesOpen,
  onPickNotice,
}: {
  toolbar?: ReactNode
  company: string
  userName: string
  onSignOut: () => void
  search: string
  onSearch: (q: string) => void
  results: SearchHit[]
  onPickResult: (hit: SearchHit) => void
  notices: NotificationRow[]
  unread: number
  onOpenNotices: () => void
  noticesOpen: boolean
  onPickNotice: (n: NotificationRow) => void
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
      {demoMode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            padding: '5px 14px',
            background: '#FFF6DF',
            borderBottom: `1px solid #F2D89A`,
            fontSize: 11.5,
            color: '#8A6100',
          }}
        >
          <strong>Demo mode</strong>
          <span>
            Anyone with this link is signed in as {userName}. Don't put real crew data here.
          </span>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          height: 46,
          padding: '0 14px',
          minWidth: 0,
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

        <div data-topbar="search" style={{ position: 'relative', flex: '0 1 320px' }}>
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search sites, crew, expenses, invoices"
            style={{
              width: '100%',
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
          {search.trim().length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 32,
                left: 0,
                right: 0,
                zIndex: 50,
                maxHeight: 340,
                overflowY: 'auto',
                background: theme.panel,
                border: `1px solid ${theme.border}`,
                borderRadius: 4,
                boxShadow: '0 6px 20px rgba(26,29,33,.16)',
              }}
            >
              {results.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 12.5, color: theme.inkFaint }}>
                  Nothing matches "{search.trim()}".
                </div>
              ) : (
                results.map((hit) => (
                  <button
                    key={`${hit.nav}-${hit.id}`}
                    onClick={() => onPickResult(hit)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      width: '100%',
                      padding: '8px 12px',
                      border: 'none',
                      borderBottom: `1px solid ${theme.borderSoft}`,
                      background: 'transparent',
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <NavIcon item={hit.nav} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>{hit.label}</span>
                      <span style={{ display: 'block', fontSize: 11, color: theme.inkFaint }}>{hit.sub}</span>
                    </span>
                    <span style={{ fontSize: 10.5, color: theme.inkFaint }}>{hit.nav}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

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
          <div style={{ position: 'relative' }}>
            <button
              onClick={onOpenNotices}
              title="Notices"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                border: `1px solid ${noticesOpen ? theme.accent : theme.border}`,
                borderRadius: 3,
                background: noticesOpen ? theme.accentFill : theme.panel,
                cursor: 'pointer',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={noticesOpen ? theme.accent : theme.ink} strokeWidth={1.3}>
                <path d="M4 6.6a4 4 0 018 0c0 3 1 4.2 1 4.2H3s1-1.2 1-4.2z" strokeLinejoin="round" />
                <path d="M6.6 13a1.6 1.6 0 002.8 0" strokeLinecap="round" />
              </svg>
              {unread > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    minWidth: 15,
                    height: 15,
                    padding: '0 4px',
                    borderRadius: 8,
                    background: theme.alert,
                    color: '#fff',
                    fontSize: 9.5,
                    fontWeight: 700,
                    lineHeight: '15px',
                    textAlign: 'center',
                  }}
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {noticesOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 34,
                  right: 0,
                  zIndex: 60,
                  width: 320,
                  maxHeight: 380,
                  overflowY: 'auto',
                  background: theme.panel,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 4,
                  boxShadow: '0 6px 20px rgba(26,29,33,.16)',
                }}
              >
                {notices.length === 0 ? (
                  <div style={{ padding: '14px 13px', fontSize: 12.5, color: theme.inkFaint }}>
                    Nothing yet. Rostering someone on, or deciding a leave request, tells them here.
                  </div>
                ) : (
                  notices.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => onPickNotice(n)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        width: '100%',
                        padding: '9px 13px',
                        border: 'none',
                        borderBottom: `1px solid ${theme.borderSoft}`,
                        borderLeft: `3px solid ${n.read_at ? 'transparent' : theme.accent}`,
                        background: n.read_at ? 'transparent' : theme.accentFill,
                        font: 'inherit',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{n.title}</span>
                      {n.body && <span style={{ fontSize: 11.5, color: theme.inkSoft }}>{n.body}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
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
      data-nav="sidebar"
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
            <NavIcon item={item} />
            <span data-nav-label>{item}</span>
          </button>
        )
      })}

      <div
        data-nav-sites
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
