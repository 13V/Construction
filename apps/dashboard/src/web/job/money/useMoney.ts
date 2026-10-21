/**
 * The Money tab's data: data/money.ts's reads, worked out, kept on screen
 * while a refresh runs. Refreshes when the window regains focus, when the
 * tab is shown again and every minute (useFresh), and after a cost is added.
 * A refresh that fails keeps the last figures and reports the error. Loads
 * can overlap (a focus refresh and the reload after a save); only the one
 * asked for last lands.
 *
 * Nothing is read for a login that is not the office: the phone does not
 * even draw the tab for one, and RLS would answer every read with nothing.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadMoney, moneyOf, type Money } from '../../data/money'
import { useFresh } from '../../data/useFresh'

export function useMoney(siteId: string, enabled: boolean) {
  const [data, setData] = useState<Money | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const reload = useCallback(async () => {
    if (!enabled) return
    const mine = ++latest.current
    try {
      const reads = await loadMoney(siteId)
      if (mine !== latest.current) return
      setData(moneyOf(reads))
      setError(null)
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [siteId, enabled])

  // Another job's figures are never shown under this one while its own are loading.
  useEffect(() => {
    setData(null)
    setError(null)
    void reload()
  }, [reload])
  useFresh(() => void reload())

  return { data, error, reload }
}

/**
 * An element's layout width in whole pixels, kept up to date; null until it
 * has been measured. Measured on the element, not the window: the rail and
 * the page's gutters take their share first. A callback ref, so an element
 * that only appears once the data has loaded is measured when it does.
 */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number | null] {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!el) return
    const read = (w: number) => setWidth(Math.floor(w) || null)
    read(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => read(entries[0]?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width]
}
