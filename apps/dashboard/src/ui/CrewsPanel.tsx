import { useCallback, useEffect, useState } from 'react'
import { supabase, type CrewMemberRow, type CrewRow, type WorkerRow } from '../data/supabase'
import { theme } from '../theme'
import type { Worker } from '../types'
import { Empty, LABEL, Panel, PanelHead, ctaStyle, fieldStyle, ghostStyle } from './kit'

/**
 * Crews — the unit this business actually schedules with.
 *
 * Two tilers and a labourer go to a job together, and the office books the
 * crew, not three people. Booking one still writes one `assignments` row per
 * member (schema_v18): the roster, the notifications and the geofence all work
 * per worker and none of that should be rebuilt to accommodate a grouping. The
 * rows carry the crew_id that made them, so the block can be lifted off a job
 * as the one thing it is.
 *
 * The captain matters beyond the roster. Their scope follows the crew onto
 * whatever job it is booked on, so naming one here is what lets them run that
 * job without being made an owner.
 */

export function CrewsPanel({
  me,
  workers,
  onChanged,
}: {
  me: WorkerRow
  workers: Worker[]
  onChanged: () => void
}) {
  const [crews, setCrews] = useState<CrewRow[]>([])
  const [members, setMembers] = useState<CrewMemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [captainId, setCaptainId] = useState('')

  const canEdit = me.is_office

  const load = useCallback(async () => {
    setLoading(true)
    const c = supabase()
    const [cr, cm] = await Promise.all([
      c.from('crews').select('*').eq('active', true).order('name'),
      c.from('crew_members').select('*'),
    ])
    if (cr.error) {
      setError(cr.error.message)
      setLoading(false)
      return
    }
    setCrews((cr.data ?? []) as CrewRow[])
    setMembers((cm.data ?? []) as CrewMemberRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    const { error: err } = await supabase()
      .from('crews')
      .insert({ company_id: me.company_id, name: name.trim(), captain_id: captainId || null })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setName('')
    setCaptainId('')
    setAdding(false)
    await load()
    onChanged()
  }

  async function toggleMember(crewId: string, workerId: string, on: boolean) {
    setBusy(true)
    const c = supabase()
    const { error: err } = on
      ? await c.from('crew_members').insert({ crew_id: crewId, worker_id: workerId, company_id: me.company_id })
      : await c.from('crew_members').delete().eq('crew_id', crewId).eq('worker_id', workerId)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await load()
  }

  async function setCaptain(crewId: string, workerId: string) {
    setBusy(true)
    const { error: err } = await supabase()
      .from('crews')
      .update({ captain_id: workerId || null })
      .eq('id', crewId)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged()
  }

  if (loading) return null

  return (
    <Panel style={{ marginBottom: 14 }}>
      <PanelHead
        right={
          canEdit && !adding ? (
            <button onClick={() => setAdding(true)} style={ctaStyle}>
              NEW CREW
            </button>
          ) : undefined
        }
      >
        Crews
        <span style={{ fontWeight: 400, fontSize: 12.5, color: LABEL }}> · book them as one on the schedule</span>
      </PanelHead>

      {error && (
        <div style={{ padding: '9px 15px', background: theme.alertFill, fontSize: 12.5, color: theme.alertInk }}>
          {error}
        </div>
      )}

      {adding && (
        <div style={{ padding: '13px 15px', borderBottom: `1px solid ${theme.border}`, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 200px' }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: LABEL }}>
              Crew name
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wet area crew" style={fieldStyle} />
          </label>
          <label style={{ flex: '1 1 200px' }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: LABEL }}>
              Captain
            </span>
            <select value={captainId} onChange={(e) => setCaptainId(e.target.value)} style={fieldStyle}>
              <option value="">No captain</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void create()} disabled={busy || !name.trim()} style={{ ...ctaStyle, opacity: busy || !name.trim() ? 0.5 : 1 }}>
            {busy ? 'SAVING…' : 'CREATE'}
          </button>
          <button onClick={() => setAdding(false)} style={ghostStyle}>
            Cancel
          </button>
        </div>
      )}

      {crews.length === 0 ? (
        <div style={{ padding: 15 }}>
          <Empty>
            No crews yet. A crew is the unit that actually goes to a job — naming one lets the schedule book all of
            them in a single drag, and gives its captain the run of whatever job it lands on.
          </Empty>
        </div>
      ) : (
        crews.map((crew) => {
          const ids = new Set(members.filter((m) => m.crew_id === crew.id).map((m) => m.worker_id))
          return (
            <div key={crew.id} style={{ padding: '12px 15px', borderBottom: `1px solid ${theme.borderSoft}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{crew.name}</span>
                <span style={{ fontSize: 12, color: LABEL }}>
                  {ids.size} {ids.size === 1 ? 'person' : 'people'}
                </span>
                <span style={{ flex: 1 }} />
                {canEdit && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: LABEL }}>
                    Captain
                    <select
                      value={crew.captain_id ?? ''}
                      disabled={busy}
                      onChange={(e) => void setCaptain(crew.id, e.target.value)}
                      style={{ ...fieldStyle, marginTop: 0, height: 28, width: 180 }}
                    >
                      <option value="">Nobody</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                {workers.map((w) => {
                  const on = ids.has(w.id)
                  return (
                    <button
                      key={w.id}
                      disabled={!canEdit || busy}
                      onClick={() => void toggleMember(crew.id, w.id, !on)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 13,
                        border: `1px solid ${on ? theme.accent : theme.border}`,
                        background: on ? theme.accentFill : theme.panel,
                        color: on ? theme.accent : theme.inkSoft,
                        font: 'inherit',
                        fontSize: 11.5,
                        cursor: canEdit ? 'pointer' : 'default',
                      }}
                    >
                      {w.name}
                      {crew.captain_id === w.id && <span style={{ marginLeft: 5, fontWeight: 700 }}>· captain</span>}
                    </button>
                  )
                })}
              </div>

              {crew.captain_id && (
                <p style={{ margin: '8px 0 0', fontSize: 11.5, color: LABEL, lineHeight: 1.45 }}>
                  {workers.find((w) => w.id === crew.captain_id)?.name ?? 'The captain'} can run whichever job this crew
                  is booked on — variations, materials, the daily log and approving the crew's hours. Not pay rates,
                  invoices or contract sums.
                </p>
              )}
            </div>
          )
        })
      )}
    </Panel>
  )
}
