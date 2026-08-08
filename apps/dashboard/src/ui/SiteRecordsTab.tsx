import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  supabase,
  type DefectRow,
  type ProgressEntryRow,
  type SiteInstructionRow,
  type SiteProgressRow,
  type WaterproofingRow,
  type WorkerRow,
} from '../data/supabase'
import { waterproofingPdf, type CompanyDetails } from '../data/documents'
import { downloadPdf } from '../data/pdf'
import { fullDate, money2 } from '../format'
import { theme } from '../theme'
import type { JobSite } from '../types'
import {
  Chip,
  Empty,
  Fact,
  FactGrid,
  Field,
  LABEL,
  ListRow,
  Note,
  Panel,
  PanelHead,
  SubTabs,
  TAB_PAD,
  ctaStyle,
  fieldStyle,
  ghostStyle,
} from './kit'

/**
 * The four records a tiling subcontractor is actually held to on a job:
 * instructions received, defects raised, progress measured, and waterproofing
 * signed off.
 *
 * They live on one tab rather than four because they are one conversation. The
 * builder's supervisor gives an instruction, it turns out to be extra scope, it
 * becomes a variation; a defect gets raised against work that a progress claim
 * already billed; a wet area cannot be claimed complete until its membrane is
 * signed off. Splitting them across four screens is how each gets looked at
 * alone, which is how the connections get missed.
 */

type Section = 'defects' | 'instructions' | 'progress' | 'waterproofing'

const DEFECT_STATUS: Record<DefectRow['status'], { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: theme.alertFill, fg: theme.alertInk },
  in_progress: { label: 'In progress', bg: theme.warnFill, fg: theme.warnInk },
  fixed: { label: 'Fixed', bg: theme.accentFill, fg: theme.accent },
  rejected: { label: 'Not ours', bg: theme.fill, fg: theme.inkSoft },
  verified: { label: 'Verified', bg: theme.successFill, fg: theme.successInk },
}

const SEVERITY: Record<DefectRow['severity'], string> = {
  minor: theme.inkSoft,
  major: theme.warnInk,
  critical: theme.alert,
}

const INSTRUCTION_STATUS: Record<SiteInstructionRow['status'], { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: theme.warnFill, fg: theme.warnInk },
  actioned: { label: 'Actioned', bg: theme.successFill, fg: theme.successInk },
  disputed: { label: 'Disputed', bg: theme.alertFill, fg: theme.alertInk },
  closed: { label: 'Closed', bg: theme.fill, fg: theme.inkSoft },
}

const WP_STATUS: Record<WaterproofingRow['status'], { label: string; bg: string; fg: string }> = {
  planned: { label: 'Planned', bg: theme.fill, fg: theme.inkSoft },
  in_progress: { label: 'In progress', bg: theme.warnFill, fg: theme.warnInk },
  complete: { label: 'Complete, unsigned', bg: theme.accentFill, fg: theme.accent },
  signed_off: { label: 'Signed off', bg: theme.successFill, fg: theme.successInk },
  failed: { label: 'Failed', bg: theme.alertFill, fg: theme.alertInk },
}

const HOW: Record<SiteInstructionRow['how'], string> = {
  verbal: 'Verbal',
  email: 'Email',
  site_meeting: 'Site meeting',
  written: 'Written',
  drawing: 'Drawing',
}

const today = () => new Date().toISOString().slice(0, 10)

export function SiteRecordsTab({
  me,
  site,
  onChanged,
}: {
  me: WorkerRow
  site: JobSite
  onChanged: () => void
}) {
  const [section, setSection] = useState<Section>('defects')
  const [defects, setDefects] = useState<DefectRow[]>([])
  const [instructions, setInstructions] = useState<SiteInstructionRow[]>([])
  const [progress, setProgress] = useState<ProgressEntryRow[]>([])
  const [rollup, setRollup] = useState<SiteProgressRow | null>(null)
  const [wet, setWet] = useState<WaterproofingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const siteId = site.id
  // A captain's write access is per-job and enforced in RLS; the form is shown
  // to anyone, because ANYONE may raise a defect or record an instruction and
  // that is deliberate (schema_v19). What a worker cannot do is edit one, so
  // the row controls are gated instead.
  const canEdit = me.is_office || me.role === 'captain'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const c = supabase()
    const [d, i, p, r, w] = await Promise.all([
      c.from('defects').select('*').eq('site_id', siteId).order('raised_on', { ascending: false }),
      c.from('site_instructions').select('*').eq('site_id', siteId).order('received_on', { ascending: false }),
      c.from('progress_entries').select('*').eq('site_id', siteId).order('assessed_on', { ascending: false }),
      c.from('site_progress_v').select('*').eq('site_id', siteId).maybeSingle(),
      c.from('waterproofing').select('*').eq('site_id', siteId).order('area'),
    ])
    const first = d.error ?? i.error ?? p.error ?? w.error
    if (first) {
      setError(first.message)
      setLoading(false)
      return
    }
    setDefects((d.data ?? []) as DefectRow[])
    setInstructions((i.data ?? []) as SiteInstructionRow[])
    setProgress((p.data ?? []) as ProgressEntryRow[])
    setRollup((r.data as SiteProgressRow | null) ?? null)
    setWet((w.data ?? []) as WaterproofingRow[])
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setAdding(false)
  }, [siteId, section])

  async function write(table: string, values: Record<string, unknown>) {
    setBusy(true)
    const { error: err } = await supabase().from(table).insert({ company_id: me.company_id, site_id: siteId, ...values })
    setBusy(false)
    if (err) {
      setError(err.message)
      return false
    }
    setAdding(false)
    await load()
    onChanged()
    return true
  }

  async function patch(table: string, id: string, values: Record<string, unknown>) {
    setBusy(true)
    const { error: err } = await supabase().from(table).update(values).eq('id', id)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged()
  }

  /**
   * The certificate, generated from the record rather than typed. Everything on
   * it — batch, coats, flood test, who signed and when — is a fact captured
   * before the membrane was covered, which is the only reason the record exists.
   */
  async function certificate(w: WaterproofingRow) {
    setBusy(true)
    const c = supabase()
    const [{ data: company }, { count }, { data: siteRow }] = await Promise.all([
      c.from('companies').select('*').eq('id', me.company_id).maybeSingle(),
      c.from('waterproofing_photos').select('id', { count: 'exact', head: true }).eq('waterproofing_id', w.id),
      c.from('job_sites').select('address, client_name').eq('id', siteId).maybeSingle(),
    ])
    setBusy(false)
    if (!company) {
      setError('Could not read the company details the certificate needs.')
      return
    }
    const sr = siteRow as { address: string | null; client_name: string | null } | null
    downloadPdf(
      waterproofingPdf({
        company: company as CompanyDetails,
        record: w,
        siteName: site.name,
        siteAddress: sr?.address ?? null,
        builderName: sr?.client_name ?? null,
        photoCount: count ?? 0,
      }),
      `${w.certificate_no ?? 'waterproofing'}-${w.area}.pdf`,
    )
  }

  const openDefects = defects.filter((d) => d.status === 'open' || d.status === 'in_progress')
  const openInstructions = instructions.filter((i) => i.status === 'open')
  const unsignedWet = wet.filter((w) => w.status !== 'signed_off')

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.inkSoft, fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: theme.alertFill, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12.5, color: theme.alertInk }}>
          {error}
        </div>
      )}

      <SubTabs
        active={section}
        onChange={setSection}
        tabs={[
          { key: 'defects', label: 'Defects', count: openDefects.length, tone: 'alert' },
          { key: 'instructions', label: 'Instructions', count: openInstructions.length, tone: 'warn' },
          { key: 'progress', label: 'Progress' },
          { key: 'waterproofing', label: 'Waterproofing', count: unsignedWet.length, tone: 'warn' },
        ]}
      />

      {section === 'defects' && (
        <Defects
          rows={defects}
          canEdit={canEdit}
          busy={busy}
          adding={adding}
          onAdd={() => setAdding(true)}
          onCancel={() => setAdding(false)}
          onCreate={(v) => write('defects', { ...v, created_by: me.id })}
          onPatch={(id, v) => patch('defects', id, v)}
          meId={me.id}
        />
      )}

      {section === 'instructions' && (
        <Instructions
          rows={instructions}
          canEdit={canEdit}
          busy={busy}
          adding={adding}
          onAdd={() => setAdding(true)}
          onCancel={() => setAdding(false)}
          onCreate={(v) => write('site_instructions', { ...v, raised_by: me.id })}
          onPatch={(id, v) => patch('site_instructions', id, v)}
        />
      )}

      {section === 'progress' && (
        <Progress
          rows={progress}
          rollup={rollup}
          canEdit={canEdit}
          busy={busy}
          adding={adding}
          onAdd={() => setAdding(true)}
          onCancel={() => setAdding(false)}
          onCreate={(v) => write('progress_entries', { ...v, assessed_by: me.id })}
        />
      )}

      {section === 'waterproofing' && (
        <Waterproofing
          rows={wet}
          canEdit={canEdit}
          busy={busy}
          adding={adding}
          onAdd={() => setAdding(true)}
          onCancel={() => setAdding(false)}
          onCreate={(v) => write('waterproofing', { ...v, created_by: me.id })}
          onPatch={(id, v) => patch('waterproofing', id, v)}
          onCertificate={(w) => void certificate(w)}
          meId={me.id}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- defects

function Defects({
  rows,
  canEdit,
  busy,
  adding,
  meId,
  onAdd,
  onCancel,
  onCreate,
  onPatch,
}: {
  rows: DefectRow[]
  canEdit: boolean
  busy: boolean
  adding: boolean
  meId: string
  onAdd: () => void
  onCancel: () => void
  onCreate: (v: Record<string, unknown>) => Promise<boolean>
  onPatch: (id: string, v: Record<string, unknown>) => void
}) {
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<DefectRow['severity']>('minor')
  const [responsible, setResponsible] = useState<DefectRow['responsible']>('us')
  const [dueOn, setDueOn] = useState('')

  const counts = useMemo(() => {
    // Whose it is, which is the question that decides who pays to fix it. A
    // tiler's defect list is routinely half other trades' damage.
    const ours = rows.filter((r) => r.responsible === 'us' && r.status !== 'rejected').length
    const theirs = rows.length - ours
    const cost = rows
      .filter((r) => r.responsible === 'us' && r.status !== 'verified' && r.status !== 'rejected')
      .reduce((t, r) => t + Number(r.cost_estimate ?? 0), 0)
    return { ours, theirs, cost }
  }, [rows])

  return (
    <>
      <Panel style={{ marginBottom: 14 }}>
        <PanelHead
          right={
            !adding ? (
              <button onClick={onAdd} style={ctaStyle}>
                RAISE A DEFECT
              </button>
            ) : undefined
          }
        >
          Defects
        </PanelHead>

        <FactGrid min={160}>
          <Fact k="OPEN" v={String(rows.filter((r) => r.status === 'open' || r.status === 'in_progress').length)} note="not yet fixed" />
          <Fact k="OURS TO FIX" v={String(counts.ours)} note={`${counts.theirs} down to someone else`} />
          <Fact
            k="COST TO CLEAR"
            v={counts.cost > 0 ? money2(counts.cost) : '—'}
            note={counts.cost > 0 ? 'estimated, ours only' : 'no estimates recorded'}
          />
          <Fact
            k="VERIFIED"
            v={String(rows.filter((r) => r.status === 'verified').length)}
            note="signed off by us"
          />
        </FactGrid>

        {adding && (
          <div style={{ padding: '13px 15px', borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Where" width={190}>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ensuite, Lot 42" style={fieldStyle} />
              </Field>
              <Field label="Severity" width={130}>
                <select value={severity} onChange={(e) => setSeverity(e.target.value as DefectRow['severity'])} style={fieldStyle}>
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                  <option value="critical">Critical</option>
                </select>
              </Field>
              <Field label="Whose is it" width={160}>
                <select value={responsible} onChange={(e) => setResponsible(e.target.value as DefectRow['responsible'])} style={fieldStyle}>
                  <option value="us">Ours to fix</option>
                  <option value="other_trade">Another trade</option>
                  <option value="builder">The builder</option>
                  <option value="client">The client</option>
                  <option value="unknown">Not sure yet</option>
                </select>
              </Field>
              <Field label="Due" width={150}>
                <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} style={fieldStyle} />
              </Field>
            </div>
            <Field label="What is wrong">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Grout cracked along the hob, full length"
                style={{ ...fieldStyle, height: 'auto', padding: 9, resize: 'vertical' }}
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                disabled={busy || !description.trim()}
                style={{ ...ctaStyle, opacity: busy || !description.trim() ? 0.5 : 1 }}
                onClick={async () => {
                  const ok = await onCreate({
                    location: location.trim() || null,
                    description: description.trim(),
                    severity,
                    responsible,
                    due_on: dueOn || null,
                    created_by: meId,
                  })
                  if (ok) {
                    setLocation('')
                    setDescription('')
                    setDueOn('')
                  }
                }}
              >
                {busy ? 'SAVING…' : 'RAISE IT'}
              </button>
              <button onClick={onCancel} style={ghostStyle}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        {rows.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty>
              Nothing raised on this job. Anyone on site can raise a defect — the person standing in front of it is
              worth more than the office finding it three weeks later.
            </Empty>
          </div>
        ) : (
          rows.map((d) => {
            const st = DEFECT_STATUS[d.status]
            return (
              <ListRow key={d.id} columns="150px 1fr 110px 120px 132px">
                <span style={{ fontSize: 12.5, fontWeight: 600, color: theme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.location || '—'}
                </span>
                <span style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.description}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: SEVERITY[d.severity], textTransform: 'capitalize' }}>
                  {d.severity}
                </span>
                <span style={{ fontSize: 11.5, color: LABEL }}>
                  {d.responsible === 'us' ? 'Ours' : d.responsible === 'other_trade' ? 'Another trade' : d.responsible}
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
                  {canEdit ? (
                    <select
                      value={d.status}
                      onChange={(e) => {
                        const status = e.target.value as DefectRow['status']
                        onPatch(d.id, {
                          status,
                          // Dating the fix and the verification here rather than
                          // asking for them: a defect list is only useful if the
                          // dates are real, and nobody back-fills them later.
                          fixed_on: status === 'fixed' || status === 'verified' ? (d.fixed_on ?? today()) : null,
                          verified_on: status === 'verified' ? today() : null,
                          verified_by: status === 'verified' ? meId : null,
                        })
                      }}
                      style={{ ...fieldStyle, marginTop: 0, height: 26, fontSize: 11.5, width: 130 }}
                    >
                      {(Object.keys(DEFECT_STATUS) as Array<DefectRow['status']>).map((s) => (
                        <option key={s} value={s}>
                          {DEFECT_STATUS[s].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Chip {...st} />
                  )}
                </span>
              </ListRow>
            )
          })
        )}
      </Panel>
    </>
  )
}

// ----------------------------------------------------------- instructions

function Instructions({
  rows,
  canEdit,
  busy,
  adding,
  onAdd,
  onCancel,
  onCreate,
  onPatch,
}: {
  rows: SiteInstructionRow[]
  canEdit: boolean
  busy: boolean
  adding: boolean
  onAdd: () => void
  onCancel: () => void
  onCreate: (v: Record<string, unknown>) => Promise<boolean>
  onPatch: (id: string, v: Record<string, unknown>) => void
}) {
  const [fromName, setFromName] = useState('')
  const [how, setHow] = useState<SiteInstructionRow['how']>('verbal')
  const [instruction, setInstruction] = useState('')
  const [isVariation, setIsVariation] = useState(false)
  const [receivedOn, setReceivedOn] = useState(today())

  const unbilled = rows.filter((r) => r.is_variation && !r.change_order_id)

  return (
    <>
      <Panel style={{ marginBottom: 14 }}>
        <PanelHead
          right={
            !adding ? (
              <button onClick={onAdd} style={ctaStyle}>
                RECORD AN INSTRUCTION
              </button>
            ) : undefined
          }
        >
          Site instructions
        </PanelHead>

        {adding && (
          <div style={{ padding: '13px 15px', borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Who gave it" width={200}>
                <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Site supervisor's name" style={fieldStyle} />
              </Field>
              <Field label="How" width={150}>
                <select value={how} onChange={(e) => setHow(e.target.value as SiteInstructionRow['how'])} style={fieldStyle}>
                  {(Object.keys(HOW) as Array<SiteInstructionRow['how']>).map((k) => (
                    <option key={k} value={k}>
                      {HOW[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="When" width={150}>
                <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} style={fieldStyle} />
              </Field>
            </div>
            <Field label="What were you told">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                placeholder="Change the ensuite floor to the 300x600 in the shed, lay it brick bond"
                style={{ ...fieldStyle, height: 'auto', padding: 9, resize: 'vertical' }}
              />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5 }}>
              <input type="checkbox" checked={isVariation} onChange={(e) => setIsVariation(e.target.checked)} />
              This changes the scope — it should become a variation
            </label>
            <span style={{ display: 'block', marginTop: 6, fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
              A verbal instruction that changes scope and never gets written down is work done for free. Recording it
              dated and attributed is the whole point; ticking the box puts it on the list below until a variation is
              raised for it.
            </span>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                disabled={busy || !instruction.trim()}
                style={{ ...ctaStyle, opacity: busy || !instruction.trim() ? 0.5 : 1 }}
                onClick={async () => {
                  const ok = await onCreate({
                    from_name: fromName.trim() || null,
                    how,
                    instruction: instruction.trim(),
                    is_variation: isVariation,
                    received_on: receivedOn,
                  })
                  if (ok) {
                    setInstruction('')
                    setIsVariation(false)
                  }
                }}
              >
                {busy ? 'SAVING…' : 'RECORD IT'}
              </button>
              <button onClick={onCancel} style={ghostStyle}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {unbilled.length > 0 && !adding && (
          <Note tone="warn">
            {unbilled.length} instruction{unbilled.length === 1 ? '' : 's'} marked as changing scope with no variation
            raised against {unbilled.length === 1 ? 'it' : 'them'} yet. Until one is raised and approved, that work adds
            nothing to the contract sum and cannot be billed.
          </Note>
        )}
      </Panel>

      <Panel>
        {rows.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty>
              Nothing recorded. Every direction from the builder that is not written down is a variation you did for
              free — record it the day it happens, while you can still name who said it.
            </Empty>
          </div>
        ) : (
          rows.map((r) => {
            const st = INSTRUCTION_STATUS[r.status]
            return (
              <ListRow key={r.id} columns="110px 130px 1fr 100px 130px">
                <span style={{ fontSize: 12, color: LABEL }}>{fullDate(r.received_on)}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.from_name || 'Unattributed'}
                </span>
                <span style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.instruction}
                </span>
                <span style={{ fontSize: 11.5, color: r.is_variation && !r.change_order_id ? theme.warnInk : LABEL }}>
                  {r.is_variation ? (r.change_order_id ? 'Variation raised' : 'Needs a VO') : HOW[r.how]}
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {canEdit ? (
                    <select
                      value={r.status}
                      onChange={(e) => onPatch(r.id, { status: e.target.value })}
                      style={{ ...fieldStyle, marginTop: 0, height: 26, fontSize: 11.5, width: 128 }}
                    >
                      {(Object.keys(INSTRUCTION_STATUS) as Array<SiteInstructionRow['status']>).map((s) => (
                        <option key={s} value={s}>
                          {INSTRUCTION_STATUS[s].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Chip {...st} />
                  )}
                </span>
              </ListRow>
            )
          })
        )}
      </Panel>
    </>
  )
}

// --------------------------------------------------------------- progress

function Progress({
  rows,
  rollup,
  canEdit,
  busy,
  adding,
  onAdd,
  onCancel,
  onCreate,
}: {
  rows: ProgressEntryRow[]
  rollup: SiteProgressRow | null
  canEdit: boolean
  busy: boolean
  adding: boolean
  onAdd: () => void
  onCancel: () => void
  onCreate: (v: Record<string, unknown>) => Promise<boolean>
}) {
  const [area, setArea] = useState('')
  const [unit, setUnit] = useState<ProgressEntryRow['unit']>('m2')
  const [quantity, setQuantity] = useState('')
  const [pct, setPct] = useState('')

  // The newest assessment per area is the live one; the rest are history.
  const latest = useMemo(() => {
    const seen = new Map<string, ProgressEntryRow>()
    for (const r of rows) if (!seen.has(r.area)) seen.set(r.area, r)
    return [...seen.values()]
  }, [rows])

  return (
    <>
      <Panel style={{ marginBottom: 14 }}>
        <PanelHead
          right={
            canEdit && !adding ? (
              <button onClick={onAdd} style={ctaStyle}>
                ASSESS AN AREA
              </button>
            ) : undefined
          }
        >
          Progress
        </PanelHead>

        <FactGrid min={160}>
          <Fact
            k="COMPLETE"
            v={rollup ? `${Number(rollup.pct_complete)}%` : '—'}
            note={rollup ? 'weighted by area, not averaged' : 'nothing assessed yet'}
          />
          <Fact k="AREAS" v={rollup ? String(rollup.area_count) : '0'} note="assessed at least once" />
          <Fact
            k="MEASURED"
            v={rollup && Number(rollup.total_quantity) > 0 ? `${Number(rollup.done_quantity)} / ${Number(rollup.total_quantity)}` : '—'}
            note="done against total"
          />
          <Fact
            k="LAST LOOKED AT"
            v={rollup?.last_assessed_on ? fullDate(rollup.last_assessed_on) : '—'}
            note={rollup?.last_assessed_on ? '' : 'never'}
          />
        </FactGrid>

        {adding && (
          <div style={{ padding: '13px 15px', borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Area" width={220}>
                <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ensuite floor" style={fieldStyle} />
              </Field>
              <Field label="Unit" width={110}>
                <select value={unit} onChange={(e) => setUnit(e.target.value as ProgressEntryRow['unit'])} style={fieldStyle}>
                  <option value="m2">m²</option>
                  <option value="lm">lm</option>
                  <option value="item">item</option>
                  <option value="room">room</option>
                  <option value="%">%</option>
                </select>
              </Field>
              <Field label="Total quantity" width={140}>
                <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" placeholder="300" style={{ ...fieldStyle, textAlign: 'right' }} />
              </Field>
              <Field label="% complete" width={120}>
                <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" placeholder="60" style={{ ...fieldStyle, textAlign: 'right' }} />
              </Field>
            </div>
            <span style={{ display: 'block', marginTop: 6, fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
              Give the total quantity even roughly. The job's overall figure is weighted by it — without one, a 2 m²
              powder room counts as much as 300 m² of balconies, which is how a claim ends up ahead of the work.
            </span>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                disabled={busy || !area.trim() || pct === ''}
                style={{ ...ctaStyle, opacity: busy || !area.trim() || pct === '' ? 0.5 : 1 }}
                onClick={async () => {
                  const q = quantity === '' ? null : Number(quantity)
                  const p = Math.max(0, Math.min(100, Number(pct) || 0))
                  const ok = await onCreate({
                    area: area.trim(),
                    unit,
                    quantity: q,
                    // Kept in step so the two can never disagree on one row.
                    done_quantity: q === null ? 0 : Math.round(q * (p / 100) * 100) / 100,
                    pct_complete: p,
                    assessed_on: today(),
                  })
                  if (ok) {
                    setArea('')
                    setQuantity('')
                    setPct('')
                  }
                }}
              >
                {busy ? 'SAVING…' : 'RECORD IT'}
              </button>
              <button onClick={onCancel} style={ghostStyle}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead>Latest per area</PanelHead>
        {latest.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty>
              Nothing measured yet. A progress claim needs to be justifiable line by line if the builder's QS asks —
              this is where those lines come from.
            </Empty>
          </div>
        ) : (
          latest.map((r) => (
            <ListRow key={r.id} columns="1fr 130px 120px 90px 100px">
              <span style={{ fontSize: 13, fontWeight: 500 }}>{r.area}</span>
              <span style={{ fontSize: 12, color: LABEL, fontVariantNumeric: 'tabular-nums' }}>
                {r.quantity === null ? 'no quantity' : `${Number(r.done_quantity)} / ${Number(r.quantity)} ${r.unit}`}
              </span>
              <span aria-hidden style={{ display: 'block', height: 6, borderRadius: 3, background: theme.fill, overflow: 'hidden' }}>
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${Number(r.pct_complete)}%`,
                    background: Number(r.pct_complete) >= 100 ? theme.success : theme.accent,
                  }}
                />
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {Number(r.pct_complete)}%
              </span>
              <span style={{ fontSize: 11.5, color: LABEL, textAlign: 'right' }}>{fullDate(r.assessed_on)}</span>
            </ListRow>
          ))
        )}
      </Panel>
    </>
  )
}

// ---------------------------------------------------------- waterproofing

function Waterproofing({
  rows,
  canEdit,
  busy,
  adding,
  meId,
  onAdd,
  onCancel,
  onCreate,
  onPatch,
  onCertificate,
}: {
  rows: WaterproofingRow[]
  canEdit: boolean
  busy: boolean
  adding: boolean
  meId: string
  onAdd: () => void
  onCancel: () => void
  onCreate: (v: Record<string, unknown>) => Promise<boolean>
  onPatch: (id: string, v: Record<string, unknown>) => void
  onCertificate: (w: WaterproofingRow) => void
}) {
  const [area, setArea] = useState('')
  const [product, setProduct] = useState('')
  const [batch, setBatch] = useState('')
  const [coats, setCoats] = useState('2')
  const [substrate, setSubstrate] = useState('')
  const [wallHeight, setWallHeight] = useState('')

  // A certificate signed off without a flood test or a photo is a certificate
  // that will not survive being asked about. Surfaced, never silently counted.
  const weak = rows.filter((r) => r.status === 'signed_off' && !r.flood_tested)

  return (
    <>
      <Panel style={{ marginBottom: 14 }}>
        <PanelHead
          right={
            canEdit && !adding ? (
              <button onClick={onAdd} style={ctaStyle}>
                ADD A WET AREA
              </button>
            ) : undefined
          }
        >
          Waterproofing — AS 3740
        </PanelHead>

        <FactGrid min={160}>
          <Fact k="WET AREAS" v={String(rows.length)} note="on this job" />
          <Fact
            k="SIGNED OFF"
            v={String(rows.filter((r) => r.status === 'signed_off').length)}
            note="certificate can be issued"
          />
          <Fact
            k="OUTSTANDING"
            v={String(rows.filter((r) => r.status !== 'signed_off').length)}
            note="not defensible yet"
            fg={rows.some((r) => r.status !== 'signed_off') ? theme.warnInk : theme.ink}
          />
          <Fact
            k="FLOOD TESTED"
            v={String(rows.filter((r) => r.flood_tested).length)}
            note="held 24 hours, cl. 3.7"
          />
        </FactGrid>

        {adding && (
          <div style={{ padding: '13px 15px', borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Wet area" width={180}>
                <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ensuite" style={fieldStyle} />
              </Field>
              <Field label="Membrane" width={200}>
                <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Ardex WPM 300" style={fieldStyle} />
              </Field>
              <Field label="Batch number" width={150}>
                <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="off the drum" style={fieldStyle} />
              </Field>
              <Field label="Coats" width={90}>
                <input value={coats} onChange={(e) => setCoats(e.target.value)} inputMode="numeric" style={{ ...fieldStyle, textAlign: 'right' }} />
              </Field>
              <Field label="Substrate" width={170}>
                <input value={substrate} onChange={(e) => setSubstrate(e.target.value)} placeholder="Fibre cement sheet" style={fieldStyle} />
              </Field>
              <Field label="Wall height (mm)" width={150}>
                <input value={wallHeight} onChange={(e) => setWallHeight(e.target.value)} inputMode="numeric" placeholder="1800" style={{ ...fieldStyle, textAlign: 'right' }} />
              </Field>
            </div>
            <span style={{ display: 'block', marginTop: 6, fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
              The batch number matters more than it looks. If a membrane fails in two years the manufacturer's first
              question is which drum it came out of, and by then the only place that answer exists is here.
            </span>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                disabled={busy || !area.trim()}
                style={{ ...ctaStyle, opacity: busy || !area.trim() ? 0.5 : 1 }}
                onClick={async () => {
                  const ok = await onCreate({
                    area: area.trim(),
                    product_name: product.trim() || null,
                    batch_no: batch.trim() || null,
                    coats: Number(coats) || 2,
                    substrate: substrate.trim() || null,
                    wall_height_mm: wallHeight ? Number(wallHeight) : null,
                    installer_id: meId,
                    status: 'in_progress',
                    started_on: today(),
                  })
                  if (ok) {
                    setArea('')
                    setBatch('')
                    setSubstrate('')
                  }
                }}
              >
                {busy ? 'SAVING…' : 'ADD IT'}
              </button>
              <button onClick={onCancel} style={ghostStyle}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {weak.length > 0 && !adding && (
          <Note tone="alert">
            {weak.length} wet area{weak.length === 1 ? '' : 's'} signed off without a recorded flood test. AS 3740
            clause 3.7 wants the membrane held under water for 24 hours, and a certificate that cannot point to one is
            the first thing an insurer will find.
          </Note>
        )}
      </Panel>

      <Panel>
        {rows.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty>
              No wet areas recorded. A membrane is covered by screed and tiles within a day of going in — after that,
              what is written here is the only evidence it was ever done properly.
            </Empty>
          </div>
        ) : (
          rows.map((w) => {
            const st = WP_STATUS[w.status]
            return (
              <div key={w.id} style={{ borderBottom: `1px solid ${theme.borderSoft}` }}>
                <ListRow columns="140px 1fr 120px 110px 140px">
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{w.area}</span>
                  <span style={{ fontSize: 12.5, color: theme.inkMid, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.product_name ?? 'membrane not recorded'}
                    {w.batch_no ? ` · batch ${w.batch_no}` : ''}
                    {` · ${w.coats} coat${w.coats === 1 ? '' : 's'}`}
                  </span>
                  <span style={{ fontSize: 11.5, color: w.flood_tested ? theme.successInk : theme.warnInk }}>
                    {w.flood_tested ? 'Flood tested' : 'No flood test'}
                  </span>
                  <span style={{ fontSize: 11.5, color: LABEL }}>
                    {w.signed_off_at ? fullDate(w.signed_off_at) : w.completed_on ? fullDate(w.completed_on) : '—'}
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Chip {...st} />
                  </span>
                </ListRow>

                {canEdit && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 15px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.inkMid }}>
                      <input
                        type="checkbox"
                        checked={w.flood_tested}
                        onChange={(e) =>
                          onPatch(w.id, {
                            flood_tested: e.target.checked,
                            flood_test_on: e.target.checked ? today() : null,
                            flood_test_hours: e.target.checked ? 24 : null,
                          })
                        }
                      />
                      Flood tested 24 hours
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.inkMid }}>
                      <input
                        type="checkbox"
                        checked={w.angle_fillet}
                        onChange={(e) => onPatch(w.id, { angle_fillet: e.target.checked })}
                      />
                      Angle fillet
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.inkMid }}>
                      <input
                        type="checkbox"
                        checked={w.bond_breaker}
                        onChange={(e) => onPatch(w.id, { bond_breaker: e.target.checked })}
                      />
                      Bond breaker
                    </label>
                    <span style={{ flex: 1 }} />
                    {w.status === 'signed_off' && (
                      <button
                        onClick={() => void onCertificate(w)}
                        disabled={busy}
                        style={ghostStyle}
                        title="The document the builder puts in their handover file"
                      >
                        Certificate
                      </button>
                    )}
                    {w.status !== 'signed_off' ? (
                      <button
                        disabled={busy}
                        onClick={() => onPatch(w.id, { status: 'signed_off' })}
                        style={ctaStyle}
                        title="Signs it in your name, dated now — neither is taken from a form"
                      >
                        SIGN IT OFF
                      </button>
                    ) : (
                      <>
                        <span style={{ fontSize: 11.5, color: theme.successInk }}>
                          Signed by {w.signed_off_name ?? 'unknown'}
                        </span>
                        <button disabled={busy} onClick={() => onPatch(w.id, { status: 'complete' })} style={ghostStyle}>
                          Withdraw
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </Panel>
    </>
  )
}
