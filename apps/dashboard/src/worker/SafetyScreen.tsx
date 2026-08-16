import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, type WorkerRow } from '../data/supabase'
import { useSites } from './useSites'
import { fullDate } from '../format'
import { theme } from '../theme'

/**
 * Tickets, SWMS and the toolbox talk — Crewline Mobile, screen 7.
 *
 * An expired White Card is not a notification, it is a man who cannot be on the
 * slab. So the card says what the ticket stops him doing rather than that it
 * lapsed — which is why certifications gained a `restriction` column, and why
 * a ticket without one just shows its date instead of a guessed consequence.
 *
 * The SWMS is drawn as a gate across the start of the shift, not a suggestion
 * in a list. `unsigned_safety_docs()` is the gate; it being empty is the only
 * thing that opens it.
 */

interface Cert {
  id: string
  name: string
  expires_on: string | null
  restriction: string | null
}

interface SafetyDoc {
  id: string
  kind: 'swms' | 'induction' | 'policy'
  title: string
  body: string | null
  cost_code: string | null
  version: string
}

interface Signed {
  document_id: string
  signed_at: string
}

const DAY = 86_400_000

function ticketState(c: Cert): { label: string; bg: string; fg: string; expired: boolean } {
  if (!c.expires_on) return { label: 'CURRENT', bg: theme.successFill, fg: theme.successInk, expired: false }
  const days = Math.round((new Date(`${c.expires_on}T00:00:00`).getTime() - Date.now()) / DAY)
  if (days < 0) return { label: 'EXPIRED', bg: theme.alertFill, fg: theme.alertInk, expired: true }
  if (days <= 30) return { label: `${days} DAYS`, bg: theme.warnFill, fg: theme.warnInk, expired: false }
  return { label: 'CURRENT', bg: theme.successFill, fg: theme.successInk, expired: false }
}

export function SafetyScreen({
  me,
  siteId: standingIn,
  siteName: standingName,
  onClose,
}: {
  me: WorkerRow
  /** The fence the worker is inside right now, if any. */
  siteId: string | null
  siteName: string
  onClose: () => void
}) {
  /**
   * You sign on *before* the shift, which means before you are inside the
   * fence — so the gate cannot require the tracker to have placed you. It uses
   * the site you are standing in when there is one, and otherwise the only
   * site you have, which is the ordinary case for a crew on one job.
   */
  const all = useSites()
  const siteId = standingIn ?? (all.length === 1 ? all[0]!.id : null)
  const siteName = standingIn ? standingName : (all.find((s) => s.id === siteId)?.name ?? standingName)
  const [certs, setCerts] = useState<Cert[]>([])
  const [docs, setDocs] = useState<SafetyDoc[]>([])
  const [signed, setSigned] = useState<Signed[]>([])
  const [unsigned, setUnsigned] = useState<SafetyDoc[]>([])
  const [openDoc, setOpenDoc] = useState<SafetyDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const client = supabase()
    const [c, d, s, u] = await Promise.all([
      client.from('certifications').select('id,name,expires_on,restriction').eq('worker_id', me.id).order('expires_on', { nullsFirst: false }),
      client.from('safety_documents').select('id,kind,title,body,cost_code,version').eq('active', true).order('kind'),
      client.from('safety_signatures').select('document_id,signed_at').eq('worker_id', me.id),
      // The gate itself, asked of the database rather than recomputed here —
      // the re-sign window is the function's business, not the screen's.
      siteId
        ? client.rpc('unsigned_safety_docs', { p_worker: me.id, p_site: siteId })
        : Promise.resolve({ data: [], error: null }),
    ])
    if (c.error || d.error) setError((c.error ?? d.error)!.message)
    setCerts((c.data ?? []) as Cert[])
    setDocs((d.data ?? []) as SafetyDoc[])
    setSigned((s.data ?? []) as Signed[])
    setUnsigned((u.data ?? []) as SafetyDoc[])
    setLoading(false)
  }, [me.id, siteId])

  useEffect(() => {
    void load()
  }, [load])

  const expired = certs.filter((c) => ticketState(c).expired)
  const gateOpen = unsigned.length === 0
  const siteDocs = docs.filter((d) => d.kind !== 'policy')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.appBg }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: theme.panel, borderBottom: `1px solid ${theme.border}` }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 15, color: theme.accent, cursor: 'pointer' }}>
          ‹ Back
        </button>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>Safety</span>
          <span style={{ fontSize: 11.5, color: theme.inkFaint }}>
            {me.name} · {me.trade.toLowerCase()}
          </span>
        </span>
        <span style={{ width: 48 }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 24 }}>
        {error && <Band tone="alert">{error}</Band>}

        {expired.length > 0 && (
          <Band tone="alert">
            <strong>
              {expired.length === 1 ? 'One ticket expired.' : `${expired.length} tickets expired.`}
            </strong>{' '}
            {expired[0]!.restriction ?? 'The office needs a current copy before you are covered.'}
          </Band>
        )}

        {/* ---------------------------------------------------- the gate */}
        {siteId && !loading && (
          <div style={{ margin: '12px 14px', borderRadius: 10, overflow: 'hidden', border: `1px solid ${gateOpen ? theme.border : theme.alert}`, background: theme.panel }}>
            <div style={{ padding: '13px 15px', background: gateOpen ? theme.successFill : theme.alertFill }}>
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: gateOpen ? theme.successInk : theme.alertInk, marginBottom: 5 }}>
                {gateOpen ? 'SIGNED ON' : 'YOU CANNOT START YET'}
              </span>
              <span style={{ fontSize: 13.5, lineHeight: 1.5, color: gateOpen ? theme.successInk : theme.alertInk }}>
                {gateOpen
                  ? `Everything for ${siteName} is signed. You are good to start.`
                  : `${unsigned.length === 1 ? 'A document is' : `${unsigned.length} documents are`} not signed for ${siteName}. Until ${unsigned.length === 1 ? 'it is' : 'they are'}, you are not on this task.`}
              </span>
            </div>

            {siteDocs.map((d) => {
              const sig = signed.find((s) => s.document_id === d.id)
              const need = unsigned.some((u) => u.id === d.id)
              return (
                <button
                  key={d.id}
                  onClick={() => need && setOpenDoc(d)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 60,
                    padding: '12px 15px',
                    borderTop: `1px solid ${theme.borderSoft}`,
                    border: 'none',
                    borderTopWidth: 1,
                    borderTopStyle: 'solid',
                    background: theme.panel,
                    font: 'inherit',
                    textAlign: 'left',
                    cursor: need ? 'pointer' : 'default',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{d.title}</span>
                    <span style={{ fontSize: 12, color: theme.inkFaint }}>
                      {sig && !need
                        ? `Signed ${fullDate(sig.signed_at)}`
                        : d.cost_code
                          ? `${d.cost_code} · tap to read and sign`
                          : 'Tap to read and sign'}
                    </span>
                  </span>
                  <span
                    style={{
                      flex: 'none',
                      padding: '5px 11px',
                      borderRadius: 13,
                      background: need ? theme.alertFill : theme.successFill,
                      color: need ? theme.alertInk : theme.successInk,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {need ? 'REQUIRED' : 'DONE'}
                  </span>
                </button>
              )
            })}

            {siteDocs.length === 0 && (
              <div style={{ padding: '16px 15px', fontSize: 13, color: theme.inkSoft }}>
                The office has not put a SWMS or induction on this site yet, so there is nothing to sign.
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------- my tickets */}
        <div style={{ padding: '4px 18px 8px' }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint }}>MY TICKETS</span>
        </div>
        <div style={{ margin: '0 14px', borderRadius: 10, overflow: 'hidden', border: `1px solid ${theme.border}`, background: theme.panel }}>
          {certs.length === 0 && (
            <div style={{ padding: '18px 15px', fontSize: 13, color: theme.inkSoft }}>
              No tickets on file. The office adds these.
            </div>
          )}
          {certs.map((c, i) => {
            const st = ticketState(c)
            return (
              <div key={c.id} style={{ padding: '13px 15px', borderTop: i === 0 ? 'none' : `1px solid ${theme.borderSoft}` }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: theme.inkFaint }}>
                      {c.expires_on
                        ? st.expired
                          ? `Expired ${fullDate(c.expires_on)}`
                          : `Expires ${fullDate(c.expires_on)}`
                        : 'No expiry'}
                    </span>
                  </span>
                  <span style={{ flex: 'none', padding: '5px 11px', borderRadius: 13, background: st.bg, color: st.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {st.label}
                  </span>
                </span>
                {/* Only shown when the office wrote one. The design flagged an
                    invented consequence here; a ticket with no restriction on
                    file simply shows its date. */}
                {st.expired && c.restriction && (
                  <span style={{ display: 'block', marginTop: 8, padding: '9px 11px', borderRadius: 6, background: theme.alertFill, fontSize: 12.5, lineHeight: 1.5, color: theme.alertInk }}>
                    {c.restriction}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <span style={{ display: 'block', padding: '10px 18px 0', fontSize: 12, lineHeight: 1.5, color: theme.inkFaint }}>
          The office holds the certificates. A new one is not live until they have filed it.
        </span>
      </div>

      {openDoc && (
        <SignSheet
          me={me}
          doc={openDoc}
          siteId={siteId}
          onClose={() => setOpenDoc(null)}
          onSigned={() => {
            setOpenDoc(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function Band({ tone, children }: { tone: 'alert' | 'warn'; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '11px 18px',
        background: tone === 'alert' ? theme.alertFill : theme.warnFill,
        color: tone === 'alert' ? theme.alertInk : theme.warnInk,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Read it, then sign it. The button stays dead until there is a signature in
 * the box — a SWMS acknowledged with an empty canvas is worth nothing after an
 * incident, which is the only time anyone reads one.
 */
function SignSheet({
  me,
  doc,
  siteId,
  onClose,
  onSigned,
}: {
  me: WorkerRow
  doc: SafetyDoc
  siteId: string | null
  onClose: () => void
  onSigned: () => void
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = theme.ink
  }, [])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const controls = (doc.body ?? '').split('\n').map((l) => l.trim()).filter(Boolean)

  const sign = async () => {
    if (!hasInk || busy) return
    setBusy(true)
    const { error } = await supabase().from('safety_signatures').insert({
      company_id: me.company_id,
      document_id: doc.id,
      worker_id: me.id,
      site_id: siteId,
      signature: canvas.current?.toDataURL('image/png') ?? null,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onSigned()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 58, background: theme.panel, display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${theme.border}` }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 15, color: theme.accent, cursor: 'pointer' }}>
          Cancel
        </button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 15.5, fontWeight: 600 }}>Sign on</span>
        <span style={{ width: 50 }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '14px 18px' }}>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{doc.title}</span>
        <span style={{ display: 'block', fontSize: 12, color: theme.inkFaint, marginBottom: 14 }}>
          Version {doc.version}
          {doc.cost_code ? ` · ${doc.cost_code}` : ''}
        </span>

        {controls.length > 0 && (
          <>
            <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint, marginBottom: 9 }}>
              {controls.length === 1 ? 'WHAT YOU ARE SIGNING' : `THE ${controls.length} CONTROLS`}
            </span>
            {controls.map((c, i) => (
              <span key={i} style={{ display: 'flex', gap: 11, marginBottom: 11 }}>
                <span
                  style={{
                    flex: 'none',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: theme.ink,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontSize: 14, lineHeight: 1.5 }}>{c}</span>
              </span>
            ))}
          </>
        )}

        <span style={{ display: 'block', marginTop: 18, fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint, marginBottom: 8 }}>
          YOUR SIGNATURE
        </span>
        <div style={{ position: 'relative', border: `1px dashed ${hasInk ? theme.accent : theme.border}`, borderRadius: 8, background: theme.rowFill }}>
          <canvas
            ref={canvas}
            style={{ display: 'block', width: '100%', height: 150, touchAction: 'none' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              const ctx = canvas.current?.getContext('2d')
              if (!ctx) return
              const { x, y } = pos(e)
              ctx.beginPath()
              ctx.moveTo(x, y)
              drawing.current = true
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return
              const ctx = canvas.current?.getContext('2d')
              if (!ctx) return
              const { x, y } = pos(e)
              ctx.lineTo(x, y)
              ctx.stroke()
              if (!hasInk) setHasInk(true)
            }}
            onPointerUp={() => {
              drawing.current = false
            }}
          />
          {!hasInk && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontSize: 13.5, color: theme.inkGhost }}>
              Sign here with your finger
            </span>
          )}
        </div>
        {hasInk && (
          <button
            onClick={() => {
              const c = canvas.current
              const ctx = c?.getContext('2d')
              if (c && ctx) ctx.clearRect(0, 0, c.width, c.height)
              setHasInk(false)
            }}
            style={{ marginTop: 8, border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 13, color: theme.accent, cursor: 'pointer' }}
          >
            Clear and sign again
          </button>
        )}
        {err && <span style={{ display: 'block', marginTop: 10, fontSize: 12.5, color: theme.alertInk }}>{err}</span>}
      </div>

      <div style={{ flex: 'none', padding: '10px 18px 18px', borderTop: `1px solid ${theme.border}` }}>
        <button
          onClick={() => void sign()}
          disabled={!hasInk || busy}
          style={{
            width: '100%',
            height: 52,
            border: 'none',
            borderRadius: 6,
            background: hasInk ? theme.ink : theme.fill,
            color: hasInk ? '#fff' : theme.inkGhost,
            font: 'inherit',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '.03em',
            cursor: hasInk ? 'pointer' : 'default',
          }}
        >
          {busy ? 'SIGNING…' : 'SIGN AND START'}
        </button>
        {!hasInk && (
          <span style={{ display: 'block', marginTop: 8, textAlign: 'center', fontSize: 12, color: theme.inkFaint }}>
            Sign in the box above first.
          </span>
        )}
      </div>
    </div>
  )
}
