import { useEffect, useRef } from 'react'

/**
 * Keep a page's data fresh without realtime.
 *
 * Nothing in this app subscribes to changes: the phone polls nothing either,
 * and a job the crew edit on site only reaches the office when the office
 * asks again. So the website asks again at the moments somebody is likely to
 * look: when the window regains focus, when the tab becomes visible again,
 * and every `everyMs` (default 60 s) while it stays visible. A hidden tab
 * asks nothing, so a laptop left open overnight is not polling the database.
 *
 * Focus and visibilitychange usually fire together when someone comes back
 * to the tab, so calls closer than two seconds apart are folded into one.
 *
 * `refresh` may change on every render; the latest one is always called.
 */
export function useFresh(refresh: () => void, { everyMs = 60_000 }: { everyMs?: number } = {}) {
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })

  useEffect(() => {
    let last = 0
    const run = () => {
      const now = Date.now()
      if (now - last < 2_000) return
      last = now
      latest.current()
    }
    const onFocus = () => run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, everyMs)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [everyMs])
}
