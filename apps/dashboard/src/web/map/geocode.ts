/**
 * Finding an address on the map, through our own /api/geocode (OpenStreetMap's
 * Nominatim, asked from the server; see api/geocode.ts for why it is not
 * asked from the browser).
 *
 * Only ever on purpose: Enter in the address box or the Search button, never
 * as somebody types. Nominatim's usage policy forbids autocomplete and asks
 * for at most one request a second, and the endpoint is written for one
 * search per press. So a search needs at least three characters, a second
 * press while one is on its way does nothing, and an address already looked
 * up in this tab is answered from memory without asking again.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, supabase } from '../phone'

export interface GeocodeHit {
  /** Nominatim's display name: "1, Moseley Square, Glenelg, …, 5045, Australia". */
  label: string
  lat: number
  lng: number
}

/** The endpoint answers anything shorter with a 400; asking is pointless. */
export const GEOCODE_MIN_CHARS = 3

/** A search that could not be answered. The message is for the person. */
export class GeocodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeocodeError'
  }
}

const UNAVAILABLE = 'Address search is unavailable right now. Click the map where the job is instead.'

/** The hits in a /api/geocode reply, with anything unusable dropped and repeats of one spot kept once. */
export function hitsOf(body: unknown): GeocodeHit[] {
  const results = (body as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) return []
  const seen = new Set<string>()
  const out: GeocodeHit[] = []
  for (const r of results as Array<Partial<Record<keyof GeocodeHit, unknown>>>) {
    const label = typeof r?.label === 'string' ? r.label.trim() : ''
    const lat = Number(r?.lat)
    const lng = Number(r?.lng)
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ label, lat, lng })
  }
  return out
}

/**
 * A hit's label in two parts for a list: the place ("1 Moseley Square") and
 * where it is ("Glenelg, Adelaide, City of Holdfast Bay, South Australia,
 * 5045"). Nominatim puts a house number in a part of its own; it goes back
 * in front of its street. The country is dropped: every hit is Australian.
 */
export function splitLabel(label: string): { head: string; rest: string } {
  const parts = label
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length > 1 && /^australia$/i.test(parts[parts.length - 1])) parts.pop()
  const numbered = parts.length > 1 && /^\d+[a-z]?(?:[-/]\d+[a-z]?)?$/i.test(parts[0])
  const headCount = numbered ? 2 : 1
  return { head: parts.slice(0, headCount).join(' '), rest: parts.slice(headCount).join(', ') }
}

/** The cache key: case and spacing do not make a different address. */
const keyOf = (q: string) => q.trim().replace(/\s+/g, ' ').toLowerCase()

/** Addresses looked up in this tab, newest last. The server caches for a day as well. */
const answered = new Map<string, GeocodeHit[]>()
const REMEMBER = 30

/** What this tab already knows for `q`, or undefined. */
export const rememberedHits = (q: string): GeocodeHit[] | undefined => answered.get(keyOf(q))

/**
 * Look an address up. Resolves to the hits (possibly none), or throws a
 * GeocodeError saying what to do instead. One GET, with the signed-in
 * person's token: the endpoint refuses anyone not on a crew.
 */
export async function geocode(q: string, { signal }: { signal?: AbortSignal } = {}): Promise<GeocodeHit[]> {
  const query = q.trim().replace(/\s+/g, ' ')
  if (query.length < GEOCODE_MIN_CHARS) throw new GeocodeError(`Type at least ${GEOCODE_MIN_CHARS} characters of the address, then search.`)
  const known = rememberedHits(query)
  if (known) return known

  const { data } = await supabase().auth.getSession()
  const token = data.session?.access_token
  let res: Response
  try {
    res = await fetch(`${api('/api/geocode')}?q=${encodeURIComponent(query)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new GeocodeError(UNAVAILABLE)
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (res.status === 401) throw new GeocodeError('Your sign-in has run out. Sign in again to search for addresses.')
  if (!res.ok) throw new GeocodeError(res.status === 400 && body?.error ? `${body.error}.` : UNAVAILABLE)

  const hits = hitsOf(body)
  answered.delete(keyOf(query))
  answered.set(keyOf(query), hits)
  while (answered.size > REMEMBER) answered.delete(answered.keys().next().value as string)
  return hits
}

/** The address search behind a map: one in flight at most, its hits, and what to say when there are none. */
export interface AddressSearch {
  /** The address the hits are for. */
  query: string
  /** Null before a search, or once the list has been closed. */
  hits: GeocodeHit[] | null
  busy: boolean
  /** Why there is nothing to pick: too short, no match, or the search failed. */
  note: string | null
  /** Goes up by one with every answer, so a map can frame a new set of hits once. */
  answer: number
  search: (q: string) => void
  /** Close the list (a hit was picked, or it was dismissed). */
  dismiss: () => void
}

export function useAddressSearch(): AddressSearch {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<GeocodeHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [answer, setAnswer] = useState(0)
  // A ref, not the state: two Enters in one frame both see busy=false.
  const inFlight = useRef<AbortController | null>(null)

  // Leaving the page abandons a search on its way, so its answer cannot land on the next one.
  useEffect(() => () => inFlight.current?.abort(), [])

  const search = useCallback((q: string) => {
    if (inFlight.current) return
    const text = q.trim().replace(/\s+/g, ' ')
    setQuery(text)
    if (text.length < GEOCODE_MIN_CHARS) {
      setHits(null)
      setNote(`Type at least ${GEOCODE_MIN_CHARS} characters of the address, then search.`)
      return
    }
    const ctrl = new AbortController()
    inFlight.current = ctrl
    setBusy(true)
    setNote(null)
    setHits(null)
    geocode(text, { signal: ctrl.signal })
      .then((found) => {
        if (ctrl.signal.aborted) return
        setHits(found.length ? found : null)
        setNote(found.length ? null : 'No match. A brand-new estate is often not on the map yet: find the spot on the map and click it.')
        setAnswer((n) => n + 1)
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setHits(null)
        setNote(e instanceof GeocodeError ? e.message : UNAVAILABLE)
      })
      .finally(() => {
        if (inFlight.current === ctrl) inFlight.current = null
        if (!ctrl.signal.aborted) setBusy(false)
      })
  }, [])

  const dismiss = useCallback(() => setHits(null), [])

  return { query, hits, busy, note, answer, search, dismiss }
}
