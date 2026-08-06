import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthScreen } from '../auth/AuthScreen'
import { useSession } from '../auth/useSession'
import { supabase, supabaseConfigured } from '../data/supabase'
import type { ChannelRow, MessageRow, WorkerRow } from '../data/supabase'
import { BUCKET_FILES, BUCKET_RECEIPTS, objectPath, uploadFile } from '../data/storage'
import { DWELL_IN_MS, type DwellPhase } from '../geofence/dwell'
import { distanceM } from '../geofence/geo'
import { theme } from '../theme'
import type { LatLng } from '../types'

/**
 * The worker's phone.
 *
 * Every fix goes to /api/ping, and the phase the server returns is what gets
 * displayed — the phone never decides its own hours. Mobile web only reports
 * while the page is open; reliable background tracking needs the native app.
 */

const PING_INTERVAL_MS = 20_000

interface ServerSite {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
}

export function WorkerApp() {
  const { loading, session, me } = useSession()

  if (!supabaseConfigured) {
    return <Notice title="Not configured">This build has no Supabase credentials.</Notice>
  }
  if (loading) return <Notice title="Loading…">One moment.</Notice>
  if (!session) return <AuthScreen />
  if (!me) {
    return (
      <Notice title="Not linked to a company">
        Ask your office to add you to the crew list, then sign in again.
      </Notice>
    )
  }

  return <Tracker me={me} />
}

type PanelKind = 'photo' | 'receipt' | 'chat' | null

function Tracker({ me }: { me: WorkerRow }) {
  const [fix, setFix] = useState<{ pos: LatLng; accuracyM: number } | null>(null)
  const [phase, setPhase] = useState<DwellPhase>({ kind: 'offsite' })
  const [sites, setSites] = useState<ServerSite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [tick, setTick] = useState(Date.now())
  const [tracking, setTracking] = useState(false)
  const [panel, setPanel] = useState<PanelKind>(null)

  const lastSent = useRef(0)
  const pending = useRef<Array<{ lat: number; lng: number; accuracyM: number; at: number }>>([])

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const send = useCallback(async (body: { lat: number; lng: number; accuracyM: number; at: number }) => {
    const { data } = await supabase().auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Session expired — sign in again.')

    const res = await fetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `Server returned ${res.status}`)
    }
    const payload = (await res.json()) as { phase: DwellPhase; sites: ServerSite[] }
    setPhase(payload.phase)
    setSites(payload.sites)
    setError(null)
  }, [])

  const onFix = useCallback(
    (pos: LatLng, accuracyM: number) => {
      setFix({ pos, accuracyM })
      const at = Date.now()
      if (at - lastSent.current < PING_INTERVAL_MS) return
      lastSent.current = at

      const body = { lat: pos.lat, lng: pos.lng, accuracyM, at }
      // Sites lose signal constantly. Queue and drain rather than lose fixes.
      const backlog = [...pending.current, body]
      pending.current = []
      setQueued(0)

      void (async () => {
        for (const item of backlog) {
          try {
            await send(item)
          } catch (err) {
            pending.current.push(item)
            setQueued(pending.current.length)
            setError(err instanceof Error ? err.message : String(err))
            return
          }
        }
      })()
    },
    [send],
  )

  useEffect(() => {
    if (!tracking) return
    if (!('geolocation' in navigator)) {
      setError('This device has no location services.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude }, p.coords.accuracy),
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [tracking, onFix])

  const currentSiteId = phase.kind === 'offsite' ? null : phase.siteId
  const site = currentSiteId ? sites.find((s) => s.id === currentSiteId) : null
  const onClock = phase.kind === 'onsite' || phase.kind === 'departing'
  const elapsed = onClock ? Math.max(0, tick - phase.since) : 0
  const confirming =
    phase.kind === 'arriving' ? Math.max(0, Math.ceil((DWELL_IN_MS - (tick - phase.since)) / 1000)) : 0

  const nearest =
    fix && sites.length
      ? sites
          .map((s) => ({ s, d: distanceM(fix.pos, { lat: s.lat, lng: s.lng }) }))
          .sort((a, b) => a.d - b.d)[0]
      : null

  function togglePanel(kind: Exclude<PanelKind, null>) {
    setPanel((p) => (p === kind ? null : kind))
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.appBg, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, padding: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 2px 14px' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: theme.railSoft,
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {me.initials}
          </span>
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{me.name}</div>
            <div style={{ fontSize: 12, color: theme.inkSoft }}>{me.trade}</div>
          </div>
          <button
            onClick={() => void supabase().auth.signOut()}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'none',
              color: theme.accent,
              font: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </header>

        <div
          style={{
            background: onClock ? '#EAF7EE' : theme.panel,
            border: `1px solid ${onClock ? '#B7E3C3' : theme.border}`,
            borderRadius: 10,
            padding: 20,
            textAlign: 'center',
          }}
        >
          {!tracking ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Start your shift</div>
              <p style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.5 }}>
                Turn on tracking and you'll be clocked in automatically when you
                reach a job site. Nothing is recorded until you tap this.
              </p>
              <button onClick={() => setTracking(true)} style={bigCta}>
                START TRACKING
              </button>
            </>
          ) : onClock ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: '#1B7A32' }}>
                ON THE CLOCK
              </div>
              <div
                style={{
                  fontSize: 46,
                  fontWeight: 600,
                  lineHeight: 1.1,
                  margin: '8px 0 2px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Math.floor(elapsed / 3_600_000)}:
                {String(Math.floor((elapsed % 3_600_000) / 60_000)).padStart(2, '0')}
              </div>
              <div style={{ fontSize: 14 }}>{site?.name}</div>
              <div style={{ fontSize: 12, color: theme.inkSoft, marginTop: 6 }}>
                Clocked in automatically — you didn't have to do anything.
              </div>
            </>
          ) : confirming > 0 ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: theme.accent }}>
                CONFIRMING YOU'RE ON SITE
              </div>
              <div style={{ fontSize: 40, fontWeight: 600, margin: '8px 0 2px' }}>{confirming}s</div>
              <div style={{ fontSize: 13 }}>{site?.name}</div>
              <div style={{ fontSize: 12, color: theme.inkSoft, marginTop: 6 }}>
                We wait until you've settled in, so driving past doesn't clock you in.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: theme.inkSoft }}>
                NOT ON THE CLOCK
              </div>
              <div style={{ fontSize: 15, margin: '10px 0 2px' }}>
                {nearest
                  ? `${(nearest.d / 1000).toFixed(1)} km from ${nearest.s.name}`
                  : sites.length === 0
                    ? 'Waiting for your first location report…'
                    : 'Waiting for GPS…'}
              </div>
              <div style={{ fontSize: 12, color: theme.inkSoft }}>
                You'll clock in automatically when you arrive.
              </div>
            </>
          )}
        </div>

        {queued > 0 && (
          <div style={{ ...banner, background: '#FFF6DF', borderColor: '#F2D89A', color: '#8A6100' }}>
            Offline — {queued} location{queued === 1 ? '' : 's'} waiting to send. They'll
            go through when you get signal.
          </div>
        )}

        {error && (
          <div style={{ ...banner, background: '#FDECEC', borderColor: '#F5C2C2', color: '#8A1C1C' }}>
            {error}
          </div>
        )}

        {tracking && (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <ActionButton label="Take photo" active={panel === 'photo'} onClick={() => togglePanel('photo')} />
              <ActionButton label="Upload receipt" active={panel === 'receipt'} onClick={() => togglePanel('receipt')} />
              <ActionButton label="Site chat" active={panel === 'chat'} onClick={() => togglePanel('chat')} />
            </div>

            {panel === 'photo' && (
              <PhotoPanel
                me={me}
                currentSiteId={currentSiteId}
                sites={sites}
                fix={fix}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === 'receipt' && (
              <ReceiptPanel
                me={me}
                currentSiteId={currentSiteId}
                sites={sites}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === 'chat' && (
              <ChatPanel
                me={me}
                currentSiteId={currentSiteId}
                sites={sites}
                onClose={() => setPanel(null)}
              />
            )}
          </>
        )}

        <p style={{ fontSize: 11, color: theme.inkFaint, textAlign: 'center', marginTop: 18, lineHeight: 1.5 }}>
          {fix
            ? `GPS ±${Math.round(fix.accuracyM)} m · reporting every ${PING_INTERVAL_MS / 1000}s`
            : 'No fix yet'}
          <br />
          Location is only recorded while tracking is on.
        </p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- photo

const PHOTO_CATEGORIES = ['progress', 'issue', 'before', 'after', 'inspection'] as const
type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]
const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  progress: 'Progress',
  issue: 'Issue',
  before: 'Before',
  after: 'After',
  inspection: 'Inspection',
}

function PhotoPanel({
  me,
  currentSiteId,
  sites,
  fix,
  onClose,
}: {
  me: WorkerRow
  currentSiteId: string | null
  sites: ServerSite[]
  fix: { pos: LatLng; accuracyM: number } | null
  onClose: () => void
}) {
  const [siteId, setSiteId] = useState(currentSiteId ?? sites[0]?.id ?? '')
  const [category, setCategory] = useState<PhotoCategory>('progress')
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (currentSiteId) setSiteId(currentSiteId)
  }, [currentSiteId])

  async function handleFile(file: File) {
    if (!siteId) {
      setError('Pick a job site first.')
      return
    }
    setUploading(true)
    setError(null)
    setSuccess(false)
    try {
      const path = objectPath(me.company_id, siteId, file.name)
      await uploadFile(BUCKET_FILES, path, file)
      const { error: err } = await supabase()
        .from('site_files')
        .insert({
          company_id: me.company_id,
          site_id: siteId,
          uploaded_by: me.id,
          kind: 'photo',
          storage_path: path,
          name: file.name,
          mime: file.type || null,
          size_bytes: file.size,
          category,
          caption: caption.trim() || null,
          lat: fix?.pos.lat ?? null,
          lng: fix?.pos.lng ?? null,
          taken_at: new Date().toISOString(),
        })
      if (err) throw new Error(err.message)
      setSuccess(true)
      setCaption('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Panel title="Take a photo" onClose={onClose}>
      <SiteSelect siteId={siteId} sites={sites} locked={Boolean(currentSiteId)} onChange={setSiteId} />

      <FieldLabel>Category</FieldLabel>
      <select value={category} onChange={(e) => setCategory(e.target.value as PhotoCategory)} style={selectField}>
        {PHOTO_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {PHOTO_CATEGORY_LABEL[c]}
          </option>
        ))}
      </select>

      <FieldLabel>Caption (optional)</FieldLabel>
      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="What's this show?"
        style={textField}
      />

      <div style={hint}>
        {fix
          ? `Stamped at your current GPS location · ±${Math.round(fix.accuracyM)} m`
          : 'No GPS fix yet — the photo will save without a location stamp.'}
      </div>

      <label style={{ ...bigCta, display: 'block', textAlign: 'center', opacity: uploading || !siteId ? 0.6 : 1 }}>
        {uploading ? 'UPLOADING…' : 'OPEN CAMERA'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={uploading || !siteId}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void handleFile(file)
          }}
          style={{ display: 'none' }}
        />
      </label>

      {success && <div style={successBanner}>Photo uploaded.</div>}
      {error && <div style={errorBanner}>{error}</div>}
    </Panel>
  )
}

// ----------------------------------------------------------------- receipt

const EXPENSE_CATEGORIES = ['Materials', 'Subcontractor', 'Equipment Rental', 'Permits', 'Fuel', 'Other']

interface ReceiptForm {
  siteId: string
  vendor: string
  spentOn: string
  amount: string
  tax: string
  category: string
  lineItems: Array<{ description: string; amount: number }>
  aiNote: string | null
  aiConfidence: number | null
  /** Field names still showing the "read from photo" marker — cleared as the user corrects each one. */
  aiFilled: Set<string>
  aiExtracted: boolean
  receiptPath: string | null
}

function blankReceiptForm(siteId: string): ReceiptForm {
  return {
    siteId,
    vendor: '',
    spentOn: new Date().toISOString().slice(0, 10),
    amount: '',
    tax: '',
    category: '',
    lineItems: [],
    aiNote: null,
    aiConfidence: null,
    aiFilled: new Set(),
    aiExtracted: false,
    receiptPath: null,
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

function ReceiptPanel({
  me,
  currentSiteId,
  sites,
  onClose,
}: {
  me: WorkerRow
  currentSiteId: string | null
  sites: ServerSite[]
  onClose: () => void
}) {
  const [form, setForm] = useState<ReceiptForm>(() => blankReceiptForm(currentSiteId ?? sites[0]?.id ?? ''))
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (currentSiteId) setForm((f) => ({ ...f, siteId: currentSiteId }))
  }, [currentSiteId])

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name

  function editField<K extends keyof ReceiptForm>(key: K, value: ReceiptForm[K]) {
    setForm((f) => {
      const nextFilled = new Set(f.aiFilled)
      nextFilled.delete(key as string)
      return { ...f, [key]: value, aiFilled: nextFilled }
    })
  }

  async function handleFile(file: File) {
    setError(null)
    setSaved(false)
    setExtracting(true)
    try {
      const path = objectPath(me.company_id, form.siteId || 'unassigned', file.name)
      await uploadFile(BUCKET_RECEIPTS, path, file)
      setForm((f) => ({ ...f, receiptPath: path }))

      const base64 = await readFileAsBase64(file)
      const {
        data: { session },
      } = await supabase().auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Session expired — sign in again.')

      const res = await fetch('/api/parse-receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          imageBase64: base64,
          mediaType: file.type || 'image/jpeg',
          siteHint: form.siteId ? siteName(form.siteId) : undefined,
          sitesList: sites.map((s) => s.name),
        }),
      })

      if (res.status === 501) return // AI extraction not configured — form stays fully usable by hand.

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Extraction failed (${res.status})`)
      }

      const parsed = (await res.json()) as {
        vendor: string | null
        spent_on: string | null
        amount: number | null
        tax: number | null
        category: string | null
        line_items: Array<{ description: string; amount: number }>
        confidence: number | null
        note: string | null
      }

      const filled = new Set<string>()
      setForm((f) => {
        const next = { ...f }
        if (parsed.vendor) {
          next.vendor = parsed.vendor
          filled.add('vendor')
        }
        if (parsed.spent_on) {
          next.spentOn = parsed.spent_on
          filled.add('spentOn')
        }
        if (parsed.amount != null) {
          next.amount = String(parsed.amount)
          filled.add('amount')
        }
        if (parsed.tax != null) {
          next.tax = String(parsed.tax)
          filled.add('tax')
        }
        if (parsed.category) {
          next.category = parsed.category
          filled.add('category')
        }
        next.lineItems = parsed.line_items ?? []
        next.aiNote = parsed.note
        next.aiConfidence = parsed.confidence
        next.aiFilled = filled
        next.aiExtracted = true
        return next
      })
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't read the receipt automatically — ${e.message}. Enter it by hand.`
          : "Couldn't read the receipt automatically. Enter it by hand.",
      )
    } finally {
      setExtracting(false)
    }
  }

  async function save() {
    if (!form.vendor.trim() || !form.spentOn || !form.amount) {
      setError('Vendor, date, and amount are required.')
      return
    }
    setSaving(true)
    setError(null)
    const { error: err } = await supabase()
      .from('expenses')
      .insert({
        company_id: me.company_id,
        site_id: form.siteId || null,
        submitted_by: me.id,
        vendor: form.vendor.trim(),
        spent_on: form.spentOn,
        amount: Number(form.amount) || 0,
        tax: Number(form.tax) || 0,
        category: form.category || null,
        receipt_path: form.receiptPath,
        status: 'needs_review',
        ai_note: form.aiNote,
        ai_confidence: form.aiConfidence,
        line_items: form.lineItems,
      })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setSaved(true)
    setForm(blankReceiptForm(currentSiteId ?? sites[0]?.id ?? ''))
  }

  return (
    <Panel title="Upload receipt" onClose={onClose}>
      <label style={{ ...bigCta, display: 'block', textAlign: 'center', opacity: extracting ? 0.6 : 1 }}>
        {extracting ? 'READING RECEIPT…' : form.receiptPath ? 'RETAKE PHOTO' : 'OPEN CAMERA'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={extracting}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void handleFile(file)
          }}
          style={{ display: 'none' }}
        />
      </label>

      {form.aiExtracted && !extracting && (
        <div style={hint}>
          Read from photo — confidence{' '}
          {form.aiConfidence != null ? `${Math.round(form.aiConfidence * 100)}%` : '—'}. Check every field
          below.
        </div>
      )}

      <SiteSelect siteId={form.siteId} sites={sites} locked={false} onChange={(id) => editField('siteId', id)} />
      {currentSiteId && form.siteId === currentSiteId && (
        <div style={hint}>Prefilled from where you are right now.</div>
      )}

      <ReceiptField
        label="Vendor"
        value={form.vendor}
        aiFilled={form.aiFilled.has('vendor')}
        onChange={(v) => editField('vendor', v)}
        placeholder="Home Depot"
      />
      <ReceiptField
        label="Date"
        type="date"
        value={form.spentOn}
        aiFilled={form.aiFilled.has('spentOn')}
        onChange={(v) => editField('spentOn', v)}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <ReceiptField
            label="Amount"
            value={form.amount}
            aiFilled={form.aiFilled.has('amount')}
            onChange={(v) => editField('amount', v)}
            placeholder="0.00"
          />
        </div>
        <div style={{ flex: 1 }}>
          <ReceiptField
            label="Tax"
            value={form.tax}
            aiFilled={form.aiFilled.has('tax')}
            onChange={(v) => editField('tax', v)}
            placeholder="0.00"
          />
        </div>
      </div>

      <FieldLabel>
        Category
        {form.aiFilled.has('category') && <AiMarker />}
      </FieldLabel>
      <select value={form.category} onChange={(e) => editField('category', e.target.value)} style={selectField}>
        <option value="">—</option>
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {form.lineItems.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12.5 }}>
          <div style={{ color: theme.inkFaint, marginBottom: 4 }}>Line items read from photo</div>
          {form.lineItems.map((li, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ color: theme.inkSoft }}>{li.description}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(li.amount).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div style={errorBanner}>{error}</div>}
      {saved && <div style={successBanner}>Receipt saved — sent for office review.</div>}

      <button onClick={() => void save()} disabled={saving || extracting} style={{ ...bigCta, marginTop: 14 }}>
        {saving ? 'SAVING…' : 'SAVE EXPENSE'}
      </button>
    </Panel>
  )
}

function ReceiptField({
  label: labelText,
  value,
  onChange,
  placeholder,
  type = 'text',
  aiFilled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  aiFilled?: boolean
}) {
  return (
    <>
      <FieldLabel>
        {labelText}
        {aiFilled && <AiMarker />}
      </FieldLabel>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={textField}
      />
    </>
  )
}

function AiMarker() {
  return (
    <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: theme.accent }}>
      · read from photo
    </span>
  )
}

// -------------------------------------------------------------------- chat

interface MessageWithAuthor extends MessageRow {
  workers: { name: string; initials: string } | null
}

function ChatPanel({
  me,
  currentSiteId,
  sites,
  onClose,
}: {
  me: WorkerRow
  currentSiteId: string | null
  sites: ServerSite[]
  onClose: () => void
}) {
  const [siteId, setSiteId] = useState(currentSiteId ?? '')
  const [channel, setChannel] = useState<ChannelRow | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [authors, setAuthors] = useState<Record<string, { name: string; initials: string }>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const authorsRef = useRef(authors)
  useEffect(() => {
    authorsRef.current = authors
  }, [authors])

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (currentSiteId) setSiteId(currentSiteId)
  }, [currentSiteId])

  useEffect(() => {
    if (!siteId) {
      setChannel(null)
      setMessages([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void supabase()
      .from('channels')
      .select('*')
      .eq('site_id', siteId)
      .eq('kind', 'site')
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        setChannel((data as ChannelRow) ?? null)
        if (!data) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [siteId])

  useEffect(() => {
    if (!channel) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void supabase()
      .from('messages')
      .select('*, workers(name, initials)')
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        const rows = ((data ?? []) as MessageWithAuthor[]).slice().reverse()
        setMessages(rows)
        setAuthors((prev) => {
          const next = { ...prev }
          for (const r of rows) {
            if (r.author_id && r.workers) next[r.author_id] = r.workers
          }
          return next
        })
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [channel])

  useEffect(() => {
    if (!channel) return
    const id = channel.id
    const client = supabase()
    const ch = client
      .channel(`worker-chat-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${id}` },
        (payload) => {
          const row = payload.new as MessageRow
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
          const authorId = row.author_id
          if (authorId && authorId !== me.id && !authorsRef.current[authorId]) {
            void supabase()
              .from('workers')
              .select('name, initials')
              .eq('id', authorId)
              .maybeSingle()
              .then(({ data }) => {
                if (data) setAuthors((p) => ({ ...p, [authorId]: data as { name: string; initials: string } }))
              })
          }
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(ch)
    }
  }, [channel, me.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  async function send() {
    const body = draft.trim()
    if (!body || !channel || sending) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase()
      .from('messages')
      .insert({
        company_id: me.company_id,
        channel_id: channel.id,
        author_id: me.id,
        kind: 'user',
        body,
      })
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setDraft('')
  }

  return (
    <Panel title="Site chat" onClose={onClose}>
      <SiteSelect siteId={siteId} sites={sites} locked={Boolean(currentSiteId)} onChange={setSiteId} />

      {!siteId ? (
        <div style={hint}>Pick a site to see its chat.</div>
      ) : loading && !channel ? (
        <div style={hint}>Loading…</div>
      ) : !channel ? (
        <div style={hint}>No chat channel for this site yet.</div>
      ) : (
        <>
          <div
            style={{
              marginTop: 10,
              maxHeight: 320,
              overflowY: 'auto',
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: 10,
              background: theme.appBg,
            }}
          >
            {loading && <div style={{ fontSize: 12.5, color: theme.inkSoft }}>Loading…</div>}
            {!loading && messages.length === 0 && (
              <div style={{ fontSize: 12.5, color: theme.inkSoft, textAlign: 'center', padding: 12 }}>
                No messages yet. Say hello.
              </div>
            )}
            {messages.map((m) =>
              m.kind === 'system' ? (
                <div key={m.id} style={{ textAlign: 'center', margin: '8px 0' }}>
                  <span style={{ fontSize: 12, color: theme.inkFaint }}>
                    {m.body} · {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              ) : (
                <div key={m.id} style={{ margin: '8px 0' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {m.author_id === me.id ? 'You' : authors[m.author_id ?? '']?.name ?? 'Crew'}
                    </span>
                    <span style={{ fontSize: 11, color: theme.inkFaint }}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Message the crew…"
              style={{ ...textField, flex: 1, marginTop: 0 }}
            />
            <button onClick={() => void send()} disabled={sending || !draft.trim()} style={{ ...cta, flex: 'none' }}>
              {sending ? '…' : 'SEND'}
            </button>
          </div>
        </>
      )}

      {error && <div style={errorBanner}>{error}</div>}
    </Panel>
  )
}

// ------------------------------------------------------------------ shared

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12, padding: 14, background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'none',
            color: theme.inkSoft,
            fontSize: 22,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 4,
          }}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  )
}

function SiteSelect({
  siteId,
  sites,
  locked,
  onChange,
}: {
  siteId: string
  sites: ServerSite[]
  locked: boolean
  onChange: (id: string) => void
}) {
  return (
    <>
      <FieldLabel>Job site</FieldLabel>
      {sites.length === 0 ? (
        <div style={hint}>No job sites loaded yet — wait for your first location report.</div>
      ) : locked ? (
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
          {sites.find((s) => s.id === siteId)?.name ?? '—'}
        </div>
      ) : (
        <select value={siteId} onChange={(e) => onChange(e.target.value)} style={selectField}>
          <option value="">Choose a site…</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: theme.inkFaint, marginTop: 10 }}>
      {children}
    </div>
  )
}

function ActionButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '14px 6px',
        borderRadius: 8,
        border: `1px solid ${active ? theme.accent : theme.border}`,
        background: active ? theme.accentFill : theme.panel,
        color: active ? theme.accent : theme.ink,
        font: 'inherit',
        fontSize: 12.5,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.appBg,
        padding: 24,
        textAlign: 'center',
        font: '14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 360 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.ink }}>{title}</div>
        <p style={{ color: theme.inkSoft }}>{children}</p>
      </div>
    </div>
  )
}

const banner = {
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid',
  fontSize: 12.5,
  lineHeight: 1.45,
} as const

const bigCta = {
  width: '100%',
  marginTop: 14,
  padding: '14px 0',
  borderRadius: 6,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}

const hint = {
  fontSize: 12,
  color: theme.inkSoft,
  marginTop: 6,
  lineHeight: 1.45,
} as const

const errorBanner = {
  marginTop: 10,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #F5C2C2',
  background: '#FDECEC',
  color: '#8A1C1C',
  fontSize: 12.5,
  lineHeight: 1.45,
} as const

const successBanner = {
  marginTop: 10,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #B7E3C3',
  background: '#EAF7EE',
  color: '#1B7A32',
  fontSize: 12.5,
  lineHeight: 1.45,
} as const

const selectField = {
  display: 'block',
  width: '100%',
  height: 42,
  marginTop: 4,
  padding: '0 10px',
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 14,
  color: theme.ink,
  boxSizing: 'border-box',
} as const

const textField = {
  display: 'block',
  width: '100%',
  height: 42,
  marginTop: 4,
  padding: '0 10px',
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 14,
  color: theme.ink,
  boxSizing: 'border-box',
} as const

const cta = {
  padding: '10px 16px',
  borderRadius: 6,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
} as const
