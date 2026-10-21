/**
 * The job's photos as tiles, a day at a time, newest first: what the phone's
 * Photos tab shows, at desk size. Each tile says who took it, when, and the
 * phone's on-site mark, and opens the viewer.
 *
 * A tile asks for its picture only when it comes near the screen: the bucket
 * is private, so each picture needs a signed URL, and a job with hundreds of
 * photos should not sign and download them all to show the first row. The
 * URL comes from the phone's own signedUrl, which keeps it for the hour, so
 * the viewer opens the same picture the tile already has.
 */
import { useState, type CSSProperties } from 'react'
import { dayHeading, groupByDay, markWords, onSite, takenOf, timeOf, whoOf, type Photo } from '../../data/photos'
import type { JobSiteRow } from '../../phone'
import { color, radius, space, text } from '../../tokens'
import { useNear, useSignedUrl, useWidth } from './hooks'

/** The phone's placeholder shades (Job.tsx PhotoGrid), cycled until a picture arrives, so the grid never flashes white. */
const SHADES = ['#C9CFD5', '#BFC6CD', '#D2D7DC', '#C3CAD1', '#CDD3D9', '#B9C1C9']

/** Tiles are at least this wide; a window too narrow for two still gets two. */
const MIN_TILE = 176
const GAP = 12

const oneLine: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/** The phone's camera, for a tile still waiting for its picture. */
export function CameraGlyph({ size = 26, stroke = '#fff', opacity = 0.55 }: { size?: number; stroke?: string; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.6 6.2h3.1l1.3-1.9h6l1.3 1.9h3.1v9.6H2.6z" />
      <circle cx="10" cy="10.8" r="3" />
    </svg>
  )
}

/** The phone's on-site mark: green when on site, a quiet grey otherwise, as the phone's viewer draws it. */
export function SiteMark({ here, size = 'sm' }: { here: boolean | null; size?: 'sm' | 'md' }) {
  const on = here === true
  return (
    <span data-mark={here === true ? 'on' : here === false ? 'away' : 'none'} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, color: on ? color.green : color.muted, fontWeight: on ? 600 : 500 }}>
      <svg width={size === 'sm' ? 10 : 12} height={size === 'sm' ? 10 : 12} viewBox="0 0 12 12" aria-hidden="true" style={{ flex: 'none' }}>
        {here === null ? (
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.6" />
        ) : (
          <circle cx="6" cy="6" r="4.2" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" />
        )}
      </svg>
      <span style={oneLine}>{markWords(here)}</span>
    </span>
  )
}

export interface PhotoGridProps {
  photos: Photo[]
  site: Pick<JobSiteRow, 'lat' | 'lng' | 'radius_m'>
  meId: string
  names: ReadonlyMap<string, string>
  onOpen: (photo: Photo) => void
}

export function PhotoGrid({ photos, site, meId, names, onOpen }: PhotoGridProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const cols = Math.max(2, Math.floor(((width ?? 1100) + GAP) / (MIN_TILE + GAP)))
  const days = groupByDay(photos)
  let n = 0
  return (
    <div ref={ref} data-photo-grid="" style={{ display: 'flex', flexDirection: 'column', gap: space.lg, minWidth: 0 }}>
      {days.map(({ day, photos: rows }) => (
        <section key={day} data-day={day} aria-label={dayHeading(day)} style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <h3 style={{ margin: 0, ...text.label, color: color.muted }}>
            {dayHeading(day)}
            <span style={{ fontWeight: 500, letterSpacing: '.04em' }}> · {rows.length}</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }}>
            {rows.map((p) => (
              <Tile key={p.id} photo={p} shade={SHADES[n++ % SHADES.length]!} who={whoOf(p.uploaded_by, meId, names)} here={onSite(p, site)} onOpen={() => onOpen(p)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Tile({ photo, shade, who, here, onOpen }: { photo: Photo; shade: string; who: string; here: boolean | null; onOpen: () => void }) {
  const [ref, near] = useNear<HTMLButtonElement>()
  const url = useSignedUrl(photo.storage_path, near)
  const [state, setState] = useState<'loading' | 'shown' | 'broken'>('loading')
  const issue = photo.category === 'issue'
  const time = timeOf(takenOf(photo))
  const failed = url === 'failed' || state === 'broken'
  return (
    <button
      ref={ref}
      type="button"
      className="wb-focus"
      data-photo={photo.id}
      data-photo-name={photo.name}
      onClick={onOpen}
      aria-label={`${photo.caption ? `${photo.caption}. ` : ''}${issue ? 'Flagged as an issue. ' : ''}By ${who} at ${time}, ${markWords(here).toLowerCase()}. Open the photo.`}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, margin: 0, padding: 0, border: 0, borderRadius: radius.md, background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
    >
      <span style={{ position: 'relative', display: 'block', width: '100%', aspectRatio: '1', borderRadius: radius.md, overflow: 'hidden', background: shade }}>
        {url && url !== 'failed' && !failed && (
          <img
            src={url}
            alt=""
            decoding="async"
            onLoad={() => setState('shown')}
            onError={() => setState('broken')}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: state === 'shown' ? 1 : 0, transition: 'opacity .15s' }}
          />
        )}
        {state !== 'shown' && (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <CameraGlyph />
            {failed && <span style={{ ...text.xs, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.35)' }}>Could not load</span>}
          </span>
        )}
        {issue && (
          <span style={{ position: 'absolute', left: 6, top: 6, display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 10, background: color.red, color: color.onDark, fontSize: 11, fontWeight: 700, letterSpacing: '.02em' }}>
            Issue
          </span>
        )}
        {photo.caption && (
          // The phone's caption pill, bottom left.
          <span style={{ position: 'absolute', left: 6, right: 6, bottom: 6, display: 'flex' }}>
            <span style={{ maxWidth: '100%', padding: '3px 7px', borderRadius: 6, background: 'rgba(20,23,26,.72)', color: '#fff', fontSize: 11.5, fontWeight: 600, ...oneLine }}>{photo.caption}</span>
          </span>
        )}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, padding: '0 2px' }}>
        <span style={{ ...text.sm, fontWeight: 600, color: color.ink, ...oneLine }} data-photo-who="">
          {who}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, ...text.xs, color: color.muted }}>
          <span data-photo-time="" style={{ flex: 'none' }}>
            {time}
          </span>
          <span aria-hidden="true">·</span>
          <SiteMark here={here} />
        </span>
      </span>
    </button>
  )
}
