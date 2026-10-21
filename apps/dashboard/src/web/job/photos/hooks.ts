/**
 * The Photos tab's small hooks: how wide something is laid out, whether it
 * is near the screen yet, a photo's signed URL, and whether the window is
 * wide enough for the viewer's details to sit beside the picture.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { BUCKET_FILES, signedUrl } from '../../phone'

/** The width an element is laid out at, followed as it changes. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** True once the element has come within `margin` of the screen, and from then on. */
export function useNear<T extends Element>(margin = '600px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near, margin])
  return [ref, near]
}

/**
 * A photo's signed URL, asked for once `wanted`; 'failed' when it cannot be
 * signed. The bucket is private, so a picture needs one. It comes from the
 * phone's own signedUrl, which keeps each for the hour, so the viewer opens
 * the same picture its tile already has.
 */
export function useSignedUrl(path: string, wanted: boolean): string | null | 'failed' {
  const [url, setUrl] = useState<{ path: string; url: string | 'failed' } | null>(null)
  useEffect(() => {
    if (!wanted) return
    let live = true
    signedUrl(BUCKET_FILES, path)
      .then((u) => {
        if (live) setUrl({ path, url: u ?? 'failed' })
      })
      .catch(() => {
        if (live) setUrl({ path, url: 'failed' })
      })
    return () => {
      live = false
    }
  }, [path, wanted])
  return url && url.path === path ? url.url : null
}

/** Whether the window is at least `px` wide, followed as it changes. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : true))
  useEffect(() => {
    if (!window.matchMedia) return
    const m = window.matchMedia(query)
    const on = () => setMatches(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return matches
}
