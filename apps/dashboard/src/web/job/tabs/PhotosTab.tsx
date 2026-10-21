/**
 * The job's Photos tab: every photo the crew took on this job, as the
 * phone's Photos tab shows them, at desk size.
 *
 *  - The photos are the phone's (Job.tsx PhotoGrid's read), all of them
 *    rather than the newest 60, a day at a time, newest first. Each tile
 *    says who took it, when, and the phone's on-site mark.
 *  - A tile opens the viewer: the photo large, previous and next, and the
 *    phone's two actions, flag as an issue and delete.
 *  - Photos can be added here: drop them anywhere on the tab, or choose them.
 *    Each is filed as the phone files one, without the GPS fix only a phone
 *    has.
 *
 * Everything that decides what a crew member sees is in data/photos.ts,
 * pinned to the phone's source by its tests; this file and job/photos/ only
 * draw it. The list is read again when the window comes back into focus and
 * every minute (useFresh), so a photo taken on site shows without a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { DEFAULT_CATEGORY, groupByDay, loadNames, loadPhotos, PHOTO_PICKER_ACCEPT, photosSummary, type Photo, type PhotoCategory } from '../../data/photos'
import { useFresh } from '../../data/useFresh'
import { color, radius, shadow, space, text, z } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button } from '../../ui/Button'
import { screenFiles, type Rejected } from '../../ui/DropZone'
import { Empty } from '../../ui/Empty'
import { AddPhotosCard, UploadList } from '../photos/AddPhotos'
import { useWidth } from '../photos/hooks'
import { CameraGlyph, PhotoGrid } from '../photos/PhotoGrid'
import { PhotoViewer } from '../photos/PhotoViewer'
import { useUploads } from '../photos/useUploads'
import type { JobTabProps } from '../types'

/** From this tab width the add card puts its two questions beside the drop zone. */
const QUESTIONS_BESIDE = 720

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export default function PhotosTab({ me, site }: JobTabProps) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [names, setNames] = useState<Map<string, string>>(() => new Map())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [namesError, setNamesError] = useState<string | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [category, setCategory] = useState<PhotoCategory>(DEFAULT_CATEGORY)
  const [caption, setCaption] = useState('')
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const [ref, width] = useWidth<HTMLDivElement>()

  // A slow read that lands after a newer one, or after a write this tab
  // made, must not put older rows back.
  const seq = useRef(0)
  const load = useCallback(async () => {
    const n = ++seq.current
    const [p, w] = await Promise.allSettled([loadPhotos(site.id), loadNames()])
    if (n !== seq.current) return
    if (p.status === 'fulfilled') {
      setPhotos(p.value)
      setLoadError(null)
    } else setLoadError(p.reason instanceof Error ? p.reason.message : String(p.reason))
    if (w.status === 'fulfilled') {
      setNames(w.value)
      setNamesError(null)
    } else setNamesError(w.reason instanceof Error ? w.reason.message : String(w.reason))
  }, [site.id])

  useEffect(() => {
    void load()
  }, [load])
  useFresh(() => void load())

  /** A write this tab made, read back, on screen at once; a read already on its way is dropped and the caller reads again after. */
  const wrote = useCallback((change: (all: Photo[]) => Photo[]) => {
    seq.current++
    setPhotos((all) => change(all ?? []))
  }, [])

  const { uploads, add, retry, clearFinished } = useUploads({
    me,
    siteId: site.id,
    onStored: (p) => wrote((all) => [p, ...all.filter((x) => x.id !== p.id)]),
    onSettled: () => void load(),
  })

  const addFiles = (files: File[], rejected: Rejected[]) => add(files, rejected, { category, caption })

  // The order the grid shows them in, which is the order the viewer pages through.
  const order = useMemo(() => (photos ? groupByDay(photos).flatMap((d) => d.photos) : []), [photos])
  const viewerIndex = viewerId ? order.findIndex((p) => p.id === viewerId) : -1

  // A photo deleted somewhere else while it was open: close it.
  useEffect(() => {
    if (viewerId && photos && viewerIndex < 0) setViewerId(null)
  }, [viewerId, photos, viewerIndex])

  const onDeleted = (id: string) => {
    const at = order.findIndex((p) => p.id === id)
    const rest = order.filter((p) => p.id !== id)
    setViewerId(rest.length ? rest[Math.min(Math.max(at, 0), rest.length - 1)]!.id : null)
    wrote((all) => all.filter((p) => p.id !== id))
  }

  const onFlagged = (id: string) => wrote((all) => all.map((p) => (p.id === id ? { ...p, category: 'issue' } : p)))

  // Photos dropped anywhere on the tab are added, not opened by the browser
  // (which would leave the website). The drop zone takes its own drops.
  const dragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    depth.current += 1
    setOver(true)
  }
  const dragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const dragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }
  const drop = (e: DragEvent) => {
    depth.current = 0
    setOver(false)
    if (!hasFiles(e) || e.nativeEvent.defaultPrevented) return
    e.preventDefault()
    const { ok, rejected } = screenFiles(Array.from(e.dataTransfer.files), { accept: PHOTO_PICKER_ACCEPT })
    addFiles(ok, rejected)
  }

  const ready = photos !== null
  const summary = ready ? photosSummary(photos) : loadError ? ' ' : 'Loading…'
  const card = (
    <AddPhotosCard
      wide={(width ?? 1000) >= QUESTIONS_BESIDE}
      compact={ready && photos.length > 0}
      category={category}
      caption={caption}
      onCategory={setCategory}
      onCaption={setCaption}
      onFiles={(files) => addFiles(files, [])}
      onReject={(rejected) => addFiles([], rejected)}
    />
  )

  return (
    <div
      ref={ref}
      data-photos-tab=""
      onDragEnter={dragEnter}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.md }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h2 style={{ margin: 0, ...text.md, fontWeight: 600, color: color.ink }}>Photos</h2>
          <div data-photos-summary="" style={{ ...text.sm, color: color.muted }}>
            {summary}
          </div>
        </div>
      </div>

      {loadError && (
        <Banner
          tone={ready ? 'warn' : 'error'}
          title={ready ? 'Showing the photos as last loaded' : 'Could not load the photos'}
          action={
            <Button size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Banner>
      )}

      {ready && photos.length === 0 && (
        <Empty
          compact
          data-photos-empty=""
          icon={<CameraGlyph size={34} stroke={color.ghost} opacity={1} />}
          title="No photos on this job yet"
        >
          The crew take them on their phones: in the Proven app, open this job, go to Photos and tap Add. Each one lands here with who took it, when, and
          whether they were on site. You can also add photos from this computer below.
        </Empty>
      )}

      {(ready || loadError) && card}

      {uploads.length > 0 && <UploadList uploads={uploads} onRetry={retry} onClear={clearFinished} />}

      {namesError && ready && photos.length > 0 && (
        <div style={{ ...text.sm, color: color.muted }}>Who took each photo could not be read ({namesError}), so the crew&apos;s show as Crew. The photos are up to date.</div>
      )}

      {ready && photos.length > 0 && <PhotoGrid photos={photos} site={site} meId={me.id} names={names} onOpen={(p) => setViewerId(p.id)} />}

      {over && (
        <>
          <div aria-hidden="true" style={{ position: 'absolute', inset: -8, border: `2px dashed ${color.ink}`, borderRadius: radius.lg, background: 'rgba(250,251,252,.55)', pointerEvents: 'none' }} />
          <div
            role="status"
            style={{
              position: 'fixed',
              left: '50%',
              top: space.lg,
              transform: 'translateX(-50%)',
              zIndex: z.popover,
              padding: `${space.xs}px ${space.md}px`,
              borderRadius: radius.pill,
              background: color.inkDeep,
              color: color.onDark,
              boxShadow: shadow.pop,
              ...text.base,
              fontWeight: 600,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Drop to add these photos to this job
          </div>
        </>
      )}

      {viewerIndex >= 0 && (
        <PhotoViewer
          photos={order}
          index={viewerIndex}
          site={site}
          meId={me.id}
          names={names}
          onIndex={(i) => setViewerId(order[i]?.id ?? null)}
          onClose={() => setViewerId(null)}
          onFlagged={onFlagged}
          onDeleted={onDeleted}
        />
      )}
    </div>
  )
}
