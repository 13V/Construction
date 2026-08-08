import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type CompanyOverviewRow, type JobProfitRow, type WorkerRow } from '../data/supabase'
import { fullDate, money } from '../format'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'
import { Empty, LABEL, ListRow, Note, Panel, PanelHead, SubTabs, TAB_PAD } from './kit'

/**
 * The state of the business, and what each job actually made.
 *
 * Every figure here comes out of company_overview_v and job_profit_v — one
 * definition, computed in Postgres. The alternative is what this app was doing
 * before: pulling every shift, material and expense down to the browser and
 * adding them up on two different screens, which is why one of those screens
 * carried a comment promising it would never disagree with the other.
 *
 * Both sides of every margin are ex GST. Collected GST is not revenue and paid
 * GST is an input credit; mixing the bases is a 10% error on a number that is
 * typically 15-25%, which is most of the answer.
 */

type Sort = 'margin' | 'value' | 'risk'

export function Overview({ me }: { me: WorkerRow; sites: JobSite[]; workers: Worker[]; onChanged: () => void }) {
  const [overview, setOverview] = useState<CompanyOverviewRow | null>(null)
  const [jobs, setJobs] = useState<JobProfitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('risk')

  const load = useCallback(async () => {
    setLoading(true)
    const c = supabase()
    const [o, j] = await Promise.all([
      c.from('company_overview_v').select('*').maybeSingle(),
      c.from('job_profit_v').select('*'),
    ])
    if (o.error ?? j.error) setError((o.error ?? j.error)?.message ?? null)
    else setError(null)
    setOverview((o.data as CompanyOverviewRow | null) ?? null)
    setJobs((j.data ?? []) as JobProfitRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sorted = useMemo(() => {
    const rows = jobs.slice()
    if (sort === 'value') return rows.sort((a, b) => Number(b.job_value_ex) - Number(a.job_value_ex))
    if (sort === 'margin') return rows.sort((a, b) => Number(a.margin_pct ?? 999) - Number(b.margin_pct ?? 999))
    // Risk first: the jobs where cost has run ahead of what has been claimed.
    // On a job running to plan this tracks progress; when it runs away it is
    // the earliest warning that work is going out faster than it is billed.
    return rows.sort((a, b) => Number(b.unbilled_cost) - Number(a.unbilled_cost))
  }, [jobs, sort])

  if (!me.is_office) {
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
        <Empty>Margins, invoices and contract sums are office-only. Your hours and jobs are on the other screens.</Empty>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.inkSoft, fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  const o = overview
  const withContract = jobs.filter((j) => j.contract_id)
  const noContract = jobs.length - withContract.length

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD, background: theme.appBg }}>
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: theme.alertFill, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12.5, color: theme.alertInk }}>
          {error}
        </div>
      )}

      {/* ---------------------------------------------------------- the money */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginBottom: 14 }}>
        <Tile
          label="WORK IN HAND"
          value={money(Number(o?.work_in_hand ?? 0))}
          note={`${withContract.length} job${withContract.length === 1 ? '' : 's'} under contract, ex GST`}
        />
        <Tile
          label="LEFT TO CLAIM"
          value={money(Number(o?.left_to_claim ?? 0))}
          note="inc GST, against what is approved"
        />
        <Tile
          label="OWED TO US"
          value={money(Number(o?.owed_to_us ?? 0))}
          note={
            Number(o?.overdue_invoices ?? 0) > 0
              ? `${o?.overdue_invoices} overdue — ${money(Number(o?.overdue_amount ?? 0))}`
              : 'nothing overdue'
          }
          tone={Number(o?.overdue_invoices ?? 0) > 0 ? 'alert' : undefined}
        />
        <Tile
          label="MARGIN TO DATE"
          value={money(Number(o?.margin_to_date ?? 0))}
          note="value less cost, both ex GST"
          tone={Number(o?.margin_to_date ?? 0) < 0 ? 'alert' : undefined}
        />
        <Tile
          label="RETENTION HELD"
          value={money(Number(o?.retention_held ?? 0))}
          note="released at practical completion"
        />
      </div>

      {/* ------------------------------------------------------- what needs doing */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 14 }}>
        <Tile label="ON THE CLOCK" value={String(o?.on_the_clock ?? 0)} note={`${o?.active_jobs ?? 0} jobs running`} small />
        <Tile
          label="VARIATIONS PENDING"
          value={String(o?.variations_pending ?? 0)}
          note={money(Number(o?.variations_pending_value ?? 0)) + ' not yet approved'}
          tone={Number(o?.variations_pending ?? 0) > 0 ? 'warn' : undefined}
          small
        />
        <Tile
          label="OPEN DEFECTS"
          value={String(o?.open_defects ?? 0)}
          note="between here and retention"
          tone={Number(o?.open_defects ?? 0) > 0 ? 'warn' : undefined}
          small
        />
        <Tile
          label="WET AREAS UNSIGNED"
          value={String(o?.waterproofing_outstanding ?? 0)}
          note="no certificate can issue"
          tone={Number(o?.waterproofing_outstanding ?? 0) > 0 ? 'warn' : undefined}
          small
        />
        <Tile
          label="TICKETS EXPIRING"
          value={String(o?.tickets_expiring ?? 0)}
          note="within 30 days"
          tone={Number(o?.tickets_expiring ?? 0) > 0 ? 'alert' : undefined}
          small
        />
      </div>

      {/* --------------------------------------------------------- per job */}
      <Panel>
        <PanelHead
          right={
            <SubTabs
              active={sort}
              onChange={setSort}
              tabs={[
                { key: 'risk', label: 'Unbilled first' },
                { key: 'margin', label: 'Worst margin' },
                { key: 'value', label: 'Biggest' },
              ]}
            />
          }
        >
          Job profitability
        </PanelHead>

        <ListRow columns="1.6fr 110px 110px 100px 110px 120px">
          <span style={head}>JOB</span>
          <span style={{ ...head, textAlign: 'right' }}>VALUE</span>
          <span style={{ ...head, textAlign: 'right' }}>COST</span>
          <span style={{ ...head, textAlign: 'right' }}>MARGIN</span>
          <span style={{ ...head, textAlign: 'right' }}>PER HOUR</span>
          <span style={{ ...head, textAlign: 'right' }}>CLAIMED</span>
        </ListRow>

        {sorted.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty>No jobs yet. Once a job has a contract on it, everything here fills in on its own.</Empty>
          </div>
        ) : (
          sorted.map((j) => {
            const pct = j.margin_pct === null ? null : Number(j.margin_pct)
            const marginFg = pct === null ? theme.inkFaint : pct < 0 ? theme.alert : pct < 15 ? theme.warnInk : theme.successInk
            return (
              <ListRow key={j.site_id} columns="1.6fr 110px 110px 100px 110px 120px">
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.site_name}
                  </span>
                  <span style={{ fontSize: 11, color: LABEL }}>
                    {j.contract_id === null
                      ? 'no contract entered'
                      : Number(j.approved_variations) !== 0
                        ? `${money(Number(j.contract_sum_ex))} + ${money(Number(j.approved_variations))} variations`
                        : `${money(Number(j.contract_sum_ex))} contract`}
                    {j.progress_pct !== null && ` · ${Number(j.progress_pct)}% done`}
                  </span>
                </span>
                <span style={num}>{money(Number(j.job_value_ex))}</span>
                <span style={num}>{money(Number(j.total_cost))}</span>
                <span style={{ ...num, color: marginFg, fontWeight: 700 }}>
                  {pct === null ? '—' : `${pct}%`}
                </span>
                <span style={num}>
                  {j.value_per_labour_hour === null ? '—' : money(Number(j.value_per_labour_hour))}
                </span>
                <span style={{ ...num, color: overclaimed(j) ? theme.alert : theme.ink }}>
                  {j.claimed_pct === null ? '—' : `${Number(j.claimed_pct)}%`}
                </span>
              </ListRow>
            )
          })
        )}

        {noContract > 0 && (
          <Note tone="warn">
            {noContract} job{noContract === 1 ? ' has' : 's have'} no contract entered, so {noContract === 1 ? 'its' : 'their'}{' '}
            value reads zero and the margin cannot be worked out. Enter the contract on the job's Contract tab.
          </Note>
        )}

        {sorted.some((j) => Number(j.unbilled_cost) > 0) && (
          <Note>
            "Unbilled first" is sorted by cost booked against work not yet claimed. On a job running to plan that just
            tracks progress. When it runs away from you it is the earliest warning that the crew is working faster than
            the office is billing — usually weeks before the bank account notices.
          </Note>
        )}
      </Panel>

      {jobs.some((j) => j.progress_assessed_on) && (
        <p style={{ margin: '12px 2px 0', fontSize: 11.5, color: LABEL }}>
          Progress last assessed{' '}
          {fullDate(
            jobs
              .map((j) => j.progress_assessed_on)
              .filter((d): d is string => Boolean(d))
              .sort()
              .at(-1) ?? '',
          )}
          . Labour is direct wages only — no super, leave or insurance, so a true cost of labour is roughly a third
          higher again.
        </p>
      )}
    </div>
  )
}

/** Claimed further through the job than the work is. The conversation a QS opens with. */
function overclaimed(j: JobProfitRow): boolean {
  return j.claimed_pct !== null && j.progress_pct !== null && Number(j.claimed_pct) - Number(j.progress_pct) > 10
}

function Tile({
  label,
  value,
  note,
  tone,
  small = false,
}: {
  label: string
  value: string
  note: string
  tone?: 'alert' | 'warn'
  small?: boolean
}) {
  const fg = tone === 'alert' ? theme.alert : tone === 'warn' ? theme.warnInk : theme.ink
  return (
    <div
      style={{
        background: theme.panel,
        border: `1px solid ${tone === 'alert' ? theme.warnBorder : theme.border}`,
        borderRadius: 8,
        padding: '13px 15px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: LABEL }}>{label}</span>
      <span style={{ fontSize: small ? 22 : 26, fontWeight: 600, lineHeight: 1.1, color: fg, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
      <span style={{ fontSize: 11.5, color: LABEL, lineHeight: 1.4 }}>{note}</span>
    </div>
  )
}

const head = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.05em',
  color: LABEL,
} as const

const num = {
  fontSize: 13,
  textAlign: 'right' as const,
  fontVariantNumeric: 'tabular-nums' as const,
}
