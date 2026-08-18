import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type SiteFileRow, type WorkerRow } from '../data/supabase'
import { BUCKET_FILES, signedUrl } from '../data/storage'
import { useSites } from './useSites'
import { fullDate } from '../format'
import { theme } from '../theme'

/**
 * The drawing, on a phone — Crewline Mobile, screen 5.
 *
 * A superseded sheet is the most expensive thing on a site, so the revision is
 * the loudest element in the list and an old sheet is red before it is opened.
 *
 * Pins are the other half: a pin is how "the water is coming in over there"
 * becomes a coordinate the flashing sub can find without a second site visit.
 * x and y are fractions of the sheet, so a pin stays put at any zoom or render
 * size — which is why they are stored that way rather than in pixels.
 */

interface Pin {
  id: string
  file_id: string
  x: number
  y: number
  kind: 'issue' | 'note' | 'photo'
  label: string
  photo_id: string | null
  created_by: string | null
  created_at: string
  resolved_at: string | null
}

/**
 * What level a sheet belongs to, read off its own name.
 *
 * "I do a 10 storey apartment building, that's 3 drawings per level" — thirty
 * sheets in one flat list is not a register, it is a scroll. Nobody is going
 * to retype thirty levels into a form either, so the level comes from how the
 * office already names the file: L03, Level 3, LVL3, Floor 3, GF, Basement 1.
 *
 * A sheet whose name says nothing falls into "Other sheets" rather than being
 * guessed at — a drawing filed under the wrong level is worse than one filed
 * under none.
 */
export function levelOf(name: string): { label: string; sort: number } | null {
  const n = name.replace(/\.[a-z0-9]+$/i, '')
  const basement = n.match(/\b(?:basement|bsmt|b)\s*[-_ ]?(\d{1,2})\b/i)
  if (basement) return { label: `Basement ${Number(basement[1])}`, sort: -100 + Number(basement[1]) }
  if (/\b(?:ground floor|ground|gf)\b/i.test(n)) return { label: 'Ground floor', sort: 0 }
  const level = n.match(/\b(?:level|lvl|floor|fl|l)\s*[-_ ]?(\d{1,2})\b/i)
  if (level) return { label: `Level ${Number(level[1])}`, sort: Number(level[1]) }
  return null
}

const PIN_COLOUR: Record<Pin['kind'], string> = {
  issue: theme.alert,
  note: theme.accent,
  photo: theme.rail,
}

const PIN_KINDS: Array<{ kind: Pin['kind']; label: string }> = [
  { kind: 'issue', label: 'Issue' },
  { kind: 'note', label: 'Note' },
  { kind: 'photo', label: 'Photo' },
]

export function PlansScreen({
  me,
  siteId: standingIn,
  siteName: standingName,
  embedded = false,
  onClose,
}: {
  me: WorkerRow
  /** The fence the worker is inside right now, if any. */
  siteId: string | null
  siteName: string
  /**
   * Inside the Scope tab the drawings are the first block of a longer page,
   * so the screen drops its own header and its own scroller and renders as
   * plain content in whatever is scrolling above it.
   */
  embedded?: boolean
  onClose: () => void
}) {
  // Reading the drawing is something you do before you get there, not only
  // once the tracker has placed you inside the fence.
  const all = useSites()
  const siteId = standingIn ?? (all.length === 1 ? all[0]!.id : null)
  const siteName = standingIn ? standingName : (all.find((s) => s.id === siteId)?.name ?? standingName)
  const [sheets, setSheets] = useState<SiteFileRow[]>([])
  const [pins, setPins] = useState<Pin[]>([])
  const [open, setOpen] = useState<SiteFileRow | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!siteId) {
      setLoading(false)
      return
    }
    setLoading(true)
    const client = supabase()
    const [f, p] = await Promise.all([
      // Drawings only. A scope line's data sheet and a waterproofing product
      // sheet are both kind='document' on the same job, and without this they
      // turned up in the drawing register as sheets to build from.
      client
        .from('site_files')
        .select('*')
        .eq('site_id', siteId)
        .eq('kind', 'document')
        .is('selection_id', null)
        .is('waterproofing_package_id', null)
        .order('name'),
      client.from('plan_pins').select('*').eq('site_id', siteId),
    ])
    if (f.error) setError(f.error.message)
    setSheets((f.data ?? []) as SiteFileRow[])
    setPins((p.data ?? []) as Pin[])
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * A sheet is superseded when another sheet names it in `supersedes`. That is
   * the only honest test — a version string alone cannot tell you whether
   * something newer exists.
   */
  const supersededIds = useMemo(() => new Set(sheets.map((s) => s.supersedes).filter(Boolean) as string[]), [sheets])
  const q = query.trim().toLowerCase()
  const shown = q ? sheets.filter((x) => x.name.toLowerCase().includes(q)) : sheets
  const current = shown.filter((x) => !supersededIds.has(x.id))
  const old = shown.filter((x) => supersededIds.has(x.id))
  const pinsFor = (id: string) => pins.filter((p) => p.file_id === id && !p.resolved_at)

  /**
   * Levels, once there are enough sheets for a flat list to stop working.
   * Below that the grouping is noise — six sheets read fine as six sheets.
   */
  const levels = useMemo(() => {
    if (current.length < 9) return null
    const groups = new Map<string, { sort: number; sheets: SiteFileRow[] }>()
    for (const sheet of current) {
      const lv = levelOf(sheet.name)
      const label = lv?.label ?? 'Other sheets'
      const sort = lv?.sort ?? 1000
      const g = groups.get(label) ?? { sort, sheets: [] }
      g.sheets.push(sheet)
      groups.set(label, g)
    }
    // One group is not a grouping.
    if (groups.size < 2) return null
    return [...groups.entries()].sort((a, b) => a[1].sort - b[1].sort)
  }, [current])

  return (
    <div
      style={
        embedded
          ? { display: 'block' }
          : { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.appBg }
      }
    >
      {!embedded && (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: theme.panel, borderBottom: `1px solid ${theme.border}` }}>
          <button onClick={onClose} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 15, color: theme.accent, cursor: 'pointer' }}>
            ‹ Back
          </button>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 15.5, fontWeight: 600 }}>Plans</span>
            <span style={{ fontSize: 11.5, color: theme.inkFaint }}>
              {siteName} · {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}
            </span>
          </span>
          <span style={{ width: 48 }} />
        </div>
      )}

      <div style={embedded ? { display: 'block' } : { flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 24 }}>
        {error && (
          <div style={{ padding: '11px 18px', background: theme.alertFill, color: theme.alertInk, fontSize: 13 }}>{error}</div>
        )}

        {!loading && sheets.length === 0 && (
          <div style={{ padding: embedded ? '16px 18px 4px' : '48px 32px', textAlign: embedded ? 'left' : 'center' }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No drawings yet</span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: theme.inkSoft }}>
              The office uploads sheets to the job. They appear here as soon as they do.
            </span>
          </div>
        )}

        {old.length > 0 && (
          <div style={{ padding: '12px 18px 0', fontSize: 13, lineHeight: 1.5, color: theme.inkSoft }}>
            Anything red below is superseded. Do not build from it.
          </div>
        )}

        {sheets.length >= 9 && (
          <div style={{ padding: '12px 14px 0' }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${sheets.length} sheets`}
              style={{
                width: '100%',
                height: 44,
                padding: '0 13px',
                boxSizing: 'border-box',
                background: theme.panel,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                font: 'inherit',
                fontSize: 16,
                color: theme.ink,
                outline: 'none',
              }}
            />
          </div>
        )}

        {q && shown.length === 0 && (
          <div style={{ padding: '18px', fontSize: 13.5, color: theme.inkSoft }}>Nothing matches “{query}”.</div>
        )}

        {levels ? (
          levels.map(([label, g]) => (
            <div key={label}>
              <SectionLabel>{label.toUpperCase()} · {g.sheets.length}</SectionLabel>
              <SheetList sheets={g.sheets} pinsFor={pinsFor} onOpen={setOpen} superseded={false} />
            </div>
          ))
        ) : (
          <>
            {current.length > 0 && <SectionLabel>CURRENT</SectionLabel>}
            <SheetList sheets={current} pinsFor={pinsFor} onOpen={setOpen} superseded={false} />
          </>
        )}

        {old.length > 0 && <SectionLabel tone="alert">SUPERSEDED — DO NOT BUILD FROM</SectionLabel>}
        <SheetList sheets={old} pinsFor={pinsFor} onOpen={setOpen} superseded />

        {sheets.length > 0 && (
          <span style={{ display: 'block', padding: '14px 18px 0', fontSize: 12, lineHeight: 1.5, color: theme.inkFaint }}>
            A sheet stays on the phone once opened, so the drawing still works in a slab-side dead spot.
          </span>
        )}
      </div>

      {open && (
        <SheetViewer
          me={me}
          sheet={open}
          siteId={siteId}
          superseded={supersededIds.has(open.id)}
          pins={pins.filter((p) => p.file_id === open.id)}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}

function SectionLabel({ children, tone }: { children: React.ReactNode; tone?: 'alert' }) {
  return (
    <div style={{ padding: '16px 18px 8px' }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: tone === 'alert' ? theme.alertInk : theme.inkFaint }}>
        {children}
      </span>
    </div>
  )
}

function SheetList({
  sheets,
  pinsFor,
  onOpen,
  superseded,
}: {
  sheets: SiteFileRow[]
  pinsFor: (id: string) => Pin[]
  onOpen: (s: SiteFileRow) => void
  superseded: boolean
}) {
  if (sheets.length === 0) return null
  return (
    <div style={{ margin: '0 14px', borderRadius: 10, overflow: 'hidden', border: `1px solid ${superseded ? theme.alertFill : theme.border}`, background: theme.panel }}>
      {sheets.map((s, i) => {
        const n = pinsFor(s.id).length
        return (
          <button
            key={s.id}
            onClick={() => onOpen(s)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              minHeight: 64,
              padding: '12px 15px',
              borderTop: i === 0 ? 'none' : `1px solid ${theme.borderSoft}`,
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: 'none',
              background: theme.panel,
              font: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={superseded ? theme.alert : theme.inkFaint} strokeWidth={1.6} style={{ flex: 'none' }}>
              <path d="M6 3h8l4 4v14H6z" />
              <path d="M14 3v4h4" />
            </svg>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </span>
              <span style={{ fontSize: 12, color: superseded ? theme.alertInk : theme.inkFaint }}>
                {superseded
                  ? `Superseded — do not use`
                  : `${s.created_at ? `Issued ${fullDate(s.created_at)}` : ''}${n > 0 ? ` · ${n} ${n === 1 ? 'pin' : 'pins'}` : ''}`}
              </span>
            </span>
            <span
              style={{
                flex: 'none',
                padding: '4px 9px',
                borderRadius: 4,
                background: superseded ? theme.alertFill : theme.successFill,
                color: superseded ? theme.alertInk : theme.successInk,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '.04em',
                whiteSpace: 'nowrap',
              }}
            >
              {superseded ? 'SUPERSEDED' : s.version ? `REV ${s.version.toUpperCase()}` : 'CURRENT'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The sheet itself, with its pins. Dropping one is a mode rather than a tap,
 * because a stray tap on a drawing you are trying to read should not leave a
 * mark on it for everyone else.
 */
function SheetViewer({
  me,
  sheet,
  siteId,
  superseded,
  pins,
  onClose,
  onChanged,
}: {
  me: WorkerRow
  sheet: SiteFileRow
  siteId: string | null
  superseded: boolean
  pins: Pin[]
  onClose: () => void
  onChanged: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [openPin, setOpenPin] = useState<Pin | null>(null)
  const [dropping, setDropping] = useState(false)
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null)
  const [kind, setKind] = useState<Pin['kind']>('issue')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const surface = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void (async () => setUrl(await signedUrl(BUCKET_FILES, sheet.storage_path, 3600)))()
  }, [sheet.storage_path])

  const place = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dropping) return
    const r = e.currentTarget.getBoundingClientRect()
    setDraft({
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    })
  }

  const save = async () => {
    if (!draft || !label.trim() || busy || !siteId) return
    setBusy(true)
    const { error } = await supabase().from('plan_pins').insert({
      company_id: me.company_id,
      site_id: siteId,
      file_id: sheet.id,
      // Fractions of the sheet, so zoom cannot move it.
      x: draft.x.toFixed(5),
      y: draft.y.toFixed(5),
      kind,
      label: label.trim(),
      created_by: me.id,
    })
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    setDropping(false)
    setDraft(null)
    setLabel('')
    onChanged()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 58, background: '#14171A', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
        <button onClick={dropping ? () => { setDropping(false); setDraft(null) } : onClose} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 15, color: '#6BB2FF', cursor: 'pointer' }}>
          {dropping ? 'Cancel' : '‹ Sheets'}
        </button>
        <span style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: '#fff' }}>{dropping ? 'Drop a pin' : sheet.name}</span>
          <span style={{ fontSize: 11, color: '#8E959C' }}>
            {dropping ? 'Tap the sheet where it is' : `${pins.filter((p) => !p.resolved_at).length} pins`}
          </span>
        </span>
        <span
          style={{
            flex: 'none',
            padding: '4px 9px',
            borderRadius: 4,
            background: superseded ? theme.alert : '#2A2E33',
            color: '#fff',
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          {superseded ? 'SUPERSEDED' : sheet.version ? `REV ${sheet.version.toUpperCase()}` : 'CURRENT'}
        </span>
      </div>

      {superseded && (
        <div style={{ padding: '9px 16px', background: theme.alert, color: '#fff', fontSize: 12.5, fontWeight: 600, textAlign: 'center' }}>
          This sheet has been superseded. Do not build from it.
        </div>
      )}

      <div
        ref={surface}
        onClick={place}
        style={{
          flex: 1,
          position: 'relative',
          minHeight: 0,
          overflow: 'auto',
          cursor: dropping ? 'crosshair' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {url ? (
          <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%' }}>
            <img src={url} alt={sheet.name} style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            {pins.map((p, i) => (
              <button
                key={p.id}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!dropping) setOpenPin(p)
                }}
                style={{
                  position: 'absolute',
                  left: `${Number(p.x) * 100}%`,
                  top: `${Number(p.y) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: '2px solid #fff',
                  background: p.resolved_at ? theme.inkFaint : PIN_COLOUR[p.kind],
                  color: '#fff',
                  font: 'inherit',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 1px 5px rgba(0,0,0,.4)',
                }}
              >
                {i + 1}
              </button>
            ))}
            {draft && (
              <span
                style={{
                  position: 'absolute',
                  left: `${draft.x * 100}%`,
                  top: `${draft.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: '2px dashed #fff',
                  background: PIN_COLOUR[kind],
                  opacity: 0.85,
                }}
              />
            )}
          </div>
        ) : (
          <span style={{ color: '#6C7278', fontSize: 13 }}>Loading sheet…</span>
        )}
      </div>

      {dropping ? (
        <div style={{ flex: 'none', padding: '14px 16px 18px', background: theme.panel, borderTop: `1px solid ${theme.border}` }}>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint, marginBottom: 8 }}>
            WHAT KIND OF PIN
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            {PIN_KINDS.map((k) => {
              const on = kind === k.kind
              return (
                <button
                  key={k.kind}
                  onClick={() => setKind(k.kind)}
                  style={{
                    minHeight: 44,
                    border: `1px solid ${on ? PIN_COLOUR[k.kind] : theme.border}`,
                    borderRadius: 8,
                    background: on ? theme.accentFill : theme.panel,
                    font: 'inherit',
                    fontSize: 13.5,
                    fontWeight: on ? 700 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {k.label}
                </button>
              )
            })}
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is here? e.g. water at the head of W-04"
            style={{ width: '100%', height: 48, padding: '0 12px', border: `1px solid ${theme.border}`, borderRadius: 8, font: 'inherit', fontSize: 14, marginBottom: 10 }}
          />
          {err && <span style={{ display: 'block', marginBottom: 8, fontSize: 12.5, color: theme.alertInk }}>{err}</span>}
          <button
            onClick={() => void save()}
            disabled={!draft || !label.trim() || busy}
            style={{
              width: '100%',
              height: 52,
              border: 'none',
              borderRadius: 6,
              background: draft && label.trim() ? theme.ink : theme.fill,
              color: draft && label.trim() ? '#fff' : theme.inkGhost,
              font: 'inherit',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '.03em',
              cursor: 'pointer',
            }}
          >
            {busy ? 'SAVING…' : draft ? `DROP PIN ON ${sheet.name.toUpperCase()}` : 'TAP THE SHEET FIRST'}
          </button>
          <span style={{ display: 'block', marginTop: 8, textAlign: 'center', fontSize: 12, color: theme.inkFaint }}>
            Saved as a fraction of the sheet, so it stays put at any zoom.
          </span>
        </div>
      ) : (
        <div style={{ flex: 'none', padding: '12px 16px 18px' }}>
          <button
            onClick={() => setDropping(true)}
            style={{
              width: '100%',
              height: 52,
              border: '1px solid #3A4046',
              borderRadius: 6,
              background: 'transparent',
              color: '#fff',
              font: 'inherit',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '.03em',
              cursor: 'pointer',
            }}
          >
            DROP A PIN
          </button>
        </div>
      )}

      {openPin && (
        <div
          onClick={() => setOpenPin(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 59, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: theme.panel, borderRadius: '14px 14px 0 0', padding: '18px 18px 26px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: PIN_COLOUR[openPin.kind] }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint }}>
                {openPin.kind.toUpperCase()}
              </span>
              {openPin.resolved_at && (
                <span style={{ padding: '3px 8px', borderRadius: 11, background: theme.successFill, color: theme.successInk, fontSize: 10.5, fontWeight: 700 }}>
                  DONE
                </span>
              )}
            </span>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}>{openPin.label}</span>
            <span style={{ display: 'block', fontSize: 12.5, color: theme.inkFaint, marginBottom: 16 }}>
              Dropped {fullDate(openPin.created_at)}
            </span>
            {!openPin.resolved_at && (
              <button
                onClick={async () => {
                  const { data, error } = await supabase()
                    .from('plan_pins')
                    .update({ resolved_at: new Date().toISOString(), resolved_by: me.id })
                    .eq('id', openPin.id)
                    .select('id')
                  // A zero-row UPDATE answers with success, so the row itself
                  // is the only proof the pin actually closed.
                  if (error || !data || data.length === 0) {
                    setErr(error?.message ?? 'That did not save. Tell the office.')
                    return
                  }
                  setOpenPin(null)
                  onChanged()
                }}
                style={{ width: '100%', height: 48, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.panel, font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Mark this done
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
