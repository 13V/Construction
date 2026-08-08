import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  supabase,
  type BuilderRow,
  type ChangeOrderRow,
  type ContractRow,
  type InvoiceRow,
  type JobValueRow,
  type WorkerRow,
} from '../data/supabase'
import { fullDate, money, money2 } from '../format'
import { theme } from '../theme'
import type { JobSite } from '../types'

/**
 * The contract for one job: what was signed, what has been approved on top of
 * it, and what is left to claim.
 *
 * This tab exists because the number every commercial screen in the app was
 * measured against — job_sites.contract_value — had no writer anywhere, and
 * even when set it ignored variations entirely. A tiling subcontractor who
 * wins $18k of variations on an $80k bathroom was still being measured against
 * $80k, so margin, "left to claim" and job profitability were all wrong by the
 * exact amount of the work hardest to win.
 *
 * Every figure below is read from `job_value_v`, never recomputed here. The
 * one place a total is worked out is Postgres, so two screens cannot disagree
 * about what a job is worth.
 */

const LABEL = '#8B9096'
const HEAD_BG = '#FAFBFC'
const ROW_BORDER = '#F1F3F5'
const DASH_BORDER = '#C3C9D0'

const CONTRACT_STATUS: Record<ContractRow['status'], { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: theme.fill, fg: theme.inkSoft },
  active: { label: 'Active', bg: theme.successFill, fg: theme.successInk },
  completed: { label: 'Completed', bg: theme.accentFill, fg: theme.accent },
  terminated: { label: 'Terminated', bg: theme.alertFill, fg: theme.alertInk },
}

const VARIATION_STATUS: Record<ChangeOrderRow['status'], { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: theme.fill, fg: theme.inkSoft },
  pending_client: { label: 'Pending', bg: theme.warnFill, fg: theme.warnInk },
  approved: { label: 'On the contract', bg: theme.successFill, fg: theme.successInk },
  rejected: { label: 'Declined', bg: theme.alertFill, fg: theme.alertInk },
}

const INVOICE_STATUS: Record<InvoiceRow['status'], { label: string; fg: string }> = {
  draft: { label: 'Draft', fg: theme.inkSoft },
  sent: { label: 'Sent', fg: theme.warnInk },
  paid: { label: 'Paid', fg: theme.successInk },
  void: { label: 'Void', fg: theme.inkFaint },
}

interface FormState {
  builderId: string
  contractNo: string
  orderNo: string
  title: string
  contractSum: string
  gstInclusive: boolean
  retentionPct: string
  paymentTermsDays: string
  signedOn: string
  startsOn: string
  dueOn: string
  status: ContractRow['status']
  note: string
}

function formFrom(c: ContractRow | null): FormState {
  return {
    builderId: c?.builder_id ?? '',
    contractNo: c?.contract_no ?? '',
    orderNo: c?.order_no ?? '',
    title: c?.title ?? '',
    contractSum: c ? String(c.contract_sum) : '',
    gstInclusive: c?.gst_inclusive ?? false,
    retentionPct: c ? String(c.retention_pct) : '0',
    paymentTermsDays: c ? String(c.payment_terms_days) : '30',
    signedOn: c?.signed_on ?? '',
    startsOn: c?.starts_on ?? '',
    dueOn: c?.due_on ?? '',
    status: c?.status ?? 'active',
    note: c?.note ?? '',
  }
}

export function ContractTab({
  me,
  site,
  onChanged,
}: {
  me: WorkerRow
  site: JobSite
  onChanged: () => void
}) {
  const [contract, setContract] = useState<ContractRow | null>(null)
  const [value, setValue] = useState<JobValueRow | null>(null)
  const [variations, setVariations] = useState<ChangeOrderRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [builders, setBuilders] = useState<BuilderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const siteId = site.id

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()
    const [contractRes, valueRes, varRes, invRes, builderRes] = await Promise.all([
      client.from('contracts').select('*').eq('site_id', siteId).maybeSingle(),
      client.from('job_value_v').select('*').eq('site_id', siteId).maybeSingle(),
      client.from('change_orders').select('*').eq('site_id', siteId).order('raised_on', { ascending: false }),
      client.from('invoices').select('*').eq('site_id', siteId).order('issued_on', { ascending: false }),
      client.from('builders').select('*').eq('active', true).order('name'),
    ])
    const first = contractRes.error ?? valueRes.error ?? varRes.error ?? invRes.error ?? builderRes.error
    if (first) {
      setError(first.message)
      setLoading(false)
      return
    }
    setContract((contractRes.data as ContractRow | null) ?? null)
    setValue((valueRes.data as JobValueRow | null) ?? null)
    setVariations((varRes.data ?? []) as ChangeOrderRow[])
    setInvoices((invRes.data ?? []) as InvoiceRow[])
    setBuilders((builderRes.data ?? []) as BuilderRow[])
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  // A half-typed contract must not follow the user to a different job.
  useEffect(() => {
    setForm(null)
    setFormError(null)
  }, [siteId])

  const builderName = useMemo(() => {
    if (!contract?.builder_id) return null
    return builders.find((b) => b.id === contract.builder_id)?.name ?? null
  }, [contract, builders])

  async function save() {
    if (!form) return
    const sum = Number(form.contractSum)
    if (!form.contractSum.trim() || !Number.isFinite(sum)) {
      setFormError('Enter the contract sum. It is the figure every margin on this job is measured against.')
      return
    }
    const retention = Number(form.retentionPct)
    if (!Number.isFinite(retention) || retention < 0 || retention > 100) {
      setFormError('Retention has to be a percentage between 0 and 100.')
      return
    }
    setSaving(true)
    setFormError(null)

    const patch = {
      company_id: me.company_id,
      site_id: siteId,
      builder_id: form.builderId || null,
      contract_no: form.contractNo.trim() || null,
      order_no: form.orderNo.trim() || null,
      title: form.title.trim() || null,
      contract_sum: sum,
      gst_inclusive: form.gstInclusive,
      retention_pct: retention,
      payment_terms_days: Number(form.paymentTermsDays) || 30,
      signed_on: form.signedOn || null,
      starts_on: form.startsOn || null,
      due_on: form.dueOn || null,
      status: form.status,
      note: form.note.trim() || null,
    }

    // One contract per site is a unique constraint, so an upsert on site_id is
    // the whole edit path — there is no separate create and update to keep in
    // step, and a double-click cannot produce a second contract.
    const { error: err } = await supabase().from('contracts').upsert(patch, { onConflict: 'site_id' })
    setSaving(false)
    if (err) {
      setFormError(err.message)
      return
    }
    setForm(null)
    await load()
    onChanged()
  }

  if (!me.is_office) {
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
        <Empty>
          Contract sums, retention and claim figures are office-only. Your hours, photos and plans are all on the
          other tabs.
        </Empty>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.inkSoft, fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  const basis = contract?.gst_inclusive ? 'inc GST' : 'ex GST'
  const pendingVariations = variations.filter((v) => v.status === 'pending_client')

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: theme.alertFill, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12.5, color: theme.alertInk }}>
          {error}
        </div>
      )}

      {/* ---------------------------------------------------------- header */}
      <div style={{ ...panel, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '13px 15px', borderBottom: `1px solid ${theme.border}` }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {contract ? contract.title || 'Head contract' : 'No contract entered'}
          </span>
          {contract && <Chip {...CONTRACT_STATUS[contract.status]} />}
          <span style={{ flex: 1 }} />
          {!form && (
            <button onClick={() => setForm(formFrom(contract))} style={contract ? ghost : cta}>
              {contract ? 'Edit contract' : 'ADD THE CONTRACT'}
            </button>
          )}
        </div>

        {contract && !form && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 1, background: theme.border }}>
            <Fact k="BUILDER" v={builderName ?? '—'} note={builderName ? null : 'not linked to a builder'} />
            <Fact k="CONTRACT No" v={contract.contract_no || '—'} note={contract.order_no ? `PO ${contract.order_no}` : null} />
            <Fact k="SIGNED" v={contract.signed_on ? fullDate(contract.signed_on) : '—'} note={contract.due_on ? `due ${fullDate(contract.due_on)}` : null} />
            <Fact k="TERMS" v={`${contract.payment_terms_days} days`} note={`${Number(contract.retention_pct)}% retention`} />
          </div>
        )}

        {contract?.note && !form && (
          <div style={{ padding: '12px 15px', borderTop: `1px solid ${theme.border}`, fontSize: 13, lineHeight: 1.5, color: theme.inkMid }}>
            {contract.note}
          </div>
        )}

        {form && (
          <ContractForm
            form={form}
            builders={builders}
            existing={Boolean(contract)}
            saving={saving}
            error={formError}
            onPatch={(p) => setForm((f) => (f ? { ...f, ...p } : f))}
            onSave={() => void save()}
            onCancel={() => {
              setForm(null)
              setFormError(null)
            }}
          />
        )}
      </div>

      {/* ----------------------------------------------------- value ladder */}
      {!contract && !form && (
        <Empty>
          Nothing on this job has a value yet. Margin, "left to claim" and job profitability all measure against the
          contract sum, so they stay blank until it is entered.
        </Empty>
      )}

      {contract && value && (
        <>
          <div style={{ ...panel, marginBottom: 14 }}>
            <PanelHead>What this job is worth</PanelHead>

            <div style={{ padding: '4px 15px 12px' }}>
              <Ladder label="Contract sum" sub={`as signed, ${basis}`} amount={Number(value.contract_sum)} />
              <Ladder
                label="Approved variations"
                sub={
                  Number(value.approved_variation_count) === 0
                    ? 'none approved yet'
                    : `${value.approved_variation_count} variation${Number(value.approved_variation_count) === 1 ? '' : 's'} on the contract`
                }
                amount={Number(value.approved_variations)}
                signed
              />
              <Ladder
                label="Job value"
                sub={
                  contract.gst_inclusive
                    ? `${money(Number(value.job_value_ex))} ex GST`
                    : `${money(Number(value.job_value_inc))} inc GST`
                }
                amount={contract.gst_inclusive ? Number(value.job_value_inc) : Number(value.job_value_ex)}
                total
              />
            </div>

            {Number(value.pending_variation_count) > 0 && (
              <div style={{ padding: '10px 15px', borderTop: `1px solid ${theme.border}`, background: theme.warnFill, fontSize: 12.5, color: theme.warnInk }}>
                {money2(Number(value.pending_variations))} across {value.pending_variation_count} variation
                {Number(value.pending_variation_count) === 1 ? '' : 's'} is still pending. It is deliberately not counted
                above — unapproved work is not contract value, and billing it is what a builder disputes.
              </div>
            )}
          </div>

          {/* ------------------------------------------------ claim position */}
          <div style={{ ...panel, marginBottom: 14 }}>
            <PanelHead>Claimed against it</PanelHead>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 1, background: theme.border }}>
              <Fact k="CLAIMED" v={money(Number(value.claimed_inc))} note="inc GST, sent and paid claims" />
              <Fact k="PAID" v={money(Number(value.paid_inc))} note={`${money(Number(value.outstanding_inc))} outstanding`} />
              <Fact
                k="LEFT TO CLAIM"
                v={money(Number(value.to_claim_inc))}
                note={Number(value.to_claim_inc) < 0 ? 'OVER-CLAIMED against this contract' : 'inc GST'}
                fg={Number(value.to_claim_inc) < 0 ? theme.alert : theme.ink}
              />
              <Fact
                k="RETENTION HELD"
                v={money(Number(value.retention_held))}
                note={Number(contract.retention_pct) > 0 ? `${Number(contract.retention_pct)}% of each claim` : 'no retention on this contract'}
              />
            </div>
            {Number(value.draft_invoice_count) > 0 && (
              <div style={{ padding: '10px 15px', borderTop: `1px solid ${theme.border}`, fontSize: 12.5, color: theme.inkSoft }}>
                {value.draft_invoice_count} draft invoice{Number(value.draft_invoice_count) === 1 ? '' : 's'} not counted —
                nothing is claimed until it is sent.
              </div>
            )}
          </div>
        </>
      )}

      {/* ------------------------------------------------------- variations */}
      <div style={{ ...panel, marginBottom: 14 }}>
        <PanelHead>
          Variations
          <span style={{ fontWeight: 400, fontSize: 12.5, color: LABEL }}>
            {' '}
            · raised, approved and declined in the Variations screen
          </span>
        </PanelHead>
        {variations.length === 0 ? (
          <Row muted>No variations raised on this job.</Row>
        ) : (
          variations.map((v) => (
            <div key={v.id} style={listRow}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.accent }}>{v.co_no}</span>
              <span style={{ fontSize: 13, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {v.description}
              </span>
              <span style={{ fontSize: 12, color: LABEL, whiteSpace: 'nowrap' }}>
                {v.status === 'approved' && v.approved_on ? `on ${fullDate(v.approved_on)}` : `raised ${fullDate(v.raised_on)}`}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Number(v.cost_impact) < 0 ? theme.success : theme.ink }}>
                {money2(Number(v.cost_impact))}
              </span>
              <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Chip {...VARIATION_STATUS[v.status]} />
              </span>
            </div>
          ))
        )}
        {pendingVariations.length > 0 && (
          <div style={{ padding: '10px 15px', borderTop: `1px solid ${theme.border}`, fontSize: 12, color: LABEL }}>
            A variation joins the contract sum the moment it is approved, and the date it joined is stamped then — not
            when the signature is scanned back.
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- invoices */}
      <div style={panel}>
        <PanelHead>Invoices on this contract</PanelHead>
        {invoices.length === 0 ? (
          <Row muted>Nothing claimed against this job yet.</Row>
        ) : (
          invoices.map((inv) => {
            const covers = inv.variation_id ? variations.find((v) => v.id === inv.variation_id) : null
            const st = INVOICE_STATUS[inv.status]
            return (
              <div key={inv.id} style={listRow}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.accent }}>{inv.invoice_no}</span>
                <span style={{ fontSize: 13, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {covers ? `${covers.co_no} — ${covers.description}` : inv.period || 'Progress claim'}
                </span>
                <span style={{ fontSize: 12, color: LABEL, whiteSpace: 'nowrap' }}>{fullDate(inv.issued_on)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {money2(Number(inv.amount))}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, textAlign: 'right', color: st.fg }}>{st.label}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the form

function ContractForm({
  form,
  builders,
  existing,
  saving,
  error,
  onPatch,
  onSave,
  onCancel,
}: {
  form: FormState
  builders: BuilderRow[]
  existing: boolean
  saving: boolean
  error: string | null
  onPatch: (p: Partial<FormState>) => void
  onSave: () => void
  onCancel: () => void
}) {
  // Picking a builder pulls their standard terms across, because that is what
  // those columns on `builders` are for — but only into blank-ish fields, so
  // it can never quietly overwrite terms already negotiated on this job.
  function pickBuilder(id: string) {
    const b = builders.find((x) => x.id === id)
    if (!b) {
      onPatch({ builderId: '' })
      return
    }
    onPatch({
      builderId: id,
      paymentTermsDays: form.paymentTermsDays === '30' ? String(b.payment_terms_days) : form.paymentTermsDays,
      retentionPct: form.retentionPct === '0' ? String(b.default_retention_pct) : form.retentionPct,
    })
  }

  return (
    <div style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Builder" width={210}>
          <select value={form.builderId} onChange={(e) => pickBuilder(e.target.value)} style={{ ...field, width: 210 }}>
            <option value="">Not linked</option>
            {builders.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contract number" width={150}>
          <input value={form.contractNo} onChange={(e) => onPatch({ contractNo: e.target.value })} placeholder="C-2291" style={{ ...field, width: 150 }} />
        </Field>
        <Field label="Their order number" width={150}>
          <input value={form.orderNo} onChange={(e) => onPatch({ orderNo: e.target.value })} placeholder="PO 88401" style={{ ...field, width: 150 }} />
        </Field>
        <Field label="Status" width={150}>
          <select value={form.status} onChange={(e) => onPatch({ status: e.target.value as ContractRow['status'] })} style={{ ...field, width: 150 }}>
            {(Object.keys(CONTRACT_STATUS) as Array<ContractRow['status']>).map((s) => (
              <option key={s} value={s}>
                {CONTRACT_STATUS[s].label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Title" width="100%">
        <input value={form.title} onChange={(e) => onPatch({ title: e.target.value })} placeholder="Tiling — wet areas, Lot 42" style={{ ...field, width: '100%' }} />
      </Field>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Contract sum" width={160}>
          <input
            value={form.contractSum}
            onChange={(e) => onPatch({ contractSum: e.target.value })}
            placeholder="0.00"
            inputMode="decimal"
            style={{ ...field, width: 160, textAlign: 'right' }}
          />
        </Field>
        <Field label="That figure is" width={190}>
          <select
            value={form.gstInclusive ? 'inc' : 'ex'}
            onChange={(e) => onPatch({ gstInclusive: e.target.value === 'inc' })}
            style={{ ...field, width: 190 }}
          >
            <option value="ex">Excluding GST</option>
            <option value="inc">Including GST</option>
          </select>
        </Field>
        <Field label="Retention %" width={110}>
          <input value={form.retentionPct} onChange={(e) => onPatch({ retentionPct: e.target.value })} inputMode="decimal" style={{ ...field, width: 110, textAlign: 'right' }} />
        </Field>
        <Field label="Payment terms (days)" width={140}>
          <input value={form.paymentTermsDays} onChange={(e) => onPatch({ paymentTermsDays: e.target.value })} inputMode="numeric" style={{ ...field, width: 140, textAlign: 'right' }} />
        </Field>
      </div>

      <span style={{ display: 'block', marginTop: 6, fontSize: 11.5, lineHeight: 1.45, color: LABEL }}>
        Whether the sum includes GST is recorded rather than assumed. Commercial subcontracts here are almost always
        quoted ex GST and a fixed-price residential contract inc — getting it wrong is a 10% error on every margin
        figure on the job.
      </span>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Signed on" width={150}>
          <input type="date" value={form.signedOn} onChange={(e) => onPatch({ signedOn: e.target.value })} style={{ ...field, width: 150 }} />
        </Field>
        <Field label="Starts on" width={150}>
          <input type="date" value={form.startsOn} onChange={(e) => onPatch({ startsOn: e.target.value })} style={{ ...field, width: 150 }} />
        </Field>
        <Field label="Contract completion" width={150}>
          <input type="date" value={form.dueOn} onChange={(e) => onPatch({ dueOn: e.target.value })} style={{ ...field, width: 150 }} />
        </Field>
      </div>

      <Field label="Note" width="100%">
        <textarea
          value={form.note}
          onChange={(e) => onPatch({ note: e.target.value })}
          rows={2}
          placeholder="Anything about this contract the office needs on hand — liquidated damages, access conditions, agreed rates."
          style={{ ...field, width: '100%', height: 'auto', padding: 9, resize: 'vertical' as const }}
        />
      </Field>

      {error && <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={onSave} disabled={saving} style={cta}>
          {saving ? 'SAVING…' : existing ? 'SAVE CHANGES' : 'SAVE CONTRACT'}
        </button>
        <button onClick={onCancel} style={ghost}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- small parts

function Ladder({
  label,
  sub,
  amount,
  signed = false,
  total = false,
}: {
  label: string
  sub: string
  amount: number
  signed?: boolean
  total?: boolean
}) {
  const shown = signed && amount > 0 ? `+${money2(amount)}` : money2(amount)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '10px 0',
        borderTop: total ? `1px solid ${theme.ink}` : `1px solid ${ROW_BORDER}`,
      }}
    >
      <span style={{ fontSize: total ? 14 : 13, fontWeight: total ? 700 : 500 }}>{label}</span>
      <span style={{ fontSize: 11.5, color: LABEL }}>{sub}</span>
      <span style={{ flex: 1 }} />
      <span
        style={{
          fontSize: total ? 20 : 15,
          fontWeight: total ? 700 : 600,
          fontVariantNumeric: 'tabular-nums',
          color: !total && signed && amount < 0 ? theme.success : theme.ink,
        }}
      >
        {shown}
      </span>
    </div>
  )
}

function Fact({ k, v, note, fg = theme.ink }: { k: string; v: string; note?: string | null; fg?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px', background: '#fff' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: LABEL, whiteSpace: 'nowrap' }}>{k}</span>
      <span style={{ fontSize: 17, fontWeight: 600, color: fg, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
      {note && <span style={{ fontSize: 11.5, color: LABEL }}>{note}</span>}
    </div>
  )
}

function PanelHead({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '11px 15px', borderBottom: `1px solid ${theme.border}`, fontSize: 15, fontWeight: 600 }}>
      {children}
    </div>
  )
}

function Row({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <div style={{ padding: '16px 15px', fontSize: 12.5, color: muted ? theme.inkSoft : theme.ink }}>{children}</div>
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '30px 24px',
        border: `1.5px dashed ${DASH_BORDER}`,
        borderRadius: 8,
        background: HEAD_BG,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: theme.inkSoft,
        textAlign: 'center',
        textWrap: 'pretty',
      }}
    >
      <span style={{ maxWidth: 520 }}>{children}</span>
    </div>
  )
}

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 9px',
        borderRadius: 11,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        background: bg,
        color: fg,
      }}
    >
      {label}
    </span>
  )
}

function Field({ label, width, children }: { label: string; width: number | string; children: ReactNode }) {
  return (
    <label style={{ ...labelStyle, width: typeof width === 'number' ? width : '100%' }}>
      {label}
      {children}
    </label>
  )
}

// ----------------------------------------------------------------- tokens

const TAB_PAD = '16px 18px 40px'

const panel = {
  background: '#fff',
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  overflow: 'hidden',
} as const

const listRow = {
  display: 'grid',
  columnGap: 10,
  gridTemplateColumns: '80px 1fr 130px 118px 128px',
  alignItems: 'center',
  padding: '9px 15px',
  borderBottom: `1px solid ${ROW_BORDER}`,
} as const

const labelStyle = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  display: 'block',
  marginTop: 8,
} as const

const field = {
  display: 'block',
  height: 32,
  padding: '0 9px',
  marginTop: 4,
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: '#fff',
  fontFamily: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const cta = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: theme.ink,
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
} as const

const ghost = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: '#fff',
  color: theme.ink,
  fontFamily: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
} as const
