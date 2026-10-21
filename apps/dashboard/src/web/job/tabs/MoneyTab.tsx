/**
 * The job's Money tab: what the job is worth, what it has cost, what has
 * been claimed and where that leaves the margin, as the crew app's Money
 * tab works it out, laid out for a desk.
 *
 * Every figure, band and word is the phone's (worker/simple/Job.tsx
 * MoneyTab), worked out in data/money.ts and checked against the phone's own
 * source by money.test.ts, so the two apps cannot disagree about a job:
 *  - the summary: contract value (contract plus approved variations, ex
 *    GST), margin at today (earned value less cost to date, over earned
 *    value), how much is done and how much is claimed
 *  - the claim band: held while a covered wet area has no flood test, then
 *    nothing claimed yet, or claimed ahead of, in line with or behind the work
 *  - the phone's five rows, Claimed, Contractors & wages, Tile supply,
 *    Materials & hire and Variations, each a table with every line showing
 *    rather than one opened at a time
 * Beside them, the contract's own terms (the Contract card), read-only here
 * and set on Edit job.
 *
 * Add a supplier invoice and Add a cost are the phone's ADD INVOICE and ADD
 * A COST (job/money/CostDrawer.tsx): the same reader, the same file in the
 * same bucket, the same expenses row. What is saved here shows on the
 * phone's tab when it next loads, and the other way round.
 *
 * With no contract value the phone shows one sentence and nothing else.
 * Here that sentence takes the summary's place, with the way to Edit job,
 * and the costs still show and can still be added: a supplier invoice that
 * arrives before the contract value is typed in still needs filing.
 *
 * Money is the office's (every read here is office-only under RLS, and the
 * phone draws no Money tab for anyone else), so anyone else is told so
 * rather than shown a job worth nothing.
 */
import { useState } from 'react'
import { amountWords, NO_CONTRACT, OFFICE_ONLY, sectionOfCategory } from '../../data/money'
import { WEB_BRAND } from '../../marker'
import { paths } from '../../router'
import { PageLoading } from '../../routes'
import { useToast } from '../../shell/Toast'
import { color, space, text } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button, PlusIcon } from '../../ui/Button'
import { Empty } from '../../ui/Empty'
import { CostDrawer, type CostMode } from '../money/CostDrawer'
import { ClaimBand, ContractCard, SectionTable, Summary } from '../money/parts'
import { useMoney, useWidth } from '../money/useMoney'
import type { JobTabProps } from '../types'

/** Below this much room the Contract card goes under the tables instead of beside them. */
const STACK_BELOW = 900

export default function MoneyTab({ me, site }: JobTabProps) {
  const office = me.is_office
  const { data, error, reload } = useMoney(site.id, office)
  const toast = useToast()
  const [adding, setAdding] = useState<CostMode | null>(null)
  // Counts the times the drawer has been opened: its key, so each opening starts empty.
  const [opened, setOpened] = useState(0)
  const open = (mode: CostMode) => {
    setOpened((n) => n + 1)
    setAdding(mode)
  }
  const [box, width] = useWidth<HTMLDivElement>()

  if (!office) {
    return (
      <Empty data-money-office-only="" title={OFFICE_ONLY.replace(/\.$/, '')}>
        It shows what the job is worth, what it has cost and what has been claimed. Ask the owner if you need a figure from it.
      </Empty>
    )
  }

  const f = data?.figures
  const stacked = width !== null && width < STACK_BELOW
  const showContract = Boolean(data?.hasContract && data.contract)

  return (
    <div ref={box} data-money-tab="" style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.md }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h2 style={{ margin: 0, ...text.md, fontWeight: 600, color: color.ink }}>Money</h2>
          <div style={{ ...text.sm, color: color.muted }}>Every figure is ex GST, worked out the way the crew app’s Money tab works it out.</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs }}>
          <Button variant="primary" icon={<InvoiceIcon />} onClick={() => open('invoice')} data-add-invoice="">
            Add supplier invoice
          </Button>
          <Button icon={<PlusIcon />} onClick={() => open('cost')} data-add-cost="">
            Add a cost
          </Button>
        </div>
      </div>

      {error && (
        <Banner
          tone={data ? 'warn' : 'error'}
          title={data ? 'Showing the figures as last loaded' : 'Could not load this job’s money'}
          action={
            <Button size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      )}

      {!data || !f ? (
        error ? null : <PageLoading />
      ) : !data.visible ? (
        <Empty
          data-money-unreadable=""
          title="This job’s money could not be read"
          action={
            <Button variant="primary" onClick={() => void reload()}>
              Try again
            </Button>
          }
        >
          The figures came back empty, which happens when a login is no longer the office’s. Reload the page; if it keeps happening, sign out and back in.
        </Empty>
      ) : (
        <>
          {data.hasContract ? (
            <Summary figures={f} state={data.state} />
          ) : (
            <Empty
              compact
              data-money-nocontract=""
              title={NO_CONTRACT.replace(/\.$/, '')}
              action={
                <Button variant="primary" href={paths.jobEdit(site.id)} data-money-edit="">
                  Edit job
                </Button>
              }
            >
              Add it on Edit job, under Contract value, and the margin is worked out against it. The costs below count either way.
            </Empty>
          )}

          {f.ban && <ClaimBand ban={f.ban} />}

          <div
            data-stacked={stacked ? '' : undefined}
            style={{
              display: 'grid',
              gridTemplateColumns: showContract && !stacked ? 'minmax(0, 1fr) 312px' : 'minmax(0, 1fr)',
              gap: space.lg,
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg, minWidth: 0 }}>
              {f.sections.map((s) => (
                <SectionTable key={s.key} section={s} />
              ))}
            </div>
            {showContract && <ContractCard contract={data.contract!} approvedVariations={data.state.row?.approved_variations ?? null} editHref={paths.jobEdit(site.id)} />}
          </div>

          <p style={{ margin: 0, ...text.sm, color: color.muted }}>
            Add a supplier invoice and {WEB_BRAND} reads the total, then files it against this job. {OFFICE_ONLY}
          </p>
        </>
      )}

      <CostDrawer
        key={opened}
        mode={adding}
        me={me}
        site={site}
        onClose={() => setAdding(null)}
        onSaved={(saved) => {
          setAdding(null)
          toast(`Saved: ${saved.vendor}, ${amountWords(saved.amount)}. It shows under ${sectionOfCategory(saved.category ?? '')}.`, { tone: 'success' })
          void reload()
        }}
      />
    </div>
  )
}

/** A page with a folded corner and lines: a supplier's invoice. */
function InvoiceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 1.5h5.5L11 4v8.5H3z M8.5 1.5V4H11 M5 7h4 M5 9.5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
