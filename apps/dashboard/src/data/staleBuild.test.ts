import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A code file that will not load (data/staleBuild.ts): the page reloads once
 * to get the latest version, never with no connection, and never in a loop.
 *
 * Each test loads the module fresh, as a reloaded page would, with the tab's
 * sessionStorage carried over the way a real reload carries it.
 */

type Module = typeof import('./staleBuild')

let store: Map<string, string>
let storageBroken: boolean
let reloads: number
let online: boolean
let answer: () => Promise<Response>
let probes: Array<{ url: string; init?: RequestInit }>

function stubBrowser({ native = false }: { native?: boolean } = {}) {
  vi.stubGlobal('window', {
    location: { origin: 'https://proven.test', reload: () => void reloads++ },
    get sessionStorage() {
      if (storageBroken) throw new DOMException('The operation is insecure.', 'SecurityError')
      return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      }
    },
  })
  vi.stubGlobal('navigator', {
    get onLine() {
      return online
    },
  })
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    probes.push({ url, init })
    return answer()
  })
  if (native) vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
}

/** The module as a freshly loaded page has it. */
async function page(): Promise<Module> {
  vi.resetModules()
  return import('./staleBuild')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-21T05:00:00.000Z'))
  store = new Map()
  storageBroken = false
  reloads = 0
  online = true
  probes = []
  answer = async () => new Response(null, { status: 200 })
  stubBrowser()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('which failures are a code file that would not load', () => {
  it("knows each browser's words, and Vite's for a stylesheet", async () => {
    const { isChunkLoadError } = await page()
    for (const message of [
      'Failed to fetch dynamically imported module: https://proven.test/assets/ChatPage-C6GjfRz9.js',
      'error loading dynamically imported module: https://proven.test/assets/ChatPage-C6GjfRz9.js',
      'Importing a module script failed.',
      'Unable to preload CSS for https://proven.test/assets/Thread-spRrBl2a.css',
    ]) {
      expect(isChunkLoadError(new TypeError(message))).toBe(true)
    }
  })

  it('and nothing else: a failed request for data is not one', async () => {
    const { isChunkLoadError } = await page()
    for (const e of [new TypeError('Failed to fetch'), new Error('JWT expired'), new TypeError("Cannot read properties of undefined (reading 'name')"), null, undefined, 42]) {
      expect(isChunkLoadError(e)).toBe(false)
    }
  })
})

describe('reloading for the latest version', () => {
  it('reloads once when the website answers, and notes when', async () => {
    const m = await page()
    expect(await m.reloadForLatestVersion()).toBe('reloading')
    expect(reloads).toBe(1)
    expect(probes).toHaveLength(1)
    expect(probes[0]!.url).toBe('https://proven.test/')
    expect(probes[0]!.init).toMatchObject({ method: 'HEAD', cache: 'no-store' })
    expect(store.get(m.RELOADED_AT_KEY)).toBe(String(Date.now()))
  })

  it('cannot loop: the reloaded page failing again is left to the person', async () => {
    const first = await page()
    expect(await first.reloadForLatestVersion()).toBe('reloading')
    // The reload lands, and the file is still missing (a broken deploy).
    vi.advanceTimersByTime(5_000)
    const second = await page()
    expect(await second.reloadForLatestVersion()).toBe('stuck')
    // And every later failure on that page gets the same answer, without asking again.
    expect(await second.reloadForLatestVersion()).toBe('stuck')
    expect(reloads).toBe(1)
  })

  it('may reload again once the guard has passed, for the next deploy', async () => {
    await (await page()).reloadForLatestVersion()
    vi.advanceTimersByTime(10 * 60_000 + 1)
    expect(await (await page()).reloadForLatestVersion()).toBe('reloading')
    expect(reloads).toBe(2)
  })

  it('with no connection it does not reload (that would show the browser\'s own error page), and tries again when asked', async () => {
    online = false
    const m = await page()
    expect(await m.reloadForLatestVersion()).toBe('offline')
    expect(probes).toHaveLength(0)
    expect(reloads).toBe(0)
    expect(store.size).toBe(0)
    // The connection comes back: the boundary asks again.
    online = true
    expect(await m.reloadForLatestVersion()).toBe('reloading')
    expect(reloads).toBe(1)
  })

  it('a website that does not answer counts as offline', async () => {
    answer = async () => Promise.reject(new TypeError('Failed to fetch'))
    const m = await page()
    expect(await m.reloadForLatestVersion()).toBe('offline')
    expect(reloads).toBe(0)
  })

  it('so does one that takes longer than 8 seconds', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      probes.push({ url, init })
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const m = await page()
    const outcome = m.reloadForLatestVersion()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(await outcome).toBe('offline')
    expect(reloads).toBe(0)
  })

  it('does not reload where it cannot note that it did (it could not stop a loop)', async () => {
    storageBroken = true
    const m = await page()
    expect(await m.reloadForLatestVersion()).toBe('stuck')
    expect(reloads).toBe(0)
  })

  it('the preload listener and the boundary that catches the same failure share one attempt', async () => {
    const m = await page()
    const [a, b, c] = await Promise.all([m.reloadForLatestVersion(), m.reloadForLatestVersion(), m.reloadForLatestVersion()])
    expect([a, b, c]).toEqual(['reloading', 'reloading', 'reloading'])
    expect(probes).toHaveLength(1)
    expect(reloads).toBe(1)
  })

  it('in the iOS app the files are on the phone: no probe, one reload, the same guard', async () => {
    vi.unstubAllGlobals()
    stubBrowser({ native: true })
    online = false
    expect(await (await page()).reloadForLatestVersion()).toBe('reloading')
    expect(probes).toHaveLength(0)
    expect(await (await page()).reloadForLatestVersion()).toBe('stuck')
    expect(reloads).toBe(1)
  })
})
