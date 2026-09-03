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
  it('uses the native watcher the Capacitor bridge exposes', async () => {
    const counts = shell({ native: true, bridged: true })
    const fixes: Array<{ lat: number; lng: number }> = []
    const errors: string[] = []

    const watch = await startWatching((f) => fixes.push(f), (e) => errors.push(e))

    expect(counts.addWatcherCalls).toBe(1)
    // The whole point: it must NOT be the browser watcher, which stops dead
    // when the phone locks.
    expect(counts.webWatchCalls).toBe(0)
    expect(errors).toEqual([])
    expect(fixes).toEqual([{ lat: -34.93, lng: 138.6, accuracyM: 8, at: 1_700_000_000_000 }])
    watch.stop()
  })

  it('says tracking survives a locked screen only when it actually will', async () => {
    shell({ native: true, bridged: true })
    expect(backend()).toBe('native')
    expect(backendNote()).toContain('screen off')
  })

  it('falls back to the browser watcher, and says so, when no plugin is there', async () => {
    const counts = shell({ native: true, bridged: false })
    const errors: string[] = []

    await startWatching(() => {}, (e) => errors.push(e))

    // Degrading is correct — going silent is not. A worker who believes they
    // are being tracked in the background when they are not loses hours.
    expect(counts.webWatchCalls).toBe(1)
    expect(errors.join(' ')).toMatch(/foreground only/i)
  })

  it('uses the browser watcher in a browser, without pretending otherwise', async () => {
    const counts = shell({ native: false, bridged: false })
    await startWatching(() => {}, () => {})
    expect(counts.addWatcherCalls).toBe(0)
    expect(counts.webWatchCalls).toBe(1)
    expect(backend()).toBe('web')
    expect(backendNote()).toContain('pauses when your phone locks')
  })
})
