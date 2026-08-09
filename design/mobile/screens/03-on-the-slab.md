# The person on the slab

The person on the slab, and the compliance that protects the business — geofenced sign on/off, the owner's live board, SWMS gating, tickets, toolbox notices, defects, AS 3740 waterproofing, daily log, receipts, and the camera flow.

54 screens. Generated from the codebase, not imagined — every figure named here comes from a table or view that exists. Part of the inventory referenced by `design/PROMPT-mobile-v2.md` section 7.

---

## Jobs — home list (compliance strip)

**full screen**

**Reached by** — / — the app's launch route. Replaces today's tracker-first `Tracker` render in WorkerApp.tsx (screen='tracker', tab='jobs'). Also reached by the ‹ Back / Leave job affordance from any job's tab bar.

**Roles** — Employee: only sites they have an `assignments` row for (published=true) plus the site whose fence they are inside now (phase.siteId from /api/ping). Captain: their own jobs — job_sites.captain_id = me, or crews.captain_id = me joined through assignments.crew_id (this is exactly captains_site()). Owner: every job_sites row where company_id = mine and status <> 'archived'. Owner alone gets the LIVE ON SITE counter at the top (company_overview_v.on_the_clock); a captain sees a head-count only for their own jobs, an employee sees no head-count at all.

Header: TODAY, the date as 'Wed, 5 Aug' (en-AU). Own clock pill driven by dwell_state.phase.kind — 'Off the clock' / 'Arriving' / 'ON THE CLOCK h:mm' computed from shifts.started_at of the open shift (ended_at is null). Per-job row: job_sites.name, job_sites.address, job_sites.status ('active' | 'starting_soon'), and a compliance badge stack computed per site: unsigned SWMS count from unsigned_safety_docs(me, site.id); open defects count from defects where status in ('open','in_progress'); wet areas outstanding from site_waterproofing_v.outstanding_count. A red 'SIGN ON FIRST' chip when unsigned_safety_docs() is non-empty. Assignment window for today from assignments.starts_at / ends_at where published = true.

**Every tap target**

- A job row → enters the job, tab bar swaps to that job's tabs, lands on that job's Today tab (full screen)
- The clock pill → Today / clock screen (full screen)
- The 'SIGN ON FIRST' chip → Sign-on gate for that job (full sheet, blocking)
- The defects badge → that job's Defects list (full screen)
- The waterproofing badge → that job's Wet areas list (full screen)
- Avatar (workers.initials on theme.rail) → Account sheet (half sheet)
- Unread notice banner (notifications where read_at is null, limit 5) → marks them read (UPDATE notifications SET read_at) and opens the linked screen from notifications.link_nav (action + navigation)
- LIVE ON SITE counter (owner only) → Live sign on & off board (full screen)

**States** — Empty — an employee with no published assignment and no fence match sees 'No jobs yet. Your foreman publishes the roster from the office and it shows up here.' (this is the copy ScheduleScreen already uses). An owner with no job_sites sees 'No jobs. Add one from the office.' Loading — the row skeletons render at final height so the list does not jump; useSites() reads job_sites directly so it is populated without tracking being on (this is exactly why useSites.ts exists — the tracker's site list is empty until /api/ping answers). Error — an RLS or network failure shows an inline alert band (theme.alertFill / theme.alertInk) above the list with the Postgres message verbatim, list keeps showing last-known rows. Offline — the list is read-only and renders from the last fetch; the compliance badges are stamped 'as of hh:mm'. No writes happen here.

---

## Today — off the clock (the gate)

**full screen**

**Reached by** — Job tab bar → Today, when `tracking` is false. Today's GateScreen in WorkerApp.tsx. This is the state before the worker has ever tapped START TRACKING in this session.

**Roles** — Identical for all three roles — an owner and a captain still clock on like anyone else, and their shifts row is written by the same geofence engine. Only the tab bar behind it differs.

TrackerHeader: workers.initials avatar, 'Today', status pill 'Off the clock' (tone 'off', theme.appBg / theme.inkSoft). Blue Callout: 'Turn on tracking and you'll be clocked in automatically when you reach a job site.' Notice banner if any unread notifications rows. Off-clock action tiles. Footer: 'Nothing is recorded until you tap this.' and a full-width yellow CTA (theme.cta gradient, theme.ctaBorder, 56 px) reading START TRACKING. PrivacyLine underneath. backendNote() text must appear here verbatim — 'Tracking keeps running with your screen off.' on native, 'In a browser, tracking pauses when your phone locks. Install the app to be clocked in without keeping this open.' on web, 'This device has no location services.' otherwise.

**Every tap target**

- START TRACKING → requests location permission, starts startWatching() (action; on native this raises the OS 'Allow all the time' prompt and pins a foreground-service notification titled 'Crewline is tracking your location')
- My Jobs tile → My jobs / roster (full screen)
- Fix a Punch tile → Shift correction (half sheet)
- Time Off tile → Time off request (half sheet)
- Avatar → Account sheet (half sheet)
- 'What Crewline records about you' link → /privacy (external, new tab)

**States** — Empty — this screen IS the empty state of the clock; there is nothing to show but the CTA. Loading — none; nothing is fetched before the tap. Error — if backend() is 'none' the CTA is disabled and the note reads 'This device has no location services.' Offline — the tap still works: the watcher starts, fixes are collected into the in-memory `pending` queue and the OfflineBanner appears as soon as the first POST /api/ping fails. Nothing is written to Supabase from this screen.

---

## Location permission — OS prompt and the refusal state

**inline**

**Reached by** — Raised by the START TRACKING tap on Today. The refusal state renders in place of the Approaching screen when startWatching() calls back with an error.

**Roles** — Same for all roles.

On native the error path keys off error.code === 'NOT_AUTHORIZED' and shows, verbatim: 'Location permission is off. Turn it on in Settings, and choose "Allow all the time" so your hours keep recording with the screen off.' On web it shows the raw GeolocationPositionError.message. A second, softer band appears when isNative() is false: the app can only report while the page is open, so a worker who locks the phone stops being tracked and will not be clocked in. Both render as theme.alertFill bands with an OPEN SETTINGS action (native only) and a RETRY.

**Every tap target**

- OPEN SETTINGS → OS settings (action, native only)
- TRY AGAIN → re-runs startWatching() (action)
- 'Clock in manually instead' → the manual clock-in path on the Approaching screen (action)

**States** — Empty — n/a. Loading — a brief 'Waiting for GPS…' while no fix has arrived yet; this must be distinguishable from a refusal, because they look the same to a worker. Error — this screen is the error. Offline — permission is a device state, not a network one; the band shows regardless.

---

## Approaching — headed to a site

**full screen**

**Reached by** — Automatically, once tracking is on and dwell_state.phase.kind is 'offsite'. ApproachingScreen in WorkerApp.tsx.

**Roles** — Same for all roles.

Status pill 'Off the clock'. A schematic map (not a real map SDK today — hand-drawn blocks, an accent-tinted fence circle, a dashed approach trail and a blue you-dot). 'HEADED TO' eyebrow, then the nearest job_sites.name at 26 px, then the distance from distanceM(fix, site) rendered as '{n} m away' under 1 km and '{n.n} km away' over it. Blue callout: "You'll clock in automatically when you arrive." Honesty line: 'Tracking is on, so your position is being sent to the office now, including the drive here — you're only paid from two minutes after you've settled at the site.' PrivacyLine showing accuracy ±{accuracy_m} m.

**Every tap target**

- 'Clock in manually' (white CTA, 52 px) → POST /api/ping with manual:true (action). The server refuses with 409 unless siteContaining() places the phone inside a real radius_m; a refusal comes back as `notes[0]` and renders as an info Banner with a 'Got it' dismiss
- ActionGrid: Take Photo → camera flow (full sheet); Upload Receipt → receipt capture (full sheet); Plans → plans (full screen); Safety → job Safety hub (full screen); Daily Log → daily log (full screen)
- Avatar → Account sheet (half sheet)

**States** — Empty — no site within range and no fix yet: 'Waiting for your first location report…'; sites loaded but no fix: 'Waiting for GPS…'. Loading — the same two strings; there is no spinner because a spinner over a map reads as the map loading. Error — a red Banner carrying the /api/ping error text ('Session expired — sign in again.', 'Server returned 500'). Offline — OfflineBanner strip at the very top: 'Offline — N locations waiting to sync'; the manual clock-in button must be visibly disabled while queued > 0, because the server is the only thing that can open a shift and it cannot be reached.

---

## Confirming — the two-minute settle

**full screen**

**Reached by** — Automatically when /api/ping returns phase.kind === 'arriving'. ConfirmingScreen.

**Roles** — Same for all roles.

Status pill 'Arriving' (amber: design.amberBg / design.amberFg / theme.warning dot). A 172 px pulsing ring with an m:ss countdown derived from DWELL_IN_MS (120 000) minus (now − phase.since) — the countdown is computed from the SERVER's phase.since, never from a local timer. 'Confirming you're on site…' and 'We wait until you've settled in, so driving past a site never clocks you in.' A two-row checklist: ✓ 'Inside the {job_sites.name} fence' and a spinner row 'Settle window · in progress'. Footer: 'Nothing is recorded until this finishes.'

**Every tap target**

- ActionGrid tiles (photo / receipt / plans / safety / daily log) — all available before the clock starts, deliberately
- Avatar → Account sheet (half sheet)

**States** — Empty — n/a, this state only exists with a site. Loading — the countdown itself; if pings stop arriving the countdown must freeze rather than run down, because only the server can advance the phase. Error — if the next ping fails the countdown holds and the OfflineBanner appears; the copy must not promise the clock started. Offline — same: the settle window cannot complete offline, and the screen must say so ('Waiting to reach the office — the clock starts when this gets through').

---

## Clocked in — the celebration

**full screen**

**Reached by** — Fires when a /api/ping response contains an event of kind 'clock_in'. Holds for CELEBRATION_MS (6 000 ms) then hands off to On the clock. CelebrationScreen.

**Roles** — Same for all roles.

Green (theme.success) hero: a 66 px tick, 'Clocked in at {h:mm am}' from the event timestamp, '{job_sites.name} · {workers.trade}', and a chip that differs by path — 'Automatic — you didn't have to do anything' vs 'You clocked in yourself'. Below: a small green fence thumbnail, an eyebrow reading 'ARRIVAL VERIFIED' (auto) or 'POSITION CHECKED' (manual), and the evidence sentence: 'GPS put you {marginM} m inside the fence for 2 min before the clock started' — where marginM = radius_m − distanceM(this ping, site centre). On the manual path the sentence must instead read '…inside the fence when you tapped, so the clock started there and then', because a manual clock-in skips the settle window on the server.

**Every tap target**

- 'Not right? Fix this' → Shift correction (half sheet), pre-selected to the shift just opened
- 'View today' (white CTA, 54 px) → dismisses to On the clock (action)
- (no dismissal is required — the 6-second timer hands off on its own)

**States** — Empty — n/a. Loading — n/a; it renders from a response already in hand. Error — if the fence lookup fails marginM is null and the copy degrades to 'GPS put you inside the fence…' with no number rather than inventing one. Offline — unreachable offline: a clock_in event only exists in a successful response.

---

## On the clock

**full screen**

**Reached by** — Automatically when phase.kind is 'onsite' or 'departing'. OnClockScreen.

**Roles** — Same for all roles. A captain sees no extra controls here — approving other people's hours lives on the job's Crew/Hours screen, not on their own clock.

A green ON THE CLOCK pill (also the account tap target — the design has no header row here), a 62 px h:mm elapsed counter from shifts.started_at, and 'since {h:mm am} · {job_sites.name}'. ActionGrid. TODAY'S TIMELINE: a green dot 'Arrived — clocked in' with '{h:mm} · auto, GPS verified' (must read 'manual' when shifts.source = 'manual'), then a hollow blue dot 'Still on site' with '{job_sites.name} · {n.n} hrs so far'. Sticky footer: a red CLOCK OUT bar.

**Every tap target**

- The ON THE CLOCK pill → Account sheet (half sheet)
- CLOCK OUT → the clock-out confirmation, which replaces the footer in place (inline)
- ActionGrid: Take Photo / Upload Receipt / Plans / Safety / Daily Log (full sheets and full screens)
- A timeline row → shift evidence detail (half sheet)

**States** — Empty — n/a. Loading — the elapsed counter ticks locally every second but phase.since comes from the server, so a stale phase shows an honest 'last confirmed {h:mm}' line rather than a counter that keeps running on nothing. Error — red Banner with the ping error. Offline — OfflineBanner at top; the counter keeps ticking (the shift is genuinely still open server-side) but the timeline must not claim any new events. Nothing on this screen writes.

---

## Clock out — the honest confirmation

**half sheet**

**Reached by** — Tapping CLOCK OUT on the On the clock screen. Renders in place of the footer button.

**Roles** — Same for all roles.

The single most important piece of copy in the app, because the button lies if it is not there: 'Leaving the site is what actually clocks you out — GPS closes the shift a few minutes after you walk away. If your phone won't be with you, you can stop sending location now instead; tell your foreman if the hours need fixing by hand.' The 'few minutes' is DWELL_OUT_MS (180 000) plus the EXIT_BUFFER_M (25 m) of slack. Two buttons: a red STOP TRACKING ON THIS PHONE and a ghost 'Keep tracking'.

**Every tap target**

- STOP TRACKING ON THIS PHONE → stops the watcher, clears celebration, returns to the gate (action). It does NOT write shifts.ended_at — RLS and shifts_worker_guard both refuse a worker-side time write, and only /api/ping running as the service role may close a shift
- Keep tracking → dismiss (action)
- 'Fix a punch instead' → Shift correction (half sheet)

**States** — Empty — n/a. Loading — none; this is a local state change only. Error — n/a. Offline — this is the ONE clock action that works offline, precisely because it writes nothing. That should be said: 'This stops your phone reporting. Your shift is still open until the office's fence sees you leave.'

---

## Offline queue — banner and detail

**half sheet**

**Reached by** — The banner appears automatically at the top of the tracker whenever the in-memory `pending` array is non-empty (a POST /api/ping threw). Tapping it opens the detail.

**Roles** — Same for all roles.

Banner strip (design.hairline background, WifiOffIcon): 'Offline — {n} location{s} waiting to sync'. Detail sheet: how many fixes are queued, the timestamp of the oldest, what they will do when they land (open or close a shift), and the hard truth that the queue is IN MEMORY ONLY today — closing the browser tab or the app loses it. Also states plainly that no other write in the app is queued: a photo, a signature, a defect, a receipt or a daily log that fails offline fails outright and must be retried by hand.

**Every tap target**

- RETRY NOW → drains the backlog through send() (action)
- 'What happens to my hours' → explains that the server decides every clock event and a late-arriving ping is still timestamped with its original `at` (clamped to ±5 minutes of server time by MAX_CLOCK_SKEW_MS) (half sheet)

**States** — Empty — the banner does not render at queued === 0. Loading — 'Sending {n}…' while draining. Error — the drain stops at the first failure and re-queues the rest, so the count can go down and then stop; the sheet should say which one failed and why. Offline — this screen IS the offline state.

---

## Fix a punch — shift correction

**half sheet**

**Reached by** — Three entry points, all of which must land here: 'Not right? Fix this' on the celebration; the same link inside an expanded day row on the Time tab; and the Fix a Punch tile on the off-clock screen. Writes shift_corrections.

**Roles** — Employee raises one about their own shift only — corrections_self_insert requires worker_id = current_worker_id() and status = 'open'. Captain and owner raise one the same way for themselves; deciding one is an office action and does not exist on the phone today. NOTE for design: shift_corrections_read is company-wide (schema_v6), so any signed-in worker can read a colleague's dispute — the phone must not build a list view that exposes them.

'WHAT THE FENCE SAW' band (theme.warnFill): 'You were recorded at {job_sites.name} from {h:mm} to {h:mm}. Tell the office what actually happened and they decide — your times are not overwritten by this.' Shift picker: the last 14 days of own shifts (up to 30), each showing job_sites.name, dayDate(started_at), clockTime(started_at)–clockTime(ended_at) or 'now'. Reason radios mapping exactly to shift_corrections.reason_code: parked_offsite / access_changed / blocked / forgot / other. A free-text detail textarea → shift_corrections.detail, placeholder 'I was on site from 6:40, not 7:10.' Footer disclaimer: 'Your GPS record is not changed by this. The office sees what you say and decides.' The schema also carries requested_start and requested_end, which the phone does not yet collect — the redesign should add two time fields, because 'open' with no requested time makes the office guess.

**Every tap target**

- A shift row → selects it (action)
- A reason row → selects it (action)
- SEND CORRECTION REQUEST → INSERT into shift_corrections (action). A trigger (notify_correction_raised) then writes a notifications row addressed to the office
- Cancel → dismiss (action)

**States** — Empty — 'No shifts in the last two weeks.' and the send button stays disabled (it requires a shiftId). Loading — the shift list renders skeleton rows; the reason list is static and can render immediately. Error — the Postgres message in a red Banner; nothing is cleared, so the worker does not retype. Offline — the INSERT fails with a network error and there is no queue. The sheet must keep the typed detail and offer RETRY; losing a worker's account of their own day is the worst possible failure here.

---

## Correction sent

**half sheet**

**Reached by** — After a successful shift_corrections INSERT.

**Roles** — Same for all roles.

A 44 px tick, 'The office has it', and: 'Your hours stay recorded as they are until someone reviews this. Nothing was changed on the timesheet.' Should also name the shift it was raised against and show shift_corrections.status = 'open'.

**Every tap target**

- Done → dismiss (action)
- 'See my hours' → Time tab (full screen)

**States** — Empty / loading / error — n/a, this is a terminal confirmation. Offline — unreachable; it only renders after the write succeeded.

---

## Time — my hours (week)

**full screen**

**Reached by** — The Time tab in the app-level tab bar (outside a job), or the job's Hours tab scoped to that site. HoursTab.tsx.

**Roles** — Employee: their own shifts only (shifts_read allows worker_id = current_worker_id()). Captain: their own plus, on their own jobs, the crew's — that is a separate screen; this one stays personal. Owner: same personal view. NO ROLE SEES A RATE OR A DOLLAR HERE. workers.rate is dropped from crew_v and must never be joined onto this screen — note that workers_read is still company-wide, so the DB does not yet stop it and the design is the only guard.

Header 'Time', '{workers.name} · {Mon date} – {Sun date}'. An ON NOW pill if any shift has ended_at is null. Segment control: Hours / Time off. Hours: a 34 px total for the week against workers.ordinary_hours (per-worker, default 38 — never a hard-coded 38), a progress bar that turns theme.warning past ordinary, 'x.x to go' or 'ordinary week done', and 'No overtime this week' / '{n.n} overtime'. Then a day list: weekday + date, job_sites.name, clockTime(started_at)–clockTime(ended_at) or 'now', a green tick when shifts.source = 'auto' and shifts.edited is false, the word 'edited' in warn ink when shifts.edited, and hours to one decimal from (ended_at − started_at) less break_minutes. A row where approved_at is null and edited is true renders on theme.warnFill.

**Every tap target**

- A day row → expands the evidence panel in place (inline)
- 'Not right? Fix this' inside an expanded row → Shift correction (half sheet)
- Time off segment → the leave list (inline)
- ASK FOR TIME OFF → the leave request (half sheet)

**States** — Empty — 'Nothing recorded this week yet. Hours appear here on their own as you arrive and leave.' Single item — the same layout with one row; the week total and the bar still render, because 6.2 / 38 is the honest picture. Loading — the total renders as '—' rather than 0.0; a false zero on payday is the one number that must never be guessed. Error — a red band with the Postgres message, list keeps its last rows. Offline — read-only; shows the last fetch stamped 'as of {time}'. The only writes reachable from here are a correction and a leave request, both of which fail loudly with no queue.

---

## Shift evidence — how this was recorded

**half sheet**

**Reached by** — Expanding a day row on the Time tab. Today it is inline; the redesign should promote it to a half sheet so the week's totals stay visible behind it.

**Roles** — Employee sees their own. Captain, on their own jobs, additionally gets an EDIT affordance — shifts_captain_write plus the widened shifts_worker_guard let a captain move started_at / ended_at / approved_at, but only when captains_site() is true for BOTH the old and the new site_id. Owner gets the same everywhere.

'HOW THIS WAS RECORDED', then dotted evidence lines built from the row: 'Clocked in automatically at {h:mm} — the geofence wrote it, not you.' (source='auto') or 'Entered by hand, started {h:mm}.' (source='manual'); 'Left {site} {h:mm} — clocked out. {n.n} hrs.'; 'Recorded against {shifts.cost_code}.' when set. Break line: 'Unpaid break {shifts.break_minutes} min' or 'No unpaid break'. When approved_at is null and edited is true, a held band: 'Held for review. The office has flagged this one. It is not lost — it goes to payroll once they approve it.' The underlying geofence_events rows for this shift (kind clock_in / clock_out / drive_by_rejected / geofence_exception / signal_lost, with their `message` text) should be listed here too — they exist and nothing on the phone shows them.

**Every tap target**

- 'Not right? Fix this' → Shift correction (half sheet)
- Break minutes → an editable stepper (inline). This is one of only two fields a worker may write on their OWN OPEN shift; shifts_worker_guard raises 'A worker can set the cost code and break on their own open shift, nothing else' for anything else
- Cost code → picker (half sheet), same rule
- APPROVE (captain/owner only, on their own jobs) → sets approved_at / approved_by (action)

**States** — Empty — a shift with no cost code and no break shows only the two clock lines; do not pad it. Loading — n/a, it is already in hand. Error — a worker editing a closed shift's break will get a P0001 from the trigger; the sheet must catch it and say 'You can only change the break while you are still on site' rather than surfacing the raw exception. Offline — the edit fails; keep the typed value and offer retry.

---

## Time off — request and history

**half sheet**

**Reached by** — The Time tab's 'Time off' segment, and the Time Off tile on the off-clock screen. Writes time_off_requests.

**Roles** — Everyone requests for themselves — time_off_self_insert forces worker_id = current_worker_id() and status = 'pending'. Nobody decides on the phone; time_off_worker_guard raises 'Only the office can decide a time off request' if a non-office user tries. Withdrawing your own pending request is allowed (time_off_self_cancel).

Request form: kind (annual / personal / unpaid / other → time_off_requests.kind), starts_on, ends_on, optional reason. Client-side check that ends_on >= starts_on, matching the table's own CHECK. History list: kind label, '{dayDate(starts_on)} – {dayDate(ends_on)}', hours if time_off_requests.hours is set, and a status chip — pending 'Waiting on the office', approved, declined, cancelled 'Withdrawn'. Standing note: 'This is your requests and where each one got to. Your leave balance lives in payroll, not here.' — no accrual balance is invented, because no column holds one.

**Every tap target**

- SEND REQUEST → INSERT (action); notify_timeoff_requested writes an office notification
- A pending row → withdraw confirmation (modal), sets status='cancelled'
- Cancel → dismiss (action)

**States** — Empty — 'No requests yet.' Single item — one row, no header change. Loading — the history list shows a single skeleton row. Error — inline red text under the button, form preserved. Offline — the INSERT fails, no queue; the form must keep its dates.

---

## LIVE SIGN ON & OFF — the owner's board

**full screen**

**Reached by** — Owner tab bar → Live, from outside any job. New screen; nothing on the phone shows this today. The office equivalents are the `shifts` open-row queries in Timesheets.tsx:214 and Crew.tsx:272.

**Roles** — OWNER ONLY across the whole company. A captain gets the same screen filtered to their own jobs — captains_site() already permits reading shifts on those sites — and with no rate, no cost and no dollar figure anywhere on it. An employee never reaches this screen: shifts_read only ever returns their own rows, so it would render as a list of one.

Header: 'ON SITE NOW · {n}' from company_overview_v.on_the_clock (owner) or a count of open shifts on their own sites (captain), and the date. Grouped by job: job_sites.name, then a row per person from the open shift — workers.name (via crew_v so no rate is in the payload), workers.initials, workers.trade, 'since {clockTime(shifts.started_at)}', running elapsed, shifts.source ('auto' with a tick, 'manual' spelled out), and a freshness dot driven by the last positions.at for that worker: green under 10 minutes, amber past SIGNAL_LOST_MS (600 000), grey when there is no fix today at all. A second group, 'Arriving', from dwell_state.phase.kind = 'arriving'. A third, 'Needs review', from geofence_events where kind in ('geofence_exception','signal_lost','drive_by_rejected') today. A footer stating the retention rule out loud: raw positions are deleted after 3 days by prune_positions().

**Every tap target**

- A person row → Person live detail (half sheet)
- A job header → enters that job (full screen)
- 'Needs review' count → the exceptions list (full screen)
- A phone-number affordance on a person row → dials (action)

**States** — Empty — 'Nobody is on the clock right now.' with the time of the last clock-out from geofence_events. Single item — one job group with one row; do not collapse it into a sentence, the layout should be stable at 1 and at 40. Loading — the count renders as '—', never 0; 'nobody on site' and 'not loaded yet' are different claims about somebody's day. Error — an alert band with the message; the board keeps the last snapshot with an 'as of' stamp. Offline — read-only, stamped; realtime (shifts and positions are both on the supabase_realtime publication) reconnects on its own.

---

## Person live detail

**half sheet**

**Reached by** — Tapping a person on the Live board.

**Roles** — Owner: any worker in the company. Captain: only workers currently on one of their own jobs. Employee: never.

workers.name, initials, trade, role (crew_v.role — 'Captain' badge where applicable). Today's shifts rows for that person: site, started_at, ended_at or 'open', source, break_minutes, cost_code, edited/approved_at flags. Last position: positions.at, accuracy_m, and distance from the site centre against job_sites.radius_m — 'inside the fence, 42 m in' or 'outside, 310 m away'. Today's geofence_events messages in order (these are already human-readable strings written by /api/ping: '{name} clocked in at {site} · 7:04am'). An explicit line that raw location is kept 3 days and the shift is kept 7 years.

**Every tap target**

- 'See their week' → that person's timesheet (full screen, owner/captain-on-own-jobs only)
- 'Raise a correction on their behalf' → correction form pre-filled (half sheet, office only — a captain hits corrections_self_insert's worker_id check)
- Call / message → dialler or the site chat (action)
- Close → dismiss (action)

**States** — Empty — a worker on the clock with no fix in the last 10 minutes: 'No location since {h:mm} — the phone may be locked or out of signal. Their shift is still open.' Loading — skeleton. Error — message band. Offline — read-only snapshot.

---

## Exceptions — drive-bys, signal lost, geofence exceptions

**full screen**

**Reached by** — The 'Needs review' count on the Live board.

**Roles** — Owner company-wide; captain on their own jobs; employee sees only their own (events_read permits worker_id = current_worker_id()) and would more sensibly see them inside their own shift evidence than as a list.

geofence_events rows for today and yesterday, grouped by kind: 'drive_by_rejected' ('{name} passed {site} 7:12am — not clocked in (43s on site)'), 'signal_lost', 'geofence_exception'. Each row: at, worker, site, and the stored `message` verbatim — the message is written server-side in Australia/Adelaide and must not be re-derived on the phone.

**Every tap target**

- A row → Person live detail (half sheet)
- 'Open a correction' on a drive-by → the correction form (half sheet, office only)

**States** — Empty — 'Nothing needing review today.' Single item — one row. Loading — skeleton rows. Error — band. Offline — read-only.

---

## Sign-on gate — you cannot start yet

**full sheet**

**Reached by** — Entering a job whose unsigned_safety_docs(me, site_id) returns rows. Must present itself before the job's Today tab, not after. Today this is a coloured panel inside SafetyScreen; in the redesign it is the blocking thing it claims to be.

**Roles** — Identical for all three roles — an owner with an unsigned SWMS on a job is as unsigned as a labourer, and the function makes no role distinction. What differs is the way out: an owner or captain can also open the document management screen from here; an employee cannot.

Header band (theme.alertFill / theme.alert border): 'YOU CANNOT START YET' and '{n} documents are not signed for {job_sites.name}. Until they are, you are not on this task.' Then one row per safety_documents row where active is true and (site_id is null or site_id = this site) and kind in ('swms','induction'): title, version, cost_code, and a REQUIRED / DONE chip. A signed row shows 'Signed {fullDate(safety_signatures.signed_at)}'. When resign_after_hours is set the row must say so — 'Signed 3 days ago, needs re-signing every 24 hours' — because that is what puts a previously-signed document back on this list. Once the list empties the band flips green: 'SIGNED ON — everything for {site} is signed. You are good to start.'

**Every tap target**

- A REQUIRED row → Read and sign (full screen)
- 'Why am I blocked?' → an explainer (half sheet) naming unsigned_safety_docs() in plain words
- 'Ask the office' → the site channel (full screen)
- Leave this job → back to Jobs (action)

**States** — Empty — the honest one: 'The office has not put a SWMS or induction on this site yet, so there is nothing to sign.' The gate must NOT block in this case; no documents is not the same as unsigned documents. Loading — the gate must render as blocked-and-checking rather than open, or a slow query lets someone onto a slab. Error — if the rpc fails, block and say 'Could not check your sign-on. Try again before you start.' — failing open here is the wrong default. Offline — the gate cannot be evaluated and cannot be satisfied: signing writes a safety_signatures row and there is no offline queue. Say so plainly: 'You need signal to sign on. Find a bar of reception before you start.'

---

## Safety hub (inside a job)

**full screen**

**Reached by** — Job tab bar → Safety. Today's SafetyScreen.tsx, reached from the ActionGrid tile.

**Roles** — Employee: the gate, their own tickets, the toolbox feed, the SDS register. Captain: adds 'who has signed' per document and the toolbox acknowledgement roll for their own jobs. Owner: adds posting a toolbox notice, and links out to document and ticket management (both of which are office-write-only — safety_documents_office_write and the v2 certifications policy were never widened to captains, so a captain cannot upload a SWMS or file a ticket).

Header: 'Safety', '{workers.name} · {workers.trade}'. Sections in this order: (1) an expired-ticket alert band if any certifications row has expires_on < today, carrying certifications.restriction verbatim when the office wrote one; (2) the sign-on gate panel; (3) MY TICKETS; (4) TOOLBOX — safety_records where kind = 'toolbox'; (5) SDS / product data — site_sds_register_v rows for this site, which is the 'readily accessible' obligation the WHS Regulations actually impose; (6) hazards and incidents raised here. Standing footer: 'The office holds the certificates. A new one is not live until they have filed it.'

**Every tap target**

- A gate row → Read and sign (full screen)
- A ticket row → Ticket detail (half sheet)
- A toolbox row → Toolbox notice (half sheet)
- 'Report a hazard' → hazard form (full sheet) writing safety_records with kind='hazard', worker_id=me (safety_field_insert permits exactly this)
- An SDS row → the PDF from product_documents.storage_path (full screen viewer)
- 'Post a notice' (owner only) → Toolbox composer (full sheet)

**States** — Empty — each section has its own: no tickets → 'No tickets on file. The office adds these.'; no documents → 'The office has not put a SWMS or induction on this site yet.'; no toolbox notices → 'No notices. The owner posts one when something is spotted on site.'; no hazardous products → 'Nothing on this job needs an SDS.' Loading — sections render independently so tickets are not held up by the rpc. Error — a band at the top with the first error message; the load already collapses cert and doc errors into one string. Offline — read-only; the sign button and the acknowledge button both disable with 'Needs signal'.

---

## Read and sign a SWMS

**full screen**

**Reached by** — Tapping a REQUIRED row on the gate or in the Safety hub. Today's SignSheet inside SafetyScreen.tsx.

**Roles** — Everyone signs for themselves. safety_signatures_sign permits worker_id = current_worker_id() OR office — the phone must never offer 'sign on behalf of', which is the exact thing a signature exists to prevent. A signature can never be edited and only the office can delete one (safety_signatures_office_delete).

safety_documents.title at 17 px, 'Version {version}' and cost_code beneath. Then the controls: safety_documents.body split on newlines, each non-empty line rendered as a numbered black circle plus the text, headed 'THE {n} CONTROLS' (or 'WHAT YOU ARE SIGNING' when there is only one). Then 'YOUR SIGNATURE' and a 150 px signature canvas with touchAction none, dashed border that turns theme.accent once there is ink, and the ghost prompt 'Sign here with your finger'. Footer: a full-width SIGN AND START bar, dead (theme.fill / theme.inkGhost) until hasInk, with 'Sign in the box above first.' underneath.

**Every tap target**

- The canvas → draws (pointer events, devicePixelRatio-scaled)
- 'Clear and sign again' → wipes the canvas (action)
- SIGN AND START → INSERT into safety_signatures {company_id, document_id, worker_id, site_id, signature: canvas.toDataURL('image/png')} (action), then reloads the gate
- Cancel → back to the gate (action)

**States** — Empty — a document with a null body renders the title, the version, and the canvas alone; do not invent controls. Loading — n/a, the document is already loaded. Error — the Postgres message under the canvas in alert ink, ink preserved so nobody re-signs. Offline — the INSERT fails and the ink is still on screen; the redesign must either hold the data URL and retry, or say clearly 'Not signed yet — you need signal.' Silently discarding a signature and letting the gate reopen is the failure mode to design against.

---

## Who has signed — the sign-on roll

**half sheet**

**Reached by** — Tapping a signed document's row header in the Safety hub, or the job's Crew screen.

**Roles** — Captain (own jobs) and owner. safety_signatures_read is company-wide so an employee could technically see it; the design should show them only their own line, because a crew list of who has and has not signed is a supervision tool, not a worker one.

safety_documents.title and version at the top. Then two lists: SIGNED — worker name (crew_v), initials, fullDate(safety_signatures.signed_at), and a thumbnail of the stored signature data URL; NOT SIGNED — everyone rostered on this site today (assignments joined to crew_v) with no matching signature, or one older than resign_after_hours. A count line: '4 of 6 signed'.

**Every tap target**

- A signed row → the signature image full size (modal)
- A not-signed row → 'Remind' → posts to the site channel (action)
- Close → dismiss (action)

**States** — Empty — 'Nobody has signed this yet.' Single item — one signed row plus the not-signed list. Loading — skeleton. Error — band. Offline — read-only.

---

## My tickets — white cards and certifications

**full screen**

**Reached by** — Safety hub → MY TICKETS, and from the Account sheet.

**Roles** — Employee: their own certifications rows only (the screen filters worker_id = me; the table's read policy is company-wide, so the filter is the guard). Captain: their own, plus — on their own jobs — a read-only view of whose tickets are expiring, because a captain sending an unticketed man onto a slab is the captain's problem. Owner: everyone, plus the count from company_overview_v.tickets_expiring (expires_on < current_date + 30). Nobody edits a ticket on the phone; certifications is office-write-only.

One card per certifications row: name (e.g. 'White Card', 'Working at Heights'), and the date line — 'Expires {fullDate(expires_on)}', 'Expired {fullDate(expires_on)}', or 'No expiry' when the column is null. A status chip computed from the days remaining: CURRENT (theme.successFill), '{n} DAYS' at 30 days or fewer (theme.warnFill), EXPIRED (theme.alertFill). When a ticket is expired AND certifications.restriction is set, the restriction text renders in a red block underneath — and only then. A ticket with no restriction on file shows its date and nothing else; the consequence is never guessed.

**Every tap target**

- A card → Ticket detail (half sheet)
- 'Send the office a new copy' → the camera flow, categorised as a document (full sheet)
- The expired band at the top → scrolls to the offending ticket (action)

**States** — Empty — 'No tickets on file. The office adds these.' Single item — one card; the section header still reads MY TICKETS. Loading — skeleton cards. Error — the band at the top of the Safety hub. Offline — read-only; the card dates are static so this degrades gracefully.

---

## Ticket detail

**half sheet**

**Reached by** — Tapping a ticket card.

**Roles** — Same as the list. No role can edit here.

certifications.name, expires_on rendered long, the computed days remaining, and certifications.restriction in full when present. A plain statement of what an expired ticket blocks in this app TODAY: nothing is enforced in code — there is no join between certifications and the sign-on gate, and unsigned_safety_docs() does not consult tickets. The redesign should decide whether an expired White Card blocks the gate; if it does, that logic has to be built, and the screen must not imply it already exists. Footer: 'The office holds the certificate. A new one is not live until they have filed it.'

**Every tap target**

- 'Photograph the new one' → camera flow (full sheet), lands in site_files as a document
- 'Who do I send this to' → the office contact / site channel (action)
- Close → dismiss (action)

**States** — Empty — n/a. Loading — n/a. Error — n/a. Offline — read-only.

---

## Tickets expiring — the owner's watch list

**full screen**

**Reached by** — Owner's Safety or Crew screen; the count comes from company_overview_v.tickets_expiring.

**Roles** — Owner only — company_overview_v carries a `where current_is_office()` clause, so a captain selecting it gets no row at all, which the screen must handle as 'not available to you' rather than as zero.

Every certifications row in the company with expires_on < current_date + 30, joined to crew_v for the name, trade and role. Grouped: EXPIRED (with restriction text), then EXPIRING within 30 days, sorted soonest first. Each row: worker, ticket name, date, days, and whether that worker is on the clock right now (open shifts row) — an expired White Card on someone currently standing on a slab is the one that needs the phone call.

**Every tap target**

- A row → Person live detail (half sheet)
- Call → dialler (action)
- 'Chase it' → posts a message to that worker (action)

**States** — Empty — 'No tickets expiring in the next 30 days.' Single item — one row. Loading — the count renders '—'. Error — if the view returns no row for a non-owner: 'Ticket expiry across the crew is owner-only.' Offline — read-only.

---

## Toolbox notices — the feed

**full screen**

**Reached by** — Safety hub → TOOLBOX, and as a banner at the top of the job's Today tab when an unacknowledged notice exists.

**Roles** — Everyone reads (safety_records_read is company-wide). Everyone acknowledges — but see the states note: THE ACKNOWLEDGEMENT DOES NOT WORK TODAY. Only the owner posts; safety_records_office_write was never widened to captains, so a captain cannot post a notice about their own job.

safety_records rows where kind = 'toolbox', for this site or company-wide (site_id is null), newest first by occurred_at. Each row: title ('No vacuum being used on site', 'Cord not tagged'), the first line of body, occurred_at as 'Tue, 5 Aug · 7:10 am', who ran it (safety_records.ran_by → crew_v.name), a photo thumbnail if photo_path is set, safety_records.status (open / closed), and an ACKNOWLEDGE chip or a 'You signed this' tick derived from safety_records.signatures jsonb — the array shape is [{worker_id, name, signed_at}]. A count: '{n} of {m} acknowledged'.

**Every tap target**

- A row → Toolbox notice detail (half sheet)
- ACKNOWLEDGE inline → appends to safety_records.signatures (action — see states)
- 'Post a notice' (owner) → the composer (full sheet)

**States** — Empty — 'No notices. The owner posts one when something is spotted on site.' Single item — one card, full width. Loading — skeleton. Error — band. Offline — the acknowledge disables. CRITICAL SCHEMA GAP the design must be built around: safety_records has an office-only write policy plus safety_field_insert (which requires worker_id = current_worker_id()), and NO update policy for a non-office user. Acknowledging a notice is an UPDATE of somebody else's row's `signatures` array — it will match zero rows, and PostgREST answers a zero-row UPDATE with success. That is precisely the failure schema_v13 was written to fix for site_files and plan_pins, and it is still live here. Either a toolbox_acknowledgements table lands (the right answer — the same reasoning schema_v10 used to split safety_signatures out of a jsonb blob) or an update policy plus a guard trigger does. Also: notifications.kind has no 'toolbox' value in its CHECK constraint, so a new notice cannot ride the existing NoticeBanner without a migration.

---

## Toolbox notice detail

**half sheet**

**Reached by** — Tapping a notice in the feed or the banner on Today.

**Roles** — Employee: read and acknowledge. Captain: same, plus the acknowledgement roll on their own jobs. Owner: same, plus close/reopen (safety_records.status) and the roll everywhere.

safety_records.title, the full body, occurred_at, ran_by, severity chip when set (low / medium / high), site_id → job_sites.name or 'Company-wide', and the photo from photo_path (signed URL out of the site-files bucket). Then the acknowledgement block: who has signed, from the signatures array, each with name and signed_at; and a big ACKNOWLEDGE — I'VE READ THIS bar for anyone who has not. The copy should say what acknowledging means: 'This records that you read it. It is not a SWMS signature.'

**Every tap target**

- ACKNOWLEDGE → writes the acknowledgement (action)
- The photo → full-screen viewer (modal)
- 'Who hasn't' (captain/owner) → the roll (half sheet)
- Close record / Reopen (owner) → toggles safety_records.status (action)
- Close → dismiss (action)

**States** — Empty — a notice with no body renders title, time and photo only. Loading — skeleton; the photo needs a signed URL so it arrives second. Error — band. Offline — acknowledge disabled, 'Needs signal'.

---

## Post a toolbox notice

**full sheet**

**Reached by** — Owner's Safety hub → 'Post a notice'.

**Roles** — OWNER ONLY under the current policies. If the client wants a captain to post one for their own job — which the brief implies, since it is the captain standing there — safety_records_office_write needs a captains_site() clause the way schema_v19 wrote them for defects.

Job picker (site_id, or 'Everyone, every job' → null). Title, e.g. 'No vacuum being used on site'. Body. Severity (low / medium / high → safety_records.severity). A photo — the camera flow, stored in site-files and written to safety_records.photo_path. Who it goes to: the crew rostered on that site today. kind is fixed at 'toolbox'; occurred_at defaults to now(); ran_by is set to me.

**Every tap target**

- ADD A PHOTO → camera flow (full sheet)
- Job picker → site list (half sheet)
- POST IT → INSERT into safety_records (action)
- Cancel → dismiss (action)

**States** — Empty — n/a, it is a form. Loading — none. Error — inline, form preserved. Offline — the INSERT fails; keep the draft and the photo file and offer retry. The photo upload and the row insert are two writes today and can half-succeed — the redesign should upload first and only insert once the storage path exists, which is the order PhotoScreen already uses.

---

## Defects — the job's list

**full screen**

**Reached by** — Job tab bar → Defects. Brand new on the phone; only the office has this today (SiteRecordsTab.tsx).

**Roles** — Everyone in the company READS the list — defects_read is company-wide, and a tiler standing in the shower needs to know what the list says about it. Everyone can RAISE one — defects_field_insert permits any company member, which was a deliberate decision in schema_v19 ('a defect noticed by the labourer standing in front of it is worth more than the same defect noticed by the office three weeks later'). Only office and captain-on-their-own-jobs can EDIT one — defects_office_write is `current_is_office() or captains_site(site_id)`. So an employee who raises a defect cannot afterwards mark it fixed; the design must not show them a status control that would silently match zero rows.

Counts across the top from the rows: open, in_progress, fixed, verified, rejected. Filter chips: All / Open / Mine (created_by = me) / Ours (responsible = 'us') / Theirs (responsible in 'builder','other_trade'). Each row: defects.ref, defects.location ('Ensuite, Lot 42'), the first line of description, a severity chip (minor / major / critical), a responsibility chip (us / builder / other_trade / client / unknown) — that distinction is half a tiler's defect list and decides who pays — status chip, raised_on, due_on with an overdue treatment when it is past, and a thumbnail from photo_path. A row that has fixed_photo_path shows a small before/after pair.

**Every tap target**

- A row → Defect detail (half sheet)
- RAISE A DEFECT (full-width bar) → the raise flow (full sheet)
- A filter chip → filters (action)
- A thumbnail → photo viewer (modal)

**States** — Empty — 'No defects on this job. That is worth keeping.' Single item — one row plus the counts row; the counts must still render, because '1 open' is the point. Loading — skeleton rows, counts as '—'. Error — band with the message, last rows retained. Offline — read-only from the last fetch; RAISE A DEFECT stays enabled up to the camera step and then fails at upload, which is the wrong shape — the redesign should either queue the draft locally or disable the entry with 'Needs signal to send a defect'.

---

## Raise a defect

**full sheet**

**Reached by** — RAISE A DEFECT on the defects list; also from the photo viewer ('this is a defect') and from a plan pin. The field UI for this does not exist anywhere today — the schema permits it and nothing uses it.

**Roles** — Any role, for any site they can see. The insert only needs company_id = current_company_id(). created_by is set to me. NOTE: an employee's row is then read-only to them.

Photo first — the camera is the point of this screen. Then: location (free text, 'Ensuite, Lot 42' — a QS list is organised by room), description (required), severity (minor / major / critical), responsible (us / builder / other_trade / client / unknown), raised_by_party (builder / client / us / certifier / other — who is complaining, as distinct from who fixes it), due_on (optional). defects.cost_estimate must NOT appear on the phone for a captain or employee — it is what it will cost US to fix, it is deliberately dropped from portal_defects_v for the same reason, and it is money. ref is left to the office. plan_pin_id can be set when the flow is entered from a drawing pin.

**Every tap target**

- TAKE A PHOTO → camera flow (full sheet); the returned storage path becomes defects.photo_path
- Severity / responsible / party chips → select (action)
- Due date → date picker (half sheet)
- 'Pin it on the drawing' → plans, drop a pin, returns plan_pin_id (full screen)
- RAISE IT → uploads the photo then INSERTs the defect (action)
- Cancel → discard confirmation (modal)

**States** — Empty — n/a. Loading — 'UPLOADING…' on the button during the storage put. Error — if the storage upload fails, nothing is inserted and the photo stays in the form; if the INSERT fails after a successful upload, the path is kept so a retry does not re-upload. Offline — both writes fail. Keep the photo File and every typed field; a defect the worker described and lost is worse than one never raised.

---

## Defect detail

**half sheet**

**Reached by** — Tapping a defect row.

**Roles** — Employee: read, plus 'add a photo' (waterproofing_photos is the only photo table with a field-insert; a defect's fixed_photo_path is a column on defects, so an employee cannot write it — the design should route a worker's fix photo into site_files with category 'after' and let a captain attach it, or a migration should widen the update). Captain on own jobs and owner: full edit, status transitions, verify.

defects.ref and location as the title. description in full. Chips: severity, responsible, raised_by_party, status. Dates: raised_on, due_on, fixed_on, verified_on, and verified_by → crew_v.name. Before photo (photo_path) and after photo (fixed_photo_path) side by side. note. created_by → name. Linked plan pin if plan_pin_id is set. No cost_estimate.

**Every tap target**

- A photo → full-screen viewer with pinch zoom (modal)
- MARK IN PROGRESS / MARK FIXED (captain, owner) → sets status and fixed_on (action)
- VERIFY (captain, owner) → sets status='verified', verified_on, verified_by = me (action)
- REJECT (captain, owner) → status='rejected' with a reason into note (half sheet then action)
- 'Add the after photo' → camera flow (full sheet)
- 'Open on the drawing' → plans at that pin (full screen)
- Close → dismiss (action)

**States** — Empty — a defect with no photo shows a placeholder that says 'No photo. A defect closed without a photo is a defect reopened.' Loading — the two photos need signed URLs and arrive after the text. Error — a failed status change surfaces the message and reverts the chip; it must not stay optimistically flipped. Offline — all writes disabled with 'Needs signal'.

---

## Wet areas — waterproofing on this job

**full screen**

**Reached by** — Job tab bar → Waterproofing, and from the job's Today tab when site_waterproofing_v.outstanding_count > 0. Nothing on the phone touches waterproofing today.

**Roles** — Everyone reads (waterproofing_read is company-wide — 'a chippie needs to know the membrane is not signed off before they screed over it'). Anyone can CREATE a wet area record (waterproofing_field_insert), and the waterproofing_stamp_signoff trigger silently downgrades status to 'in_progress' if a non-office, non-captain inserts one already marked signed_off. Only office and captain-on-own-jobs can UPDATE — so the tiler who laid the membrane can start the record but cannot afterwards tick 'flood tested'. That is a real gap for the phone and should be flagged in the design.

A summary strip straight from site_waterproofing_v: area_count, signed_off_count, outstanding_count, failed_count, and two warnings that are otherwise silent — unflooded_count ('signed off with no flood test') and unphotographed_count ('signed off with no photo'). Then one card per waterproofing row, unique per (site_id, area): area ('Ensuite', 'Main bath', 'Laundry'), product_name and batch_no ('Ardex WPM 300 · batch 4471'), coats, status chip (planned / in_progress / complete / signed_off / failed), flood_tested with flood_test_on and flood_test_hours, completed_on, signed_off_name and signed_off_at, and a photo count by stage.

**Every tap target**

- A card → Wet area record (half sheet)
- ADD A WET AREA → the new-area form (full sheet)
- The unflooded/unphotographed warnings → filters the list to them (action)
- A photo count → the stage gallery (full screen)

**States** — Empty — the strongest empty state in the app: 'No wet areas recorded. A membrane is covered by screed and tiles within a day of going in — after that, what is written here is the only evidence it was ever done properly.' Single item — one card and the full summary strip. Loading — the strip renders '—' not 0; 'no wet areas' and 'not loaded' are different. Error — band. Offline — read-only; ADD A WET AREA disabled.

---

## Wet area record

**half sheet**

**Reached by** — Tapping a wet-area card.

**Roles** — Employee: read, plus adding photos (waterproofing_photos_field_insert lets any company member insert a photo — deliberately: 'a worker photographing the membrane they just laid is the entire point'). Captain on own jobs and owner: every field, the flood test, and sign-off.

area as the title, with the status chip. Fields, all real columns: product_name and product_id (→ products), batch_no ('straight off the drum'), substrate, primer, coats (1–5), bond_breaker, angle_fillet, wall_height_mm (with the AS 3740 note: 150 mm minimum outside a shower, 1800 inside one), started_on, completed_on, installer_id → crew_v.name, installer_licence, flood_tested / flood_test_on / flood_test_hours (24, per clause 3.7), note. Then the photo strip grouped by waterproofing_photos.stage: substrate, primer, fillet, membrane, second_coat, flood_test, other — with a count per stage and an obvious gap where a stage has none. Then sign-off: signed_off_by, signed_off_name, signed_off_at, and certificate_no / certificate_path when issued.

**Every tap target**

- A stage group → the stage gallery (full screen)
- ADD A PHOTO → camera flow with the stage pre-selected (full sheet)
- 'Flood tested — 24 hours' toggle (captain/owner) → sets flood_tested, flood_test_on = today, flood_test_hours = 24 (action)
- Bond breaker / angle fillet toggles (captain/owner) → action
- SIGN IT OFF (captain/owner) → sign-off confirmation (modal)
- 'Certificate' (when signed_off) → the certificate (full screen)
- Close → dismiss (action)

**States** — Empty — a freshly created record shows the area, 'in_progress', and a prompt naming the first photo to take: 'Photograph the fillet before you coat it.' Loading — text first, photos as signed URLs arrive. Error — a rejected write surfaces the message; an employee tapping a captain-only toggle must be shown the control disabled rather than allowed to tap into a zero-row update. Offline — photos cannot upload; toggles disabled.

---

## Add a wet area

**full sheet**

**Reached by** — ADD A WET AREA on the wet areas list.

**Roles** — Any role can create one — the field-insert policy is deliberate. The trigger will refuse to let a non-office, non-captain create one already signed off, so the form must not offer that status at all.

area (required — and it is uniquely constrained with site_id, so a duplicate must be caught and offered as 'Ensuite already exists — open it'), product_name or a picker over products where kind = 'waterproofing', batch_no, substrate ('Fibre cement sheet'), primer, coats (default 2), wall_height_mm, started_on (defaults today), installer_id (defaults me). A standing note taken from the office screen and worth repeating on the phone: 'The batch number matters more than it looks. If a membrane fails in two years the manufacturer's first question is which drum it came out of, and by then the only place that answer exists is here.'

**Every tap target**

- Product picker → products list (half sheet)
- 'Scan the drum' → camera flow, the photo lands as a 'other'-stage waterproofing photo so the batch is legible even if the field is mistyped (full sheet)
- ADD IT → INSERT with status 'in_progress' (action)
- Cancel → discard confirmation (modal)

**States** — Empty — n/a. Loading — button shows SAVING…. Error — a unique-violation on (site_id, area) must be translated: 'There is already a record for Ensuite on this job.' Offline — the INSERT fails; keep the form.

---

## Waterproofing stage gallery

**full screen**

**Reached by** — Tapping a stage group on the wet area record, or the photo count on the list.

**Roles** — Everyone reads; everyone can add. Deleting is office-only — the storage policy (crewline_delete) requires current_is_office(), so a worker cannot remove a photo they just took, which the UI must reflect.

Tabs or a segmented strip across the seven waterproofing_photos.stage values, each with a count. Grid of photos with taken_at, caption, and the uploader. A prominent warning band when the record is signed_off and this gallery is empty, mirroring site_waterproofing_v.unphotographed_count: 'This wet area is signed off with no photos. The certificate has nothing behind it.'

**Every tap target**

- A photo → viewer (modal) with caption, taken_at, stage
- ADD TO THIS STAGE → camera flow (full sheet)
- A stage chip → filters (action)

**States** — Empty — per stage: 'No {stage} photos. This is the one nobody can go back and take.' Single item — one photo, full width rather than a lonely grid cell. Loading — grey tiles at final aspect while signed URLs are minted. Error — band. Offline — the grid renders whatever is cached; ADD disabled.

---

## Sign off a wet area

**modal**

**Reached by** — SIGN IT OFF on the wet area record.

**Roles** — Captain on their own jobs, and owner. An employee must not see this button at all — the trigger would silently rewrite their status to 'in_progress' and the screen would appear to have worked.

A confirmation that states exactly what the database will do, because waterproofing_stamp_signoff does it rather than the form: signed_off_at is set to now(), signed_off_by to the caller's worker id, signed_off_name to their name, and completed_on is filled with today if it was still null. None of those are form fields and none can be back-dated. Then the two weaknesses, checked live before the button is armed: 'Flood test not recorded' (flood_tested is false) and 'No photos on this record' (no waterproofing_photos rows). Both are allowed but both must be shown — a certificate signed off without either will not survive being asked about. Copy: 'This signs the certificate in your name, dated now. You can be asked about it in two years.'

**Every tap target**

- SIGN IT OFF → UPDATE status = 'signed_off' (action)
- 'Record the flood test first' → back to the record with the toggle focused (action)
- 'Take a photo first' → camera flow (full sheet)
- Cancel → dismiss (action)

**States** — Empty — n/a. Loading — button shows SIGNING…. Error — the message verbatim. Offline — disabled; a sign-off must not be optimistic. Also worth designing: withdrawing a sign-off (status back to 'complete') clears signed_off_at, signed_off_by, signed_off_name, certificate_path and certificate_no — the trigger nulls all five, so the confirmation for withdrawing has to say the certificate number is destroyed.

---

## Waterproofing certificate

**full screen**

**Reached by** — 'Certificate' on a signed-off wet area. Generated today only in the office by waterproofingPdf() in src/data/documents.ts.

**Roles** — Captain (own jobs) and owner can generate and share. An employee can view a certificate that already exists (certificate_path is on a company-readable row) but should not be able to issue one.

The rendered PDF from waterproofing.certificate_path, or the generate action when it is null. The document carries: company name, ABN, licence_no (companies.licence_no — 'BLD 187384'), job_sites.name and address, the area, product_name, batch_no, substrate, primer, coats, wall_height_mm, bond_breaker, angle_fillet, completed_on, flood_tested with flood_test_on and flood_test_hours, installer name and installer_licence, signed_off_name and signed_off_at, and certificate_no. Above it, a plain line: 'This is the document the builder puts in their handover file.'

**Every tap target**

- GENERATE THE CERTIFICATE → builds the PDF and stores the path (action)
- SHARE → the OS share sheet, so it can go to the builder from the ute (action)
- 'Email to the builder' → the builder_contacts row with role 'accounts' or 'contract_admin' (half sheet)
- Close → back to the record (action)

**States** — Empty — not signed off: 'A certificate can only be issued once this wet area is signed off.' Loading — 'BUILDING THE DOCUMENT…'. Error — the generation failure message; the record is untouched. Offline — generation requires the row and the photos; disabled with 'Needs signal'.

---

## Daily log

**full screen**

**Reached by** — Job tab bar → Log, and the Daily Log tile on the on-clock ActionGrid. DailyLogScreen.tsx.

**Roles** — Employee: can draft and send — daily_logs_field_update permits ANY company member to update, with no guard trigger, which is looser than every neighbouring table and worth flagging. Captain: the same, plus daily_logs_captain_write on their own jobs. Owner: everywhere. There is exactly one row per (site_id, log_date), so two people editing the same day overwrite each other with no conflict handling today.

Header: 'Daily log', '{job_sites.name} · {dayDate(today)}', and a DRAFT / SENT chip from daily_logs.status. If no row exists: a 'Start from today' card offering POST /api/draft-log, which assembles the day from punches, photos and deliveries. Fields, each a real column: weather (typed, not fetched — there is no weather service wired up and the screen says so), work_completed, materials, issues. A read-only 'WHO WAS ON' block rendered from daily_logs.crew_summary jsonb ('Dave 8.2 hrs · Sam 7.5 hrs'), snapshotted at generation so the log stays true even if a timesheet is edited later. equipment_note and extra_notes exist on the table and are not on the phone; the redesign should decide whether to surface them. Footer: SEND TODAY'S LOG / SEND THE CHANGES, with 'Nothing is posted until you send it.'

**Every tap target**

- DRAFT TODAY FOR ME → POST /api/draft-log (action)
- Any field → keyboard (inline)
- SEND → upsert with status='confirmed', confirmed_by = me, confirmed_at = now (action)
- ‹ Back → the job (action)

**States** — Empty — the 'Start from today' card is the empty state; there is deliberately no blank form staring at the worker. Single item — a crew_summary of one person renders as one name, not a list header. Loading — 'DRAFTING…' on the button. Error — the message in a red band above the fields, everything typed preserved. Offline — the draft endpoint and the upsert both fail. This screen holds several minutes of typing and has no local persistence at all; the redesign must keep a local draft.

---

## Camera capture — the flow, not the button

**full sheet**

**Reached by** — Every 'take a photo' entry point in the app: the ActionGrid tile, a defect, a wet-area stage, a receipt, a toolbox notice, a ticket copy. PhotoScreen.tsx today.

**Roles** — Everyone. site_files_field_insert requires uploaded_by = current_worker_id(), so a photo is always attributed. Deleting is office-only (crewline_delete on storage.objects), which the UI must reflect — there is no 'delete this photo' for the person who took it.

Step 1, before capture: a hatched placeholder, a CameraIcon, and a full-width yellow OPEN CAMERA button which is an <input type="file" accept="image/*" capture="environment"> — on iOS and Android this hands off to the OS camera and returns a File; there is no in-app viewfinder and the redesign should decide whether to build one. Step 2, after capture: a 260 px preview with a blue tick badge and a bottom gradient reading '{job_sites.name} · {h:mm}'. Then WHAT IS THIS? — category chips mapping exactly to site_files.category for photos: progress / issue / before / after / inspection. Then CAPTION (OPTIONAL) → site_files.caption. Then a locked metadata block: Site, Taken (from the capture moment, not the upload), GPS ('±{accuracy} m' or 'No fix yet') — each with a padlock, because these are the fields that make the photo evidence and the worker cannot edit them. A site picker appears only when the tracker has not placed the worker inside a fence. Step 3: UPLOAD TO {SITE} → puts the file into the private site-files bucket at {company_id}/{site_id}/{file} (25 MB limit) and then INSERTs site_files {company_id, site_id, uploaded_by, kind:'photo', storage_path, name, mime, size_bytes, category, caption, lat, lng, taken_at}.

**Every tap target**

- OPEN CAMERA → OS camera (action; raises the camera permission prompt the first time)
- A category chip → selects (action)
- Caption field → keyboard (inline)
- Site picker → site list (half sheet)
- UPLOAD TO {SITE} → the two-step upload (action)
- Cancel → discard confirmation (modal) — today it discards silently, which loses the shot

**States** — Empty — the pre-capture state with the hatched placeholder. Loading — 'UPLOADING…' with the button dimmed; there is no progress percentage today and a 20 MB photo on site data deserves one. Error — 'Upload failed.' or the Postgres message in a red band; the File and every field are kept. Offline — the upload fails outright. This is the single most important thing to fix in the redesign: a photo of a membrane that will be under screed by lunchtime cannot be allowed to depend on reception. It needs a local queue (IndexedDB) with a visible 'N photos waiting to send' strip, the same shape as the location queue but durable.

---

## Photos — the job's gallery

**full screen**

**Reached by** — Job tab bar → Photos. PhotosTab.tsx.

**Roles** — Everyone reads every photo on a site they can see (site_files_read is company-wide). 'Mine' filters on uploaded_by = me. Nobody deletes from the phone.

Header: 'Photos', '{job_sites.name} · {n} photos'. A site picker when more than one site is visible. Filter chips at 44 px (glove-sized, per the brief): All / Mine / Issues / Progress, each with a count. Then day groups, newest first, keyed on site_files.taken_at falling back to created_at. Each tile: the image from a 1-hour signed URL, the category label, clockTime(taken_at), the uploader's initials, and an 'On site' badge computed by comparing site_files.lat/lng against the site centre and radius_m — null rather than false when the photo has no coordinates, because 'we don't know' and 'they weren't there' are very different claims to put next to somebody's name.

**Every tap target**

- A tile → photo viewer (half sheet, expandable to full)
- A filter chip → filters (action)
- Site picker → site list (action)
- TAKE A PHOTO → camera flow (full sheet)

**States** — Empty — 'No photos on this job yet. Yours will show here the moment they upload.' Single item — one tile at full width with its day header. Loading — grey tiles at the final aspect ratio so the grid does not reflow; signed URLs are minted 60 at a time. Error — band with the message; the grid keeps what it has. Offline — cached images render, uncached tiles show a 'not downloaded' state rather than a broken image.

---

## Photo viewer

**half sheet**

**Reached by** — Tapping a tile in the gallery, a thumbnail on a defect, a toolbox photo, or a wet-area stage photo.

**Roles** — Everyone views. Flagging as an issue is an UPDATE on site_files, which schema_v13 explicitly opened to field workers (site_files_field_update plus site_files_worker_guard narrowing which columns) — so this one DOES work for an employee. Deleting does not, at any role, from the phone.

The image, pinch-zoomable. Beneath: site_files.caption, category, taken_at as 'Wed, 5 Aug · 7:14 am', the uploader from crew_v, the on-site verdict with the metre figure, and the file name. When the photo is linked to a defect or a waterproofing stage, that link is named.

**Every tap target**

- The image → full-screen (modal)
- 'Flag as an issue' → sets category = 'issue' (action)
- 'Raise a defect from this' → the raise-a-defect flow with photo_path pre-filled (full sheet)
- 'Attach to a wet area' → stage picker (half sheet)
- Share → OS share sheet (action)
- Close → dismiss (action)

**States** — Empty — n/a. Loading — a blurred low-res placeholder until the signed URL resolves. Error — 'Could not load this photo.' with a retry. Offline — cached images show; the flag action disables.

---

## Upload a receipt

**full sheet**

**Reached by** — The Upload Receipt tile on the ActionGrid. ReceiptScreen.tsx. Writes expenses.

**Roles** — Everyone submits. expenses_field_insert requires submitted_by = current_worker_id(). READS are narrowed: expenses_read is `current_is_office() OR submitted_by = current_worker_id()` — so a worker sees their own dockets and a CAPTAIN SEES ONLY THEIR OWN TOO, not their crew's, because a job's cost base is not captain information. The amount fields are the one place a dollar figure legitimately appears on a worker's phone: it is what they spent, not what anything is worth.

A yellow OPEN CAMERA / READING RECEIPT… / RETAKE PHOTO button (file input with capture). On capture the file goes to the private `receipts` bucket and is then POSTed to /api/parse-receipt. When extraction returns, an info banner: 'Read from photo — confidence {n}%. Check every field below.' Fields, each with a '· read from photo' marker that clears the moment the worker edits it: JOB SITE (expenses.site_id, prefilled from the fence with 'Prefilled from where you are right now.'), Vendor, Date (spent_on), Amount, Tax, Category (Materials / Subcontractor / Equipment Rental / Permits / Fuel / Other → expenses.category). Line items read from the photo render as a read-only list into expenses.line_items. Saved rows always land with status 'needs_review'; ai_note and ai_confidence are stored verbatim so a wrong reading is visible rather than buried.

**Every tap target**

- OPEN CAMERA → OS camera then upload then extract (action)
- Any field → keyboard (inline)
- Site picker → site list (action)
- SAVE EXPENSE → INSERT into expenses (action)
- Cancel → dismiss (action)

**States** — Empty — the button and nothing else; the fields are usable by hand before any photo. Loading — 'READING RECEIPT…' with the button dimmed; a 501 from /api/parse-receipt means extraction is not configured and is handled silently, leaving a fully usable manual form. Error — "Couldn't read the receipt automatically — {reason}. Enter it by hand." The photo is already uploaded at that point, so receipt_path survives. Validation error: 'Vendor, date, and amount are required.' Offline — the storage put and the extraction both fail; the typed values must survive.

---

## My receipts

**full screen**

**Reached by** — Time tab → a third segment, or the Account sheet. Does not exist today — a worker photographs a docket and never sees it again, which is why schema_v14 deliberately kept submitted_by readable.

**Roles** — Employee and captain: only rows where submitted_by = me. Owner: everything, but that is the office screen (Expenses.tsx), not this one.

Own expenses rows, newest by spent_on: vendor, spent_on, amount and tax, category, job_sites.name via site_id, and a status chip — needs_review 'With the office', confirmed, flagged. A thumbnail from receipt_path. Total spent this week, of your own dockets only.

**Every tap target**

- A row → receipt detail (half sheet) with the full image and line_items
- The thumbnail → viewer (modal)
- UPLOAD A RECEIPT → the capture flow (full sheet)

**States** — Empty — 'No receipts yet. Photograph a docket and it goes straight to the office.' Single item — one row plus the week total. Loading — skeleton. Error — band. Offline — read-only from cache.

---

## Site chat

**full screen**

**Reached by** — Job tab bar → Chat, and the app-level Chat tab. ChatScreen in WorkerApp.tsx.

**Roles** — Everyone in the company reads and writes (messages_read is company-wide; messages_field_insert requires author_id = current_worker_id()). One channel per site, created automatically by the create_site_channel trigger on job_sites insert.

Messages for the site's channel (channels.kind = 'site'), oldest at top, with the author's name and initials from the joined workers row. System messages (messages.kind = 'system', author_id null) render differently and are written by /api/ping: '{name} clocked in at {site} · 7:04am', '{name} left {site} · clocked out 3:31pm', '{name} passed {site} 7:12am — not clocked in (43s on site)'. This is why clock events feel like part of the app rather than a bolt-on, and it is the closest thing the phone has to a live sign-on feed for the crew. A composer with an attachment path (messages.attachment_path).

**Every tap target**

- Send → INSERT into messages (action)
- Attachment → camera flow (full sheet)
- A site picker when more than one channel is visible (half sheet)
- A system clock message → the shift evidence (half sheet)

**States** — Empty — 'No messages on this job yet.' Single item — one bubble. Loading — skeleton bubbles; the screen subscribes to postgres_changes on messages for live delivery. Error — band. Offline — the composer disables and queued text is preserved; there is no send queue today.

---

## My jobs — the roster

**full screen**

**Reached by** — The My Jobs tile on the off-clock screen, and the notice banner's link_nav = 'Schedule'. ScheduleScreen in WorkerApp.tsx.

**Roles** — Employee: their own assignments rows where published = true, next 21 days. Captain: the same for themselves; their crew's roster is a different screen. Owner: the same personally.

Day groups, 'Today' or dayDate(). Each card: job_sites.name, clockTime(assignments.starts_at)–clockTime(assignments.ends_at), job_sites.address, and assignments.note. Today's card carries a green left border. The card should also carry the sign-on state for that job — whether unsigned_safety_docs() is empty — because the useful question the night before is 'do I need to sign anything before I start'.

**Every tap target**

- A card → enters that job (full screen)
- The address → maps (action)
- 'Sign on now' on a card with unsigned docs → the gate (full sheet)

**States** — Empty — 'Nothing published for the next three weeks. Your foreman publishes the roster from the office and it shows up here.' Single item — one day group with one card. Loading — 'Loading…'. Error — band. Offline — read-only from the last fetch; assignments is on the realtime publication so it refreshes on reconnect. Note: only published = true rows are ever shown, which is deliberate — an unpublished roster is a draft.

---

## Account sheet

**half sheet**

**Reached by** — Tapping the avatar on any tracker header, or the ON THE CLOCK pill on the on-clock screen (the design has no header there, so the pill is the tap target). AccountSheet in WorkerApp.tsx.

**Roles** — Same for all roles; the sheet should show workers.role as a badge ('Owner', 'Crew captain', 'Crew') so a captain knows why they can see a job's defects and not its contract.

Avatar (workers.initials on theme.rail), workers.name, workers.trade. Sign out. Close. Then a divided section: 'Delete my account' in theme.alert, deliberately NOT adjacent to Sign out because people tap that without reading, and a link to /privacy reading 'What Crewline records about you'. The redesign should add here: workers.ordinary_hours ('Your ordinary week is 38 hrs'), the tracking backend note from backendNote(), and a shortcut to My tickets.

**Every tap target**

- Sign out → supabase.auth.signOut() (action)
- Delete my account → the deletion flow (full sheet)
- 'What Crewline records about you' → /privacy (external)
- Backdrop or Close → dismiss (action)

**States** — Empty / loading — n/a, everything is already in `me`. Error — a failed sign-out is silent today and should not be. Offline — sign out clears the local session and works; delete account requires the server and must say so.

---

## Delete my account

**full sheet**

**Reached by** — Account sheet → 'Delete my account'. DeleteAccount.tsx. Required by App Store Guideline 5.1.1(v).

**Roles** — Everyone can reach it. An owner who is the only remaining owner is BLOCKED — the check counts workers where role = 'owner' and deleted_at is null, excluding themselves, and must use deleted_at rather than active (a stood-down owner still has a working login and still counts). delete_worker_account() raises 'sole_owner' server-side, so the client check must not be stricter than the server's.

Step REVIEW — two lists, and they must be exactly these because they are the real split the schema draws. THIS STAYS: 'Your timesheets and hours worked. Australian law (the Fair Work Act) requires your employer to keep pay records for 7 years — deleting your account can't shorten that.' and 'Site photos, defects and other job records you added. They're evidence about the job, not personal data about you.' THIS GOES: your login; your location history (positions and dwell_state are hard-deleted); and you come off the active crew list. An owner with another owner sees a warning that office access ends immediately. A sole owner sees the block with the way out: make someone else owner from Crew settings first. Step CONFIRM — type DELETE. Step WORKING. Step DONE — sign-out already happened as a side effect of reaching this step, so 'you've been signed out' is true when it is shown. Step ERROR.

**Every tap target**

- Continue → CONFIRM (action)
- The DELETE field → keyboard (inline)
- Delete my account → POST /api/delete-account (action)
- Cancel → dismiss (action, disabled during WORKING)

**States** — Empty — n/a. Loading — 'Checking whether another owner can take over…' while the owner count resolves; the button stays disabled through it, and a failed check must not clear the warning. Error — 'Could not delete your account. Try again, or contact support.', or 'Your session has expired. Sign in again before deleting your account.' Offline — 'Could not reach the server. Check your connection and try again.' Nothing is half-applied: delete_worker_account() is one statement-level unit and the login is only deleted after it succeeds.

---

## Sign in

**full screen**

**Reached by** — Any launch with no session. AuthScreen via WorkerApp's `if (!session)`.

**Roles** — Pre-role. The role is only known after `me` resolves from the workers row matched on auth_user_id.

Email and password / magic link, per AuthScreen. Should carry the app's promise in one line, because this is the first thing a new chippie sees, and the privacy link, because location tracking is the product.

**Every tap target**

- Sign in → Supabase auth (action)
- 'What Crewline records about you' → /privacy (external)

**States** — Empty — the form. Loading — 'One moment.' (the Notice component). Error — the auth message. Offline — sign-in requires the network and says so.

---

## Not linked to a company

**full screen**

**Reached by** — A valid session with no matching workers row — WorkerApp renders this when `me` is null.

**Roles** — Pre-role.

'Not linked to a company' and 'Ask your office to add you to the crew list, then sign in again.' The match happens on workers.invite_email (lower-cased, uniquely indexed), so the copy should name the email they signed in with, which is the thing the office has to get right.

**Every tap target**

- Sign out → back to Sign in (action)
- 'Copy my email' → clipboard, so they can send it to the office (action)

**States** — This screen IS an error state. Loading — 'Loading… One moment.' Offline — indistinguishable from a failed lookup today; the redesign should separate 'we couldn't check' from 'you are not on the list'.

---

## Not configured

**full screen**

**Reached by** — A build with no Supabase credentials — WorkerApp's `if (!supabaseConfigured)`.

**Roles** — Pre-role.

'Not configured — This build has no Supabase credentials.' Developer-facing, but it ships, so it needs to look like the app rather than a stack trace.

**States** — Terminal. No loading, no retry, no offline distinction.

---

## Privacy — what Crewline records about you

**full screen**

**Reached by** — The link in the Account sheet and on the gate's PrivacyLine. /privacy, opened externally today; it should be an in-app screen.

**Roles** — Same for all roles.

The specifics, not boilerplate, and every one of them is checkable in the schema: a position fix roughly every 20 seconds while tracking is on, including the drive to site; raw positions deleted after 3 days by prune_positions(); shifts kept 7 years under the Fair Work Act; the office can see your trail for today only (every live query is `.gte('at', startOfToday())`); a photo carries the coordinates the phone reported when the shutter went; on Android a permanent notification says 'Crewline is tracking your location' whenever the watcher is running; nothing is recorded before you tap START TRACKING; and stopping tracking does not end your shift. The current accuracy figure ('±{n} m') where a live fix exists.

**Every tap target**

- 'Delete my account' → the deletion flow (full sheet)
- 'Stop tracking now' → stops the watcher (action)

**States** — Static. Loading / error / offline — none; this must render without the network, because a worker who cannot read the privacy terms offline has been told nothing.

---

## SDS and product data — readily accessible

**full screen**

**Reached by** — Safety hub → the SDS section; also from a product named on a wet-area record.

**Roles** — Everyone reads — products, product_documents and site_products are all company-wide reads, and schema_v11 says why: 'readily accessible' is the actual wording of the WHS obligation, and a register only the office can open does not meet it. Only the office writes.

site_sds_register_v rows for this site: product name, brand, supplier, the area it is used in, whether an SDS exists, its issued_on date, and sds_current — false both when there is no sheet and when the sheet is more than five years old, because both fail an inspection equally. Alongside it, the TDS list from product_documents where kind = 'tds', which is what a tiler actually opens on site (coverage, open time, substrate prep, joint width).

**Every tap target**

- A row → the PDF (full screen viewer)
- 'No current SDS' chip → 'Tell the office' → posts to the site channel (action)
- A tile/grout product → its selection detail (half sheet)

**States** — Empty — 'Nothing on this job needs an SDS.' (no products with hazardous = true). Single item — one row. Loading — skeleton. Error — band. Offline — a cached PDF opens; an uncached one shows 'Not downloaded — you need signal for this sheet', which is itself a compliance problem worth designing for: the redesign should pre-cache the SDS for every hazardous product on a job the worker is rostered to.

---

## Report a hazard / incident

**full sheet**

**Reached by** — Safety hub → 'Report a hazard'. Uses the one field-write that safety_records genuinely permits.

**Roles** — Everyone — safety_field_insert allows an INSERT where worker_id = current_worker_id(). Nobody can edit or close one from the phone except an owner (safety_records_office_write); a captain cannot close a hazard on their own job, which is a gap the redesign should raise with the client.

kind (hazard / incident / jha — 'toolbox' is excluded, that is the owner's composer), title, body, severity (low / medium / high), a photo → safety_records.photo_path, site_id defaulting to the job you are in, occurred_at defaulting to now, worker_id fixed to me. status starts 'open'.

**Every tap target**

- TAKE A PHOTO → camera flow (full sheet)
- Severity chips → select (action)
- REPORT IT → INSERT (action)
- Cancel → discard confirmation (modal)

**States** — Empty — n/a. Loading — SENDING…. Error — message inline, form kept. Offline — fails; keep the draft and the photo. Confirmation should say who sees it: the office, immediately, and it appears on the job's safety list for the crew.

---

## Manual clock-in refused

**inline**

**Reached by** — Tapping 'Clock in manually' when the server declines. Renders as an info Banner on the Approaching screen.

**Roles** — Same for all roles.

The server's own reason, verbatim from the 409 or from PingResponse.notes — 'You need to be inside a job site to clock in. Move closer and try again.' or 'A shift is already open — clock out first.' A client-side pre-check for the no-fix case: 'No GPS fix yet — wait a few seconds for the location dot to steady, then try again.' A generic fallback only if a response somehow arrives with no note: "That didn't clock you in — make sure you're inside the site's boundary and try again." There are two more notes the server can push through this same channel and the design must accommodate both: 'An earlier shift never closed, so this clock-in was refused. Tell the office.' (a 23P01 from shifts_no_overlap) and 'Your clock-out did not save. Your hours are being held — tell the office.'

**Every tap target**

- 'Got it' → dismisses the note (action)
- 'Tell the office' on the stranded-shift note → the site chat, pre-filled (full screen)
- 'How close do I need to be?' → shows the site's radius_m and your current distance (half sheet)

**States** — This is itself a failure state. Loading — the button shows a spinner during the POST. Offline — the tap must be blocked before it fires, with 'You need signal to clock in by hand.' — a manual clock-in that silently does nothing is worse than a disabled button.

---

## Job Today (captain's version) — who is on and what is outstanding

**full screen**

**Reached by** — Entering a job as a captain or owner; the first tab of that job's tab bar.

**Roles** — CAPTAIN AND OWNER ONLY, and this is the screen where the money boundary has to be visibly held. It shows work, never value: no contract sum, no invoice, no margin, no rate, no cost. Those are all office-only in RLS (contracts_read, invoices_read, job_profit_v, job_value_v, job_cost_v, job_money_v all carry current_is_office()), so a captain selecting them gets nothing — and the design must not leave a '—' where a number would be, because an empty slot reads as a permission failure rather than a decision. An employee entering the same job gets the personal Today instead.

Date and job_sites.name and address. ON SITE NOW: open shifts on this site, each with worker name from crew_v, trade, since-time and source. SIGN-ON: how many of today's rostered crew have cleared unsigned_safety_docs(). OUTSTANDING: open defects count, wet areas not signed off from site_waterproofing_v.outstanding_count, open site_instructions count, unacknowledged toolbox notices. THE PROGRAMME: our next window from site_programme_v — our_task, our_start, our_end, start_moved_days ('moved 9 days later since Rev C') and `ready` with blocked_by naming the trades we are waiting on (ready is null, meaning 'unknown', when the programme names no predecessors — never render null as a green light). Supervisor: builder_contacts row for this job (name, role, mobile) — builder_contacts stays company-readable on purpose, precisely so a chippie at a locked gate at 6:50 can ring someone.

**Every tap target**

- A person on site → Person live detail (half sheet)
- The sign-on count → the sign-on roll (half sheet)
- Defects / Waterproofing / Instructions counts → their lists (full screen)
- The supervisor's mobile → dials (action)
- 'Post a notice' (owner) → toolbox composer (full sheet)
- The programme line → the programme detail (half sheet)

**States** — Empty — nobody on site: 'Nobody on the clock here right now.' No programme: 'No programme received for this job.' Loading — counts render '—'. Error — band; each block fails independently so one bad query does not blank the screen. Offline — read-only, stamped 'as of'.

---
