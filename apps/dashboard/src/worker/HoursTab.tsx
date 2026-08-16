import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type ShiftRow, type WorkerRow } from '../data/supabase'
import { useSites } from './useSites'
import { clockTime, dayDate } from '../format'
import { theme } from '../theme'

/**
 * My hours — the payday screen. Crewline Mobile, screen 6.
 *
 * A chippie opens this on payday, so every number has to be unarguable and
 * every one has to show its working. Automatic time only earns trust if the
 * evidence is one tap away: the fence, the distance, the settle window.
 *
 * No rate and no dollar total, anywhere on this tab. A worker sees hours; what
 * they are worth is between them and payroll.
 *
 * Fix a Punch and Time off live here too — both are things a worker does about
 * their hours, and neither had a home before. Time off is a segment rather than
 * a child of one shift, because it is a peer of your hours.
 */

const REASONS: Array<{ code: string; label: string }> = [
  { code: 'parked_offsite', label: 'Parked off site and walked in' },
  { code: 'access_changed', label: 'Site access moved' },
  { code: 'blocked', label: "Couldn't get through the gate" },
  { code: 'forgot', label: 'Forgot to clock out' },
  { code: 'other', label: 'Something else' },
]

const LEAVE_KINDS: Array<{ kind: string; label: string }> = [
  { kind: 'annual', label: 'Annual' },
  { kind: 'personal', label: "Personal / carer's" },
  { kind: 'unpaid', label: 'Unpaid' },
  { kind: 'other', label: 'Other' },
]

interface Site {
  id: string
  name: string
}

interface TimeOffRow {
  id: string
  kind: string
  starts_on: string
  ends_on: string
  hours: number | null
  reason: string | null
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
}

const hoursOf = (s: ShiftRow, now: number): number => {
  const end = s.ended_at ? new Date(s.ended_at).getTime() : now
  const gross = (end - new Date(s.started_at).getTime()) / 3_600_000
  return Math.max(0, gross - Number(s.break_minutes ?? 0) / 60)
}

/** Monday of the week containing d. A builder's week starts Monday. */
function weekStart(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7))
  return c
}

export function HoursTab({ me, sites: fromTracker }: { me: WorkerRow; sites: Site[] }) {
  // The tracker's list is empty until the worker starts tracking; every day row
  // read "Unassigned" until then.
  const sites = useSites(fromTracker as never)
  const [seg, setSeg] = useState<'hours' | 'leave'>('hours')
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [leave, setLeave] = useState<TimeOffRow[]>([])
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [fixing, setFixing] = useState<ShiftRow | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = Date.now()

  const from = useMemo(() => weekStart(new Date()), [])

  const load = useCallback(async () => {
    const client = supabase()
    const [s, l] = await Promise.all([
      client
        .from('shifts')
        .select('*')
        .eq('worker_id', me.id)
        .gte('started_at', new Date(from.getTime() - 14 * 86_400_000).toISOString())
        .order('started_at', { ascending: false }),
      client.from('time_off_requests').select('*').eq('worker_id', me.id).order('starts_on', { ascending: false }),
    ])
    if (s.error) setError(s.error.message)
    setShifts((s.data ?? []) as ShiftRow[])
    setLeave((l.data ?? []) as TimeOffRow[])
  }, [me.id, from])

  useEffect(() => {
    void load()
  }, [load])

  const thisWeek = useMemo(
    () => shifts.filter((s) => new Date(s.started_at).getTime() >= from.getTime()),
    [shifts, from],
  )
  const lastWeek = useMemo(() => {
    const prev = from.getTime() - 7 * 86_400_000
    return shifts.filter((s) => {
      const t = new Date(s.started_at).getTime()
      return t >= prev && t < from.getTime()
    })
  }, [shifts, from])

  const total = thisWeek.reduce((sum, s) => sum + hoursOf(s, now), 0)
  const lastTotal = lastWeek.reduce((sum, s) => sum + hoursOf(s, now), 0)
  // The denominator is the worker's own ordinary week, not a constant. A
  // part-timer or an apprentice on a different award gets their own number.
  const ordinary = Number(me.ordinary_hours) || 38
  const overtime = Math.max(0, total - ordinary)
  const toGo = Math.max(0, ordinary - total)
  const onNow = thisWeek.some((s) => !s.ended_at)

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? 'Unassigned'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.panel }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '4px 18px 10px' }}>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>Time</span>
          <span style={{ fontSize: 12, color: theme.inkFaint }}>
            {me.name} · {dayDate(from.toISOString())} – {dayDate(new Date(from.getTime() + 6 * 86_400_000).toISOString())}
          </span>
        </span>
        {onNow && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 11px',
              borderRadius: 13,
              background: theme.successFill,
              color: theme.successInk,
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: theme.success }} />
            ON NOW
          </span>
        )}
      </div>

      <div style={{ flex: 'none', display: 'flex', margin: '0 18px 12px', border: `1px solid ${theme.border}`, borderRadius: 6, overflow: 'hidden' }}>
        {(['hours', 'leave'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSeg(k)}
            style={{
              flex: 1,
              height: 44,
              border: 'none',
              background: seg === k ? theme.panel : theme.appBg,
              color: theme.ink,
              font: 'inherit',
              fontSize: 13.5,
              fontWeight: seg === k ? 700 : 500,
              cursor: 'pointer',
            }}
          >
            {k === 'hours' ? 'Hours' : 'Time off'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {error && (
          <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 6, background: theme.alertFill, color: theme.alertInk, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        {seg === 'hours' ? (
          <>
            <div style={{ padding: '0 18px 14px' }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>
                  {total.toFixed(1)}
                </span>
                <span style={{ fontSize: 17, color: theme.inkFaint }}>/ {ordinary} hrs</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12.5, color: theme.inkFaint }}>
                  {toGo > 0 ? `${toGo.toFixed(1)} to go` : 'ordinary week done'}
                </span>
              </span>
              <span style={{ display: 'block', height: 8, borderRadius: 4, background: theme.fill, overflow: 'hidden', margin: '9px 0 7px' }}>
                <span
                  style={{
                    display: 'block',
                    height: 8,
                    borderRadius: 4,
                    width: `${Math.min(100, (total / ordinary) * 100)}%`,
                    background: overtime > 0 ? theme.warning : theme.success,
                  }}
                />
              </span>
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: theme.inkFaint }}>
                <span>Ordinary week is {ordinary} hrs</span>
                <span style={{ fontWeight: overtime > 0 ? 700 : 400, color: overtime > 0 ? theme.warnInk : theme.inkFaint }}>
                  {overtime > 0 ? `${overtime.toFixed(1)} overtime` : 'No overtime this week'}
                </span>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', background: theme.rowFill, borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint }}>THIS WEEK</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: theme.inkFaint }}>
                Last week {lastTotal.toFixed(1)}
              </span>
            </div>

            {thisWeek.length === 0 && (
              <div style={{ padding: '40px 32px', textAlign: 'center', fontSize: 13, color: theme.inkSoft }}>
                Nothing recorded this week yet. Hours appear here on their own as you arrive and leave.
              </div>
            )}

            {thisWeek.map((s) => {
              const open = openDay === s.id
              const held = !s.approved_at && s.edited
              return (
                <div key={s.id} style={{ borderBottom: `1px solid ${theme.borderSoft}`, background: held ? theme.warnFill : theme.panel }}>
                  <button
                    onClick={() => setOpenDay(open ? null : s.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      minHeight: 56,
                      padding: '10px 18px',
                      border: 'none',
                      background: 'transparent',
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ flex: 'none', width: 44, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                        {new Date(s.started_at).toLocaleDateString('en-AU', { weekday: 'short' })}
                      </span>
                      <span style={{ fontSize: 11.5, color: theme.inkFaint }}>
                        {new Date(s.started_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      </span>
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {siteName(s.site_id)}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.inkSoft }}>
                        {clockTime(s.started_at)} – {s.ended_at ? clockTime(s.ended_at) : 'now'}
                        {/* A green tick means the geofence wrote it and nobody
                            has touched it since. An edited row says so. */}
                        {s.source === 'auto' && !s.edited && <CheckTick />}
                        {s.edited && <span style={{ fontSize: 11.5, color: theme.warnInk, fontWeight: 600 }}>edited</span>}
                      </span>
                    </span>
                    <span style={{ flex: 'none', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {hoursOf(s, now).toFixed(1)} hrs
                    </span>
                  </button>

                  {open && (
                    <div style={{ padding: '0 18px 14px' }}>
                      {held && (
                        <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 6, background: '#fff', border: `1px solid ${theme.warnBorder}`, fontSize: 12.5, lineHeight: 1.5, color: theme.warnInk }}>
                          <strong>Held for review.</strong> The office has flagged this one. It is not lost — it goes
                          to payroll once they approve it.
                        </div>
                      )}
                      <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint, marginBottom: 8 }}>
                        HOW THIS WAS RECORDED
                      </span>
                      <Evidence dot={theme.success}>
                        {s.source === 'auto'
                          ? `Clocked in automatically at ${clockTime(s.started_at)} — the geofence wrote it, not you.`
                          : `Entered by hand, started ${clockTime(s.started_at)}.`}
                      </Evidence>
                      {s.ended_at && (
                        <Evidence dot={theme.success}>
                          Left {siteName(s.site_id)} {clockTime(s.ended_at)} — clocked out. {hoursOf(s, now).toFixed(1)} hrs.
                        </Evidence>
                      )}
                      {s.cost_code && <Evidence dot={theme.inkGhost}>Recorded against {s.cost_code}.</Evidence>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                        <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                          {Number(s.break_minutes) > 0 ? `Unpaid break ${s.break_minutes} min` : 'No unpaid break'}
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                          onClick={() => setFixing(s)}
                          style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 13.5, fontWeight: 600, color: theme.accent, cursor: 'pointer' }}
                        >
                          Not right? Fix this
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        ) : (
          <>
            <div style={{ padding: '0 18px 14px' }}>
              <button onClick={() => setAsking(true)} style={primaryBar}>
                ASK FOR TIME OFF
              </button>
              {/* No accrual balance: accruals live in payroll, and inventing
                  "12.4 days" here would be a number with no source. */}
              <span style={{ display: 'block', marginTop: 10, fontSize: 12, lineHeight: 1.5, color: theme.inkFaint }}>
                This is your requests and where each one got to. Your leave balance lives in payroll, not here.
              </span>
            </div>
            {leave.length === 0 && (
              <div style={{ padding: '32px', textAlign: 'center', fontSize: 13, color: theme.inkSoft }}>
                No requests yet.
              </div>
            )}
            {leave.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderTop: `1px solid ${theme.borderSoft}` }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {LEAVE_KINDS.find((k) => k.kind === l.kind)?.label ?? l.kind}
                  </span>
                  <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                    {dayDate(l.starts_on)} – {dayDate(l.ends_on)}
                    {l.hours ? ` · ${Number(l.hours)} hrs` : ''}
                  </span>
                </span>
                <StatusChip status={l.status} />
              </div>
            ))}
          </>
        )}
      </div>

      {fixing && (
        <FixPunch
          me={me}
          shift={fixing}
          siteName={siteName(fixing.site_id)}
          onClose={() => setFixing(null)}
          onDone={() => {
            setFixing(null)
            void load()
          }}
        />
      )}
      {asking && (
        <AskTimeOff
          me={me}
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function Evidence({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', gap: 9, marginBottom: 7 }}>
      <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: dot, marginTop: 6 }} />
      <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: theme.inkMid }}>{children}</span>
    </span>
  )
}

function CheckTick() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={theme.success} strokeWidth={2.2}>
      <path d="M3 8.4 6.3 11.6 13 4.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending: { bg: theme.warnFill, fg: theme.warnInk, label: 'Pending' },
    approved: { bg: theme.successFill, fg: theme.successInk, label: 'Approved' },
    declined: { bg: theme.alertFill, fg: theme.alertInk, label: 'Declined' },
    cancelled: { bg: theme.fill, fg: theme.inkFaint, label: 'Cancelled' },
  }
  const m = map[status] ?? map.pending!
  return (
    <span style={{ flex: 'none', padding: '5px 11px', borderRadius: 13, background: m.bg, color: m.fg, fontSize: 11.5, fontWeight: 700 }}>
      {m.label}
    </span>
  )
}

/**
 * The dispute path. A geofence punch is evidence, so the worker never
 * overwrites it — they say what happened and the office decides.
 */
function FixPunch({
  me,
  shift,
  siteName,
  onClose,
  onDone,
}: {
  me: WorkerRow
  shift: ShiftRow
  siteName: string
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = async () => {
    if (!reason || busy) return
    setBusy(true)
    const { error } = await supabase().from('shift_corrections').insert({
      company_id: me.company_id,
      shift_id: shift.id,
      worker_id: me.id,
      reason_code: reason,
      detail: detail.trim() || REASONS.find((r) => r.code === reason)?.label || null,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  return (
    <Sheet title="Fix this punch" subtitle={`${dayDate(shift.started_at)} · in at ${clockTime(shift.started_at)}`} onClose={onClose}>
      <div style={{ padding: '12px 18px', background: theme.warnFill, borderBottom: `1px solid ${theme.warnBorder}` }}>
        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.warnInk, marginBottom: 6 }}>
          WHAT THE FENCE SAW
        </span>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: theme.warnInk }}>
          You were recorded at {siteName} from {clockTime(shift.started_at)}
          {shift.ended_at ? ` to ${clockTime(shift.ended_at)}` : ''}. Tell the office what actually happened and they
          decide — your times are not overwritten by this.
        </span>
      </div>

      <div style={{ padding: '14px 18px' }}>
        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint, marginBottom: 9 }}>
          WHAT HAPPENED?
        </span>
        {REASONS.map((r) => {
          const on = reason === r.code
          return (
            <button
              key={r.code}
              onClick={() => setReason(r.code)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                minHeight: 52,
                padding: '0 14px',
                marginBottom: 8,
                border: `1px solid ${on ? theme.accent : theme.border}`,
                borderRadius: 8,
                background: on ? theme.accentFill : theme.panel,
                font: 'inherit',
                fontSize: 14,
                fontWeight: on ? 600 : 400,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  flex: 'none',
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: `2px solid ${on ? theme.accent : theme.border}`,
                  background: on ? theme.accent : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on && (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth={2.6}>
                    <path d="M3 8.4 6.3 11.6 13 4.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {r.label}
            </button>
          )
        })}
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Anything else the office should know"
          rows={3}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            font: 'inherit',
            fontSize: 14,
            resize: 'none',
          }}
        />
        {err && <span style={{ display: 'block', marginTop: 8, fontSize: 12.5, color: theme.alertInk }}>{err}</span>}
      </div>

      <div style={{ padding: '10px 18px 18px', borderTop: `1px solid ${theme.border}` }}>
        <button onClick={() => void send()} disabled={!reason || busy} style={{ ...primaryBar, opacity: reason && !busy ? 1 : 0.45 }}>
          {busy ? 'SENDING…' : 'SEND TO THE OFFICE'}
        </button>
        <span style={{ display: 'block', marginTop: 8, textAlign: 'center', fontSize: 12, color: theme.inkFaint }}>
          They see your times, the fence and what you said.
        </span>
      </div>
    </Sheet>
  )
}

function AskTimeOff({ me, onClose, onDone }: { me: WorkerRow; onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [kind, setKind] = useState('annual')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = async () => {
    if (busy) return
    if (to < from) {
      setErr('The last day cannot be before the first.')
      return
    }
    setBusy(true)
    const { error } = await supabase().from('time_off_requests').insert({
      company_id: me.company_id,
      worker_id: me.id,
      kind,
      starts_on: from,
      ends_on: to,
      reason: reason.trim() || null,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  return (
    <Sheet title="Time off" subtitle="Goes to the office as pending" onClose={onClose}>
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Label>WHAT KIND</Label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {LEAVE_KINDS.map((k) => {
              const on = kind === k.kind
              return (
                <button
                  key={k.kind}
                  onClick={() => setKind(k.kind)}
                  style={{
                    minHeight: 52,
                    border: `1px solid ${on ? theme.accent : theme.border}`,
                    borderRadius: 8,
                    background: on ? theme.accentFill : theme.panel,
                    font: 'inherit',
                    fontSize: 14,
                    fontWeight: on ? 700 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {k.label}
                </button>
              )
            })}
          </div>
        </div>
        <Row label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
        </Row>
        <Row label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={dateInput} />
        </Row>
        <div>
          <Label>REASON (OPTIONAL)</Label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, font: 'inherit', fontSize: 14, resize: 'none' }}
          />
        </div>
        {err && <span style={{ fontSize: 12.5, color: theme.alertInk }}>{err}</span>}
      </div>
      <div style={{ padding: '10px 18px 18px', borderTop: `1px solid ${theme.border}` }}>
        <button onClick={() => void send()} disabled={busy} style={{ ...primaryBar, opacity: busy ? 0.5 : 1 }}>
          {busy ? 'SENDING…' : 'SEND REQUEST'}
        </button>
        <span style={{ display: 'block', marginTop: 8, textAlign: 'center', fontSize: 12, color: theme.inkFaint }}>
          You can withdraw it until it is decided.
        </span>
      </div>
    </Sheet>
  )
}

function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: theme.panel, display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${theme.border}` }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 15, color: theme.accent, cursor: 'pointer' }}>
          Cancel
        </button>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>{title}</span>
          {subtitle && <span style={{ fontSize: 11.5, color: theme.inkFaint }}>{subtitle}</span>}
        </span>
        <span style={{ width: 44 }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{children}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint, marginBottom: 8 }}>
      {children}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, borderTop: `1px solid ${theme.borderSoft}`, paddingTop: 10 }}>
      <span style={{ flex: 1, fontSize: 14 }}>{label}</span>
      {children}
    </div>
  )
}

const dateInput = {
  height: 44,
  padding: '0 10px',
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  font: 'inherit',
  fontSize: 14,
  color: theme.ink,
  background: theme.panel,
} as const

const primaryBar = {
  width: '100%',
  height: 52,
  border: 'none',
  borderRadius: 6,
  background: theme.ink,
  color: '#fff',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '.03em',
  cursor: 'pointer',
} as const
