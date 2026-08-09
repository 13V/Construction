# Inside one job

Inside one job — the job shell, the in-job tab bar that replaces the root one, and the work tabs (everything that is not money and not compliance)

52 screens. Generated from the codebase, not imagined — every figure named here comes from a table or view that exists. Part of the inventory referenced by `design/PROMPT-mobile-v2.md` section 7.

---

## Job shell — the container

**full screen**

**Reached by** — Tapping any row on the root Jobs list. The root tab bar (Jobs · Booking · Crew · Chat) is replaced wholesale by the job's own tab bar; the root bar does not remain underneath. Back arrow / swipe-right returns to the root list and restores the root bar. Deep link: /job/:siteId.

**Roles** — Owner: any job_sites row in the company (job_sites_read is company-wide). Captain: any job, but the shell reads captains_site(site_id) to decide whether the write affordances light up — on a job they do not run, a captain gets the same read-only shell as an employee. Employee: the root list only shows jobs they have an assignments row for, but job_sites_read is company-wide so a deep link can land them on any job; the shell must handle that rather than assume.

Holds three fixed pieces and one swapping body: the pinned job header, the tab bar, an offline/stale strip, and the active tab. State it owns and keeps across tab switches: site_id, the loaded job_sites row (id, name, address, job_type, status, lat, lng, radius_m, client_name, builder_id, builder_job_ref, supervisor_contact_id, captain_id, progress_pct, schedule_note), the site_programme_v row, the site_progress_v row, the site_waterproofing_v row, and open counts for defects / site_instructions. Deliberately NOT loaded here: job_value_v, job_profit_v, contracts, invoices — the shell must never fire those queries for a captain or employee, both because RLS returns nothing and because an empty money query is how a money tab ends up drawn as 'loading forever'.

**Every tap target**

- Back arrow → pops the whole job, restores the root tab bar
- Job title / header body → Job details half sheet
- Chat bubble in header (with unread count) → Job messages, full screen
- Job name chevron → Job switcher half sheet
- Any tab in the in-job tab bar → swaps the body, header stays pinned

**States** — Loading: header shows the job name and address carried over from the root list row (already in memory — never make the user watch the title load), everything below it is a skeleton; tab bar is drawn and tappable immediately. Empty: not applicable, a shell always has a job. Error: if the job_sites row fails to load, a full-bleed panel — 'Could not open this job' with the Postgres message underneath and a RETRY button; the tab bar is hidden so nothing can be tapped into a broken context. Offline: the shell renders from the last cached job_sites row with a strip reading 'Offline — showing what was last loaded, Tue 3:41 pm'; the tab bar stays live because Plans, Photos and Messages all have cached content worth reaching.

---

## Job header — pinned

**inline**

**Reached by** — Always visible at the top of every tab inside a job. Collapses on scroll from a two-line block to a single 44px bar carrying the job name and the status dot.

**Roles** — Owner and captain see the identical header. Employee sees the identical header minus the readiness chip's editable affordance (they cannot mark a predecessor done). Nobody sees a contract sum, a due date from contracts, or a margin — contracts is office-only in RLS (schema_v17) and job_value_v/job_profit_v are gated on current_is_office(), so those figures are not merely hidden, they are unavailable.

Line 1: job_sites.name, then a status pill from job_sites.status ('Active' / 'Starting soon' / 'Archived' — successFill / warnFill / fill). Line 2, wrapping: job_sites.address · job_sites.job_type · job_sites.builder_job_ref prefixed 'Lot' when present. Line 3 — the programme strip, from site_programme_v: our_start and our_end as 'We're on Mon 18 Aug – Fri 29 Aug', days_until_start as 'in 9 days' or 'started 3 days ago', start_moved_days as a warnInk chip '+9 days since Rev C' when non-zero, and a readiness chip from `ready`: true → successFill 'Ready', false → alertFill 'Not ready · N to go' from blockers_open, NULL → fill 'Readiness unknown' (the programme names no predecessors — this is genuinely 'we don't know', never a green light). Right edge: chat bubble with unread count, and the crew avatar stack (initials from crew_v, capped at 4 + '+n'). What the header CANNOT show and why: the builder's name. job_sites.builder_id is readable by everyone, but `builders` is office-only from schema_v16, so a captain or employee resolving builder_id gets zero rows. Today the header can only honestly show job_sites.client_name (free text, company-wide) and builder_job_ref. Fixing this needs a builders_public_v view exposing id + name only — flag it, do not draw a builder name a captain cannot load.

**Every tap target**

- Job name / address block → Job details half sheet
- Status pill → Job details half sheet, scrolled to status
- Programme strip → Programme window half sheet
- Readiness chip when false → Not-ready half sheet naming blocked_by
- Chat bubble → Job messages, full screen
- Avatar stack → On site right now half sheet
- Chevron beside the job name → Job switcher half sheet

**States** — Loading: name and address render from the list row already in memory; the programme strip is a single grey bar until site_programme_v resolves — it must not flash 'Ready' before it knows. Empty: no current programme → the strip reads 'No programme yet' in inkFaint and taps through to the Programme screen's empty state; no address → the address slot is dropped entirely rather than showing an em-dash. Error: site_programme_v failing leaves the strip reading 'Programme unavailable — tap to retry'; the rest of the header still renders, because a failed view must never take the job title down with it. Offline: header renders fully from cache; the programme strip gains a small clock glyph and 'as at Tue 3:41 pm'.

---

## Job details half sheet

**half sheet**

**Reached by** — Tapping the job name, address block or status pill in the pinned header.

**Roles** — Owner: every field below plus an EDIT affordance (job_sites_write is office-only, so a captain's edit would be a zero-row update that reports success — schema_v13 documents exactly that failure mode; the button must not exist for them). Captain: read-only, plus the site supervisor row. Employee: read-only, same fields, no supervisor edit.

job_sites.name as the sheet title. Then: address (with a map-pin glyph), job_type, status, client_name, builder_job_ref labelled 'Builder's job ref', schedule_note as free text under 'Dates the office noted'. A CREW row: job_sites.captain_id resolved through crew_v to a name and trade, labelled 'Run by'. A SUPERVISOR row: job_sites.supervisor_contact_id → builder_contacts (name, role, mobile, email) — builder_contacts_read is deliberately company-wide (schema_v16 says so in as many words: a chippie at a locked gate at 6:50am needs the number), so this is the one builder-side field every role can have. A GEOFENCE row: radius_m as 'Clock-in fence: 150 m'.

**Every tap target**

- Supervisor row → Person half sheet (stacks above this one)
- Address → opens the OS maps app with lat/lng (action)
- Phone number on the supervisor row → tel: (action)
- 'Run by' row → Person half sheet for the captain
- EDIT (owner only) → full sheet form over job_sites
- Drag handle / tap outside → dismiss

**States** — Loading: the sheet opens instantly with name/address/status (in memory) and shows two skeleton rows where the supervisor and captain resolve. Empty: no supervisor_contact_id → a row reading 'No site supervisor recorded' with, for an owner, 'Add one'; for a captain, 'Ask the office to add one' — never a dead grey row. No captain_id → 'Nobody named as running this job'. Error: a failed builder_contacts read shows 'Could not load the supervisor' inline in that row only. Offline: fully readable from cache; the owner's EDIT button is disabled with a caption 'Editing needs a connection' — job_sites has no offline write path.

---

## Person half sheet

**half sheet**

**Reached by** — Tapping any human anywhere inside the job: an avatar in the header stack, a name on the Crew tab, the supervisor row, a photo's 'taken by', a message author, a defect's raised_by, a shift row.

**Roles** — All three roles see the same sheet for a crew member: name, initials, trade, role, and what they have done on THIS job. Nobody sees workers.rate. This is load-bearing and currently broken in the built app: WorkerApp.tsx:2365 selects from `workers`, not from crew_v, and workers_read is company-wide — so every pay rate in the company is on the wire to every phone. crew_v exists precisely to fix this (schema_v14, widened in v18) and is referenced nowhere in the codebase. The redesign must read crew_v.

For a crew member, from crew_v: name, initials avatar, trade, role rendered in trade language ('Crew captain' / 'Owner' / blank for employee), and active. Then this-job facts: hours on this job from shifts (sum of ended_at − started_at − break_minutes, closed shifts only), last on site (max shifts.started_at), whether they are on the clock right now (a shifts row with ended_at IS NULL and this site_id), and how many photos on this job carry their uploaded_by. For a builder_contacts person: name, role ('Site supervisor' / 'Contract admin' / 'Accounts' / 'Estimator'), mobile, email, note.

**Every tap target**

- Call → tel: (action)
- Message → for a crew member, opens or creates the DM channel and pushes Job messages; for a builder contact, sms: (action)
- Email → mailto: (action)
- 'N hours on this job' → Crew tab filtered to that person (owner and captain only; an employee only has shifts_read for themselves so the row would be empty)
- Dismiss

**States** — Loading: name and initials are already known from wherever it was tapped, so the sheet opens with them and the hours/last-seen block skeletons in. Empty: never on site → 'Not been on this job yet' rather than '0 hrs'. Error: the shifts query failing shows 'Could not load their hours here'; contact details still show. Offline: contact details and name come from cache and stay tappable — call and SMS are OS handoffs that work without the app having data. The hours block shows its cached figure with a timestamp.

---

## Job switcher half sheet

**half sheet**

**Reached by** — Tapping the chevron beside the job name in the pinned header. Exists so a person on three jobs in a morning does not have to pop back to the root list and lose their tab.

**Roles** — Owner: every job_sites row, grouped active / starting soon / archived. Captain: same list, with their own jobs (captain_id = them, or a crew they captain is booked on) pinned to the top under 'Your jobs'. Employee: jobs they have an assignments row for, under 'Booked on'; everything else is collapsed behind 'All company jobs' because job_sites_read does not restrict them and pretending otherwise would be a lie the schema does not support.

One row per job: job_sites.name, job_sites.address on the second line, a status dot, and a right-aligned readiness/window chip from site_programme_v (our_start as 'On 18 Aug' or 'Not ready'). The current job is marked with a tick and its row is accentFill.

**Every tap target**

- A job row → swaps the shell to that job, KEEPING the current tab (someone comparing photos across two jobs stays on Photos)
- 'All company jobs' disclosure (employee) → expands the rest of the list
- Dismiss

**States** — Loading: the current job's row renders from memory, the rest fade in. Empty: one job only → the sheet does not open at all; the chevron is not drawn. Two jobs → the sheet still opens and shows both, because a two-item list is exactly when switching is most valuable. No jobs at all is impossible here (you are inside one). Error: 'Could not load your other jobs' with a retry, current job row still shown. Offline: shows the cached job list with a strip; tapping a job that has no cached header data lands on the shell's own offline state rather than a spinner.

---

## In-job tab bar

**inline**

**Reached by** — Replaces the root tab bar the moment a job is entered. 56px plus safe-area inset, icon over 10.5px label, active tab in accent.

**Roles** — Owner — five tabs: Job · Plans · Site · Crew · Money. Captain — four: Job · Plans · Site · Crew. There is no Money tab, not a disabled one: a greyed tab is an invitation to ask why, and every table behind it (contracts, invoices, estimates, purchase_orders, job_value_v, job_profit_v, job_cost_v, subcontractors, subcontract_work) returns zero rows to a captain by RLS. Employee — three: Job · Plans · Site. No Crew tab, because shifts_read gives an employee only their own rows and 'who else is on' is already on the Job overview; their hours live on the root Time tab. Messages is NOT a tab in any variant. It is the chat bubble pinned in the header, on every tab, carrying its own unread count — it is the one thing you want from wherever you are standing, and it is the only in-job destination with live unread state, which a tab bar handles badly beside four tabs that do not.

The nineteen things the client listed, resolved into four or five tabs. The grouping is by the question being asked, not by table: JOB (overview) — where are we up to. Programme, Scheduling, Progress, Live sign on & off summary, what needs attention. PLANS (what we are building, read before you start) — Plans, drawings, Scope, the tile schedule (tiles + codes + suppliers, grout, silicone, angles, mitres, grates, strip drains), SWMS documents (link out to compliance). SITE (what has happened, written from site) — Photos, Site instructions, Materials and deliveries, Defects, Progress entry, Waterproofing status, the daily log. CREW (who and how long) — who is booked, who is on the clock, hours per person on this job, sublet labour (owner only). MONEY (owner only) — Quote, Contract, Contractor PO, Variations pricing, Contractor invoice, Current cost, Projected profit. Not this domain. Why these five and not nineteen: Plans and Site split cleanly on tense. Everything on Plans is a specification that existed before anyone turned up — site_files kind='document', site_products, products, product_documents. Everything on Site is a record of something that happened, written mostly from a phone standing on the slab — site_files kind='photo', site_instructions, defects, progress_entries, materials, daily_logs, waterproofing. That split also happens to be the read/write split, which means the two tabs have genuinely different bottom bars: Plans has no primary CTA, Site's is a camera. Materials sits on Site rather than Plans because `materials` records deliveries (status ordered/delivered/used/returned, ordered_on, delivered_on) — what turned up. The tile SCHEDULE sits on Plans because site_products records what was specified. Two tables, two tenses, two tabs. They are joined nowhere in the schema today, which is a real gap (see the Tile schedule screen). Programme is on the Job overview as a summary strip pushing to a full screen, not a tab: it is read weekly, not daily.

**Every tap target**

- Job → Job overview
- Plans → Plans tab
- Site → Site tab
- Crew → Crew tab (owner, captain)
- Money → Money tab (owner only — other domain)
- Long-press a tab → nothing. Deliberately: gloves.

**States** — Loading: the bar is drawn and live before any tab content loads. Empty: not applicable. Error: unaffected by a tab's failure — a broken Site tab must never take the bar with it. Offline: all tabs stay tappable; each shows its own cached content and its own strip.

---

## No-access / archived / not-booked notice

**full screen**

**Reached by** — Entering a job that is archived, or that an employee reached by deep link with no assignments row, or where the job_sites read returns nothing (deleted under them, or a stale push notification).

**Roles** — Employee: 'You are not booked on this job' with the job name and address still shown (job_sites_read allows it, so pretending the job does not exist would be a lie) and a note that photos and plans are still readable. Captain on a job they do not run: a quieter inline strip on the Site and Crew tabs — 'You are not running this job, so you can look but not change anything.' Owner: only the archived case applies.

For archived: the job header greyed, a band in `fill` reading 'This job is archived. Nothing here can be changed.' and the tab bar reduced to Job · Plans · Site with every write affordance removed. For not-booked: job name, address, and three buttons — Look at the plans, Look at the photos, Message the crew. For a genuinely missing row: 'That job is not there any more' and a single button back to the jobs list.

**Every tap target**

- Look at the plans → Plans tab
- Look at the photos → Photos
- Message the crew → Job messages
- Back to jobs → pops to root

**States** — Loading: shows the shell skeleton first; this state is only reached once the read has actually resolved, so it never flashes on a slow connection. Empty/Error/Offline: this screen IS one of those states. Offline with no cached row for that site_id: 'Can't open this job while you're offline — it hasn't been loaded on this phone yet.'

---

## Offline and stale strip

**inline**

**Reached by** — Appears under the pinned header whenever navigator.onLine is false, a write has been queued, or the loaded data is older than ~10 minutes.

**Roles** — All three, identically.

Three distinct messages, never merged. (1) 'Offline — showing what was last loaded, Tue 3:41 pm'. (2) 'Offline — 2 photos and 1 defect will send when you're back'. (3) 'Last updated 22 min ago — pull to refresh'. Honest note for the design brief: only the location ping loop in WorkerApp has a queue-and-drain today (pending ref, PING_INTERVAL_MS). Every other write in the job — a photo, a defect, an instruction, a progress entry, a message — goes straight to supabase-js and fails outright with no connection. Message (2) describes a queue that has to be built; drawing it against today's code would be drawing a promise the app does not keep.

**Every tap target**

- The strip when it names queued writes → a half sheet listing each queued item, what job it is for, and a RETRY NOW
- Pull-to-refresh anywhere below the header → re-reads the tab

**States** — This is a state. It has no empty or error state of its own; if a queued write fails permanently it changes colour to alertFill and reads '1 photo could not send — tap to see why'.

---

## Job overview (JOB tab)

**full screen**

**Reached by** — The tab a job opens on. Tab 1 of the in-job bar.

**Roles** — Owner: everything below including the money row (a single line handing off to the Money tab — never a figure, the tab owns those). Captain: everything except the money row. Employee: the top three blocks (today, programme, what's on) and the photos strip; no progress entry, no attention list — attention is a management view and an employee's version of it is their own SWMS gate, which lives in compliance.

Block 1 — TODAY: today's date and day ('Sat, 9 Aug'), then who is on the clock at this job right now — shifts where site_id = this job and ended_at IS NULL, resolved through crew_v to initials and trade, as an avatar row with 'Nobody on site' when empty. Beside it, hours logged on this job today (sum over today's shifts, net of break_minutes). NOTE: 'Live sign on & off' for a captain cannot come from geofence_events — events_read is own-rows-or-office, so a captain reading their crew's clock_in events gets nothing. It has to be derived from shifts, which schema_v18's shifts_captain_write (`for all`) does grant them on their own jobs. Design against shifts. Block 2 — OUR WINDOW: site_programme_v.our_task, our_start, our_end, days_until_start, start_moved_days, revision, received_on. Rendered as a sentence, not a Gantt: 'Tiling, Mon 18 Aug – Fri 29 Aug. That's in 9 days. Moved +9 days since Rev C.' Block 3 — READY?: site_programme_v.ready and blocked_by. True → green 'Everything we follow is done'. False → red 'Not ready — screed to bathrooms, plumbing rough-in' listing blocked_by verbatim, and the line that justifies the whole screen: sending a crew to a job that is not ready is a day's wages against work that cannot be invoiced. NULL → 'Readiness unknown — the programme names nothing we follow'. Block 4 — PROGRESS: site_progress_v.pct_complete, area_count, last_assessed_on, done_quantity / total_quantity. A bar plus '62% · 8 areas · last measured Tue 5 Aug'. Weighted, and the screen should say so where there is room, because a flat average across a 2 m² powder room and 300 m² of balconies is how a claim goes wrong. Block 5 — NEEDS ATTENTION: counted rows, each a tappable line. Open defects (defects where status in open/in_progress), open instructions (site_instructions status='open'), instructions marked is_variation=true with change_order_id IS NULL — 'N instructions that change scope with no variation raised' is the single most valuable line on this screen for a tiling subcontractor. Wet areas not signed off (site_waterproofing_v.outstanding_count), and signed off without a flood test or a photo (unflooded_count, unphotographed_count) — a certificate that will not hold up. Materials still on order (materials status='ordered' with a delivered_on in the past or null). Block 6 — RECENT: the last five things that happened, merged from site_files.created_at, daily_logs.confirmed_at, defects.raised_on, site_instructions.received_on — each with an initials avatar and a plain sentence. Block 7 (owner only) — a single row 'Money' with a chevron, no figure on it.

**Every tap target**

- Avatar row / 'on the clock' → On site right now half sheet
- Our window block → Programme window half sheet
- Readiness chip when false → Not-ready half sheet
- Progress bar → Progress summary half sheet, then push to Progress
- Any attention row → pushes the matching list (Defects, Site instructions, Waterproofing, Materials) pre-filtered to the state that was counted
- A recent-activity row → the thing itself (photo viewer, daily log, defect half sheet)
- Money row (owner) → Money tab

**States** — Loading: blocks appear as their queries land, top-down, each with its own skeleton — the date block is instant, the programme block is one query, progress is one, the counts are four. Never one page-wide spinner. Empty: a brand-new job shows 'This job hasn't started yet' with the three things the office still owes it (no programme, no plans, no scope), each a row the owner can act on and a captain can only read. Nothing needing attention → the block is replaced by a single green line 'Nothing needs attention on this job', not hidden — an absent block reads as a failed load. Error: per-block. A failed site_programme_v leaves blocks 2 and 3 as one retry card and leaves the rest alone. Offline: whole screen from cache with the stale strip; the count rows keep their last numbers and are dimmed slightly with 'as at 3:41 pm'.

---

## Programme window half sheet

**half sheet**

**Reached by** — Tapping the programme strip in the pinned header, or block 2 on the Job overview.

**Roles** — All three, identically. programmes and programme_tasks are company-wide readable by design (schema_v21: 'are we on next Tuesday' is asked from a ute, not a desk).

From site_programme_v: our_task as the title, our_start – our_end as the big figure, days_until_start, our_status, our_pct. Then a comparison row: prev_starts_on struck through beside starts_on with start_moved_days as '+9 days' in warnInk. Then programme provenance: revision, received_on, and the programme's own name (programmes.name, which is the imported file name) and source (pdf/excel/csv/manual). A footer line: 'Rev C, received 22 Jul, read from Lot42-Programme-RevC.pdf'.

**Every tap target**

- 'See the whole programme' → Programme, full screen
- The revision line → Changed in this revision, full screen
- The source file name → Document viewer, full screen (only when programmes.file_id or storage_path is set; the row is not drawn otherwise)
- Dismiss

**States** — Loading: opens with our_task and dates already in memory from the header; the provenance footer skeletons. Empty: no current programme → this sheet is not reachable; the header strip taps straight through to the Programme empty state instead. our_start null (the programme has no line marked is_ours with an end date still ahead) → 'No tiling line on the current programme with a date still ahead' and a button, for owner and captain, 'Tick the right line' pushing to Programme. Error: 'Could not load the programme window' with retry. Offline: renders from cache with the timestamp; the two pushes still work if their content is cached.

---

## Not-ready half sheet

**half sheet**

**Reached by** — Tapping the red readiness chip in the header or block 3 of the Job overview.

**Roles** — Owner and captain can mark a predecessor done (programme_tasks office_write is widened to captains_site). Employee reads it — knowing the screed is not down is the point of showing them.

Title 'Not ready for us'. Then site_programme_v.blockers_open as a count and blocked_by expanded into one row per predecessor: programme_tasks.name, trade, ends_on, status. Each row shows how overdue it is against ends_on. A closing line in plain words: every one of these has to be finished before a crew is worth sending.

**Every tap target**

- A predecessor row → Programme task half sheet
- 'Mark done' on a row (owner, captain) → confirm, then updates programme_tasks.status='done', pct_complete=100 and re-reads site_programme_v so readiness flips on this screen
- Dismiss

**States** — Loading: the count is known from the header; rows skeleton. Empty: unreachable when ready is true or null. One blocker: the sheet still lists it as a single row with the same heading — 'Not ready for us · 1 to go'. Error: 'Could not load what's holding us up'; the count from site_programme_v still shows. Offline: readable; 'Mark done' is disabled with 'Needs a connection — this changes the programme for everyone'.

---

## On site right now half sheet

**half sheet**

**Reached by** — Tapping the avatar stack in the pinned header or the TODAY block on the Job overview.

**Roles** — Owner and captain: everyone with an open shift on this job, plus who is booked today from assignments. Employee: themselves plus whoever else has an open shift here — this is the 'who is on site with you' the mobile brief calls for, and it stops at this job.

Section ON THE CLOCK: one row per shifts row with site_id = this job and ended_at IS NULL — initials, name and trade from crew_v, started_at as 'since 6:52 am', elapsed as '2h 14m', and a small marker for shifts.source='manual' or edited=true so an edited punch is never silently presented as a clean one. Section BOOKED TODAY: assignments where site_id = this job and starts_at is today and published=true — name, trade, the booked window, and crews.name + crews.colour where crew_id is set, so a booked crew reads as one block rather than three people. Section OFF SITE: booked but no open shift.

**Every tap target**

- A person row → Person half sheet
- A crew name → the crew's members expand inline
- 'All hours on this job' → Crew tab (owner, captain)
- Dismiss

**States** — Loading: rows skeleton, the count in the heading comes from the header. Empty: nobody on the clock → 'Nobody on site right now', and if there are bookings, the BOOKED TODAY section still shows. Nobody booked and nobody on → 'No one is on this job today' with, for an owner, 'Book a crew' pushing out to the root booking grid. Error: 'Could not load who's on'. Offline: cached rows with the elapsed timers frozen and labelled 'as at 3:41 pm' — a running timer that is not running is worse than no timer.

---

## Programme

**full screen**

**Reached by** — Push from the Programme window half sheet, or from the Job overview's programme block.

**Roles** — All three read. Owner and captain can tick is_ours / is_predecessor and mark a predecessor done. An employee sees the same list with no ticks and no buttons.

Header: programmes.name, revision, received_on, source, imported_by resolved to a name. Then the task list from programme_tasks ordered by starts_on: ref, name, trade, starts_on, ends_on, duration_days, pct_complete, status. Our lines (is_ours) are bold with an accent 'Ours' chip; predecessors (is_predecessor) carry 'We follow' in warnFill or 'Done' in successFill. Any row where prev_starts_on differs from starts_on shows the old date struck through beneath the new one. A phone shows this as a list, never a Gantt — the schema stores dated tasks precisely because redrawing the bars was never the value.

**Every tap target**

- A task row → Programme task half sheet
- 'Ours' / 'We follow' toggles on a row (owner, captain) → writes programme_tasks.is_ours / is_predecessor, then re-reads site_programme_v because readiness and the header both key off them
- 'What changed in this revision' → Changed in this revision, full screen
- 'Import a revision' (owner, captain) → Import a programme revision, full sheet

**States** — Loading: list skeleton of six rows. Empty: no programme at all → a proper empty state, not a blank list: 'No programme yet. The builder issues one after the contract is signed; import it here and this job will say when the crew is on, whether it will be ready, and what moved.' with IMPORT for owner and captain, and for an employee 'The office will add it.' A programme with tasks but none marked is_ours → an inline warnFill note above the list saying readiness and the window are both off until a line is ticked. One task: shown as one row, with the empty-state copy about ticking still present. Error: full-screen retry card carrying the Postgres message. Offline: last-loaded revision from cache with the strip; ticks and import disabled with a caption saying why.

---

## Programme task half sheet

**half sheet**

**Reached by** — Tapping any row in the Programme list, or a blocker row in the Not-ready sheet.

**Roles** — Owner and captain get the two ticks and 'Mark done'. Employee reads only.

programme_tasks.name as the title, ref as a small mono label. Then starts_on – ends_on, duration_days, trade, status, pct_complete. If prev_starts_on or prev_ends_on is set, a MOVED block: old dates struck through, new dates bold, and the day difference. Two toggles: 'This is our work' (is_ours) and 'We follow this' (is_predecessor) — the schema makes them mutually exclusive in the import UI and the sheet should too. note as free text.

**Every tap target**

- 'This is our work' toggle → writes is_ours
- 'We follow this' toggle → writes is_predecessor
- 'Mark done' → confirm, then status='done', pct_complete=100
- Dismiss

**States** — Loading: opens fully populated — everything is already in the list's memory; no query. Empty: not applicable. Error: a failed toggle reverts the switch and shows an inline red line with the message, rather than leaving the UI ahead of the database — schema_v13 is a whole migration about a button that reported success on a zero-row write, and this must not repeat it: read the row back and check it changed. Offline: toggles and Mark done disabled with 'Needs a connection'.

---

## Changed in this revision

**full screen**

**Reached by** — Push from the Programme screen or the Programme window half sheet, when any programme_tasks row has prev_starts_on differing from starts_on.

**Roles** — All three read; no writes on this screen at all.

One row per moved task: name (bold with an 'ours' marker where is_ours), prev_starts_on struck through, starts_on bold, and the delta in days — alert when positive (later), success when negative (earlier). Sorted by absolute delta, biggest first, because the nine-day slip is the thing to see and a one-day shuffle is not. A summary line at the top: 'N lines moved between Rev B and Rev C.'

**Every tap target**

- A row → Programme task half sheet
- 'The whole programme' → back to Programme

**States** — Loading: skeleton rows. Empty: unreachable — the entry point is only drawn when something moved. If it is reached anyway (a race), 'Nothing moved in this revision'. One moved line: shown as one row, with the summary reading 'One line moved' — this is often the important case, a single nine-day slip on our own line. Error: retry card. Offline: from cache, read-only anyway so nothing is disabled.

---

## Import a programme revision

**full sheet**

**Reached by** — 'Import a revision' on the Programme screen. Owner and captain only.

**Roles** — Owner and captain (programmes/programme_tasks office_write is widened by captains_site). Employee never sees the entry point.

A file picker accepting .xlsx, .xlsm, .csv, .tsv, .pdf. Spreadsheets are parsed in the browser (src/data/sheet.ts — extractProgramme); a PDF Gantt goes to /api/parse-programme. Then the REVIEW list, which is the whole point: one row per extracted task with ref, name, starts_on, ends_on, and two checkboxes, 'ours' and 'we follow'. A banner carrying the extractor's own note verbatim ('Sheet 2: 41 rows read, 3 undated'). Nothing is written until IMPORT is tapped. The import then inserts programmes (status 'current', which supersedes the previous by trigger) and its programme_tasks, then calls programme_carry_previous() so the previous revision's dates land on prev_starts_on / prev_ends_on. Phone-specific caveat to design for: a builder's programme PDF is commonly 10–25 MB and the client caps at 24 MB. On a site connection this is a minutes-long upload, so it needs a real progress state and a 'this will take a while on mobile data' warning, not a spinner.

**Every tap target**

- Choose a file → OS file picker (action; needs the file-access permission prompt on iOS)
- 'ours' / 'we follow' checkbox on any review row → toggles locally only
- IMPORT — SUPERSEDES THE CURRENT ONE → writes, then returns to Programme
- Discard → drops the draft with a confirm if any tick was changed
- Cancel → dismiss

**States** — Loading: 'Reading…' on the button while parsing; a determinate progress bar for the PDF upload. Empty: extraction returning zero dated rows → 'Nothing dated could be read off that PDF. Ask the builder for the Excel export, or enter the dates by hand.' — the honest message, not a fake empty list. Error: 501 from the parser → 'Reading a PDF programme needs the AI key configured'; oversize → 'That PDF is too large. Send the tiling pages on their own.' A partial failure (programme inserted, tasks failed) must say exactly that: 'The programme saved but its tasks failed', because a silent half-import leaves a job with a blank current revision. Offline: the whole entry point is disabled with 'Importing a programme needs a connection' — parsing happens locally but the write does not, and a locally parsed draft that cannot be saved is a trap.

---

## Plans tab

**full screen**

**Reached by** — Tab 2 of the in-job bar.

**Roles** — All three see the same list — site_files_read is company-wide. Only the office can upload a sheet (site_files_office_write; field insert requires uploaded_by = self and is meant for photos), so the ADD SHEET affordance appears for owners only. A captain uploading a drawing would succeed as a field insert but with no version/supersedes control, which is how a superseded sheet gets loose; keep it out.

Four sections, in this order. (1) DRAWINGS — site_files where kind='document', split into CURRENT and 'SUPERSEDED — DO NOT BUILD FROM'. A sheet is superseded when another row names it in `supersedes` (the only honest test; a version string alone cannot tell you something newer exists). Each row: name, version rendered as 'REV C', created_at as 'Issued 22 Jul', and an open plan_pins count where resolved_at IS NULL. Superseded rows are alert-bordered and red before they are opened. (2) SCOPE OF WORKS — a single row pushing to the Scope screen. (3) TILE SCHEDULE — a row showing the count of site_products for this job and pushing to the Tile schedule. (4) SWMS AND SAFETY DOCS — safety_documents for this site, count and status only, pushing out to the compliance domain. Listed here because 'the drawing, the scope and the SWMS' is one errand, but the screens themselves belong to compliance.

**Every tap target**

- A drawing row → Sheet viewer, full screen
- Scope of works row → Scope of works, full screen
- Tile schedule row → Tile schedule, full screen
- SWMS row → hands off to the compliance domain
- ADD SHEET (owner) → OS file picker

**States** — Loading: section headings render immediately, rows skeleton. Empty: no documents → 'No drawings yet. The office uploads sheets to the job; they appear here as soon as they do.' A job with one sheet → the CURRENT heading is dropped and the single row shown on its own, because 'CURRENT (1)' over one row is noise. No superseded sheets → the section and its red warning line are absent entirely. Error: 'Could not load the drawings' with retry; the Scope and Tile schedule rows still work, since they are separate queries. Offline: sheets that have been opened on this phone stay listed and openable; sheets never opened are listed and dimmed with 'Not downloaded'. This is important and currently over-claimed — the built app tells the worker 'a sheet stays on the phone once opened', which is browser cache only and expires with the signed URL.

---

## Sheet viewer

**full screen**

**Reached by** — Tapping a drawing row on the Plans tab, or a plan pin reference on a defect.

**Roles** — All three read and can drop a pin (plan_pins_field_insert requires created_by = self). Only the pin's own creator can delete it; anyone in the company can resolve one (plan_pins_field_update, narrowed by plan_pins_worker_guard to resolved_at/resolved_by — moving or rewording a pin is refused at the trigger).

Dark chrome, the sheet filling the frame, pinch-zoom and pan. Top bar: back, site_files.name, the open pin count, and a REV chip from site_files.version — or a full-width alert band 'This sheet has been superseded. Do not build from it.' when it is. Pins are numbered circles positioned at plan_pins.x / plan_pins.y as fractions of the sheet (0–1, so they hold at any zoom): issue pins in alert, note pins in accent, photo pins in rail, resolved pins in inkFaint. Bottom: a single DROP A PIN button.

**Every tap target**

- A pin → Plan pin half sheet
- DROP A PIN → enters pin-drop mode (crosshair cursor, the bottom bar becomes the composer)
- Pinch / double-tap → zoom
- Back → Plans tab

**States** — Loading: 'Loading sheet…' over the dark ground while the signed URL is minted and the image fetched — a large A1 PDF render is slow and needs a determinate bar, not a word. Empty: a sheet with no pins shows the drawing and a one-line hint at the bottom, 'Drop a pin to mark exactly where something is'. Error: the signed URL failing (bucket private, 3600s expiry) → 'Could not open this sheet' with retry; do not leave a black screen. Offline: an already-viewed sheet renders from cache; one never opened shows 'This sheet hasn't been downloaded to this phone' with a retry. Pins render from cached plan_pins either way.

---

## Plan pin half sheet

**half sheet**

**Reached by** — Tapping a pin on the Sheet viewer.

**Roles** — All three see it. Resolve is open to anyone in the company. Delete is only offered when plan_pins.created_by = me (plan_pins_own_delete).

A coloured dot and the kind as an uppercase label (ISSUE / NOTE / PHOTO), a 'DONE' chip when resolved_at is set. Then plan_pins.label as the body at 16px, created_by resolved through crew_v to a name, created_at as 'Dropped Tue 5 Aug, 9:14 am', and resolved_at / resolved_by when closed. If photo_id is set, the linked site_files photo as a thumbnail. If a defect references this pin (defects.plan_pin_id), a row 'Defect DEF-12 — Ensuite, cracked tile' pushing to the defect.

**Every tap target**

- The photo thumbnail → Photo viewer, full screen
- The linked defect row → Defect half sheet
- 'Mark this done' → writes resolved_at / resolved_by, then re-reads and confirms the row actually changed before closing the sheet
- 'Delete this pin' (own pins only) → destructive confirm
- Dismiss — the sheet stays at half height so the drawing behind it is still readable, which is the whole reason it is a sheet

**States** — Loading: opens fully populated from the pins already loaded with the sheet; only the linked photo's signed URL loads. Empty: a pin with no photo and no defect simply omits those rows. Error: 'Mark this done' must check the returned row — a zero-row update answers with success, and this exact button spent its life reporting one before schema_v13. On failure: 'That did not save. Tell the office.' Offline: read-only, both buttons disabled with 'Needs a connection'.

---

## Drop a pin

**half sheet**

**Reached by** — DROP A PIN on the Sheet viewer. A mode, not a tap — a stray tap while reading a drawing must never leave a mark on it for everyone else.

**Roles** — All three (plan_pins_field_insert is company-wide with created_by = self).

The sheet stays visible and interactive above; the bottom half becomes the composer. A crosshair follows the tap, dropping a dashed preview pin at the fraction coordinates. Composer: three kind buttons (Issue / Note / Photo) in the pin colours, a single text field with a real example as the placeholder — 'What is here? e.g. water at the head of W-04' — and a full-width primary button that reads 'TAP THE SHEET FIRST' until a position is chosen and then 'DROP PIN ON A-103'. A caption: saved as a fraction of the sheet, so it stays put at any zoom. For kind='photo' the button becomes 'TAKE THE PHOTO' and chains into the camera, writing site_files first and then plan_pins.photo_id.

**Every tap target**

- Tap the drawing → places / moves the draft pin
- Issue / Note / Photo → sets kind
- DROP PIN → inserts plan_pins (company_id, site_id, file_id, x, y, kind, label, created_by)
- Cancel → leaves the mode and discards the draft

**States** — Loading: 'SAVING…' on the button. Empty: no label typed → the button stays inert; the pin coordinate alone is not a pin worth anyone's time. Error: inline red line under the field with the Postgres message; the draft is kept so nothing typed is lost. Offline: this is the highest-value offline write in the job — a worker standing in front of a leak, no signal. Today it fails outright. The design must specify a queued pin that renders on the drawing immediately in a dashed 'not sent yet' style and sends when signal returns.

---

## Superseded sheet confirm

**modal**

**Reached by** — Opening a drawing that is superseded, or attempting to drop a pin on one.

**Roles** — All three.

'A-103 has been superseded. There is a newer sheet — Rev D, issued 3 Aug. Building from an old drawing is the expensive mistake.' Two buttons: OPEN REV D (primary) and 'Open the old one anyway' (secondary, plain text). The newer sheet is found by the row whose site_files.supersedes points at this one.

**Every tap target**

- OPEN REV D → opens the current sheet instead
- Open the old one anyway → proceeds, and the viewer keeps the red band across the top for the whole session
- Cancel → back to the list

**States** — Loading: none, everything is in memory. Empty: not applicable. Error: if the superseding row cannot be resolved to a name, the primary button falls back to 'See the current sheets'. Offline: identical — this is decided from already-loaded rows.

---

## Scope of works

**full screen**

**Reached by** — The Scope of works row on the Plans tab.

**Roles** — THIS IS THE DOMAIN'S BIGGEST SCHEMA GAP AND IT IS ROLE-SHAPED. There is no scope_of_works table anywhere in supabase/. The only structured scope in the database is estimate_lines (cost_code, name, qty, unit) — and estimate_lines_read was locked to current_is_office() by schema_v14, so a captain and an employee read exactly zero rows. The client explicitly asks that a Crew Captain see 'scope of works'. As the schema stands, they cannot. Owner: can see estimate_lines. Captain and employee: can see only a scope document uploaded to site_files, plus progress_entries.area as a de facto area list.

Built from what actually exists, in three parts. (1) THE SCOPE DOCUMENT — site_files rows with kind='document' whose category or name marks them as scope; note that the category vocabulary in schema_v2 is plan|permit|drawing|change_order|survey|other, with no 'scope' value, so this is name-matching today and wants a category added. (2) AREAS AND QUANTITIES — progress_entries grouped by area, showing area, cost_code, unit, quantity — company-wide readable, no prices on it, and the closest thing to a captain-safe scope list the schema has. (3) FOR OWNERS ONLY — the approved estimate's lines: estimate_lines.cost_code, name, qty, unit, and money the Money tab owns. (4) SCOPE CHANGES — site_instructions where is_variation=true, each showing whether change_order_id is set, because an instruction that changed scope with no variation raised is work being done for free. What to flag to whoever fixes the schema: either a scope_items table (site_id, area, cost_code, description, qty, unit — no price), or a scope_v view over estimate_lines dropping unit_price, markup_pct and line_total. A security_invoker view will not do it: RLS on estimates already denies the caller, so the view has to be security definer with its own predicate, exactly as portal_defects_v is built.

**Every tap target**

- The scope document row → Document viewer, full screen
- An area row → Progress area half sheet
- A scope-change instruction row → Instruction half sheet
- 'How much is done' → Progress, full screen

**States** — Loading: three section skeletons. Empty — and this is the common case today: 'No scope of works recorded for this job' with, for an owner, two routes (upload the scope document, or open the approved quote) and, for a captain, 'The office hasn't put the scope on this job yet' plus a button to message them. This empty state must not be quiet; a job with no scope on the phone is the reason a crew tiles the wrong room. Error: per-section. Offline: the document row is openable only if cached; the areas list reads from cache.

---

## Tile schedule

**full screen**

**Reached by** — The Tile schedule row on the Plans tab. This is the screen the client keeps coming back to: tiles + codes + suppliers, grout colour, silicone colour, angles, mitres, grates, strip drains.

**Roles** — All three read — products, site_products and product_documents are all company-wide readable by design (schema_v11: a worker must be able to pull an SDS up on their phone; 'readily accessible' is the actual wording of the WHS obligation). No role sees a price here; site_products carries no cost column at all, which is convenient and deliberate.

Grouped by site_products.area ('Ensuite', 'Main bath', 'Kitchen splashback', 'Level 2 balconies'), and within each area by products.kind. Each line: products.name, brand, code (the supplier's product code — what actually gets ordered, and the thing a tiler reads out over the phone), colour, size, supplier, then site_products.quantity + unit and note. A SELECTIONS / CONSUMABLES split from site_products.role. A hazard marker on any products.hazardous row, with an SDS state from site_sds_register_v.sds_current — no sheet at all and a sheet from 2016 are both failures and both read red. DOES products/site_products ALREADY MODEL THE CLIENT'S LIST? Mostly, and here is the audit, item by item: · Tiles — yes. kind='tile', with name, brand, code, colour, size, supplier. · Codes — yes, products.code. · Suppliers — yes, products.supplier (free text; there is no suppliers table, so 'what did we order from Beaumont' cannot be asked). · Grout colour — yes, kind='grout' with colour. · Silicone colour — yes, kind='silicone' with colour. · Angles colour — partly. kind='trim' exists and carries colour, but nothing distinguishes an aluminium angle from a Schluter trim from a stair nosing except free text in name/size. · Grates and strip drains — NO. There is no kind for them; they land in 'other'. A strip drain has a length, a finish, an outlet position and a supplier, and none of that has a column. · Mitres — NO, and this one is not a product at all. A mitred external corner versus a trim is a per-area workmanship decision. There is nowhere to record it: no per-area detail field on site_products beyond `note`. What else is missing that a tiler will notice immediately: · No dye lot / shade / batch on products or site_products. Shade variation is a live claim risk on every tiling job and there is no column for it (waterproofing.batch_no exists for membrane only). · No finish (matt / polished / lappato / structured) — folded into free-text `size` or `name`. · No 'supplied by builder' flag. Free-issue tile versus tile we buy is the difference between a cost and no cost, and it is material to profitability. · materials has NO product_id. So 'the tile that was specified' and 'the tile that turned up' can never be joined — the Tile schedule and the Materials list are two unrelated lists of the same boxes. · No swatch photo: site_products has no file_id, so the schedule cannot show a picture of the tile. · site_products.area, progress_entries.area and waterproofing.area are three independent free-text columns that mean the same thing and will not match. · AND: there is no UI for products, site_products, product_documents or site_sds_register_v anywhere in the codebase. Grepped — nothing reads them. This screen is being designed from scratch against tables that have never been drawn.

**Every tap target**

- A product line → Product half sheet
- An area heading → collapses / expands that area
- A hazard marker → Product half sheet, opened on its SDS
- 'What turned up' → Materials & deliveries, full screen
- Search field → filters by name, code or colour

**States** — Loading: area headings then row skeletons. Empty — the state to expect, since nothing writes these tables today: 'No tile schedule on this job yet' plus the plain explanation that the office adds tiles, grout and silicone once the builder confirms selections, and for an owner a route to add one. One product on the job → shown as a single row under its area heading, with the heading kept, because 'Ensuite' over one line is still the information. Error: 'Could not load the tile schedule' with retry. Offline: fully readable from cache including codes and colours — this is the screen most worth caching aggressively, because the supplier phone call happens in a carpark.

---

## Product half sheet

**half sheet**

**Reached by** — Tapping any line on the Tile schedule; also from a material line where a product can be identified, and from a waterproofing record via waterproofing.product_id.

**Roles** — All three, identically. No price anywhere: site_products has no cost column and this sheet must not reach into materials.unit_cost to invent one.

products.name as the title, brand underneath. Then a fact grid: code, colour, size, supplier, kind rendered in trade language ('Floor tile', 'Grout', 'Silicone', 'Trim', 'Membrane'). Then this job's use, from site_products: area, role (Selection / Consumable), quantity + unit, note. Then DATASHEETS from product_documents: one row per document — kind ('Technical data' for tds, 'Safety data sheet' for sds, 'Warranty', 'Certificate'), title, issued_on. An SDS older than five years from issued_on reads red with 'Out of date — this sheet is no longer current', because a register full of lapsed sheets fails an inspection exactly as hard as an empty one. A hazardous product with no SDS at all reads red too.

**Every tap target**

- A datasheet row → Product document viewer, full screen
- 'Call the supplier' → only drawn when a number exists; there is no supplier phone column, so today this is not drawn at all — flag it rather than fake it
- 'Where else is this used' → filters the Tile schedule to that product across areas
- Dismiss

**States** — Loading: name, brand and code are already in memory from the list; the documents section skeletons. Empty: no documents → 'No datasheets uploaded for this product', and for a hazardous product an alertFill line saying an SDS is required and readily accessible under the WHS Regulations. Error: 'Could not load the datasheets'; the product facts still show. Offline: facts from cache; a datasheet opens only if it has been opened before, otherwise 'Not downloaded'.

---

## Product document viewer

**full screen**

**Reached by** — Tapping a TDS / SDS / warranty row on the Product half sheet.

**Roles** — All three.

The document rendered full-bleed (PDF or image), with a top bar carrying product_documents.title, kind, and issued_on. For an out-of-date SDS, a persistent red band across the top: 'This safety data sheet was issued 14 Mar 2016 and is no longer current.' A share/download action, because an SDS gets sent to a builder's safety officer.

**Every tap target**

- Share → OS share sheet (action)
- Back → Product half sheet
- Pinch → zoom

**States** — Loading: determinate progress — a datasheet is a several-megabyte PDF on site data. Empty: not applicable. Error: signed URL failure → 'Could not open this document' with retry. Offline: cached documents open; otherwise 'This datasheet hasn't been downloaded to this phone'.

---

## Document viewer (generic)

**full screen**

**Reached by** — Any site_files row with kind='document' that is not a drawing sheet — the scope document, an imported programme file, an instruction's attachment.

**Roles** — All three (site_files_read is company-wide).

The file rendered full-bleed. Top bar: site_files.name, created_at as 'Added 22 Jul', uploaded_by resolved through crew_v, size_bytes, and version where set. No pins on this viewer — pins belong to drawings, and offering them here would put a coordinate on a scope PDF where it means nothing.

**Every tap target**

- Share → OS share sheet
- Back
- Pinch → zoom

**States** — Loading: determinate bar. Empty: not applicable. Error: 'Could not open this file' with retry and the file name so the person can ask the office for it by name. Offline: cached only, otherwise 'Not downloaded to this phone'.

---

## Site tab

**full screen**

**Reached by** — Tab 3 of the in-job bar. Everything written FROM site, as opposed to Plans which is everything read BEFORE site.

**Roles** — Owner: every section, every write. Captain: every section; writes are live on jobs where captains_site() is true and inert elsewhere — the design shows read-only rather than an error after the tap. Employee: reads everything (defects, site_instructions, progress_entries, waterproofing and materials are all company-wide readable) and can raise a defect, record an instruction, log a delivery, take a photo and add a waterproofing record — but cannot edit any of them and cannot write a progress_entry at all (progress_entries is deliberately excluded from the field-insert grant: a percentage is what a claim is justified with, so letting anyone type one makes over-claiming an accident rather than a decision).

A scrolling stack of section cards, each a count plus the two most recent rows and a chevron. · PHOTOS — count of site_files kind='photo', a three-across strip of the last six thumbnails. · SITE INSTRUCTIONS — open count, and separately the count where is_variation=true and change_order_id IS NULL, in warnFill. · DEFECTS — open + in_progress count, split 'ours' / 'theirs' from defects.responsible, and any critical severity called out in alert. · MATERIALS AND DELIVERIES — materials count by status; 'still on order' as the headline number. · PROGRESS — site_progress_v.pct_complete and last_assessed_on. · WATERPROOFING — site_waterproofing_v.area_count, signed_off_count, outstanding_count, and in red unflooded_count / unphotographed_count, because a membrane signed off with no flood test and no photo is a certificate that will not hold up. · DAILY LOG — today's daily_logs row and its status (draft / confirmed). A persistent bottom bar: full-width TAKE PHOTO primary, with a '+' secondary opening the raise-something sheet.

**Every tap target**

- Any section card → its full-screen list
- A thumbnail in the photo strip → Photo viewer
- TAKE PHOTO → Take a photo, full sheet
- '+' → a small action sheet: Raise a defect · Record an instruction · Log a delivery · Record progress (owner/captain) · Add a wet area

**States** — Loading: cards render with their headings and skeleton counts, in one pass — six parallel counts, not six sequential screens. Empty: a job with nothing on it shows every card with a zero and a one-line prompt each ('No photos yet — the first one is usually the set-out'), never a collapsed or hidden card, because an absent card reads as a failed load. Error: a card whose query failed shows 'Couldn't load' in place of its count and stays tappable. Offline: cached counts with the stale strip; TAKE PHOTO stays enabled and queues (see that screen).

---

## Photos

**full screen**

**Reached by** — The Photos card on the Site tab; also from the root Photos tab scoped to this job.

**Roles** — All three see every photo on the job — site_files_read is company-wide. All three can add one (site_files_field_insert requires uploaded_by = self). Anyone can change category and caption; site_files_worker_guard refuses any change to site_id, uploaded_by, storage_path, lat, lng, taken_at, kind, version or supersedes — the parts that make a photo evidence.

Filter chips: All · Mine · Issues · Progress · Before & after · Inspection, from site_files.category, each with a count, and a red dot on Issues when non-zero. Selected chip is ink-filled with white text. Grouped by day from taken_at (falling back to created_at) — 'Today · 11 photos', 'Tue, 5 Aug · 9 photos' — then a three-across grid of square tiles. Each tile carries its taken_at time bottom-right, a 'YOU' tag when uploaded_by = me, and a red dot when category='issue'. Bottom: full-width TAKE PHOTO.

**Every tap target**

- A tile → Photo viewer, full screen
- A filter chip → refilters, resets the scroll
- TAKE PHOTO → Take a photo, full sheet
- Long-press a tile → multi-select for share (share only; there is no bulk delete — a site photo is evidence)

**States** — Loading: day headings then a grey grid; thumbnails fill in as their signed URLs are minted (60 at a time, the bucket is private so there is no shortcut). Empty: no photos → 'No photos on this job yet. Photos you take here carry their own time and place, so the office can see what you saw.' A filter with no matches → 'Nothing matches that filter' and a 'Try All' — different copy from the no-photos case, because they are different problems. One photo → one tile under its day heading, heading kept. Error: 'Could not load the photos'. Offline: previously loaded thumbnails render from cache; the rest are grey tiles with a small cloud glyph. TAKE PHOTO stays enabled.

---

## Photo viewer

**full screen**

**Reached by** — Tapping any photo tile, a photo pin on a drawing, a defect's before/after image, a waterproofing photo, or a photo in a message.

**Roles** — All three. Flagging as an issue is open to everyone — a labourer standing in front of a problem is worth more than the office noticing three weeks later.

Dark ground, the photo filling it, swipe left/right between the filtered set with 'n of N' at the top. Below: site_files.caption, then the taker — uploaded_by through crew_v with initials, name and taken_at as 'Yesterday, 2:41 pm'. Then chips: the location badge, which is a real computed comparison and not a decoration — distanceM(photo lat/lng, site lat/lng) against job_sites.radius_m gives 'On site' / 'Away from site', and NULL coordinates give 'No location', because 'we don't know' and 'they weren't there' are very different claims to put next to somebody's name. Then the category chip. Then, when it exists, the row this photo belongs to: 'Defect DEF-12' or 'Wet area — Ensuite, second coat'.

**Every tap target**

- Swipe / chevrons → previous, next
- 'Flag as an issue' → sets category='issue'; the update MUST be read back, since a zero-row update answers with success and this exact button reported one for its whole life before schema_v13
- Caption → inline edit (category and caption are the only two fields a worker may change)
- The linked defect / wet area row → that half sheet
- Share → OS share sheet
- Close

**States** — Loading: 'Loading…' on the dark ground while the signed URL resolves; the caption and metadata render immediately from the row. Empty: not applicable. Error: flagging failing → 'That did not save. Tell the office.' in red under the button, and the chip does not change. Offline: the photo shows if cached; metadata always shows. 'Flag as an issue' is disabled with 'Needs a connection' rather than silently failing.

---

## Take a photo

**full sheet**

**Reached by** — TAKE PHOTO on the Site tab or the Photos screen; the camera chained from a photo pin; ADD PHOTO on a defect or a wet area.

**Roles** — All three.

Camera first, controls minimal — shutter, flip, flash, and 'from library'. After the shutter: a review pane with the shot, a caption field, a category picker (Progress · Issue · Before · After · Inspection), and, where the sheet was chained from something, a locked context chip naming it ('Attaching to DEF-12'). A location line showing the fix that will be written — 'On site, ±8 m' or 'No GPS fix — this photo will have no location', stated before the send rather than discovered after. Writes site_files (company_id, site_id, uploaded_by, kind='photo', storage_path, name, mime, size_bytes, category, caption, lat, lng, taken_at) after uploading to the private `site-files` bucket at companyId/siteId/uuid-name — the leading company folder is load-bearing for the storage policies, not just tidiness.

**Every tap target**

- Shutter → capture
- From library → OS picker (triggers the photo-library permission prompt)
- Category chip → sets category
- SEND → uploads then inserts
- Retake → back to the camera
- Cancel → discard, with a confirm if a caption was typed

**States** — Loading: a determinate upload bar with the file size — a phone photo on site data is not instant and a spinner here is a lie about how long it will take. Empty: not applicable. Error: upload failure → the photo is kept in the review pane with 'Couldn't send — try again' and a RETRY; the image is never dropped on a failed send. Offline: the single most important queued write in this domain. The design must specify: the photo saves locally, appears in the grid immediately with a dashed 'not sent' border, and sends when signal returns — with the taken_at and lat/lng captured at capture time, not at send time, or the evidence value is gone. Today the app has no such queue and the send simply fails.

---

## Camera / library / location permission prompt

**modal**

**Reached by** — The first tap on TAKE PHOTO (camera), 'from library' (photos), or entering a job while tracking is off (location).

**Roles** — All three.

A pre-prompt in the app's own voice before the OS dialog, because an OS prompt denied once is expensive to recover. Camera: 'Crewline needs the camera so you can photograph what you can see. Photos go on this job, with the time and place they were taken.' Location, which is the sensitive one: 'Crewline uses your location to put you on the clock when you arrive and off when you leave. It records where you are while a shift is open, and nothing when it is not' — and a link to the privacy page. A denied-permanently variant explains the Settings route in words, with a button that deep-links to the app's Settings page.

**Every tap target**

- 'Allow' → triggers the OS dialog
- 'Not now' → dismisses; the feature stays visible but shows what it needs when tapped
- 'Open Settings' (denied state) → OS settings (action)
- Privacy link → /privacy

**States** — Loading: none. Empty: none. Error: none. Offline: the prompt still works; permission is a device matter, not a network one.

---

## Site instructions

**full screen**

**Reached by** — The Site instructions card on the Site tab; the 'instructions that change scope' row on the Job overview; the Scope screen's scope-changes section.

**Roles** — All three read (company-wide). Anyone can record one — site_instructions_field_insert is deliberately open, because an instruction given at 7am and not written down by lunchtime is work done for free. Only owner and captain can change status, link a variation, or edit.

Filter chips: Open · Actioned · Disputed · Closed · 'Changes scope'. Each row: site_instructions.received_on, from_name (or from_contact_id resolved through builder_contacts), a `how` chip (Verbal · Email · Site meeting · Written · Drawing), the instruction text truncated to two lines, ref and builder_ref where present, a status chip, and — the loud one — a warnFill 'NO VARIATION RAISED' badge on any row with is_variation=true and change_order_id IS NULL. Above the list, when any such rows exist, a band: 'N instructions marked as changing scope with no variation raised.' A verbal instruction that changes scope and never gets written down is the classic way a tiling subcontractor works for nothing, and this band is the screen's reason to exist.

**Every tap target**

- A row → Instruction half sheet
- A filter chip → refilters
- 'RECORD AN INSTRUCTION' → full sheet
- The warning band → filters to exactly those rows

**States** — Loading: skeleton rows. Empty: 'No instructions recorded on this job' and the plain-English reason to record them — six weeks later the argument is whether it was ever given. One instruction: one row, filters still drawn (a single open instruction is exactly what you want to find again). Error: retry card. Offline: cached list; RECORD is enabled but the write is not queued today and will fail — flag for the queue work.

---

## Instruction half sheet

**half sheet**

**Reached by** — Tapping any row in Site instructions, or a scope-change row on the Scope screen.

**Roles** — All read. Status changes and the variation link are owner/captain only; the buttons are absent, not disabled, for an employee.

The full site_instructions.instruction text as the body — never truncated here, this is the record. Above it: received_on, from_name / builder_contacts name and role, `how`, ref, builder_ref. Below: status, note, raised_by through crew_v, created_at. photo_path rendered as a single thumbnail (note: this is a bare storage path, not a site_files row, so it has no caption, no coordinates and no taken_at — a real inconsistency with how every other photo on the job is stored, worth flagging). When is_variation=true: either the linked variation (change_order_id → co_no and status, tapping through to the Money tab's variation screen for an owner, and to a read-only variation view for a captain, who CAN read change_orders on their own jobs under schema_v18) or, when null, an alertFill block — 'This changes the scope and no variation has been raised' with a RAISE A VARIATION button for owners only.

**Every tap target**

- Status control (owner, captain) → Open / Actioned / Disputed / Closed
- 'This changes the scope' toggle (owner, captain) → sets is_variation
- RAISE A VARIATION (owner) → hands off to the Money domain, carrying instruction and received_on
- The linked variation row → the variation
- The photo → Photo viewer
- Dismiss

**States** — Loading: opens fully populated from the list row; only the photo's signed URL and the builder contact resolve. Empty: no photo, no note, no ref → those rows are dropped rather than shown empty. Error: a failed status write reverts the control and shows the message inline. Offline: read-only; controls disabled with 'Needs a connection'.

---

## Record an instruction

**full sheet**

**Reached by** — RECORD AN INSTRUCTION on the Site instructions screen, or '+' on the Site tab.

**Roles** — All three can create one. The 'this changes scope' tick is available to all — noticing it is field work; acting on it is not.

Fields, in the order a person on site would say them: WHO gave it (from_name free text, with a picker of builder_contacts for this job's builder so the supervisor is one tap), HOW (verbal / email / site meeting / written / drawing — defaulting to verbal, because that is the case that gets lost), WHEN (received_on, defaulting to today), WHAT (instruction, the only required field, multi-line, with voice-to-text as the primary affordance — typing with gloves on does not happen), their reference (builder_ref), a photo, and a single prominent tick: 'This changes the scope of works' setting is_variation. Under that tick, in plain words: a verbal instruction that changes scope and never gets written down is work done for free.

**Every tap target**

- Voice button → dictation into the instruction field
- Pick from contacts → builder_contacts picker
- Add a photo → camera / library
- 'This changes the scope' → toggles is_variation
- SAVE → inserts site_instructions
- Cancel → confirm if anything was typed

**States** — Loading: 'SAVING…'. Empty: instruction blank → SAVE inert. Error: inline message, draft kept. Offline: should queue — this is written standing next to the supervisor who just said it. Today it fails; the design must show a queued instruction in the list with a 'not sent' marker.

---

## Defects

**full screen**

**Reached by** — The Defects card on the Site tab; the open-defects row on the Job overview; a defect link from a plan pin.

**Roles** — All three read (company-wide). Anyone can raise one. Editing status, responsibility, severity and verification is owner/captain. WARNING for the design: defects.cost_estimate is on a company-wide read policy, so an employee's client can pull it from the API. The screen must not show it below owner, and the schema should move it behind a view.

Filter chips: Open · In progress · Fixed · Verified · 'Ours' · 'Theirs'. A summary strip: open count, and the split from defects.responsible — 'us' versus builder / other_trade / client / unknown. That split is the point: a tiler's defect list is half other trades' damage, and who it belongs to decides who pays. Each row: ref, location ('Ensuite, Lot 42' — a QS list is organised by room), description truncated, a severity marker (minor / major / critical, critical in alert), a status chip, raised_on, due_on with an overdue treatment, and thumbnails for photo_path and fixed_photo_path — a defect closed without a photo is a defect reopened.

**Every tap target**

- A row → Defect half sheet
- A filter chip → refilters
- RAISE A DEFECT → full sheet
- The 'theirs' count → filters to responsible != 'us'

**States** — Loading: summary strip then skeleton rows. Empty: 'No defects raised on this job' — and, when the job is complete, the fuller line that an empty defect list is what stands between practical completion and the retention being released. One defect: one row, filters kept. Error: retry. Offline: cached list; RAISE is enabled but does not queue today.

---

## Defect half sheet

**half sheet**

**Reached by** — Tapping a defect row, a defect link on a plan pin, or a defect chip in the photo viewer.

**Roles** — All read. Status, responsible, severity, due_on and verification are owner/captain. cost_estimate is shown to owners only.

defects.description as the body, ref and location as the header. Then: severity, status, raised_by_party (builder / client / us / certifier / other), responsible (us / builder / other_trade / client / unknown), raised_on, due_on, fixed_on, verified_on, verified_by through crew_v, created_by, note. Two photo slots side by side, labelled BEFORE and AFTER, from photo_path and fixed_photo_path. When plan_pin_id is set, a row 'Marked on A-103' that opens the Sheet viewer centred on that pin — this is what stops 'which shower' being ambiguous.

**Every tap target**

- A photo slot with an image → Photo viewer
- An empty AFTER slot (owner, captain) → camera, writes fixed_photo_path
- Status control (owner, captain) → Open / In progress / Fixed / Rejected / Verified
- 'Whose is it' control (owner, captain) → sets responsible
- 'Marked on A-103' → Sheet viewer at that pin
- Dismiss

**States** — Loading: populated from the list row; photos resolve their signed URLs. Empty: no photos → both slots show as dashed 'Add a photo' for owner/captain and as 'No photo' for an employee. No plan pin → the row is absent. Error: failed status write reverts and shows the message. Offline: read-only, controls disabled.

---

## Raise a defect

**full sheet**

**Reached by** — RAISE A DEFECT on the Defects screen, '+' on the Site tab, or from the Sheet viewer with a pin already dropped (which pre-fills plan_pin_id).

**Roles** — All three — requiring a role to report a problem is how problems stop being reported.

Photo first, at the top, because a defect is raised standing in front of it. Then: location (free text with the job's known areas from progress_entries / site_products offered as chips), description (voice-first), severity (Minor / Major / Critical), 'Whose is it' (responsible: ours / builder / another trade / client / not sure — defaulting to 'not sure' rather than to 'us', because a wrong default here is the company volunteering to pay), who raised it (raised_by_party), and due_on. Optionally 'Mark it on the drawing' which chains into the Sheet viewer's pin-drop mode and returns with plan_pin_id set. cost_estimate is not on this form at any role — a repair costing typed on site is a guess that will be quoted back.

**Every tap target**

- Take a photo → camera
- Location chip → fills location
- Voice → dictation into description
- Severity / responsible / raised-by controls
- 'Mark it on the drawing' → Sheet viewer pin-drop, returns here
- SAVE → inserts defects
- Cancel → confirm if anything entered

**States** — Loading: 'SAVING…', with the photo upload as a determinate bar ahead of the insert. Empty: description blank → SAVE inert. Error: photo uploaded but insert failed → say exactly that and keep the uploaded path so a retry does not re-upload. Offline: must queue photo-and-row together; today it fails.

---

## Progress

**full screen**

**Reached by** — The Progress card on the Site tab, or the progress bar on the Job overview.

**Roles** — All three read progress_entries (company-wide). Only owner and captain can record one — progress_entries is the one table in schema_v19 deliberately excluded from the field-insert grant, because a percentage is what a claim is justified with. Employee sees the figures and no entry affordance at all.

Top: site_progress_v — pct_complete as the headline, area_count, last_assessed_on, done_quantity of total_quantity. A note that it is weighted by quantity, because a job 100% through a 2 m² powder room and 10% through 300 m² of balconies is not 55% done, and a flat average is how a subcontractor over-claims by accident. Then the latest assessment per area from progress_entries: area, cost_code, unit, quantity, done_quantity, pct_complete as a bar, assessed_on, assessed_by through crew_v. For an owner only, a single line handing off to the Money tab's claimed-versus-progress comparison — the figure itself lives there.

**Every tap target**

- An area row → Progress area half sheet
- RECORD PROGRESS (owner, captain) → full sheet
- 'History' on an area → that area's full progress_entries series, oldest to newest

**States** — Loading: the roll-up first (one view), then the area list. Empty: no entries → 'Nobody has measured this job yet' with, for owner/captain, RECORD PROGRESS, and for an employee the plain statement that the office or the captain records it. One area: one row, roll-up shown as normal — a single-area job is common on a house. Error: retry. Offline: cached; RECORD disabled with 'Needs a connection', which is right for a number that goes onto a claim.

---

## Progress area half sheet

**half sheet**

**Reached by** — Tapping an area row on the Progress screen, or an area row on the Scope screen.

**Roles** — All read. RECORD A NEW ASSESSMENT is owner/captain.

The area name as the title. Latest assessment: pct_complete as the big figure, done_quantity of quantity with unit, cost_code, assessed_on, assessed_by, note. Then the history — every progress_entries row for this area, most recent first, each a date, a percentage and who assessed it, so a claim can be justified line by line if a QS asks. Where a matching waterproofing row exists for the same area name, its status is shown as a chip, because a wet area cannot honestly be claimed complete before its membrane is signed off.

**Every tap target**

- RECORD A NEW ASSESSMENT (owner, captain) → full sheet, pre-filled with this area
- The waterproofing chip → Wet area half sheet
- A history row → expands its note
- Dismiss

**States** — Loading: populated from memory; only the waterproofing lookup resolves. Empty: one assessment only → the history section reads 'First assessment' rather than showing a one-row list under a 'History' heading. Error: inline. Offline: read-only.

---

## Record progress

**full sheet**

**Reached by** — RECORD PROGRESS on the Progress screen or the Progress area half sheet. Owner and captain only.

**Roles** — Owner: any job. Captain: their own jobs — on a job they do not run the entry point is absent, because the write would be refused and a refused write that looks successful is worse than an error.

Area (a picker of existing progress_entries.area values on this job plus 'new area', so the free-text column does not fragment into three spellings of 'Ensuite'), cost_code, unit (m² / lm / item / room / %), quantity — the whole area — and done_quantity, with pct_complete computed from the two and shown live rather than typed, then assessed_on and a note. A standing caption: this is what a progress claim is justified with. Inserts progress_entries as a NEW row, never an update — the table is an assessment series and overwriting the last one destroys the trail.

**Every tap target**

- Area picker → chooses or creates
- Unit control
- Quantity / done fields → numeric keypad
- SAVE → inserts progress_entries
- Cancel → confirm if entered

**States** — Loading: 'SAVING…'. Empty: area or done_quantity missing → SAVE inert. Error: inline with the message; the entered numbers are kept. Offline: disabled outright, with 'Recording progress needs a connection — this is what a claim is measured against.' This is the one write in the domain that should NOT be queued: a queued percentage that lands hours later, out of order, corrupts the series that site_progress_v picks 'latest' from.

---

## Materials and deliveries

**full screen**

**Reached by** — The Materials card on the Site tab; the 'still on order' row on the Job overview; 'What turned up' on the Tile schedule.

**Roles** — All three read — materials_read was left company-wide on purpose so a crew knows what has been delivered and what is still coming. BUT unit_cost and total_cost are on those rows and RLS cannot hide a column, so the money is on the wire to every phone. The design must show no cost below owner, and this should be flagged for a materials_v view: schema_v14 says exactly this ('the row stays readable and the office-only figures move to a view') and then does not build one for materials. All three can log a delivery (materials_field_insert, created_by = self); editing is owner, or captain on their own jobs.

Grouped by materials.status: ON ORDER, DELIVERED, USED, RETURNED. Each row: name, quantity + unit, supplier, cost_code, ordered_on / delivered_on, and a note marker. On-order rows past their expected date read amber. For an owner only, a right-aligned total_cost per row and a group subtotal. For captain and employee, no money column at all and no gap where one was.

**Every tap target**

- A row → Material line half sheet
- LOG A DELIVERY → full sheet
- A supplier name → filters to that supplier
- 'What was specified' → Tile schedule

**States** — Loading: group headings then skeleton rows. Empty: 'Nothing recorded for this job yet' plus the reason to bother — knowing what has landed is what stops a crew standing around. One line: one row under its status heading. Error: retry. Offline: cached list; LOG A DELIVERY enabled but not queued today.

---

## Material line half sheet

**half sheet**

**Reached by** — Tapping a row on Materials and deliveries.

**Roles** — All read (no money below owner). Edit is owner, or captain on their own job (materials_captain_write). Employee sees no edit control.

materials.name as the title. quantity + unit, supplier, cost_code, status, ordered_on, delivered_on, note, created_by through crew_v, created_at. For an owner: unit_cost and total_cost, with total_cost marked as generated in Postgres (round(quantity * unit_cost, 2)) and therefore not editable. When expense_id is set, a row linking to the docket it came from — that link is what stops a receipt and a material line being counted twice in the cost roll-up. A note that this line cannot be tied to a specified product, because materials has no product_id — the gap named on the Tile schedule.

**Every tap target**

- Status control (owner, captain) → Ordered / Delivered / Used / Returned; setting Delivered stamps delivered_on
- 'Photo of the delivery docket' → camera
- The linked expense row (owner) → hands off to the Money domain
- Dismiss

**States** — Loading: populated from memory. Empty: no supplier, no note, no cost code → those rows dropped. Error: failed status write reverts the control. Offline: read-only, controls disabled.

---

## Log a delivery

**full sheet**

**Reached by** — LOG A DELIVERY on the Materials screen, or '+' on the Site tab.

**Roles** — All three (materials_field_insert). An employee's row lands with created_by = them and no cost; the office prices it later. That split is deliberate in schema_v3 — crew log what turns up, only the office changes costs afterwards — so the form must not show a price field to a non-owner at all.

What turned up (name — offering the job's site_products names as chips so the delivery and the specification at least share a spelling), quantity, unit (ea / lm / m / m² / m³ / kg / t / L / box / pack / sheet), supplier, cost_code, status defaulting to 'delivered', delivered_on defaulting to today, note, and a photo of the docket. For owners only: unit_cost, with the line total computed live and labelled as calculated by the database.

**Every tap target**

- A product-name chip → fills name
- Unit control
- Photo of the docket → camera
- SAVE → inserts materials
- Cancel → confirm if entered

**States** — Loading: 'SAVING…'. Empty: name blank → SAVE inert. Error: inline. Offline: should queue — a delivery is logged at the gate, which is exactly where the signal is worst. Today it fails.

---

## Daily log

**full screen**

**Reached by** — The Daily log card on the Site tab.

**Roles** — All three read (daily_logs_read is company-wide). All three can edit and confirm — daily_logs_field_update is company-wide, deliberately, so the person who was there signs off the day; owner and captain additionally have full write via daily_logs_captain_write.

Today's daily_logs row for this site (unique on site_id + log_date). Fields: log_date, weather, work_completed, materials, issues, extra_notes, and crew_summary — a snapshot of names and hours taken at generation time, so the log stays true even if a timesheet is edited later. status as draft or confirmed, confirmed_by through crew_v, confirmed_at. A DRAFT FOR ME button asks the server to assemble the day from the punches, photos and deliveries; the draft arrives as a draft and every field stays editable, because a log posted on someone's behalf is a log nobody will defend in a dispute. Weather is a typed field, not fetched — there is a weather column and a lat/lng and no service between them, and drawing an AUTO badge over a number nobody produced would be a lie. Below today, the last thirty logs as dated rows.

**Every tap target**

- DRAFT FOR ME → server assembles, fields populate, nothing is sent
- Any field → edit in place
- SEND → sets status='confirmed', confirmed_by, confirmed_at
- A past log row → that day's log, read-only unless it is still a draft

**States** — Loading: today's row resolves; the history list skeletons. Empty: no log for today → the empty form with DRAFT FOR ME as the primary action; no logs at all → 'No daily logs on this job yet'. Confirmed: the form locks with a green band naming who confirmed it and when. Error: the drafting endpoint failing → 'Couldn't put a draft together — write it yourself' with the fields still usable, never a dead end. Offline: today's cached row is editable locally and SEND is disabled with 'Will send when you're back' — this is a good queue candidate since the row is keyed on site_id + log_date and cannot duplicate.

---

## Waterproofing areas

**full screen**

**Reached by** — The Waterproofing card on the Site tab; the wet-area chip on a Progress area; the waterproofing rows on the Job overview attention block.

**Roles** — All three read. Anyone can create a wet area record — the tiler who laid the membrane is the right person to start it — but the waterproofing_stamp_signoff trigger silently downgrades an insert with status='signed_off' to 'in_progress' unless the caller is office or captain-on-this-site, so the design must not offer sign-off below those roles. Signing off and generating the certificate belong to the compliance domain; this screen is the list, the status and the photo capture.

From site_waterproofing_v as a summary: area_count, signed_off_count, outstanding_count, and in alert unflooded_count and unphotographed_count — signed off with no flood test, or no photo, both being certificates that will not hold up and both silent until someone looks. Then one card per waterproofing row (unique on site_id + area): area, status (Planned / In progress / Complete, unsigned / Signed off / Failed), product_name and batch_no, coats, bond_breaker and angle_fillet as ticks, wall_height_mm, started_on, completed_on, flood_tested with flood_test_on and flood_test_hours, installer through crew_v, and a photo count by stage from waterproofing_photos.

**Every tap target**

- A card → Wet area half sheet
- ADD A WET AREA → full sheet (all roles)
- ADD PHOTOS on a card → camera, writing waterproofing_photos with a stage picker
- A photo count → the photos for that wet area, filtered by stage

**States** — Loading: summary then cards. Empty: 'No wet areas recorded on this job' with the reason stated once and plainly — a membrane is covered by screed and tiles within a day, and after that the only evidence it was done properly is what was recorded before the tiler covered it up. One wet area: one card, summary still shown. Error: retry. Offline: cached; ADD PHOTOS should queue for exactly the same reason as the site photo, and today does not.

---

## Wet area half sheet

**half sheet**

**Reached by** — Tapping a wet-area card, or the waterproofing chip on a Progress area.

**Roles** — All read. Editing the record is owner or captain-on-this-job. Sign-off and the certificate are the compliance domain's; this sheet shows their state and hands over.

waterproofing.area as the title, status as a chip. Then the AS 3740 facts as a grid: product_name (or product_id resolved to a product), batch_no, substrate, primer, coats, bond_breaker, angle_fillet, wall_height_mm, started_on, completed_on, flood_tested / flood_test_on / flood_test_hours, installer_id through crew_v, installer_licence. Then the photo strip from waterproofing_photos grouped by stage (substrate, primer, fillet, membrane, second coat, flood test, other). When signed off: signed_off_name, signed_off_at, certificate_no and a link to certificate_path. Two red states drawn loudly: signed off with flood_tested false, and signed off with no photos at all.

**Every tap target**

- A photo → Photo viewer, scoped to this wet area's photos
- ADD PHOTOS → camera with the stage picker
- Edit (owner, captain) → full sheet form
- 'Certificate' → compliance domain
- Dismiss

**States** — Loading: facts from the list row; the photo strip resolves signed URLs. Empty: no photos → a dashed 'Photograph the fillet, each coat and the flood test' rather than an empty strip. Error: inline. Offline: read-only; ADD PHOTOS queues in the design.

---

## Crew tab

**full screen**

**Reached by** — Tab 4 of the in-job bar. Not present for an employee.

**Roles** — Owner: everyone who has worked this job, everyone booked, hours per person, and the sublet-labour section. Captain: the same, minus sublet labour — subcontract_work and subcontractors are office-only in schema_v15 and return nothing to them, so the section is absent rather than empty. No role below owner sees a rate, a cost, or a dollar figure of any kind on this tab.

Section ON THE CLOCK NOW: shifts with this site_id and ended_at IS NULL — name, trade, started_at, running elapsed. Section BOOKED: assignments for this site — worker, starts_at–ends_at, published, and crews.name with crews.colour where crew_id is set, so a booked crew reads as one block. Section HOURS ON THIS JOB: one row per worker, total hours from closed shifts net of break_minutes, last on site, and the count of shifts where source='manual' or edited=true, because an edited punch should never be presented as a clean one. Section SUBLET LABOUR (owner only): subcontract_work rows — subcontractor name, worked_on, quantity + unit, and a hand-off to Money for the cost. A closing note on the honest limit of the hours figure: it is time on site, and workers.rate is a bare wage with no on-costs, which is why nothing on this tab tries to price it.

**Every tap target**

- A person row → Person half sheet
- A shift row → Shift half sheet
- A crew block → the crew's members expand
- 'Approve the day' (owner, captain) → a confirm, then stamps approved_at / approved_by on the day's shifts — the person who was standing there is the right person to sign off the hours, and schema_v18 widened both the policy and the shifts_worker_guard trigger to allow it
- Sublet row (owner) → Money tab

**States** — Loading: three section skeletons. Empty: nobody has ever worked here → 'Nobody has been on this job yet', and, for an owner, a route to the booking grid. Nobody on the clock but people booked → the ON THE CLOCK section reads 'Nobody on site right now' and stays. One person: one row per section. Error: per-section retry; a failed subcontract_work read for an owner must not blank the hours section. Offline: cached, with running timers frozen and stamped 'as at 3:41 pm'. 'Approve the day' is disabled offline — it writes approved_at, which the guard trigger scrutinises, and a queued approval is an approval nobody watched land.

---

## Shift half sheet

**half sheet**

**Reached by** — Tapping a shift row on the Crew tab, or a person's hours row.

**Roles** — Owner: full edit. Captain: full edit on their own jobs — schema_v18 widened both shifts_captain_write and the shifts_worker_guard trigger, checking BOTH new.site_id and old.site_id so a shift cannot be dragged off someone else's job onto their own. Employee: never reaches this sheet (no Crew tab; their own shifts live on the root Time tab).

The worker's name and trade through crew_v. started_at and ended_at as times, break_minutes, the computed length, cost_code, source ('Automatic — geofence' or 'Entered by hand'), edited, note, approved_at and approved_by. When source='auto', the evidence line the mobile brief asks for, built from the site's radius_m and the ping that opened the shift. No rate. No cost. Not even for an owner on this sheet — the labour cost of a job is a Money-tab figure and putting a dollar beside one person's name on a work tab is exactly the leak the role split exists to prevent.

**Every tap target**

- Edit times (owner, captain) → inline time pickers, writing started_at / ended_at and setting edited
- Cost code control → writes cost_code
- Approve → stamps approved_at / approved_by
- 'Something's wrong with this' → the punch-correction flow (shift_corrections), which lives in the root Time domain
- Dismiss

**States** — Loading: populated from the list. Empty: an open shift has no ended_at → shown as 'Still on the clock' with a live elapsed, not a blank field. Error: the guard trigger raises P0001 with a specific message on a refused edit — surface it verbatim rather than 'something went wrong', because it explains precisely what is not allowed. Offline: read-only; every control disabled.

---

## Job messages

**full screen**

**Reached by** — The chat bubble pinned in the job header, on every tab. Also from the root Chat tab, which lands on the same channel.

**Roles** — All three, identically — the site channel is auto-created per job by the create_site_channel trigger and messages_read is company-wide. Anyone can post (messages_field_insert requires author_id = self). There is no per-job restriction and no membership check on a site channel; channel_members is only used for DMs.

The channels row for this site (kind='site', unique per site_id). Messages from `messages`: author_id through crew_v to initials, name and a per-person colour, body, created_at, attachment_path, and kind — a system message (author_id null, kind='system') renders centred and grey, not as a person. Realtime INSERT subscription filtered to channel_id. A composer at the foot: text field, camera button, and a photo button. Unread state: there is no read-receipt or last-read column anywhere in the schema, so 'unread' is computed client-side and the built phone hardcodes unread={0} on the tab bar. The header badge needs either a channel_reads table or a stored last_read_at per worker — flag it rather than draw a badge that cannot be right.

**Every tap target**

- Send → inserts messages
- Camera / photo → uploads to the site-files bucket and writes attachment_path
- An attachment → Message attachment viewer
- An author avatar or name → Person half sheet
- A message long-press → copy (no edit, no delete: messages have no update or delete policy for anyone, which is a deliberate silence worth confirming with the client rather than designing around)
- Back → returns to the tab the chat was opened from

**States** — Loading: the last fifty messages, oldest at the top, scrolled to the bottom; a skeleton of three bubbles while they land. Empty: a brand-new job's channel → 'Nothing said about this job yet' plus who is in it. One message: shown normally with the empty-state copy gone. Error: 'Could not load the messages' with retry; the composer is disabled while it is broken so nothing is typed into a void. Offline: cached history readable; the composer stays open and a sent message shows with a 'not sent' clock glyph — messages are the single best queue candidate in the domain and the one users most expect to work this way.

---

## Message attachment viewer

**full screen**

**Reached by** — Tapping an image or file attached to a message.

**Roles** — All three.

The attachment full-bleed, with who sent it, when, and the message body it came with. Note that messages.attachment_path is a bare storage path with no site_files row behind it, so an attached photo has no category, no caption, no coordinates and does not appear in the job's Photos grid. That inconsistency is worth naming: a photo sent in chat is invisible to the photo log, which is where people look for it later.

**Every tap target**

- 'Save to the job's photos' → creates a site_files row from the same object, so the picture stops being stranded in a thread
- Share → OS share sheet
- Back

**States** — Loading: determinate bar. Empty: not applicable. Error: 'Could not open this attachment'. Offline: cached only.

---

## Destructive confirm

**modal**

**Reached by** — Deleting a pin you dropped, discarding a half-written instruction or defect, discarding a parsed programme draft, overwriting a confirmed daily log.

**Roles** — All three, with copy that names the actual consequence.

A title naming the thing ('Delete this pin?'), one line of consequence in plain words ('It comes off the drawing for everyone'), and two buttons: the destructive action in alert as the right-hand button, and Cancel. Never 'Are you sure'. Never a bare OK.

**Every tap target**

- Destructive action → performs it and returns
- Cancel → dismiss, changing nothing

**States** — Loading: the destructive button shows a spinner in place of its label while the write runs. Empty/Error: a failed delete leaves the modal open with the message inline rather than closing on a failure. Offline: the modal explains that the action needs a connection instead of offering a button that will fail.

---

## Pull-to-refresh and stale-data recovery

**inline**

**Reached by** — Pulling down on any scrolling tab inside the job.

**Roles** — All three.

Re-reads only the tab in view plus the header's three views (site_programme_v, site_progress_v, site_waterproofing_v), not the whole job. On completion, the stale strip clears and a brief line confirms what came back — 'Up to date' — because a refresh that changes nothing visible reads as a refresh that did not happen.

**Every tap target**

- Pull → refresh

**States** — Loading: the standard spinner at the top of the scroller. Empty: unchanged. Error: the strip turns alertFill and reads 'Could not refresh — still showing 3:41 pm'; the cached content is never cleared on a failed refresh. Offline: the pull is accepted and immediately reports 'No connection — still showing what was last loaded', rather than spinning.

---
