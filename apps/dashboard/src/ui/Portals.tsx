import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  supabase,
  type ChangeOrderRow,
  type DailyLogRow,
  type InvoiceRow,
  type MilestoneRow,
  type PortalContactRow,
  type SelectionRow,
  type SiteFileRow,
  type WorkerRow,
} from '../data/supabase'
import { BUCKET_FILES, signedUrl } from '../data/storage'
import { money } from '../format'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Portals — the office's control panel for client and subcontractor access,
 * and a live preview of what each of them actually sees once they sign in.
 *
 * Portal seats are free by design: it's the cheapest way to put this software
 * in front of a client every week, so the toolbar says so plainly rather than
 * leaving the office to wonder whether invites cost extra.
 *
 * Milestones and selections have no screen of their own — this is where they
 * get written, directly beneath the same card that renders them for the
 * client, so editing one means clicking the thing you're changing.
 *
 * The sub/vendor preview shows less than the reference mock implies on
 * purpose: there is no table yet linking a specific task or purchase order to
 * a subcontractor, so those two sections say so honestly rather than
 * inventing rows. Everything that does have a real table — site documents,
 * milestones, selections, change orders, invoices, photos — is wired live.
 */

// ------------------------------------------------------------------ colours

const GREEN = { bg: '#EAF7EE', fg: '#1B7A32' }
const RED = { bg: '#FCE8EA', fg: theme.alert }
const GREY = { bg: '#F5F6F7', fg: theme.inkSoft }
const BLUE = { bg: theme.accentFill, fg: theme.accent }

// ------------------------------------------------------------------ helpers

const todayStr = () => new Date().toISOString().slice(0, 10)

/** Date-only columns are 'YYYY-MM-DD' — parse at local midnight, not UTC. */
const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null

const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { weekday: 'long' })

function truncate(s: string, max: number) {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function formatSize(bytes: number | null) {
  if (!bytes) return null
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Same first-two-initials mark used for the crew and channel avatars. */
function companyMark(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '··'
  )
}

function invoiceBadge(inv: InvoiceRow): { label: string; bg: string; fg: string } {
  const overdue = inv.status === 'sent' && Boolean(inv.due_on) && inv.due_on! < todayStr()
  if (overdue) return { label: 'Overdue', ...RED }
  if (inv.status === 'paid') return { label: 'Paid', ...GREEN }
  if (inv.status === 'sent') return { label: 'Sent', ...BLUE }
  if (inv.status === 'void') return { label: 'Void', ...GREY }
  return { label: 'Draft', ...GREY }
}

/** "+$2,860 · +2 days · awaiting your approval" — never the illustrative reason from the mock. */
function coDetail(co: ChangeOrderRow) {
  const amt = Number(co.cost_impact)
  const moneyPhrase = `${amt >= 0 ? '+' : ''}${money(amt)}`
  const days = Number(co.days_impact)
  const daysPhrase =
    days === 0 ? 'no schedule change' : `${days > 0 ? '+' : ''}${days} day${Math.abs(days) === 1 ? '' : 's'}`
  return `${moneyPhrase} · ${daysPhrase} · awaiting your approval`
}

function selDetail(sel: SelectionRow) {
  if (sel.detail?.trim()) return sel.detail.trim()
  if (sel.needed_by) return `Needed by ${shortDate(sel.needed_by)}`
  return 'Awaiting your choice'
}

function docMeta(d: SiteFileRow) {
  const parts = [
    d.category ? d.category.charAt(0).toUpperCase() + d.category.slice(1) : null,
    formatSize(d.size_bytes),
    new Date(d.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
  ].filter((p): p is string => Boolean(p))
  return parts.join(' · ')
}

function contactStatus(c: PortalContactRow) {
  if (!c.active) return { label: 'Removed', color: theme.inkFaint }
  if (!c.auth_user_id) return { label: 'Invited', color: theme.warning }
  return { label: 'Active', color: theme.success }
}

// -------------------------------------------------------------------- icons

function CheckIcon({ size, stroke, strokeWidth }: { size: number; stroke: string; strokeWidth: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
    >
      <path d="M3 8.4l3.2 3.2L13 4.8" />
    </svg>
  )
}

function RingIcon({ color }: { color: string }) {
  return (
    <span
      style={{ flex: 'none', display: 'block', width: 16, height: 16, borderRadius: '50%', border: `2px solid ${color}` }}
    />
  )
}

function DocIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 16 16" fill="none" stroke="#8B9096" strokeWidth={1.3} style={{ flex: 'none' }}>
      <path d="M3.6 1.6h6l3 3v9.8H3.6z" strokeLinejoin="round" />
      <path d="M9.6 1.6v3h3" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#8B9096"
      strokeWidth={1.4}
      style={{ flex: 'none', marginTop: 1 }}
    >
      <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.2" />
      <path d="M5.6 7V5.2a2.4 2.4 0 014.8 0V7" strokeLinecap="round" />
    </svg>
  )
}

/**
 * A photo cell that starts as the mock's woven placeholder texture and
 * upgrades to the real thumbnail once its signed URL resolves — the bucket
 * is private, so there is no such thing as an unsigned photo src.
 */
function PortalPhotoThumb({ file }: { file: SiteFileRow }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void signedUrl(BUCKET_FILES, file.storage_path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [file.storage_path])

  return (
    <span
      style={{
        display: 'block',
        aspectRatio: '1 / 1',
        borderRadius: 4,
        overflow: 'hidden',
        background: 'repeating-linear-gradient(135deg,#E4E7EA 0 6px,#DADEE2 6px 12px)',
      }}
    >
      {url && (
        <img
          src={url}
          alt={file.caption ?? file.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </span>
  )
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  width = 170,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
  type?: string
}) {
  return (
    <label style={fieldLabel}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...fieldInput, width }}
      />
    </label>
  )
}

// -------------------------------------------------------------------- types

/** job_sites columns the client card needs that the app-level JobSite type doesn't carry. */
interface SiteExtraRow {
  id: string
  progress_pct: number | null
  schedule_note: string | null
  client_name: string | null
}

interface InviteForm {
  kind: 'client' | 'sub'
  name: string
  org: string
  email: string
  siteId: string
}

interface MilestoneForm {
  name: string
  dueOn: string
}

interface SelectionForm {
  name: string
  detail: string
  neededBy: string
}

interface AnswerState {
  id: string
  text: string
}

const blankInvite = (siteId: string): InviteForm => ({ kind: 'client', name: '', org: '', email: '', siteId })

// ---------------------------------------------------------------- component

export function Portals({
  me,
  sites,
  // Portal contacts are external people, not crew — this screen has no
  // honest use for the roster, but keeps the parameter for the uniform
  // screen-prop contract every other feature screen shares (see Dashboard).
  workers: _workers,
  onChanged,
}: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [contacts, setContacts] = useState<PortalContactRow[]>([])
  const [milestones, setMilestones] = useState<MilestoneRow[]>([])
  const [selections, setSelections] = useState<SelectionRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRow[]>([])
  const [files, setFiles] = useState<SiteFileRow[]>([])
  const [dailyLogs, setDailyLogs] = useState<DailyLogRow[]>([])
  const [companyName, setCompanyName] = useState('')
  const [siteExtra, setSiteExtra] = useState<Map<string, SiteExtraRow>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Which site's client portal, and which sub, the two cards preview.
  const [clientSiteId, setClientSiteId] = useState('')
  const [subContactId, setSubContactId] = useState('')

  // Manage-access toolbar toggle + invite form.
  const [showAccess, setShowAccess] = useState(false)
  const [inviteForm, setInviteForm] = useState<InviteForm | null>(null)
  const [savingInvite, setSavingInvite] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)

  // Answering a pending selection inline, in place of its "Choose" button.
  const [answering, setAnswering] = useState<AnswerState | null>(null)
  const [savingAnswer, setSavingAnswer] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)

  // Adding a milestone or selection for the previewed site.
  const [milestoneForm, setMilestoneForm] = useState<MilestoneForm | null>(null)
  const [savingMilestone, setSavingMilestone] = useState(false)
  const [milestoneError, setMilestoneError] = useState<string | null>(null)
  const [selectionForm, setSelectionForm] = useState<SelectionForm | null>(null)
  const [savingSelection, setSavingSelection] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase()
    const [contactsRes, milestonesRes, selectionsRes, invoicesRes, changeOrdersRes, filesRes, logsRes, companyRes, siteExtraRes] =
      await Promise.all([
        client.from('portal_contacts').select('*'),
        client.from('milestones').select('*'),
        client.from('selections').select('*'),
        client.from('invoices').select('*').neq('status', 'draft').order('issued_on', { ascending: false }),
        client.from('change_orders').select('*').eq('status', 'pending_client').order('raised_on', { ascending: false }),
        client.from('site_files').select('*').order('created_at', { ascending: false }),
        client.from('daily_logs').select('*').eq('status', 'confirmed').order('log_date', { ascending: false }),
        client.from('companies').select('name').maybeSingle(),
        client.from('job_sites').select('id, progress_pct, schedule_note, client_name'),
      ])

    const firstError =
      contactsRes.error ??
      milestonesRes.error ??
      selectionsRes.error ??
      invoicesRes.error ??
      changeOrdersRes.error ??
      filesRes.error ??
      logsRes.error ??
      siteExtraRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    setContacts((contactsRes.data ?? []) as PortalContactRow[])
    setMilestones((milestonesRes.data ?? []) as MilestoneRow[])
    setSelections((selectionsRes.data ?? []) as SelectionRow[])
    setInvoices((invoicesRes.data ?? []) as InvoiceRow[])
    setChangeOrders((changeOrdersRes.data ?? []) as ChangeOrderRow[])
    setFiles((filesRes.data ?? []) as SiteFileRow[])
    setDailyLogs((logsRes.data ?? []) as DailyLogRow[])
    setCompanyName((companyRes.data as { name: string } | null)?.name ?? '')
    setSiteExtra(new Map(((siteExtraRes.data ?? []) as SiteExtraRow[]).map((r) => [r.id, r])))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Default (and re-pin, if the current pick disappears) the previewed site.
  useEffect(() => {
    if (sites.length === 0) {
      if (clientSiteId) setClientSiteId('')
      return
    }
    if (!sites.some((s) => s.id === clientSiteId)) setClientSiteId(sites[0].id)
  }, [sites, clientSiteId])

  const subContacts = useMemo(
    () => contacts.filter((c) => c.kind === 'sub' && c.active),
    [contacts],
  )
  useEffect(() => {
    if (subContacts.length === 0) {
      if (subContactId) setSubContactId('')
      return
    }
    if (!subContacts.some((c) => c.id === subContactId)) setSubContactId(subContacts[0].id)
  }, [subContacts, subContactId])

  const sortedContacts = useMemo(
    () => [...contacts].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    [contacts],
  )

  const mark = companyMark(companyName)

  const clientSite = useMemo(() => sites.find((s) => s.id === clientSiteId) ?? null, [sites, clientSiteId])
  const clientExtra = clientSiteId ? siteExtra.get(clientSiteId) : undefined

  const clientLabelFor = useCallback(
    (siteId: string) => {
      const contact = contacts.find((c) => c.kind === 'client' && c.site_id === siteId && c.active)
      if (contact) return contact.name
      const extra = siteExtra.get(siteId)
      return extra?.client_name?.trim() || 'No client named yet'
    },
    [contacts, siteExtra],
  )

  const siteMilestones = useMemo(
    () =>
      milestones
        .filter((m) => m.site_id === clientSiteId)
        .slice()
        .sort((a, b) => a.sort - b.sort || (a.due_on ?? '9999-99-99').localeCompare(b.due_on ?? '9999-99-99')),
    [milestones, clientSiteId],
  )
  const nextMilestoneId = siteMilestones.find((m) => !m.done_on)?.id ?? null

  const siteSelectionsPending = useMemo(
    () => selections.filter((s) => s.site_id === clientSiteId && s.status === 'pending'),
    [selections, clientSiteId],
  )
  const siteCOsPending = useMemo(
    () => changeOrders.filter((c) => c.site_id === clientSiteId),
    [changeOrders, clientSiteId],
  )
  const needsCount = siteCOsPending.length + siteSelectionsPending.length
  const needsLabel = needsCount === 1 ? '1 thing needs you' : `${needsCount} things need you`

  const siteInvoices = useMemo(() => invoices.filter((v) => v.site_id === clientSiteId), [invoices, clientSiteId])

  const photos = useMemo(() => files.filter((f) => f.kind === 'photo'), [files])
  const docs = useMemo(() => files.filter((f) => f.kind === 'document'), [files])

  const sitePhotosAll = useMemo(() => photos.filter((p) => p.site_id === clientSiteId), [photos, clientSiteId])
  const sitePhotosWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return sitePhotosAll.filter((p) => new Date(p.taken_at ?? p.created_at).getTime() >= weekAgo).slice(0, 4)
  }, [sitePhotosAll])
  const photoLinkLabel =
    sitePhotosAll.length === 1 ? 'All 1 photo' : `All ${sitePhotosAll.length} photos`

  const latestLog = useMemo(
    () => dailyLogs.find((l) => l.site_id === clientSiteId) ?? null,
    [dailyLogs, clientSiteId],
  )

  const subContact = useMemo(
    () => subContacts.find((c) => c.id === subContactId) ?? null,
    [subContacts, subContactId],
  )
  const subDocs = useMemo(
    () => (subContact?.site_id ? docs.filter((d) => d.site_id === subContact.site_id) : []),
    [docs, subContact],
  )

  // ---------------------------------------------------------------- writes

  async function invite() {
    if (!inviteForm) return
    if (!inviteForm.name.trim()) {
      setInviteError('A name is required.')
      return
    }
    if (!inviteForm.siteId) {
      setInviteError('Pick which job site this person can see.')
      return
    }
    const email = inviteForm.email.trim().toLowerCase()
    if (email && contacts.some((c) => c.invite_email?.toLowerCase() === email)) {
      setInviteError('Someone is already invited with that email.')
      return
    }
    setSavingInvite(true)
    setInviteError(null)

    const { error: err } = await supabase()
      .from('portal_contacts')
      .insert({
        company_id: me.company_id,
        site_id: inviteForm.siteId,
        kind: inviteForm.kind,
        name: inviteForm.name.trim(),
        org: inviteForm.org.trim() || null,
        invite_email: email || null,
      })

    setSavingInvite(false)
    if (err) {
      setInviteError(err.message)
      return
    }
    setInviteForm(null)
    await load()
    onChanged()
  }

  async function setContactActive(id: string, active: boolean) {
    setRowBusyId(id)
    const { error: err } = await supabase().from('portal_contacts').update({ active }).eq('id', id)
    setRowBusyId(null)
    if (err) setError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  async function toggleMilestone(m: MilestoneRow) {
    if (!me.is_office) return
    setRowBusyId(m.id)
    const { error: err } = await supabase()
      .from('milestones')
      .update({ done_on: m.done_on ? null : todayStr() })
      .eq('id', m.id)
    setRowBusyId(null)
    if (err) setError(err.message)
    else {
      await load()
      onChanged()
    }
  }

  async function addMilestone() {
    if (!milestoneForm || !clientSiteId) return
    if (!milestoneForm.name.trim()) {
      setMilestoneError('A name is required.')
      return
    }
    setSavingMilestone(true)
    setMilestoneError(null)

    const { error: err } = await supabase()
      .from('milestones')
      .insert({
        company_id: me.company_id,
        site_id: clientSiteId,
        name: milestoneForm.name.trim(),
        due_on: milestoneForm.dueOn || null,
        sort: siteMilestones.length,
      })

    setSavingMilestone(false)
    if (err) {
      setMilestoneError(err.message)
      return
    }
    setMilestoneForm(null)
    await load()
    onChanged()
  }

  async function resolveSelection(sel: SelectionRow) {
    if (!answering || !answering.text.trim()) {
      setAnswerError('Enter what was chosen.')
      return
    }
    setSavingAnswer(true)
    setAnswerError(null)

    const { error: err } = await supabase()
      .from('selections')
      .update({ status: 'chosen', chosen: answering.text.trim(), chosen_at: new Date().toISOString() })
      .eq('id', sel.id)

    setSavingAnswer(false)
    if (err) {
      setAnswerError(err.message)
      return
    }
    setAnswering(null)
    await load()
    onChanged()
  }

  async function addSelection() {
    if (!selectionForm || !clientSiteId) return
    if (!selectionForm.name.trim()) {
      setSelectionError('A name is required.')
      return
    }
    setSavingSelection(true)
    setSelectionError(null)

    const { error: err } = await supabase()
      .from('selections')
      .insert({
        company_id: me.company_id,
        site_id: clientSiteId,
        name: selectionForm.name.trim(),
        detail: selectionForm.detail.trim() || null,
        needed_by: selectionForm.neededBy || null,
        status: 'pending',
      })

    setSavingSelection(false)
    if (err) {
      setSelectionError(err.message)
      return
    }
    setSelectionForm(null)
    await load()
    onChanged()
  }

  // ---------------------------------------------------------------- render

  const pct = clientExtra?.progress_pct ?? 0
  const pctLabel = clientExtra?.progress_pct != null ? `${clientExtra.progress_pct}%` : '—'
  const clientLabel = clientSiteId ? clientLabelFor(clientSiteId) : 'No client named yet'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg, overflow: 'hidden' }}>
      {/* --------------------------------------------------------- toolbar */}
      <div style={toolbarWrap}>
        <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>Portals</span>
        <div style={toolbarDivider} />
        <span style={freeSeatsNote}>
          <CheckIcon size={13} stroke={theme.success} strokeWidth={1.6} />
          Free seats — invite as many clients and subs as you like
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAccess((v) => !v)} style={manageAccessBtn}>
          Manage access
        </button>
        {me.is_office && (
          <button
            onClick={() => {
              setShowAccess(true)
              setInviteForm(blankInvite(clientSiteId || sites[0]?.id || ''))
            }}
            style={inviteToolbarBtn}
          >
            INVITE SOMEONE
          </button>
        )}
      </div>

      {/* ------------------------------------------------------ scrollarea */}
      <div style={scrollArea}>
        {error && <div style={{ marginBottom: 14, fontSize: 12.5, color: theme.alert }}>{error}</div>}

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: theme.inkSoft }}>Loading…</div>
        ) : (
          <>
            {showAccess && (
              <div style={{ ...card, marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Who has portal access</span>
                  <span style={{ fontSize: 12, color: theme.inkSoft }}>{contacts.length}</span>
                </div>

                {inviteForm && (
                  <div style={{ padding: 12, marginBottom: 12, background: theme.appBg, borderRadius: 6 }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <label style={fieldLabel}>
                        Kind
                        <select
                          value={inviteForm.kind}
                          onChange={(e) => setInviteForm({ ...inviteForm, kind: e.target.value as 'client' | 'sub' })}
                          style={{ ...fieldInput, width: 140 }}
                        >
                          <option value="client">Client</option>
                          <option value="sub">Sub / vendor</option>
                        </select>
                      </label>
                      <FieldInput
                        label="Name"
                        value={inviteForm.name}
                        onChange={(v) => setInviteForm({ ...inviteForm, name: v })}
                        placeholder={inviteForm.kind === 'client' ? 'Priya Lindqvist' : 'Danny Whitfield'}
                        width={180}
                      />
                      <FieldInput
                        label={inviteForm.kind === 'client' ? 'Org (optional)' : 'Trade / company'}
                        value={inviteForm.org}
                        onChange={(v) => setInviteForm({ ...inviteForm, org: v })}
                        placeholder={inviteForm.kind === 'client' ? '' : 'Cascade Flashing & Sheet Metal'}
                        width={220}
                      />
                      <FieldInput
                        label="Email to invite"
                        value={inviteForm.email}
                        onChange={(v) => setInviteForm({ ...inviteForm, email: v })}
                        placeholder="name@example.com"
                        width={210}
                      />
                      <label style={fieldLabel}>
                        Job site
                        <select
                          value={inviteForm.siteId}
                          onChange={(e) => setInviteForm({ ...inviteForm, siteId: e.target.value })}
                          style={{ ...fieldInput, width: 190 }}
                        >
                          <option value="">Select…</option>
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <p style={{ fontSize: 11.5, color: theme.inkSoft, lineHeight: 1.5, margin: '10px 0 0' }}>
                      Their portal unlocks the moment they sign in with this email — no invite link to send or
                      expire. The seat itself is free.
                    </p>

                    {inviteError && <div style={{ marginTop: 8, fontSize: 12, color: theme.alert }}>{inviteError}</div>}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button onClick={() => void invite()} disabled={savingInvite} style={cta}>
                        {savingInvite ? 'SENDING…' : 'SEND INVITE'}
                      </button>
                      <button onClick={() => setInviteForm(null)} style={ghost}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Kind', 'Name', 'Org / trade', 'Job site', 'Invite email', 'Status', ''].map((h) => (
                          <th key={h} style={th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedContacts.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                            No one's been invited yet.
                          </td>
                        </tr>
                      )}
                      {sortedContacts.map((c) => {
                        const status = contactStatus(c)
                        return (
                          <tr key={c.id}>
                            <td style={td}>
                              <span style={c.kind === 'client' ? clientBadge : subBadge}>
                                {c.kind === 'client' ? 'CLIENT' : 'SUB'}
                              </span>
                            </td>
                            <td style={{ ...td, fontWeight: 500 }}>{c.name}</td>
                            <td style={{ ...td, color: theme.inkSoft }}>{c.org || '—'}</td>
                            <td style={{ ...td, color: theme.inkSoft }}>
                              {sites.find((s) => s.id === c.site_id)?.name ?? '—'}
                            </td>
                            <td style={{ ...td, color: theme.inkSoft }}>{c.invite_email || '—'}</td>
                            <td style={td}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: status.color }} />
                                {status.label}
                              </span>
                            </td>
                            <td style={{ ...td, textAlign: 'right' }}>
                              {me.is_office && (
                                <button
                                  onClick={() => void setContactActive(c.id, !c.active)}
                                  disabled={rowBusyId === c.id}
                                  style={ghost}
                                >
                                  {rowBusyId === c.id ? '···' : c.active ? 'Remove' : 'Restore'}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={introWrap}>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-.01em' }}>
                What everyone else sees
              </h1>
              <p style={{ margin: 0, maxWidth: 800, fontSize: 13.5, lineHeight: 1.5, color: theme.inkSoft, textWrap: 'pretty' }}>
                Deliberately thin. The client sees progress and their own money; the sub sees only their scope.
                Neither sees your costs, your crew's rates, or another trade's business. These are the seats that
                get your software into a client's hands for free — and put your name in front of them every week.
              </p>
            </div>

            {sites.length === 0 ? (
              <div style={{ ...card, maxWidth: 640 }}>
                <p style={{ margin: 0, fontSize: 13, color: theme.inkSoft, lineHeight: 1.6 }}>
                  Add a job site first — the client and sub portals each preview whatever site you pick.
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {/* -------------------------------------------- client portal */}
                  <div style={{ flex: '1 1 500px', minWidth: 420, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={clientBadge}>CLIENT PORTAL</span>
                      {sites.length > 1 ? (
                        <select value={clientSiteId} onChange={(e) => setClientSiteId(e.target.value)} style={headerPicker}>
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>
                              {clientLabelFor(s.id)} · {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 13, color: theme.inkSoft }}>
                          {clientLabel} · {clientSite?.name ?? '—'}
                        </span>
                      )}
                    </div>

                    <div style={whiteCard}>
                      <div style={cardHeaderBar}>
                        <span style={avatarMark}>{mark}</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{companyName || 'Your company'}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 12, color: '#8B9096' }}>Your project</span>
                      </div>

                      <div style={progressBlock}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                          <span style={{ fontSize: 17, fontWeight: 600 }}>{clientSite?.name ?? 'Untitled site'}</span>
                          <span
                            style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {pctLabel}
                          </span>
                        </div>
                        <span style={barOuter}>
                          <span style={{ ...barInner, width: `${pct}%` }} />
                        </span>
                        <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                          {clientExtra?.schedule_note?.trim() || 'No schedule note added yet.'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderBottom: `1px solid ${theme.border}` }}>
                        <span style={labelPad12}>MILESTONES</span>
                        {siteMilestones.length === 0 && <div style={emptyRow}>No milestones added yet.</div>}
                        {siteMilestones.map((m) => {
                          const done = Boolean(m.done_on)
                          const isNext = !done && m.id === nextMilestoneId
                          const w = !done && isNext ? 600 : 400
                          const fg = done ? theme.inkSoft : isNext ? theme.ink : theme.inkFaint
                          const dateLabel = shortDate(m.done_on ?? m.due_on) ?? 'No date'
                          return (
                            <div
                              key={m.id}
                              onClick={me.is_office ? () => void toggleMilestone(m) : undefined}
                              style={{
                                ...milestoneRowBase,
                                cursor: me.is_office ? 'pointer' : 'default',
                                opacity: rowBusyId === m.id ? 0.55 : 1,
                              }}
                            >
                              {done ? (
                                <CheckIcon size={16} stroke={theme.success} strokeWidth={2.1} />
                              ) : isNext ? (
                                <RingIcon color={theme.accent} />
                              ) : (
                                <RingIcon color={theme.border} />
                              )}
                              <span style={{ flex: 1, fontSize: 13, fontWeight: w, color: fg }}>{m.name}</span>
                              <span style={{ flex: 'none', fontSize: 12.5, color: theme.inkSoft }}>{dateLabel}</span>
                            </div>
                          )
                        })}
                      </div>

                      <div style={photosBlock}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <span style={labelInline}>THIS WEEK ON SITE</span>
                          {sitePhotosAll.length > 0 ? (
                            <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 12 }}>
                              {photoLinkLabel}
                            </a>
                          ) : (
                            <span style={{ fontSize: 12, color: '#8B9096' }}>No photos yet</span>
                          )}
                        </div>
                        {sitePhotosWeek.length > 0 ? (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                            {sitePhotosWeek.map((f) => (
                              <PortalPhotoThumb key={f.id} file={f} />
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: '#8B9096' }}>No photos uploaded this week yet.</span>
                        )}
                        <span style={{ fontSize: 12, color: theme.inkSoft }}>
                          {latestLog
                            ? `${weekdayOf(latestLog.log_date)}'s log: ${
                                truncate(latestLog.work_completed ?? '', 160) || 'Confirmed — no summary written.'
                              }`
                            : 'No confirmed site log yet.'}
                        </span>
                      </div>

                      {needsCount > 0 && (
                        <div style={needsBlock}>
                          <span style={needsHeader}>
                            <span style={needsDot} />
                            {needsLabel}
                          </span>

                          {siteCOsPending.map((co) => (
                            <div key={co.id} style={needsItem}>
                              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>
                                  {co.co_no} · {co.description}
                                </span>
                                <span style={{ fontSize: 11.5, color: theme.inkSoft }}>{coDetail(co)}</span>
                              </span>
                              <button style={reviewBtn}>REVIEW</button>
                            </div>
                          ))}

                          {siteSelectionsPending.map((sel) => (
                            <div key={sel.id} style={needsItem}>
                              {answering?.id === sel.id ? (
                                <>
                                  <input
                                    autoFocus
                                    value={answering.text}
                                    onChange={(e) => setAnswering({ id: sel.id, text: e.target.value })}
                                    placeholder="What was chosen?"
                                    style={answerInput}
                                  />
                                  <button onClick={() => void resolveSelection(sel)} disabled={savingAnswer} style={reviewBtn}>
                                    {savingAnswer ? '···' : 'SAVE'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setAnswering(null)
                                      setAnswerError(null)
                                    }}
                                    style={chooseBtn}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>Selection: {sel.name}</span>
                                    <span style={{ fontSize: 11.5, color: theme.inkSoft }}>{selDetail(sel)}</span>
                                  </span>
                                  <button
                                    onClick={() => setAnswering({ id: sel.id, text: sel.chosen ?? '' })}
                                    disabled={!me.is_office}
                                    style={{ ...chooseBtn, opacity: me.is_office ? 1 : 0.5, cursor: me.is_office ? 'pointer' : 'default' }}
                                  >
                                    Choose
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                          {answerError && <div style={{ fontSize: 11.5, color: theme.alert }}>{answerError}</div>}
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        <span style={labelPad12}>YOUR INVOICES</span>
                        {siteInvoices.length === 0 && <div style={emptyRow}>No invoices yet.</div>}
                        {siteInvoices.map((v) => {
                          const badge = invoiceBadge(v)
                          return (
                            <div key={v.id} style={rowTopBorder11}>
                              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{v.invoice_no}</span>
                                <span style={{ fontSize: 11.5, color: '#8B9096' }}>
                                  {v.period || `Issued ${shortDate(v.issued_on)}`}
                                </span>
                              </span>
                              <span
                                style={{ flex: 'none', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                              >
                                {money(Number(v.amount))}
                              </span>
                              <span
                                style={{
                                  flex: 'none',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '3px 9px',
                                  borderRadius: 11,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  whiteSpace: 'nowrap',
                                  background: badge.bg,
                                  color: badge.fg,
                                }}
                              >
                                {badge.label}
                              </span>
                            </div>
                          )
                        })}
                        <div style={invoiceFooter}>
                          <span style={{ fontSize: 11.5, color: '#8B9096' }}>
                            No costs, no crew rates, no other jobs. Just this project.
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* -------------------------------------------- sub / vendor portal */}
                  <div style={{ flex: '1 1 460px', minWidth: 400, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={subBadge}>SUB / VENDOR PORTAL</span>
                      {subContacts.length > 1 ? (
                        <select value={subContactId} onChange={(e) => setSubContactId(e.target.value)} style={headerPicker}>
                          {subContacts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.org || c.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 13, color: theme.inkSoft }}>
                          {subContact ? subContact.org || subContact.name : 'No subcontractor invited yet'}
                        </span>
                      )}
                    </div>

                    {!subContact ? (
                      <div style={whiteCard}>
                        <div style={{ padding: 20, fontSize: 12.5, color: theme.inkSoft, lineHeight: 1.6 }}>
                          No subcontractor or vendor has been invited yet. Use INVITE SOMEONE above to add one and
                          preview what they'll see.
                        </div>
                      </div>
                    ) : (
                      <div style={whiteCard}>
                        <div style={cardHeaderBar}>
                          <span style={avatarMark}>{mark}</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{companyName || 'Your company'}</span>
                          <span style={{ flex: 1 }} />
                          <span style={{ fontSize: 12, color: '#8B9096' }}>Your work</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderBottom: `1px solid ${theme.border}` }}>
                          <span style={labelPad13}>ASSIGNED TO YOU</span>
                          <div style={emptyRow}>
                            Task-level assignments aren't tracked yet — {subContact.name.split(' ')[0]} can still see
                            the site's plans and PO status below.
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderBottom: `1px solid ${theme.border}` }}>
                          <span style={labelPad13}>WHAT YOU CAN OPEN</span>
                          {subDocs.length === 0 && (
                            <div style={emptyRow}>No plans or documents uploaded for this site yet.</div>
                          )}
                          {subDocs.map((d) => (
                            <div key={d.id} style={rowTopBorder11}>
                              <DocIcon />
                              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                <span
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 500,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {d.name}
                                </span>
                                <span style={{ fontSize: 11.5, color: '#8B9096' }}>{docMeta(d)}</span>
                              </span>
                            </div>
                          ))}
                        </div>

                        <div style={poBlock}>
                          <span style={labelInline}>YOUR PO</span>
                          <span style={{ fontSize: 12.5, color: theme.inkSoft }}>No purchase order on file yet.</span>
                        </div>

                        <div style={lockFooter}>
                          <LockIcon />
                          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: theme.inkSoft }}>
                            No budget, no other trades' scopes, no client contact details, no schedule beyond their
                            own dates. A sub who leaves the job loses access the same day.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {me.is_office && clientSiteId && (
                  <div style={{ ...card, marginTop: 18, maxWidth: 1000 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Update milestones &amp; selections
                      <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: theme.inkSoft }}>
                        {clientSite?.name ?? ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 260px', minWidth: 240 }}>
                        {milestoneForm ? (
                          <>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <FieldInput
                                label="Milestone"
                                value={milestoneForm.name}
                                onChange={(v) => setMilestoneForm({ ...milestoneForm, name: v })}
                                placeholder="Dry-in"
                                width={170}
                              />
                              <FieldInput
                                label="Due"
                                type="date"
                                value={milestoneForm.dueOn}
                                onChange={(v) => setMilestoneForm({ ...milestoneForm, dueOn: v })}
                                width={140}
                              />
                            </div>
                            {milestoneError && (
                              <div style={{ fontSize: 11.5, color: theme.alert, marginTop: 6 }}>{milestoneError}</div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <button onClick={() => void addMilestone()} disabled={savingMilestone} style={cta}>
                                {savingMilestone ? 'ADDING…' : 'ADD MILESTONE'}
                              </button>
                              <button onClick={() => setMilestoneForm(null)} style={ghost}>
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <button onClick={() => setMilestoneForm({ name: '', dueOn: '' })} style={ghost}>
                            + Add a milestone
                          </button>
                        )}
                      </div>

                      <div style={{ flex: '1 1 320px', minWidth: 260 }}>
                        {selectionForm ? (
                          <>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <FieldInput
                                label="Selection"
                                value={selectionForm.name}
                                onChange={(v) => setSelectionForm({ ...selectionForm, name: v })}
                                placeholder="Stair newel profile"
                                width={190}
                              />
                              <FieldInput
                                label="Needed by"
                                type="date"
                                value={selectionForm.neededBy}
                                onChange={(v) => setSelectionForm({ ...selectionForm, neededBy: v })}
                                width={140}
                              />
                            </div>
                            <FieldInput
                              label="Detail (optional)"
                              value={selectionForm.detail}
                              onChange={(v) => setSelectionForm({ ...selectionForm, detail: v })}
                              placeholder="Options and notes for the client"
                              width={350}
                            />
                            {selectionError && (
                              <div style={{ fontSize: 11.5, color: theme.alert, marginTop: 6 }}>{selectionError}</div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <button onClick={() => void addSelection()} disabled={savingSelection} style={cta}>
                                {savingSelection ? 'ADDING…' : 'ADD SELECTION'}
                              </button>
                              <button onClick={() => setSelectionForm(null)} style={ghost}>
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <button onClick={() => setSelectionForm({ name: '', detail: '', neededBy: '' })} style={ghost}>
                            + Add a selection
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// -------------------------------------------------------------------- styles

const toolbarWrap = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 40,
  padding: '0 12px',
  background: theme.panel,
  borderBottom: `1px solid ${theme.border}`,
  overflowX: 'auto',
} as const

const toolbarDivider = { flex: 'none', width: 1, height: 20, background: theme.border, margin: '0 4px' } as const

const freeSeatsNote = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12.5,
  color: theme.inkSoft,
  whiteSpace: 'nowrap',
} as const

const manageAccessBtn = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 27,
  padding: '0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const inviteToolbarBtn = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  height: 29,
  padding: '0 14px',
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: theme.ink,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const scrollArea = { flex: 1, overflow: 'auto', padding: '20px 20px 40px', background: theme.appBg } as const

const introWrap = { maxWidth: 1560, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 } as const

const clientBadge = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  borderRadius: 3,
  background: theme.accentFill,
  color: theme.accent,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
} as const

const subBadge = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  borderRadius: 3,
  background: '#F5F6F7',
  color: '#4A5057',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
} as const

const headerPicker = {
  font: 'inherit',
  fontSize: 13,
  color: theme.inkSoft,
  border: 'none',
  background: 'transparent',
  padding: 0,
  cursor: 'pointer',
} as const

const whiteCard = { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' } as const

const cardHeaderBar = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '11px 14px',
  borderBottom: `1px solid ${theme.border}`,
  background: '#FAFBFC',
} as const

const avatarMark = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: theme.rail,
  color: '#fff',
  fontSize: 8,
  fontWeight: 700,
} as const

const progressBlock = {
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  padding: '16px 15px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const barOuter = { display: 'block', height: 8, borderRadius: 4, background: '#EDEFF1', overflow: 'hidden' } as const
const barInner = { display: 'block', height: 8, borderRadius: 4, background: theme.success } as const

const labelPad12 = {
  padding: '12px 15px 8px',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.06em',
  color: '#8B9096',
} as const

const labelPad13 = { ...labelPad12, padding: '13px 15px 8px' } as const

const labelInline = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: '#8B9096' } as const

const milestoneRowBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  padding: '9px 15px',
  borderTop: '1px solid #F1F3F5',
} as const

const rowTopBorder11 = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  padding: '10px 15px',
  borderTop: '1px solid #F1F3F5',
} as const

const emptyRow = { padding: '11px 15px', fontSize: 12.5, color: theme.inkSoft, lineHeight: 1.5 } as const

const photosBlock = {
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  padding: '13px 15px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const needsBlock = {
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  padding: '13px 15px',
  background: '#FFF9E8',
  borderBottom: '1px solid #F0DCA8',
} as const

const needsHeader = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#8A6100' } as const
const needsDot = { width: 7, height: 7, borderRadius: '50%', background: theme.warning } as const

const needsItem = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 11px',
  background: theme.panel,
  border: '1px solid #F0DCA8',
  borderRadius: 4,
} as const

const reviewBtn = {
  flex: 'none',
  height: 28,
  padding: '0 11px',
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const chooseBtn = {
  flex: 'none',
  height: 28,
  padding: '0 11px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const answerInput = {
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: '0 8px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  font: 'inherit',
  fontSize: 12.5,
} as const

const invoiceFooter = { padding: '11px 15px', background: '#FAFBFC', borderTop: '1px solid #F1F3F5' } as const

const poBlock = {
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  padding: '13px 15px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const lockFooter = { display: 'flex', gap: 10, padding: '12px 15px', background: '#F5F6F7' } as const

const card = { padding: 14, background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8 } as const

const th = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  background: theme.appBg,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: theme.inkFaint,
  textAlign: 'left',
} as const

const td = { padding: '8px 12px', borderBottom: `1px solid ${theme.border}`, fontSize: 13 } as const

const ghost = {
  padding: '4px 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
} as const

const cta = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
} as const

const fieldLabel = {
  display: 'block',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: theme.inkFaint,
} as const

const fieldInput = {
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
