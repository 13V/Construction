/**
 * What the Money tab is drawn with: the phone's dark summary card at a
 * desk's width, its claim band, each of its five rows as a table with every
 * line showing, and the contract's terms. Everything they say comes from
 * data/money.ts, worked out the phone's way; nothing here does sums.
 */
import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { banParts, contractFacts, money, openReceipt, type BanTone, type ContractCardRow, type MoneyFigures, type MoneyLine, type MoneySection, type MoneyState, type SectionKey, type Tone } from '../../data/money'
import { linkProps } from '../../router'
import { useToast } from '../../shell/Toast'
import { color, radius, shadow, space, text } from '../../tokens'
import { Table, type Column } from '../../ui/Table'
import { useWidth } from './useMoney'

// ------------------------------------------------------------------ the summary

/**
 * The phone's on-dark colours for the margin (Job.tsx marginFg): green from
 * 15%, amber from 8%, red under that, grey for a dash.
 */
const ON_DARK: Record<Tone | 'none', string> = { g: '#4CC38A', a: '#E9A23B', r: '#F2777C', none: '#8A929B' }

/** The phone's charcoal card (Job.tsx's "dark summary card"). */
const DARK_CARD: CSSProperties = {
  background: 'linear-gradient(#23272C,#15181C)',
  borderRadius: radius.lg,
  boxShadow: '0 8px 20px rgba(16,20,24,.18), 0 1px 0 rgba(255,255,255,.06) inset',
}
const DARK_RULE = 'rgba(255,255,255,.13)'

interface Figure {
  key: 'value' | 'margin' | 'done' | 'claimed'
  label: string
  value: string
  fg?: string
  sub: string
}

/** "On $22,000 of work done, $5,002 spent so far", or why there is no margin yet. */
function marginSub(f: MoneyFigures, donePct: number | null): string {
  if (f.earned !== null && f.earned > 0) return `On ${money(f.earned)} of work done, ${money(f.totalCost)} spent so far`
  if (donePct === null) return 'Needs the work measured on site'
  return 'Nothing done yet to measure against'
}

/**
 * Contract value, margin at today, how much is done and how much claimed:
 * four across at a desk, two by two in a narrower window, one under another
 * on a phone-width one.
 */
export function Summary({ figures: f, state }: { figures: MoneyFigures; state: MoneyState }) {
  const [box, width] = useWidth<HTMLElement>()
  const cols = width === null || width >= 760 ? 4 : width >= 300 ? 2 : 1
  const tight = width !== null && width < 520
  const claimed = f.sections.find((s) => s.key === 'claimed')!
  const approved = Number(state.row?.approved_variations ?? 0)
  const figures: Figure[] = [
    { key: 'value', label: 'Contract value', value: money(state.row?.job_value_ex), sub: approved !== 0 ? 'Ex GST, with the approved variations' : 'Ex GST' },
    {
      key: 'margin',
      label: 'Margin at today',
      value: f.marginPct === null ? '—' : `${f.marginPct.toFixed(1)}%`,
      fg: ON_DARK[f.marginTone ?? 'none'],
      sub: marginSub(f, state.donePct),
    },
    {
      key: 'done',
      label: 'Done',
      value: state.donePct === null ? '—' : `${Math.round(state.donePct)}%`,
      sub: state.donePct === null ? 'Not measured yet' : 'As measured on site',
    },
    { key: 'claimed', label: 'Claimed', value: claimed.v, sub: claimed.note.charAt(0).toUpperCase() + claimed.note.slice(1) },
  ]
  return (
    <section ref={box} aria-label="The job in figures" data-money-summary="" style={{ ...DARK_CARD, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {figures.map((x, i) => (
        <div
          key={x.key}
          data-money-figure={x.key}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            minWidth: 0,
            padding: tight ? `${space.sm + 2}px ${space.sm + 2}px ${space.md}px` : `${space.md}px ${space.lg - 4}px ${space.md + 2}px`,
            borderLeft: i % cols === 0 ? undefined : `1px solid ${DARK_RULE}`,
            borderTop: i < cols ? undefined : `1px solid ${DARK_RULE}`,
          }}
        >
          <span style={{ fontSize: 10.5, lineHeight: '14px', fontWeight: 700, letterSpacing: '.13em', textTransform: 'uppercase', color: color.onDarkMuted }}>{x.label}</span>
          <span data-money-figure-value="" style={{ fontSize: tight ? 22 : 26, lineHeight: 1, fontWeight: 600, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums', color: x.fg ?? color.onDark }}>
            {x.value}
          </span>
          <span style={{ ...text.xs, color: color.onDarkMuted }}>{x.sub}</span>
        </div>
      ))}
    </section>
  )
}

// ------------------------------------------------------------------ the claim band

/** The phone's band colours (Job.tsx M_CHIP), in the website's tokens. */
const BAND: Record<BanTone, { bg: string; fg: string; edge: string }> = {
  r: { bg: color.redFill, fg: color.red, edge: color.redEdge },
  a: { bg: color.amberFill, fg: color.amber, edge: color.amberEdge },
  g: { bg: color.greenFill, fg: color.green, edge: color.greenEdge },
  n: { bg: color.fill, fg: color.body, edge: color.borderSoft },
}

/** Held, nothing claimed yet, ahead, in line or behind: the phone's words, its capitals as the heading. */
export function ClaimBand({ ban }: { ban: { text: string; tone: BanTone } }) {
  const { lead, rest } = banParts(ban.text)
  const t = BAND[ban.tone]
  return (
    <div role="status" data-money-ban={ban.tone} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: `${space.sm}px ${space.md}px`, background: t.bg, color: t.fg, border: `1px solid ${t.edge}`, borderRadius: radius.md }}>
      {lead && <span style={{ ...text.label, fontSize: 11.5 }}>{lead}</span>}
      <span style={{ ...text.base }}>{rest}</span>
    </div>
  )
}

// ------------------------------------------------------------------ the five rows

/** The column headings for each row's lines. */
const HEADS: Record<SectionKey, [string, string]> = {
  claimed: ['Claim', 'Ex GST'],
  wages: ['Who', 'Cost'],
  tiles: ['Order', 'Cost'],
  mats: ['Line', 'Cost'],
  vars: ['Variation', 'Amount'],
}

const TONE_FG: Record<Tone, string> = { r: color.red, a: color.amber, g: color.green }

type Row = MoneyLine & { i: number }

/** One of the phone's five rows: its name, note and total, then every line it opens to, as a table. */
export function SectionTable({ section: s }: { section: MoneySection }) {
  const id = useId()
  const toast = useToast()
  const [opening, setOpening] = useState<string | null>(null)
  const open = async (path: string) => {
    setOpening(path)
    try {
      if (!(await openReceipt(path))) toast('Could not open that file. Try again in a moment.', { tone: 'error' })
    } finally {
      setOpening(null)
    }
  }
  const [k, v] = HEADS[s.key]
  const columns: Column<Row>[] = [
    {
      key: 'k',
      header: k,
      render: (l) => (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, padding: `${space.xs - 2}px 0` }}>
          <span data-line-k="" style={{ ...text.base, color: color.ink, overflowWrap: 'anywhere' }}>
            {l.k}
          </span>
          {(l.detail || l.receiptPath) && (
            <span style={{ ...text.xs, color: color.muted, overflowWrap: 'anywhere' }}>
              {l.detail}
              {l.detail && l.receiptPath && ' · '}
              {l.receiptPath && (
                <button type="button" className="wb-link wb-link--button" data-open-file="" disabled={opening === l.receiptPath} onClick={() => void open(l.receiptPath!)} style={{ fontSize: 12 }}>
                  {opening === l.receiptPath ? 'Opening…' : 'Open file'}
                </button>
              )}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'v',
      header: v,
      width: 124,
      align: 'right',
      render: (l) => (
        <span data-line-v="" style={{ ...text.base, fontWeight: 600, color: color.ink, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {l.v}
        </span>
      ),
    },
  ]
  const fg = s.tone ? TONE_FG[s.tone] : undefined
  return (
    <section aria-labelledby={id} data-money-section={s.key} style={{ display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, padding: '0 2px' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space.sm, rowGap: 0 }}>
          <h3 id={id} style={{ margin: 0, ...text.md, fontWeight: 600, color: color.ink }}>
            {s.k}
          </h3>
          <span data-money-note="" style={{ ...text.sm, color: fg ?? color.muted }}>
            {s.note}
          </span>
        </div>
        <span data-money-total="" style={{ flex: 'none', ...text.md, fontWeight: 600, color: fg ?? color.ink, fontVariantNumeric: 'tabular-nums' }}>
          {s.v}
        </span>
      </div>
      <Table<Row> label={s.k} columns={columns} rows={s.lines.map((l, i) => ({ ...l, i }))} rowKey={(l) => String(l.i)} rowHeight={44} empty={s.empty} />
    </section>
  )
}

// ------------------------------------------------------------------ the contract

const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  padding: `${space.md}px ${space.lg}px ${space.sm}px`,
  background: color.panel,
  border: `1px solid ${color.borderSoft}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
}

/**
 * The contract's terms, read straight from its row: the sum and its GST
 * basis, the builder's numbers, retention, payment terms and the dates that
 * are set. Read-only: they are set on Edit job, where the rest of the job is.
 */
export function ContractCard({ contract, approvedVariations, editHref }: { contract: ContractCardRow; approvedVariations: number | null; editHref: string }) {
  const [box, width] = useWidth<HTMLElement>()
  // Beside the tables the card is one column; stacked under them it has room for two.
  const two = width !== null && width >= 440
  return (
    <aside ref={box} aria-labelledby="wb-money-contract" data-money-contract="" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xs, minHeight: 28, marginBottom: space.xs }}>
        <h3 id="wb-money-contract" style={{ margin: 0, ...text.label, color: color.muted }}>
          Contract
        </h3>
        <a {...linkProps(editHref)} className="wb-link" data-money-edit="" style={{ ...text.sm }}>
          Change on Edit job
        </a>
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: two ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', columnGap: space.lg }}>
        {contractFacts(contract, approvedVariations).map((f) => (
          <Fact key={f.key} fact={f.key} label={f.label}>
            {f.value ?? <span style={{ color: color.faint }}>Not set</span>}
          </Fact>
        ))}
      </dl>
    </aside>
  )
}

function Fact({ fact, label, children }: { fact: string; label: string; children: ReactNode }) {
  return (
    <div data-fact={fact} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: `${space.sm}px 0`, borderTop: `1px solid ${color.borderSoft}` }}>
      <dt style={{ ...text.xs, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: color.muted }}>{label}</dt>
      <dd style={{ margin: 0, ...text.base, color: color.ink, overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  )
}
