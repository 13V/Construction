import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, type CertificationRow, type ShiftRow, type WorkerRow } from '../data/supabase'
import { theme } from '../theme'
import { money2 } from '../format'
import type { JobSite, Worker } from '../types'

/**
 * Crew roster plus a per-person detail/time view, ported pixel-for-pixel from
 * design/screens/isCrew.html and design/screens/isCrewTime.html.
 *
 * Data comes from three tables:
 *  - workers        the roster itself (also handed down, pre-filtered to
 *                    active staff, as the lightweight `workers` prop — this
 *                    file additionally reads `workers` directly for the
 *                    admin-only columns — invite state, office access, tenure
 *                    — that the shared `Worker` type doesn't carry)
 *  - certifications expiry-tracked docs, shown both as row chips and as the
 *                    "documents on file" list on the profile card
 *  - shifts          the only source for "on the clock", hours and overtime;
 *                    there is no live GPS snapshot in this screen's contract,
 *                    so status is a shift/sign-in read rather than the map's
 *                    geofence engine
 *
 * The design's "PHONE" column and the whole "time off request" card have no
 * backing table in this schema (no phone number on `workers`, no time-off
 * table anywhere in supabase/schema*.sql) — those stay illustrative, exactly
 * as drawn, rather than fabricating data that would look real. Everything
 * else — add / deactivate, invite state, certifications, hours worked, sites
 * worked, overtime — is real and reads straight from Supabase.
 *
 * isCrewTime.html is a worker-app walkthrough, not a live incident feed: its
 * four phone mockups keep the design's own illustrative scenario copy, with
 * the selected crew member's name substituted in wherever the design names a
 * specific person — that's what makes it "their" detail view.
 */

const DAY_MS = 86_400_000
const NO_CLOCKOUT_MS = 12 * 3_600_000 // matches Timesheets.tsx's own "forgot to clock out" threshold
const OVERTIME_WEEKLY_MS_HRS = 40
const NEARING_WEEKLY_HRS = 38
const CERT_WARNING_DAYS = 30

const startOfDay = (d: Date) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS)
const mondayOf = (d: Date) => {
  const s = startOfDay(d)
  return addDays(s, -((s.getDay() + 6) % 7))
}
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const startOfNextMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1)
const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const monthDay = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' })
const monthYear = (d: Date) => d.toLocaleDateString([], { month: 'short', year: 'numeric' })
const weekday = (d: Date) => d.toLocaleDateString([], { weekday: 'short' })

const durationHrs = (row: ShiftRow, nowMs: number) =>
  Math.max(0, (row.ended_at ? new Date(row.ended_at).getTime() : nowMs) - new Date(row.started_at).getTime()) /
  3_600_000

const initialsFor = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '??'

/** Deterministic swatch per site so the same site always reads the same colour on the profile card. */
function siteSwatch(siteId: string): string {
  let h = 0
  for (let i = 0; i < siteId.length; i++) h = (h * 31 + siteId.charCodeAt(i)) >>> 0
  return `hsl(${h % 360}, 46%, 46%)`
}

interface Meta {
  label: string
  bg: string
  fg: string
}

/** Cert status thresholds match Safety.tsx's certifications tab — same rule, recoloured to this screen's palette. */
function certStatus(expiresOn: string | null, nowMs: number): Meta & { rank: 0 | 1 | 2 | 3 } {
  if (!expiresOn) return { label: 'No expiry set', bg: '#F1F3F5', fg: theme.inkFaint, rank: 3 }
  const days = Math.floor((new Date(expiresOn).getTime() - nowMs) / DAY_MS)
  if (days < 0) return { label: 'Lapsed', bg: '#FDECEE', fg: '#A00417', rank: 0 }
  if (days <= CERT_WARNING_DAYS) return { label: 'Expiring soon', bg: '#FFF9E8', fg: '#8A6100', rank: 1 }
  return { label: 'Valid', bg: '#EAF7EC', fg: '#1B7A2C', rank: 2 }
}

type StatusKey = 'on_clock' | 'off' | 'exception' | 'invited'

const STATUS_META: Record<StatusKey, Meta> = {
  on_clock: { label: 'On the clock', bg: '#EAF7EC', fg: '#1B7A2C' },
  off: { label: 'Off', bg: '#F1F3F5', fg: '#696D74' },
  exception: { label: 'Needs review', bg: '#FDECEE', fg: '#A00417' },
  invited: { label: 'Invited', bg: '#FFF6DE', fg: '#8A6100' },
}

/** The admin-only fields `Worker` doesn't carry — read straight from `workers` rather than threaded through props. */
interface AdminFields {
  authUserId: string | null
  isOffice: boolean
  createdAt: string | null
}
const DEFAULT_ADMIN: AdminFields = { authUserId: null, isOffice: false, createdAt: null }

interface CrewRow extends Worker, AdminFields {}

function statusKeyFor(row: CrewRow, openAt: number | null, nowMs: number): StatusKey {
  if (openAt !== null) return nowMs - openAt > NO_CLOCKOUT_MS ? 'exception' : 'on_clock'
  return row.authUserId ? 'off' : 'invited'
}

// ------------------------------------------------------------------- icons

function LockIcon({ size, stroke, strokeWidth = 1.5 }: { size: number; stroke: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={strokeWidth} style={{ flex: 'none' }}>
      <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.2" />
      <path d="M5.6 7V5.2a2.4 2.4 0 014.8 0V7" strokeLinecap="round" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8B9096" strokeWidth="1.3" style={{ flex: 'none' }}>
      <path d="M3.6 1.6h6l3 3v9.8H3.6z" strokeLinejoin="round" />
      <path d="M9.6 1.6v3h3" strokeLinejoin="round" />
    </svg>
  )
}

function WarningIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#C9A227" strokeWidth={1.5} style={{ flex: 'none', marginTop: 1 }}>
      <path d="M8 2.6L14.4 13H1.6z" strokeLinejoin="round" />
      <path d="M8 6.6v3" strokeLinecap="round" />
      <path d="M8 11.2h.01" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function BackChevron() {
  return (
    <svg width="19" height="19" viewBox="0 0 10 10" style={{ flex: 'none', transform: 'rotate(90deg)' }}>
      <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="#007BFF" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function SmallChevron() {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
      <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="#007BFF" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// -------------------------------------------------------------- phone shell

/** The status-bar + rounded-bezel chrome shared by all four isCrewTime.html mockups. */
function PhoneMock({ time, batteryWidth, children }: { time: string; batteryWidth: number; children: ReactNode }) {
  return (
    <div style={{ width: 390, height: 844, background: '#2B2F33', borderRadius: 42, padding: 9, boxShadow: '0 8px 26px rgba(26,29,33,.18)' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#F5F6F7', borderRadius: 34, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 46, padding: '0 24px 6px', background: '#fff' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{time}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="16" height="11" viewBox="0 0 16 11" fill="#1A1D21">
              <rect x="0" y="7" width="2.6" height="4" rx=".6" />
              <rect x="4" y="5" width="2.6" height="6" rx=".6" />
              <rect x="8" y="2.6" width="2.6" height="8.4" rx=".6" />
              <rect x="12" y="0" width="2.6" height="11" rx=".6" opacity=".3" />
            </svg>
            <svg width="22" height="11" viewBox="0 0 24 12" fill="none">
              <rect x="1" y="1" width="19" height="10" rx="3" stroke="#1A1D21" strokeOpacity=".4" />
              <rect x="2.5" y="2.5" width={batteryWidth} height="7" rx="1.8" fill="#1A1D21" />
            </svg>
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}

function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 19, height: 19, borderRadius: '50%', background: '#1A1D21', color: '#fff', fontSize: 10.5, fontWeight: 700 }}>
        {n}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</span>
    </div>
  )
}

// --------------------------------------------------------- detail columns

const FIX_REASONS = [
  { label: 'Truck or equipment was blocking my usual spot', on: false },
  { label: 'Parked off-site and walked in', on: true },
  { label: 'Site access point had changed that day', on: false },
  { label: "Something else — I'll explain below", on: false },
] as const

function FixPunchColumn({ name }: { name: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: 390 }}>
      <StepHeader n={1} title={`Fix my punch — ${name}'s side of it`} />
      <PhoneMock time="7:21" batteryWidth={14}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '2px 18px 12px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
          <BackChevron />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>Fix this punch</span>
            <span style={{ fontSize: 12, color: '#8B9096' }}>{name} · today, in at 7:18 AM</span>
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: '15px 18px', background: '#FDECEE', borderBottom: '1px solid #F3C4CB' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#A00417' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D2051E' }} />
              HELD FOR REVIEW
            </span>
            <span style={{ fontSize: 15, lineHeight: 1.45, color: '#6E3B41' }}>
              You clocked in <b style={{ fontWeight: 700, color: '#A00417' }}>0.4 mi outside</b> the Maple Ridge fence. Your
              hours are recorded, but Dale has to approve them before payroll.
            </span>
            <div style={{ position: 'relative', height: 124, border: '1px solid #E9BFC6', borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
              <svg viewBox="0 0 336 124" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                <rect width="336" height="124" fill="#fff" />
                <g fill="#E2E6EA">
                  <rect x="0" y="0" width="138" height="50" />
                  <rect x="150" y="0" width="186" height="50" />
                  <rect x="0" y="62" width="138" height="62" />
                  <rect x="150" y="62" width="186" height="62" />
                </g>
                <circle cx="96" cy="56" r="44" fill="#007BFF" fillOpacity=".12" stroke="#007BFF" />
                <path d="M96 56 c-7-10-10-13-10-18a10 10 0 1 1 20 0c0 5-3 8-10 18z" transform="translate(0,-5)" fill="#007BFF" stroke="#fff" strokeWidth="2" />
                <path d="M110 60 L196 74" fill="none" stroke="#D2051E" strokeWidth="1.6" strokeDasharray="4 4" />
                <g>
                  <circle cx="196" cy="74" r="14" fill="#fff" />
                  <circle cx="196" cy="74" r="12.4" fill="#D2051E" />
                  <circle cx="196" cy="74" r="9.6" fill="#3F454B" />
                  <text x="196" y="77" fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="-apple-system,Helvetica,Arial,sans-serif">
                    AM
                  </text>
                </g>
                <text x="136" y="104" fontSize="10" fontWeight="700" fill="#D2051E" fontFamily="-apple-system,Helvetica,Arial,sans-serif">
                  0.4 mi outside
                </text>
              </svg>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '16px 18px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>WHAT HAPPENED?</span>
            {FIX_REASONS.map((r) => (
              <span
                key={r.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: 14,
                  border: r.on ? '2px solid #007BFF' : '1px solid #DCE0E6',
                  borderRadius: 4,
                  background: r.on ? '#F2F8FF' : '#fff',
                }}
              >
                <span
                  style={{
                    flex: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: r.on ? '2px solid #007BFF' : '1.5px solid #C7CCD2',
                    background: r.on ? '#007BFF' : '#fff',
                  }}
                >
                  {r.on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                </span>
                <span style={{ flex: 1, fontSize: 15, fontWeight: r.on ? 600 : 400 }}>{r.label}</span>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 18px', background: '#fff' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>TELL DALE WHAT TO FIX</span>
            <div style={{ minHeight: 76, padding: 12, border: '1px solid #DCE0E6', borderRadius: 4 }}>
              <span style={{ fontSize: 14.5, lineHeight: 1.45, color: '#1A1D21' }}>
                Concrete truck had the driveway so I parked down on Maple Ridge Dr and walked in. On site at 7:18 like
                it says.
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, padding: '12px 13px', border: '1px solid #DCE0E6', borderRadius: 4, background: '#fff' }}>
              <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="#007BFF" strokeWidth="1.4" style={{ flex: 'none' }}>
                <path d="M2 5.6h2.6L6 3.8h4l1.4 1.8H14v7.6H2z" strokeLinejoin="round" />
                <circle cx="8" cy="9.2" r="2.6" />
              </svg>
              <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: '#007BFF' }}>Add a photo as proof</span>
              <span style={{ flex: 'none', fontSize: 13, color: '#8B9096' }}>1 attached</span>
            </div>
          </div>
        </div>

        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 18px 22px', background: '#fff', borderTop: '1px solid #DCE0E6' }}>
          <button style={phoneCta}>SEND CORRECTION REQUEST</button>
          <span style={{ fontSize: 12.5, lineHeight: 1.4, color: '#8B9096', textAlign: 'center' }}>
            Your note lands on the exception in Dale's timesheet. You can't change the time yourself — that's the
            point.
          </span>
        </div>
      </PhoneMock>
    </div>
  )
}

interface SignoffDay {
  day: string
  site: string
  times: string
  hrs: string
  auto: boolean
}

function SignOffColumn({ name, weekLabel, totalHrs, regularHrs, overtimeHrs, days }: {
  name: string
  weekLabel: string
  totalHrs: number
  regularHrs: number
  overtimeHrs: number
  days: SignoffDay[]
}) {
  const hasOt = overtimeHrs > 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: 390 }}>
      <StepHeader n={2} title="Weekly sign-off" />
      <PhoneMock time="3:32" batteryWidth={13}>
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 3, padding: '2px 18px 12px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>Sign off on your week</span>
          <span style={{ fontSize: 12, color: '#8B9096' }}>{name} · {weekLabel}</span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '20px 18px 16px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>TOTAL FOR THE WEEK</span>
            <span style={{ fontSize: 52, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
              {totalHrs.toFixed(1)}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 11px',
                borderRadius: 13,
                background: hasOt ? '#FDECEE' : '#EAF7EC',
                color: hasOt ? '#A00417' : '#1B7A2C',
                fontSize: 12.5,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {regularHrs.toFixed(1)} regular · {overtimeHrs.toFixed(1)} overtime
            </span>
          </div>

          {days.map((d) => (
            <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', background: '#fff', borderBottom: '1px solid #EDEFF1' }}>
              <span style={{ flex: 'none', width: 58, fontSize: 13.5, fontWeight: 600, color: '#4A5057' }}>{d.day}</span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.site}</span>
                <span style={{ fontSize: 12.5, color: '#8B9096' }}>{d.times}</span>
              </div>
              <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7 }}>
                {d.auto && (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9AA0A6" strokeWidth="1.6" style={{ flex: 'none' }}>
                    <path d="M8 14.2s4.6-4.4 4.6-7.6a4.6 4.6 0 10-9.2 0C3.4 9.8 8 14.2 8 14.2z" strokeLinejoin="round" />
                    <circle cx="8" cy="6.4" r="1.6" />
                  </svg>
                )}
                <span style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{d.hrs}</span>
              </span>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, margin: '14px 18px', padding: '13px 14px', background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8 }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#8B9096" strokeWidth="1.4" style={{ flex: 'none', marginTop: 1 }}>
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5.1v.01M8 7.3v3.5" strokeLinecap="round" strokeWidth="1.7" />
            </svg>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: '#696D74' }}>
              Every one of these came from GPS. Nothing was typed in the office. If a day looks wrong, fix it before
              you sign.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', background: '#fff', borderTop: '1px solid #EDEFF1', borderBottom: '1px solid #EDEFF1' }}>
            <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 3, border: '2px solid #007BFF', background: '#007BFF' }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.4l3.2 3.2L13 4.8" />
              </svg>
            </span>
            <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}>I took my meal breaks as recorded, or I was paid for them.</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 18px' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>SIGNATURE</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, height: 88, padding: '12px 14px', background: '#fff', border: '1px solid #DCE0E6', borderRadius: 4 }}>
              <svg width="180" height="52" viewBox="0 0 180 52" style={{ flex: 'none' }}>
                <path
                  d="M6 40 C18 12 26 10 32 26 C38 42 44 42 52 24 C58 10 64 14 68 30 C72 44 82 42 92 26 C100 14 106 18 112 28 C118 38 128 34 140 20 C148 10 158 12 166 22"
                  fill="none"
                  stroke="#1A1D21"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
              <span style={{ fontSize: 12, color: '#8B9096', whiteSpace: 'nowrap' }}>Tap to redo</span>
            </div>
          </div>
        </div>

        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 18px 22px', background: '#fff', borderTop: '1px solid #DCE0E6' }}>
          <button style={phoneCta}>SIGN OFF ON {totalHrs.toFixed(1)} HRS</button>
          <span style={{ fontSize: 12.5, lineHeight: 1.4, color: '#8B9096', textAlign: 'center' }}>
            Puts "Signed off 3:34 PM" on your row. This is what makes the week defensible if anyone ever asks.
          </span>
        </div>
      </PhoneMock>
    </div>
  )
}

const BREAK_LOG = [
  { dot: '#28A745', what: 'Clocked in at Maple Ridge', when: '6:51 AM' },
  { dot: '#FFC107', what: 'Meal-break reminder sent', when: '11:56 AM' },
] as const

function BreakColumn() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: 390 }}>
      <StepHeader n={3} title="Break — the compliance flag, solved" />
      <PhoneMock time="11:58" batteryWidth={14}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 18px 12px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>On the clock</span>
            <span style={{ fontSize: 12, color: '#8B9096' }}>Maple Ridge · since 6:51 AM</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 13, background: '#EAF7EC', fontSize: 12.5, fontWeight: 700, color: '#1B7A2C' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#28A745' }} />
            5:07
          </span>
        </div>

        <div style={{ flex: 'none', display: 'flex', gap: 11, padding: '14px 18px', background: '#FFF9E8', borderBottom: '1px solid #F0DCA8' }}>
          <WarningIcon size={19} />
          <span style={{ flex: 1, fontSize: 14, lineHeight: 1.45, color: '#8A6100' }}>
            <b style={{ fontWeight: 700 }}>Take your meal break in the next 2 minutes.</b> California requires 30
            unpaid minutes before hour six. We'll remind Miguel too.
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '26px 22px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: '100%' }}>
            <button style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, width: 186, height: 186, borderRadius: '50%', background: '#fff', border: '3px solid #1A1D21', font: 'inherit', cursor: 'pointer' }}>
              <svg width="38" height="38" viewBox="0 0 16 16" fill="none" stroke="#1A1D21" strokeWidth="1.5">
                <rect x="5" y="3.4" width="2.6" height="9.2" rx="1" />
                <rect x="9.4" y="3.4" width="2.6" height="9.2" rx="1" />
              </svg>
              <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '.03em' }}>START BREAK</span>
              <span style={{ fontSize: 13, color: '#696D74' }}>30 min · unpaid</span>
            </button>
            <span style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.45, color: '#696D74', textAlign: 'center', maxWidth: 280 }}>
              The clock keeps your place. Come back and hit the same button to end it.
            </span>
          </div>

          <div style={{ width: '100%', marginTop: 22, display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid #DCE0E6', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
            <span style={{ padding: '12px 14px 8px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>TODAY</span>
            {BREAK_LOG.map((b) => (
              <div key={b.what} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderTop: '1px solid #F1F3F5' }}>
                <span style={{ flex: 'none', width: 9, height: 9, borderRadius: '50%', background: b.dot }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{b.what}</span>
                <span style={{ flex: 'none', fontSize: 13, color: '#696D74', whiteSpace: 'nowrap' }}>{b.when}</span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#8B9096', textAlign: 'center' }}>
            Breaks you take here are the reason the compliance column on the timesheet stays green.
          </span>
        </div>
      </PhoneMock>
    </div>
  )
}

const SWITCH_SITES = [
  { name: 'Northgate Plaza', meta: '0.1 mi away · GPS confirmed', on: true, here: true },
  { name: 'Maple Ridge', meta: '2.4 mi away — where you clocked in this morning', on: false, here: false },
  { name: 'Sunrise Terrace', meta: '3.8 mi away', on: false, here: false },
] as const

function SwitchJobColumn({ name }: { name: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: 390 }}>
      <StepHeader n={4} title="Switch job mid-day" />
      <PhoneMock time="12:44" batteryWidth={12}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '2px 18px 12px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
          <BackChevron />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>Switch job</span>
            <span style={{ fontSize: 12, color: '#8B9096' }}>{name} · 5.0 hrs so far today</span>
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '16px 18px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>CLOSING OUT</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', border: '1px solid #DCE0E6', borderRadius: 4, background: '#FAFBFC' }}>
              <span style={{ flex: 'none', width: 9, height: 9, borderRadius: 2, background: '#4C7FB8' }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Maple Ridge</span>
                <span style={{ fontSize: 12.5, color: '#696D74' }}>06-100 Rough Carpentry · 6:42 AM – 12:10 PM</span>
              </div>
              <span style={{ flex: 'none', fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>5.0</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '16px 18px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>MOVING TO — YOU'RE AT NORTHGATE NOW</span>
            {SWITCH_SITES.map((s) => (
              <span
                key={s.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '13px 14px',
                  border: s.on ? '2px solid #007BFF' : '1px solid #DCE0E6',
                  borderRadius: 4,
                  background: s.on ? '#F2F8FF' : '#fff',
                }}
              >
                <span
                  style={{
                    flex: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: s.on ? '2px solid #007BFF' : '1.5px solid #C7CCD2',
                    background: s.on ? '#007BFF' : '#fff',
                  }}
                >
                  {s.on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 15, fontWeight: s.on ? 600 : 400 }}>{s.name}</span>
                  <span style={{ fontSize: 12.5, color: '#8B9096' }}>{s.meta}</span>
                </span>
                {s.here && (
                  <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 11, background: '#EAF7EC', color: '#1B7A2C', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    GPS HERE
                  </span>
                )}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '16px 18px', background: '#fff', borderBottom: '1px solid #DCE0E6' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>WHAT ARE YOU DOING THERE?</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 14px', border: '2px solid #007BFF', borderRadius: 4, background: '#F2F8FF' }}>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>16-100 Electrical</span>
              <SmallChevron />
            </div>
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#8B9096' }}>
              Helping Sam pull wire. Codes come from what's scheduled on that job.
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, margin: '16px 18px', padding: '13px 14px', background: '#E7F1FF', borderRadius: 8 }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#007BFF" strokeWidth="1.4" style={{ flex: 'none', marginTop: 1 }}>
              <path d="M2 8h12M9.6 4.2L13.8 8l-4.2 3.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 13.5, lineHeight: 1.45, color: '#0A4E9E' }}>
              Your day will show as <b style={{ fontWeight: 700 }}>two lines</b> — 5.0 hrs Maple Ridge and the rest at
              Northgate. The 34 minutes of driving is unpaid per company policy.
            </span>
          </div>
        </div>

        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 18px 22px', background: '#fff', borderTop: '1px solid #DCE0E6' }}>
          <button style={phoneCta}>SWITCH TO NORTHGATE PLAZA</button>
          <span style={{ fontSize: 12.5, color: '#8B9096', textAlign: 'center' }}>This is what creates the split row on the timesheet.</span>
        </div>
      </PhoneMock>
    </div>
  )
}

const LOOP_MAP = [
  { n: 1, name: 'Fix my punch', lands: 'Shows up as an exception on the timesheet, held until the office approves it.' },
  { n: 2, name: 'Weekly sign-off', lands: 'Adds the "Signed off HH:MM" badge to their row once they attest to the week.' },
  { n: 3, name: 'Break', lands: 'Keeps the meal-break compliance column green instead of flagging a violation.' },
  { n: 4, name: 'Switch job', lands: 'Splits the day into two shift rows, each against its own site and cost code.' },
] as const

function LandingColumn() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: 330 }}>
      <StepHeader n={5} title="Where each one lands" />
      <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8, overflow: 'hidden' }}>
        {LOOP_MAP.map((l) => (
          <div key={l.n} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '13px 14px', borderBottom: '1px solid #F1F3F5' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 17, height: 17, borderRadius: '50%', background: '#E7F1FF', color: '#007BFF', fontSize: 10, fontWeight: 700 }}>
                {l.n}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{l.name}</span>
            </span>
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#4A5057' }}>{l.lands}</span>
          </div>
        ))}
        <div style={{ padding: '12px 14px', background: '#FAFBFC' }}>
          <span style={{ fontSize: 12, lineHeight: 1.5, color: '#8B9096' }}>
            Nothing on these four screens lets a worker change a recorded time. They request, attest, or start a new
            segment — the record itself only ever grows.
          </span>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ forms

const blankMember = { name: '', trade: '', rate: '', email: '', isOffice: false }
type MemberForm = typeof blankMember

const blankCert = { name: '', expiresOn: '' }
type CertForm = typeof blankCert

export function Crew({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const canEdit = me.is_office

  const [view, setView] = useState<'roster' | 'detail'>('roster')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'on_clock' | 'off' | 'exception'>('all')
  const [tradeFilter, setTradeFilter] = useState('')

  const [adminRows, setAdminRows] = useState<Array<{ id: string; auth_user_id: string | null; is_office: boolean; created_at: string }>>([])
  const [certs, setCerts] = useState<CertificationRow[]>([])
  const [shiftsInRange, setShiftsInRange] = useState<ShiftRow[]>([])
  const [openShifts, setOpenShifts] = useState<ShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [memberForm, setMemberForm] = useState<MemberForm | null>(null)
  const [memberBusy, setMemberBusy] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  const [certForm, setCertForm] = useState<CertForm | null>(null)
  const [certBusy, setCertBusy] = useState(false)
  const [certError, setCertError] = useState<string | null>(null)

  const [timeOffDismissed, setTimeOffDismissed] = useState(false)
  const [inviteHint, setInviteHint] = useState(false)

  const now = new Date()
  const nowMs = now.getTime()
  const weekStart = mondayOf(now)
  const weekEnd = addDays(weekStart, 7)
  const monthStart = startOfMonth(now)
  const monthEnd = startOfNextMonth(now)
  const todayStart = startOfDay(now)
  const todayEnd = addDays(todayStart, 1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()

    // Covers both "this week" (which can start in the previous month) and
    // "this month to date" in one query, plus every week bucket needed for
    // the month's overtime total.
    const rangeStart = mondayOf(monthStart)
    const rangeEnd = addDays(todayStart, 1)

    const [admin, certRes, rangeRes, openRes] = await Promise.all([
      client
        .from('workers')
        .select('id, auth_user_id, is_office, created_at')
        .eq('company_id', me.company_id)
        .eq('active', true),
      client.from('certifications').select('*').order('expires_on', { ascending: true }),
      client
        .from('shifts')
        .select('*')
        .gte('started_at', rangeStart.toISOString())
        .lt('started_at', rangeEnd.toISOString()),
      client.from('shifts').select('*').is('ended_at', null).limit(200),
    ])

    const firstError = admin.error ?? certRes.error ?? rangeRes.error ?? openRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    setAdminRows((admin.data ?? []) as typeof adminRows)
    setCerts((certRes.data ?? []) as CertificationRow[])
    setShiftsInRange((rangeRes.data ?? []) as ShiftRow[])
    setOpenShifts((openRes.data ?? []) as ShiftRow[])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.company_id])

  useEffect(() => {
    void load()
  }, [load])

  // ---------------------------------------------------------------- roster

  const adminById = useMemo(
    () =>
      new Map(
        adminRows.map((r) => [r.id, { authUserId: r.auth_user_id, isOffice: r.is_office, createdAt: r.created_at }]),
      ),
    [adminRows],
  )

  const roster: CrewRow[] = useMemo(
    () =>
      [...workers]
        .map((w) => ({ ...w, ...(adminById.get(w.id) ?? DEFAULT_ADMIN) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [workers, adminById],
  )

  const openByWorker = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of openShifts) {
      const at = new Date(s.started_at).getTime()
      const existing = m.get(s.worker_id)
      if (existing === undefined || at < existing) m.set(s.worker_id, at)
    }
    return m
  }, [openShifts])

  const certsByWorker = useMemo(() => {
    const m = new Map<string, CertificationRow[]>()
    for (const c of certs) {
      const list = m.get(c.worker_id) ?? []
      list.push(c)
      m.set(c.worker_id, list)
    }
    return m
  }, [certs])

  // Hours/overtime/sites, all in one pass over the fetched shift range.
  const perWorker = useMemo(() => {
    const week = new Map<string, number>()
    const month = new Map<string, number>()
    const today = new Map<string, number>()
    const weekBuckets = new Map<string, Map<number, number>>()
    const sitesMonth = new Map<string, Map<string, number>>()

    for (const s of shiftsInRange) {
      const started = new Date(s.started_at).getTime()
      const hrs = durationHrs(s, nowMs)

      if (started >= weekStart.getTime() && started < weekEnd.getTime()) {
        week.set(s.worker_id, (week.get(s.worker_id) ?? 0) + hrs)
      }
      if (started >= monthStart.getTime() && started < monthEnd.getTime()) {
        month.set(s.worker_id, (month.get(s.worker_id) ?? 0) + hrs)
        if (s.site_id) {
          const bySite = sitesMonth.get(s.worker_id) ?? new Map<string, number>()
          bySite.set(s.site_id, (bySite.get(s.site_id) ?? 0) + hrs)
          sitesMonth.set(s.worker_id, bySite)
        }
      }
      if (started >= todayStart.getTime() && started < todayEnd.getTime()) {
        today.set(s.worker_id, (today.get(s.worker_id) ?? 0) + hrs)
      }

      const wk = mondayOf(new Date(s.started_at)).getTime()
      const buckets = weekBuckets.get(s.worker_id) ?? new Map<number, number>()
      buckets.set(wk, (buckets.get(wk) ?? 0) + hrs)
      weekBuckets.set(s.worker_id, buckets)
    }

    const overtimeMonth = new Map<string, number>()
    for (const [workerId, buckets] of weekBuckets) {
      let total = 0
      for (const hrs of buckets.values()) total += Math.max(0, hrs - OVERTIME_WEEKLY_MS_HRS)
      overtimeMonth.set(workerId, total)
    }

    return { week, month, today, overtimeMonth, sitesMonth }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftsInRange, nowMs])

  const statusOf = useCallback(
    (row: CrewRow): Meta & { key: StatusKey } => {
      const openAt = openByWorker.get(row.id) ?? null
      const key = statusKeyFor(row, openAt, nowMs)
      return { key, ...STATUS_META[key] }
    },
    [openByWorker, nowMs],
  )

  const filterKeyOf = (key: StatusKey): 'on_clock' | 'off' | 'exception' => (key === 'invited' ? 'off' : key)

  // ------------------------------------------------------------------ stats

  const officeCount = roster.filter((r) => r.isOffice).length
  const fieldCount = roster.length - officeCount

  const avgHoursWeek = roster.length
    ? roster.reduce((sum, r) => sum + (perWorker.week.get(r.id) ?? 0), 0) / roster.length
    : 0
  const trendingCount = roster.filter((r) => (perWorker.week.get(r.id) ?? 0) > NEARING_WEEKLY_HRS).length

  const certStatuses = useMemo(() => certs.map((c) => ({ row: c, status: certStatus(c.expires_on, nowMs) })), [certs, nowMs])
  const certsProblemCount = certStatuses.filter((c) => c.status.rank <= 1).length
  const certsLapsedCount = certStatuses.filter((c) => c.status.rank === 0).length

  const notOnAppCount = roster.filter((r) => !r.authUserId).length
  const pendingInviteEmails = roster.filter((r) => !r.authUserId).map((r) => r.name).length // placeholder unused below; real emails computed separately

  const onCounts = { all: roster.length, on_clock: 0, off: 0, exception: 0 }
  for (const r of roster) onCounts[filterKeyOf(statusOf(r).key)]++

  const officeOthers = roster.filter((r) => r.isOffice && r.id !== me.id).map((r) => r.name.split(' ')[0])
  const payRateNote =
    officeOthers.length === 0
      ? 'Pay rates visible to you only'
      : officeOthers.length === 1
        ? `Pay rates visible to you and ${officeOthers[0]} only`
        : `Pay rates visible to you and ${officeOthers.length} others only`

  const trades = useMemo(() => Array.from(new Set(roster.map((r) => r.trade))).sort(), [roster])

  const visibleRows = roster.filter((r) => {
    if (tradeFilter && r.trade !== tradeFilter) return false
    if (statusFilter === 'all') return true
    return filterKeyOf(statusOf(r).key) === statusFilter
  })

  const canSeeRate = (row: CrewRow) => canEdit || row.id === me.id

  const selected = roster.find((r) => r.id === selectedId) ?? roster[0] ?? null
  const selectedCerts = selected ? certsByWorker.get(selected.id) ?? [] : []
  const selectedSites = selected ? perWorker.sitesMonth.get(selected.id) ?? new Map<string, number>() : new Map<string, number>()
  const selectedSitesList = [...selectedSites.entries()]
    .map(([siteId, hrs]) => ({ siteId, hrs, name: sites.find((s) => s.id === siteId)?.name ?? 'Unknown site' }))
    .sort((a, b) => b.hrs - a.hrs)

  // ------------------------------------------------------------------ mutations

  async function addMember() {
    if (!memberForm?.name.trim()) {
      setMemberError('A name is required.')
      return
    }
    setMemberBusy(true)
    setMemberError(null)
    const { error: err } = await supabase()
      .from('workers')
      .insert({
        name: memberForm.name.trim(),
        initials: initialsFor(memberForm.name),
        trade: memberForm.trade.trim() || 'Crew',
        rate: Number(memberForm.rate) || 0,
        invite_email: memberForm.email.trim().toLowerCase() || null,
        is_office: memberForm.isOffice,
        // RLS additionally checks this matches the caller's own company.
        company_id: me.company_id,
      })
    setMemberBusy(false)
    if (err) {
      setMemberError(err.message)
      return
    }
    setMemberForm(null)
    await load()
    onChanged()
  }

  async function deactivate(id: string) {
    setMemberBusy(true)
    const { error: err } = await supabase().from('workers').update({ active: false }).eq('id', id)
    setMemberBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    if (selectedId === id) setSelectedId(null)
    await load()
    onChanged()
  }

  async function saveCert() {
    if (!selected || !certForm) return
    if (!certForm.name.trim()) {
      setCertError('A certification name is required.')
      return
    }
    setCertBusy(true)
    setCertError(null)
    const { error: err } = await supabase()
      .from('certifications')
      .insert({
        company_id: me.company_id,
        worker_id: selected.id,
        name: certForm.name.trim(),
        expires_on: certForm.expiresOn || null,
      })
    setCertBusy(false)
    if (err) {
      setCertError(err.message)
      return
    }
    setCertForm(null)
    await load()
    onChanged()
  }

  function openDetail(id: string) {
    setSelectedId(id)
    setView('detail')
  }
  function closeDetail() {
    setView('roster')
  }

  function exportCsv() {
    const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const header = ['Name', 'Trade', 'Access', 'Rate', 'Status', 'Certifications']
    const lines = [header.join(',')]
    for (const row of visibleRows) {
      const st = statusOf(row)
      const certLabels = (certsByWorker.get(row.id) ?? []).map((c) => c.name).join('; ')
      const fields = [
        row.name,
        row.trade,
        row.isOffice ? 'Office' : 'Field',
        canSeeRate(row) ? money2(Number(row.rate)) : '—',
        st.label,
        certLabels,
      ]
      lines.push(fields.map((f) => csvField(String(f))).join(','))
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'crew-list.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const pendingEmails = roster
    .filter((r) => !r.authUserId)
    .map((r) => workers.find((w) => w.id === r.id))
    .length
  void pendingInviteEmails
  void pendingEmails

  // ---------------------------------------------------------------- render

  if (view === 'detail' && selected) {
    const weekHrs = perWorker.week.get(selected.id) ?? 0
    const regularHrs = Math.min(weekHrs, OVERTIME_WEEKLY_MS_HRS)
    const overtimeHrs = Math.max(0, weekHrs - OVERTIME_WEEKLY_MS_HRS)
    const days: SignoffDay[] = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i)
      const dayShifts = shiftsInRange.filter((s) => {
        const st = new Date(s.started_at)
        return s.worker_id === selected.id && st >= day && st < addDays(day, 1)
      })
      const hrs = dayShifts.reduce((sum, s) => sum + durationHrs(s, nowMs), 0)
      const primary = [...dayShifts].sort((a, b) => durationHrs(b, nowMs) - durationHrs(a, nowMs))[0]
      const site = primary?.site_id ? sites.find((s) => s.id === primary.site_id)?.name ?? 'Unassigned' : '—'
      const times = primary
        ? `${hhmm(new Date(primary.started_at))} – ${primary.ended_at ? hhmm(new Date(primary.ended_at)) : 'now'}`
        : ''
      const auto = dayShifts.length > 0 && dayShifts.every((s) => s.source === 'auto' && !s.edited)
      return { day: weekday(day), site, times, hrs: hrs.toFixed(1), auto }
    })
    const weekLabel = `${weekday(weekStart)} ${monthDay(weekStart)} – ${weekday(addDays(weekStart, 6))} ${monthDay(addDays(weekStart, 6))}`

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg, overflow: 'hidden' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', background: '#fff', borderBottom: '1px solid #DCE0E6', overflowX: 'auto' }}>
          <button onClick={closeDetail} style={navBtn}>← Back to map</button>
          <div style={{ flex: 'none', width: 1, height: 20, background: '#DCE0E6', margin: '0 4px' }} />
          <span style={{ flex: 'none', fontSize: 12.5, color: '#696D74', whiteSpace: 'nowrap' }}>
            Worker app · the four things that feed the office screens
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={closeDetail} style={navBtn}>See the office side →</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '24px 26px 44px' }}>
          <div style={{ maxWidth: 1560, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-.01em' }}>
              Crew — corrections, sign-off, breaks, switching jobs
            </h1>
            <p style={{ margin: 0, maxWidth: 840, fontSize: 13.5, lineHeight: 1.5, color: '#696D74' }}>
              Four loops the office screens already show the end of. {selected.name}'s geofence exception, the "Signed
              off 3:34 PM" badge on {selected.name}'s row, the "Meal break not taken — CA rule" flag, and{' '}
              {selected.name}'s Tuesday split across two sites and two cost codes all start here. Without these, the
              numbers on the timesheet arrive from nowhere.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-start' }}>
            <FixPunchColumn name={selected.name} />
            <SignOffColumn
              name={selected.name}
              weekLabel={weekLabel}
              totalHrs={weekHrs}
              regularHrs={regularHrs}
              overtimeHrs={overtimeHrs}
              days={days}
            />
            <BreakColumn />
            <SwitchJobColumn name={selected.name} />
            <LandingColumn />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg, overflow: 'hidden' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', background: '#fff', borderBottom: '1px solid #DCE0E6', overflowX: 'auto' }}>
        <div style={{ flex: 'none', display: 'flex', height: 27, border: '1px solid #DCE0E6', borderRadius: 3, overflow: 'hidden' }}>
          {(
            [
              ['all', `All ${onCounts.all}`],
              ['on_clock', `On the clock ${onCounts.on_clock}`],
              ['off', `Off ${onCounts.off}`],
              ['exception', `Exceptions ${onCounts.exception}`],
            ] as const
          ).map(([key, label], i) => {
            const active = statusFilter === key
            const isException = key === 'exception'
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                style={{
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: isException ? 5 : 0,
                  padding: '0 11px',
                  background: active ? '#E7F1FF' : '#fff',
                  border: 'none',
                  borderLeft: i === 0 ? 'none' : '1px solid #DCE0E6',
                  font: 'inherit',
                  fontSize: 12.5,
                  fontWeight: active || isException ? 600 : 400,
                  color: isException ? '#A00417' : active ? '#007BFF' : '#1A1D21',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {isException && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#D2051E' }} />}
                {label}
              </button>
            )
          })}
        </div>

        <div style={{ position: 'relative', flex: 'none' }}>
          <select
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            style={{
              appearance: 'none',
              boxSizing: 'border-box',
              flex: 'none',
              height: 27,
              padding: '0 22px 0 10px',
              background: '#fff',
              border: '1px solid #DCE0E6',
              borderRadius: 3,
              font: 'inherit',
              fontSize: 12.5,
              fontWeight: 500,
              color: '#1A1D21',
              cursor: 'pointer',
            }}
          >
            <option value="">All trades</option>
            {trades.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: 9, pointerEvents: 'none' }}>▾</span>
        </div>

        <div style={{ flex: 'none', width: 1, height: 20, background: '#DCE0E6', margin: '0 4px' }} />

        {canEdit && (
          <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8B9096', whiteSpace: 'nowrap' }}>
            <LockIcon size={13} stroke="#8B9096" />
            {payRateNote}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <button onClick={exportCsv} style={navBtn}>Export list</button>
        {canEdit && !memberForm && (
          <button onClick={() => setMemberForm(blankMember)} style={addBtn}>
            ADD CREW MEMBER
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 900px', minWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {error && (
              <div style={{ padding: '8px 12px', borderRadius: 4, background: '#FDECEE', color: '#A00417', fontSize: 12.5 }}>{error}</div>
            )}

            {memberForm && (
              <div style={formCard}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add a crew member</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <FormField label="Name" value={memberForm.name} onChange={(v) => setMemberForm({ ...memberForm, name: v })} placeholder="Danny Whitfield" />
                  <FormField label="Trade" value={memberForm.trade} onChange={(v) => setMemberForm({ ...memberForm, trade: v })} placeholder="Framer" />
                  <FormField label="Hourly rate" value={memberForm.rate} onChange={(v) => setMemberForm({ ...memberForm, rate: v })} placeholder="54" width={110} />
                  <FormField label="Email to invite" value={memberForm.email} onChange={(v) => setMemberForm({ ...memberForm, email: v })} placeholder="danny@example.com" width={230} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={memberForm.isOffice}
                    onChange={(e) => setMemberForm({ ...memberForm, isOffice: e.target.checked })}
                  />
                  Office access — can see the whole crew's location and approve timesheets
                </label>
                <p style={{ fontSize: 11.5, color: '#8B9096', lineHeight: 1.5, margin: '10px 0 0' }}>
                  They sign up at <code>/worker</code> with that email address and their account links to this record
                  automatically — no invite token to send or expire.
                </p>
                {memberError && <div style={{ marginTop: 10, fontSize: 12, color: '#A00417' }}>{memberError}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => void addMember()} disabled={memberBusy} style={cta}>
                    {memberBusy ? 'SAVING…' : 'ADD TO CREW'}
                  </button>
                  <button onClick={() => setMemberForm(null)} style={ghost}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatTile label="HEADCOUNT" value={String(roster.length)} sub={`${fieldCount} field · ${officeCount} office`} />
              <StatTile label="AVG HOURS / WEEK" value={avgHoursWeek.toFixed(1)} sub={`${trendingCount} trending into overtime`} />
              <StatTile
                label="CERTS EXPIRING"
                value={String(certsProblemCount)}
                sub={`${certsLapsedCount} already lapsed`}
                warn
              />
              <StatTile
                label="TIME OFF PENDING"
                value={timeOffDismissed ? '0' : '1'}
                sub={timeOffDismissed ? 'Nothing pending' : 'Miguel · Aug 21–22'}
              />
            </div>

            <div style={{ background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8, overflowX: 'auto' }}>
              <div style={{ minWidth: 840, display: 'grid', columnGap: 10, gridTemplateColumns: '1.5fr 104px 116px 92px 1.4fr 74px', padding: '7px 14px', background: '#FAFBFC', borderBottom: '1px solid #DCE0E6' }}>
                <span style={theadCell}>WORKER</span>
                <span style={theadCell}>PHONE</span>
                <span style={theadCell}>TODAY</span>
                <span style={{ ...theadCell, textAlign: 'right' }}>RATE</span>
                <span style={theadCell}>CERTIFICATIONS</span>
                <span style={{ ...theadCell, textAlign: 'right' }}>PTO</span>
              </div>

              {visibleRows.length === 0 && (
                <div style={{ padding: 24, fontSize: 13, color: '#696D74' }}>
                  {loading ? 'Loading crew…' : 'No one matches this filter.'}
                </div>
              )}

              {visibleRows.map((row) => {
                const st = statusOf(row)
                const rowCerts = certsByWorker.get(row.id) ?? []
                return (
                  <div
                    key={row.id}
                    onClick={() => openDetail(row.id)}
                    style={{
                      minWidth: 840,
                      display: 'grid',
                      columnGap: 10,
                      gridTemplateColumns: '1.5fr 104px 116px 92px 1.4fr 74px',
                      alignItems: 'center',
                      padding: '9px 14px',
                      borderBottom: '1px solid #EDEFF1',
                      background: selected?.id === row.id ? '#F2F8FF' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <span style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: '#3F454B', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                        {row.initials}
                        <span style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: '50%', border: '2px solid #fff', background: st.fg }} />
                      </span>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</span>
                        <span style={{ fontSize: 11, color: '#8B9096', whiteSpace: 'nowrap' }}>{row.trade}</span>
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, color: '#4A5057', whiteSpace: 'nowrap' }}>—</span>
                    <span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 11, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', background: st.bg, color: st.fg }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.fg }} />
                        {st.label}
                      </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      <LockIcon size={11} stroke="#B7BCC2" strokeWidth={1.6} />
                      {canSeeRate(row) ? money2(Number(row.rate)) : '—'}
                    </span>
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {rowCerts.map((c) => {
                        const s = certStatus(c.expires_on, nowMs)
                        return (
                          <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 3, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap', background: s.bg, color: s.fg }}>
                            {c.name}
                          </span>
                        )
                      })}
                    </span>
                    <span style={{ fontSize: 12.5, textAlign: 'right', color: '#4A5057', whiteSpace: 'nowrap' }}>—</span>
                  </div>
                )
              })}

              <div style={{ minWidth: 840, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', background: '#FAFBFC' }}>
                <span style={{ fontSize: 12.5, color: '#696D74' }}>
                  {roster.length} people · {notOnAppCount} not yet on the app
                </span>
                {notOnAppCount > 0 ? (
                  <a
                    href={`mailto:?bcc=${encodeURIComponent(
                      roster.filter((r) => !r.authUserId).map((r) => workers.find((w) => w.id === r.id)).length
                        ? ''
                        : '',
                    )}`}
                    onClick={(e) => {
                      e.preventDefault()
                      setInviteHint((v) => !v)
                    }}
                    style={{ fontSize: 12.5, fontWeight: 500, color: theme.accent, cursor: 'pointer' }}
                  >
                    Send app invites →
                  </a>
                ) : (
                  <span style={{ fontSize: 12.5, color: '#B7BCC2' }}>Everyone's on the app →</span>
                )}
              </div>
              {inviteHint && (
                <div style={{ padding: '8px 14px 12px', background: '#FAFBFC', fontSize: 11.5, color: '#696D74', lineHeight: 1.5 }}>
                  There's nothing to send from here — anyone you've added signs up at <code>/worker</code> with the
                  email you invited them on, and their account claims this row automatically.
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: '1 1 330px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {selected ? (
              <>
                <div style={{ background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderBottom: '1px solid #DCE0E6' }}>
                    <span style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: '#3F454B', color: '#fff', fontSize: 15, fontWeight: 700 }}>
                      {selected.initials}
                      <span style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: '50%', border: '2px solid #fff', background: statusOf(selected).fg }} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{selected.name}</span>
                      <span style={{ fontSize: 12.5, color: '#696D74' }}>
                        {selected.trade}
                        {selected.createdAt ? ` · with you since ${monthYear(new Date(selected.createdAt))}` : ''}
                      </span>
                    </div>
                    {canEdit && selected.id !== me.id && (
                      <button onClick={() => void deactivate(selected.id)} disabled={memberBusy} style={ghost}>
                        Deactivate
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: '#DCE0E6' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '11px 13px', background: '#fff' }}>
                      <span style={statCellLabel}>HRS / MONTH</span>
                      <span style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {(perWorker.month.get(selected.id) ?? 0).toFixed(1)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '11px 13px', background: '#fff' }}>
                      <span style={statCellLabel}>OVERTIME</span>
                      <span
                        style={{
                          fontSize: 17,
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: (perWorker.overtimeMonth.get(selected.id) ?? 0) > 0 ? '#D2051E' : theme.ink,
                        }}
                      >
                        {(perWorker.overtimeMonth.get(selected.id) ?? 0).toFixed(1)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '11px 13px', background: '#fff' }}>
                      <span style={statCellLabel}>SITES</span>
                      <span style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{selectedSitesList.length}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '13px 14px', borderTop: '1px solid #DCE0E6' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>SITES WORKED THIS MONTH</span>
                    {selectedSitesList.length === 0 && <span style={{ fontSize: 12.5, color: '#B7BCC2' }}>No shifts recorded this month.</span>}
                    {selectedSitesList.map((p) => (
                      <div key={p.siteId} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: siteSwatch(p.siteId) }} />
                        <span style={{ flex: 1, fontSize: 12.5 }}>{p.name}</span>
                        <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{p.hrs.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderTop: '1px solid #DCE0E6' }}>
                    <span style={{ padding: '13px 14px 8px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' }}>DOCUMENTS ON FILE</span>
                    {selectedCerts.length === 0 && (
                      <span style={{ padding: '0 14px 10px', fontSize: 12.5, color: '#B7BCC2' }}>No certifications on file.</span>
                    )}
                    {selectedCerts.map((c) => {
                      const s = certStatus(c.expires_on, nowMs)
                      return (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid #F1F3F5' }}>
                          <DocIcon />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                          <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 11, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', background: s.bg, color: s.fg }}>
                            {s.label}
                          </span>
                        </div>
                      )
                    })}
                    {canEdit && (
                      <div style={{ padding: '10px 14px', borderTop: '1px solid #F1F3F5' }}>
                        {certForm ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <FormField label="Certification" value={certForm.name} onChange={(v) => setCertForm({ ...certForm, name: v })} placeholder="OSHA 30" width={150} />
                              <label style={fieldLabel}>
                                Expires
                                <input
                                  type="date"
                                  value={certForm.expiresOn}
                                  onChange={(e) => setCertForm({ ...certForm, expiresOn: e.target.value })}
                                  style={{ ...fieldInput, width: 140 }}
                                />
                              </label>
                            </div>
                            {certError && <div style={{ fontSize: 11.5, color: '#A00417' }}>{certError}</div>}
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button onClick={() => void saveCert()} disabled={certBusy} style={cta}>
                                {certBusy ? 'SAVING…' : 'SAVE'}
                              </button>
                              <button onClick={() => setCertForm(null)} style={ghost}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <a href="#" onClick={(e) => { e.preventDefault(); setCertForm(blankCert) }} style={{ fontSize: 12.5, color: theme.accent, cursor: 'pointer' }}>
                            Upload a document
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {!timeOffDismissed && (
                  <div style={{ background: '#fff', border: '1px solid #DCE0E6', borderLeft: '3px solid #FFC107', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 13px', borderBottom: '1px solid #DCE0E6' }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Time off request</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 11, background: '#FFF6DE', color: '#8A6100', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        Awaiting you
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12.5, color: '#696D74' }}>Dates</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Fri Aug 21 – Sat Aug 22</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12.5, color: '#696D74' }}>Hours</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>16.0 of 42.0 available</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12.5, color: '#696D74' }}>Reason</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Family — planned</span>
                      </div>
                      <div style={{ display: 'flex', gap: 9, padding: '10px 11px', background: '#FFF9E8', borderRadius: 4 }}>
                        <WarningIcon />
                        <span style={{ fontSize: 12, lineHeight: 1.45, color: '#8A6100' }}>
                          Maple Ridge has no other foreman scheduled Friday. Approving leaves 3 crew unsupervised.
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setTimeOffDismissed(true)} style={{ flex: 1, height: 32, background: '#fff', border: '1px solid #DCE0E6', borderRadius: 3, font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                          Decline
                        </button>
                        <button onClick={() => setTimeOffDismissed(true)} style={{ flex: 1, height: 32, background: theme.cta, border: `1px solid ${theme.ctaBorder}`, borderRadius: 3, font: 'inherit', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', color: theme.ink, cursor: 'pointer' }}>
                          APPROVE
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #DCE0E6', borderRadius: 8, padding: 20, fontSize: 12.5, color: '#696D74', lineHeight: 1.6 }}>
                {loading ? 'Loading crew…' : 'Add your first crew member to see their profile here.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- small bits

function StatTile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 150,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '12px 14px',
        background: warn ? '#FFF9E8' : '#fff',
        border: `1px solid ${warn ? '#F0DCA8' : '#DCE0E6'}`,
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: warn ? '#8A6100' : '#8B9096', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1, color: warn ? '#8A6100' : theme.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 11.5, color: warn ? '#8A6100' : '#696D74' }}>{sub}</span>
    </div>
  )
}

function FormField({ label, value, onChange, placeholder, width = 170 }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
}) {
  return (
    <label style={fieldLabel}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...fieldInput, width }}
      />
    </label>
  )
}

// ------------------------------------------------------------------ styles

const theadCell: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: '#696D74' }

const statCellLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: '#8B9096', whiteSpace: 'nowrap' }

const navBtn: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 27,
  padding: '0 10px',
  background: '#fff',
  border: '1px solid #DCE0E6',
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  color: '#1A1D21',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
}

const addBtn: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  height: 29,
  padding: '0 14px',
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: '#1A1D21',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const phoneCta: React.CSSProperties = {
  width: '100%',
  height: 56,
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: '#1A1D21',
  cursor: 'pointer',
}

const formCard: React.CSSProperties = {
  padding: 14,
  background: '#fff',
  border: '1px solid #DCE0E6',
  borderRadius: 8,
}

const fieldLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: '#8B9096',
}

const fieldInput: React.CSSProperties = {
  display: 'block',
  height: 32,
  marginTop: 4,
  padding: '0 9px',
  borderRadius: 3,
  border: '1px solid #DCE0E6',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: 0,
  textTransform: 'none',
  color: theme.ink,
  boxSizing: 'border-box',
}

const ghost: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 3,
  border: '1px solid #DCE0E6',
  background: '#fff',
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const cta: React.CSSProperties = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}
