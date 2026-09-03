import { afterEach, describe, expect, it, vi } from 'vitest'
import { backend, backendNote, startWatching } from './location'

/**
 * The one thing this app is native FOR.
 *
 * Background location is the whole argument for shipping a binary instead of a
 * website: a worker drives to site with the phone in a pocket and is on the
 * clock before they get out of the ute. It reached production not working.
 * The native plugin was loaded with a runtime-assembled bare specifier —
 * `import("@capacitor-community/background-geolocation")` — which no browser
 * engine can resolve, WKWebView included, so it threw on every phone.
 *
 * What made it survive is the thing worth testing: startWatching() catches
 * that failure and falls back to navigator.geolocation, which reports
 * perfectly well while the app is open. So it looked right in the hand and
 * stopped the moment the screen locked, and the only symptom was a day's hours
 * quietly missing.
 *
 * A silent, correct-looking fallback is exactly the kind of failure that needs
 * a test rather than a pair of eyes.
 */

interface Fake {
  addWatcherCalls: number
  webWatchCalls: number
}

function shell(opts: { native: boolean; bridged: boolean }): Fake {
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
    Plugins: opts.bridged ? { BackgroundGeolocation: plugin } : {},
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

describe('background location', () => {
  it('never starts a native background watcher, even inside the app shell', async () => {
    // The inversion of what this asserted before, and the reason it is worth
    // a test at all: App Review rejected 1.0 under guideline 2.5.4 for
    // declaring the location background mode with employee tracking as its
    // only use. Reaching for a background watcher again — even behind a
    // bridge check that looks harmless — puts the app straight back there.
    const counts = shell({ native: true, bridged: true })
    const errors: string[] = []

    const watch = await startWatching(() => {}, (e) => errors.push(e))

    expect(counts.addWatcherCalls).toBe(0)
    expect(counts.webWatchCalls).toBe(1)
    expect(errors).toEqual([])
    watch.stop()
  })

  it('never tells a worker tracking survives a locked screen', async () => {
    // It does not any more, and a worker who believes it does loses hours.
    shell({ native: true, bridged: true })
    expect(backend()).toBe('web')
    expect(backendNote()).not.toMatch(/screen off/i)
    expect(backendNote()).toMatch(/only read while this app is open/i)
  })

  it('uses the browser watcher in a browser, without pretending otherwise', async () => {
    const counts = shell({ native: false, bridged: false })
    await startWatching(() => {}, () => {})
    expect(counts.addWatcherCalls).toBe(0)
    expect(counts.webWatchCalls).toBe(1)
    expect(backend()).toBe('web')
    expect(backendNote()).toMatch(/only read while this app is open/i)
  })
})
