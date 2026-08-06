import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type EquipmentRow, type WorkerRow } from '../data/supabase'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Equipment tracking — busybusy's differentiator, so this is built around the
 * two questions an owner actually asks: what's sitting idle burning money,
 * and what's about to need service. Reassignment and status happen inline in
 * the row because that is how this screen gets used day to day, not through
 * a modal.
 */

const IDLE_FLAG_MS = 3 * 24 * 60 * 60 * 1000
const SERVICE_WARN_MS = 7 * 24 * 60 * 60 * 1000

const STATUS_META: Record<EquipmentRow['status'], { label: string; color: string; bg: string }> = {
  in_use: { label: 'In use', color: '#1B7A32', bg: '#EAF7EE' },
  idle: { label: 'Idle', color: theme.inkSoft, bg: theme.appBg },
  maintenance: { label: 'Maintenance', color: '#8A6100', bg: '#FFF6DF' },
}

interface FormState {
  code: string
  name: string
  type: string
  status: EquipmentRow['status']
  serviceDue: string
  notes: string
}

const blankForm: FormState = {
  code: '',
  name: '',
  type: '',
  status: 'idle',
  serviceDue: '',
  notes: '',
}

export function Equipment({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const canEdit = me.is_office

  const [rows, setRows] = useState<EquipmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [hoursInput, setHoursInput] = useState<Map<string, string>>(new Map())

  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase()
      .from('equipment')
      .select('*')
      .order('code')
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setRows((data ?? []) as EquipmentRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? '—'

  const withBusy = async (id: string, fn: () => Promise<{ message: string } | null>) => {
    setSavingIds((prev) => new Set(prev).add(id))
    const err = await fn()
    setSavingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged()
  }

  async function updateField(id: string, patch: Partial<Pick<EquipmentRow, 'site_id' | 'operator_id' | 'status'>>) {
    await withBusy(id, async () => {
      const { error: err } = await supabase().from('equipment').update(patch).eq('id', id)
      return err ? { message: err.message } : null
    })
  }

  async function logHours(row: EquipmentRow) {
    const raw = hoursInput.get(row.id)
    const hours = Number(raw)
    if (!raw || !hours || hours <= 0) {
      setError('Enter hours greater than zero to log.')
      return
    }
    await withBusy(row.id, async () => {
      const { error: err } = await supabase()
        .from('equipment')
        .update({
          hours_total: Number(row.hours_total) + hours,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      return err ? { message: err.message } : null
    })
    setHoursInput((prev) => {
      const next = new Map(prev)
      next.delete(row.id)
      return next
    })
  }

  async function add() {
    if (!form) return
    if (!form.code.trim() || !form.name.trim()) {
      setFormError('Code and name are required.')
      return
    }
    setSaving(true)
    setFormError(null)

    const { error: err } = await supabase()
      .from('equipment')
      .insert({
        company_id: me.company_id,
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type.trim() || null,
        status: form.status,
        service_due: form.serviceDue || null,
        notes: form.notes.trim() || null,
      })

    setSaving(false)
    if (err) {
      // 23505 = unique_violation — the (company_id, code) constraint.
      setFormError(
        err.code === '23505' || /duplicate key/i.test(err.message)
          ? 'That code is already in use.'
          : err.message,
      )
      return
    }
    setForm(null)
    await load()
    onChanged()
  }

  const now = Date.now()

  const underutilised = useMemo(
    () =>
      rows.filter(
        (r) => r.status === 'idle' && r.last_used_at && now - new Date(r.last_used_at).getTime() > IDLE_FLAG_MS,
      ),
    [rows, now],
  )

  const serviceFlags = useMemo(
    () => rows.filter((r) => r.service_due && new Date(r.service_due).getTime() - now <= SERVICE_WARN_MS),
    [rows, now],
  )

  const totals = useMemo(
    () => ({
      total: rows.length,
      inUse: rows.filter((r) => r.status === 'in_use').length,
      idle: rows.filter((r) => r.status === 'idle').length,
      serviceDue: serviceFlags.length,
    }),
    [rows, serviceFlags],
  )

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Equipment</h1>
          <span style={{ fontSize: 13, color: theme.inkSoft }}>{rows.length}</span>
          {canEdit && !form && (
            <button onClick={() => setForm(blankForm)} style={{ ...cta, marginLeft: 'auto' }}>
              ADD EQUIPMENT
            </button>
          )}
        </div>

        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: theme.alert }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ ...statCard, minWidth: 130 }}>
            <div style={statLabel}>Total machines</div>
            <div style={statValue}>{totals.total}</div>
          </div>
          <div style={{ ...statCard, minWidth: 130 }}>
            <div style={statLabel}>In use</div>
            <div style={{ ...statValue, color: '#1B7A32' }}>{totals.inUse}</div>
          </div>
          <div style={{ ...statCard, minWidth: 130 }}>
            <div style={statLabel}>Idle</div>
            <div style={statValue}>{totals.idle}</div>
          </div>
          <div style={{ ...statCard, minWidth: 130 }}>
            <div style={statLabel}>Maintenance due</div>
            <div style={{ ...statValue, color: totals.serviceDue > 0 ? '#8A6100' : theme.ink }}>
              {totals.serviceDue}
            </div>
          </div>
        </div>

        {(underutilised.length > 0 || serviceFlags.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {underutilised.map((r) => {
              const days = Math.floor((now - new Date(r.last_used_at!).getTime()) / 86_400_000)
              return (
                <div key={`idle-${r.id}`} style={{ ...flag, background: '#FFF6DF', color: '#8A6100' }}>
                  <strong>{r.name}</strong> ({r.code}) has been idle {days} days at {siteName(r.site_id)}
                  — parked money.
                </div>
              )
            })}
            {serviceFlags.map((r) => {
              const overdue = new Date(r.service_due!).getTime() < now
              return (
                <div
                  key={`svc-${r.id}`}
                  style={{ ...flag, background: overdue ? '#FCE8EA' : '#FFF6DF', color: overdue ? theme.alert : '#8A6100' }}
                >
                  <strong>{r.name}</strong> ({r.code}) —{' '}
                  {overdue ? 'service is overdue' : 'service due'} {new Date(r.service_due!).toLocaleDateString()}.
                </div>
              )
            })}
          </div>
        )}

        {form && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New equipment</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="EX-104" width={110} />
              <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Mini excavator" width={200} />
              <Field label="Type" value={form.type} onChange={(v) => setForm({ ...form, type: v })} placeholder="Excavator" width={160} />
              <label style={label}>
                Status
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as EquipmentRow['status'] })}
                  style={{ ...field, width: 140 }}
                >
                  {(['idle', 'in_use', 'maintenance'] as const).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={label}>
                Service due
                <input
                  type="date"
                  value={form.serviceDue}
                  onChange={(e) => setForm({ ...form, serviceDue: e.target.value })}
                  style={{ ...field, width: 150 }}
                />
              </label>
            </div>
            <label style={{ ...label, display: 'block', marginTop: 8 }}>
              Notes
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional"
                rows={2}
                style={{ ...field, width: '100%', height: 'auto', padding: 9, resize: 'vertical' }}
              />
            </label>

            {formError && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{formError}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void add()} disabled={saving} style={cta}>
                {saving ? 'SAVING…' : 'ADD EQUIPMENT'}
              </button>
              <button onClick={() => setForm(null)} style={ghost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ ...card, padding: 0, overflow: 'hidden', marginTop: 14 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
              <thead>
                <tr>
                  {['Code', 'Name', 'Type', 'Site', 'Operator', 'Status', 'Hours', 'Service due', 'Last used', ''].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={10} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                      No equipment yet.
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const busy = savingIds.has(row.id)
                  const status = STATUS_META[row.status]
                  return (
                    <tr key={row.id}>
                      <td style={{ ...td, fontWeight: 500 }}>{row.code}</td>
                      <td style={td}>{row.name}</td>
                      <td style={{ ...td, color: theme.inkSoft }}>{row.type || '—'}</td>
                      <td style={td}>
                        {canEdit ? (
                          <select
                            value={row.site_id ?? ''}
                            disabled={busy}
                            onChange={(e) => void updateField(row.id, { site_id: e.target.value || null })}
                            style={rowSelect}
                          >
                            <option value="">Unassigned</option>
                            {sites.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          siteName(row.site_id)
                        )}
                      </td>
                      <td style={td}>
                        {canEdit ? (
                          <select
                            value={row.operator_id ?? ''}
                            disabled={busy}
                            onChange={(e) => void updateField(row.id, { operator_id: e.target.value || null })}
                            style={rowSelect}
                          >
                            <option value="">Unassigned</option>
                            {workers.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          workers.find((w) => w.id === row.operator_id)?.name ?? '—'
                        )}
                      </td>
                      <td style={td}>
                        {canEdit ? (
                          <select
                            value={row.status}
                            disabled={busy}
                            onChange={(e) => void updateField(row.id, { status: e.target.value as EquipmentRow['status'] })}
                            style={{ ...rowSelect, background: status.bg, color: status.color, fontWeight: 600, border: 'none' }}
                          >
                            {(['in_use', 'idle', 'maintenance'] as const).map((s) => (
                              <option key={s} value={s}>
                                {STATUS_META[s].label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600, background: status.bg, color: status.color }}>
                            {status.label}
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Number(row.hours_total).toFixed(1)}
                      </td>
                      <td style={{ ...td, color: theme.inkSoft }}>
                        {row.service_due ? new Date(row.service_due).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...td, color: theme.inkSoft }}>
                        {row.last_used_at ? new Date(row.last_used_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {canEdit && (
                          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              placeholder="hrs"
                              value={hoursInput.get(row.id) ?? ''}
                              onChange={(e) =>
                                setHoursInput((prev) => new Map(prev).set(row.id, e.target.value))
                              }
                              style={hoursField}
                            />
                            <button onClick={() => void logHours(row)} disabled={busy} style={ghost}>
                              Log
                            </button>
                          </div>
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
    </div>
  )
}

function Field({
  label: labelText,
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
    <label style={label}>
      {labelText}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...field, width }}
      />
    </label>
  )
}

const flag = {
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 12.5,
  lineHeight: 1.5,
} as const

const card = {
  marginTop: 14,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const statCard = {
  padding: '10px 14px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const statLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
}

const statValue = {
  fontSize: 22,
  fontWeight: 600,
  marginTop: 4,
  fontVariantNumeric: 'tabular-nums' as const,
}

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

const field = {
  display: 'block',
  height: 32,
  padding: '0 9px',
  marginTop: 4,
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const label = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
} as const

const rowSelect = {
  height: 28,
  padding: '0 6px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 12.5,
  color: theme.ink,
  maxWidth: 140,
} as const

const hoursField = {
  width: 52,
  height: 26,
  padding: '0 6px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 12,
  color: theme.ink,
} as const
