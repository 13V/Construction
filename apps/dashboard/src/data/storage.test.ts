import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Signed links (storage.ts signedUrl).
 *
 * The phone's certificate and SWMS emails promise the builder "link valid
 * for 14 days" (Waterproofing.tsx emailToBuilder, Safety.tsx email). The
 * cache used to be keyed by file only, so a certificate opened on screen
 * first (an hour-long link) went out in the email with that same link, dead
 * within the hour. These pin the rule that fixed it: a link of an hour or
 * less is cached per file and per lifetime; a longer one is signed afresh
 * every time.
 */

const signer = vi.hoisted(() => ({
  n: 0,
  calls: [] as Array<{ bucket: string; path: string; seconds: number }>,
  fail: false,
}))

vi.mock('./supabase', () => ({
  supabase: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, seconds: number) => {
          signer.calls.push({ bucket, path, seconds })
          if (signer.fail) return { data: null, error: { message: 'Object not found' } }
          return { data: { signedUrl: `https://storage.test/${bucket}/${path}?expires_in=${seconds}&n=${++signer.n}` }, error: null }
        },
      }),
    },
  }),
}))

const { signedUrl, SIGNED_CACHE_MAX_SECONDS, BUCKET_FILES } = await import('./storage')

const FOURTEEN_DAYS = 60 * 60 * 24 * 14
const lifetimeOf = (url: string | null) => Number(new URL(url!).searchParams.get('expires_in'))
let file = 0
/** A path no other test has signed, so the module's cache starts empty for it. */
const fresh = () => `co-1/site-1/${++file}-certificate.pdf`

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-21T05:00:00.000Z'))
  signer.calls = []
  signer.fail = false
})
afterEach(() => {
  vi.useRealTimers()
})

describe('signed links', () => {
  it('an emailed 14-day link is not the hour-long one the screen just showed', async () => {
    const path = fresh()
    const onScreen = await signedUrl(BUCKET_FILES, path)
    const emailed = await signedUrl(BUCKET_FILES, path, FOURTEEN_DAYS)
    expect(lifetimeOf(onScreen)).toBe(3600)
    expect(lifetimeOf(emailed)).toBe(FOURTEEN_DAYS)
    expect(emailed).not.toBe(onScreen)
    expect(signer.calls.map((c) => c.seconds)).toEqual([3600, FOURTEEN_DAYS])
  })

  it('a long link is signed afresh every time, so it lasts its whole lifetime from when it is sent', async () => {
    const path = fresh()
    const first = await signedUrl(BUCKET_FILES, path, FOURTEEN_DAYS)
    vi.advanceTimersByTime(3 * 86_400_000)
    const again = await signedUrl(BUCKET_FILES, path, FOURTEEN_DAYS)
    expect(again).not.toBe(first)
    expect(signer.calls).toEqual([
      { bucket: BUCKET_FILES, path, seconds: FOURTEEN_DAYS },
      { bucket: BUCKET_FILES, path, seconds: FOURTEEN_DAYS },
    ])
    // And the hour-long link for the screen is not one of them.
    const onScreen = await signedUrl(BUCKET_FILES, path)
    expect(lifetimeOf(onScreen)).toBe(3600)
  })

  it('an hour-long link is still cached for the screen while it has more than a minute left', async () => {
    const path = fresh()
    const a = await signedUrl(BUCKET_FILES, path)
    vi.advanceTimersByTime(58 * 60_000)
    const b = await signedUrl(BUCKET_FILES, path)
    expect(b).toBe(a)
    expect(signer.calls).toHaveLength(1)
    vi.advanceTimersByTime(60_000 + 1)
    const c = await signedUrl(BUCKET_FILES, path)
    expect(c).not.toBe(a)
    expect(signer.calls).toHaveLength(2)
  })

  it('the cache is per lifetime: a 5-minute link is never handed out as an hour-long one', async () => {
    const path = fresh()
    const short = await signedUrl(BUCKET_FILES, path, 300)
    const hour = await signedUrl(BUCKET_FILES, path, SIGNED_CACHE_MAX_SECONDS)
    expect(lifetimeOf(short)).toBe(300)
    expect(lifetimeOf(hour)).toBe(3600)
    expect(await signedUrl(BUCKET_FILES, path, 300)).toBe(short)
    expect(signer.calls.map((c) => c.seconds)).toEqual([300, 3600])
  })

  it('the same file in another bucket is its own link', async () => {
    const path = fresh()
    const a = await signedUrl(BUCKET_FILES, path)
    const b = await signedUrl('receipts', path)
    expect(b).not.toBe(a)
    expect(signer.calls.map((c) => c.bucket)).toEqual([BUCKET_FILES, 'receipts'])
  })

  it('a link that could not be signed is null, and nothing is cached for it', async () => {
    const path = fresh()
    signer.fail = true
    expect(await signedUrl(BUCKET_FILES, path)).toBeNull()
    signer.fail = false
    expect(lifetimeOf(await signedUrl(BUCKET_FILES, path))).toBe(3600)
    expect(signer.calls).toHaveLength(2)
  })
})
