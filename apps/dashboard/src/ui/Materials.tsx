import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type MaterialRow, type ShiftRow, type WorkerRow } from '../data/supabase'
import { costCodes } from '../data/seed'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Materials, costed per job.
 *
 * The list is only half of it — the point is the roll-up at the top. Labour
 * comes from approved and unapproved shifts at each worker's rate, materials
 * from this table, other spend from the expense ledger, and the three together
 * are what the job has actually cost against its budget. That's the number an
 * owner is really asking for when they ask where the money went.
 */

const UNITS = ['ea', 'lm', 'm', 'm²', 'm³', 'kg', 't', 'L', 'box', 'pack', 'sheet', 'hr']
const STATUSES = ['ordered', 'delivered', 'used', 'returned'] as const

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const money2 = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const blank = {
  name: '',
  quantity: '1',
  unit: 'ea',
  unitCost: '',
  supplier: '',
  costCode: '',
  status: 'delivered' as (typeof STATUSES)[number],
  deliveredOn: new Date().toISOString().slice(0, 10),
  note: '',
}

type Draft = typeof blank & { id?: string }

export function Materials({
  me,
  sites,
  workers,
  onChanged,
}: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [siteId, setSiteId] = useState<string>('')
  const [rows, setRows] = useState<MaterialRow[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [otherSpend, setOtherSpend] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  // Default to the first active site once sites arrive.
  useEffect(() => {
    if (!siteId && sites.length) setSiteId(sites[0].id)
  }, [sites, siteId])

  const load = useCallback(async () => {
    if (!siteId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const client = supabase()

    const [mat, shf, exp] = await Promise.all([
      client.from('materials').select('*').eq('site_id', siteId).order('delivered_on', { ascending: false }),
      client.from('shifts').select('*').eq('site_id', siteId),
      // Expenses already linked to a material line would double-count, so only
      // unlinked spend counts as "other".
      client.from('expenses').select('amount, id').eq('site_id', siteId),
    ])

    const firstError = mat.error ?? shf.error ?? exp.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const materials = (mat.data ?? []) as MaterialRow[]
    setRows(materials)
    setShifts((shf.data ?? []) as ShiftRow[])

    const linked = new Set(materials.map((m) => m.expense_id).filter(Boolean))
    const spend = ((exp.data ?? []) as Array<{ amount: number; id: string }>)
      .filter((e) => !linked.has(e.id))
      .reduce((sum, e) => sum + Number(e.amount), 0)
    setOtherSpend(spend)
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  const site = sites.find((s) => s.id === siteId) ?? null
  const rateOf = (id: string) => workers.find((w) => w.id === id)?.rate ?? 0

  const cost = useMemo(() => {
    const labour = shifts.reduce((sum, s) => {
      const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now()
      const hours = Math.max(0, (end - new Date(s.started_at).getTime()) / 3_600_000)
      return sum + hours * rateOf(s.worker_id)
    }, 0)
    // Returned stock is money back on the shelf, not money spent.
    const materials = rows
      .filter((r) => r.status !== 'returned')
      .reduce((sum, r) => sum + Number(r.total_cost), 0)
    const total = labour + materials + otherSpend
    const budget = site?.budget ?? null
    return {
      labour,
      materials,
      other: otherSpend,
      total,
      budget,
      remaining: budget === null ? null : budget - total,
      pct: budget && budget > 0 ? Math.min(150, (total / budget) * 100) : null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, shifts, otherSpend, site, workers])

  /** Materials grouped by cost code — where the money went, not just how much. */
  const byCode = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      if (r.status === 'returned') continue
      const key = r.cost_code || 'Uncoded'
      map.set(key, (map.get(key) ?? 0) + Number(r.total_cost))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  async function save() {
    if (!draft?.name.trim() || !siteId) {
      setError('A material name is required.')
      return
    }
    setBusy(true)
    setError(null)

    // total_cost is generated in Postgres; writing it would be rejected.
    const row = {
      company_id: me.company_id,
      site_id: siteId,
      name: draft.name.trim(),
      quantity: Number(draft.quantity) || 0,
      unit: draft.unit,
      unit_cost: Number(draft.unitCost) || 0,
      supplier: draft.supplier.trim() || null,
      cost_code: draft.costCode || null,
      status: draft.status,
      delivered_on: draft.deliveredOn || null,
      note: draft.note.trim() || null,
      created_by: me.id,
    }

    const client = supabase()
    const { error: err } = draft.id
      ? await client.from('materials').update(row).eq('id', draft.id)
      : await client.from('materials').insert(row)

    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setDraft(null)
    await load()
    onChanged()
  }

  async function remove(id: string) {
    setBusy(true)
    const { error: err } = await supabase().from('materials').delete().eq('id', id)
    setBusy(false)
    if (err) setError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  async function setBudget(value: string) {
    if (!siteId) return
    const amount = value.trim() === '' ? null : Number(value)
    if (amount !== null && !Number.isFinite(amount)) return
    const { error: err } = await supabase()
      .from('job_sites')
      .update({ budget: amount })
      .eq('id', siteId)
    if (err) setError(err.message)
    else onChanged()
  }

  const canEdit = me.is_office

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Materials</h1>
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            style={{ ...input, width: 220, marginTop: 0 }}
          >
            {sites.length === 0 && <option value="">No job sites yet</option>}
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11.5, color: theme.inkSoft }}>
            Costed against this job.
          </span>
          {canEdit && siteId && !draft && (
            <button onClick={() => setDraft({ ...blank })} style={{ ...cta, marginLeft: 'auto' }}>
              ADD MATERIAL
            </button>
          )}
        </div>

        {/* Job cost roll-up */}
        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 0, padding: 0 }}>
          {(
            [
              ['Labour', cost.labour, theme.ink],
              ['Materials', cost.materials, theme.ink],
              ['Other spend', cost.other, theme.ink],
              ['Job cost to date', cost.total, theme.ink],
            ] as Array<[string, number, string]>
          ).map(([label, value, colour], i) => (
            <div
              key={label}
              style={{
                flex: '1 1 150px',
                padding: '11px 16px',
                borderLeft: i === 0 ? 'none' : `1px solid ${theme.border}`,
              }}
            >
              <div style={statLabel}>{label}</div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 600,
                  marginTop: 3,
                  fontVariantNumeric: 'tabular-nums',
                  color: colour,
                }}
              >
                {money(value)}
              </div>
            </div>
          ))}
          <div style={{ flex: '1 1 200px', padding: '11px 16px', borderLeft: `1px solid ${theme.border}` }}>
            <div style={statLabel}>Budget</div>
            {canEdit ? (
              <input
                key={siteId + String(site?.budget)}
                defaultValue={site?.budget ?? ''}
                onBlur={(e) => void setBudget(e.target.value)}
                placeholder="Set a budget"
                style={{ ...input, marginTop: 3, height: 26, fontSize: 15, fontWeight: 600 }}
              />
            ) : (
              <div style={{ fontSize: 19, fontWeight: 600, marginTop: 3 }}>
                {site?.budget ? money(site.budget) : '—'}
              </div>
            )}
            {cost.remaining !== null && (
              <div
                style={{
                  fontSize: 11.5,
                  marginTop: 4,
                  color: cost.remaining < 0 ? theme.alert : theme.inkSoft,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {cost.remaining < 0
                  ? `${money(Math.abs(cost.remaining))} over`
                  : `${money(cost.remaining)} remaining`}
              </div>
            )}
          </div>
        </div>

        {cost.pct !== null && (
          <div style={{ height: 6, background: theme.border, borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, cost.pct)}%`,
                height: '100%',
                background: cost.pct > 100 ? theme.alert : cost.pct > 85 ? theme.warning : theme.success,
              }}
            />
          </div>
        )}

        {byCode.length > 0 && (
          <div style={card}>
            <div style={{ ...statLabel, marginBottom: 8 }}>MATERIALS BY COST CODE</div>
            {byCode.map(([code, amount]) => {
              const label = costCodes.find((c) => c.code === code)?.name
              const share = cost.materials > 0 ? (amount / cost.materials) * 100 : 0
              return (
                <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
                  <span style={{ width: 190, fontSize: 12.5 }}>
                    {code}
                    {label && <span style={{ color: theme.inkFaint }}> · {label}</span>}
                  </span>
                  <span style={{ flex: 1, height: 8, background: theme.appBg, borderRadius: 4 }}>
                    <span
                      style={{
                        display: 'block',
                        width: `${share}%`,
                        height: '100%',
                        background: theme.accent,
                        borderRadius: 4,
                      }}
                    />
                  </span>
                  <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', width: 90, textAlign: 'right' }}>
                    {money2(amount)}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {draft && (
          <div style={card}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Material" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="90x45 MGP10 pine" width={230} />
              <Field label="Quantity" value={draft.quantity} onChange={(v) => setDraft({ ...draft, quantity: v })} width={90} />
              <label style={fieldLabel}>
                Unit
                <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} style={{ ...input, width: 90 }}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
              <Field label="Unit cost" value={draft.unitCost} onChange={(v) => setDraft({ ...draft, unitCost: v })} placeholder="8.42" width={110} />
              <Field label="Supplier" value={draft.supplier} onChange={(v) => setDraft({ ...draft, supplier: v })} placeholder="Bunnings" width={170} />
              <label style={fieldLabel}>
                Cost code
                <select value={draft.costCode} onChange={(e) => setDraft({ ...draft, costCode: e.target.value })} style={{ ...input, width: 190 }}>
                  <option value="">Uncoded</option>
                  {costCodes.map((c) => (
                    <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                  ))}
                </select>
              </label>
              <label style={fieldLabel}>
                Status
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft['status'] })}
                  style={{ ...input, width: 120 }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label style={fieldLabel}>
                Delivered
                <input
                  type="date"
                  value={draft.deliveredOn}
                  onChange={(e) => setDraft({ ...draft, deliveredOn: e.target.value })}
                  style={{ ...input, width: 150 }}
                />
              </label>
            </div>

            <div style={{ marginTop: 12, fontSize: 13 }}>
              Line total{' '}
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                {money2((Number(draft.quantity) || 0) * (Number(draft.unitCost) || 0))}
              </strong>
            </div>

            {error && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void save()} disabled={busy} style={cta}>
                {busy ? 'SAVING…' : draft.id ? 'SAVE CHANGES' : 'ADD TO JOB'}
              </button>
              <button onClick={() => { setDraft(null); setError(null) }} style={ghost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && !draft && (
          <div style={{ ...card, color: theme.alert, fontSize: 12.5 }}>{error}</div>
        )}

        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Material', 'Supplier', 'Cost code', 'Qty', 'Unit cost', 'Total', 'Status', 'Delivered', ''].map(
                  (h, i) => (
                    <th key={h + i} style={{ ...th, textAlign: i >= 3 && i <= 5 ? 'right' : 'left' }}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} style={{ ...td, color: theme.inkSoft, padding: 20 }}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...td, color: theme.inkSoft, padding: 20 }}>
                    {siteId
                      ? 'Nothing logged against this job yet. Add what has been delivered and it lands in the cost above.'
                      : 'Add a job site first.'}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.status === 'returned' ? 0.55 : 1 }}>
                  <td style={{ ...td, fontWeight: 500 }}>
                    {r.name}
                    {r.note && (
                      <span style={{ display: 'block', fontSize: 11, color: theme.inkFaint }}>{r.note}</span>
                    )}
                  </td>
                  <td style={{ ...td, color: theme.inkSoft }}>{r.supplier ?? '—'}</td>
                  <td style={{ ...td, color: theme.inkSoft, fontSize: 12 }}>{r.cost_code ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {Number(r.quantity)} {r.unit}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {money2(Number(r.unit_cost))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {money2(Number(r.total_cost))}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 7px',
                        borderRadius: 3,
                        fontSize: 11,
                        background:
                          r.status === 'delivered' || r.status === 'used' ? '#EAF7EE' : theme.appBg,
                        color:
                          r.status === 'delivered' || r.status === 'used' ? '#1B7A32' : theme.inkSoft,
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={{ ...td, color: theme.inkSoft }}>
                    {r.delivered_on ? new Date(r.delivered_on).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <>
                        <button
                          onClick={() =>
                            setDraft({
                              id: r.id,
                              name: r.name,
                              quantity: String(r.quantity),
                              unit: r.unit,
                              unitCost: String(r.unit_cost),
                              supplier: r.supplier ?? '',
                              costCode: r.cost_code ?? '',
                              status: r.status,
                              deliveredOn: r.delivered_on ?? '',
                              note: r.note ?? '',
                            })
                          }
                          style={ghost}
                        >
                          Edit
                        </button>{' '}
                        <button onClick={() => void remove(r.id)} style={{ ...ghost, color: theme.alert }}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 20,
                padding: '10px 14px',
                background: theme.appBg,
                fontSize: 12.5,
              }}
            >
              <span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{rows.length}</strong> line
                {rows.length === 1 ? '' : 's'}
              </span>
              <span>
                Materials{' '}
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money2(cost.materials)}</strong>
              </span>
              <span style={{ marginLeft: 'auto', color: theme.inkSoft }}>
                Returned stock is excluded from the job cost.
              </span>
            </div>
          )}
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
    <label style={fieldLabel}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...input, width }}
      />
    </label>
  )
}

const statLabel = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
}

const fieldLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
}

const input = {
  display: 'block',
  height: 32,
  marginTop: 4,
  padding: '0 9px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: 0,
  textTransform: 'none' as const,
  color: theme.ink,
}

const card = {
  marginTop: 14,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
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
