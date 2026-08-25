/**
 * The crew, and adding to it — from the phone.
 *
 * Adding a person already existed, but only in the office web dashboard. That
 * was fine while the phone was assumed to be the worker's end of a two-ended
 * product; it stops being fine for a business whose office IS a phone. A sole
 * operator who signs up on the phone and hires his first tiler had no way to
 * put that tiler in the app at all — and until somebody is in the crew list,
 * they cannot be rostered, cannot clock on, and do not exist to the chat
 * compose sheet, which is why it reads "No other crew yet".
 *
 * There is no invite token to send or expire. A worker row carries the email
 * they will sign up with, and api/bootstrap.ts matches on it the first time
 * that address confirms an account, linking the login to the row waiting for
 * it. The match is on a CONFIRMED email precisely so that knowing a
 * colleague's address is not enough to take over their record and their
 * timesheets.
 *
 * Pay rates are deliberately absent. They live in worker_pay, a separate table
 * (schema_v24) so the crew list can be readable by everyone without their
 * wages being readable too — and a rate typed on a phone in a ute is a
 * mis-tap that underpays somebody. The office dashboard keeps that job.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase, type WorkerRow } from '../../data/supabase'
import { s, SAFE_BOTTOM, avatarGrey } from './stheme'

interface Member {
  id: string
  name: string
  initials: string
  trade: string | null
  role: WorkerRow['role']
  active: boolean
  invite_email: string | null
  auth_user_id: string | null
}

const COLS = 'id, name, initials, trade, role, active, invite_email, auth_user_id'

const initialsFor = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '??'

const ROLES: Array<{ key: WorkerRow['role']; label: string; blurb: string }> = [
  { key: 'employee', label: 'Crew', blurb: 'Clocks on, sees their jobs' },
  { key: 'captain', label: 'Crew captain', blurb: 'Also signs off their site' },
  { key: 'owner', label: 'Office', blurb: 'Everything, including money' },
]

/** The four a tiling business hires, offered as one tap each. */
const TRADES = ['Tiler', 'Waterproofer', 'Apprentice', 'Labourer']

export function TeamSheet({ me, onClose }: { me: WorkerRow; onClose: () => void }) {
  const [rows, setRows] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [trade, setTrade] = useState('Tiler')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkerRow['role']>('employee')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const office = me.is_office

  const load = useCallback(async () => {
    const { data, error: err } = await supabase().from('workers').select(COLS).order('name')
    if (err) setError(err.message)
    setRows(((data ?? []) as unknown as Member[]).filter((w) => w.active))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    const n = name.trim()
    if (!n) {
      setError('A name is the one thing this needs.')
      return
    }
    const mail = email.trim().toLowerCase()
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError('That email address does not look right — they will sign up with it.')
      return
    }
    if (mail && rows.some((w) => w.invite_email?.toLowerCase() === mail)) {
      setError('Somebody is already waiting to join with that address.')
      return
    }
    setBusy(true)
    setError(null)
    // Read the row back: workers_office_write is office-only, and an insert a
    // policy filters out comes back as a success with nothing in it.
    const { data, error: err } = await supabase()
      .from('workers')
      .insert({
        company_id: me.company_id,
        name: n,
        initials: initialsFor(n),
        trade: trade.trim() || 'Crew',
        // Role only — a trigger derives is_office from it, and writing both
        // invites them to disagree.
        role,
        invite_email: mail || null,
      })
      .select('id')
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    if (!data || data.length === 0) {
      setError('That was refused — adding people is the office’s to do.')
      return
    }
    setName('')
    setEmail('')
    setTrade('Tiler')
    setRole('employee')
    setAdding(false)
    await load()
  }

  async function remove(id: string, name: string) {
    // Destructive, instant, and one tap from a list — the combination that
    // makes a reviewer poking around wipe somebody by accident. Their shifts
    // and signatures survive either way, but a roster that quietly loses a
    // person is not something anybody notices until they go looking.
    if (!window.confirm(`Take ${name} off the crew? Their timesheets and signatures are kept.`)) return
    // Deactivated, never deleted: their shifts, timesheets and signatures are
    // the company's records and have to survive the person leaving.
    const { data, error: err } = await supabase().from('workers').update({ active: false }).eq('id', id).select('id')
    if (err || !data || data.length === 0) {
      setError(err?.message ?? 'That was refused — removing people is the office’s to do.')
      return
    }
    setRows((prev) => prev.filter((w) => w.id !== id))
  }

  const label = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' } as const
  const field = {
    width: '100%',
    height: 48,
    padding: '0 13px',
    boxSizing: 'border-box' as const,
    background: '#F5F6F7',
    border: '1px solid #DCE0E6',
    borderRadius: 10,
    font: 'inherit',
    fontSize: 16,
    color: s.ink,
    outline: 'none',
  }
  const chip = (on: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    height: 34,
    padding: '0 13px',
    borderRadius: 17,
    border: `1px solid ${on ? '#1A1D21' : '#DCE0E6'}`,
    background: on ? '#1A1D21' : '#fff',
    fontSize: 13,
    fontWeight: 600,
    color: on ? '#fff' : '#4A5057',
    cursor: 'pointer',
  })

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.5)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>Your crew</span>
            <span style={{ fontSize: 12.5, color: '#8B9096' }}>
              {loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'person' : 'people'} on the books`}
            </span>
          </span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `15px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, lineHeight: 1.45, color: '#8E2A31' }}>{error}</span>}

            <span style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 11, overflow: 'hidden' }}>
              {rows.map((w, i) => {
                const waiting = !w.auth_user_id && w.invite_email
                return (
                  <span key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 62, padding: '10px 13px', borderTop: i === 0 ? 'none' : '1px solid #EDEFF1' }}>
                    <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', background: avatarGrey(i), color: '#fff', fontSize: 11.5, fontWeight: 700 }}>
                      {w.initials}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.name}
                        {w.id === me.id ? ' (you)' : ''}
                      </span>
                      <span style={{ fontSize: 12.5, color: waiting ? '#8A6100' : '#8B9096', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {waiting
                          ? `Waiting for ${w.invite_email} to sign up`
                          : [w.trade, w.role === 'captain' ? 'Crew captain' : w.role === 'owner' ? 'Office' : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {office && w.id !== me.id && (
                      <span
                        onClick={() => void remove(w.id, w.name)}
                        style={{ flex: 'none', display: 'flex', alignItems: 'center', height: 30, padding: '0 11px', border: '1px solid #E7CBCD', borderRadius: 15, fontSize: 12.5, fontWeight: 700, color: '#A3282E', cursor: 'pointer' }}
                      >
                        Remove
                      </span>
                    )}
                  </span>
                )
              })}
              {!loading && rows.length === 0 && (
                <span style={{ padding: '15px', fontSize: 13.5, lineHeight: 1.5, color: '#8B9096' }}>Nobody on the books yet.</span>
              )}
            </span>

            {office && !adding && (
              <button
                onClick={() => {
                  setAdding(true)
                  setError(null)
                }}
                style={{ width: '100%', height: 48, border: '1px solid #DCE0E6', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: s.ink, cursor: 'pointer' }}
              >
                Add someone
              </button>
            )}

            {office && adding && (
              <span style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, background: '#fff', border: '1px solid #E1E5E9', borderRadius: 11 }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>NAME</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their full name" style={field} />
                </span>

                <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <span style={label}>TRADE</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {TRADES.map((t) => (
                      <span key={t} onClick={() => setTrade(t)} style={chip(trade === t)}>
                        {t}
                      </span>
                    ))}
                  </span>
                </span>

                <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <span style={label}>WHAT THEY CAN DO</span>
                  {ROLES.map((r) => (
                    <span
                      key={r.key}
                      onClick={() => setRole(r.key)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: `1px solid ${role === r.key ? '#1A1D21' : '#E1E5E9'}`, borderRadius: 10, background: role === r.key ? '#F4F6F8' : '#fff', cursor: 'pointer' }}
                    >
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: s.ink }}>{r.label}</span>
                        <span style={{ fontSize: 12, color: '#8B9096' }}>{r.blurb}</span>
                      </span>
                      <span style={{ flex: 'none', width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${role === r.key ? '#1A1D21' : '#CFD4DA'}`, background: role === r.key ? '#1A1D21' : '#fff', boxShadow: role === r.key ? 'inset 0 0 0 3px #fff' : 'none' }} />
                    </span>
                  ))}
                </span>

                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>EMAIL TO SIGN UP WITH (OPTIONAL)</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="them@example.com" inputMode="email" style={field} />
                  <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                    They download Crewline, sign up with this address, confirm it, and their account
                    joins this record — nothing to send, nothing to expire. Leave it blank and they
                    still show on the roster; add it later when you know it.
                  </span>
                </span>

                <span style={{ display: 'flex', gap: 9 }}>
                  <button
                    onClick={() => {
                      setAdding(false)
                      setError(null)
                    }}
                    style={{ flex: '0 0 34%', height: 46, border: '1px solid #DCE0E6', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: '#4A5057', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void add()}
                    style={{ flex: 1, height: 46, border: 0, borderRadius: 10, background: '#1A1D21', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, letterSpacing: '.03em', color: '#fff', opacity: busy ? 0.6 : 1, cursor: 'pointer' }}
                  >
                    {busy ? 'ADDING…' : 'ADD TO CREW'}
                  </button>
                </span>
              </span>
            )}

            {!office && (
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                The office adds and removes people.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
