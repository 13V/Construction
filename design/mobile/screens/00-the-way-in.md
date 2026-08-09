# The way in

The way in — everything before you are inside a job: launch, auth and setup, the jobs list the app opens on, the dashboard overview, search and filter, the root tab bar for all three roles, notifications, the account sheet, privacy and account deletion, and the employee's own home.

36 screens. Generated from the codebase, not imagined — every figure named here comes from a table or view that exists. Part of the inventory referenced by `design/PROMPT-mobile-v2.md` section 7.

---

## Boot gate

**full screen**

**Reached by** — Cold launch, before anything else. main.tsx decides the surface and renders one of three things: Booting (Suspense fallback while the worker chunk loads), ConfigError (apiConfigError() returned a message — a Capacitor build with no VITE_API_BASE), or Crash (the error boundary in ui/Crash.tsx). WorkerApp adds a fourth: !supabaseConfigured renders Notice 'Not configured — This build has no Supabase credentials.'

**Roles** — Identical for all three roles — nobody is identified yet. No role data exists until the workers row loads.

Booting: the word 'Loading…' at 13px, theme.inkFaint on theme.appBg, centred, nothing else — deliberately not a spinner or logo, it should be gone in under a second. ConfigError: heading 'This app can't record anything' at 17px/600, then the message from apiConfigError() in theme.inkSoft, max-width 340, centred. This is fatal on purpose: a phone build with no server address signs in, shows a clock, asks for GPS and records nothing, and the failure is invisible until someone relies on it for a day's pay. Crash: surface label 'The worker app', the error message, and a reload action.

**Every tap target**

- ConfigError — nothing tappable. It is a dead end by design; there is no way for the person holding the phone to fix a missing build variable.
- Crash — 'Reload' → restarts the app at the boot gate.

**States** — This screen IS the loading state of the app. Empty state: not applicable. Error state: ConfigError and Crash are the two error states, and both are terminal. Offline: Booting resolves from the cached bundle, so a cold launch offline reaches sign-in or the jobs list normally; it does not hang here.

---

## Sign in

**full screen**

**Reached by** — Any launch with no Supabase session. WorkerApp: !session → <AuthScreen /> in mode 'signin'. Also reached by signing out from the account sheet, and by the last step of account deletion.

**Roles** — Role is unknown and unknowable at this point — workers.role is only readable once auth.uid() resolves to a workers row. The form is byte-identical for an owner, a captain and an employee. Anything that branches on role must come after this screen, never on it.

A single card on theme.appBg. 'Crewline' at 19px/600. Subtitle 'Sign in to your company.' Two fields: Email (type=email, autoComplete=email) and Password (type=password, autoComplete=current-password, minLength 8) — both required. Primary button, the one CTA treatment (linear-gradient(180deg,#FFCD11,#F7B244), 1px #E0A032, uppercase, letter-spacing .04em), reading 'Sign in' or 'Working…' while busy. Below it a plain text button 'Set up a new company' that flips to signup. Errors render at 12.5px in theme.alert directly under the fields; the message is whatever Supabase returned verbatim ('Invalid login credentials'), which is honest but not friendly and should be rewritten for the redesign. There is no 'Forgot password' link anywhere in the codebase — that is a real omission for a workforce where the person who set the account up is often not the person holding the phone.

**Every tap target**

- Email / Password fields → keyboard
- 'Sign in' (CTA) → action: client.auth.signInWithPassword; on success onAuthStateChange fires and the app re-renders into the jobs list; on failure the error line appears and the form stays
- 'Set up a new company' → full screen: the same card in signup mode
- (missing, should exist) 'Forgot password' → full screen: reset-by-email
- (missing, should exist) 'What Crewline records about you' → full screen: /privacy — the privacy policy is only reachable from inside the account sheet today, which means it is only reachable once you already have an account

**States** — Empty: not applicable — the form is the screen. Loading: the button reads 'Working…' and is disabled (background swaps to theme.border); fields stay editable. Error: red 12.5px line under the fields, form retained, nothing cleared. Offline: signInWithPassword fails with a network error that surfaces as a raw fetch message — the redesign needs an explicit 'No signal — sign-in needs a connection. Your last session stays signed in.' Writes nothing locally.

---

## Create a company

**full screen**

**Reached by** — 'Set up a new company' on Sign in, with the 'My office already added me to a crew' checkbox left unticked.

**Roles** — The person who completes this becomes workers.role = 'owner' — api/bootstrap creates the company and the first workers row, and schema_v18's backfill plus workers_sync_role() make is_office true and role 'owner'. There is no way to create a captain or an employee here; those are made by an owner on the office Crew screen and then claimed via the invited path.

Same card as Sign in. Subtitle 'Create a company account.' A checkbox row 'My office already added me to a crew' (unticked here). Then Company name (required, placeholder 'Whitcomb Builders' — should be an Adelaide tiling name for this client), Your name (required, placeholder 'Ray Whitcomb'), Email, Password (minLength 8). CTA 'Create account'. Below, 'I already have an account' flips back to sign-in. On submit: client.auth.signUp, then — only if a session came back — POST /api/bootstrap with {companyName, name} and a Bearer token, then window.location.reload(). With Supabase email confirmation on (the default), signUp returns no session and the flow stops at the Check your email screen instead.

**Every tap target**

- 'My office already added me to a crew' checkbox → inline: hides Company name and Your name, changes the subtitle
- Company name / Your name / Email / Password → keyboard
- 'Create account' (CTA) → action: signUp, then bootstrap, then reload; or lands on Check your email
- 'I already have an account' → full screen: Sign in

**States** — Empty: n/a. Loading: CTA reads 'Working…', disabled. Error: 12.5px theme.alert line — either the Supabase auth error, or body.error from /api/bootstrap, or the fallback 'Could not finish setting up the account'. Offline: both the signUp and the bootstrap POST fail; the account may or may not have been created depending on which call failed, and the screen cannot currently tell the difference. The redesign should make a failed bootstrap after a successful signUp recoverable by signing in again and landing on Finish setup — which is exactly what Finish setup exists for.

---

## Join my crew (my office already added me)

**full screen**

**Reached by** — 'Set up a new company' on Sign in, then ticking 'My office already added me to a crew'.

**Roles** — The role is decided by the row the office already made. workers.invite_email carries a unique index on lower(invite_email); the first login with a matching email claims that row rather than creating a company, so the person arrives already an owner, a captain or an employee with their rate, trade, initials and crew membership already set. The screen cannot show them which — they find out from what the app looks like afterwards.

The card with Company name and Your name hidden — the whole point is that the office already typed those. Subtitle 'Sign up with the email your office invited.' Only Email and Password. The email must match workers.invite_email exactly (case-insensitively) or bootstrap has nothing to claim. There is nothing on this screen that tells the person which email their office used, and no way to check, which is the single most likely place this flow breaks in the yard.

**Every tap target**

- Checkbox (to untick) → inline: reveals Company name and Your name
- Email / Password → keyboard
- 'Create account' (CTA) → action: signUp then POST /api/bootstrap with an empty body {} — the endpoint resolves the invite by email
- 'I already have an account' → full screen: Sign in

**States** — Empty: n/a. Loading: 'Working…'. Error: the most important one is 'no invite for this email', which today surfaces as whatever /api/bootstrap returns; it needs a real message — 'No one has added kane@… to a crew yet. Check with your office that they used this exact email address.' Offline: same as Create a company. Writes nothing until the network call succeeds.

---

## Check your email

**full screen**

**Reached by** — Submitting either signup path when Supabase email confirmation is on and signUp returns no session. Today this is not a screen — it is a grey 12.5px line under the form reading 'Check your email to confirm the account, then sign in.'

**Roles** — Same for all three. Nobody has a workers row yet.

Should be a screen, not a line: the email address it was sent to, in full, so a typo is catchable; 'Open your email app' as the primary action; 'Wrong address? Start again'; and a plain statement that the confirmation link may open in a different browser than this one, which is exactly why Finish setup exists. No resend exists in the code today and should.

**Every tap target**

- 'Open your email app' → action: mailto:/intent out of the app
- 'Wrong address? Start again' → full screen: Create a company / Join my crew with the fields retained
- (missing, should exist) 'Send it again' → action: Supabase resend, rate-limited, with a countdown

**States** — Empty: n/a. Loading: n/a — this is a terminal state of the previous screen. Error: none possible here. Offline: it is a static message and renders fine; the resend action, when it exists, must say 'You're offline — this needs a connection.'

---

## Finish setup

**full screen**

**Reached by** — Signed in (a valid Supabase session) with no workers row — useSession returns me = null. This is the normal landing spot after clicking an email confirmation link, because the click often lands in a different browser than the one that signed up, so the company name and person's name did not survive the hop. CRITICAL GAP: apps/dashboard/src/auth/FinishSetup.tsx is wired into App.tsx (the office surface) only. WorkerApp.tsx renders a dead-end Notice instead. On the phone this path currently has no way out.

**Roles** — Same for everyone, and it decides the role: unticked creates a company and makes you an owner; ticked claims the invited row and you get whatever role the office gave you. Copy under the checkbox already personalises: 'Your login claims the record they created for {session.user.email}.'

Heading 'One more step' at 19px/600. Body: 'Your email is confirmed. Tell us which company this login belongs to and you're in.' Checkbox 'My office already added me to a crew' with the sub-line naming the confirmed email. When unticked: Company name and Your name, both required, uppercase 10.5px/700 labels. Error box in theme.alertFill / theme.alertInk. CTA reads 'JOIN MY CREW' or 'CREATE THE COMPANY' — plain text 'Sign out' below it, because being stuck here with the wrong login must have an exit.

**Every tap target**

- Checkbox → inline: shows/hides the two name fields and swaps the CTA label
- Company name / Your name → keyboard
- CTA → action: POST /api/bootstrap with the freshest access token (it re-reads getSession first rather than trusting the prop), then onDone() → reload → jobs list
- 'Sign out' → action: supabase().auth.signOut() → Sign in

**States** — Empty: n/a. Loading: CTA reads 'SETTING UP…' at 0.6 opacity, disabled. Error: the alertFill box, holding body.error from bootstrap or the fallback. Offline: the POST fails and the box shows a network error; nothing is written, and retrying when signal returns is safe because bootstrap is the only writer. Writes: creates the companies row and the workers row, or claims one.

---

## Not linked to a company

**full screen**

**Reached by** — WorkerApp with a session but me = null. Today's phone behaviour where Finish setup should be.

**Roles** — Same for all. Nothing is readable — every RLS policy keys off current_worker_id(), which resolves through the workers row, so this account can see literally nothing.

Currently a Notice: title 'Not linked to a company', body 'Ask your office to add you to the crew list, then sign in again.' That is right for one case (someone signed up with an email nobody invited) and wrong for the common one (email just confirmed, bootstrap never ran). The redesign should replace this entirely with Finish setup, and keep this wording only as the state after a bootstrap that found no invite: it should then show the signed-in email address so the person can read it out over the phone to whoever adds them.

**Every tap target**

- 'Sign out' → action: signOut → Sign in (missing today — this screen has no tappable element at all, which makes it a genuine trap)
- (should exist) 'Copy my email address' → action: clipboard

**States** — Empty/loading/error: this screen is itself an error state. Offline: renders from nothing, so it shows correctly, but 'sign in again' is advice that cannot be followed without signal.

---

## Could not load your account

**full screen**

**Reached by** — useSession returned an error while selecting the workers row — usually a dropped connection, not a bad account. Exists on the office surface (App.tsx) and not on the phone, which is backwards: the phone is the surface that loses signal.

**Roles** — Same for all three.

'Could not load your account' in theme.alert bold, the error message underneath, then two buttons side by side: 'Try again' (the CTA treatment) and 'Sign out' (white, theme.border). The reasoning is already right in the code — a builder on site loses signal constantly, so this offers the way out instead of being a dead end with a reason printed on it.

**Every tap target**

- 'Try again' → action: reload() bumps the nonce and re-runs the workers select
- 'Sign out' → action: signOut → Sign in

**States** — This is the error state. Loading: while retrying, 'Try again' should show a spinner rather than the screen flashing back to Loading… Offline: the expected cause; the copy should say so explicitly — 'No signal. Your jobs list is still here — tap Try again when you're back in range.'

---

## Home — the jobs list (root)

**full screen**

**Reached by** — The app's home. Signed in, workers row loaded, root tab 'Jobs' selected. It is where every launch lands, where the back arrow out of a job returns to, and what a notification tap falls back to. The client was explicit: the app opens on a list of jobs, not a clock.

**Roles** — Three genuinely different lists, from one component. OWNER: every job_sites row in the company (job_sites_read is company-wide), with the money strip, sourced from job_profit_v — which is office-gated in SQL (`where current_is_office()`), so the strip does not need a client-side role check to be safe, it simply returns no row for anyone else. CAPTAIN: scoped in the client to their jobs — job_sites.captain_id = me.id, plus any site with an assignment whose crew_id belongs to a crew they captain (the same rule captains_site() enforces in SQL). Everything else in the company appears under a collapsed 'Other jobs' group, read-only, with no attention chips — because job_sites_read is company-wide, hiding them entirely would be a lie about what the app knows, and showing them equally would bury their own four jobs. NO money strip, ever: no job_value_ex, no margin, no claimed_pct, no contract_sum, no cost_impact figure on a variation chip. EMPLOYEE: only jobs they are rostered on — assignments.worker_id = me.id with ends_at >= today — plus any job they currently have an open shift on. See 'Employee home' for what this collapses to.

A scroll view. At the top, the dashboard overview block (own entry below), which scrolls away rather than sticking. Then a sticky segmented row: search field + filter button + the group headings as sticky section headers. Then grouped job rows. GROUPING, in this order — 'On site now' (any job with an open shift, i.e. shifts.ended_at is null; for an employee only their own); 'This week' (a job with an assignments row overlapping the next 7 days, or site_programme_v.days_until_start between 0 and 7); 'Active' (job_sites.status = 'active' not already shown); 'Starting soon' (job_sites.status = 'starting_soon', ordered by site_programme_v.our_start nulls last, then contracts.starts_on for an owner); 'Other jobs' (captain only, collapsed); 'Archived' (job_sites.status = 'archived', reachable only through the filter, never rendered by default). WITHIN a group, ordered by attention severity descending, then by name. Attention severity is the max of the reasons in the Attention sheet entry below. Ties break on name so the order is stable between refreshes — a list that reshuffles while a thumb is moving toward it is worse than a list in a dumb order. Section headers carry a count: 'ON SITE NOW · 2', 10px/700, letter-spacing .05em, theme.inkFaint, on theme.rowFill.

**Every tap target**

- A job row → full screen: the job, and the tab bar changes to that job's tabs (the domain boundary — that is another inventory)
- The attention rail/chip on a row → half sheet: 'What needs doing on <job>' (does NOT enter the job)
- The crew chip on a row ('Sam's crew · 3 on site') → half sheet: who is on that job right now
- Search field → full screen: Search
- Filter button → half sheet: Filter and sort
- A dashboard counter → half sheet: the matching counter sheet
- Avatar, top right → half sheet: Account
- Bell, top right → half sheet: Notifications
- Pull down → action: refetch job_sites, job_profit_v, site_programme_v, site_waterproofing_v, defects, change_orders, open shifts
- Long-press a job row → half sheet: quick actions (Call the supervisor · Open in Maps · Message the job channel) — no destructive action on a long-press

**States** — LOADING: skeleton rows — a grey bar for the name, a shorter one for the address, a chip-shaped block — three of them, no spinner, and the dashboard block skeletons its tiles in place. The counters and the list load from separate queries; the block must not hold the list hostage, so whichever lands first renders. EMPTY: see 'Brand new company, no jobs' and 'Employee with no work rostered'. ONE ITEM: no section header shown at all when a single group holds a single row — 'ACTIVE · 1' above one row is noise; the row stands alone with the dashboard block above it. ERROR: an inline strip above the list, theme.alertFill, 'Couldn't refresh — showing what we had at 7:04 am' with a 'Try again' link; the cached list stays on screen and stays tappable. OFFLINE: the same strip in the neutral tone the app already uses for OfflineBanner (design.hairline background, WifiOff icon), reading 'Offline — showing jobs as of 7:04 am'. The list itself writes nothing, so it is fully usable offline; the only root-level write is marking notifications read.

---

## Job row (the component)

**inline**

**Reached by** — Every row in every group of the jobs list, in search results, and in the counter sheets.

**Roles** — One layout, three densities. The money line is the only part that differs structurally, and it is the part RLS already guarantees: job_profit_v returns nothing to a captain or an employee, so the line renders as absent rather than as a redacted placeholder — a design that shows a greyed-out '••••' where a margin would be tells a captain there is a margin to want.

LINE 1 — job_sites.name at 15px/600, single line, ellipsis. To its right, the status chip: 'Starting soon' (theme.warnFill/warnInk) for job_sites.status = 'starting_soon'; nothing at all for 'active', because a chip on every row is not information. LINE 2 — job_sites.address at 13px theme.inkSoft, ellipsis. If job_sites.builder_job_ref is set, it is appended as a dot-separated suffix ('· Lot 42'), because that is what the builder's supervisor says on the phone. LINE 3 — the state of the work, assembled from whichever of these apply, dot-separated, 12.5px: the crew on it today (crews.name via the assignments.crew_id covering now, and the count of open shifts — 'Sam's crew · 3 on site'); progress (job_profit_v.progress_pct for an owner, site_progress_v.pct_complete for a captain — the same number by a different route, since site_progress_v is security_invoker over a company-readable table); the programme window (site_programme_v.our_start / our_end as 'On site Mon 18 Aug', or days_until_start as 'Starts in 9 days'). LINE 4, OWNER ONLY — the money strip: job_profit_v.job_value_ex, then margin_pct coloured by the same thresholds the office Overview already uses (negative → theme.alert, under 15 → theme.warnInk, else theme.successInk), then claimed_pct. When job_profit_v.contract_id is null the strip reads 'No contract entered' in theme.warnInk instead of showing $0 — a zero that means 'nobody typed it in' must never render as a zero that means 'worth nothing'. THE ATTENTION SIGNAL — a 3px full-height rail down the left edge of the row, theme.alert for a critical reason, theme.warning for a warning, absent otherwise; plus up to two chips on line 3 naming the worst reasons ('2 wet areas unsigned', 'Programme moved 9 days'), and a '+3' overflow chip. The rail alone is the glanceable signal; the chips are what make it actionable. Tapping either opens the Attention sheet, not the job.

**Every tap target**

- The row body → full screen: the job
- The attention rail or any attention chip → half sheet: What needs doing
- The crew chip → half sheet: who is on this job now
- Long-press → half sheet: quick actions

**States** — Loading: skeleton, as above. Empty: n/a — a row with no data cannot exist; a job with nothing on it renders lines 1 and 2 and stops, which is correct and common for a job that was just created. Error: a row never shows its own error; a failed sub-query (say site_programme_v) simply drops line 3's programme fragment rather than showing '—'. Offline: renders from cache, unchanged.

---

## Dashboard overview block

**inline**

**Reached by** — The top of the jobs list. IT IS NOT A SEPARATE TAB, and that is a decision worth defending: company_overview_v is declared `... where current_is_office()`, so a captain or an employee selecting it gets ZERO ROWS — not an error, not a subset, nothing. A dashboard tab would therefore be a permanently blank tab for two of the three roles the app has to serve from one build. Beyond that: every counter on it is a filter of the list directly beneath it, so putting them in the same scroll makes the relationship literal (tap 'Variations awaiting approval · 3' and the sheet lists the three jobs you can already see below); the whole thing is one row from one view, so it costs one round trip and can render before the list does; and a separate tab is a destination people visit in week one and never again. The client asked for a dashboard overview, not for a dashboard tab.

**Roles** — OWNER: the full block from company_overview_v. CAPTAIN: no company_overview_v row at all, so the block is replaced by a Today strip computed from their own jobs — date and day, jobs they run, people clocked on across those jobs (readable because shifts_captain_write is FOR ALL, which includes select, scoped by captains_site), open defects and unsigned wet areas on their jobs, and variations awaiting approval on their jobs BY COUNT ONLY (change_orders_read includes captains_site, so they can see that VO-3 exists and what it says; cost_impact must never be rendered). EMPLOYEE: replaced by the Today card — see Employee home.

OWNER, in the client's own order. TODAY — the date and day, from the device clock, formatted the way the rest of the app does it: 'Saturday, 9 August'. 20px/600. Not from the database, and it must degrade honestly if the device clock is wrong; there is nothing to check it against. PROJECTS ACTIVE — company_overview_v.active_jobs (count of job_sites with status = 'active'). TEAMS WORKING — NOT IN THE VIEW. company_overview_v has no crew counter. It must be computed: count(distinct assignments.crew_id) where the assignment covers now and published = true, joined to crews for the names. This is a real gap and the redesign should either add it to the view or state plainly that the number comes from the roster, not from anyone being clocked on. EMPLOYEES ON SITE — company_overview_v.on_the_clock (count of shifts where ended_at is null). Note this counts open shifts company-wide, which is 'on the clock', not strictly 'on site' — a worker who is on the clock and has walked to the ute is still counted. The label should say 'On the clock'. PROJECTS STARTING — company_overview_v.starting_soon (job_sites.status = 'starting_soon'). VARIATIONS AWAITING APPROVAL — company_overview_v.variations_pending, with variations_pending_value beneath it (both from change_orders where status = 'pending_client'). PROJECTS REQUIRING ATTENTION — ALSO NOT IN THE VIEW, and this is the more serious gap. company_overview_v gives item counts (open_defects, waterproofing_outstanding, open_instructions, overdue_invoices, tickets_expiring), not a count of JOBS. The number the client asked for needs a per-job pass over job_profit_v, site_programme_v, site_waterproofing_v, defects and change_orders — which the app already has to do to draw the rails on the rows, so the tile should be computed from exactly the same client-side function that decides a row's rail, guaranteeing the tile and the list can never disagree. Also available and worth carrying, since the view already computes them: work_in_hand, left_to_claim, owed_to_us (with overdue_invoices / overdue_amount), margin_to_date, retention_held, open_defects, open_instructions, waterproofing_outstanding, tickets_expiring. On a phone these belong behind a 'Money' expander rather than on the first screenful — five money tiles above a jobs list turns the home screen into an accounting app. LAYOUT — a 2-across grid of small tiles (10px/700 uppercase label, 22px/600 tabular-nums value, 11.5px note), tone-shifted to theme.warnInk or theme.alert exactly as the office Overview's Tile does. A tile whose value is 0 stays visible and greyed — 'Variations awaiting approval · 0' is worth reading; a tile that disappears when it hits zero makes the grid reflow every day.

**Every tap target**

- Any tile → half sheet: that tile's list (see the counter sheets below)
- 'Money' expander (owner) → inline: reveals work in hand, left to claim, owed to us, margin to date, retention held
- The date → nothing. It is not a control.

**States** — LOADING: the tiles render at their final size with a grey bar where the number goes — no layout shift when they land, because the list below must not jump under a thumb. EMPTY: a brand new company gets zeros in every tile, which is correct and is NOT an empty state — the empty state belongs to the list beneath. ERROR: if company_overview_v fails but the job list succeeded, the block collapses to just TODAY plus a small 'Counters unavailable — pull to retry' line; it must not take the list down with it. OFFLINE: the block shows the last-fetched numbers with a timestamp — 'as of 7:04 am' — because a stale counter presented as live is how someone decides not to chase a variation. Writes nothing.

---

## What needs doing on <job> (attention sheet)

**half sheet**

**Reached by** — Tapping the attention rail or an attention chip on a job row, from the jobs list, search results, or a counter sheet. Deliberately does not enter the job — the whole point of the half sheet is that the row stays visible behind it.

**Roles** — The reason list is filtered by role, and every filter matches an RLS boundary rather than being a UI courtesy. OWNER sees all reasons. CAPTAIN sees only the non-money reasons, and only on jobs captains_site() would return true for. EMPLOYEE never sees this sheet at all — there is no attention rail on an employee's rows; 'requiring attention' is a supervisory concept, and an employee's equivalent is their own SWMS and ticket state, which lives on their Today card.

Job name in the sheet header, then a list of reasons, most severe first, each one line of plain English with the number in it and a chevron. Every reason names its source so nothing on this sheet is a guess. CRITICAL (rail theme.alert): — 'Membrane signed off with no flood test — 2 areas' : site_waterproofing_v.unflooded_count > 0. A certificate that will not hold up. — 'Membrane signed off with no photos — 1 area' : site_waterproofing_v.unphotographed_count > 0. — 'Wet area failed' : site_waterproofing_v.failed_count > 0. — 'Margin negative' (owner) : job_profit_v.margin_pct < 0. — 'Claimed 34% ahead of the work' (owner) : job_profit_v.claimed_pct − progress_pct > 10 — the conversation a builder's QS opens with. — 'Critical defect open' : defects where severity = 'critical' and status in ('open','in_progress'). — 'Not ready — waterproofing not finished, screed not poured' : site_programme_v.ready = false, with blocked_by naming the lines verbatim, when days_until_start <= 7. Turning up to a job that is not ready is a day's wages for nothing and the most common way this business loses money that no invoice records. WARNING (rail theme.warning): — 'Programme moved 9 days later' : site_programme_v.start_moved_days > 0. — 'Starts in 3 days' : site_programme_v.days_until_start between 0 and 7 with no crew booked (no assignments row covering our_start). — 'Site instruction never raised as a variation' : site_instructions where is_variation = true and change_order_id is null — an instruction that changed scope and was done for free. — '2 site instructions open' : site_instructions.status = 'open'. — '3 variations awaiting the builder' : change_orders.status = 'pending_client'. Owner sees the value from cost_impact; captain sees the count and the descriptions only. — '5 defects open' : defects.status in ('open','in_progress'), split by responsible = 'us' versus everything else, because half a tiler's defect list is other trades' damage and the distinction decides who pays. — '4 wet areas not signed off' : site_waterproofing_v.outstanding_count. — 'No contract entered' (owner) : job_profit_v.contract_id is null — the job's value reads zero and no margin can be worked out. — 'Margin under 15%' (owner) : job_profit_v.margin_pct < 15. — 'Cost $14,200 ahead of what's been claimed' (owner) : job_profit_v.unbilled_cost — on a job running to plan this just tracks progress; when it runs away it is the earliest warning that the crew is working faster than the office is billing. — 'Invoice overdue' (owner) : invoice_status_v.overdue for this site_id. — '6 shifts not approved' (owner and captain) : shifts where site_id = this job and approved_at is null and ended_at is not null. — 'SWMS unsigned by 2 of the crew' : safety_documents for this site with no matching safety_signatures row for a worker rostered today.

**Every tap target**

- Any reason row → full screen: the job, opened directly on the tab that answers it (a defect reason opens the job's Defects tab with that defect's half sheet already up; a programme reason opens Programme; a variation reason opens Variations)
- 'Open the job' at the foot → full screen: the job on its default tab
- Drag down / tap the scrim → action: dismiss, back to the list untouched

**States** — LOADING: the sheet opens immediately at its final height with the reasons it already knew from the row (the rail's severity is computed before the sheet exists, so it never opens blank) and fills in the rest. EMPTY: cannot be reached with nothing to show — no reasons means no rail means nothing to tap. If a reason clears while the sheet is open (someone else signed the SWMS), the row animates out and the sheet shows 'Nothing else — this one's clear' rather than closing under the thumb. ERROR: per-reason; a source that failed to load shows 'Couldn't check defects' as its own row in theme.inkFaint rather than silently omitting a reason, because a missing reason reads as an all-clear. OFFLINE: reasons render from the cached fetch with the same 'as of' timestamp as the list. Writes nothing.

---

## Teams working (counter sheet)

**half sheet**

**Reached by** — Tapping the TEAMS WORKING tile on the dashboard block.

**Roles** — Owner: every crew. Captain: only crews on their own jobs. Employee: the tile does not exist.

One row per crew currently booked: crews.name, crews.colour as a 8px dot, the captain's name (crews.captain_id → crew_v.name — crew_v, never workers, because workers carries rate), the job they are on (job_sites.name via the assignment), and how many of the crew are actually clocked on right now versus rostered ('3 of 4 on the clock'). Below, an 'Available' group: active crews with no assignment covering today — the same 'Available' the client's booking grid uses. Sourced from crews, crew_members, assignments (starts_at <= now <= ends_at, published = true) and shifts (ended_at is null). Note honestly: nothing in company_overview_v computes this, so the number in the tile and the rows here must come from the same query or they will drift.

**Every tap target**

- A crew row → full screen: the job that crew is on
- 'Available' crew row → full screen: the booking grid (Teams tab), scrolled to that crew's line
- 'See the whole week' → full screen: Teams tab (the booking grid)

**States** — LOADING: three skeleton rows. EMPTY: 'Nobody's booked on today.' plus, for an owner, 'Book a crew' → the Teams tab. On a Sunday this is the correct and unalarming answer, so the copy must not read like a fault. ONE ITEM: one row, no 'Available' heading if every other crew is out. ERROR: 'Couldn't load who's working' with Try again. OFFLINE: last known, timestamped. Writes nothing.

---

## On the clock (counter sheet)

**half sheet**

**Reached by** — Tapping the EMPLOYEES ON SITE tile.

**Roles** — Owner: everyone with an open shift, company-wide (shifts_read allows office). Captain: only workers on their own jobs (shifts_captain_write is FOR ALL, so select is permitted, scoped by captains_site) — a captain who taps this must not see the count for jobs they do not run, so the tile itself is computed from their own jobs. Employee: no tile.

Grouped by job. Under each job_sites.name: the person's initials avatar, name and trade from crew_v (id, name, initials, trade, role — never workers, because that view exists precisely to leave rate behind), the time they started (shifts.started_at, as '6:52 am'), elapsed time running live, and shifts.source — 'auto' gets a small GPS tick, 'manual' says so. NO hours-times-rate anywhere, for anyone, including the owner — this is a 'who is where' sheet, not payroll. A worker whose last position is outside the fence carries a theme.warning dot, from the geofence_events kind = 'geofence_exception' the server already writes.

**Every tap target**

- A person row → half sheet (stacked): that person's day — their shifts today, the site, in and out times. Owner and captain only.
- A job heading → full screen: that job
- 'Timesheets' (owner) → full screen: the office timesheet view, if the phone carries one

**States** — LOADING: skeletons grouped under a single grey heading. EMPTY: 'Nobody's on the clock right now.' — again, correct at 6pm, so the tone is neutral. ONE ITEM: one job heading with one person under it; the heading stays because the job name is the useful half of the answer. ERROR: 'Couldn't load who's on.' OFFLINE: this is the one sheet where stale data is actively misleading, so it must lead with 'Offline — last checked 7:04 am' rather than trailing it. Writes nothing.

---

## Projects starting (counter sheet)

**half sheet**

**Reached by** — Tapping the PROJECTS STARTING tile.

**Roles** — Owner: all job_sites with status = 'starting_soon'. Captain: only their own. Employee: no tile.

One row per job: job_sites.name, address, the builder (builders.name via job_sites.builder_id) and builder_job_ref, and the start date — site_programme_v.our_start where a programme has been imported, otherwise contracts.starts_on (owner only), otherwise 'No date yet'. Beneath each, a readiness line: site_programme_v.ready (true → 'Ready', false → 'Not ready — ' + blocked_by, null → 'Programme names no predecessors' which is honestly unknown, not a green light) and whether a crew is booked (any assignments row covering our_start). This sheet is where the client's process order becomes visible: for an owner, each row carries a compact checklist of what is missing before the job can go live — contract entered (contracts row exists), programme received (programmes.status = 'current'), project details uploaded (site_files with category in plan/drawing), SWMS uploaded (safety_documents for the site with kind = 'swms'), contractor PO (purchase_orders for the site), crew allocated (assignments). A job with all six ticked is one tap from being booked.

**Every tap target**

- A job row → full screen: that job
- A missing checklist item → full screen: the job on the tab that fixes it (no contract → Contract tab; no SWMS → Safety tab)
- 'Book a crew' on a ready row → full screen: Teams tab, that job's column

**States** — LOADING: skeletons. EMPTY: 'Nothing starting.' with, for an owner, 'A job moves here when its status is set to Starting soon.' ONE ITEM: renders as one row with the full checklist expanded, since there is room. ERROR: standard strip. OFFLINE: cached, timestamped. Writes nothing.

---

## Variations awaiting approval (counter sheet)

**half sheet**

**Reached by** — Tapping the VARIATIONS AWAITING APPROVAL tile.

**Roles** — OWNER: full rows including cost_impact and the total from company_overview_v.variations_pending_value. CAPTAIN: change_orders_read was widened in schema_v18 to include captains_site, so a captain CAN read the rows on their own jobs — and must see co_no, description, raised_on and days_impact, and MUST NOT see cost_impact. This is the sharpest place in the whole inventory where the design has to hold a line the database does not: RLS returns the column, the UI must not render it. The captain's tile counts only their own jobs. EMPLOYEE: no tile, and change_orders_read excludes them entirely.

Grouped by job. Each row: change_orders.co_no ('VO-3'), description, raised_on as 'Raised Wed, 6 Aug', days_impact when non-zero ('+3 days'), and for an owner cost_impact formatted as AUD. A row for an instruction that should be a variation but is not yet — site_instructions.is_variation = true with change_order_id null — appears at the top of the sheet in theme.warnFill, because that one is work already done for free. Foot of sheet, owner only: the pending total.

**Every tap target**

- A variation row → full screen: the job's Variations tab with that variation open (approve/decline lives there, not here — approving is a commitment of the company's money and must happen with the description, photos and reason in front of you, not from a summary sheet)
- An unraised-instruction row → full screen: the job's Site instructions tab, on that instruction
- 'All variations' → full screen: the job list filtered to jobs with pending variations

**States** — LOADING: skeletons. EMPTY: 'Nothing waiting on the builder.' ONE ITEM: one job heading, one row. ERROR: standard. OFFLINE: cached and timestamped; no approve action is offered from this sheet at all, so there is no offline write to reconcile.

---

## Projects requiring attention (counter sheet)

**half sheet**

**Reached by** — Tapping the PROJECTS REQUIRING ATTENTION tile.

**Roles** — Owner: every job. Captain: their own jobs, non-money reasons only. Employee: no tile.

The jobs list, filtered to jobs with at least one attention reason, ordered by severity then name — the same rows, the same rails, the same chips, so this sheet is literally a filtered view of the list behind it rather than a second rendering of the same idea. Each row carries its single worst reason as a subtitle. A 'Critical only / Everything' segmented toggle at the top. This sheet is the honest home of the number that company_overview_v does not compute: it and the tile share one client-side function so they cannot disagree.

**Every tap target**

- A job row → half sheet (replaces this one): What needs doing on that job
- 'Critical only' / 'Everything' → inline: refilters
- Drag up → full screen: the sheet expands to the full jobs list with the attention filter applied, which is the same thing the Filter sheet produces

**States** — LOADING: skeletons. EMPTY: 'Nothing needs you right now.' — the one genuinely good empty state in the app, and it should look like it. ONE ITEM: one row, full width, with all its reasons listed rather than just the worst, because there is room. ERROR: if any one source failed, the sheet says which — 'Defects couldn't be checked' — rather than showing a shortened list as if it were complete. OFFLINE: cached, timestamped, with the same warning about a stale all-clear. Writes nothing.

---

## Search

**full screen**

**Reached by** — Tapping the search field at the top of the jobs list. Takes over the screen — the list dims and is replaced, the root tab bar stays.

**Roles** — Searches only what the role can see. Owner: every job, every builder, every crew, every person. Captain: their own jobs and the people on them, plus other jobs by name only (because job_sites_read is company-wide, pretending a job does not exist when the captain could hear it named on site is worse than showing it with no detail). Employee: their own rostered jobs only; there is no company directory for an employee.

A single field, autofocused, with the keyboard up. Results appear as you type, from the third character, grouped by kind with 10px/700 headings: JOBS — matches job_sites.name, job_sites.address, job_sites.builder_job_ref (the builder's own lot number, which is what a supervisor says on the phone), job_sites.job_type. Rendered as full job rows, so a searched job looks identical to a listed one. BUILDERS (owner) — builders.name, builders.abn. Tapping filters the job list to that builder's jobs. PEOPLE — crew_v.name, crew_v.initials, crew_v.trade. Never workers, so a search result can never carry a rate. CREWS — crews.name and the captain's name. VARIATIONS (owner, captain) — change_orders.co_no and description, since 'VO-3' is a thing people say out loud. Recent searches persist locally and show before typing starts, with a 'Clear' action.

**Every tap target**

- A job result → full screen: the job
- A builder result → action: returns to the jobs list filtered to that builder
- A person result → half sheet: that person's card (name, trade, crew, which job they are on today) — never a rate
- A crew result → full screen: Teams tab at that crew's row
- A recent search → inline: re-runs it
- 'Cancel' → action: back to the jobs list, scroll position preserved

**States** — BEFORE TYPING: recent searches, or if there are none, 'Search jobs, builders, crews and people' as placeholder text and nothing else — no suggestions, no trending, nothing invented. LOADING: results are local-first from the already-fetched job list, so jobs appear instantly; the remote-only kinds (builders, variations) show a single 'Searching…' line under their heading. EMPTY: 'Nothing matches “glenelg”.' plus, for an owner, 'Add a job' → the job-create flow. ERROR: the local job results still render; the remote groups say 'Couldn't search variations.' OFFLINE: job, crew and people search all work from cache and should say so once — 'Offline — searching what's on this phone.' Writes nothing except the local recent-search list.

---

## Filter and sort

**half sheet**

**Reached by** — The filter button beside the search field on the jobs list. Also the destination of 'Archived' — archived jobs exist only behind this sheet.

**Roles** — Owner gets every facet. Captain loses the money facets entirely (they are not greyed out, they are absent). Employee gets a much shorter sheet: status and 'jobs I'm on', nothing else.

STATUS — chips for Active, Starting soon, Archived (job_sites.status). Active is on by default; Archived is off and never on by default. NEEDS ATTENTION — a single toggle, and below it chips for the reason families so an owner can ask a specific question: Variations pending, Defects open, Wet areas unsigned, Programme slipped, Not ready, Unapproved shifts, No contract (owner), Overdue invoice (owner), Over-claimed (owner). WHO — chips per crew (crews.name) and 'Jobs I run' (captain), 'Jobs I'm on' (employee). BUILDER (owner) — a list of builders.name. SORT — Attention first (default) · Name · Starting soonest (site_programme_v.our_start) · Worst margin (owner, job_profit_v.margin_pct) · Most unbilled (owner, job_profit_v.unbilled_cost). The last two mirror the office Overview's sort tabs exactly so the two surfaces answer the same question the same way. A live count at the foot: 'Show 7 jobs'.

**Every tap target**

- Any chip → inline: toggles, count updates immediately
- 'Show 7 jobs' → action: applies and dismisses
- 'Clear all' → inline: resets to the default (Active, attention-first)
- Drag down → action: dismiss without applying

**States** — LOADING: none — every facet is derived from data already on the phone. EMPTY: if a combination matches nothing, the button reads 'No jobs match' and is disabled rather than letting someone apply a filter and land on a blank list wondering what broke. ERROR: not applicable. OFFLINE: fully functional; filters are client-side. Writes only the persisted filter state locally, which should survive a relaunch — an owner who filters to 'needs attention' expects it still filtered tomorrow, but the app must show that state plainly in the list header ('Filtered · 7 of 23') or the empty result of a forgotten filter reads as data loss.

---

## Root tab bar

**inline**

**Reached by** — Present on every root screen and never on a screen opened from one. It is replaced wholesale by the job's own tab bar the moment a job is entered — that swap is the app's main navigational idea and the back arrow out of a job restores this bar.

**Roles** — Three bars, and the difference is the point. OWNER — Jobs · Teams · Calendar · Chat. Jobs is the dashboard-plus-list home. Teams is the booking grid the client asked for (crews down the side, days across the top, each cell a job or 'Available'). Calendar is the programme across all jobs — the future works an owner schedules once a contract is accepted, driven by programmes / programme_tasks and site_programme_v. Chat is the channel list. CAPTAIN — Jobs · Team · Chat. Three tabs. No Calendar: a captain runs their own jobs, and a company-wide programme view is a planning tool for whoever commits the company's time. 'Team' here is not the booking grid — it is today's crew: who is rostered on their jobs, who is clocked on, whose SWMS is unsigned, whose ticket is expiring. Booking is an owner's act. EMPLOYEE — Jobs · Time · Chat. Three tabs. Jobs is the employee home (see below). Time is the existing HoursTab. Photos, which is a tab in today's build, moves inside the job — an employee's photos are always photos of a job, and a company-wide photo gallery is not a thing an employee needs. Chat keeps its unread badge. Common to all three: 56px tall plus env(safe-area-inset-bottom), icon over a 10.5px label, active tab theme.accent with the label at 700, inactive theme.inkFaint at 500. The account avatar and the notification bell live in the screen header, NOT in the tab bar — a fifth tab for settings is a tab spent on something opened twice a year.

Today's build has one bar for everyone — Jobs · Time · Photos · Chat — with 'Jobs' rendering the clock/tracker rather than a list, and 'unread' hard-coded to 0 so the Chat badge never appears. Both are things the redesign fixes: the badge needs a real count (messages in channels the worker is a member of, created_at after their last read), and Jobs needs to be a list.

**Every tap target**

- Jobs → root: the jobs list
- Teams (owner) → root: the booking grid
- Team (captain) → root: today's crew
- Calendar (owner) → root: the programme calendar
- Time (employee) → root: HoursTab
- Chat → root: the channel list, with the unread badge

**States** — Loading: the bar renders immediately and never skeletons — it is the one fixed thing on the screen. Empty/error: not applicable. Offline: fully functional; every tab has a cached read-only state. The bar hides when the software keyboard is up on a search or chat field.

---

## Teams — the booking grid (root tab)

**full screen**

**Reached by** — The Teams tab, owner only. Also from 'See the whole week' on the Teams working sheet and from 'Book a crew' on a Projects starting row.

**Roles** — Owner only. crews and crew_members are company-readable but office-write (schema_v18 wrote the policies as current_is_office() with no captain clause), so a captain can look at a crew but cannot book one — the tab is not offered to them because a read-only booking grid is a tease. Employee: never.

Exactly the client's description: crews down the left (crews.name, crews.colour, the captain's name from crew_v), days across the top (a week at a time on a phone, horizontally scrollable, today's column marked), each cell either a job — job_sites.name, coloured by the crew's colour — or the word 'Available'. Cells come from assignments where crew_id is set and the row overlaps the day; booking a crew still writes one assignments row per crew_member, sharing the crew_id, so the block moves as one thing. Unpublished bookings (assignments.published = false) render at reduced opacity with a 'Draft' marker, and a 'Publish week' action sends them — publishing is what fires the roster_published notification.

**Every tap target**

- An 'Available' cell → half sheet: pick a job to book this crew onto that day
- A booked cell → half sheet: the booking (crew, job, dates, note) with Move, Extend and Remove
- A crew name → half sheet: crew members, with Add and Remove
- A day heading → action: scrolls the week
- 'Publish week' → action: sets assignments.published = true and notifies
- '+ New crew' → half sheet: name, captain, colour

**States** — LOADING: the grid frame draws with grey cells. EMPTY: no crews at all → 'You haven't set up any crews yet. A crew is the unit you actually book — two tilers and a labourer who go to a job together.' with '+ New crew'. Crews but no bookings → the grid renders full of 'Available', which is the correct and readable empty state. ONE CREW: one row; the grid still draws its day headings because the dates are half the information. ERROR: a strip above the grid; the grid stays on screen. OFFLINE: read-only, with every cell's tap disabled and one banner explaining why — a booking written offline and reconciled later can double-book a crew, and the queue is not worth the bug.

---

## Calendar (root tab)

**full screen**

**Reached by** — The Calendar tab, owner only.

**Roles** — Owner only. Built from programmes / programme_tasks / site_programme_v, which schema_v21 made company-readable on purpose ('the programme is not commercial and the crew needs it more than the office does') — so a captain COULD see this, but their version of the question is answered on their own job's Programme tab rather than by a company calendar.

A month or agenda view of when this business is on each job: one band per job from site_programme_v.our_start to our_end, labelled with job_sites.name and site_programme_v.our_task. Bands where start_moved_days is non-zero carry a '+9 days' marker; bands where ready = false carry a warning dot with blocked_by behind it; ready = null renders neutral, because the programme naming no predecessors is 'we don't know', not a green light. Collisions — two jobs wanting the same crew in the same week — are the thing this view exists to make visible, so overlapping bands stack rather than merge. Beneath, the same weeks from the booking grid, so 'when are we on' and 'who is booked' sit on one screen.

**Every tap target**

- A band → half sheet: the job's programme window (revision, received_on, our_task, our_start/our_end, prev_starts_on, blockers) with 'Open the job'
- A day → half sheet: everything on that day across all jobs
- 'Import a programme' → full screen: programme intake (PDF/Excel), which belongs to the job domain but is reachable here because that is where an owner notices it is missing

**States** — LOADING: an empty month grid with a loading strip. EMPTY: no programmes imported at all → 'No builder's programme has been imported yet. Import one on a job and this fills in.' — and it must say that rather than drawing an empty calendar as if the year were free. ERROR: strip above, grid stays. OFFLINE: read-only from cache; import is disabled with a reason.

---

## Chat (root tab)

**full screen**

**Reached by** — The Chat tab, all three roles.

**Roles** — channels and messages are company-readable (schema_v2), so the RLS floor is the whole company. The product line above it: owner sees every site channel; captain sees the channels for their own jobs plus any DM; employee sees the channels for jobs they are rostered on plus DMs. There is one channel per site enforced by a unique index (channels_one_per_site where kind = 'site').

A list of channels. Each row: channels.name (the job name for kind = 'site'), the last message body truncated, the author's initials from crew_v, the time, and an unread count. System messages (messages.kind = 'system', author_id null — a clock-in, an expense, a log) render in theme.inkFaint and italicised so a channel whose only recent traffic is automated does not look like someone spoke. DMs (kind = 'dm') group below site channels. This is also where the client's 'communication' and 'toolbox meeting' requirements surface at root level: an owner posting a toolbox notice ('no vacuum being used', 'cord not tagged') posts it to a site channel or to all of them — the notice itself is a safety_records row with kind = 'toolbox' and ran_by set, and the message is how people find out.

**Every tap target**

- A channel row → full screen: the conversation (that screen belongs to another domain)
- 'New message' → half sheet: pick a person or a job
- Long-press a channel → half sheet: mute, mark read

**States** — LOADING: skeleton rows. EMPTY: no channels → 'No conversations yet. Every job gets a channel of its own once it's created.' ONE ITEM: one row, no grouping headings. ERROR: strip, cached list stays. OFFLINE: the list and the cached messages read fine; the composer is another domain's problem but the badge count must not reset on a failed fetch — showing 0 unread because the fetch failed is a message quietly lost.

---

## Employee home (the jobs list when you have one job)

**full screen**

**Reached by** — The Jobs tab, for workers.role = 'employee'. The client asked for a jobs list first; an employee on a slab has one job, and a one-row list with a dashboard above it is a worse answer than the truth.

**Roles** — Employee only. This is what replaces today's GateScreen / ApproachingScreen / ConfirmingScreen / OnClockScreen sequence as the app's front door for the role that only ever clocks on.

THE RULE: the list is always a list, but when the employee has exactly one job today, that job's row expands in place into a card that carries the clock. Two jobs or more and every row is an ordinary row; the clock lives on whichever job the geofence has them at, and none of them if they are nowhere. The expanded card holds: job_sites.name and address; today's window from assignments.starts_at/ends_at; the state, which is the existing dwell phase from /api/ping — off, approaching (the nearest site and metres away), arriving (the two-minute settle counting down), on the clock (shifts.started_at and elapsed, running); and today's total hours. It carries the two blockers that must stop a person before they start: an unsigned SWMS for this site (safety_documents kind = 'swms' with no safety_signatures row for me today) rendered as a blocker in theme.alertFill, not a suggestion; and an expired or expiring certification (certifications.expires_on) with what it stops them doing. Below the card, the same secondary actions that exist today rather than a six-tile grid: Photos, Receipt, Daily log, Plans, Safety, Schedule, Fix a punch, Time off. No dashboard block. No attention rails. No counters. No money, anywhere, ever — the hard rule from the existing brief holds and RLS backs it: job_profit_v and job_value_v return nothing to this role, workers.rate is off crew_v, contracts_read is office-only. The START TRACKING gate stays exactly where it is: nothing is recorded until it is tapped, and the card says so.

**Every tap target**

- The job card body → full screen: the job (an employee's job tabs are the short set — Today, Photos, Plans, Safety)
- 'START TRACKING' (CTA) → action: begins the location watch and the 20-second ping loop
- 'Clock in manually' → action: sends a ping flagged manual:true — the phone never writes its own shift; RLS and shifts_worker_guard refuse a direct insert, so the server decides, and refuses outside the fence
- 'Stop sharing my location' → action: stops the watch. It does NOT close the shift, and the copy must keep saying so — only the geofence may write ended_at
- 'Sign the SWMS' (blocker) → full screen: SafetyScreen
- Any secondary action → full screen: that panel, with the tab bar hidden, returning here on close
- Avatar → half sheet: Account
- Bell → half sheet: Notifications

**States** — LOADING: the card renders with the job name known from cache and 'Finding you…' where the state goes. EMPTY: no job rostered — see the next entry. ERROR: a location-permission refusal is the important one and is not an error state but a screen of its own (below); a ping failure shows the existing note banner with the server's own explanation, which is the right pattern and should be kept. OFFLINE: the existing OfflineBanner ('Offline — 3 locations waiting to sync') stays and belongs at the very top of this screen; fixes queue in memory and flush on reconnect. Everything else on the card reads from cache. The one root-level write, marking notifications read, must not be lost on a failed update.

---

## Employee with no work rostered

**full screen**

**Reached by** — An employee whose assignments list holds nothing covering today or the next seven days, and who has no open shift.

**Roles** — Employee only. A captain with no jobs sees a different screen (below); an owner with no jobs sees the brand-new-company screen.

Not a blank list. The date and day. 'You're not rostered on anything today.' Then the next thing that IS known, in order of usefulness: the next assignments row in the future, if any ('Next: Lot 42, Prospect — Monday 18 August'); this week's hours so far from HoursTab's own figures against workers.ordinary_hours (38 under the NES, less for a part-timer), because the second question after 'where am I going' is 'how many hours have I got'; and any unread notification. The START TRACKING button is still present and still honest — being unrostered does not mean being not-at-work, and a worker sent to a site by a phone call must be able to clock on. Below it, in smaller type: 'Not right? Ask your office — they roster from the Schedule.'

**Every tap target**

- 'START TRACKING' → action: begins tracking; if the geofence puts them at a site they are not rostered on, the server still opens the shift and the office sees it, which is correct
- 'My hours' → root: the Time tab
- 'Message the office' → full screen: chat with the office channel
- Bell / avatar → half sheets

**States** — This IS an empty state and must not look like a broken one. Loading: skeleton for the 'next' line only. Error: if the assignments fetch failed, the copy must change to 'Couldn't check your roster' with a retry — 'nothing rostered' and 'we couldn't look' are different sentences and conflating them will get someone to stay home. Offline: says 'Offline — this is your roster as of 6:40 am.'

---

## Brand new company, no jobs

**full screen**

**Reached by** — An owner who has just completed Create a company or Finish setup. job_sites returns zero rows. Also the state after every job has been archived.

**Roles** — Owner: the setup path below. Captain with no jobs assigned: 'No jobs are assigned to you yet. Your office names a captain on the job, or on the crew that's booked on it.' Employee: the previous entry.

The dashboard block still renders, with every counter at zero — that is honest and it teaches what the tiles are before they matter. Below it, in place of the list, the client's own process, in their own order, as a checklist that is also the navigation: 1. Quote — a PDF to the builder, or a spreadsheet take-off (estimates, estimate_lines). 2. Signed contract from the builder (contracts: contract_no, contract_sum, gst_inclusive, retention_pct, payment_terms_days, signed_on, starts_on, due_on). 3. Programme supplied by the builder — this is what fills the calendar (programmes, programme_tasks). 4. Tiles supply (products, site_products, materials). 5. Project details uploaded — drawing, scope of works, grout colours, silicone colours, angles colour, mitres, grates, strip drains (site_files with category, plus the job's own detail fields). 6. SWMS uploaded (safety_documents kind = 'swms'). 7. Contractor PO uploaded (purchase_orders). 8. The project is now live — allocate a team (assignments, crews). Each step shows as not-started, and the first one is the only one with a primary button. This is the one place in the app where a numbered wizard is the right shape, because the client described the business as a sequence and a first-run owner has no other way to learn it.

**Every tap target**

- 'Add your first job' (CTA) → full screen: create a job (name, address, map pin, radius_m, job_type, status, builder)
- Any step → full screen: the screen that does it, once a job exists; before that, tapping a later step says 'Add a job first'
- 'Skip — I'll poke around' → action: dismisses the checklist to a single line at the top of the empty list, restorable from the account sheet

**States** — Loading: the checklist is static and renders instantly; only the counters skeleton. Empty: this screen IS the empty state. Error: if job_sites failed rather than returned zero, the screen must say 'Couldn't load your jobs' with a retry — showing a first-run wizard to an owner with 23 jobs because a fetch failed is the worst error this app can make, so the two cases must be distinguished by error !== null, not by rows.length === 0. Offline: a genuinely new account offline can do nothing, and the screen should say that plainly rather than offering buttons that fail.

---

## Notifications

**half sheet**

**Reached by** — The bell in the jobs-list header. Also from the existing NoticeBanner, which today sits on the tracker screen, shows the newest unread notification inline, and marks ALL of them read when tapped — that is wrong and this sheet replaces it.

**Roles** — notifications_read: your own rows (worker_id = current_worker_id()), plus rows addressed to the office (worker_id is null) if current_is_office(). A CAPTAIN IS NOT OFFICE — workers_sync_role() sets is_office = (role = 'owner') — so a captain gets only notices addressed to them personally and never the office-wide ones. That is a real limitation worth naming: a captain currently cannot be notified that a variation on their own job was approved, because notifications.kind is a closed check constraint of ('roster_published','leave_decided','correction_raised','correction_decided','timeoff_requested','shift_flagged') and none of the v17–v21 events — variation approved, defect raised, programme revised, wet area failed — can be represented at all.

A list of notifications, newest first, unread with a theme.accent left rail. Each row: title, body, and the relative time from created_at. Grouped by 'New' and 'Earlier'. Because link_nav holds an office nav name rather than a phone route, the mapping to a phone destination has to be explicit per kind: roster_published → the employee's schedule; leave_decided and timeoff_requested → the time-off screen; correction_raised and correction_decided → the punch-correction screen; shift_flagged → the flagged shift in Time.

**Every tap target**

- A row → action: marks that ONE row read (update read_at), then full screen: its destination
- 'Mark all read' → action: one update over the visible ids
- Drag down → dismiss, nothing marked

**States** — LOADING: three skeleton rows. EMPTY: 'Nothing new.' with, underneath, 'You'll hear about roster changes, leave decisions and punch corrections here.' — which is an honest and short list, and naming it is better than implying the app will tell you about everything. ONE ITEM: one row, no 'New'/'Earlier' headings. ERROR: 'Couldn't load your notices' with retry; do not render an empty list on failure, because 'nothing new' is a claim. OFFLINE: shows cached rows; marking read is the app's only root-level write, so it queues — set read_at optimistically, persist the pending ids locally, and flush on reconnect. If the flush fails the row must come back unread rather than staying silently marked.

---

## Account

**half sheet**

**Reached by** — Tapping the avatar in the header of any root screen. Exists today (AccountSheet) and is reached from the tracker's TrackerHeader.

**Roles** — Same sheet for all three, with the identity line and one extra row differing. The role is shown plainly — 'Owner', 'Crew captain', 'Employee' from workers.role — because a captain who does not know why they cannot see a contract sum will ask, and the answer should be on this sheet.

Top: a 42px circular avatar in theme.rail with workers.initials, then workers.name at 16px/600 and workers.trade at 13px in the faint grey, with the role beneath. Then, in order: 'Sign out' (white CTA treatment, 50px); 'Close' (ghost). Then a hairline, and below it the quieter but legally required pair — 'Delete my account' in theme.alert with a theme.border edge, and a plain underlined link 'What Crewline records about you' → /privacy. The separation is deliberate and should survive the redesign: deletion sits below a rule and away from Sign out, which people tap without reading. Things that should be added here: the notification toggle (see the push permission entry), an 'Offline — 3 locations waiting to sync' line when the queue is non-empty so the queue is inspectable from somewhere permanent, the app version and build number for support calls, and 'Show the setup checklist again' for an owner who dismissed it.

**Every tap target**

- 'Sign out' → action: supabase().auth.signOut() — no confirmation today, which is wrong on a phone; see Sign out confirmation
- 'Close' → dismiss
- 'Delete my account' → full sheet: Delete account, step 'review'
- 'What Crewline records about you' → new tab / in-app browser: /privacy, which main.tsx matches BEFORE the auth gate specifically so it renders with no session — an Apple requirement, and it is deliberately included in the phone build rather than pointed at a website, because a disclosure that needs signal to read is not much of a disclosure

**States** — Loading: none — everything on it comes from the already-loaded workers row. Empty: n/a. Error: only sign-out can fail, and it should fall back to clearing the local session anyway. Offline: everything renders; 'Delete my account' must open and then refuse at the confirm step rather than being hidden, because hiding the deletion path offline is exactly the kind of thing an App Store reviewer on a flaky office wifi will find.

---

## Delete account

**full sheet**

**Reached by** — 'Delete my account' on the Account sheet. Five steps in one sheet — review, confirm, working, done, error — implemented in worker/DeleteAccount.tsx.

**Roles** — Every role can open it. An OWNER is checked against the sole-owner rule before the destructive step is enabled: the sheet queries for another owner, showing 'Checking whether another owner can take over…' while it does. A sole owner is blocked with a full explanation — 'You're the only owner of this company. Deleting your account would leave nobody able to see pay rates, invoices or contracts. Make another crew member the owner from Crew settings first, then come back here.' — and the button is disabled, not hidden. An owner who is NOT sole gets a warning instead: they lose office access the moment it completes. The same rule is enforced again in SQL: delete_worker_account() locks every owner row before counting and raises 'sole_owner', so two owners deleting in the same second cannot both pass.

REVIEW — heading 'Delete your account'; 'This removes your login from Crewline for good. It doesn't erase your work — here's exactly what stays and what goes.' Then two lists, which are the honest split the schema actually implements and must not be softened in the redesign. THIS STAYS: your timesheets and hours worked (the Fair Work Act requires the employer to keep pay records for seven years, and deleting your account cannot shorten that — the workers row is kept with deleted_at set and active = false so every shift, approval and invoice keeps resolving); site photos, defects and other job records you added (evidence about the job, not personal data about you — site_files.uploaded_by is on delete set null and is left untouched). THIS GOES: your login (auth.users is deleted by api/delete-account.ts, and workers.auth_user_id on delete set null severs the link automatically); your location history (positions and dwell_state are hard-deleted — raw GPS pings, personal, and superseded by the shifts they produced); you come off the active crew list. CONFIRM — a typed confirmation, because a single tap is deliberately not enough. WORKING — a blocking state; the scrim tap is disabled so the sheet cannot be dismissed mid-delete. DONE — confirmation, and signing out happens as a side effect of reaching this step, landing on Sign in. ERROR — the failure, with a retry. The two named failures worth designing copy for are 'sole_owner' and 'worker_not_found'.

**Every tap target**

- 'Continue' (review) → inline: the confirm step. Disabled while soleOwner === 'checking' and when blocked
- 'Cancel' → dismiss
- Confirmation field → keyboard
- The destructive button (confirm) → action: POST to api/delete-account, which resolves the caller's own worker id from their bearer token and calls delete_worker_account(), then deletes the login
- 'Back' (confirm) → inline: the review step
- 'Try again' (error) → action: re-POST. Safe to retry: coalesce() on deleted_at keeps the original deletion time rather than sliding it forward

**States** — LOADING: the sole-owner check on open, and the 'working' step. EMPTY: n/a. ERROR: its own step. OFFLINE: this flow must not start. The destructive button on the confirm step is disabled with 'You're offline — deleting your account needs a connection.' A half-completed deletion (our tables updated, the login not) is exactly what the schema's single-statement design and the caller's ordering exist to prevent, and the UI must not create a queue that reintroduces it.

---

## Privacy policy

**full screen**

**Reached by** — 'What Crewline records about you' on the Account sheet, and the URL /privacy directly — main.tsx matches the path before the auth gate, so it renders on its own with no session, on the marketing domain and inside the phone app alike.

**Roles** — No role. No session. That is the requirement: an App Store reviewer opens it in a browser with no account.

src/legal/Privacy.tsx. For this domain the only structural requirements are: it must be reachable with no session; it must be in the phone build rather than a link to a website, so it works on a site with no signal; and it must actually describe what the app does — continuous location while tracking is on, pings roughly every 20 seconds to /api/ping, positions pruned after 3 days by prune_positions(), the seven-year retention on shifts, and the account-deletion split above.

**Every tap target**

- Back / Close → returns to wherever it was opened from (the account sheet, or nothing at all if opened cold)

**States** — Loading: a lazy chunk, so the Booting fallback shows briefly. Empty/error: n/a. Offline: renders from the bundle, which is the whole reason it is bundled.

---

## Location permission

**full sheet**

**Reached by** — The first tap of START TRACKING, before the OS prompt. Also the state after a refusal, reached on every subsequent tap.

**Roles** — Employees and captains hit this constantly. An owner who never clocks on may never see it, and the app must not nag them for a permission their role does not use.

PRE-PROMPT (before the OS dialog): what is about to be asked and why, in the app's own words, because the OS dialog gives one line. 'To clock you on automatically we need your location while you're working. Crewline sends your position every 20 seconds while tracking is on, and only while it's on — it stops the moment you tap stop.' Then what the office sees (your position on the map today, and the clock-ins it produced) and what it does not (anything after you stop, and anything older than three days — positions are pruned). Primary: 'Continue'. Secondary: 'Not now'. AFTER A REFUSAL: 'Crewline can't clock you on without location.' Then the consequence stated plainly — the geofence is server-side, the phone never writes its own shift, so with location off the only way onto the clock is the office entering it by hand. Primary: 'Open Settings'. Secondary: 'Ask my office to enter my hours'. REDUCED ACCURACY (iOS) and BACKGROUND (both platforms) each need their own line: web and foreground-only tracking reports nothing while the screen is off, which the existing code comments already acknowledge ('reliable background tracking needs the native app'), and the worker must be told rather than discovering it on payday.

**Every tap target**

- 'Continue' → action: triggers the OS permission dialog
- 'Not now' → action: dismiss, back to the gate; START TRACKING stays available
- 'Open Settings' → action: deep link to the OS settings page for the app
- 'Ask my office to enter my hours' → full screen: the punch-correction / chat path

**States** — Loading: n/a. Empty: n/a. Error: a permission the OS has permanently denied cannot be re-prompted, and the sheet must say so instead of showing a Continue button that does nothing. Offline: the permission itself is local and works; the explanation renders from the bundle.

---

## Notification permission

**half sheet**

**Reached by** — Not on launch. Offered the first time something would have been worth a notification — after an employee's first shift closes, or when an owner publishes their first roster.

**Roles** — Worth different things to each: an employee gets roster and punch-correction outcomes; a captain gets almost nothing today, since notifications.worker_id is null means office and a captain is not office; an owner gets the office-addressed notices. The prompt copy should name what THIS role would actually receive rather than promising a general stream.

'Want to know when the roster changes?' then the specific list for the role, drawn from the notifications.kind constraint so nothing is promised that cannot be sent. Primary 'Turn on notifications', secondary 'Not now'. A row in the Account sheet mirrors the state afterwards and is the only way back on once refused.

**Every tap target**

- 'Turn on notifications' → action: OS permission prompt
- 'Not now' → action: dismiss; do not ask again this month
- Account sheet toggle → action: OS settings deep link when permanently denied

**States** — Loading: n/a. Empty: n/a. Error: a denied permission shows as an off toggle in the Account sheet with 'Turn these on in Settings'. Offline: irrelevant — the permission is local.

---

## Sign out confirmation

**half sheet**

**Reached by** — 'Sign out' on the Account sheet. Does not exist today — signOut fires on the first tap.

**Roles** — All three, with one difference that matters: if the person has an open shift (shifts.ended_at is null), the sheet must say so.

'Sign out of Crewline?' Then, when there is an open shift: 'You're still on the clock at Lot 42, Prospect. Signing out stops your phone reporting — the shift stays open and the office will see it.' That is the truth: only the server closes a shift, and signing out is not a clock-out. Buttons: 'Sign out' (destructive tone), 'Stay signed in'. When there are queued location fixes, a second line: 'X locations haven't synced yet and will be lost.'

**Every tap target**

- 'Sign out' → action: signOut → Sign in
- 'Stay signed in' → dismiss

**States** — Loading: none. Empty: n/a. Error: a failed signOut still clears locally. Offline: the queued-fixes warning is the point of the screen offline, and the destructive button must still work — a person who wants off a shared phone must be able to get off it.

---

## Offline root

**inline**

**Reached by** — Any root screen while the device reports no connection, or after a fetch fails with a network error.

**Roles** — Same treatment for all three; the consequences differ. An owner's counters go stale silently and that is dangerous; an employee's location queue is the thing that must not be lost.

The existing OfflineBanner is the right component and the right place — flex: 'none' at the very top of the screen, above everything, 9px/20px padding, design.hairline background, a WifiOff icon and 12.5px design.mid text. Three messages, in priority order: 'Offline — 3 locations waiting to sync' when the ping queue is non-empty (the employee case, and the most important because those fixes become someone's pay); 'Offline — showing jobs as of 7:04 am' on the jobs list; 'Offline — some actions are unavailable' on a screen with disabled controls. The banner is never a blocking overlay and never a modal: the whole list, every counter, every cached photo and the entire clock state stay usable behind it. Controls that cannot work offline are disabled in place with a one-line reason, never hidden — a button that vanishes reads as a bug, a button that explains itself reads as a design.

**Every tap target**

- The banner itself → half sheet: what is queued and what is stale, with a 'Try now' action

**States** — This is a state, not a screen, and it composes with every other state on this list. The one hard rule: no root screen may show an empty state while offline without saying it is offline — 'Nothing needs you right now' over a failed fetch is a lie with consequences.

---

## Archived jobs

**full screen**

**Reached by** — Filter sheet → Status → Archived. There is no other way in, deliberately: archived jobs are the long tail and putting them behind one deliberate tap keeps the default list short.

**Roles** — Owner sees all archived jobs with their final money figures still readable from job_profit_v (a finished job's margin is the whole point of having recorded any of this). Captain sees archived jobs they ran, work data only. Employee sees archived jobs they worked on, for the sake of their own hours history.

The same rows, with the money strip reading final rather than live for an owner: job_profit_v.job_value_ex, total_cost, margin, margin_pct, value_per_labour_hour — the number a tiling business actually runs on, directly comparable between jobs and to the charge-out rate. No attention rails: an archived job cannot need attention, and defects left open on one are the office's problem, not a rail on a list. A note at the top: 'Archived jobs. Nothing here is live.'

**Every tap target**

- A row → full screen: the job, read-only, with its tab bar reduced to the tabs that still have content
- 'Unarchive' (owner, long-press) → half sheet: confirm, sets job_sites.status back to 'active'

**States** — Loading: skeletons. Empty: 'Nothing archived yet.' One item: one row. Error: strip. Offline: cached.

---

## Cold open from a notification or deep link

**full screen**

**Reached by** — Tapping a push notification, or opening a link to a specific job, while the app is not running.

**Roles** — All three. The destination has to be checked against the role before it renders, not after: a link to a job a captain does not run must land on the jobs list with a note, not on a job screen that then renders half empty.

The boot gate, then the jobs list, then the destination pushed on top — never the destination alone, because a back gesture from a cold-opened detail screen with no list behind it drops the person out of the app. If the destination cannot be resolved (the job was archived, the variation was withdrawn, the role does not permit it), the app lands on the jobs list with a single dismissible line: 'That job isn't available to you any more.' If the session has expired, it lands on Sign in and holds the destination until after sign-in succeeds.

**Every tap target**

- Back from the destination → the jobs list, correctly populated

**States** — Loading: the destination shows its own skeleton over a real list. Empty: n/a. Error: the 'not available' line, which must distinguish 'gone' from 'we couldn't load it' — the second gets a retry, the first does not. Offline: a cold open offline resolves against cache; a destination not in cache shows 'This needs a connection' rather than an empty detail screen.

---
