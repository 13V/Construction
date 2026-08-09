# Commercial

Commercial — job profitability, contracts, quotes, purchase orders, invoices/claims, variations, subcontractors. OWNER ONLY throughout (workers.role = 'owner'; is_office = true). Grounded in schema_v4/v6/v9/v14/v15/v16/v17/v18/v20 and the office screens in apps/dashboard/src/ui/. THREE THINGS TO KNOW BEFORE READING THE SCREENS: (1) RLS makes this domain literally empty for a captain, not merely hidden. job_value_v, job_cost_v, job_profit_v and company_overview_v all carry `and current_is_office()` in their WHERE clause, and contracts/invoices/invoice_payments/estimates/purchase_orders/subcontractors/subcontract_work/builders all have office-only SELECT policies (schema_v14, v15, v16, v17). A captain issuing the query gets zero rows and no error. So the Money tab is ABSENT from the tab bar for captain and employee — the "you can't see this" screen exists only as a fallback for a stale deep link. (2) ONE EXCEPTION, and the design is deliberately stricter than the database. schema_v18 widened change_orders_read to `current_is_office() or captains_site(site_id)`. A captain can therefore SELECT a variation row on their own job — including its cost_impact column. The brief says a captain never sees money, so the captain's variation screens render description, detail, days_impact, status, approved_on and photos and OMIT cost_impact and the scope-line amounts. This is a UI decision, not an enforced one. If it matters commercially, it needs a column-dropping view (change_orders_field_v) the way crew_v drops workers.rate — flag it to the client. (3) TWO THINGS THE CLIENT ASKED FOR THAT DO NOT EXIST IN THE DATABASE, called out on the screens that need them: - `subcontractors` and `subcontract_work` have NO UI anywhere in the app (verified by grep across apps/). job_cost_v.sublet_cost therefore reads $0 on every job today. The phone is the first surface that will write these rows. - A variation has no photo link. change_orders has no photo column and site_files has no change_order_id. site_files.site_id is NOT NULL, so a quote raised before the job exists cannot hold a document at all. The client's "variation — description, photos, reason" and "quote — pdf / spreadsheet / marked-up drawing" both need a schema change; the screens below name the convention to use in the meantime and the column to add. EVERY FIGURE IS EX GST ON BOTH SIDES OF A MARGIN, and inc GST on anything a builder owes — that split is the schema's, not a style choice (schema_v20 header; invoices.amount is inc GST, invoices.ex_tax is generated from it).

48 screens. Generated from the codebase, not imagined — every figure named here comes from a table or view that exists. Part of the inventory referenced by `design/PROMPT-mobile-v2.md` section 7.

---

## Money — the owner's commercial root

**full screen**

**Reached by** — Tab bar, outside any job: /money. One of the owner's global tabs alongside Jobs. The tab does not render for captain or employee.

**Roles** — Owner only. The tab is absent for captain and employee — not disabled, absent, because company_overview_v returns zero rows for them (it ends `where current_is_office()`), so a greyed tab would open onto nothing.

Five money tiles straight off company_overview_v, one row per two on a 390px column, tabular-nums, no chart: WORK IN HAND = work_in_hand (sum of job_value_ex, ex GST) with subtitle counting jobs where contract_id is not null; LEFT TO CLAIM = left_to_claim (sum of to_claim_inc, inc GST); OWED TO US = owed_to_us (sum of outstanding_inc) with subtitle `{overdue_invoices} overdue — {overdue_amount}` in alert red when overdue_invoices > 0, else 'nothing overdue'; MARGIN TO DATE = margin_to_date (sum of margin, ex GST) in alert red when negative; RETENTION HELD = retention_held with subtitle 'released at practical completion'. Below them a single decision strip: VARIATIONS AWAITING APPROVAL = variations_pending with variations_pending_value beside it (this is the client's dashboard item, and it lives here because it is money). Then the ranked job list — see the next screen, which is the lower half of this one. Footnote, always present, small: 'Labour is direct wages only — no super, leave or insurance. A true cost of labour is roughly a third higher again.' (schema_v20 excludes on-costs deliberately; workers.rate is a bare wage.)

**Every tap target**

- Any money tile → half sheet 'What this number is', naming the exact view column and its GST basis — the only place the app explains ex/inc GST, and it must be one tap from every figure
- OWED TO US tile → pushes 'Owed to us' full screen (aging + the chase list)
- VARIATIONS AWAITING APPROVAL strip → pushes 'Variations awaiting approval, all jobs'
- A job row in the ranked list → pushes that job's Job profitability screen and switches the tab bar into the job
- Sort control in the list header → 'Rank the jobs' half sheet
- Pull to refresh → re-reads company_overview_v and job_profit_v (both are plain selects; there is no cache to invalidate)

**States** — EMPTY: no jobs at all — 'Nothing to measure yet. A job gets a value the moment its contract is entered; until then every figure here is zero because it genuinely is.' with a button into Jobs. LOADING: the five tiles render as skeleton bars at their final height so nothing reflows; the list shows three ghost rows. Do not show 0 while loading — a zero that turns into $180,000 teaches people not to trust the screen. ERROR: a red-tinted strip above the tiles carrying the Postgres message verbatim (Overview.tsx already does this) plus 'Retry'. The tiles keep the last figures they had, dimmed, over the caption 'As at {time}'. A permission error (empty result, not an error) falls through to the role screen below. OFFLINE: everything still renders from the last successful read with a persistent header caption 'Offline — as at 7:12am'; the sort control still works, because sorting is local. No write on this screen.

---

## Job profitability, all jobs — the ranked list

**inline**

**Reached by** — The lower two-thirds of /money. Not a separate route; it scrolls up under the tiles.

**Roles** — Owner only. job_profit_v returns zero rows to anyone else.

One card per row of job_profit_v — never a table, never a horizontal scroll. Each card is three lines: LINE 1 site_name (bold, 15px) with a status dot; LINE 2 the money, as a single sentence rather than columns — `{job_value_ex} value · {total_cost} cost · {margin_pct}%` with margin_pct large and coloured (Overview.tsx's exact thresholds: < 0 → theme.alert, < 15 → theme.warnInk, otherwise theme.successInk, null → theme.inkFaint); LINE 3 the reason it is where it is in the list — one of: `{contract_sum_ex} contract + {approved_variations} variations`, or 'no contract entered' when contract_id is null, or `{progress_pct}% done, {claimed_pct}% claimed`. Cards carrying a flag get a left edge bar in warn or alert and one flag line: 'Losing money' (margin_pct < 0), 'Over-claimed' (claimed_pct − progress_pct > 10, which is Overview.tsx's overclaimed()), 'Over-claimed against the contract' (to_claim_inc < 0), 'Cost running ahead of billing' (unbilled_cost > 0 and > 10% of job_value_ex), 'No contract — value reads zero'. Default ordering is a partition, not a sort: every flagged job first (this is the client's 'projects requiring attention'), then the rest by unbilled_cost descending. A footer note appears when any job has no contract, worded exactly as Overview.tsx does: '{n} jobs have no contract entered, so their value reads zero and the margin cannot be worked out.'

**Every tap target**

- A card → pushes Job profitability (one job) and enters the job context
- The flag line on a card → half sheet explaining that one flag against that one job, with the two columns it came from
- The sort control → 'Rank the jobs' half sheet
- Long press a card → half sheet with 'Open the contract', 'Variations', 'Claims', 'Share the numbers' — the four places an owner goes from a bad row

**States** — EMPTY (jobs exist, none has a contract): not 'No data' — 'Six jobs are running and none has a contract entered. Enter one and this screen fills itself in: value, cost, margin and what is left to claim all come off the contract sum.' EMPTY (one job only): show the single card at full width with no rank badge and suppress the sort control entirely — ranking one thing is noise. LOADING: three ghost cards. ERROR: inherits the strip from the parent screen. OFFLINE: cards render from the last read, dimmed by 8%, sort still works.

---

## Rank the jobs

**half sheet**

**Reached by** — The sort control in the ranked list header.

**Roles** — Owner only.

Four options as full-width rows, current one ticked, each with a one-line explanation of the column it sorts on — the explanation is the point, because 'unbilled first' means nothing without it. NEEDS ATTENTION (default) — 'Anything flagged, then the biggest gap between cost and billing.' UNBILLED FIRST — sorts unbilled_cost descending; 'Cost booked against work not yet claimed. On a job running to plan this just tracks progress. When it runs away it is the earliest warning that the crew is working faster than the office is billing — usually weeks before the bank account notices.' (That sentence exists verbatim in Overview.tsx; keep it.) WORST MARGIN — sorts margin_pct ascending, jobs with a null margin_pct last, never first. BIGGEST — sorts job_value_ex descending.

**Every tap target**

- Any row → applies the sort and dismisses the sheet immediately (one tap, no Done button)
- Grabber or the dimmed area above → dismiss unchanged

**States** — No empty, loading or error state — the sheet is four static rows over data already in memory. OFFLINE: fully functional; sorting is local.

---

## Money — you don't have access to this

**full screen**

**Reached by** — Only reachable by a stale deep link, a notification opened by the wrong person, or a role changed while the app was open. The tab itself is never drawn for a captain or an employee.

**Roles** — Captain and employee. Never seen by an owner.

No table, no zeros, no locked-padlock iconography. A short honest paragraph, differing by role. Captain: 'Contract sums, invoices, margins and pay rates are the owner's. You run the work on your jobs — the scope, the programme, the crew, the defects, the sign-offs — and all of that is on your job's other tabs.' Employee: 'Money screens are office-only. Your hours, your photos and the job you are on are on the other tabs.' Below, three buttons that go somewhere useful rather than back: for a captain, 'My jobs', 'Variations on my jobs' (which they CAN read — see the captain's variation screen), 'Defects'. For an employee, 'My hours', 'My jobs'. If the role changed underneath them, add one line: 'Your access changed. Sign out and back in if this looks wrong.'

**Every tap target**

- Each of the three buttons → pushes that screen
- 'Sign out and back in' → the account sheet

**States** — This screen IS the state. It renders instantly with no fetch — deciding it needs only me.role, already in memory, so it never flashes a loading spinner and never issues a query that would come back empty. No error state. OFFLINE: renders identically; it reads nothing.

---

## Job profitability (one job) — the centrepiece

**full screen**

**Reached by** — Money → a job card; or inside a job, the Money tab: /job/:siteId/money. This is the landing screen of the owner's Money tab within a job.

**Roles** — Owner only. A captain's job tab bar has no Money tab; job_profit_v returns them nothing.

THE ONE NUMBER AT THE TOP is margin_pct — set at ~44px, tabular-nums, coloured on the thresholds already in the codebase (< 0 alert, < 15 warnInk, else successInk). Directly under it, smaller, the dollars: `{margin} margin on {job_value_ex}`. And directly under THAT, the sentence that makes the screen honest, because margin_pct on its own is a trap — job_value_ex is the whole job's value while total_cost is only what has been spent so far, so a job at 10% complete shows a near-perfect margin. So the third line always reads the number against progress_pct: 'But only {progress_pct}% of the work is done. At this rate the job finishes at about {projected}%.' where projected = (job_value_ex − total_cost / (progress_pct/100)) / job_value_ex × 100, computed on the device from two real columns. That projection is the client's 'projected profit', which is NOT a column — say so in the sheet behind it, show it only when progress_pct is not null and ≥ 10 and progress_assessed_on is within 30 days, and when it cannot be shown say why: 'Progress has not been assessed on this job, so there is nothing to project against — only what has been spent.' HOW GOING BAD IS SAID BEFORE ANYONE ASKS: a full-width banner directly beneath the headline, present only when a condition fires, in plain language and in order of severity — 'This job is losing money' (margin < 0); 'It will finish under 10% at this rate' (projection); 'You have claimed {claimed_pct}% and done {progress_pct}%' (over-claim, alert — this is the conversation a builder's QS opens with); 'You have claimed {|to_claim_inc|} more than the contract allows' (to_claim_inc < 0 — job_value_v deliberately does not floor this at zero); '{unbilled_cost} of cost is not billed yet'; '{pending_variations} of variation work is not approved and adds nothing to the value' (from job_value_v via the variations screen). BELOW THE BANNER, four stacked rows, each a label / figure / one-line reading — never a grid: VALUE `{job_value_ex}` ex GST — 'contract {contract_sum_ex} plus {approved_variations} approved'; COST `{total_cost}` — '{labour_hours} hrs of labour, materials, dockets, sublet'; PER LABOUR HOUR `{value_per_labour_hour}` — 'what an hour on this job returned after everything that was not labour. Compare it to your charge-out rate.'; CLAIMED `{claimed_inc}` inc GST — '{claimed_pct}% of the job; {paid_inc} paid, {outstanding_inc} still owed, {retention_held} retention held'. Header of the screen carries site_name and contract_status.

**Every tap target**

- The headline margin → 'How this margin is worked out' half sheet
- The projection sentence → 'How the projection is worked out' half sheet
- VALUE row → 'What this job is worth' half sheet (the value ladder), which itself offers 'Open the contract'
- COST row → 'Where the cost went' half sheet
- PER LABOUR HOUR row → 'Labour on this job' half sheet
- CLAIMED row → 'Claimed against it' half sheet, which offers 'Open the claims'
- Any banner → the half sheet for that specific condition, so the owner can see the two columns behind the warning
- 'Share these numbers' in the header → OS share sheet with a plain-text summary (there is no profitability PDF in data/documents.ts — only invoicePdf, variationPdf and waterproofingPdf — so do not draw a PDF button here)
- Bottom bar, contextual: 'ADD THE CONTRACT' (full-width CTA, brand gradient) when contract_id is null; otherwise 'RAISE A CLAIM' when to_claim_inc > 0; otherwise no bottom bar

**States** — EMPTY (contract_id is null): the headline is replaced, not zeroed — 'No contract on this job.' and beneath it 'Margin, left-to-claim and profitability all measure against the contract sum, so they stay blank until it is entered. Cost is still being counted: {total_cost} so far.' That last clause matters — the cost side of job_cost_v works with no contract at all, and showing it is what makes an owner enter the contract. Full-width 'ADD THE CONTRACT' CTA. EMPTY (contract entered, nothing spent): headline shows 100% honestly with the reading 'Nothing has been costed to this job yet — no closed shifts, no materials, no dockets.' LOADING: the headline area holds its height with a shimmer; never render 0% first. ERROR: red strip with the verbatim message and Retry; the rest of the screen keeps its last values under an 'as at' caption. A captain who deep-links here gets the role screen, not this one. OFFLINE: the whole screen renders from the last read with a persistent 'Offline — as at {time}' caption under the headline, and the bottom-bar CTA is disabled with the label 'Needs a connection' — a contract or a claim cannot be queued (see the offline note below).

---

## Where the cost went

**half sheet**

**Reached by** — Tapping the COST row on Job profitability.

**Roles** — Owner only.

job_cost_v, in the order it is built, as four rows plus a total — this is the whole reason the view exists, so it is one tap from the margin. LABOUR `{labour_cost}` — '{labour_hours} hrs, closed shifts only, wages at workers.rate. No super, leave, insurance or workers' comp — a true cost of labour is roughly 1.3–1.5× this.' MATERIALS `{material_cost}` — 'materials not returned' (job_cost_v excludes status = 'returned'). DOCKETS & EXPENSES `{expense_cost}` — 'expenses net of GST, excluding anything already counted as a material line' (the view de-duplicates via materials.expense_id — say so, because an owner who sees a receipt on both screens will assume it is double-counted). SUBLET LABOUR `{sublet_cost}` — 'subbies' hours on this job'. TOTAL `{total_cost}`. Each row shows its share of total_cost as a thin bar, so 'the labour is the problem' is visible without arithmetic. One line at the foot: 'An open shift is not counted. A shift with no end time has no duration yet, and counting one as now-minus-start would change this job's cost every time you opened the screen.'

**Every tap target**

- LABOUR row → 'Labour on this job' half sheet (replaces this one, same detent)
- MATERIALS row → pushes the job's Materials screen (another agent's domain) and dismisses the sheet
- SUBLET row → pushes 'Sublet labour on this job'
- DOCKETS row → pushes the job's Expenses list
- Grabber → dismiss

**States** — EMPTY: all four are zero — 'Nothing has been costed to this job yet. Cost appears here as shifts are closed, materials are logged, dockets are photographed and subbies' hours are entered.' LOADING: the sheet opens at its final height with four ghost rows; it must not grow as data arrives. ERROR: the sheet still opens and shows 'Could not read the cost breakdown' with Retry inside the sheet, because dismissing a failed sheet loses the user's place. OFFLINE: renders from the parent screen's already-loaded job_profit_v row (all four columns are on it), so it works offline with no extra fetch. Build it that way.

---

## Labour on this job

**half sheet**

**Reached by** — Job profitability → PER LABOUR HOUR row, or 'Where the cost went' → LABOUR.

**Roles** — Owner only. This is the screen that most obviously must never reach a captain: it is wages.

labour_hours and labour_cost from job_cost_v at the top as a pair, then the two derived readings that make them useful: average wage per hour (labour_cost / labour_hours) and value_per_labour_hour from job_profit_v, side by side, with the line 'Every hour on this job returned {value_per_labour_hour} after materials, dockets and sublet. It cost {avg} in wages.' Below, an explicit boundary line, because it is the single most common misreading: 'Closed shifts only. Anyone on the clock right now is not in this figure.' No per-worker breakdown on this sheet — a named list of who cost what is a payroll screen, and shifts join workers.rate which is exactly the join RLS keeps away from everyone but the owner; if the client wants it, it is a separate pushed screen, not a sheet.

**Every tap target**

- 'See the timesheet' → pushes the job's Hours screen filtered to this site (another agent's domain)
- Grabber → dismiss

**States** — EMPTY: labour_hours is 0 — 'No closed shifts on this job yet. Hours appear here when someone clocks off, not when they clock on.' LOADING: not applicable — every figure is already on the job_profit_v row the parent screen loaded. ERROR: none for the same reason. OFFLINE: works fully.

---

## How this margin is worked out

**half sheet**

**Reached by** — Tapping the headline margin figure on Job profitability.

**Roles** — Owner only.

Four lines of arithmetic in words, with the real numbers substituted, and nothing else: '{job_value_ex} — what the job is worth, ex GST: the contract sum plus every approved variation.' minus '{total_cost} — what it has cost so far: wages on closed shifts, materials, dockets and sublet.' equals '{margin}, which is {margin_pct}% of the value.' Then the two caveats that decide whether the number can be trusted, each on its own line: 'Both sides are ex GST. GST you collect is not revenue and GST you pay is an input credit — mixing them is a 10% error on a number that is usually 15–25%.' and 'Labour is wages only. No super, leave, insurance or workers' comp.' Last line, when contract_id is null: 'There is no contract on this job, so the value reads zero and this percentage means nothing.'

**Every tap target**

- 'Open the contract' → pushes the Contract screen, dismisses the sheet
- Grabber → dismiss

**States** — No empty or loading state — every figure is already loaded. ERROR: none. OFFLINE: fully functional.

---

## How the projection is worked out

**half sheet**

**Reached by** — Tapping the projection sentence under the headline on Job profitability.

**Roles** — Owner only.

The most important disclosure screen in the domain, because this figure is the client's 'projected profit' and it is NOT a database column — say that in the first line. 'This is not a stored figure. It is worked out on your phone from two things the app does hold.' Then: 'You have spent {total_cost} to get {progress_pct}% of the way through (assessed {progress_assessed_on}, from site_progress_v).' 'At the same rate the whole job costs about {projected_cost}.' 'Against a value of {job_value_ex} that leaves about {projected_margin} — {projected_pct}%.' Then the three conditions under which it is nonsense, stated plainly: 'It assumes the rest of the job costs what the first part did. A job that has done all its easy floors and none of its ensuites will look better here than it is.' 'It is only as good as the progress assessment. This one is {n} days old.' 'It ignores anything not yet approved: {pending_variations} of pending variations is not in the value.'

**Every tap target**

- 'Update progress' → pushes the job's Progress screen (another agent's domain) — the single most useful action from this sheet, because a stale assessment is the usual reason the projection is wrong
- Grabber → dismiss

**States** — EMPTY/SUPPRESSED: when progress_pct is null the sheet is not reachable at all — the parent shows 'Progress has not been assessed' as static text instead. When progress_pct < 10, the sheet opens but leads with 'Too early to project. 6% of a job is not a rate.' STALE: when progress_assessed_on is more than 30 days old, the sheet opens with an amber line 'This assessment is {n} days old' above the arithmetic. No loading or error state; all values are in memory. OFFLINE: fully functional.

---

## What this job is worth — the value ladder

**half sheet**

**Reached by** — Job profitability → VALUE row.

**Roles** — Owner only.

The client's value ladder, condensed to a phone, from job_value_v: 'Contract sum {contract_sum} ({gst_inclusive ? 'inc' : 'ex'} GST, as signed)' / '+ Approved variations {approved_variations} — {approved_variation_count} on the contract' / a rule / 'JOB VALUE {job_value_ex} ex GST' with '{job_value_inc} inc GST' beneath in small text. When pending_variation_count > 0, an amber block below the total in the exact terms the desktop uses: '{pending_variations} across {pending_variation_count} variations is still pending. It is deliberately not counted above — unapproved work is not contract value, and billing it is what a builder disputes.'

**Every tap target**

- 'Open the contract' → pushes the Contract screen
- '{n} pending variations' → pushes the job's Variations list filtered to pending_client
- Grabber → dismiss

**States** — EMPTY (contract_id is null): the ladder is replaced by 'No contract entered on this job' plus an 'ADD THE CONTRACT' button inside the sheet. LOADING: none — the figures come from the parent's job_profit_v row, except approved_variation_count and pending_variation_count which are on job_value_v and NOT on job_profit_v; fetch job_value_v with the parent screen so this sheet never fetches on open. ERROR: 'Could not read the contract figures', Retry inside the sheet. OFFLINE: renders from the last read.

---

## Claimed against it

**half sheet**

**Reached by** — Job profitability → CLAIMED row.

**Roles** — Owner only.

Four figures from job_value_v, stacked, each with its basis spelled out because they are on different ones: CLAIMED {claimed_inc} inc GST — 'sent and paid claims; drafts are not counted, nothing is claimed until it is sent'; PAID {paid_inc} — '{outstanding_inc} still outstanding'; LEFT TO CLAIM {to_claim_inc} — in alert red with the label 'OVER-CLAIMED against this contract' when negative (job_value_v deliberately does not floor it); RETENTION HELD {retention_held} — '{retention_pct}% of each claim, released at practical completion' or 'no retention on this contract' when retention_pct is 0. When draft_invoice_count > 0, a final line: '{draft_invoice_count} draft claims are not counted here.'

**Every tap target**

- 'Claims on this job' → pushes the job's Invoices screen
- '{n} drafts' → pushes the same screen filtered to draft
- 'RAISE A CLAIM' (full width, inside the sheet, only when to_claim_inc > 0) → pushes Raise a claim
- Grabber → dismiss

**States** — EMPTY: nothing claimed — 'Nothing has been claimed against this job yet. {to_claim_inc} of the contract is still to claim.' LOADING/ERROR: as the value ladder — comes with the parent's fetch. OFFLINE: renders from the last read; the RAISE A CLAIM button is disabled with 'Needs a connection'.

---

## Contract

**full screen**

**Reached by** — Job profitability → VALUE → 'Open the contract'; or the job's Money tab → Contract row. Route /job/:siteId/money/contract.

**Roles** — Owner only. contracts has an office-only SELECT policy (schema_v17) with a comment explicitly refusing even a portal policy — a contract's retention terms and payment days are between this business and the builder.

HEADER: contracts.title or 'Head contract', with a status chip from contracts.status (draft / active / completed / terminated). FACTS, as stacked label-value rows not a grid: BUILDER (builders.name via builder_id, or 'not linked to a builder'); CONTRACT No (contract_no) with 'their PO {order_no}' beneath — this is where the client's 'contractor PO' from the process list lives, the builder's order number, distinct from purchase_orders which are the ones this business issues; SIGNED (signed_on) with 'starts {starts_on}, due {due_on}'; TERMS ('{payment_terms_days} days' with '{retention_pct}% retention'); BASIS ('{contract_sum} is quoted {gst_inclusive ? 'including' : 'excluding'} GST'). THE VALUE LADDER, full size on this screen (the same three lines as the half sheet, but as the screen's centrepiece with the total at 24px). THE CLAIM POSITION, four rows: claimed_inc, paid_inc / outstanding_inc, to_claim_inc, retention_held. VARIATIONS ON THIS CONTRACT: every change_orders row for the site, newest first — co_no, description truncated to one line, cost_impact, and a chip whose approved label is literally 'On the contract' (the desktop uses that word and it is the client's own). INVOICES ON THIS CONTRACT: every invoices row — invoice_no, period or the variation it covers ('{co_no} — {description}' when variation_id is set), issued_on, amount, status. contracts.note in full at the foot if present.

**Every tap target**

- 'Edit contract' in the header → pushes Contract edit (a form with eleven fields is a screen, not a sheet)
- The BASIS row → 'Ex GST or inc GST' half sheet
- The TERMS row → 'Retention and payment terms' half sheet
- A variation row → pushes One variation
- An invoice row → pushes One invoice
- 'ADD THE CONTRACT' full-width CTA when no contract exists → pushes Contract edit in create mode
- Builder name → half sheet with the builder's contacts (name, role, mobile, email from builder_contacts) with tap-to-call and tap-to-email

**States** — EMPTY (no contracts row for this site): the whole screen is one honest block — 'No contract entered on this job.' / 'Nothing on this job has a value yet. Margin, left to claim and job profitability all measure against the contract sum, so they stay blank until it is entered.' / 'ADD THE CONTRACT'. Everything else on the screen is hidden, not zeroed. LOADING: header and ladder skeletons at final height. ERROR: red strip verbatim + Retry. OFFLINE: full read from cache with 'Offline — as at {time}'; 'Edit contract' disabled with 'Needs a connection'.

---

## Contract edit

**full screen**

**Reached by** — Contract → 'Edit contract' or 'ADD THE CONTRACT'. Route /job/:siteId/money/contract/edit.

**Roles** — Owner only. contracts_office_write is office-only for insert and update.

A screen, not a sheet — the brief's own rule is that a form longer than a thumb-scroll is a screen, and this is eleven fields. In order: BUILDER (picker over builders where active, or 'Not linked'); CONTRACT NUMBER (contract_no, placeholder 'C-2291'); THEIR ORDER NUMBER (order_no, placeholder 'PO 88401'); TITLE (title, placeholder 'Tiling — wet areas, Lot 42'); CONTRACT SUM (contract_sum, numeric keypad, right-aligned); THAT FIGURE IS (gst_inclusive, a two-way segmented control 'Excluding GST' / 'Including GST' — never a checkbox, because a mis-tapped checkbox is a 10% error on every margin on the job) with the helper text the desktop already carries: 'Commercial subcontracts here are almost always quoted ex GST and a fixed-price residential contract inc. Getting it wrong is a 10% error on every margin figure on the job.'; RETENTION % (retention_pct, 0–100); PAYMENT TERMS (payment_terms_days); SIGNED ON / STARTS ON / CONTRACT COMPLETION (signed_on, starts_on, due_on — native date pickers); STATUS (draft/active/completed/terminated); NOTE (contract_sum-adjacent free text — 'liquidated damages, access conditions, agreed rates'). Picking a builder pulls payment_terms_days from builders.payment_terms_days and retention_pct from builders.default_retention_pct, but ONLY into fields still at their defaults (30 and 0) — it must never overwrite terms already negotiated on this job. The write is a single upsert on site_id, because contracts has `unique (site_id)`; that also means a double-tap cannot create a second contract.

**Every tap target**

- 'SAVE CONTRACT' / 'SAVE CHANGES' full-width bottom bar (brand gradient) → upsert, then pop back to Contract
- 'Cancel' → confirm modal only if a field changed, otherwise pop immediately
- BUILDER field → 'Pick a builder' half sheet (searchable list of builders, plus 'Add a builder')
- THAT FIGURE IS helper → 'Ex GST or inc GST' half sheet
- Each date field → the OS date picker

**States** — VALIDATION (not an error state — inline, under the field): 'Enter the contract sum. It is the figure every margin on this job is measured against.' and 'Retention has to be a percentage between 0 and 100.' ERROR: the Postgres message verbatim above the save bar; the form keeps everything typed. LOADING: only on open, and only when editing — the fields fill from the existing row. EMPTY: not applicable; a blank form is the create state and its bar reads 'SAVE CONTRACT'. OFFLINE: the save bar is disabled and reads 'Offline — a contract needs a connection'. The form is NOT queued: contracts drives job_value_v, which drives every margin in the business, and a contract sum syncing an hour later while the owner acts on a margin they saw is worse than a blocked button. The typed values are kept in device state so the form survives the app being backgrounded.

---

## Ex GST or inc GST

**half sheet**

**Reached by** — The BASIS row on Contract, the 'That figure is' helper on Contract edit, any money tile on Money.

**Roles** — Owner only.

The one place this is explained, reachable from everywhere a basis is shown. 'This contract's sum is {gst_inclusive ? 'including' : 'excluding'} GST at {gst_rate}%.' Then the three consequences in the app's own numbers: 'Ex GST it is {contract_sum_ex}. Inc GST it is {contract_sum_inc}.' 'Margins are measured ex GST on both sides — GST you collect is remitted, GST you pay comes back as an input credit.' 'What a builder owes is inc GST — that is what invoices.amount holds and what Left to claim shows.' Last line: 'Which one the contract states is recorded, not assumed, because both are in daily use here.'

**Every tap target**

- Grabber → dismiss. No other action; this sheet exists only to explain.

**States** — No states — static text over loaded values. OFFLINE: works.

---

## Retention and payment terms

**half sheet**

**Reached by** — Contract → TERMS row; Claimed against it → RETENTION HELD.

**Roles** — Owner only.

'{retention_pct}% is held from each claim on this contract and released at practical completion.' '{retention_held} is held right now' — the sum of invoices.retention_amount across sent and paid claims, from job_value_v.retention_held. '{payment_terms_days} days from the invoice date' with the note that a claim's due_on is worked out from it. When retention_pct is 0: 'No retention on this contract.' When retention_held is greater than zero but retention_pct is 0, say so rather than hiding it: 'Retention has been withheld on past claims even though this contract records none — check the claims.' (invoices.retention_amount is per-invoice and schema_v9 backfilled it from itemised retention lines, so the two genuinely can disagree.)

**Every tap target**

- 'Claims on this job' → pushes the job's Invoices screen
- Grabber → dismiss

**States** — No loading. OFFLINE: works from cache.

---

## Quotes

**full screen**

**Reached by** — Money → Quotes; route /money/quotes. Also the job's Money tab → Quote when estimates.site_id is set.

**Roles** — Owner only — estimates and estimate_lines are office-only read (schema_v14 added `and current_is_office()` to estimates_read and a matching exists() clause on estimate_lines_read).

This is a document-management screen with a price attached, which is how the client described it. Only the tip of each revision chain is listed — the row nothing else points at through parent_id; superseded revisions live inside the quote. Each card: title, client_name (or the builder's name via builder_id), 'Rev {revision}', the total (sum of estimate_lines.line_total — a generated column, never recomputed on the device), a status chip over estimates.status (draft / awaiting_approval / approved / rejected / superseded), and created_at or sent_at. Grouped by status with awaiting_approval first, because a quote sitting unanswered is the one that needs a phone call. Header filter chips: All / Draft / Awaiting / Approved.

**Every tap target**

- A card → pushes One quote
- '+' in the header → 'New quote' half sheet (client_name, title, job — only four fields, so a sheet is right here where the contract form was not)
- A filter chip → filters in place
- Long press a card → half sheet: 'Send to builder', 'New revision', 'Turn into a job', 'Share the PDF'

**States** — EMPTY: 'No quotes yet. A quote is where a job starts — price it line by line, send it to the builder, and when they accept it becomes the job and the contract.' with a '+ NEW QUOTE' button. ONE ITEM: show the single card full width and drop the status grouping headers entirely — a group header over one row is noise. LOADING: three ghost cards. ERROR: red strip verbatim + Retry. OFFLINE: list renders from cache; '+' is disabled with 'Needs a connection'.

---

## One quote

**full screen**

**Reached by** — Quotes → a card. Route /money/quotes/:estimateId.

**Roles** — Owner only.

HEADER: title, 'Rev {revision}', status chip, client_name. TOTAL, large: the sum of estimate_lines.line_total, with the count of lines beneath. THE TAKE-OFF: estimate_lines grouped by cost_code in the canonical chart-of-accounts order (data/seed.ts costCodes), each group showing its subtotal and collapsing to a row; inside a group each line is name, then `{qty} {unit} × {unit_price}` with markup_pct shown only when it is not zero, and line_total on the right. This is the client's 'spreadsheet with take-off detail' and their 'tile + codes + suppliers + quote' — with one honest gap to state on the screen and to the client: estimate_lines has cost_code, name, qty, unit, unit_price, markup_pct and line_total, and NO supplier column and no product link. Tile codes and suppliers today can only live inside `name`, or in the products / site_products tables (schema_v11) which estimates do not join to. Say it in the design; it is a column to add, not a screen to fake. DOCUMENTS: the client wants a PDF to the builder and a marked-up drawing on this screen. Neither can be attached today — estimates has no file column, and site_files.site_id is NOT NULL so a quote raised before the job exists cannot use it. Draw the section with its honest empty state and the one workable interim: once site_id is set, documents are site_files rows with kind='document'. REVISIONS: the parent_id chain, read-only, each with its revision number, status and date — 'a superseded price is evidence in a dispute, so nothing here writes to one again'.

**Every tap target**

- A cost-code group → expands in place
- A line → 'Quote line' half sheet (cost_code, name, qty, unit, unit_price, markup_pct, line_total) with Edit and Delete, both disabled when status is not draft
- 'Send to builder' → confirm modal, then sets status='awaiting_approval' and sent_at=now()
- 'New revision' → confirm modal explaining what it does, then copies the estimate and its lines to a new row through parent_id, bumps revision, and marks the old one superseded
- 'Turn into a job' → confirm modal (see its own entry)
- 'Share' → OS share sheet. NOTE: data/documents.ts has invoicePdf, variationPdf and waterproofingPdf — there is NO estimatePdf. Either the button shares a plain-text summary, or a quote PDF gets built. Do not draw a PDF button that has nothing behind it.
- 'Attach a document' → half sheet (Camera / Photos / Files) — only enabled when the quote has a site_id

**States** — EMPTY (no lines): 'Nothing priced on this quote yet. Add lines and the total works itself out — every dollar comes from qty × price × markup, computed in the database so the figure on screen can never drift from what is stored.' EMPTY (documents): 'No drawings or PDFs on this quote. A quote raised before the job exists has nowhere to keep them yet — attach them once the job is created.' LOADING: header and total skeleton. ERROR: red strip. SUPERSEDED: the whole screen renders with a grey banner 'Superseded by Rev {n}' and every action except Share is removed — not disabled, removed. OFFLINE: reads from cache; every action disabled with 'Needs a connection'.

---

## Quote line

**half sheet**

**Reached by** — One quote → a line in the take-off.

**Roles** — Owner only.

cost_code (picker over the seed chart of accounts), name, qty with unit (ea, lm, m, m², m³, kg, t, L, box, pack, sheet, hr — the list the app already uses), unit_price, markup_pct, and line_total shown read-only beneath with the note 'worked out in the database as qty × price × (1 + markup), so this figure can never drift from what is stored'. Numeric keypad on the three number fields; the fields are large enough to hit with a thumb in a ute.

**Every tap target**

- 'Save' → updates the estimate_lines row and dismisses
- 'Delete this line' → confirm modal, then deletes
- Grabber → dismiss without saving, with a confirm only if something changed

**States** — READ-ONLY when the parent quote is not draft — the fields render as text with the line 'A price the builder has already seen is never edited. Create a new revision instead.' and a 'New revision' button. ERROR: shown inside the sheet above the save button. OFFLINE: sheet opens and reads; save disabled with 'Needs a connection'.

---

## Turn this quote into a job

**modal**

**Reached by** — One quote → 'Turn into a job', on an approved or awaiting quote.

**Roles** — Owner only.

A confirmation that says exactly what will happen, because it creates a row in a table the whole app hangs off. 'This creates a job called "{title}" for {client_name}, with a cost budget of {total}, and marks this quote approved.' Then the two things that will still be missing, so nobody is surprised: 'The job will have no address and no geofence yet — place it on the map from Jobs before anyone can clock on.' (Estimates.tsx inserts DEFAULT_CENTER as the lat/lng.) 'It will have no contract. Enter the builder's contract sum next, or every margin on the job reads zero.' This is step two of the client's process — quote → signed contract from builder — so the modal's primary action chains into it.

**Every tap target**

- 'CREATE THE JOB' → inserts job_sites (name, client_name, budget, lat/lng), updates the estimate to status='approved' with the new site_id, then pushes straight into Contract edit for the new job
- 'Not yet' → dismiss

**States** — ERROR: the modal stays open with the message verbatim and the button re-enabled — a half-created job is the worst outcome, so if job_sites inserted but the estimate update failed, the message says so specifically: 'The job was created but the quote was not marked approved. Open the quote and try again.' LOADING: the button shows a spinner and is disabled; the modal cannot be dismissed while it runs. OFFLINE: the action is not offered — the menu item is disabled with 'Needs a connection'.

---

## Purchase orders on this job

**full screen**

**Reached by** — The job's Money tab → Purchase orders. Route /job/:siteId/money/po. Also a company-wide list at /money/po.

**Roles** — Owner only — purchase_orders and po_lines are office-only read (schema_v14). NOTE for the design: a subcontractor PORTAL login can read a sent PO on their own site (po_sub_read, schema_v6). That is a different surface, not the phone app.

These are the orders THIS business issues to its suppliers and subbies — not the builder's order to this business, which is contracts.order_no. Say that on the screen once, because the client uses 'contractor PO' for both. Each card: po_no, vendor, status chip (draft / sent / partially_received / received / cancelled), the order total (sum of po_lines.line_total, generated as ordered_qty × unit_cost), issued_on, and expected_on rendered as 'expected {date}' or 'overdue by {n} days' in amber when expected_on has passed and status is still sent or partially_received. Above the list, the one figure that makes this screen worth opening — COMMITTED, NOT LANDED: the value of the unreceived portion across every sent or partially_received PO, computed as Σ (ordered_qty − received_qty) × unit_cost. That is real money spent that nobody can walk up to on site. It is computed fresh, never stored.

**Every tap target**

- A card → pushes One PO
- '+' → pushes New PO
- The COMMITTED figure → half sheet 'What committed means', naming ordered_qty and received_qty and listing which POs make it up

**States** — EMPTY: 'No purchase orders on this job. A PO is what you send a supplier or a subbie — it records what was ordered, what has landed, and what is still committed but not on site.' ONE ITEM: single card, no group header, and the COMMITTED strip still shows because one PO can be the whole exposure. LOADING: ghost cards. ERROR: red strip + Retry. OFFLINE: renders from cache; '+' disabled.

---

## One PO

**full screen**

**Reached by** — Purchase orders → a card. Route /job/:siteId/money/po/:poId.

**Roles** — Owner only.

HEADER: po_no, vendor, status chip. FACTS: issued_on, expected_on, the job (site_id), and the cost-code summary across its lines ('05 Materials' when they share one, '3 cost codes' when they do not). TOTAL: Σ po_lines.line_total. LINES: one row each — name, `{received_qty} of {ordered_qty} {unit}` with a progress dot (neutral before anything lands, amber mid-delivery, green once received_qty ≥ ordered_qty), unit_cost, line_total, cost_code. STILL TO COME: the unreceived value on this PO. purchase_orders.note in full. LINKED INVOICES: any expenses rows carrying this po_id — vendor, spent_on, amount, status (needs_review / confirmed / flagged) — which is the other half of the conversion below and the reason expenses.po_id exists ('ties a receipt to the order it settles, so a PO can show what has actually been invoiced against it instead of only what was ordered', schema_v6).

**Every tap target**

- A line → 'PO line' half sheet
- 'Receive against this PO' bottom bar (primary when status is sent or partially_received) → pushes Receive against this PO
- 'Turn this PO into an invoice' → pushes that screen — the client's explicit ask
- 'Mark sent' (primary when status is draft) → confirm modal, then status='sent'
- 'Cancel this PO' → confirm modal, then status='cancelled'
- 'Share' → OS share sheet, plain text (there is no poPdf in data/documents.ts)
- A linked expense row → pushes that expense

**States** — EMPTY (no lines): 'Nothing ordered on this PO yet.' with 'Add a line'. LOADING: skeleton header and three ghost lines. ERROR: red strip. CANCELLED: the whole screen dims by 20% with a grey banner 'Cancelled' and every action except Share is removed. RECEIVED: the bottom bar is replaced by 'Turn this PO into an invoice', because a fully received PO is exactly the one waiting on a supplier invoice. OFFLINE: reads from cache; every action disabled with 'Needs a connection'.

---

## PO line

**half sheet**

**Reached by** — One PO → a line.

**Roles** — Owner only.

name, ordered_qty with unit, received_qty, unit_cost, line_total (read-only, generated as ordered_qty × unit_cost), cost_code. In edit mode on a draft PO all fields are editable; on a sent PO only received_qty is, and the sheet says why: 'This order has been sent. Change what has landed, not what was ordered — a supplier is working from the sent copy.'

**Every tap target**

- Stepper and keypad on received_qty
- 'Save' → updates the po_lines row
- 'Delete this line' (draft only) → confirm modal
- Grabber → dismiss

**States** — ERROR: inside the sheet above Save. OFFLINE: opens and reads; Save disabled with 'Needs a connection'. Receiving quantities are arguably queueable field capture, but they change a cost figure an owner may be acting on, so they are not queued — see the offline note on Receive.

---

## Receive against this PO

**full screen**

**Reached by** — One PO → 'Receive against this PO'. Route /job/:siteId/money/po/:poId/receive.

**Roles** — Owner only. NOTE: a captain cannot do this even on their own job — schema_v18 widened materials to captains but not purchase_orders or po_lines.

Every line of the PO as a receiving row: name, `ordered {ordered_qty} {unit}`, `already received {received_qty}`, and a large number field for what landed today, pre-filled with the outstanding quantity so the common case — the whole order turned up — is one tap. A 'Receive all' link at the top does the same for every line. Beneath, a live summary: '{n} lines, {value} received' and what the PO's status will become when saved (partially_received or received — derived from whether every line reaches its ordered_qty).

**Every tap target**

- 'Receive all' → fills every field
- 'RECEIVE' full-width bottom bar → writes received_qty on each po_lines row and moves purchase_orders.status accordingly, then pops back
- 'Cancel' → confirm only if something was typed

**States** — EMPTY: no lines to receive — 'Everything on this order has landed.' with the button removed rather than disabled. VALIDATION: inline under a field — 'More than was ordered. Change the order, or receive what came and note the rest.' (Nothing in the schema forbids received_qty > ordered_qty; the app should warn, not block, because over-delivery happens.) ERROR: red strip above the bar with the verbatim message; nothing typed is lost. LOADING: on open only. OFFLINE: the bar is disabled and reads 'Offline — receiving needs a connection'. Typed quantities are held on the device so the screen survives being backgrounded on a site with no signal, and the bar re-enables when the connection returns.

---

## Turn this PO into an invoice

**full screen**

**Reached by** — One PO → 'Turn this PO into an invoice'. Route /job/:siteId/money/po/:poId/invoice.

**Roles** — Owner only.

THE CLIENT ASKED FOR THIS EXPLICITLY, AND IT MEANS ONE SPECIFIC THING — say it in the first line of the screen, because the word 'invoice' points in two directions in this business. A purchase order is money going OUT: this business orders from a supplier or a subbie. So the invoice a PO becomes is the SUPPLIER'S invoice arriving, and it lands in `expenses` with po_id set — NOT in `invoices`, which is the receivable ledger (invoice_no, client_name, builder_id, retention, progress claims) that drives claimed_inc and job_value_v. Writing a PO into `invoices` would invent a claim against the builder that does not exist and would corrupt every margin in the business. The conversion, concretely: creates one `expenses` row — company_id, site_id (from the PO), po_id (this PO), vendor (from purchase_orders.vendor), spent_on (defaults to today, editable), amount (defaults to the received value, Σ received_qty × unit_cost, editable — because a supplier bills what they delivered, not what was ordered), tax (defaults to amount/11, editable), cost_code (from the lines when they agree), receipt_path (the photo taken on this screen, uploaded to the `receipts` bucket at {company_id}/{site_id}/{file}), status='needs_review' — never auto-confirmed, and the screen says so. Optionally it also writes one `materials` row per PO line with expense_id set to the new expense, so the job's material list and its cost ledger reconcile instead of double-counting (job_cost_v excludes any expense whose id appears in materials.expense_id). THE SCREEN: a photo tile at the top ('Photograph the supplier's invoice' — camera first, files second), then the pre-filled fields above, then a toggle 'Also add {n} material lines to this job' defaulted on, then a preview of what the job's cost becomes: '{total_cost} → {new total}'. THE OTHER DIRECTION, and where it lives: if what the client means is the builder's order to THIS business becoming a claim, that is contracts.order_no → Raise a claim, and the screen carries one line pointing there: 'Looking for the builder's order? That is on the Contract, and you claim against it from Claims.'

**Every tap target**

- Photo tile → camera, or Files
- Any field → keypad or date picker
- 'Also add material lines' toggle → expands to show the lines that will be created, each with a checkbox
- 'SAVE AS AN INVOICE' full-width bottom bar → the writes above, then pops to One PO with a confirmation strip: 'Saved against {po_no}. It is sitting in needs-review until you confirm it.'
- 'Looking for the builder's order?' → pushes Contract

**States** — EMPTY: nothing received on the PO yet — the screen still opens (a supplier can invoice ahead of delivery) but the amount pre-fill falls back to the full ordered value with the note 'Nothing has been marked received on this order, so this is the full order value. Change it to what they actually billed.' LOADING: on open. ERROR: verbatim message above the bar; if the file uploaded but the expense insert failed, say exactly that — 'The photo is saved. The expense was not. Try again; it will not upload twice.' OFFLINE: the photo can be taken and is held on the device; the bar reads 'Offline — 1 supplier invoice waiting to send' and the write IS queued for this one screen, because a photographed docket is field capture, spent_on is chosen by the user rather than stamped by the server, and losing the photo is worse than a late row. Queued items are visible from the Money tab strip.

---

## New PO

**full screen**

**Reached by** — Purchase orders → '+'. Route /job/:siteId/money/po/new.

**Roles** — Owner only.

po_no (pre-filled as the next 'PO-{n}' above the highest existing number, editable; unique per company, so a clash is a real and specific error), vendor, job (pre-filled from the job you are in), issued_on, expected_on, note, and a repeating line editor: name, ordered_qty, unit, unit_cost, cost_code, with a running total under it. A two-way choice at the bottom for the status it saves as — 'Save as draft' or 'Save and mark sent'.

**Every tap target**

- 'Add a line' → appends a blank line
- A line → expands in place (not a sheet; a sheet over a form is a trap on a phone)
- 'SAVE' bottom bar → inserts purchase_orders then po_lines
- Vendor field → suggestions from distinct purchase_orders.vendor for this company

**States** — VALIDATION: 'A PO number is required.' On a unique-violation (23505) say the actual thing: 'PO-1043 is already used. Pick another number.' EMPTY: the form opens with one blank line. ERROR: verbatim above the bar; if the PO inserted but its lines failed, say so — 'The order saved but its lines did not. Open it and add them.' OFFLINE: bar disabled, 'Needs a connection', draft kept on the device.

---

## Owed to us

**full screen**

**Reached by** — Money → OWED TO US tile. Route /money/owed.

**Roles** — Owner only — invoices, invoice_status_v and invoice_payments are office-only read (schema_v14).

THE ARGUMENT, stated for the record: RAISING a progress claim is a desktop job and this screen does not pretend otherwise. A claim is invoice_lines with a cost_code, a pct_complete and an amount per line, priced against the approved estimate's value per cost code and net of every prior claim on the job — the desktop's ClaimEditor does exactly that arithmetic across three joined tables. Building it on a 390px column would produce a claim nobody checks, and a wrong claim to a builder costs more than a delayed one. WHAT MUST WORK ON A PHONE IS SEEING WHAT IS OWED AND CHASING IT, and that is this screen. TOP: OUTSTANDING (Σ invoice_status_v.outstanding where status='sent'), with OVERDUE beneath it in alert red (Σ outstanding where overdue — sent, due_on < today, amount > paid_amount). Then the AGING strip, four buckets with bars, exactly as the desktop computes them and for the reason it gives: NOT YET DUE / 1–30 / 31–60 / 60+ — 'money that hasn't fallen due yet is not a collection problem, and folding it into 1–30 would overstate the pile you have to chase'. Then THE CHASE LIST: every sent invoice with outstanding > 0, oldest due date first — invoice_no, the builder or client_name, the job, outstanding, and '{n} days overdue' in red or 'due {date}' in grey. Retention is listed separately at the foot: 'RETENTION HELD {retention_held} across {n} jobs — not overdue, but it is yours and it does not chase itself.'

**Every tap target**

- An invoice row → pushes One invoice
- An aging bucket → filters the list to that bucket in place
- A row's phone glyph → 'Chase this one' half sheet
- 'Chase everything overdue' full-width bottom bar → composes one message listing every overdue invoice and hands it to the OS share sheet. THE HONEST LIMIT: there is no mail or SMS transport in this app — the desktop uses a mailto: link and says 'a button that silently sends nothing is worse than no button'. The phone should say the same and use the share sheet, and the button must never claim anything was sent.
- The RETENTION line → half sheet listing retention_held per job

**States** — EMPTY (nothing outstanding): not 'No invoices' — 'Nothing is owed to you. Every claim you have sent has been paid.' with the retention line still shown if there is any. EMPTY (nothing overdue but money outstanding): the OVERDUE figure reads '—' with 'nothing overdue' and the chase bar is removed rather than disabled. ONE ITEM: single row, aging strip still drawn because one 90-day invoice is exactly when the strip matters. LOADING: the two figures skeleton, then the strip, then rows. ERROR: red strip + Retry. OFFLINE: everything renders from cache with 'as at {time}'; the chase actions STILL WORK, because tel:, sms: and the share sheet are OS handoffs that need no connection — that is the single best offline feature in this domain and the design should lean on it.

---

## Aging

**half sheet**

**Reached by** — Owed to us → an aging bucket header, or the OWED TO US tile.

**Roles** — Owner only.

The four buckets as rows with their amounts and counts, and one sentence of advice derived from where the money actually is, in the desktop's own words: when the 60+ bucket has anything, '{amount} has been sitting past 60 days. That is the call to make this week.'; when it is empty but 31–60 or 1–30 has money, 'Nothing past 60 days. Chase the 31–60 column before it ages further.'; when everything is in Not-yet-due, 'Nothing overdue.' Each bucket names its definition on tap-and-hold rather than in permanent text.

**Every tap target**

- A bucket → filters the parent list and dismisses
- Grabber → dismiss

**States** — No loading — computed from rows already held. OFFLINE: works.

---

## Claims on this job

**full screen**

**Reached by** — The job's Money tab → Claims; or Claimed against it → 'Claims on this job'. Route /job/:siteId/money/claims.

**Roles** — Owner only.

THE POSITION, three lines at the top from job_value_v: '{claimed_inc} claimed of {job_value_inc}' with claimed_pct, '{paid_inc} paid, {outstanding_inc} owed', '{to_claim_inc} left to claim' — in alert red with 'OVER-CLAIMED' when negative. THE LIST: every invoices row on this site, newest issued_on first — invoice_no, period ('Progress claim 3 — Aug', shown to the builder verbatim) or, when variation_id is set, '{co_no} — {description}' so a variation claim is never mistaken for a progress claim, then issued_on, amount (inc GST), and a status chip (draft / sent / paid / void) with an Overdue chip beside it when invoice_status_v.overdue. Drafts are visually separated at the top under a header 'Not sent — not claimed', because job_value_v excludes them from claimed_inc and an owner who thinks a draft counts will under-claim.

**Every tap target**

- A row → pushes One invoice
- 'RAISE A CLAIM' bottom bar → pushes Raise a claim
- The position figures → 'Claimed against it' half sheet

**States** — EMPTY: 'Nothing claimed against this job yet. {to_claim_inc} of the contract is there to claim.' with the CTA. EMPTY (no contract): 'No contract on this job, so there is nothing to claim against.' with 'ADD THE CONTRACT' instead. ONE ITEM: the single row plus the position figures; no group headers. LOADING: ghost rows. ERROR: red strip. OFFLINE: reads from cache; CTA disabled.

---

## One invoice

**full screen**

**Reached by** — Owed to us → a row; Claims on this job → a row; Contract → an invoice row. Route /job/:siteId/money/claims/:invoiceId.

**Roles** — Owner only.

HEADER: invoice_no, status chip, and an Overdue chip when invoice_status_v.overdue, with '{n} days past due'. THE AMOUNT: amount at 32px with 'inc GST' beneath, then ex_tax and tax_amount as a pair ('{ex_tax} ex GST + {tax_amount} GST at {tax_rate}%'), then OUTSTANDING (invoice_status_v.outstanding) in alert red when it is both non-zero and overdue. FACTS: issued_on, due_on, period, the job, the builder (builder_id or client_name), builder_job_ref ('their job number — their accounts team searches on this, not yours'), and when variation_id is set a prominent row 'Covers variation {co_no} — {description}' which is how the office answers 'have we actually billed VO-3'. RETENTION: retention_amount with retention_pct when either is non-zero. RCTI: when is_rcti, a chip reading 'RCTI — raised by the builder', because the document says so on its face. LINES: invoice_lines — description, cost_code, pct_complete when set, amount. PAYMENTS: the invoice_payments ledger — amount, received_on, method (bank / card / cash / cheque / other), reference — with the note that paid_amount and status are moved by a database trigger from these rows and are never set by hand.

**Every tap target**

- 'Record a payment' bottom bar (primary when outstanding > 0 and status is sent) → 'Record a payment' half sheet
- 'Chase this one' → 'Chase this one' half sheet
- 'Share the tax invoice' → generates the PDF with data/documents.ts invoicePdf (company details, the invoice, its lines, the contract, site name, builder name and ABN, and the variation when there is one) and hands the Blob to the OS share sheet. The document is titled 'Tax invoice' only when tax_amount > 0 — an invoice with no GST on it must not say it.
- 'Send this claim' (primary when status is draft) → confirm modal, then status='sent'
- 'Void this claim' → confirm modal
- A payment row → half sheet showing its note and reference, with Delete
- A line → half sheet with its cost_code and pct_complete

**States** — EMPTY (no lines): 'No breakdown on this claim — it is a single amount.' Not an error; invoice_lines is optional. EMPTY (no payments): 'Nothing received against this claim yet.' LOADING: header and amount skeleton. ERROR: red strip. VOID: the screen dims and every action but Share is removed, under a grey banner 'Void'. PAID: the amount block turns green with 'Paid in full {date}' from the last payment's received_on, and the bottom bar disappears. OFFLINE: full read from cache; 'Record a payment' and 'Send' are disabled with 'Needs a connection', while 'Chase' and 'Share the tax invoice' still work — the PDF is built on the device from data already loaded, so an owner can send a builder their invoice from a site with no signal, over the OS share sheet, using whatever transport the phone has.

---

## Record a payment

**half sheet**

**Reached by** — One invoice → 'Record a payment'.

**Roles** — Owner only.

amount, pre-filled with what is outstanding but fully editable — a builder paying part of a claim is the normal case, not an edge case, and this is the whole reason invoice_payments exists as a ledger rather than a boolean. received_on (defaults to today), method as five chips (Bank transfer / Card / Cash / Cheque / Other), reference ('their transfer reference, so a bank statement can be matched'), note. Under the amount, live: 'That leaves {outstanding − amount} owing' or, when it clears the invoice, 'That clears this claim.' One line at the foot: 'Paid and part-paid are worked out from these entries, not typed in.'

**Every tap target**

- 'RECORD IT' → inserts invoice_payments (company_id, invoice_id, amount, received_on, method, reference, note, created_by = me.id) and dismisses; the parent refreshes and the status chip moves on its own
- Grabber → dismiss with a confirm if an amount was typed

**States** — VALIDATION: 'Enter the amount that was received.' when the field is empty or zero. A NEGATIVE amount is allowed and the sheet says why on long-press: 'A bounced payment or a credit is an entry, not a deletion.' ERROR: inside the sheet above the button, verbatim. OFFLINE: the button is disabled and reads 'Offline — recording a payment needs a connection', with the typed values kept.

---

## Chase this one

**half sheet**

**Reached by** — One invoice → 'Chase this one'; Owed to us → a row's phone glyph.

**Roles** — Owner only.

The screen that justifies putting this domain on a phone at all. Top line: '{invoice_no} — {outstanding} — {n} days overdue'. Then the people, from builder_contacts for this job's builder, each a full-width row with name, their role (accounts / contract_admin / supervisor / estimator / other) and mobile or email: the accounts contact first, because that is who pays. Beneath them, builders.accounts_email as a fallback when no contact carries the accounts role. Then three actions, and a pre-written message shown in full before it is sent, never sent blind: 'Hi {name}, {invoice_no} for {site_name} — {outstanding} — fell due {due_on}, {n} days ago. Can you let me know when it is going through? Thanks, {company.name}.'

**Every tap target**

- A contact's number → tel: (places the call, writes nothing)
- 'Text' → sms: with the message pre-filled
- 'Email' → mailto: with the subject and body pre-filled
- 'Copy the message' → clipboard
- Grabber → dismiss

**States** — EMPTY (no builder linked, or no contacts): 'No contacts on file for this builder. Add one so a chase is one tap next time.' with a button into the builder. Do not disable the sheet — 'Copy the message' still works. LOADING: contacts load with the parent. ERROR: 'Could not read the builder's contacts', with the message and Copy still offered. OFFLINE: fully functional — tel:, sms: and mailto: are OS handoffs, and the message text is composed on the device from data already loaded. Say nothing about sending; the phone's own apps report that.

---

## Raise a claim

**full screen**

**Reached by** — Claims on this job → 'RAISE A CLAIM'; Job profitability → the bottom bar when to_claim_inc > 0. Route /job/:siteId/money/claims/new.

**Roles** — Owner only.

THE DECISION, argued: a full claim editor does not belong on a phone, but refusing to raise anything is wrong too — the owner standing on site who has just had a variation approved wants to bill it before they get back in the ute. So the phone offers exactly two narrow paths and sends everything else to the desktop. PATH ONE — CLAIM A VARIATION. Pick from the approved change_orders on this job that no invoice yet points at (invoices.variation_id is the link, and the whole reason it exists). Everything fills itself in: variation_id, contract_id, site_id, builder_id, amount from cost_impact grossed to inc GST at the contract's gst_rate, tax_amount, period '{co_no} — {description}', invoice_no as the next INV-{n}, issued_on today, due_on = today + contracts.payment_terms_days, retention_pct from the contract with retention_amount computed, and one invoice_lines row carrying the variation's description. The owner reviews four fields and taps once. PATH TWO — A FLAT PROGRESS CLAIM against the contract with no cost-code breakdown: an amount, a period, and nothing else, saved as a DRAFT with a banner 'Saved as a draft. Break it down by cost code on the desktop before you send it.' A claim with no lines is legal in the schema (invoice_lines is optional) and honest as a draft; sending one blind is not, so the phone cannot send a Path Two claim — only save it. Above both, the position: '{to_claim_inc} left to claim on this contract.' Below, one line for what the phone will not do: 'A full progress claim priced per cost code against the approved quote is a desktop job. This screen will not pretend to do it.'

**Every tap target**

- 'A variation' / 'A progress claim' segmented control at the top
- The variation picker → half sheet listing approved, unbilled variations with co_no, description and cost_impact
- Any pre-filled field → keypad or date picker, with the field marked as changed once touched
- 'SAVE AND SEND' (Path One only) → inserts invoices with status='sent' plus its line
- 'SAVE AS A DRAFT' (both paths) → inserts with status='draft'

**States** — EMPTY (Path One, nothing to claim): 'Every approved variation on this job has been billed.' with the path switched to progress automatically. EMPTY (no contract): the whole screen is replaced by 'No contract on this job. A claim has to be against something.' with 'ADD THE CONTRACT'. VALIDATION: invoice_no is unique per company — a 23505 must read 'INV-2041 is already used. Pick another number.' OVER-CLAIM WARNING (not a block): when the amount takes claimed_inc past job_value_inc, an amber line 'This takes you {x} past the contract value. Over-claiming is a real condition and the app will let you do it — it just will not hide it.' ERROR: verbatim above the bar. OFFLINE: both bars disabled, 'Offline — raising a claim needs a connection', typed values kept.

---

## Variations awaiting approval — all jobs

**full screen**

**Reached by** — Money → the VARIATIONS AWAITING APPROVAL strip; also the dashboard item on the job list. Route /money/variations.

**Roles** — Owner only for this company-wide view. A captain has no company-wide anything — their variations are per job, on the job's own screen, and money is stripped out.

Every change_orders row where status='pending_client', across every job, oldest raised_on first — because the oldest unanswered variation is the one at risk. Card: co_no (VO-n; the app numbers new ones VO but counts existing CO-n towards the high-water mark so a company that raised CO-1..7 never gets a VO-1 that reads like the first variation on the job), description, site_name, cost_impact, days_impact when non-zero, and 'raised {n} days ago' in amber past 14 days and alert past 30. TOP: the count and the total (company_overview_v.variations_pending and variations_pending_value) with one line: 'None of this is on any contract yet. It adds nothing to any job's value, and work covered by it should not be proceeding.' Below the pending group, a collapsed section 'Recently approved' — status='approved' with approved_on in the last 30 days — so an owner can see what did land.

**Every tap target**

- A card → pushes One variation
- Swipe a card → reveals 'Approve' and 'Decline', both of which open their sheets rather than acting on the swipe — a variation is a commitment of the company's money and must never be approved by a gesture
- The total → half sheet listing the pending value per job

**States** — EMPTY: 'Nothing waiting on a builder. A variation is extra work the builder has asked for — raise one, get it approved, and it goes onto the contract so you can bill it.' ONE ITEM: single card at full width, no group header, and the total strip suppressed (a total of one is the card). LOADING: ghost cards. ERROR: red strip + Retry. OFFLINE: cards from cache; both actions disabled with 'Needs a connection'.

---

## Variations on this job

**full screen**

**Reached by** — The job's Money tab → Variations; Contract → a variation row; Job profitability → the pending banner. Route /job/:siteId/money/variations.

**Roles** — OWNER: everything below. CAPTAIN, on their own jobs only: schema_v18 widened change_orders_read to captains via captains_site(), so this screen EXISTS for a captain — but with cost_impact, the scope-line amounts and the pending-value total removed, and with no Approve, Decline or Raise. Their version reads: co_no, description, detail, days_impact, status, approved_on, photos. Their header line is 'What the builder has asked for on this job, and what has been approved. Pricing and approval are the owner's.' EMPLOYEE: no access — captains_site() is false for them and the policy fails.

OWNER: three totals across the top from the site's change_orders — APPROVED (Σ cost_impact where approved, 'on the contract'), PENDING (Σ where pending_client, 'not on the contract'), DECLINED. Then the list, newest raised_on first: co_no, description, cost_impact, days_impact when non-zero, a status chip whose approved label reads 'On the contract' and whose rejected label reads 'Declined', and the date line — 'on {approved_on}' for approved, 'raised {raised_on}' otherwise. CAPTAIN: no totals, no amounts; the list carries co_no, description, status and date only.

**Every tap target**

- A card → pushes One variation (owner's or captain's version)
- '+ RAISE A VARIATION' bottom bar → pushes New variation. OWNER ONLY — the bar is absent for a captain, and the screen says why in one line rather than showing a disabled button: 'Raising and approving variations is the owner's — send them the photos and they will price it.'
- A total → filters the list to that status

**States** — EMPTY (owner): 'No variations on this job. When the builder asks for something that is not in the contract, raise it here — describe it, photograph it, price it. Approved, it goes onto the contract sum and you can bill it.' EMPTY (captain): 'Nothing extra has been raised on this job.' ONE ITEM: single card, totals still shown for the owner because one $18,000 variation is the whole story. LOADING: ghost cards. ERROR: red strip. OFFLINE: from cache; the raise bar disabled.

---

## One variation

**full screen**

**Reached by** — Any variations list → a card. Route /job/:siteId/money/variations/:coId.

**Roles** — OWNER: everything. CAPTAIN on their own job: the same screen with every dollar removed — no cost_impact tile, no scope-line amounts, no PDF (the PDF prints the price), and no Approve or Decline. State plainly in the build notes that RLS permits a captain to read cost_impact and the UI is choosing not to show it; if that matters, it needs a column-dropping view.

HEADER: co_no, status chip, site_name. FOUR IMPACT TILES, two by two: COST IMPACT (cost_impact, green when negative because a credit is good news, with '{n} scope lines' or 'no scope lines added' beneath) — OWNER ONLY; SCHEDULE IMPACT (days_impact as '+3 days' / 'No change' / '−2 days', with 'added to the programme' / 'schedule unaffected' / 'pulled in'); STATUS (the chip label with statusNote beneath: 'not sent to the builder yet' / 'awaiting the builder's approval' / 'approved by {signature.name}' / 'declined by the builder'); RAISED (raised_on with '{n} days ago'). THE DESCRIPTION in full (change_orders.description), then THE REASON (change_orders.detail) under a heading of its own — this is the client's 'reason', and it is `detail`, the only free-text field a variation has. PHOTOS: the client asked for photos on a variation and THERE IS NO LINK IN THE SCHEMA — change_orders has no photo column and site_files has no change_order_id. Draw the strip, and until the column exists back it with site_files rows on this site where kind='photo' and caption starts with the co_no, stating the convention on screen. Recommend to the client: add change_orders.photo_paths text[], or site_files.change_order_id. Do not draw a photo grid that has nothing behind it. SCOPE LINES (owner only): change_order_lines — name, detail, cost_code, amount — with the note 'the cost impact is the sum of these lines, never typed in separately, so the number the builder signs can never disagree with its own backup'. THE TIMELINE, four steps, which is how 'it goes onto the contract as a VO' is shown happening: 'Variation raised {raised_on}' / 'Sent for approval' (or 'Not sent yet') / 'Signed by {signature.name} {signature.signed_at}' (or 'Awaiting the signature' / 'Declined — no signature was recorded') / 'On the contract — added to the contract sum {approved_on}' (or, unapproved, 'Approve it to add its value to the contract sum'; or, declined, 'Not on the contract — it adds nothing and cannot be billed'). WHEN PENDING, a warning block: 'Raised {n} days ago and still waiting on approval. It adds nothing to the contract sum until then, so work covered by this variation should not be proceeding and it cannot be billed.'

**Every tap target**

- 'APPROVE' and 'DECLINE' as a paired bottom bar when status is pending_client — owner only, both open sheets
- 'SEND FOR APPROVAL' bottom bar when status is draft → confirm modal, then status='pending_client'
- 'Send a reminder' when pending → the share sheet with a pre-written note (no transport; do not claim it sent)
- 'Share as a PDF' → variationPdf from data/documents.ts (company, the variation, its lines, site name, builder name); unapproved it prints with a signature block and the not-proceeding line, approved it prints who signed, when, and the date it joined the contract sum. Owner only.
- A photo → full-screen viewer
- 'Bill this variation' (approved, and no invoice points at it) → pushes Raise a claim with the variation pre-selected
- 'Open the contract' → pushes Contract, scrolled to the value ladder

**States** — EMPTY (no scope lines): 'No scope lines on this variation, so its cost impact is zero.' EMPTY (no photos): 'No photos on this variation. A photo of what was asked for is what stops the argument later.' with 'Add a photo'. LOADING: header and tiles skeleton; the lines load with them. ERROR: red strip. DECLINED: the screen renders grey with the banner 'Declined by the builder — it adds nothing to the contract and cannot be billed', and every action but Share is removed. OFFLINE: full read from cache; Approve, Decline and Send are disabled with 'Needs a connection'; Share as a PDF still works because the PDF is built on the device.

---

## Approve this variation

**half sheet**

**Reached by** — One variation → 'APPROVE'.

**Roles** — Owner only. Absolutely not a captain: schema_v18 lets a captain READ a variation and says in terms that they cannot raise or approve one, 'that is a commitment of the company's money'. change_orders_office_write remains office-only.

The consequence first, in the largest text in the sheet: 'This adds {cost_impact} to the contract sum for {site_name}.' Then '{job_value_ex} becomes {job_value_ex + cost_impact}' so the owner sees the actual before and after, not an abstraction. Then the signature, which is the record of authority to bill: a single text field, 'Who approved it', with the instruction 'Type the builder's name exactly as it should read on the signature.' It is NEVER pre-filled with the owner's own name or any guess — the desktop is explicit about that and it is the right call. Below, one line: 'The date it joins the contract is stamped now, not when the signed copy comes back.'

**Every tap target**

- 'APPROVE IT' → updates change_orders to status='approved' with signature = {name, signed_at: now}; the database trigger stamps approved_on = current_date; the sheet dismisses to the confirmation below
- Grabber → dismiss unchanged

**States** — VALIDATION: with an empty name, the button stays disabled and the field carries 'Type the client's name exactly as it should read on the signature before recording it.' ERROR: inside the sheet, verbatim, button re-enabled. LOADING: the button spins and the sheet cannot be dismissed while it runs. OFFLINE: the button is disabled and reads 'Offline — approving needs a connection'. THIS ONE MUST NOT BE QUEUED, and the reason is in the schema: change_orders_stamp_approval() sets approved_on := current_date at write time, on the server. A variation approved on site on Friday with no signal and synced on Monday would be stamped Monday — the wrong date on the one field that records when the work became authorised and billable, which is exactly the field a builder's contract administrator will dispute. Refuse, and say so in those words if the owner taps the disabled bar: 'It would be recorded as approved on the day it syncs, not today.'

---

## It is on the contract now

**modal**

**Reached by** — Automatically, after Approve this variation succeeds.

**Roles** — Owner only.

The client asked to see the approval going onto the contract, so it is shown rather than implied. A brief confirmation over the variation screen: '{co_no} is on the contract.' then the ladder moving, in three lines with the middle one animating in: 'Contract sum {contract_sum}' / '+ approved variations {approved_variations}' (the new figure, with the change called out) / 'JOB VALUE {job_value_ex}'. Beneath: 'Added {approved_on}. You can bill it now.' It auto-dismisses after about four seconds like the clock-in celebration already in WorkerApp, and it is not a screen anyone navigates to.

**Every tap target**

- 'BILL IT' → pushes Raise a claim with this variation pre-selected
- 'Open the contract' → pushes Contract
- Anywhere else, or waiting → dismisses back to the variation, now showing the approved timeline

**States** — No empty, loading or error state — it only ever appears after a successful write, and the figures come from re-reading job_value_v for the site. If that re-read fails, show the confirmation without the ladder rather than an error: '{co_no} is on the contract.' alone. OFFLINE: unreachable, because the approval it follows cannot happen offline.

---

## Decline this variation

**half sheet**

**Reached by** — One variation → 'DECLINE'.

**Roles** — Owner only.

Two steps, because declining is the destructive direction — a declined variation adds nothing and cannot be billed, and change_orders_stamp_approval() clears approved_on the moment status leaves 'approved', so declining an already-approved variation silently removes value from the contract. Step one states it: 'Declined, {co_no} adds nothing to the contract and cannot be billed.' And when the variation is currently approved, an additional alert line: 'This is already on the contract. Declining it takes {cost_impact} back off the job's value and clears the date it was approved.' Step two is the confirm. There is no reason field — change_orders has nowhere to put one (detail is the variation's own description of the work, not the builder's refusal). Say that rather than drawing a field that discards what is typed; if the client wants a decline reason, it is a column to add.

**Every tap target**

- 'DECLINE IT' → updates status='rejected'; the trigger clears approved_on
- 'Keep it' → dismiss

**States** — ERROR: inside the sheet, verbatim. LOADING: button spins. OFFLINE: disabled with 'Needs a connection' — same reasoning as approval, in reverse: the trigger clears a date, and doing that on the wrong day is as wrong as stamping one.

---

## New variation

**full screen**

**Reached by** — Variations on this job → '+ RAISE A VARIATION'. Route /job/:siteId/money/variations/new.

**Roles** — Owner only.

co_no, pre-filled as the next VO-{n} above the highest existing VO or CO number on the company, editable and unique per company. THE JOB, pre-filled from the job you are in; picking it also sets contract_id from that site's contract, which is what links the variation to the contract it varies. DESCRIPTION — one line, the thing itself ('Extra ensuite floor, Lot 42'). REASON / DETAIL — multiline, mapped to change_orders.detail, prompted as 'Why it came up, and who asked for it. This is what you will be reading back to them in three months.' RAISED ON, defaulting to today. DAYS IMPACT, defaulting to 0, with a stepper. PHOTOS — camera first, because the whole point of raising one on a phone is that you are standing in front of the extra work (subject to the missing link column above). SCOPE LINES — a repeating editor of name, detail, cost_code, amount, with the running total shown live under it as COST IMPACT and the standing rule stated once: 'The cost impact is the sum of these lines. It is never typed in separately, so the price a builder signs always traces back to an itemised scope.' It saves as a DRAFT; sending is a separate, deliberate act on the variation screen.

**Every tap target**

- 'Add a line' → appends a blank scope line
- A line → expands in place
- Photo tile → camera or library
- 'SAVE AS A DRAFT' bottom bar → inserts change_orders (company_id, site_id, contract_id, co_no, description, detail, cost_impact, days_impact, status='draft', raised_on) then its change_order_lines, then pushes the new variation
- 'Cancel' → confirm if anything was typed

**States** — VALIDATION: 'A number is required.' / 'A description is required.' On 23505: 'VO-4 is already used on another variation — pick a different one.' EMPTY: opens with one blank scope line and the camera tile prominent. ERROR: verbatim above the bar; if the variation saved but its lines failed, say exactly that — 'The variation saved, but its scope lines failed. Open it and add them.' — because that is a real and recoverable half-write. OFFLINE: the bar is disabled with 'Offline — raising a variation needs a connection', the typed form and any photos taken are held on the device, and the bar re-enables on reconnect. Photos taken offline are queued and uploaded on reconnect regardless, so a photo is never lost.

---

## Variation scope line

**half sheet**

**Reached by** — New variation or One variation → a scope line, when the variation is a draft.

**Roles** — Owner only. A captain never sees a scope line's amount.

name, detail, cost_code (picker over the seed chart of accounts), amount. Under the amount, live: 'Cost impact becomes {new total}.'

**Every tap target**

- 'Save' → writes the change_order_lines row and re-derives cost_impact on the parent
- 'Delete this line' → confirm, then deletes and re-derives
- Grabber → dismiss

**States** — READ-ONLY once the variation has left draft: fields render as text with 'This variation has been sent to the builder. Change the scope and the price they were quoted no longer matches its backup.' ERROR: in the sheet. OFFLINE: opens, save disabled.

---

## Subcontractors

**full screen**

**Reached by** — Money → Subcontractors. Route /money/subbies.

**Roles** — Owner only. subcontractors and subcontract_work are office-only for BOTH read and write (schema_v15 put them under schema_v14's money rule), and schema_v18 explicitly refused to widen them to captains.

THE STATE OF PLAY, to be said to the client: these two tables have no screen anywhere in the product — not on the desktop, not on the phone. job_cost_v.sublet_cost sums subcontract_work.cost, so today that column reads $0 on every job and every margin in the business is overstated by whatever this business pays its subbies. The phone is the first surface that will write these rows, and it is the right surface, because the person who knows a subbie did six hours is the person on site. THE SCREEN: one card per subcontractors row — name, trade, and their rate as '{default_rate} per {rate_unit}' (hour / day / m² / item), with 'this month: {hours} hrs, {cost} across {n} jobs' summed from subcontract_work. Inactive ones are collapsed under a 'No longer used' header. TOP: total sublet cost this month across the company.

**Every tap target**

- A card → pushes One subcontractor
- '+' → 'New subcontractor' half sheet (name, trade, abn, contact, phone, email, default_rate, rate_unit)
- A card's phone glyph → tel: directly

**States** — EMPTY: 'No subbies on file. When you put a subbie on a job, their hours are part of what the job cost — and until they are recorded here, every margin in the app reads better than it is.' with '+ ADD A SUBBIE'. ONE ITEM: single card, no headers, no monthly total strip. LOADING: ghost cards. ERROR: red strip. OFFLINE: from cache; '+' disabled.

---

## One subcontractor

**full screen**

**Reached by** — Subcontractors → a card. Route /money/subbies/:id.

**Roles** — Owner only.

name, trade, abn, contact, phone, email, and the rate as '{default_rate} per {rate_unit}' — described on screen as 'what you pay them', distinct from workers.rate which is a wage, because the schema keeps them apart deliberately: a subbie has no login, no geofence, no timesheet and no SWMS gate. Then THEIR WORK, every subcontract_work row for them, newest worked_on first, grouped by job: '{quantity} {unit} at {rate} = {cost}' with cost_code and note, and cost shown as generated ('worked out as quantity × rate, so a typed total can never disagree with the maths'). When expense_id is set, the row shows 'their invoice attached' and links to it. TOTALS: this month, and all time.

**Every tap target**

- Phone / email → tel: and mailto:
- 'Edit' → 'Edit subcontractor' half sheet
- A work row → 'Log sublet work' half sheet in edit mode
- '+ LOG WORK' bottom bar → 'Log sublet work' half sheet
- 'Mark inactive' → confirm modal (sets active = false; never delete — subcontract_work references them)

**States** — EMPTY (no work logged): 'No work recorded for {name} yet.' with the CTA. LOADING: skeleton. ERROR: red strip. OFFLINE: reads; actions disabled.

---

## Sublet labour on this job

**full screen**

**Reached by** — Where the cost went → SUBLET; the job's Money tab → Sublet. Route /job/:siteId/money/sublet.

**Roles** — Owner only.

Every subcontract_work row for this site, newest worked_on first: subcontractor name, worked_on, '{quantity} {unit} at {rate}', cost, cost_code, note. Grouped by subcontractor with a subtotal each, so 'who is costing what on this job' answers itself. TOP: sublet_cost for the job (job_cost_v) with its share of total_cost. One line at the foot: 'These are cost records taken from a subbie's docket or invoice. They are not punches — they never touch the geofence and never appear in a timesheet.'

**Every tap target**

- A row → 'Log sublet work' half sheet in edit mode
- '+ LOG WORK' bottom bar → 'Log sublet work' half sheet
- A subcontractor's group header → pushes One subcontractor
- A row showing 'invoice attached' → pushes that expense

**States** — EMPTY: 'No sublet labour on this job. If you have had a subbie here, their hours are a cost of this job and are missing from its margin until they are entered.' with the CTA — the empty state has to say why it matters, because $0 sublet looks like good news and is usually just an unrecorded cost. ONE ITEM: the single row with no group header. LOADING: ghost rows. ERROR: red strip. OFFLINE: from cache; the CTA behaves as below.

---

## Log sublet work

**half sheet**

**Reached by** — Sublet labour on this job → '+ LOG WORK' or a row; One subcontractor → '+ LOG WORK'.

**Roles** — Owner only.

Five fields and no more, because this is a thing typed one-handed at the end of a day: SUBBIE (picker, pre-filled when arrived at from their own screen); WORKED ON (defaults to today); QUANTITY with UNIT as four chips (hour / day / m² / item, defaulting from the subbie's rate_unit); RATE (pre-filled from subcontractors.default_rate, editable — a rate agreed for this job is not the standing one); COST CODE. Under them, live: 'COST {quantity × rate}' with 'worked out for you' beneath, because subcontract_work.cost is a generated column and the sheet must not look like it is asking for a total. Then one line: 'This job's cost becomes {total_cost + this}.' Optional NOTE. Optional 'Attach their invoice' which sets expense_id.

**Every tap target**

- 'SAVE' → inserts subcontract_work (company_id, site_id, subcontractor_id, worked_on, quantity, unit, rate, cost_code, note, created_by = me.id)
- 'Attach their invoice' → pushes the receipt capture flow, returning with an expense_id
- 'Delete' (edit mode) → confirm modal
- Grabber → dismiss with a confirm if anything was typed

**States** — VALIDATION: quantity and rate are NOT NULL — 'How much, and at what rate' inline. EMPTY (no subbies on file): the sheet opens straight into 'Add a subbie first' with the new-subcontractor fields inline rather than bouncing the user to another screen. ERROR: in the sheet, verbatim. OFFLINE: this is the one commercial write that ARGUABLY should queue — worked_on is user-chosen, cost is generated from two user-typed numbers, and nothing about it is date-stamped by the server. Recommendation: queue it, show it in the offline strip as 'Offline — 1 subbie entry waiting to send', and re-run the insert on reconnect. If the client would rather nothing commercial queues at all, disable the button with 'Needs a connection' and keep the typed values — but say which was chosen.

---

## Builders

**full screen**

**Reached by** — Money → Builders. Route /money/builders.

**Roles** — Owner only for this screen. Note the split in the schema: builders is office-only read (schema_v16 closed it, because abn, payment_terms_days, default_retention_pct and rcti are the commercial terms of every relationship the business has), but builder_contacts is readable company-wide on purpose — 'the whole point of putting the site supervisor's mobile in the app is a chippie standing at a locked gate at 6:50am, and a phone number is not a commercial term'. So a captain reaches the supervisor's number through the JOB, not through this screen.

One card per builders row where active: name, and the two figures that matter — 'owed {Σ outstanding_inc across their jobs}' and '{n} jobs'. Beneath, their terms in small text: '{payment_terms_days} days, {default_retention_pct}% retention' and an 'RCTI' chip when rcti is true, meaning the builder raises the invoice, not this business. Sorted by what they owe, descending — a tiling subcontractor's risk concentrates per builder, not per house, and that is the entire reason the builders table exists.

**Every tap target**

- A card → pushes One builder
- '+' → 'New builder' half sheet

**States** — EMPTY: 'No builders on file. Linking a job to its builder is what lets you ask what one builder owes you, which jobs are theirs, and what terms were agreed.' ONE ITEM: single card. LOADING: ghosts. ERROR: red strip. OFFLINE: from cache.

---

## One builder

**full screen**

**Reached by** — Builders → a card; Contract → the builder name. Route /money/builders/:id.

**Roles** — Owner only for the commercial half. The contacts half is the same data a captain reaches from their job.

name, abn (formatted in the 2-3-3-3 grouping the PDF helper uses), address, phone, accounts_email, and the terms: payment_terms_days, default_retention_pct, rcti with the line 'an RCTI is raised by the builder, and the document says so on its face'. THEIR JOBS: each job_sites row with this builder_id — name, contract sum, claimed, outstanding. WHAT THEY OWE: their outstanding invoices, oldest first, with days overdue. THEIR PEOPLE: builder_contacts — name, role (supervisor / contract_admin / accounts / estimator / other), mobile, email — grouped by role with accounts first on this screen, because this is a money screen. builders.note in full.

**Every tap target**

- A contact's mobile → tel:; email → mailto:
- An invoice → pushes One invoice
- A job → pushes that job
- 'Edit' → pushes a builder edit form (full screen — eleven fields)
- '+ Add a contact' → half sheet

**States** — EMPTY (no contacts): 'No one on file for {name}. Add the site supervisor and whoever pays the invoices — both get rung from this screen.' EMPTY (no jobs): 'No jobs linked to this builder yet.' LOADING: skeleton. ERROR: red strip. OFFLINE: full read from cache and every tel:/mailto: still works.

---

## Company details — what goes on a tax invoice

**full screen**

**Reached by** — Account / settings → Company details. Route /settings/company.

**Roles** — Owner only. companies has a read policy company-wide but companies_office_write (schema_v16) is office-only update — and note that schema_v16 exists because v15 added these ten columns with no write policy at all, so a settings form would UPDATE zero rows and appear to save. The phone form must confirm from the returned row, not from the absence of an error.

Unglamorous and load-bearing: every invoice and variation PDF the app produces reads these columns, and a blank one prints a blank. name, abn, acn, licence_no ('BLD 187384 — goes on the invoice'), address, phone, email, bank_bsb, bank_account, bank_account_name, gst_registered. At the top, a completeness line that names the consequence rather than scoring the form: 'Your ABN is missing. A tax invoice over $82.50 has to carry it.' or 'Bank details are missing — a builder cannot pay an invoice that does not say where.' At the bottom, a live preview of the PDF header block exactly as invoicePdf will render it, so an owner sees the document, not the form.

**Every tap target**

- Any field → keyboard
- 'SAVE' bottom bar → updates companies and re-reads the row to confirm the write actually landed
- 'Preview a tax invoice' → generates a sample PDF with these details and opens the share sheet

**States** — EMPTY: every field blank with the completeness lines listing what is missing and what each one is for. VALIDATION: ABN is checked for 11 digits and reformatted; a wrong length is warned about, not blocked. ERROR: verbatim above the bar. THE SPECIFIC FAILURE TO HANDLE: an update that returns 200 having changed nothing means the caller is not office — show 'That did not save. Only an owner can change the company's details.' rather than a silent success. LOADING: fields fill from the row. OFFLINE: the bar is disabled with 'Needs a connection'; typed values kept.

---

## Offline — what is waiting

**half sheet**

**Reached by** — Tapping the offline strip that sits under the header on any Money screen when there is a queue or no connection.

**Roles** — Owner only in this domain (the same strip exists in the worker app for location pings and reads 'Offline — 3 locations waiting to sync').

Two sections. WAITING TO SEND: each queued item with what it is and when it was made — 'Supplier invoice against PO-1043, photographed 2:14pm', 'Subbie hours, Lot 42, 6 hrs, today' — with a retry-now button. Only the two queueable writes in this domain appear here; everything else refused rather than queued. WHAT IS NOT QUEUED, AND WHY — the honest half, listed plainly: 'Approving a variation, entering a contract, recording a payment and raising a claim all need a connection. The date on each of them is stamped by the server when it lands, so doing them now and sending them later would put the wrong date on the one thing you would be arguing about.' Then the figures' age: 'The numbers you are looking at were read at 7:12am.'

**Every tap target**

- 'Retry now' on an item → attempts the write immediately
- An item → the screen it came from
- 'Discard' on an item → confirm modal, then drops it (an owner who photographed the wrong docket needs a way out)
- Grabber → dismiss

**States** — EMPTY (offline, nothing queued): 'Nothing is waiting. You are offline, so the figures are from {time} and nothing can be changed until you are back on.' NOT OFFLINE, queue draining: rows show a spinner each. ERROR on retry: the row turns amber with the message and keeps its place — it must never disappear silently. OFFLINE: this sheet is the offline state, so it always works.

---
