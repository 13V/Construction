import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type SiteFileRow, type WorkerRow } from '../data/supabase'
import { BUCKET_FILES, signedUrl } from '../data/storage'
import { distanceM } from '../geofence/geo'
import { clockTime, dayDate } from '../format'
import { theme } from '../theme'

/**
 * The job's photos, on the phone — Crewline Mobile, screen 4.
 *
 * Until now the phone could only ever `insert` into site_files. A worker took
 * a photo, it went up, and they never saw it again. A one-way pipe teaches
 * people to stop feeding it, which is how a site photo log dies.
 *
 * Everything on a tile is already on the row: who took it, when the shutter
 * went, and where the phone was standing. The one value the design flagged as
 * unbacked was the "On site" badge — both the photo's lat/lng and the site's
 * fence exist, but nothing compared them. `onSite()` below is that comparison.
 */

type Filter = 'all' | 'mine' | 'issue' | 'progress'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'issue', label: 'Issues' },
  { key: 'progress', label: 'Progress' },
]

const CATEGORY_LABEL: Record<string, string> = {
  progress: 'Progress',
  issue: 'Issue',
  before: 'Before',
  after: 'After',
  inspection: 'Inspection',
}

interface Site {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
}

/**
 * Was the phone inside the fence when the shutter went?
 *
 * The design called this out as the one figure on the screen with no source:
 * the photo carries a lat/lng and the site carries a centre and a radius, but
 * nothing had ever compared the two. Null — rather than false — when the photo
 * has no coordinates, because "we don't know" and "they weren't there" are very
 * different claims to put next to somebody's name.
 */
function onSite(file: SiteFileRow, site: Site | undefined): boolean | null {
  if (!site || file.lat === null || file.lng === null) return null
  return distanceM({ lat: Number(file.lat), lng: Number(file.lng) }, { lat: site.lat, lng: site.lng }) <= site.radiusM
}

export function PhotosTab({
  me,
  sites: fromTracker,
  activeSiteId,
  onTakePhoto,
}: {
  me: WorkerRow
  /** Whatever /api/ping last reported. Empty until the worker starts tracking. */
  sites: Site[]
  activeSiteId: string | null
  onTakePhoto: () => void
}) {
  /**
   * The tracker only learns the site list by pinging, so it is empty until the
   * worker taps Start tracking. Photos is a tab, not a consequence of being on
   * the clock — a chippie checking last Tuesday's photos on the couch should
   * not have to switch their GPS on first. So the tab reads job_sites itself
   * and only falls back to the tracker's copy.
   */
  const [ownSites, setOwnSites] = useState<Site[]>([])
  useEffect(() => {
    void (async () => {
      const { data } = await supabase().from('job_sites').select('id,name,lat,lng,radius_m').order('name')
      setOwnSites(
        ((data ?? []) as Array<{ id: string; name: string; lat: number; lng: number; radius_m: number }>).map((s) => ({
          id: s.id,
          name: s.name,
          lat: Number(s.lat),
          lng: Number(s.lng),
          radiusM: Number(s.radius_m),
        })),
      )
    })()
  }, [])

  const sites = ownSites.length > 0 ? ownSites : fromTracker
  const [siteId, setSiteId] = useState<string | null>(activeSiteId ?? null)
  const [files, setFiles] = useState<SiteFileRow[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!siteId && sites.length > 0) setSiteId(activeSiteId ?? sites[0]!.id)
  }, [sites, activeSiteId, siteId])

  const site = useMemo(() => sites.find((s) => s.id === siteId), [sites, siteId])

  const load = useCallback(async () => {
    if (!siteId) {
      setFiles([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: err } = await supabase()
      .from('site_files')
      .select('*')
      .eq('site_id', siteId)
      .eq('kind', 'photo')
      .order('taken_at', { ascending: false, nullsFirst: false })
      .limit(300)
    if (err) setError(err.message)
    else setError(null)
    setFiles((data ?? []) as SiteFileRow[])
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  // Signed URLs are minted per photo and only for what is on screen. The
  // bucket is private, so there is no shortcut here.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const need = files.filter((f) => !urls[f.id]).slice(0, 60)
      if (need.length === 0) return
      const pairs = await Promise.all(
        need.map(async (f) => [f.id, await signedUrl(BUCKET_FILES, f.storage_path, 3600)] as const),
      )
      if (cancelled) return
      setUrls((prev) => {
        const next = { ...prev }
        for (const [id, url] of pairs) if (url) next[id] = url
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [files, urls])

  const counts = useMemo(
    () => ({
      all: files.length,
      mine: files.filter((f) => f.uploaded_by === me.id).length,
      issue: files.filter((f) => f.category === 'issue').length,
      progress: files.filter((f) => f.category === 'progress').length,
    }),
    [files, me.id],
  )

  const visible = useMemo(() => {
    if (filter === 'all') return files
    if (filter === 'mine') return files.filter((f) => f.uploaded_by === me.id)
    return files.filter((f) => f.category === filter)
  }, [files, filter, me.id])

  /** Newest day first, which is the order a worker scans in. */
  const days = useMemo(() => {
    const map = new Map<string, SiteFileRow[]>()
    for (const f of visible) {
      const key = (f.taken_at ?? f.created_at ?? '').slice(0, 10)
      const list = map.get(key)
      if (list) list.push(f)
      else map.set(key, [f])
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [visible])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.panel }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '4px 18px 12px' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>Photos</span>
          <span style={{ fontSize: 12, color: theme.inkFaint }}>
            {site ? `${site.name} · ${files.length} ${files.length === 1 ? 'photo' : 'photos'}` : 'No job site yet'}
          </span>
        </span>
        {sites.length > 1 && (
          <select
            value={siteId ?? ''}
            onChange={(e) => {
              setSiteId(e.target.value)
              setOpenIndex(null)
            }}
            style={{
              flex: 'none',
              height: 34,
              maxWidth: 150,
              padding: '0 8px',
              border: `1px solid ${theme.border}`,
              borderRadius: 3,
              background: theme.panel,
              font: 'inherit',
              fontSize: 12.5,
              color: theme.ink,
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div style={{ flex: 'none', display: 'flex', gap: 8, padding: '0 18px 12px', overflowX: 'auto' }}>
        {FILTERS.map((f) => {
          const on = filter === f.key
          const n = counts[f.key]
          return (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key)
                setOpenIndex(null)
              }}
              style={{
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                // 44px, per the brief. The existing screens use 34–38px chips;
                // these are genuinely tappable with a glove on.
                height: 44,
                padding: '0 16px',
                borderRadius: 22,
                border: `1px solid ${on ? theme.ink : theme.border}`,
                background: on ? theme.ink : theme.panel,
                color: on ? '#fff' : theme.ink,
                font: 'inherit',
                fontSize: 13.5,
                fontWeight: on ? 700 : 500,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {f.key === 'issue' && n > 0 && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#fff' : theme.alert }} />
              )}
              {f.label}
              {f.key !== 'all' && n > 0 && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</span>}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {error && (
          <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 6, background: theme.alertFill, color: theme.alertInk, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div style={{ padding: '48px 32px', textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              {files.length === 0 ? 'No photos on this job yet' : 'Nothing matches that filter'}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: theme.inkSoft }}>
              {files.length === 0
                ? 'Photos you take here carry their own time and place, so the office can see what you saw.'
                : 'Try All.'}
            </span>
          </div>
        )}

        {days.map(([day, list]) => (
          <div key={day}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px 8px' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{dayHeading(day)}</span>
              <span style={{ fontSize: 12, color: theme.inkFaint, whiteSpace: 'nowrap' }}>
                {list.length} {list.length === 1 ? 'photo' : 'photos'}
              </span>
              <span style={{ flex: 1, height: 1, background: theme.borderSoft }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: '0 2px 10px' }}>
              {list.map((f) => {
                const idx = visible.indexOf(f)
                const url = urls[f.id]
                return (
                  <button
                    key={f.id}
                    onClick={() => setOpenIndex(idx)}
                    style={{
                      position: 'relative',
                      aspectRatio: '1 / 1',
                      border: 'none',
                      padding: 0,
                      background: url ? `center/cover no-repeat url("${url}")` : theme.fill,
                      cursor: 'pointer',
                    }}
                  >
                    {f.uploaded_by === me.id && (
                      <span style={tileTag(6, 'left')}>YOU</span>
                    )}
                    {f.category === 'issue' && (
                      <span
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          width: 9,
                          height: 9,
                          borderRadius: '50%',
                          background: theme.alert,
                          boxShadow: '0 0 0 2px rgba(255,255,255,.85)',
                        }}
                      />
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        right: 5,
                        bottom: 4,
                        fontSize: 10,
                        color: '#fff',
                        textShadow: '0 1px 3px rgba(0,0,0,.75)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {f.taken_at ? clockTime(f.taken_at) : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 'none', padding: '10px 18px 12px', borderTop: `1px solid ${theme.border}` }}>
        <button
          onClick={onTakePhoto}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            height: 52,
            border: 'none',
            borderRadius: 6,
            background: theme.ink,
            color: '#fff',
            font: 'inherit',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '.03em',
            cursor: 'pointer',
          }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8}>
            <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
            <circle cx="12" cy="12.5" r="3.4" />
          </svg>
          TAKE PHOTO
        </button>
      </div>

      {openIndex !== null && visible[openIndex] && (
        <Viewer
          files={visible}
          index={openIndex}
          urls={urls}
          site={site}
          meId={me.id}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}

const tileTag = (offset: number, side: 'left' | 'right') =>
  ({
    position: 'absolute',
    top: offset,
    [side]: offset,
    padding: '2px 5px',
    borderRadius: 3,
    background: 'rgba(26,29,33,.72)',
    color: '#fff',
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '.04em',
  }) as const

function dayHeading(iso: string): string {
  if (!iso) return 'Undated'
  const today = new Date().toISOString().slice(0, 10)
  const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (iso === today) return 'Today'
  if (iso === yest) return 'Yesterday'
  return dayDate(iso)
}

/**
 * Full-screen viewer. Dark, because a photo of a wet sill plate should be the
 * only thing on the screen when someone is deciding whether to stop work.
 */
function Viewer({
  files,
  index,
  urls,
  site,
  meId,
  onIndex,
  onClose,
  onChanged,
}: {
  files: SiteFileRow[]
  index: number
  urls: Record<string, string>
  site: Site | undefined
  meId: string
  onIndex: (n: number) => void
  onClose: () => void
  onChanged: () => void
}) {
  const file = files[index]!
  const url = urls[file.id]
  const here = onSite(file, site)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, files.length, onIndex, onClose])

  /** Flagging is a category change, which is what the office filters on. */
  const flag = async () => {
    if (busy || file.category === 'issue') return
    setBusy(true)
    await supabase().from('site_files').update({ category: 'issue' }).eq('id', file.id)
    setBusy(false)
    onChanged()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#0E1012', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
        <button onClick={onClose} style={round}>
          ✕
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
          {index + 1} of {files.length}
        </span>
        <span style={{ width: 38 }} />
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
        {url ? (
          <img src={url} alt={file.caption ?? file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ color: '#6C7278', fontSize: 13 }}>Loading…</span>
        )}
        {index > 0 && (
          <button onClick={() => onIndex(index - 1)} style={{ ...round, position: 'absolute', left: 12 }}>
            ‹
          </button>
        )}
        {index < files.length - 1 && (
          <button onClick={() => onIndex(index + 1)} style={{ ...round, position: 'absolute', right: 12 }}>
            ›
          </button>
        )}
      </div>

      <div style={{ flex: 'none', padding: '14px 18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {file.caption && (
          <span style={{ fontSize: 15, lineHeight: 1.45, color: '#fff' }}>{file.caption}</span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: theme.railSoft,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10.5,
              fontWeight: 700,
            }}
          >
            {file.uploaded_by === meId ? 'YOU' : ''}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
              {file.uploaded_by === meId ? 'You' : 'Crew'}
            </span>
            <span style={{ fontSize: 12, color: '#8E959C' }}>
              {file.taken_at ? `${dayHeading((file.taken_at ?? '').slice(0, 10))}, ${clockTime(file.taken_at)}` : '—'}
            </span>
          </span>
        </span>

        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Null means the photo carried no coordinates — which is not the
              same claim as "they weren't there", so it says so. */}
          <span style={{ ...darkChip, background: here === true ? '#17492A' : '#2A2E33', color: here === true ? '#7EE29B' : '#B7BCC2' }}>
            {here === true ? '⚲ On site' : here === false ? '⚲ Away from site' : '⚲ No location'}
          </span>
          {file.category && <span style={darkChip}>{CATEGORY_LABEL[file.category] ?? file.category}</span>}
        </span>

        {file.category !== 'issue' && (
          <button onClick={() => void flag()} disabled={busy} style={darkButton}>
            {busy ? 'Flagging…' : 'Flag as an issue'}
          </button>
        )}
      </div>
    </div>
  )
}

const round = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 38,
  height: 38,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(255,255,255,.14)',
  color: '#fff',
  font: 'inherit',
  fontSize: 17,
  cursor: 'pointer',
} as const

const darkChip = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '7px 12px',
  borderRadius: 15,
  background: '#2A2E33',
  color: '#B7BCC2',
  fontSize: 12.5,
  fontWeight: 600,
} as const

const darkButton = {
  height: 46,
  border: '1px solid #3A4046',
  borderRadius: 6,
  background: 'transparent',
  color: '#fff',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
} as const
