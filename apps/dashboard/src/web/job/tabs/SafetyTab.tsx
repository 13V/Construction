/**
 * The job's Safety tab: the four shelves a builder asks for, with the crew's
 * own screen beside them.
 *
 * Left, a desktop summary by the phone's own rules (useSafety, shelfState,
 * docState): Toolbox, SWMS, SDS and Company policy, each with its state and
 * what is on it, and every document one click from opening. Right, the
 * phone's SafetyTab, mounted unchanged in the same 440 px host as the
 * Waterproofing tab's panel (PanelBeside): uploads, removals, issuing a SWMS
 * and editing its template behave exactly as on the phone, and their sheets
 * open inside the host.
 *
 * A document with no job is the company's (a policy is filed once and shows
 * on every job), so it shows here too, marked company-wide.
 */
import { useState, type CSSProperties } from 'react'
import { docState, SafetyTab as PhoneSafetyTab, SHELVES, shelfState, useSafety, type DocState, type SafetyDoc, type ShelfKind } from '../../phone-features'
import { BUCKET_FILES, signedUrl, supabase, viewFile, type WorkerRow } from '../../phone'
import { color, radius, shadow, space, text } from '../../tokens'
import { Button } from '../../ui/Button'
import { Chip, type ChipTone } from '../../ui/Chip'
import type { JobTabProps } from '../types'
import { PanelBeside, ReadFailed, type Recount, type SummaryView } from './WaterproofingTab'

export default function SafetyTab({ me, site }: JobTabProps) {
  const sf = useSafety(site)

  return (
    <PanelBeside
      label="Safety, as the crew see it"
      live={sf.loading ? null : sf}
      reload={sf.reload}
      print={sfPrint}
      recheck={(read, trusted) => sfRecheck(site.id, read, trusted)}
      summary={(view) => <SafetySummary me={me} view={view} />}
      panel={<PhoneSafetyTab me={me} site={site} />}
    />
  )
}

type Sf = ReturnType<typeof useSafety>

/**
 * What the summary draws from, so the frame can tell a re-read that found
 * something new (see PanelBeside). Templates count: issuing needs one.
 */
const sfPrint = (sf: Sf) =>
  JSON.stringify([sf.docs.map((d) => [d.id, d.updated_at, d.expires_on, d.sent_at]), sf.templates.map((t) => [t.id, t.updated_at])])

const filed = (sf: Sf) => sf.docs.length + sf.templates.length

/**
 * What to ask again before a read is believed (see PanelBeside). useSafety
 * reads every document the job can see in one query, so a failure empties
 * all of them at once, the company-wide policy included; and the crew, who
 * are never none (whoever is signed in is one of them).
 */
function sfRecheck(siteId: string, read: Sf, trusted: Sf | null): Recount[] {
  const asks: Recount[] = []
  if (filed(read) === 0 && (!trusted || filed(trusted) > 0)) {
    // The rows useSafety keeps: every template, and the documents of this job or of none.
    asks.push(() =>
      supabase()
        .from('safety_documents')
        .select('id', { count: 'exact', head: true })
        .eq('active', true)
        .or(`is_template.eq.true,site_id.is.null,site_id.eq.${siteId}`),
    )
  }
  if (read.people.size === 0 && (!trusted || trusted.people.size > 0)) {
    asks.push(() => supabase().from('crew_v').select('id', { count: 'exact', head: true }))
  }
  return asks
}

/** The phone's words for a shelf (its STATE_CHIP), in the website's chip tones. */
const SHELF_CHIP: Record<DocState | 'none', { label: string; tone: ChipTone }> = {
  current: { label: 'Current', tone: 'green' },
  expiring: { label: 'Expiring', tone: 'amber' },
  overdue: { label: 'Overdue', tone: 'red' },
  none: { label: 'Not required', tone: 'neutral' },
}

/** The phone's counter card, in its order and words. Documents are counted, except the last, which counts empty shelves. */
const COUNTS: Array<{ key: keyof Sf['counts']; label: string; sub: string; fg: string }> = [
  { key: 'current', label: 'Current', sub: 'Up to date', fg: color.green },
  { key: 'expiring', label: 'Expiring', sub: 'In 30 days', fg: color.amber },
  { key: 'overdue', label: 'Overdue', sub: 'Action required', fg: color.red },
  { key: 'notRequired', label: 'Not required', sub: 'For this job', fg: color.muted },
]
/**
 * The counters go four across, or two by two: two pairs that wrap as pairs,
 * never three and one. A pair needs room for two counters of about 100 px,
 * the width "Not required" and "Expiring" take with their padding.
 */
const PAIRS = [COUNTS.slice(0, 2), COUNTS.slice(2)]
const PAIR_MIN = 2 * 100 + space.sm

const day = (v: string | null) =>
  v ? new Date(v.length > 10 ? v : `${v}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const card: CSSProperties = {
  background: color.panel,
  border: `1px solid ${color.borderSoft}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
  overflow: 'hidden',
}
const heading: CSSProperties = { margin: 0, ...text.label, color: color.muted }

function SafetySummary({ me, view }: { me: WorkerRow; view: SummaryView<Sf> }) {
  const sf = view.data
  const counts = sf?.counts
  const status = !sf
    ? view.failed
      ? null
      : 'Loading…'
    : sf.counts.overdue
      ? `${plural(sf.counts.overdue, 'document')} past ${sf.counts.overdue === 1 ? 'its' : 'their'} review date. Replace ${sf.counts.overdue === 1 ? 'it' : 'them'} in the panel.`
      : sf.counts.expiring
        ? `${plural(sf.counts.expiring, 'document')} due for review within 30 days.`
        : sf.docs.length === 0
          ? 'Nothing filed for this job yet.'
          : 'Everything on file is current.'

  return (
    <div data-safety-summary="" style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <ReadFailed view={view} what="the safety paperwork" />

      <section aria-label="Safety paperwork" style={{ ...card, padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.md }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={heading}>Safety paperwork</h2>
          {status && <p style={{ margin: 0, ...text.base, color: color.body }}>{status}</p>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm }}>
          {PAIRS.map((pair, i) => (
            <div key={i} style={{ flex: `1 1 ${PAIR_MIN}px`, minWidth: 0, display: 'flex', gap: space.sm }}>
              {pair.map((c) => (
                <div
                  key={c.key}
                  data-count={c.key}
                  style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: `${space.sm}px ${space.md}px`, background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.md }}
                >
                  <span style={{ ...text.display, color: color.ink }}>{counts ? counts[c.key] : '–'}</span>
                  <span style={{ ...text.sm, fontWeight: 700, color: c.fg }}>{c.label}</span>
                  <span style={{ ...text.xs, color: color.muted }}>{c.sub}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Safety documents" style={card}>
        <h2 style={{ ...heading, padding: `${space.md}px ${space.lg}px ${space.xs}px` }}>The four shelves</h2>
        {SHELVES.map((sh) => (
          <Shelf
            key={sh.kind}
            kind={sh.kind}
            title={sh.title}
            detail={sh.detail}
            sf={sf}
            me={me}
          />
        ))}
      </section>

      <p style={{ margin: 0, ...text.sm, color: color.muted }}>
        Documents are added, removed and issued on the crew’s own screen, under “Same screens as the crew app”. What is
        filed there is what the crew see on site.
      </p>
    </div>
  )
}

/** One shelf. With no read yet (`sf` null) only its name is drawn. */
function Shelf({ kind, title, detail, sf, me }: { kind: ShelfKind; title: string; detail: string; sf: Sf | null; me: WorkerRow }) {
  const docs = sf ? sf.byKind(kind) : []
  const state = shelfState(docs)
  const chip = SHELF_CHIP[state]
  // An expiring shelf says how long its soonest document has, as the phone's does.
  const soonest = docs
    .map((d) => docState(d).days)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)[0]
  const label = state === 'expiring' && soonest !== undefined ? `${chip.label} · ${plural(soonest, 'day')}` : chip.label
  const hasTemplate = Boolean(sf?.templates.some((t) => t.kind === kind))

  const empty =
    kind === 'swms'
      ? hasTemplate
        ? 'None issued for this job. To issue one, open Safe work method statement on the crew’s screen.'
        : 'None issued, and there is no SWMS template yet. Set it up first (Safe work method statement on the crew’s screen): every job’s SWMS is issued from it.'
      : kind === 'policy'
        ? 'No company policy filed. One copy, filed once, shows on every job.'
        : 'Nothing on this shelf for this job.'

  return (
    <div data-shelf={kind} data-state={sf ? state : undefined} style={{ padding: `${space.sm}px ${space.lg}px ${space.md}px`, borderTop: `1px solid ${color.borderSoft}` }}>
      {/* The chip drops under the name in a narrow column, rather than
          squeezing it. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: space.sm, rowGap: space.xxs }}>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <h3 style={{ margin: 0, ...text.base, fontWeight: 600, color: color.ink }}>{title}</h3>
          <div style={{ ...text.sm, color: color.muted }}>{detail}</div>
        </div>
        {sf && (
          <Chip size="sm" tone={chip.tone}>
            {label}
          </Chip>
        )}
      </div>
      {sf &&
        (docs.length === 0 ? (
          <p style={{ margin: `${space.xs}px 0 0`, ...text.sm, color: color.muted }}>{empty}</p>
        ) : (
          <ul style={{ margin: `${space.xs}px 0 0`, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: space.xs }}>
            {docs.map((d) => (
              <DocLine key={d.id} doc={d} me={me} people={sf.people} />
            ))}
          </ul>
        ))}
    </div>
  )
}

/** One document: what it is, who put it up, when it is due, and a way to open it. */
function DocLine({ doc, me, people }: { doc: SafetyDoc; me: WorkerRow; people: Map<string, string> }) {
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)
  const { state, days } = docState(doc)
  const who = doc.updated_by === me.id ? 'You' : doc.updated_by ? (people.get(doc.updated_by) ?? 'the office') : null
  const ext = (doc.file_name?.split('.').pop() ?? 'doc').slice(0, 4).toUpperCase()
  const meta = [
    doc.reference,
    `Updated ${day(doc.updated_at)}${who ? ` · ${who}` : ''}`,
    doc.site_id === null ? 'Company-wide' : null,
    doc.sent_at ? `Sent ${day(doc.sent_at)}` : null,
  ].filter(Boolean)

  async function open(path: string) {
    setOpening(true)
    setFailed(false)
    const url = await signedUrl(BUCKET_FILES, path)
    setOpening(false)
    if (url) viewFile({ url, name: doc.file_name ?? doc.title })
    else setFailed(true)
  }

  return (
    <li
      data-doc={doc.id}
      // Wraps in a narrow column: Open goes to its own line, at the right,
      // and the words keep the width. The title wraps too, never cut short:
      // the name is how the office tells one policy or SDS from another.
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm, rowGap: space.xxs, padding: `${space.xs}px ${space.sm}px`, background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.md }}
    >
      <span
        aria-hidden="true"
        style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: radius.sm, background: color.fill, fontSize: 10, fontWeight: 800, letterSpacing: '.03em', color: color.body }}
      >
        {ext}
      </span>
      <div style={{ flex: '1 1 140px', minWidth: 0 }}>
        <div data-doc-title="" style={{ ...text.base, fontWeight: 600, color: color.ink, overflowWrap: 'anywhere' }}>
          {doc.title}
        </div>
        <div style={{ ...text.xs, color: color.muted }}>{meta.join(' · ')}</div>
        {doc.expires_on && (
          <div style={{ ...text.xs, fontWeight: state === 'current' ? 400 : 600, color: state === 'overdue' ? color.red : state === 'expiring' ? color.amber : color.muted }}>
            {state === 'overdue'
              ? `Review was due ${day(doc.expires_on)}`
              : `Review due ${day(doc.expires_on)}${state === 'expiring' && days !== null ? ` · ${plural(days, 'day')}` : ''}`}
          </div>
        )}
        {failed && <div style={{ ...text.xs, color: color.red }}>Could not open it. Try again in a moment.</div>}
      </div>
      {doc.storage_path && (
        <Button size="sm" variant="ghost" loading={opening} onClick={() => void open(doc.storage_path!)} aria-label={`Open ${doc.title}`} style={{ marginLeft: 'auto' }}>
          Open
        </Button>
      )}
    </li>
  )
}
