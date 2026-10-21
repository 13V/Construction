/**
 * Where chat goes and how much room it has: a conversation's address on the
 * Chat page, a box that fills the window's height, and how wide a box is.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** A conversation's own address: the Chat page with it open. */
export const chatHref = (channelId: string) => `/chat?c=${encodeURIComponent(channelId)}`

/**
 * A box as tall as the window leaves below its top (less `gap`), and never
 * shorter than `min`: a thread whose box Enter sends into stays on screen
 * without the page scrolling. Measured again whenever the window changes
 * size or anything above it moves (a banner coming and going).
 */
export function useFillHeight<T extends HTMLElement>(min: number, gap = 24) {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    const next = Math.max(min, Math.floor(window.innerHeight - top - gap))
    setHeight((h) => (h !== undefined && Math.abs(h - next) < 2 ? h : next))
  }, [min, gap])
  // Every render: what is above may have changed height. setHeight bails out when nothing moved.
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])
  return [ref, height] as const
}

/** How wide a box is, kept up to date. Null until it has been measured. */
export function useBoxWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return [ref, width] as const
}
