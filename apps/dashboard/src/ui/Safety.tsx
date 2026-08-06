import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type CertificationRow, type SafetyRow, type WorkerRow } from '../data/supabase'
import { BUCKET_FILES, objectPath, signedUrl, uploadFile } from '../data/storage'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Safety and compliance. Records (JHAs, incidents, toolbox talks, hazards) and
 * worker certifications share one screen because an owner checking on safety
 * wants both in the same glance — a lapsed cert is as much a compliance gap as
 * an open hazard.
 */

const KIND_META: Record<SafetyRow['kind'], string> = {
  jha: 'JHA',
  incident: 'Incident',
  toolbox: 'Toolbox talk',
  hazard: 'Hazard',
}

const SEVERITY_META: Record<'low' | 'medium' | 'high', { label: string; color: string; bg: string }> = {
  low: { label: 'Low', color: '#1B7A32', bg: '#EAF7EE' },
  medium: { label: 'Medium', color: '#8A6100', bg: '#FFF6DF' },
  high: { label: 'High', color: theme.alert, bg: '#FCE8EA' },
}

const DAY_MS = 24 * 60 * 60 * 1000

interface RecordForm {
  kind: SafetyRow['kind']
  title: string
  body: string
  siteId: string
  severity: '' | 'low' | 'medium' | 'high'
  occurredAt: string
  photoPath: string | null
  photoName: string | null
}

const blankRecordForm = (): RecordForm => ({
  kind: 'hazard',
  title: '',
  body: '',
  siteId: '',
  severity: '',
  occurredAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  photoPath: null,
  photoName: null,
})

interface CertForm {
  workerId: string
  name: string
  expiresOn: string
}

const blankCertForm = (): CertForm => ({ workerId: '', name: '', expiresOn: '' })

function certStatus(expiresOn: string | null) {
  if (!expiresOn) return { label: 'No expiry set', color: theme.inkFaint, bg: theme.appBg, rank: 3 }
  const days = Math.floor((new Date(expiresOn).getTime() - Date.now()) / DAY_MS)
  if (days < 0) return { label: 'Lapsed', color: theme.alert, bg: '#FCE8EA', rank: 0 }
  if (days <= 30) return { label: 'Expiring soon', color: '#8A6100', bg: '#FFF6DF', rank: 1 }
  return { label: 'Valid', color: '#1B7A32', bg: '#EAF7EE', rank: 2 }
}

export function Safety({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [tab, setTab] = useState<'records' | 'certifications'>('records')

  const [records, setRecords] = useState<SafetyRow[]>([])
  const [certs, setCerts] = useState<CertificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [kindFilter, setKindFilter] = useState<'all' | SafetyRow['kind']>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map())

  const [recordForm, setRecordForm] = useState<RecordForm | null>(null)
  const [uploading, setUploading] = useState(false)
  const [savingRecord, setSavingRecord] = useState(false)
  const [recordFormError, setRecordFormError] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)

  const [certForm, setCertForm] = useState<CertForm | null>(null)
  const [savingCert, setSavingCert] = useState(false)
  const [certFormError, setCertFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()
    const [recRes, certRes] = await Promise.all([
      client.from('safety_records').select('*').order('occurred_at', { ascending: false }),
      client.from('certifications').select('*').order('expires_on', { ascending: true }),
    ])
    if (recRes.error) {
      setError(recRes.error.message)
      setLoading(false)
      return
    }
    if (certRes.error) {
      setError(certRes.error.message)
      setLoading(false)
      return
    }
    setRecords((recRes.data ?? []) as SafetyRow[])
    setCerts((certRes.data ?? []) as CertificationRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!expandedId) return
    const row = records.find((r) => r.id === expandedId)
    if (!row?.photo_path || photoUrls.has(row.id)) return
    let cancelled = false
    void signedUrl(BUCKET_FILES, row.photo_path).then((url) => {
      if (!cancelled && url) setPhotoUrls((prev) => new Map(prev).set(row.id, url))
    })
    return () => {
      cancelled = true
    }
  }, [expandedId, records, photoUrls])

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? '—'
  const workerName = (id: string | null) => workers.find((w) => w.id === id)?.name ?? 'Unknown'

  const filteredRecords = useMemo(
    () => records.filter((r) => kindFilter === 'all' || r.kind === kindFilter),
    [records, kindFilter],
  )

  const sortedCerts = useMemo(() => {
    return [...certs].sort((a, b) => {
      const sa = certStatus(a.expires_on)
      const sb = certStatus(b.expires_on)
      if (sa.rank !== sb.rank) return sa.rank - sb.rank
      if (!a.expires_on || !b.expires_on) return 0
      return new Date(a.expires_on).getTime() - new Date(b.expires_on).getTime()
    })
  }, [certs])

  const dashboard = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const weekStart = new Date(now)
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(now.getDate() - now.getDay())
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS)

    const openHazards = records.filter((r) => r.kind === 'hazard' && r.status === 'open').length
    const incidentsThisMonth = records.filter((r) => {
      if (r.kind !== 'incident') return false
      const at = new Date(r.occurred_at)
      return at >= monthStart && at < monthEnd
    }).length
    const jhaThisWeek = records.filter((r) => {
      if (r.kind !== 'jha') return false
      const at = new Date(r.occurred_at)
      return at >= weekStart && at < weekEnd
    }).length
    const certsExpiring = certs.filter((c) => {
      if (!c.expires_on) return false
      const days = Math.floor((new Date(c.expires_on).getTime() - Date.now()) / DAY_MS)
      return days >= 0 && days <= 30
    }).length

    return { openHazards, incidentsThisMonth, jhaThisWeek, certsExpiring }
  }, [records, certs])

  async function onPhotoSelected(file: File) {
    if (!recordForm) return
    setRecordFormError(null)
    setUploading(true)
    try {
      const path = objectPath(me.company_id, recordForm.siteId || 'unassigned', file.name)
      await uploadFile(BUCKET_FILES, path, file)
      setRecordForm((f) => (f ? { ...f, photoPath: path, photoName: file.name } : f))
    } catch (err) {
      setRecordFormError(err instanceof Error ? err.message : 'Photo upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function saveRecord() {
    if (!recordForm) return
    if (!recordForm.title.trim()) {
      setRecordFormError('A title is required.')
      return
    }
    setSavingRecord(true)
    setRecordFormError(null)

    const { error: err } = await supabase()
      .from('safety_records')
      .insert({
        company_id: me.company_id,
        site_id: recordForm.siteId || null,
        worker_id: me.id,
        kind: recordForm.kind,
        title: recordForm.title.trim(),
        body: recordForm.body.trim() || null,
        severity: recordForm.severity || null,
        occurred_at: new Date(recordForm.occurredAt).toISOString(),
        photo_path: recordForm.photoPath,
        status: 'open',
      })

    setSavingRecord(false)
    if (err) {
      setRecordFormError(err.message)
      return
    }
    setRecordForm(null)
    await load()
    onChanged()
  }

  async function toggleStatus(row: SafetyRow) {
    setRowBusyId(row.id)
    const { error: err } = await supabase()
      .from('safety_records')
      .update({ status: row.status === 'open' ? 'closed' : 'open' })
      .eq('id', row.id)
    setRowBusyId(null)
    if (err) setError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  async function sign(row: SafetyRow) {
    if (row.signatures.some((s) => s.worker_id === me.id)) return
    setRowBusyId(row.id)
    const next = [...row.signatures, { worker_id: me.id, name: me.name, signed_at: new Date().toISOString() }]
    const { error: err } = await supabase()
      .from('safety_records')
      .update({ signatures: next })
      .eq('id', row.id)
    setRowBusyId(null)
    if (err) setError(err.message)
    else await load()
  }

  async function saveCert() {
    if (!certForm) return
    if (!certForm.workerId || !certForm.name.trim()) {
      setCertFormError('A worker and a certification name are required.')
      return
    }
    setSavingCert(true)
    setCertFormError(null)

    const { error: err } = await supabase()
      .from('certifications')
      .insert({
        company_id: me.company_id,
        worker_id: certForm.workerId,
        name: certForm.name.trim(),
        expires_on: certForm.expiresOn || null,
      })

    setSavingCert(false)
    if (err) {
      setCertFormError(err.message)
      return
    }
    setCertForm(null)
    await load()
    onChanged()
  }

  async function deleteCert(id: string) {
    setRowBusyId(id)
    const { error: err } = await supabase().from('certifications').delete().eq('id', id)
    setRowBusyId(null)
    if (err) setError(err.message)
    else await load()
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Safety</h1>
          <span style={{ fontSize: 13, color: theme.inkSoft }}>
            {records.length} records, {certs.length} certifications
          </span>
        </div>

        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: theme.alert }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <div style={statCard}>
            <div style={statLabel}>Open hazards</div>
            <div style={{ ...statValue, color: dashboard.openHazards > 0 ? theme.alert : theme.ink }}>
              {dashboard.openHazards}
            </div>
          </div>
          <div style={statCard}>
            <div style={statLabel}>Incidents this month</div>
            <div style={{ ...statValue, color: dashboard.incidentsThisMonth > 0 ? theme.alert : theme.ink }}>
              {dashboard.incidentsThisMonth}
            </div>
          </div>
          <div style={statCard}>
            <div style={statLabel}>JHAs this week</div>
            <div style={statValue}>{dashboard.jhaThisWeek}</div>
          </div>
          <div style={statCard}>
            <div style={statLabel}>Certs expiring in 30 days</div>
            <div style={{ ...statValue, color: dashboard.certsExpiring > 0 ? '#8A6100' : theme.ink }}>
              {dashboard.certsExpiring}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 18, borderBottom: `1px solid ${theme.border}` }}>
          {(['records', 'certifications'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 2px',
                marginBottom: -1,
                background: 'transparent',
                border: 'none',
                borderBottom: tab === t ? `2px solid ${theme.accent}` : '2px solid transparent',
                font: 'inherit',
                fontSize: 13,
                fontWeight: 600,
                color: tab === t ? theme.ink : theme.inkSoft,
                cursor: 'pointer',
              }}
            >
              {t === 'records' ? 'Records' : 'Certifications'}
            </button>
          ))}
        </div>

        {tab === 'records' ? (
          <>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
                style={selectStyle}
              >
                <option value="all">All kinds</option>
                <option value="jha">JHA</option>
                <option value="incident">Incident</option>
                <option value="toolbox">Toolbox talk</option>
                <option value="hazard">Hazard</option>
              </select>
              {!recordForm && (
                <button onClick={() => setRecordForm(blankRecordForm())} style={{ ...cta, marginLeft: 'auto' }}>
                  NEW RECORD
                </button>
              )}
            </div>

            {recordForm && (
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New safety record</div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={label}>
                    Kind
                    <select
                      value={recordForm.kind}
                      onChange={(e) =>
                        setRecordForm((f) => (f ? { ...f, kind: e.target.value as SafetyRow['kind'] } : f))
                      }
                      style={{ ...field, width: 150 }}
                    >
                      <option value="jha">JHA</option>
                      <option value="incident">Incident</option>
                      <option value="toolbox">Toolbox talk</option>
                      <option value="hazard">Hazard</option>
                    </select>
                  </label>
                  <label style={label}>
                    Site
                    <select
                      value={recordForm.siteId}
                      onChange={(e) => setRecordForm((f) => (f ? { ...f, siteId: e.target.value } : f))}
                      style={{ ...field, width: 200 }}
                    >
                      <option value="">No site</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={label}>
                    Severity
                    <select
                      value={recordForm.severity}
                      onChange={(e) =>
                        setRecordForm((f) => (f ? { ...f, severity: e.target.value as RecordForm['severity'] } : f))
                      }
                      style={{ ...field, width: 130 }}
                    >
                      <option value="">—</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label style={label}>
                    Occurred at
                    <input
                      type="datetime-local"
                      value={recordForm.occurredAt}
                      onChange={(e) => setRecordForm((f) => (f ? { ...f, occurredAt: e.target.value } : f))}
                      style={{ ...field, width: 190 }}
                    />
                  </label>
                </div>

                <label style={label}>
                  Title
                  <input
                    value={recordForm.title}
                    onChange={(e) => setRecordForm((f) => (f ? { ...f, title: e.target.value } : f))}
                    placeholder="Unguarded floor opening — level 2"
                    style={{ ...field, width: '100%' }}
                  />
                </label>

                <label style={label}>
                  Details
                  <textarea
                    value={recordForm.body}
                    onChange={(e) => setRecordForm((f) => (f ? { ...f, body: e.target.value } : f))}
                    rows={3}
                    style={{ ...field, width: '100%', height: 'auto', padding: 9, resize: 'vertical' as const }}
                  />
                </label>

                <label style={label}>
                  Photo (optional)
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void onPhotoSelected(file)
                      e.target.value = ''
                    }}
                    style={{ display: 'block', marginTop: 4, fontSize: 12.5 }}
                  />
                </label>
                {uploading && <div style={{ fontSize: 12, color: theme.accent, marginTop: 6 }}>Uploading…</div>}
                {recordForm.photoName && !uploading && (
                  <div style={{ fontSize: 12, color: theme.inkSoft, marginTop: 6 }}>
                    Attached: {recordForm.photoName}{' '}
                    <button
                      onClick={() => setRecordForm((f) => (f ? { ...f, photoPath: null, photoName: null } : f))}
                      style={{ ...ghost, marginLeft: 6, padding: '1px 7px' }}
                    >
                      Remove
                    </button>
                  </div>
                )}

                {recordFormError && (
                  <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{recordFormError}</div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => void saveRecord()} disabled={savingRecord || uploading} style={cta}>
                    {savingRecord ? 'SAVING…' : 'SAVE RECORD'}
                  </button>
                  <button onClick={() => setRecordForm(null)} style={ghost}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={{ ...card, padding: 0, overflow: 'hidden', marginTop: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Kind', 'Title', 'Site', 'Raised by', 'Date', 'Severity', 'Status'].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!loading && filteredRecords.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                        No records match this filter.
                      </td>
                    </tr>
                  )}
                  {filteredRecords.map((row) => {
                    const expanded = expandedId === row.id
                    const sev = row.severity ? SEVERITY_META[row.severity] : null
                    const alreadySigned = row.signatures.some((s) => s.worker_id === me.id)
                    return (
                      <Fragment key={row.id}>
                        <tr onClick={() => setExpandedId(expanded ? null : row.id)} style={{ cursor: 'pointer' }}>
                          <td style={td}>
                            <span style={kindChip}>{KIND_META[row.kind]}</span>
                          </td>
                          <td style={{ ...td, fontWeight: 500 }}>{row.title}</td>
                          <td style={{ ...td, color: theme.inkSoft }}>{siteName(row.site_id)}</td>
                          <td style={{ ...td, color: theme.inkSoft }}>{workerName(row.worker_id)}</td>
                          <td style={td}>{new Date(row.occurred_at).toLocaleDateString()}</td>
                          <td style={td}>
                            {sev ? (
                              <span style={{ ...chip, color: sev.color, background: sev.bg }}>{sev.label}</span>
                            ) : (
                              <span style={{ color: theme.inkFaint }}>—</span>
                            )}
                          </td>
                          <td style={td}>
                            <span
                              style={{
                                ...chip,
                                color: row.status === 'open' ? theme.accent : theme.inkFaint,
                                background: row.status === 'open' ? theme.accentFill : theme.appBg,
                              }}
                            >
                              {row.status === 'open' ? 'Open' : 'Closed'}
                            </span>
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={7} style={{ ...td, background: theme.appBg }}>
                              <div style={{ display: 'flex', gap: 16, padding: '8px 4px', flexWrap: 'wrap' }}>
                                <div style={{ flex: 'none' }}>
                                  {row.photo_path ? (
                                    photoUrls.get(row.id) ? (
                                      <img
                                        src={photoUrls.get(row.id)}
                                        alt="Incident"
                                        style={{
                                          width: 220,
                                          borderRadius: 6,
                                          border: `1px solid ${theme.border}`,
                                          display: 'block',
                                        }}
                                      />
                                    ) : (
                                      <div style={{ width: 220, fontSize: 12, color: theme.inkSoft }}>
                                        Loading photo…
                                      </div>
                                    )
                                  ) : (
                                    <div style={{ width: 220, fontSize: 12, color: theme.inkFaint }}>
                                      No photo attached.
                                    </div>
                                  )}
                                </div>
                                <div style={{ flex: 1, minWidth: 240 }}>
                                  <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const }}>
                                    {row.body || 'No details recorded.'}
                                  </div>

                                  {row.kind === 'toolbox' && (
                                    <div style={{ marginTop: 12 }}>
                                      <div style={{ ...statLabel, marginBottom: 6 }}>Signatures</div>
                                      {row.signatures.length === 0 ? (
                                        <div style={{ fontSize: 12, color: theme.inkFaint }}>No one has signed yet.</div>
                                      ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                          {row.signatures.map((s, i) => (
                                            <div key={i} style={{ fontSize: 12.5, color: theme.inkSoft }}>
                                              {s.name} — {new Date(s.signed_at).toLocaleString()}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void sign(row)
                                        }}
                                        disabled={alreadySigned || rowBusyId === row.id}
                                        style={{ ...ghost, marginTop: 8 }}
                                      >
                                        {alreadySigned ? 'You signed this' : rowBusyId === row.id ? 'Signing…' : 'Sign'}
                                      </button>
                                    </div>
                                  )}

                                  {me.is_office && (
                                    <div style={{ marginTop: 12 }}>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void toggleStatus(row)
                                        }}
                                        disabled={rowBusyId === row.id}
                                        style={ghost}
                                      >
                                        {rowBusyId === row.id
                                          ? 'Saving…'
                                          : row.status === 'open'
                                            ? 'Close record'
                                            : 'Reopen record'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', marginTop: 14 }}>
              {me.is_office && !certForm && (
                <button onClick={() => setCertForm(blankCertForm())} style={{ ...cta, marginLeft: 'auto' }}>
                  ADD CERTIFICATION
                </button>
              )}
            </div>

            {certForm && (
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New certification</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={label}>
                    Worker
                    <select
                      value={certForm.workerId}
                      onChange={(e) => setCertForm((f) => (f ? { ...f, workerId: e.target.value } : f))}
                      style={{ ...field, width: 200 }}
                    >
                      <option value="">Select…</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={label}>
                    Certification name
                    <input
                      value={certForm.name}
                      onChange={(e) => setCertForm((f) => (f ? { ...f, name: e.target.value } : f))}
                      placeholder="OSHA 30"
                      style={{ ...field, width: 220 }}
                    />
                  </label>
                  <label style={label}>
                    Expiry date
                    <input
                      type="date"
                      value={certForm.expiresOn}
                      onChange={(e) => setCertForm((f) => (f ? { ...f, expiresOn: e.target.value } : f))}
                      style={{ ...field, width: 160 }}
                    />
                  </label>
                </div>

                {certFormError && (
                  <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{certFormError}</div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => void saveCert()} disabled={savingCert} style={cta}>
                    {savingCert ? 'SAVING…' : 'SAVE CERTIFICATION'}
                  </button>
                  <button onClick={() => setCertForm(null)} style={ghost}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={{ ...card, padding: 0, overflow: 'hidden', marginTop: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Worker', 'Certification', 'Expires', 'Status', ''].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={5} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!loading && sortedCerts.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                        No certifications on file yet.
                      </td>
                    </tr>
                  )}
                  {sortedCerts.map((c) => {
                    const status = certStatus(c.expires_on)
                    return (
                      <tr key={c.id}>
                        <td style={{ ...td, fontWeight: 500 }}>{workerName(c.worker_id)}</td>
                        <td style={td}>{c.name}</td>
                        <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                          {c.expires_on ? new Date(c.expires_on).toLocaleDateString() : '—'}
                        </td>
                        <td style={td}>
                          <span style={{ ...chip, color: status.color, background: status.bg }}>{status.label}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {me.is_office && (
                            <button
                              onClick={() => void deleteCert(c.id)}
                              disabled={rowBusyId === c.id}
                              style={ghost}
                            >
                              {rowBusyId === c.id ? 'Removing…' : 'Delete'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const card = {
  marginTop: 14,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const statCard = {
  padding: '10px 14px',
  minWidth: 170,
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

const chip = {
  padding: '2px 8px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: 600,
  display: 'inline-block',
} as const

const kindChip = {
  ...chip,
  color: theme.inkSoft,
  background: theme.appBg,
  border: `1px solid ${theme.border}`,
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

const selectStyle = {
  height: 30,
  padding: '0 8px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 12.5,
  color: theme.ink,
} as const

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
  display: 'block',
  marginTop: 8,
} as const
