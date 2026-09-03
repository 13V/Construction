import { afterEach, describe, expect, it, vi } from 'vitest'
import { backend, backendNote, startWatching } from './location'

/**
 * What this file guards has inverted, and the reason is worth recording.
 *
 * It used to assert that a native background watcher starts, because
 * background location was the whole argument for shipping a binary. Two
 * rejections later — 2.5.4 for declaring the location background mode with
 * employee tracking as its only use, then 5.6 when a native region-monitoring
 * plugin was offered in its place — the app reads location only while it is
 * open, and only to check a worker is at the site when they clock on or off.
 *
 * So the invariant now is the opposite one: reaching for any background
 * location path again, however it is dressed, is what put this app in front
 * of App Review four times.
 *
 * The second thing tested here has not changed and never should: the app must
 * not tell a worker their hours are being recorded when they are not. A
 * silent, correct-looking fallback is the failure that costs somebody a day's
 * pay, and it needs a test rather than a pair of eyes.
 */

interface Fake {
  addWatcherCalls: number
  webWatchCalls: number
}

function shell(opts: { native: boolean; bridged: boolean; regions?: boolean }): Fake {
  const counts: Fake = { addWatcherCalls: 0, webWatchCalls: 0 }

  const plugin = {
    addWatcher: async (
      _o: unknown,
      cb: (p: { latitude: number; longitude: number; accuracy: number; time: number }) => void,
    ) => {
      counts.addWatcherCalls++
      cb({ latitude: -34.93, longitude: 138.6, accuracy: 8, time: 1_700_000_000_000 })
      return 'watch-1'
    },
    removeWatcher: async () => {},
  }

  vi.stubGlobal('Capacitor', {
    isNativePlatform: () => opts.native,
    // The bridge injects natively-registered plugins here. `bridged: false`
    // is the shell as it behaves when nothing has registered — the state the
    // old code was permanently in, because it never looked here at all.
    Plugins: {
      ...(opts.bridged ? { BackgroundGeolocation: plugin } : {}),
      ...(opts.regions ? { SiteGeofence: { setRegions: async () => ({ monitoring: 1 }) } } : {}),
    },
  })
  vi.stubGlobal('navigator', {
    geolocation: {
      watchPosition: () => {
        counts.webWatchCalls++
        return 1
      },
      clearWatch: () => {},
    },
  })
  return counts
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('location, and what the app claims about it', () => {
  it('never starts a native background watcher, even when one is offered', async () => {
    // A registered BackgroundGeolocation plugin must not tempt it. Using one
    // is what requires UIBackgroundModes, and that key is what App Review
    // named in the 2.5.4 rejection.
    const counts = shell({ native: true, bridged: true })
    const errors: string[] = []

    const watch = await startWatching(() => {}, (e) => errors.push(e))

    expect(counts.addWatcherCalls).toBe(0)
    expect(counts.webWatchCalls).toBe(1)
    expect(errors).toEqual([])
    watch.stop()
  })

  it('never claims location keeps working once the app is closed', async () => {
    // It does not, on a phone or in a browser. The app reads location only
    // while it is open, and a worker who believes otherwise loses hours.
    shell({ native: true, bridged: true })
    expect(backend()).toBe('web')
    expect(backendNote()).not.toMatch(/screen off/i)
    expect(backendNote()).toMatch(/only while this app is open/i)
  })


  it('uses the browser watcher in a browser, without pretending otherwise', async () => {
    const counts = shell({ native: false, bridged: false })
    await startWatching(() => {}, () => {})
    expect(counts.addWatcherCalls).toBe(0)
    expect(counts.webWatchCalls).toBe(1)
    expect(backend()).toBe('web')
    expect(backendNote()).toMatch(/only while this app is open/i)
  })
})
