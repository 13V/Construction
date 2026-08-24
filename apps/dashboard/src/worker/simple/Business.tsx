/**
 * The business's own details — the ones that make its paperwork mean
 * something.
 *
 * schema_v15 added these columns and schema_v16 granted the office write
 * policy, with a comment saying in as many words that a settings form would
 * otherwise "UPDATE zero rows, get a 200 back, and appear to save". The policy
 * has been there ever since. The form never was — which was survivable while
 * the only tenant was a seeded demo whose details were written straight into
 * the database, and stops being survivable the moment a real business signs up
 * and issues its first document.
 *
 * What is at stake is not tidiness. An Australian tax invoice over $82.50 with
 * no ABN can have its GST credit refused, and the builder will not ring up
 * about it — they will just not pay it. A Certificate of Compliance with no
 * builders licence number on it is a letter, not a certificate. Both documents
 * render whatever is here and silently omit whatever is not
 * (data/pdf.ts header()), so an unfilled field is invisible until an invoice
 * comes back.
 *
 * Hence the readiness line at the top: it names what is missing and what that
 * costs, rather than leaving a blank field to be noticed later.
 */
import { useEffect, useState } from 'react'
import { supabase, type WorkerRow } from '../../data/supabase'
import { formatAbn } from '../../data/pdf'
import { s, SAFE_BOTTOM } from './stheme'

interface CompanyRow {
  id: string
  name: string
  legal_name: string | null
  abn: string | null
  acn: string | null
  licence_no: string | null
  certifier_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  bank_bsb: string | null
  bank_account: string | null
  bank_account_name: string | null
  gst_registered: boolean
}

const COLS =
  'id, name, legal_name, abn, acn, licence_no, certifier_name, address, phone, email, ' +
  'bank_bsb, bank_account, bank_account_name, gst_registered'

/**
 * An ABN is eleven digits with a weighting checksum. Getting it wrong is the
 * same as leaving it blank — worse, because it looks filled in — so it is
 * checked here rather than trusted, using the ATO's own algorithm.
 */
export function abnLooksValid(abn: string): boolean {
  const d = abn.replace(/\D/g, '')
  if (d.length !== 11) return false
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
  const digits = d.split('').map(Number)
  digits[0]! -= 1
  const sum = digits.reduce((acc, n, i) => acc + n * weights[i]!, 0)
  return sum % 89 === 0
}

/** What is missing, and what each gap costs. Empty means ready. */
export function complianceGaps(c: Pick<CompanyRow, 'abn' | 'licence_no' | 'address' | 'certifier_name'>): string[] {
  const out: string[] = []
  if (!c.abn?.trim()) out.push('an ABN — a tax invoice without one can have its GST credit refused')
  if (!c.licence_no?.trim()) out.push('a builders licence number — a waterproofing certificate without one is not a certificate')
  if (!c.address?.trim()) out.push('a business address — every document is issued from it')
  if (!c.certifier_name?.trim()) out.push('a name to sign certificates')
  return out
}

export function BusinessSheet({ me, onClose }: { me: WorkerRow; onClose: () => void }) {
  const [row, setRow] = useState<CompanyRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const office = me.is_office

  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('companies')
      .select(COLS)
      .eq('id', me.company_id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        setRow((data as CompanyRow | null) ?? null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [me.company_id])

  const set = <K extends keyof CompanyRow>(k: K, v: CompanyRow[K]) =>
    setRow((prev) => (prev ? { ...prev, [k]: v } : prev))

  async function save() {
    if (!row) return
    if (!row.name.trim()) {
      setError('The trading name is what every document is headed with — it cannot be blank.')
      return
    }
    if (row.abn?.trim() && !abnLooksValid(row.abn)) {
      setError('That ABN does not check out. It is eleven digits — worth re-reading off the paperwork.')
      return
    }
    setBusy(true)
    setError(null)
    setSaved(false)
    // Read the row back. companies_office_write (schema_v16) is an office-only
    // policy, and an update it filters out returns success with nothing in it
    // — which is exactly the "appears to save" failure that migration's own
    // comment warned about.
    const { data, error: err } = await supabase()
      .from('companies')
      .update({
        name: row.name.trim(),
        legal_name: row.legal_name?.trim() || null,
        abn: row.abn?.replace(/\s/g, '') || null,
        acn: row.acn?.replace(/\s/g, '') || null,
        licence_no: row.licence_no?.trim() || null,
        certifier_name: row.certifier_name?.trim() || null,
        address: row.address?.trim() || null,
        phone: row.phone?.trim() || null,
        email: row.email?.trim() || null,
        bank_bsb: row.bank_bsb?.replace(/\s/g, '') || null,
        bank_account: row.bank_account?.replace(/\s/g, '') || null,
        bank_account_name: row.bank_account_name?.trim() || null,
        gst_registered: row.gst_registered,
      })
      .eq('id', me.company_id)
      .select('id')
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    if (!data || data.length === 0) {
      setError('That was refused — business details are the office’s to change.')
      return
    }
    setSaved(true)
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
  const Row = ({ k, v, on, placeholder, mode }: { k: string; v: string | null; on: (x: string) => void; placeholder?: string; mode?: string }) => (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={label}>{k}</span>
      <input value={v ?? ''} onChange={(e) => on(e.target.value)} placeholder={placeholder} inputMode={mode as never} style={field} />
    </span>
  )

  const gaps = row ? complianceGaps(row) : []

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.5)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>Business details</span>
            <span style={{ fontSize: 12.5, color: '#8B9096' }}>What goes on your invoices and certificates</span>
          </span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `15px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          {loading && <span style={{ fontSize: 13.5, color: '#8B9096' }}>Loading…</span>}

          {!loading && !office && (
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
              The office keeps the business details that go on invoices and certificates.
            </span>
          )}

          {!loading && office && row && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, lineHeight: 1.45, color: '#8E2A31' }}>{error}</span>}
              {saved && <span style={{ padding: '10px 12px', background: '#EAF7EC', borderRadius: 9, fontSize: 13, color: '#14532B' }}>Saved. Every document issued from now on carries these.</span>}

              {gaps.length > 0 ? (
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 13px', background: '#FFF6E3', border: '1px solid #F0DFB8', borderRadius: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#8A6100' }}>
                    {gaps.length === 1 ? 'One thing is missing' : `${gaps.length} things are missing`}
                  </span>
                  {gaps.map((g) => (
                    <span key={g} style={{ fontSize: 12.5, lineHeight: 1.5, color: '#7A5700' }}>
                      · Needs {g}.
                    </span>
                  ))}
                </span>
              ) : (
                <span style={{ padding: '11px 13px', background: '#EAF7EC', border: '1px solid #C8E6D0', borderRadius: 10, fontSize: 13, lineHeight: 1.45, color: '#14532B' }}>
                  Everything a tax invoice and a compliance certificate need is on file.
                </span>
              )}

              <Row k="TRADING NAME" v={row.name} on={(x) => set('name', x)} placeholder="What the business is called" />
              <Row k="LEGAL NAME (IF DIFFERENT)" v={row.legal_name} on={(x) => set('legal_name', x)} placeholder="e.g. the Pty Ltd behind it" />

              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>ABN</span>
                <input
                  value={row.abn ?? ''}
                  onChange={(e) => set('abn', e.target.value)}
                  placeholder="11 digits"
                  inputMode="numeric"
                  style={field}
                />
                {row.abn?.trim() ? (
                  abnLooksValid(row.abn) ? (
                    <span style={{ fontSize: 12, color: '#1B7A2C' }}>Checks out — prints as {formatAbn(row.abn)}</span>
                  ) : (
                    <span style={{ fontSize: 12, color: '#A3282E' }}>That is not a valid ABN yet.</span>
                  )
                ) : null}
              </span>

              <Row k="ACN (IF A COMPANY)" v={row.acn} on={(x) => set('acn', x)} mode="numeric" />
              <Row k="BUILDERS LICENCE" v={row.licence_no} on={(x) => set('licence_no', x)} placeholder="e.g. BLD 187384" />
              <Row k="WHO SIGNS CERTIFICATES" v={row.certifier_name} on={(x) => set('certifier_name', x)} placeholder="The licensed contractor's name" />

              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>BUSINESS ADDRESS</span>
                <textarea
                  value={row.address ?? ''}
                  onChange={(e) => set('address', e.target.value)}
                  rows={2}
                  placeholder="Street, suburb, state, postcode"
                  style={{ ...field, height: 'auto', padding: '11px 13px', fontFamily: 'inherit', lineHeight: 1.4, resize: 'none' }}
                />
              </span>

              <Row k="PHONE" v={row.phone} on={(x) => set('phone', x)} mode="tel" />
              <Row k="EMAIL" v={row.email} on={(x) => set('email', x)} mode="email" />

              <span style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 13px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 10 }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: s.ink }}>Registered for GST</span>
                  <span style={{ fontSize: 12.5, lineHeight: 1.4, color: '#8B9096' }}>
                    Off means invoices are issued with no GST line at all.
                  </span>
                </span>
                <span
                  onClick={() => set('gst_registered', !row.gst_registered)}
                  style={{ flex: 'none', display: 'flex', alignItems: 'center', width: 50, height: 30, padding: 3, borderRadius: 15, background: row.gst_registered ? '#1A1D21' : '#CFD4DA', cursor: 'pointer', transition: 'background .15s' }}
                >
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#fff', transform: row.gst_registered ? 'translateX(20px)' : 'none', transition: 'transform .15s' }} />
                </span>
              </span>

              <span style={{ marginTop: 4, fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' }}>WHERE THE BUILDER PAYS</span>
              <Row k="ACCOUNT NAME" v={row.bank_account_name} on={(x) => set('bank_account_name', x)} />
              <span style={{ display: 'flex', gap: 10 }}>
                <span style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>BSB</span>
                  <input value={row.bank_bsb ?? ''} onChange={(e) => set('bank_bsb', e.target.value)} placeholder="000-000" inputMode="numeric" style={field} />
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>ACCOUNT NUMBER</span>
                  <input value={row.bank_account ?? ''} onChange={(e) => set('bank_account', e.target.value)} inputMode="numeric" style={field} />
                </span>
              </span>

              <button
                disabled={busy}
                onClick={() => void save()}
                style={{ width: '100%', height: 48, marginTop: 4, border: 0, borderRadius: 10, background: '#1A1D21', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, letterSpacing: '.03em', color: '#fff', opacity: busy ? 0.6 : 1, cursor: 'pointer' }}
              >
                {busy ? 'SAVING…' : 'SAVE'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
