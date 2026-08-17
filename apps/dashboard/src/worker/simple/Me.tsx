/**
 * Me — the drawn identity card and the personal surface, transcribed from
 * the isMe block: the 76px avatar on the dark gradient, the CONTACT card,
 * and the settings rows. The drawing's MY DOCUMENTS section (tickets and
 * licences) waits on a table to hold them — nothing is rendered that the
 * database cannot back.
 */
import { useEffect, useState } from 'react'
import { supabase, type WorkerRow } from '../../data/supabase'
import { BUCKET_FILES, objectPath, signedUrl, uploadFile } from '../../data/storage'
import { HoursTab } from '../HoursTab'
import { s, SAFE_TOP, ticketTone } from './stheme'

interface TrackerSite {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
}

const ROLE_LABEL: Record<WorkerRow['role'], string> = {
  owner: 'Owner',
  captain: 'Crew captain',
  employee: 'Crew',
}

interface MyTicket {
  id: string
  name: string
  expires_on: string | null
  document_path: string | null
}

const fullDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The papers a site actually asks for. Offered as one-tap names because
 * these four are what gets asked for at nearly every induction — the field
 * stays free text for everything else a tiler might hold.
 */
const COMMON_TICKETS = ['Drivers Licence', 'White Card', 'First Aid', 'Police Clearance']

/** The card itself. Private bucket, so the thumbnail waits on a signed URL. */
function TicketThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void signedUrl(BUCKET_FILES, path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'block', flex: 'none', width: 44, height: 34, borderRadius: 6, overflow: 'hidden', border: '1px solid #DCE0E6', background: 'repeating-linear-gradient(135deg,#E4E7EA 0 6px,#DADEE2 6px 12px)' }}
    >
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </a>
  )
}

export function MeScreen({
  me,
  sites,
  trackingOn,
  onOpenClock,
  onShowAccount,
}: {
  me: WorkerRow
  sites: TrackerSite[]
  trackingOn: boolean
  onOpenClock: () => void
  onShowAccount: () => void
}) {
  const [showHours, setShowHours] = useState(false)
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [tickets, setTickets] = useState<MyTicket[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newExpiry, setNewExpiry] = useState('')
  const [saving, setSaving] = useState(false)
  const [ticketError, setTicketError] = useState<string | null>(null)

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [phone, setPhone] = useState('')
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null)
  const [docBusy, setDocBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('worker_profiles')
      .select('avatar_path, phone')
      .eq('worker_id', me.id)
      .maybeSingle()
      .then(async ({ data }) => {
        const row = data as { avatar_path: string | null; phone: string | null } | null
        if (!row) return
        if (!cancelled) setPhone(row.phone ?? '')
        if (!row.avatar_path) return
        const url = await signedUrl(BUCKET_FILES, row.avatar_path)
        if (!cancelled) setAvatarUrl(url)
      })
    return () => {
      cancelled = true
    }
  }, [me.id])

  /** One row per person, so every profile write is the same upsert. */
  async function saveProfile(patch: { avatar_path?: string; phone?: string | null }) {
    const { error } = await supabase()
      .from('worker_profiles')
      .upsert({ worker_id: me.id, company_id: me.company_id, ...patch, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
  }

  async function savePhone() {
    if (phoneDraft === null) return
    const next = phoneDraft.trim()
    setTicketError(null)
    try {
      await saveProfile({ phone: next || null })
      setPhone(next)
      setPhoneDraft(null)
    } catch (e) {
      setTicketError(e instanceof Error ? e.message : 'Could not save that number.')
    }
  }

  /** A photo of the card, filed against the ticket it proves. */
  async function attachDocument(ticketId: string, file: File) {
    if (docBusy) return
    setDocBusy(ticketId)
    setTicketError(null)
    try {
      const path = objectPath(me.company_id, 'tickets', file.name)
      await uploadFile(BUCKET_FILES, path, file)
      const { error } = await supabase().from('certifications').update({ document_path: path }).eq('id', ticketId)
      if (error) throw new Error(error.message)
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, document_path: path } : t)))
    } catch (e) {
      setTicketError(e instanceof Error ? e.message : 'Could not save that photo.')
    } finally {
      setDocBusy(null)
    }
  }

  /** The camera badge, wired: your own face, stored against your own row. */
  async function setAvatar(file: File) {
    if (avatarBusy) return
    setAvatarBusy(true)
    setTicketError(null)
    try {
      const path = objectPath(me.company_id, 'avatars', file.name)
      await uploadFile(BUCKET_FILES, path, file)
      await saveProfile({ avatar_path: path })
      setAvatarUrl(await signedUrl(BUCKET_FILES, path))
    } catch (e) {
      setTicketError(e instanceof Error ? e.message : 'Could not save that photo.')
    } finally {
      setAvatarBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('certifications')
      .select('id, name, expires_on, document_path')
      .eq('worker_id', me.id)
      .order('expires_on', { nullsFirst: false })
      .then(({ data }) => {
        if (!cancelled) setTickets((data ?? []) as MyTicket[])
      })
    return () => {
      cancelled = true
    }
  }, [me.id])

  async function addTicket() {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    setTicketError(null)
    const { data, error } = await supabase()
      .from('certifications')
      .insert({
        company_id: me.company_id,
        worker_id: me.id,
        name,
        expires_on: newExpiry || null,
      })
      .select('id, name, expires_on, document_path')
      .single()
    setSaving(false)
    if (error) {
      setTicketError(error.message)
      return
    }
    setTickets((prev) => [...prev, data as MyTicket])
    setNewName('')
    setNewExpiry('')
    setAdding(false)
  }

  async function removeTicket(id: string) {
    const { error } = await supabase().from('certifications').delete().eq('id', id)
    if (error) {
      setTicketError(error.message)
      return
    }
    setTickets((prev) => prev.filter((t) => t.id !== id))
  }

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void Promise.all([
      client.auth.getUser(),
      client.from('companies').select('name').maybeSingle(),
    ]).then(([u, c]) => {
      if (cancelled) return
      setEmail(u.data.user?.email ?? '')
      setCompany((c.data as { name: string } | null)?.name ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [me.id])

  if (showHours) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <button
          onClick={() => setShowHours(false)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `calc(10px + ${SAFE_TOP}) 16px 10px`, background: s.panel, border: 0, borderBottom: `1px solid ${s.borderSoft}`, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: s.accent, cursor: 'pointer' }}
        >
          <svg width="14" height="14" viewBox="0 0 10 10" style={{ transform: 'rotate(90deg)' }}>
            <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke={s.accent} strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          Me
        </button>
        <HoursTab me={me} sites={sites} />
      </div>
    )
  }

  const settingsRow = (k: string, v: string, opts: { red?: boolean; onTap?: () => void; last?: boolean } = {}) => (
    <span
      key={k}
      onClick={opts.onTap}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '11px 15px', borderBottom: opts.last ? 'none' : '1px solid #EDEFF1', cursor: opts.onTap ? 'pointer' : 'default' }}
    >
      <span style={{ flex: 1, fontSize: 15.5, color: opts.red ? '#A3282E' : s.ink, fontWeight: opts.red ? 600 : 500 }}>{k}</span>
      <span style={{ fontSize: 14, color: '#8B9096' }}>{v}</span>
    </span>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#F5F6F7', paddingTop: SAFE_TOP }}>
      {/* Identity — the 76px avatar on the dark gradient card. */}
      <div style={{ padding: '6px 18px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, padding: 18, borderRadius: 14, background: 'linear-gradient(#23272C,#15181C)', boxShadow: '0 10px 24px rgba(16,20,24,.20), 0 1px 0 rgba(255,255,255,.06) inset' }}>
          <label style={{ flex: 'none', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 76, height: 76, borderRadius: '50%', background: '#4A5057', color: '#fff', fontSize: 23, fontWeight: 600, letterSpacing: '.02em', overflow: 'visible', cursor: avatarBusy ? 'default' : 'pointer' }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              me.initials
            )}
            <span style={{ position: 'absolute', right: -2, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: '#fff', border: '2.5px solid #1B1F23' }}>
              {avatarBusy ? (
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #C3C9D0', borderTopColor: '#14171A', animation: 'cl-spin .8s linear infinite' }} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#14171A" strokeWidth="1.7" strokeLinejoin="round">
                  <path d="M2.6 6.2h3.1l1.3-1.9h6l1.3 1.9h3.1v9.6H2.6z" />
                  <circle cx="10" cy="10.8" r="3" />
                </svg>
              )}
            </span>
            <input
              type="file"
              accept="image/*"
              disabled={avatarBusy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void setAvatar(f)
              }}
              style={{ display: 'none' }}
            />
          </label>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.02em', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.name}</span>
            <span style={{ fontSize: 14, lineHeight: 1.35, color: '#98A0A8' }}>
              {[ROLE_LABEL[me.role], company || me.trade].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
      </div>

      {/* CONTACT. */}
      <div style={{ padding: '16px 18px 9px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>CONTACT</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', margin: '0 18px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, overflow: 'hidden' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, padding: '11px 15px', borderBottom: '1px solid #EDEFF1' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '.05em', color: '#7B838B' }}>EMAIL</span>
            <span style={{ fontSize: 15.5, color: s.ink }}>{email || '—'}</span>
          </span>
        </span>
        {/* Phone is the crew's own to set — it is how a site foreman reaches
            them, and it is nobody else's business to type it for them. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, padding: '11px 15px' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '.05em', color: '#7B838B' }}>PHONE</span>
            {phoneDraft === null ? (
              <span style={{ fontSize: 15.5, color: phone ? s.ink : '#9AA1A9' }}>{phone || 'Not set'}</span>
            ) : (
              <input
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                type="tel"
                inputMode="tel"
                autoFocus
                placeholder="0412 345 678"
                style={{ width: '100%', height: 40, padding: '0 10px', marginTop: 2, boxSizing: 'border-box', background: '#F5F6F7', border: '1px solid #DCE0E6', borderRadius: 8, font: 'inherit', fontSize: 16, color: s.ink, outline: 'none' }}
              />
            )}
          </span>
          {phoneDraft === null ? (
            <span onClick={() => setPhoneDraft(phone)} style={{ flex: 'none', fontSize: 13.5, fontWeight: 600, color: s.accent, cursor: 'pointer' }}>
              {phone ? 'Change' : 'Add'}
            </span>
          ) : (
            <span style={{ flex: 'none', display: 'flex', gap: 12 }}>
              <span onClick={() => setPhoneDraft(null)} style={{ fontSize: 13.5, color: '#8B9096', cursor: 'pointer' }}>Cancel</span>
              <span onClick={() => void savePhone()} style={{ fontSize: 13.5, fontWeight: 700, color: s.accent, cursor: 'pointer' }}>Save</span>
            </span>
          )}
        </span>
      </div>

      {/* MY TICKETS — what this person is licensed to do, and (for the
          office, which is who policy lets write them) a way to add one. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '18px 18px 9px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>MY LICENSES</span>
        {!adding && (
          <span onClick={() => setAdding(true)} style={{ fontSize: 13.5, fontWeight: 600, color: s.accent, cursor: 'pointer' }}>
            Add
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', margin: '0 18px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, overflow: 'hidden' }}>
        {tickets.map((t, i) => {
          const tone = ticketTone(t.expires_on)
          return (
            <span key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 62, padding: '11px 15px', borderBottom: i === tickets.length - 1 && !adding && tickets.length > 0 ? 'none' : '1px solid #EDEFF1' }}>
              {/* The card itself, if they have photographed it. */}
              {t.document_path && <TicketThumb path={t.document_path} />}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 15.5, color: s.ink }}>{t.name}</span>
                <span style={{ fontSize: 12.5, color: '#8B9096' }}>
                  {t.expires_on ? `Expires ${fullDate(t.expires_on)}` : 'No expiry'}
                </span>
              </span>
              <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 11, background: tone.bg, fontSize: 11.5, fontWeight: 700, color: tone.fg }}>
                {tone.suffix ? tone.suffix.replace(' · ', '') : 'Current'}
              </span>
              {/* Photograph the card, or replace the photo that is there. */}
              <label style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: '#F1F3F5', cursor: docBusy === t.id ? 'default' : 'pointer' }}>
                {docBusy === t.id ? (
                  <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #C3C9D0', borderTopColor: '#4A5057', animation: 'cl-spin .8s linear infinite' }} />
                ) : (
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="1.6" strokeLinejoin="round">
                    <path d="M2.6 6.2h3.1l1.3-1.9h6l1.3 1.9h3.1v9.6H2.6z" />
                    <circle cx="10" cy="10.8" r="3" />
                  </svg>
                )}
                <input
                  type="file"
                  accept="image/*"
                  disabled={docBusy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void attachDocument(t.id, f)
                  }}
                  style={{ display: 'none' }}
                />
              </label>
              <span onClick={() => void removeTicket(t.id)} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, cursor: 'pointer' }}>
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="#9AA1A9" strokeWidth="2" strokeLinecap="round">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </span>
            </span>
          )
        })}

        {adding && (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '13px 15px 15px' }}>
            {/* The four a site asks for, one tap each. */}
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {COMMON_TICKETS.map((name) => {
                const on = newName === name
                return (
                  <span
                    key={name}
                    onClick={() => setNewName(name)}
                    style={{ display: 'inline-flex', alignItems: 'center', height: 30, padding: '0 11px', borderRadius: 15, background: on ? '#1A1D21' : '#fff', border: `1px solid ${on ? '#1A1D21' : '#DCE0E6'}`, fontSize: 12.5, fontWeight: 600, color: on ? '#fff' : '#4A5057', cursor: 'pointer' }}
                  >
                    {name}
                  </span>
                )
              })}
            </span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Or type it — EWP, Working at Heights…"
              style={{ width: '100%', height: 48, padding: '0 13px', boxSizing: 'border-box', background: '#F5F6F7', border: '1px solid #DCE0E6', borderRadius: 10, font: 'inherit', fontSize: 16, color: s.ink, outline: 'none' }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' }}>EXPIRES (LEAVE BLANK IF IT DOESN'T)</span>
              <input
                type="date"
                value={newExpiry}
                onChange={(e) => setNewExpiry(e.target.value)}
                style={{ width: '100%', height: 48, padding: '0 13px', boxSizing: 'border-box', background: '#F5F6F7', border: '1px solid #DCE0E6', borderRadius: 10, font: 'inherit', fontSize: 16, color: s.ink, outline: 'none' }}
              />
            </span>
            <span style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={() => void addTicket()}
                disabled={!newName.trim() || saving}
                style={{ flex: 1, height: 46, border: 0, borderRadius: 10, background: !newName.trim() || saving ? '#C3C9D0' : '#1A1D21', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, letterSpacing: '.03em', color: '#fff', cursor: !newName.trim() || saving ? 'default' : 'pointer' }}
              >
                {saving ? 'SAVING…' : 'SAVE LICENSE'}
              </button>
              <button
                onClick={() => {
                  setAdding(false)
                  setNewName('')
                  setNewExpiry('')
                  setTicketError(null)
                }}
                style={{ flex: 'none', height: 46, padding: '0 16px', border: '1px solid #DCE0E6', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: '#4A5057', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </span>
          </span>
        )}

        {tickets.length === 0 && !adding && (
          <span style={{ padding: '15px', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
            Nothing on file yet. Add your licence, white card or first aid and photograph
            the card — they show on every job you are on.
          </span>
        )}
      </div>
      {ticketError && (
        <span style={{ display: 'block', padding: '9px 18px 0', fontSize: 13, lineHeight: 1.45, color: '#A3282E' }}>{ticketError}</span>
      )}

      {/* Settings — the drawn rows, plus the personal surfaces they open. */}
      <div style={{ display: 'flex', flexDirection: 'column', margin: 18, background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, overflow: 'hidden' }}>
        {settingsRow('My hours', 'Every shift', { onTap: () => setShowHours(true) })}
        {settingsRow('Location while working', trackingOn ? 'On' : 'Off', { onTap: onOpenClock })}
        {settingsRow('Account & privacy', '', { onTap: onShowAccount })}
        {settingsRow('Sign out', '', { red: true, last: true, onTap: () => void supabase().auth.signOut() })}
      </div>
    </div>
  )
}
