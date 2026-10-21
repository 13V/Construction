/**
 * The queue of photos going up from the desk.
 *
 * Each file goes up as the phone's PhotoScreen sends one (data/photos.ts
 * uploadPhoto): the same bucket, path and row, dated the moment it was
 * added, with no location. Three go up at a time; each is read back before
 * it counts as added. A file a browser cannot show (an iPhone HEIC, a PDF),
 * or one over 25 MB, is refused before anything is sent.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { photoRefusal, uploadPhoto, type Photo, type PhotoCategory } from '../../data/photos'
import type { WorkerRow } from '../../phone'
import type { Rejected } from '../../ui/DropZone'

/** How many photos go up at once. */
const AT_ONCE = 3

export interface Upload {
  key: string
  file: File
  /** A local preview while it goes up, for the formats a browser can show. */
  preview: string | null
  /**
   * queued → uploading → done | failed. refused: never sent (a HEIC, a PDF,
   * over 25 MB); failed: sent and not saved, and can be tried again.
   */
  state: 'queued' | 'uploading' | 'done' | 'failed' | 'refused'
  message?: string
  category: PhotoCategory
  caption: string
  /** When it was added: the phone stamps taken_at the moment a photo is picked. */
  takenAt: string
}

let seq = 0

/**
 * `add` takes a drop (or a choice) and starts it; each photo that saves is
 * handed to onStored as read back, and onSettled runs when nothing is left
 * going up. A failed one waits for `retry`.
 */
export function useUploads({ me, siteId, onStored, onSettled }: { me: WorkerRow; siteId: string; onStored: (p: Photo) => void; onSettled: () => void }) {
  const [uploads, setUploads] = useState<Upload[]>([])
  // The queue as it is now, for the pump: a second drop a moment after the
  // first must see what the first started.
  const now = useRef<Upload[]>([])
  const set = useCallback((next: (prev: Upload[]) => Upload[]) => {
    now.current = next(now.current)
    setUploads(now.current)
  }, [])
  const running = useRef(0)
  const latest = useRef({ me, siteId, onStored, onSettled })
  useEffect(() => {
    latest.current = { me, siteId, onStored, onSettled }
  })

  const patch = useCallback((key: string, change: Partial<Upload>) => set((all) => all.map((u) => (u.key === key ? { ...u, ...change } : u))), [set])

  const pump = useCallback(() => {
    while (running.current < AT_ONCE) {
      const next = now.current.find((u) => u.state === 'queued')
      if (!next) break
      running.current += 1
      patch(next.key, { state: 'uploading', message: undefined })
      const { me: who, siteId: job } = latest.current
      void uploadPhoto({ me: who, siteId: job, file: next.file, category: next.category, caption: next.caption, takenAt: next.takenAt })
        .catch((e: unknown) => ({ ok: false as const, message: `Not added: ${e instanceof Error ? e.message : String(e)}` }))
        .then((res) => {
          running.current -= 1
          if (res.ok) {
            patch(next.key, { state: 'done', message: 'Added' })
            latest.current.onStored(res.value)
          } else patch(next.key, { state: 'failed', message: res.message })
          if (running.current === 0 && !now.current.some((u) => u.state === 'queued')) latest.current.onSettled()
          pump()
        })
    }
  }, [patch])

  const add = useCallback(
    (files: File[], rejected: Rejected[], { category, caption }: { category: PhotoCategory; caption: string }) => {
      // Stamped now, as the phone stamps a photo the moment it is picked.
      const takenAt = new Date().toISOString()
      const item = (file: File, refusal: string | null): Upload => ({
        key: `ph${++seq}`,
        file,
        preview: refusal ? null : URL.createObjectURL(file),
        state: refusal ? 'refused' : 'queued',
        message: refusal ? `Not sent. ${refusal}` : undefined,
        category,
        caption,
        takenAt,
      })
      const fresh = [...files.map((f) => item(f, photoRefusal(f))), ...rejected.map((r) => item(r.file, photoRefusal(r.file) ?? r.reason))]
      set((all) => [...all, ...fresh])
      pump()
    },
    [set, pump],
  )

  const retry = useCallback(
    (key: string) => {
      if (now.current.find((u) => u.key === key)?.state !== 'failed') return
      patch(key, { state: 'queued', message: undefined })
      pump()
    },
    [patch, pump],
  )

  const clearFinished = useCallback(() => {
    set((all) => {
      for (const u of all) if (u.preview && (u.state === 'done' || u.state === 'failed' || u.state === 'refused')) URL.revokeObjectURL(u.preview)
      return all.filter((u) => u.state === 'queued' || u.state === 'uploading')
    })
  }, [set])

  // Previews go with the tab.
  useEffect(
    () => () => {
      for (const u of now.current) if (u.preview) URL.revokeObjectURL(u.preview)
    },
    [],
  )

  const busy = uploads.some((u) => u.state === 'queued' || u.state === 'uploading')

  // Closing the window mid-upload would leave a photo half sent; the browser asks first.
  useEffect(() => {
    if (!busy) return
    const stay = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', stay)
    return () => window.removeEventListener('beforeunload', stay)
  }, [busy])

  return { uploads, busy, add, retry, clearFinished }
}
