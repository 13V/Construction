import { useState } from 'react'
import { supabase, type WorkerRow } from '../data/supabase'
import { theme } from '../theme'
import type { CrewSnapshot } from '../types'

/**
 * Crew management. Adding someone creates their worker row with an invite
 * email; the first time they sign up with that address, /api/bootstrap claims
 * the row instead of starting a new company. No invite tokens to expire or
 * chase.
 */

const blank = { name: '', trade: '', rate: '', email: '', isOffice: false }

interface CrewProps {
  snapshot: CrewSnapshot
  roster: WorkerRow[]
  companyId: string
  canEdit: boolean
  onSaved: () => void
}

export function Crew({ snapshot, roster, companyId, canEdit, onSaved }: CrewProps) {
  const [form, setForm] = useState<typeof blank | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialsFor = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '??'

  async function add() {
    if (!form?.name.trim()) {
      setError('A name is required.')
      return
    }
    setBusy(true)
    setError(null)

    const { error: err } = await supabase()
      .from('workers')
      .insert({
        name: form.name.trim(),
        initials: initialsFor(form.name),
        trade: form.trade.trim() || 'Crew',
        rate: Number(form.rate) || 0,
        invite_email: form.email.trim().toLowerCase() || null,
        is_office: form.isOffice,
        // RLS additionally checks this matches the caller's own company.
        company_id: companyId,
      })

    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setForm(null)
    onSaved()
  }

  async function deactivate(id: string) {
    setBusy(true)
    const { error: err } = await supabase()
      .from('workers')
      .update({ active: false })
      .eq('id', id)
    setBusy(false)
    if (err) setError(err.message)
    else onSaved()
  }

  const statusOf = (row: WorkerRow) => {
    if (!row.auth_user_id) return { label: 'Invited', color: theme.warning }
    const live = snapshot.crew.find((c) => c.worker.id === row.id)
    if (live?.status === 'on_clock') return { label: 'On the clock', color: theme.success }
    if (live?.exception) return { label: 'Needs review', color: theme.alert }
    return { label: 'Signed in', color: theme.inkFaint }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Crew</h1>
          <span style={{ fontSize: 13, color: theme.inkSoft }}>{roster.length}</span>
          {canEdit && !form && (
            <button onClick={() => setForm(blank)} style={{ ...cta, marginLeft: 'auto' }}>
              ADD SOMEONE
            </button>
          )}
        </div>

        {form && (
          <div style={card}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Danny Whitfield" />
              <Field label="Trade" value={form.trade} onChange={(v) => setForm({ ...form, trade: v })} placeholder="Framer" />
              <Field label="Hourly rate" value={form.rate} onChange={(v) => setForm({ ...form, rate: v })} placeholder="54" width={110} />
              <Field label="Email to invite" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="danny@example.com" width={230} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={form.isOffice}
                onChange={(e) => setForm({ ...form, isOffice: e.target.checked })}
              />
              Office access — can see the whole crew's location and approve timesheets
            </label>

            <p style={{ fontSize: 11.5, color: theme.inkSoft, lineHeight: 1.5, marginBottom: 0 }}>
              They sign up at <code>/worker</code> with that email address and their
              account links to this record automatically.
            </p>

            {error && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void add()} disabled={busy} style={cta}>
                {busy ? 'SAVING…' : 'ADD TO CREW'}
              </button>
              <button onClick={() => setForm(null)} style={ghost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Trade', 'Rate', 'Access', 'Status', ''].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((row) => {
                const status = statusOf(row)
                return (
                  <tr key={row.id}>
                    <td style={{ ...td, fontWeight: 500 }}>{row.name}</td>
                    <td style={td}>{row.trade}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                      {Number(row.rate) ? `$${Number(row.rate).toFixed(2)}` : '—'}
                    </td>
                    <td style={{ ...td, color: theme.inkSoft }}>
                      {row.is_office ? 'Office' : 'Field'}
                    </td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: status.color,
                          }}
                        />
                        {status.label}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {canEdit && (
                        <button onClick={() => void deactivate(row.id)} style={ghost}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  width = 170,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
}) {
  return (
    <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: theme.inkFaint }}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          display: 'block',
          width,
          height: 32,
          marginTop: 4,
          padding: '0 9px',
          borderRadius: 3,
          border: `1px solid ${theme.border}`,
          font: 'inherit',
          fontSize: 13,
          fontWeight: 400,
          letterSpacing: 0,
          textTransform: 'none',
          color: theme.ink,
        }}
      />
    </label>
  )
}

const card = {
  marginTop: 14,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const th = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  background: theme.appBg,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  textAlign: 'left' as const,
}

const td = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 13,
}

const ghost = {
  padding: '4px 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
}

const cta = {
  padding: '7px 13px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}
