/**
 * Needs attention: the right-hand panel on the jobs board. Every open
 * defect (by job and location), every overdue or failed flood test, and
 * every variation waiting on the builder, newest first, each a link to the
 * tab of the job that deals with it.
 *
 * It is the phone's NOTIFICATIONS card (Projects.tsx) at a desk: the same
 * four reads, the same grouping, the same words, so the office and a
 * captain's phone never disagree about what is outstanding. Like the phone,
 * it says nothing about archived jobs: a finished job's leftovers are not
 * today's work, and the phone has already stopped showing them.
 *
 * Nothing here is stored. It is read again when the window comes back into
 * focus and every minute while the board is visible (useFresh), like the
 * board itself; a defect closed on site shows as gone the next time anyone
 * looks.
 *
 * Where each item goes is the board's attention chip's rule (contract.ts
 * chipOf): a flood test to the job's Waterproofing tab, which deals with
 * it; a defect or a variation to the job's Overview. No website page lists
 * defects or variations, so those two items say under the job where their
 * details are (ATTENTION_DETAILS: not on the website for a defect, the
 * phone's Money tab for a variation), and their tooltip that the link opens
 * the job. Nobody clicks expecting the defect and lands on a page that is
 * silent about it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { allRows } from '../data/bookings'
import { chipOf, type AttentionKind } from '../data/contract'
import { useFresh } from '../data/useFresh'
import { addressLine, supabase, type JobSiteRow } from '../phone'
import { linkProps, paths, type JobTab } from '../router'
import { color, radius, shadow, space, text } from '../tokens'
import { ATTENTION_DETAILS } from './JobsTable'

/** Where each kind of item is dealt with: the same tab the board's chip opens. */
const TAB_OF: Record<AttentionKind, JobTab> = {
  flood: chipOf({ defects: 0, flood: 1, variations: 0 })!.tab,
  defects: chipOf({ defects: 1, flood: 0, variations: 0 })!.tab,
  variations: chipOf({ defects: 0, flood: 0, variations: 1 })!.tab,
}

/** How many items show before "Show n more". */
const SHOWN = 6

/** The phone's amber notification dot (Projects.tsx); the red one is tokens' redOnDark. */
const AMBER_DOT = '#E9A23B'

interface AttentionItem {
  key: string
  kind: AttentionKind
  text: string
  site: JobSiteRow
  /** When it happened, for the order and the "· 3 Oct" after the job. */
  at: string
  /** Red for what stops work or costs a rebuild, amber for money waiting. */
  tone: 'red' | 'amber'
  tab: JobTab
}

interface Rows {
  defects: Array<{ site_id: string; location: string | null; created_at: string }>
  /** The per-wet-area register: covered (complete or signed off) and never flood tested. */
  overdue: Array<{ site_id: string; area: string; flood_test_on: string | null }>
  /** The six-step certificate's flood test, recorded as failed. */
  failed: Array<{ site_id: string; unit: string | null; flood_test_on: string | null }>
  variations: Array<{ id: string; site_id: string | null; cost_impact: number | null; raised_on: string }>
}

const money0 = (v: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v)

/** The phone's whenLabel (Projects.tsx): a time for today, else the day. A bare date has no clock to show. */
function whenLabel(iso: string, now = new Date()): string {
  if (!iso.includes('T')) {
    const d = new Date(`${iso}T12:00:00`)
    const today = now.toLocaleDateString('en-CA')
    return iso === today ? 'Today' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  }
  const d = new Date(iso)
  const t0 = new Date(now)
  t0.setHours(0, 0, 0, 0)
  if (d.getTime() >= t0.getTime()) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
}

/**
 * The items, from the four reads, for the jobs given (archived ones are
 * skipped). Pure, so the words and the grouping can be checked against the
 * phone's without a database.
 */
function attentionItems(rows: Rows, sites: JobSiteRow[], now = new Date()): AttentionItem[] {
  const byId = new Map(sites.filter((x) => x.status !== 'archived').map((x) => [x.id, x]))
  const out: AttentionItem[] = []

  // Defects, grouped the way they were raised: per job and location.
  const grouped = new Map<string, { site: JobSiteRow; location: string; n: number; at: string }>()
  for (const d of rows.defects) {
    const site = byId.get(d.site_id)
    if (!site) continue
    const key = `${d.site_id}|${d.location ?? ''}`
    const g = grouped.get(key)
    if (g) {
      g.n++
      if (d.created_at > g.at) g.at = d.created_at
    } else grouped.set(key, { site, location: d.location || 'site', n: 1, at: d.created_at })
  }
  for (const [key, g] of grouped) {
    out.push({ key: `d|${key}`, kind: 'defects', text: `${g.n} defect${g.n === 1 ? '' : 's'} logged on ${g.location}`, site: g.site, at: g.at, tone: 'red', tab: TAB_OF.defects })
  }

  const stamp = now.toISOString()
  for (const w of rows.overdue) {
    const site = byId.get(w.site_id)
    if (!site) continue
    out.push({ key: `w|${w.site_id}|${w.area}`, kind: 'flood', text: `Flood test on ${w.area} is overdue`, site, at: w.flood_test_on ?? stamp, tone: 'red', tab: TAB_OF.flood })
  }
  for (const w of rows.failed) {
    const site = byId.get(w.site_id)
    if (!site) continue
    out.push({
      key: `wf|${w.site_id}|${w.unit ?? ''}`,
      kind: 'flood',
      text: w.unit ? `Flood test failed on ${w.unit}` : 'Flood test failed',
      site,
      at: w.flood_test_on ?? stamp,
      tone: 'red',
      tab: TAB_OF.flood,
    })
  }

  for (const v of rows.variations) {
    const site = v.site_id ? byId.get(v.site_id) : undefined
    if (!site) continue
    // Read from change_orders, which only the office can, so there is a figure to lead with.
    const text = v.cost_impact === null ? 'A variation is waiting on the builder' : `${money0(Number(v.cost_impact))} variation waiting on the builder`
    out.push({ key: `v|${v.id}`, kind: 'variations', text, site, at: v.raised_on, tone: 'amber', tab: TAB_OF.variations })
  }

  out.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : a.key.localeCompare(b.key)))
  return out
}

/** The four reads, a page at a time, so a company with a long defect list still sees all of it. */
async function loadRows(): Promise<Rows> {
  const c = supabase()
  const [defects, overdue, failed, variations] = await Promise.all([
    allRows<Rows['defects'][number]>((a, b) => c.from('defects').select('site_id, location, created_at').in('status', ['open', 'in_progress']).order('id').range(a, b)),
    allRows<Rows['overdue'][number]>((a, b) =>
      c.from('waterproofing').select('site_id, area, flood_test_on').in('status', ['complete', 'signed_off']).eq('flood_tested', false).order('id').range(a, b),
    ),
    allRows<Rows['failed'][number]>((a, b) => c.from('waterproofing_packages').select('site_id, unit, flood_test_on').eq('flood_test_result', 'fail').order('id').range(a, b)),
    // change_orders is the office's; the website is the office's, so the
    // figure is there. If it cannot be read (a role this page should never
    // see), site_variations_v is the same pending list without the money.
    allRows<Rows['variations'][number]>((a, b) =>
      c.from('change_orders').select('id, site_id, cost_impact, raised_on').eq('status', 'pending_client').order('id').range(a, b),
    ).catch(() =>
      allRows<Omit<Rows['variations'][number], 'cost_impact'>>((a, b) =>
        c.from('site_variations_v').select('id, site_id, raised_on').eq('status', 'pending_client').order('id').range(a, b),
      ).then((rows) => rows.map((r) => ({ ...r, cost_impact: null }))),
    ),
  ])
  return { defects, overdue, failed, variations }
}

/** The panel's rows, refreshed with the page. A newer read always wins over an older one still on its way. */
function useAttention() {
  const [rows, setRows] = useState<Rows | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadRows().then(
      (got) => {
        if (cancelled) return
        setRows(got)
        setError(null)
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  useFresh(reload)
  return { rows, error, reload }
}

export function AttentionPanel({ sites }: { sites: JobSiteRow[] }) {
  const { rows, error, reload } = useAttention()
  const [all, setAll] = useState(false)
  const items = useMemo(() => (rows ? attentionItems(rows, sites) : []), [rows, sites])
  const shown = all ? items : items.slice(0, SHOWN)

  return (
    <section
      aria-labelledby="wb-attention-title"
      data-attention-panel=""
      style={{ background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg, boxShadow: shadow.card, overflow: 'hidden' }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xs, padding: `${space.sm}px ${space.md}px` }}>
        <h2 id="wb-attention-title" style={{ margin: 0, ...text.label, color: color.muted }}>
          Needs attention
        </h2>
        {items.length > 0 && (
          <span
            data-attention-count={items.length}
            style={{ display: 'inline-flex', alignItems: 'center', height: 21, padding: '0 8px', borderRadius: 11, background: color.redFill, fontSize: 11.5, fontWeight: 700, color: color.red }}
          >
            {items.length}
          </span>
        )}
      </header>

      {error && !rows && (
        <div role="alert" style={{ padding: `0 ${space.md}px ${space.md}px`, ...text.sm, color: color.red }}>
          Could not check for defects, flood tests and variations. {error}{' '}
          <button type="button" className="wb-link wb-link--button" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {!rows && !error && <div style={{ padding: `0 ${space.md}px ${space.md}px`, ...text.sm, color: color.faint }}>Checking…</div>}
      {rows && items.length === 0 && (
        <div data-attention-empty="" style={{ padding: `0 ${space.md}px ${space.md}px`, ...text.sm, color: color.muted }}>
          Nothing needs you right now. Open defects, held flood tests and variations waiting on a builder land here.
        </div>
      )}

      {shown.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', borderTop: `1px solid ${color.borderSoft}` }}>
          {shown.map((n, i) => (
            <li key={n.key} style={{ borderTop: i === 0 ? undefined : `1px solid ${color.borderSoft}` }}>
              <Item item={n} />
            </li>
          ))}
        </ul>
      )}

      {items.length > SHOWN && (
        <button
          type="button"
          className="wb-btn wb-btn--ghost"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          style={{ display: 'flex', width: '100%', height: 40, borderRadius: 0, borderTop: `1px solid ${color.borderSoft}`, fontSize: 13 }}
        >
          {all ? 'Show less' : `Show ${items.length - SHOWN} more`}
        </button>
      )}
      {error && rows && (
        <div role="status" style={{ padding: `${space.xs}px ${space.md}px`, borderTop: `1px solid ${color.borderSoft}`, ...text.xs, color: color.muted }}>
          Could not refresh just now; this is what was there a moment ago.
        </div>
      )}
    </section>
  )
}

function Item({ item }: { item: AttentionItem }) {
  const title = addressLine(item.site) || item.site.name
  const href = paths.job(item.site.id, item.tab)
  const dot = item.tone === 'red' ? color.redOnDark : AMBER_DOT
  const halo = item.tone === 'red' ? 'rgba(229,72,77,.16)' : 'rgba(233,162,59,.18)'
  // A defect or a variation: its details are not on the page this opens, so say where they are.
  const elsewhere = ATTENTION_DETAILS[item.kind]
  return (
    <a
      {...linkProps(href)}
      className="wb-row wb-row--link wb-focus"
      data-attention-item={item.kind}
      data-site={item.site.id}
      data-tab={item.tab}
      title={elsewhere ? `${item.text}. ${elsewhere}: this opens the job.` : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: space.sm, minHeight: 56, padding: `10px ${space.md}px`, textDecoration: 'none', color: 'inherit', outlineOffset: -2 }}
    >
      <span aria-hidden="true" style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: dot, boxShadow: `0 0 0 4px ${halo}` }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...text.base, fontWeight: 600, color: color.ink }}>{item.text}</span>
        <span style={{ ...text.xs, color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title} · {whenLabel(item.at)}
        </span>
        {elsewhere && (
          <span data-attention-details="" style={{ ...text.xs, color: color.faint }}>
            {elsewhere}
          </span>
        )}
      </span>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ flex: 'none' }}>
        <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={color.ghost} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  )
}
