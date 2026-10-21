/**
 * One photo, as large as the window allows: the phone's PhotoViewer at desk
 * size. Previous and next by the buttons or the arrow keys, in the order the
 * grid shows them; Esc or the cross closes it and puts focus back on the
 * tile.
 *
 * Beside the picture (under it in a narrow window): who took it, when, and
 * where, with the phone's on-site mark and how far from the job's pin that
 * was; then the phone's two actions, read back (data/photos.ts):
 *  - Flag as an issue: the photo's category becomes 'issue'. As on the
 *    phone, there is no button once it is flagged.
 *  - Delete: the photo comes off the job, here and on every phone. Deleting
 *    is the office's job under RLS, and everyone signed in to the website is
 *    the office, so it is shown to everyone, as the phone shows it, and the
 *    read-back says if the database refused.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { deletePhoto, distanceWords, flagPhoto, metresFromPin, onSite, PHOTO_CATEGORY_LABEL, whenWords, whoOf, type Photo, type PhotoCategory } from '../../data/photos'
import { webRoot } from '../../marker'
import { BUCKET_FILES, signedUrl, type JobSiteRow } from '../../phone'
import { useToast } from '../../shell/Toast'
import { color, radius, space, text, z } from '../../tokens'
import { Button, CloseIcon } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Dialog, useModal } from '../../ui/Dialog'
import { useMinWidth, useSignedUrl } from './hooks'
import { SiteMark } from './PhotoGrid'

/** Below this window width the details go under the picture. */
const SIDE_BY_SIDE = 820

export interface PhotoViewerProps {
  /** In the order the grid shows them. */
  photos: Photo[]
  index: number
  site: Pick<JobSiteRow, 'lat' | 'lng' | 'radius_m'>
  meId: string
  names: ReadonlyMap<string, string>
  onIndex: (index: number) => void
  onClose: () => void
  /** Saved and read back as an issue. */
  onFlagged: (id: string) => void
  /** Off the job: deleted here, or found already deleted. */
  onDeleted: (id: string) => void
}

const Chevron = ({ back }: { back?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={back ? 'M12.2 4.4 6.6 10l5.6 5.6' : 'M7.8 4.4 13.4 10l-5.6 5.6'} />
  </svg>
)

/** A round white button on the dark stage (the kit's light button, whose focus ring is white). */
const round: CSSProperties = { width: 44, height: 44, padding: 0, borderRadius: 22, boxShadow: '0 2px 8px rgba(0,0,0,.35)' }

export function PhotoViewer({ photos, index, site, meId, names, onIndex, onClose, onFlagged, onDeleted }: PhotoViewerProps) {
  const toast = useToast()
  const wide = useMinWidth(SIDE_BY_SIDE)
  const panel = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const photo = photos[index]!
  const url = useSignedUrl(photo.storage_path, true)
  const [shown, setShown] = useState<{ id: string; state: 'shown' | 'broken' } | null>(null)
  const [flag, setFlag] = useState<{ id: string; busy: boolean; error: string | null } | null>(null)
  const [asking, setAsking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useModal(true, onClose, panel, () => closeBtn.current)

  // The arrow keys page, as on the phone; not while the delete question is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (asking || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault()
        onIndex(index - 1)
      } else if (e.key === 'ArrowRight' && index < photos.length - 1) {
        e.preventDefault()
        onIndex(index + 1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [asking, index, photos.length, onIndex])

  // The ones either side, signed and fetched ahead, so paging does not wait.
  useEffect(() => {
    let live = true
    for (const p of [photos[index - 1], photos[index + 1]]) {
      if (!p) continue
      void signedUrl(BUCKET_FILES, p.storage_path).then((u) => {
        if (live && u) new Image().src = u
      })
    }
    return () => {
      live = false
    }
  }, [index, photos])

  const here = onSite(photo, site)
  const metres = metresFromPin(photo, site)
  const who = whoOf(photo.uploaded_by, meId, names)
  const issue = photo.category === 'issue'
  const state = shown?.id === photo.id ? shown.state : 'loading'
  const flagging = flag?.id === photo.id && flag.busy
  const flagError = flag?.id === photo.id ? flag.error : null
  const other = photo.category && photo.category in PHOTO_CATEGORY_LABEL && photo.category !== 'issue' && photo.category !== 'progress' ? PHOTO_CATEGORY_LABEL[photo.category as PhotoCategory] : null

  const doFlag = async () => {
    const target = photo
    if (flagging || target.category === 'issue') return
    setFlag({ id: target.id, busy: true, error: null })
    const res = await flagPhoto(target)
    if (!res.ok) {
      setFlag({ id: target.id, busy: false, error: res.message })
      return
    }
    setFlag(null)
    onFlagged(target.id)
    toast('Flagged as an issue.', { tone: 'success' })
  }

  const doDelete = async () => {
    const target = photo
    setDeleting(true)
    setDeleteError(null)
    const res = await deletePhoto(target)
    setDeleting(false)
    if (!res.ok && !res.gone) {
      setDeleteError(res.message)
      return
    }
    setAsking(false)
    toast(res.ok ? 'Photo deleted.' : res.message, { tone: res.ok ? 'success' : 'neutral' })
    onDeleted(target.id)
  }

  const where =
    here === null
      ? 'This photo has no location. Photos added from the office never do, and a phone without a GPS fix records none.'
      : `${distanceWords(metres ?? 0)} from the job's pin, ${here ? 'inside' : 'outside'} its ${site.radius_m} m fence.`
  const added = photo.taken_at && new Date(photo.created_at).getTime() - new Date(photo.taken_at).getTime() > 30 * 60_000 ? `Added ${whenWords(photo.created_at)}` : null

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      tabIndex={-1}
      data-photo-viewer={photo.id}
      className="wb-anim-fade"
      style={{ position: 'fixed', inset: 0, zIndex: z.drawer, display: 'flex', flexDirection: wide ? 'row' : 'column', background: color.inkDeep, outline: 'none' }}
    >
      {/* The picture. */}
      <div style={{ position: 'relative', flex: wide ? '1 1 auto' : '1 1 56%', minWidth: 0, minHeight: 0 }}>
        <div style={{ position: 'absolute', inset: wide ? '68px 84px' : '64px 12px 72px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {url && url !== 'failed' && state !== 'broken' && (
            <img
              key={photo.id}
              src={url}
              alt={photo.caption ?? photo.name}
              data-viewer-image=""
              onLoad={() => setShown({ id: photo.id, state: 'shown' })}
              onError={() => setShown({ id: photo.id, state: 'broken' })}
              style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, opacity: state === 'shown' ? 1 : 0, transition: 'opacity .15s' }}
            />
          )}
          {state !== 'shown' && (
            <span role="status" style={{ position: 'absolute', ...text.sm, color: color.onDarkMuted, textAlign: 'center', padding: space.md }}>
              {url === 'failed' || state === 'broken' ? 'This photo could not be loaded. Close it and try again in a moment.' : 'Loading…'}
            </span>
          )}
        </div>

        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, padding: `${space.sm}px ${space.md}px` }}>
          <span data-viewer-count="" style={{ ...text.base, fontWeight: 700, color: color.onDark, fontVariantNumeric: 'tabular-nums' }}>
            {index + 1} of {photos.length}
          </span>
          <Button ref={closeBtn} variant="light" onClick={onClose} aria-label="Close the photo" title="Close (Esc)" style={round}>
            <CloseIcon size={14} />
          </Button>
        </div>

        <Button
          variant="light"
          onClick={() => onIndex(index - 1)}
          disabled={index === 0}
          aria-label="Previous photo"
          title="Previous (←)"
          data-viewer-prev=""
          style={{ ...round, position: 'absolute', left: space.md, ...(wide ? { top: '50%', marginTop: -22 } : { bottom: space.sm }) }}
        >
          <Chevron back />
        </Button>
        <Button
          variant="light"
          onClick={() => onIndex(index + 1)}
          disabled={index >= photos.length - 1}
          aria-label="Next photo"
          title="Next (→)"
          data-viewer-next=""
          style={{ ...round, position: 'absolute', right: space.md, ...(wide ? { top: '50%', marginTop: -22 } : { bottom: space.sm }) }}
        >
          <Chevron />
        </Button>
      </div>

      {/* What it is. */}
      <aside
        aria-label="About this photo"
        data-viewer-details=""
        style={{
          flex: wide ? '0 0 352px' : '0 1 44%',
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: space.md,
          padding: wide ? space.lg : space.md,
          background: color.panel,
          borderTopLeftRadius: wide ? 0 : radius.lg,
          borderTopRightRadius: wide ? 0 : radius.lg,
        }}
      >
        {photo.caption && <div style={{ ...text.md, fontWeight: 600, color: color.ink, overflowWrap: 'anywhere' }}>{photo.caption}</div>}

        {(issue || other || photo.waterproofing_package_id) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs }}>
            {issue && (
              <Chip tone="red" dot>
                Flagged as an issue
              </Chip>
            )}
            {other && <Chip>{other}</Chip>}
            {photo.waterproofing_package_id && <Chip>Waterproofing</Chip>}
          </div>
        )}

        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <Detail label="Who">
            <span data-viewer-who="">{who}</span>
          </Detail>
          <Detail label="When">
            <span data-viewer-when="">{photo.taken_at ? whenWords(photo.taken_at) : `Filed ${whenWords(photo.created_at)}`}</span>
            {!photo.taken_at && <span style={{ ...text.sm, color: color.muted }}>No time taken on record</span>}
            {added && <span style={{ ...text.sm, color: color.muted }}>{added}</span>}
          </Detail>
          <Detail label="Where">
            <span data-viewer-where="" style={{ ...text.base }}>
              <SiteMark here={here} size="md" />
            </span>
            <span style={{ ...text.sm, color: color.muted }}>{where}</span>
          </Detail>
        </dl>

        <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs, paddingTop: space.sm, borderTop: `1px solid ${color.borderSoft}` }}>
          {!issue && (
            <Button variant="primary" block loading={flagging} onClick={() => void doFlag()} data-viewer-flag="">
              Flag as an issue
            </Button>
          )}
          {flagError && (
            <div role="alert" style={{ ...text.sm, color: color.red }}>
              {flagError}
            </div>
          )}
          {url && url !== 'failed' && (
            <Button variant="secondary" block href={url} target="_blank" rel="noopener noreferrer" data-viewer-full="">
              Open full size
            </Button>
          )}
          <Button
            variant="secondary"
            block
            onClick={() => {
              setDeleteError(null)
              setAsking(true)
            }}
            data-viewer-delete=""
            style={{ color: color.red }}
          >
            Delete photo
          </Button>
        </div>
      </aside>

      <Dialog
        open={asking}
        title="Delete this photo?"
        confirmLabel="Delete photo"
        tone="danger"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void doDelete()}
        onCancel={() => setAsking(false)}
      >
        It comes off this job, here and on the crew&apos;s phones. This cannot be undone.
      </Dialog>
    </div>,
    webRoot(),
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', columnGap: space.sm, alignItems: 'baseline' }}>
      <dt style={{ ...text.label, color: color.muted }}>{label}</dt>
      <dd style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 2, ...text.base, color: color.ink, minWidth: 0 }}>{children}</dd>
    </div>
  )
}
