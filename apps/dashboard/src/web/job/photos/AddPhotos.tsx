/**
 * Adding photos from the desk: the drop zone with the phone's two questions
 * ("What is this?" and a caption, both optional), and the list that shows
 * each photo going up and says which did not, and why. The queue itself is
 * useUploads.ts.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { DEFAULT_CATEGORY, PHOTO_CATEGORIES, PHOTO_CATEGORY_LABEL, PHOTO_PICKER_ACCEPT, type PhotoCategory } from '../../data/photos'
import { sizeLabel } from '../../data/drawings'
import { color, radius, shadow, space, text } from '../../tokens'
import { Button } from '../../ui/Button'
import { DropZone, type Rejected } from '../../ui/DropZone'
import { Field } from '../../ui/Field'
import { Select } from '../../ui/Select'
import { CameraGlyph } from './PhotoGrid'
import type { Upload } from './useUploads'

// --------------------------------------------------------------------- the card

const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: space.md,
  padding: space.lg,
  background: color.panel,
  border: `1px solid ${color.borderSoft}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
}

const HINT = "JPEG, PNG, WebP or GIF, up to 25 MB each. They show on the crew's phones straight away, dated now, with no location."

/**
 * Where photos are added. Full size on an empty job, where it is the next
 * step; once there are photos, one compact band above them, so the photos
 * stay the page.
 */
export function AddPhotosCard({
  wide,
  compact,
  category,
  caption,
  onCategory,
  onCaption,
  onFiles,
  onReject,
}: {
  /** Room for the questions beside the drop zone. */
  wide: boolean
  /** The job has photos: the band, not the card. */
  compact: boolean
  category: PhotoCategory
  caption: string
  onCategory: (c: PhotoCategory) => void
  onCaption: (c: string) => void
  onFiles: (files: File[]) => void
  onReject: (rejected: Rejected[]) => void
}) {
  const questions = (
    <>
      <Select
        label="What are these?"
        value={category}
        onChange={(e) => onCategory(e.target.value as PhotoCategory)}
        options={PHOTO_CATEGORIES.map((c) => ({ value: c, label: PHOTO_CATEGORY_LABEL[c] }))}
        data-photos-category=""
      />
      <Field label="Caption" optional placeholder="Ensuite floor" value={caption} onChange={(e) => onCaption(e.target.value)} data-photos-caption="" />
    </>
  )
  const note = category === DEFAULT_CATEGORY && !caption.trim() ? 'The phone asks these two as well. Both are optional.' : 'Both go on every photo you add next.'

  if (compact) {
    return (
      <section aria-label="Add photos from this computer" data-photos-add="compact" style={{ ...card, gap: space.xs, padding: `${space.sm}px ${space.md}px` }}>
        <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0, 1fr) 176px minmax(0, 220px)' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: space.sm, alignItems: 'end' }}>
          <div style={{ gridColumn: wide ? undefined : '1 / -1', background: color.panel, borderRadius: radius.md }}>
            <DropZone compact accept={PHOTO_PICKER_ACCEPT} onFiles={onFiles} onReject={onReject} label="Drop photos here to add them, or" buttonLabel="Choose photos" />
          </div>
          {questions}
        </div>
        <div style={{ ...text.xs, color: color.muted }}>
          {HINT} {category === DEFAULT_CATEGORY && !caption.trim() ? '' : note}
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="wb-photos-add-h" data-photos-add="" style={{ ...card, padding: wide ? space.lg : space.md }}>
      <h3 id="wb-photos-add-h" style={{ margin: 0, ...text.label, color: color.muted }}>
        Add photos from this computer
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0, 1fr) 248px' : 'minmax(0, 1fr)', gap: space.md, alignItems: 'start' }}>
        <div style={{ background: color.panel, borderRadius: radius.md }}>
          <DropZone accept={PHOTO_PICKER_ACCEPT} onFiles={onFiles} onReject={onReject} label="Drop photos here" hint={HINT} buttonLabel="Choose photos" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          {questions}
          <div style={{ ...text.xs, color: color.muted }}>{note}</div>
        </div>
      </div>
    </section>
  )
}

// --------------------------------------------------------------------- the list

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "Adding 3 photos…", or how the last lot went. */
function headline(uploads: Upload[]): { title: string; detail: string | null } {
  const sent = uploads.filter((u) => u.state !== 'refused')
  const done = sent.filter((u) => u.state === 'done').length
  const failed = sent.filter((u) => u.state === 'failed').length
  const refused = uploads.length - sent.length
  const left = sent.filter((u) => u.state === 'queued' || u.state === 'uploading').length
  const tail = [failed ? `${failed} not added` : null, refused ? `${refused} not sent` : null].filter(Boolean).join(', ')
  if (left) return { title: `Adding ${plural(left, 'photo')}…`, detail: `${done} of ${sent.length} added${tail ? ` · ${tail}` : ''}` }
  if (!sent.length) return { title: refused === 1 ? 'That file was not sent' : 'Those files were not sent', detail: null }
  return { title: done ? `${plural(done, 'photo')} added` : 'No photos added', detail: tail || null }
}

/**
 * Each photo going up, and how it went. Once nothing is left going up, the
 * ones that were added fold away (they are in the grid now) and only the
 * ones that were not stay listed, each with its reason.
 */
export function UploadList({ uploads, onRetry, onClear }: { uploads: Upload[]; onRetry: (key: string) => void; onClear: () => void }) {
  const sent = uploads.filter((u) => u.state !== 'refused')
  const finished = sent.filter((u) => u.state === 'done' || u.state === 'failed').length
  const settled = uploads.every((u) => u.state !== 'queued' && u.state !== 'uploading')
  const { title, detail } = headline(uploads)
  const pct = sent.length ? Math.round((finished / sent.length) * 100) : 100
  const listed = settled ? uploads.filter((u) => u.state === 'failed' || u.state === 'refused') : uploads
  return (
    <section aria-label="Photos being added" data-uploads="" style={{ ...card, gap: 0, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px` }}>
        <div role="status" style={{ flex: 1, minWidth: 0 }}>
          <div data-uploads-title="" style={{ ...text.base, fontWeight: 600, color: color.ink }}>
            {title}
          </div>
          {detail && <div style={{ ...text.sm, color: color.muted }}>{detail}</div>}
        </div>
        {settled && (
          <Button size="sm" variant="ghost" onClick={onClear} data-uploads-clear="">
            Clear
          </Button>
        )}
      </div>
      {sent.length > 0 && !settled && (
        <div aria-hidden="true" style={{ height: 3, background: color.fill }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color.ink, transition: 'width .2s' }} />
        </div>
      )}
      {listed.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', borderTop: `1px solid ${color.borderSoft}`, maxHeight: 360, overflowY: 'auto' }}>
          {listed.map((u, i) => (
            <li
              key={u.key}
              data-upload={u.file.name}
              data-state={u.state}
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `${space.xs}px ${space.sm}px`, minHeight: 52, padding: `${space.xs}px ${space.md}px`, borderTop: i === 0 ? undefined : `1px solid ${color.borderSoft}` }}
            >
              <Thumb u={u} />
              <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...text.base, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.file.name} <span style={{ ...text.xs, color: color.muted }}>{u.file.size ? sizeLabel(u.file.size) : ''}</span>
                </span>
                <Status u={u} />
              </span>
              {u.state === 'failed' && (
                <Button size="sm" onClick={() => onRetry(u.key)} data-upload-retry="">
                  Try again
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Thumb({ u }: { u: Upload }) {
  const [broken, setBroken] = useState(false)
  return (
    <span aria-hidden="true" style={{ position: 'relative', flex: 'none', width: 36, height: 36, borderRadius: radius.sm, overflow: 'hidden', background: u.state === 'refused' ? color.fill : '#C9CFD5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {u.preview && !broken ? (
        <img src={u.preview} alt="" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: u.state === 'done' ? 1 : 0.7 }} />
      ) : (
        <CameraGlyph size={18} stroke={u.state === 'refused' ? color.muted : '#fff'} opacity={0.8} />
      )}
    </span>
  )
}

function Status({ u }: { u: Upload }) {
  const words: Record<Upload['state'], ReactNode> = {
    queued: 'Waiting…',
    uploading: 'Uploading…',
    done: u.message,
    failed: u.message,
    refused: u.message,
  }
  const tone = u.state === 'failed' || u.state === 'refused' ? color.red : u.state === 'done' ? color.green : color.muted
  return (
    <span role={u.state === 'failed' || u.state === 'refused' ? 'alert' : undefined} data-upload-status="" style={{ ...text.xs, color: tone }}>
      {words[u.state]}
    </span>
  )
}
