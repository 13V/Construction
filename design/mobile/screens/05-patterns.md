# Interaction patterns

Cross-cutting interaction patterns — the half-sheet system, the two tab bars, navigation depth, every shared state (loading / empty / error / offline / permission-denied / role-restricted), location permission, one-handed forms, photo capture and upload, notifications, and the typography, spacing, touch-target and motion foundations. Grounded in apps/dashboard/src/theme.ts, apps/dashboard/src/worker/* and supabase/schema*.sql.

44 screens. Generated from the codebase, not imagined — every figure named here comes from a table or view that exists. Part of the inventory referenced by `design/PROMPT-mobile-v2.md` section 7.

---

## App shell — the root frame

**full screen**

**Reached by** — The app itself. Rendered on launch after useSession() resolves and workers row (me) is found. Everything else renders inside it.

**Roles** — Identical frame for owner / captain / employee; the contents of slot 2 and slot 4 of the tab bar differ (see Root tab bar). The shell reads workers.role once and passes it down — no screen re-derives it. workers.role is 'owner' | 'captain' | 'employee' (schema_v18); workers.is_office is kept in sync by trigger and is what every money RLS policy keys off, so the app must never branch on is_office for display — branch on role.

Vertical stack, top to bottom, fixed 100dvh, max-width 480 centred (the built app already does this so it survives a tablet): (1) System status bar / safe-area inset — env(safe-area-inset-top). (2) STATUS RAIL, 40px, only when tracking is on or a shift is open — see 'Tracking status rail'. (3) OFFLINE STRIP, 34px, only when the outbox is non-empty — see 'Offline strip'. (4) Screen title bar, 52px: title 20/600 ink #1A1D21, left; up to two icon buttons right (44×44 each). (5) Content, flex:1, overflow-y auto, background appBg #F5F6F7, horizontal gutter 20. (6) Tab bar, 56px + env(safe-area-inset-bottom), panel #FFFFFF, 1px top border #DCE0E6. Order matters: the rail and the strip push content down rather than float over it, because a floating strip over a scrolling list is the thing that gets ignored. Sheets and modals render as siblings of the whole stack at z-index 40+, above the tab bar.

**Every tap target**

- Status rail → Tracking status sheet (half sheet)
- Offline strip → Outbox sheet (half sheet)
- Title-bar left icon (avatar, 26px circle, rail #2B2F33, worker.initials) → Me tab, not a sheet
- Title-bar right icon (bell, with red dot when notifications.read_at is null) → Notification centre (full sheet)
- Tab bar items → switch root tab (no animation of content, see Motion)

**States** — Loading: the shell paints immediately with a skeleton in the content slot; the tab bar is live from the first frame so the app never looks dead. Empty: not possible — the shell always has a tab selected. Error: if useSession() has a session but no workers row, the shell is replaced entirely by the 'Not linked to a company' screen. Offline: rail and strip appear; nothing else changes shape, so the content never jumps twice.

---

## Root tab bar

**inline**

**Reached by** — Always visible at the root of the app. Replaced — not covered — the moment a job is entered.

**Roles** — Four slots. Slot 1 and 3 and 4 are identical for all three roles; slot 2 changes label and destination by role. Owner: Jobs · Diary · Messages · Me. Captain: Jobs · Diary · Messages · Me (Diary = the weeks of the crews they captain, read-only allocation). Employee: Jobs · My Time · Messages · Me. The slot is the same idea in all three — 'the time axis' — so muscle memory survives a promotion, which matters because a captain is a promoted employee.

56px tall + safe-area inset. Four equal grid columns. Each: 22px stroked icon (strokeWidth 1.7) over a 10.5/700 label. Active = accent #007BFF icon and label, weight 700. Inactive = inkFaint #8B9096, weight 500. No pill, no background change — the colour is the whole signal (this is what the built TabBar already does). Slot 1 Jobs — folder icon. The app's home. Opens on the job list, per the client. Slot 2 Diary / My Time — calendar icon for owner and captain, clock icon for employee. Slot 3 Messages — chat bubble. Badge: red #D2051E pill, min-width 16, 10/700 white, positioned top 6 / left calc(50% + 6px). Count = messages in channels the worker belongs to created_at after their last read. Slot 4 Me — avatar circle instead of an icon, 22px, rail fill, worker.initials 9/700 white. Badge (amber dot #FFC107) when a certifications row has expires_on within 30 days, or an unsigned safety_documents row exists for a site the worker is assigned to.

**Every tap target**

- Jobs → Jobs list (root)
- Diary / My Time → the booking grid (owner), crew weeks (captain), or hours (employee)
- Messages → channel list
- Me → profile, tickets, tracking, account
- Long-press any tab → nothing. Deliberately: gloves, and a long-press has no discoverable affordance on a work phone.

**States** — Loading: bar renders with all four icons in inkFaint and no badges; badges fade in (opacity only, 180ms) when counts arrive — they never pop from 0 to a number with a scale bounce. Empty: badges absent, never '0'. Error: if the badge count query fails, the badge simply does not render; a tab bar must never carry an error. Offline: unchanged; the Messages badge stops updating and the freshness is carried by the Messages screen, not the bar.

---

## Job tab bar — the bar that replaces the root bar

**inline**

**Reached by** — Tapping any job row in the Jobs list, or a job name anywhere else (a notification, a photo's site chip, a variation's job line).

**Roles** — Five slots. Slots 1, 2, 3, 5 identical for all roles. Slot 4 is the role fork and it is the single most important line in this whole system. Owner: Job · Work · Photos · Money · Chat. Captain: Job · Work · Photos · Crew · Chat. Employee: Job · Work · Photos · Crew · Chat, where Crew shows only themselves and who else is on site now, and Work is read-only apart from raising a defect or an instruction (schema_v19 grants every company member INSERT on defects and site_instructions — that is deliberate, 'requiring a role to report a problem is how problems stop being reported'). Money (owner) reads contracts, job_value_v, job_profit_v, invoices, purchase_orders, estimates. Every one of those is refused to a captain by RLS — a captain's query returns zero rows, not an error — so the tab is ABSENT for a captain, never greyed.

Same 56px geometry and same colour rules as the root bar, so the swap reads as a change of contents, not a change of app. Labels: Job — the overview: job_sites.name, address, job_type, status, builder_contacts (site supervisor name/phone), site_progress_v.pct_complete, and the rows that push to everything the client listed that is not a tab (Scope, Plans, Programme, Scheduling, SWMS, Site instructions, Materials, Variations, Progress, Defects, Waterproofing, Quote, Contract, Contractor PO, Contractor invoice). Work — the doing list: site_instructions, defects, progress_entries, waterproofing, materials, SWMS. Grouped by 'needs you' then 'everything'. Photos — site_files where kind='photo', grouped by day, filtered by category (progress/issue/before/after/inspection). Money (owner) — job_profit_v in one column: contract_sum_ex, approved_variations, job_value_ex, claimed_inc, outstanding_inc, to_claim_inc, retention_held, total_cost, margin, margin_pct, value_per_labour_hour, unbilled_cost, claimed_pct beside progress_pct. Crew (captain/employee) — assignments and crews on this job, who is on the clock (shifts.ended_at is null), live sign on/off, timesheet approval for a captain (shifts_captain_write, and shifts_worker_guard was widened in v18 so a captain can actually set approved_at). Chat — the site channel (channels.kind='site', one per site, unique index). Nineteen client items, five tabs: the argument is that a tab bar is a place you return to, and only five of those nineteen are places. The other fourteen are things you go and do once, so they are rows on Job or Work that push.

**Every tap target**

- Any tab → switches the job's tab; the job header stays
- Job header title → nothing (it is a label, not a control)
- Job header back chevron → leaves the job, restores the root bar
- Job header overflow (⋯) → Job actions menu sheet

**States** — Loading: tabs render instantly with their labels; only the content skeletons. A tab bar that waits for data is a tab bar that feels broken. Empty: a job with nothing in it still has all five tabs; each shows its own first-run empty state. Error: a failed job fetch shows the error inside the content area with the bar intact, so the person can still reach Chat and ask someone. Offline: all five tabs remain tappable; Money shows cached job_profit_v with a 'Figures from 9 Aug, 4:12pm' line, because a margin from an hour ago is useful and a blank screen is not.

---

## The context switch — entering and leaving a job

**inline**

**Reached by** — Tapping a job row (enter). Back chevron, or the OS back gesture / Android back button (leave).

**Roles** — Same for all three. What is behind the swap differs, the swap itself never does.

Entering, over 320ms total: (1) The job row the person tapped expands its background to accentFill #E7F1FF for 90ms — the acknowledgement, so a slow network does not read as a dead tap. (2) The job screen pushes from the right, standard 280ms, easing cubic-bezier(.32,.72,0,1). (3) The tab bar CROSS-FADES its four items out and five items in over 200ms, starting 80ms into the push, with a 3px accent underline sweeping left-to-right across the full bar width in 260ms. The bar itself never moves or resizes — only its contents change. This is the whole tell: the furniture stayed, the labels changed. (4) A JOB HEADER appears above the content, 46px, rail #2B2F33 background, white text: back chevron (44×44) + job_sites.name at 15/600 + a status dot (success #28A745 if anyone on this job has an open shift, inkFaint if not) + overflow ⋯. The dark rail is the second tell: the root of the app is light, inside a job there is a dark band across the top. You can tell which context you are in from across a room, in sun, without reading. Leaving: exact reverse, 260ms, and the Jobs list restores its scroll position and re-highlights the row you came from for 400ms then fades it. Rule: you can only be inside one job. Entering job B from inside job A (via a search result, say) replaces rather than stacks — the back chevron always returns to the Jobs list, never to another job.

**Every tap target**

- Back chevron → Jobs list, root tab bar restored
- Job name in the header → nothing
- Status dot → Crew tab (who is on site)
- ⋯ → Job actions menu sheet: Call site supervisor (builder_contacts.phone), Directions (job_sites.lat/lng), Copy job ref (job_sites.builder_job_ref), Archive job (owner only)

**States** — Loading: the job screen pushes immediately with skeletons; the header shows job_sites.name straight away because the list row already had it — never a spinner where a known name could be. Empty: n/a. Error: if the job fails to load, the dark header still shows the name and the content carries the error with a Retry; the back chevron always works. Offline: entering a job the person has opened before works from cache; entering one they never have shows 'Not downloaded — this job needs a connection the first time' with a Retry, and the header still names it.

---

## Navigation depth map and back behaviour

**inline**

**Reached by** — Specification — governs every screen in the app.

**Roles** — Same for all three roles. A captain's tree is shallower because Money does not exist for them, not because it is pruned.

Exactly three levels of push, and no more: L0 root tab (Jobs / Diary / Messages / Me) L1 a job (job tab bar) — or a root-level list like the Messages channel list L2 a pushed screen inside a job (Plans viewer, Photos viewer, the SWMS reader, the Variation form, the Programme, Booking grid detail) L3 exists only for one case: a viewer inside a viewer — a photo opened from a plan pin. Nothing else may reach L3. SHEETS DO NOT COUNT AS DEPTH. A half sheet is a lens on the screen behind it; it can open from L0, L1 or L2 and never adds a level. This is the reason the client's ask is the right one: it keeps a 19-thing job at three levels. Back contract: - Every pushed screen has a back chevron top-left at 44×44 and honours the OS back gesture / Android hardware back. - Back never loses typed input silently: a push with a dirty form intercepts back and shows the 'Discard?' confirmation modal. - Back from L1 (a job) returns to Jobs with scroll restored. - Back at L0 on Android exits the app; on the Jobs tab only. From any other root tab, Android back returns to Jobs first (one press), then exits (second press). - The tab bar is never hidden by a push at L2. It IS hidden by a full-screen viewer (photo, plan) and by the camera — those are modal presentations, dismissed by an X, not a chevron. No screen in this app is more than 3 taps from the job list, and nothing is more than 2 taps from the clock.

**Every tap target**

- Back chevron (44×44, accent #007BFF, top-left) → previous screen
- OS back gesture / Android back → same
- X (44×44, top-right, white on dark for viewers) → dismiss a modal presentation
- Tab bar item → resets that tab's stack to its root if already selected (second tap on an active tab = 'go home in this tab', and it also scrolls the list to top)

**States** — Loading: a push starts before its data arrives, always. Empty/Error: a pushed screen that fails still has a working back. Offline: unchanged — navigation is never gated on the network.

---

## THE HALF SHEET — the standard detail sheet

**half sheet**

**Reached by** — Tapping any single record in a list where the intent is to LOOK: a photo's meta, a defect row, a variation row, a shift row, a wet area, an instruction, a person, a crew, a programme task, a material line, a notification.

**Roles** — Same mechanics for all three. The sheet's contents are role-filtered before it opens; a sheet never renders a locked row. A captain opening a defect sees every column except cost_estimate. A captain opening a variation sees co_no, description, detail, status, raised_on, approved_on, days_impact and photos — and NOT cost_impact. (Honest note: change_orders_read in schema_v18 lets a captain SELECT cost_impact; only the app hides it. That is the one money boundary in this design not enforced by RLS, and it should be — either a captain-safe view or a column-level grant.)

GEOMETRY — this is the app's signature, so it is specified to the pixel. - Two detents: MEDIUM = 52% of the visual viewport height (on a 390×844 iPhone: 439px), LARGE = 92% (top edge 8px below the safe-area inset). Medium is the default and 'about half the screen' as asked. No small detent — a peek sheet cannot hold a sentence at 13.5px. - Corner radius 14px top only (matches the existing AccountSheet). Background panel #FFFFFF. Shadow 0 -8px 26px rgba(26,29,33,.18). - GRABBER: 36×5px, radius 2.5, colour border #DCE0E6, centred, 8px below the sheet's top edge, with a 44px-tall invisible drag region around it. It is the only ornament on the sheet. - SCRIM: rgba(26,29,33,.45) — the exact value the built AccountSheet uses — fading in over 240ms. It covers the whole app INCLUDING the tab bar. The tab bar being dimmed and unreachable is what makes a sheet feel like a lens rather than a page. - BEHIND: the parent screen stays rendered at full size and full colour under the scrim, does not scale, does not translate, and is inert (no scroll, no taps except the scrim's dismiss). No iOS card-stack shrink: it costs a full-screen repaint on the cheap Androids this crew carries, and the point of the sheet is that the context behind stays legible. - DRAGGABLE: yes. Drag up snaps to LARGE past 40% of the travel or above 500px/s velocity. Drag down from MEDIUM dismisses past 25% of the sheet height or above 500px/s. Drag down from LARGE snaps to MEDIUM first. Rubber-band above LARGE at 0.3 resistance. - The sheet's own content scrolls; at MEDIUM, scrolling the content to its top and continuing to pull promotes the sheet to LARGE rather than dismissing (scroll-then-drag chaining), which is what stops a person losing a sheet while reading. COMPOSITION - 14px content inset top (below grabber), 20px horizontal gutter, bottom inset 20px + env(safe-area-inset-bottom). - Header row: title 17/600 ink, and a status Chip right (11/700, the severity/status palette). No close button — the grabber, the scrim and the swipe are three dismissals and a fourth is clutter. Exception: a sheet that has become a form (see Form pattern) grows a 'Cancel' at 44px. - Body: label/value rows. Label 12/700/.06em uppercase inkFaint #8B9096, value 14.5/600 ink. Never a table. - Footer: at most ONE full-width primary action, 52px, the CTA treatment linear-gradient(180deg,#FFCD11,#F7B244) with 1px #E0A032. Plus at most one 44px ghost text button under it. If a sheet needs three actions it is not a sheet. DISMISSAL: swipe down, tap the scrim, Android back, or completing the primary action. Never a timeout.

**Every tap target**

- Grabber / anywhere on the sheet chrome → drag between detents
- Scrim → dismiss
- Primary CTA → performs the action and dismisses, leaving a toast on the parent
- Ghost secondary → usually 'Open full record', which DISMISSES the sheet and pushes the full screen — the sheet never becomes the screen in place
- A row inside the sheet → replaces the sheet's content in place with a back chevron in the sheet header (see Sheet drill), or dismisses and pushes. Never opens a second sheet.

**States** — Loading: a sheet opens instantly with everything the list row already knew (name, status, date) and skeletons only for the fields that need a fetch — a photo's uploader, a defect's fixed_photo_path. Never a sheet that is entirely a spinner. Empty: n/a, a sheet is always about one record. Error: the fetched detail fails → the known fields stay, and a single 13.5px alertInk #A00417 line replaces the skeleton block: 'Could not load the rest of this. Pull down and try again.' The sheet does not close itself on an error. Offline: a read-only sheet works from cache with a 12.5px inkFaint line 'Saved 20 min ago'; an action CTA stays enabled and queues (see Outbox).

---

## THE FULL SHEET — the large detent as a presentation in its own right

**full sheet**

**Reached by** — Opened directly at 92% for the four things that are sheets by nature but never fit at half: the Notification centre, the Outbox, a Chat thread opened from a notification, and any half sheet the person has dragged up.

**Roles** — Same for all three.

Identical chrome to the half sheet — same 14px radius, same grabber, same scrim — presented at the LARGE detent (92%, top edge 8px under the safe area) with one detent only, so dragging down dismisses rather than snapping to medium. The 8% of parent still visible at the top is deliberate and load-bearing: it is the only thing distinguishing a full sheet from a push, and it is what tells a person that the back-out is 'down', not 'left'. Content may have a sticky header inside the sheet (title 17/600 + a right-hand action) that appears on scroll past 12px, with a 1px #DCE0E6 hairline. Use it for: a long list that is still a lens on the current context. Do NOT use it for a destination — a destination is a push.

**Every tap target**

- Grabber / drag down → dismiss
- Scrim (the 8% strip and the sides) → dismiss
- Sticky header action (e.g. 'Mark all read') → acts in place
- Rows inside → push a screen (which slides in over the sheet, full-screen, with its own back chevron) or dismiss-and-push

**States** — Loading: sticky header + 6 skeleton rows. Empty: the sheet's own empty state, full-height and centred (see Empty patterns). Error: full-height error block with Retry. Offline: as the half sheet.

---

## Sheet-versus-push — the rule, written so nobody has to ask

**inline**

**Reached by** — Specification. Apply it to every new screen.

**Roles** — Role-independent.

A SHEET IS FOR LOOKING AND FOR ONE DECISION. A PUSH IS FOR DOING. Use a HALF SHEET when all four are true: 1. It is about exactly one record. 2. The context behind it is worth keeping visible — the list you came from, the plan you tapped, the photo grid. 3. Its content fits in two thumb-scrolls at the medium detent (roughly 12 label/value rows, or 5 rows plus one image). 4. It has no sub-navigation: no tabs, no segmented control, no second list you would filter. Use a PUSH (full screen, L2) when ANY of these is true: - It has its own tabs or segments (the Programme, the Booking grid, Profitability). - It is a form with more than five fields, or any field that opens the camera, a canvas, a date picker with a range, or a document scanner. - It is a list you will search, filter or sort. - It is a document to read end-to-end: a SWMS body, a contract, a scope of works, a plan sheet. - Losing it to an accidental downward swipe would lose work. WORKED EXAMPLES, from this app: Defect row → half sheet (look, then 'Mark fixed' with a photo → that CTA dismisses and pushes the camera). Raise a defect → PUSH. Five fields plus a photo. Variation row, owner → half sheet showing description, cost_impact, days_impact, status, and APPROVE / DECLINE. One decision, so it stays a sheet. Variation row, captain → half sheet, no money, no decision buttons, single 'Open photos' ghost. Write a variation → PUSH. It has lines (change_order_lines), photos, and a reason. A shift row → half sheet with started_at/ended_at/source/cost_code and the geofence evidence. 'Not right? Fix this' dismisses and PUSHES the correction form. A wet area → half sheet (area, product_name, batch_no, coats, flood_tested, status). 'Sign off' → PUSH, because it is a signature and a certificate. A person on site → half sheet. Their trade, their shift today, a call button. Plans → PUSH always. Pinch-zoom inside a sheet is a fight. A plan pin → half sheet over the drawing. This is the pattern at its best: the pin's label, who dropped it, when, the linked photo — with the drawing still visible behind. HARD LIMITS: one sheet on screen at a time; a sheet never opens a sheet; a sheet never contains a tab bar; a sheet never contains a map or a camera preview.

**Every tap target**

- Nothing — this is a decision rule, not a screen.

**States** — n/a

---

## In-sheet drill — replacing sheet content in place

**half sheet**

**Reached by** — Tapping a row inside an open half or full sheet that leads to a second, smaller record — e.g. tapping the 'Raised by' person inside a defect sheet, or a photo thumbnail inside an instruction sheet.

**Roles** — Same for all three.

The sheet keeps its frame, its detent and its scrim. The content cross-fades and slides 24px left over 200ms, and the sheet header gains a back chevron (44×44, accent) to the left of the title. The grabber stays. The sheet height does NOT change on drill — if the child needs more room, the sheet animates to LARGE as part of the same 200ms. Maximum one drill deep. A second drill is a push: dismiss the sheet and go. This exists so a sheet never spawns a second sheet, which on a 390px screen reads as the app losing its place.

**Every tap target**

- Back chevron in the sheet header → returns to the parent content, cross-fade right
- Scrim / drag down → dismisses the whole sheet, not just the drill (a person swiping down means 'get out', not 'go back one')

**States** — Loading: the child content shows skeleton rows in place; the header title changes immediately. Error: 'Could not open this' with the back chevron still live. Offline: works from cache or shows the error; the parent content is never lost.

---

## Confirmation modal — the destructive stop

**modal**

**Reached by** — Any action that cannot be undone from the phone: stop tracking, decline a variation, discard a dirty form, delete a queued outbox item, sign off a waterproofing area, delete your account.

**Roles** — Same for all three. The copy differs because the consequence differs, and each one names the actual consequence in the actual system.

Centred card, 300px wide, radius 8, panel #FFFFFF, scrim rgba(26,29,33,.45). NOT a sheet — a modal centres because it must interrupt, and a sheet is dismissible by a swipe, which is exactly what a destructive confirmation must not be. Title 17/600 ink. Body 13.5/1.45 inkMid #4A5057, which states what actually happens, in the system's own terms: - Stop tracking: 'This stops sending your location. It does NOT clock you out — only the site boundary can do that. If you are still inside the fence your shift stays open.' (This is literally true: RLS and shifts_worker_guard refuse a client-written clock-out.) - Decline a variation: 'VO-4 goes to rejected. It stops counting towards the contract sum, and the builder is not told by this app.' - Discard: 'You have typed a description and attached 2 photos. Nothing has been sent.' - Sign off a wet area: 'Signing stamps your name and the time from the server — waterproofing.signed_off_by and signed_off_at — and it cannot be back-dated. Only sign what you saw.' Buttons stacked, full width, 48px: destructive first in alert #D2051E text on white with a 1px #D2051E border (the ctaRed treatment already in the codebase), 'Cancel' below as a 44px ghost. Stacked and not side-by-side because a thumb reaching across a 390px screen hits the wrong one.

**Every tap target**

- Destructive button → performs it and dismisses
- Cancel → dismisses, no change
- Scrim → dismisses as Cancel
- Android back → dismisses as Cancel

**States** — Loading: while the action runs, the destructive button shows its verb in past-progressive ('Stopping…') and both buttons disable; the scrim stops dismissing. Error: the modal stays open and grows a 13/1.45 alertInk line under the buttons with the server's own message. Offline: for anything queueable the modal completes optimistically and says so in the toast; for anything not queueable (account deletion, which needs /api/delete-account) the confirm button is disabled with 'You need a connection to do this.'

---

## Action menu sheet — the overflow

**half sheet**

**Reached by** — The ⋯ button in a job header, or a long list row's trailing ⋯ where a swipe action would be undiscoverable.

**Roles** — The menu is built from what the role can actually do. An owner's job menu has Archive job and Open profitability; a captain's has neither, and the menu is shorter rather than greyed.

A half sheet that sizes to its content rather than to a detent — it is the one exception, and it never exceeds 52%. Rows 52px, 15/500 ink, left-aligned with a 22px leading icon, 1px #EDEFF1 dividers. Destructive rows in alert #D2051E, always last, separated by an 8px appBg gap. Job menu (owner): Call site supervisor · Directions · Copy job ref · Open profitability · Book a crew · Archive job. Job menu (captain): Call site supervisor · Directions · Copy job ref · Book my crew here (writes assignments with crew_id — refused by RLS today, assignments are office-write; so this row is ABSENT until that policy changes, and this inventory says so rather than drawing a button that 403s). Row list, employee: Call site supervisor · Directions. No icons-only grid, no two columns. A menu is a list.

**Every tap target**

- Any row → performs the action and dismisses
- Scrim / drag → dismiss

**States** — Loading: never — the menu is built from already-loaded role and job data. Empty: if a role has no actions the ⋯ button is not rendered at all. Error: an action that fails dismisses the menu and shows an error toast on the parent, with 'Try again' in the toast. Offline: rows that need the network (Directions, Call) still work — they hand off to the OS; rows that write show the queued toast.

---

## Loading — the skeleton (the default)

**inline**

**Reached by** — Every list and every screen whose content comes from a query.

**Roles** — Same for all three. The number of skeleton rows matches what that role will actually get where it is knowable (an employee's job list skeletons 1–2 rows, an owner's skeletons 6).

SKELETON, NOT SPINNER, wherever the shape of the result is known — which is every list, every card and every sheet in this app. The decision: a spinner says 'wait'; a skeleton says 'here is the shape of what is coming', and on a 3G site the skeleton is the difference between a person waiting and a person tapping again. Skeleton geometry: blocks of fill #F1F3F5, radius 3 for text lines and 8 for cards. Text-line heights 13 (body) and 17 (title), widths staggered 100% / 70% / 45% so it does not read as a grid. Row height matches the real row exactly — the content must not jump when it lands. Shimmer: a 1.4s linear-gradient sweep at 12% white, left to right, on the whole skeleton group as one element (not per block — twelve independently shimmering blocks looks like a fault). Suppressed entirely under prefers-reduced-motion, leaving static #F1F3F5 blocks. SKELETON COUNTS: job list 4 rows; photo grid 9 tiles; sheet 4 label/value rows; hours list 5 day rows; chat 3 bubbles. USE A SPINNER only for: (a) an action in flight inside a button (an 18px ring, 2px, border #DCE0E6 with border-top accent, cl-spin .9s linear — already in the codebase), (b) a full-screen viewer decoding a large image or a plan sheet, where there is no shape to promise, and (c) the settle-window ring on the arrival screen, which is a real countdown and not a loader. NEVER: a full-screen blocking spinner over the whole app. NEVER: a skeleton that runs longer than 8 seconds — at 8s it is replaced by the slow-network state: 'Still trying. Your connection is poor.' with a Retry, keeping the skeleton beneath it.

**Every tap target**

- Nothing is tappable in a skeleton. Skeleton rows must not accept taps — a tapped skeleton that later resolves into a different row is how the wrong defect gets marked fixed.

**States** — This IS the loading state. It has one variant of its own: after 8 seconds it gains the slow-network banner described above.

---

## Empty — nothing yet (first run)

**inline**

**Reached by** — Any list whose query succeeded and returned zero rows, and where no filter is applied.

**Roles** — Copy differs by role because what the reader can do about it differs, and an empty state whose call to action the reader cannot perform is worse than no empty state.

Centred block, max-width 300, 40px vertical padding. Three parts, always in this order: (1) A 13.5/1.5 inkSoft #696D74 sentence saying WHAT THIS IS FOR — never 'No defects'. (2) A 12.5 inkFaint line saying who creates one and when. (3) The action, if the reader has it: a 44px ghost button, or the full-width CTA if it is the screen's only purpose. No illustration. No dashed box on the phone — the dashed Empty in ui/kit.tsx is a desktop panel treatment and reads as a broken image at 390px. WORKED COPY, grounded: - Defects, owner/captain: 'A defect is anything the builder, the certifier or you say has to be fixed before the retention is released. Raise one the moment you see it — with a photo, and who you think owns it.' + [RAISE A DEFECT]. - Defects, employee: same first sentence, then 'Anyone on site can raise one; the office or the captain closes it.' + [RAISE A DEFECT] (schema_v19 gives every company member insert). - Waterproofing: 'A wet area gets covered by screed and tiles within a day. What is recorded here — the batch, the coats, the flood test, the photos — is the only evidence it was done right. Add every wet area on this job before you start membrane.' + [ADD A WET AREA]. - Variations, captain: 'Nothing extra has been raised on this job. When the builder asks you for work that is not in the scope, log a site instruction the same day — that is what turns into a variation.' + [LOG AN INSTRUCTION]. - Photos: 'No photos on this job yet. Photos taken here are dated and geotagged, and the office sees them straight away.' + [TAKE PHOTO]. - Hours, employee: 'Nothing recorded this week yet. Hours appear here on their own as you arrive and leave.' (already the built copy; keep it verbatim — it is the model for all of these). - Messages: 'This job has a channel and nobody has used it. Anything said here is on the record against the job.' - Notifications: 'Nothing new. You will hear about a roster going out, a punch correction being decided, and a shift the office has flagged.' (Those are literally the notifications.kind values.)

**Every tap target**

- The action button, where present → opens the capture form (push) or camera
- Nothing else. An empty state must not be tappable as a whole.

**States** — This IS an empty state. Two neighbours it must never be confused with: the filtered-empty state (different copy, different action) and the permission-empty state (a captain querying contracts gets zero rows from RLS — that must render the role-restricted state, never this one. Rule: before rendering 'nothing yet', check whether the role could ever have seen a row here; if not, render Role-restricted).

---

## Empty — nothing matches your filter

**inline**

**Reached by** — Any list with an active filter chip, search term or date range whose result set is zero but whose unfiltered set is not.

**Roles** — Same for all three.

Visually distinct from first-run empty, deliberately: this one is a SHORT line plus an escape hatch, because the reader already knows what the list is for. Layout: 28px vertical padding, left-aligned at the list gutter (not centred — centring reads as 'the whole screen is empty', which is the wrong message). Copy: 15/600 ink 'Nothing matches that filter', then 12.5 inkFaint naming the filter in the reader's words: 'Issues · this week · Lot 42'. Then a 44px ghost 'Clear filter' in accent. If a search term produced it: 'No photos captioned “grout”.' with 'Clear search'. The filter chips stay visible and stay tappable above it, always. The single worst version of this state is one that hides the controls that caused it. The existing PhotosTab already draws this distinction (files.length === 0 ? 'No photos on this job yet' : 'Nothing matches that filter') — this formalises it everywhere.

**Every tap target**

- Clear filter → resets chips to All and re-runs
- Clear search → clears the field, keeps chips
- The filter chips above → change the filter directly

**States** — n/a — this is itself a state. It never has a loading variant: filters are applied client-side over an already-loaded set wherever possible, so switching a chip is instant.

---

## A list with exactly one item

**inline**

**Reached by** — Any list where count === 1. Most common for an employee, whose Jobs list is usually one job.

**Roles** — Chiefly an employee concern; the brief is explicit that for an employee the job list 'should feel like one job rather than a list of one'.

Rule: at count === 1, a list does not become a card, does not auto-enter, and does not change layout — with one exception, the employee Jobs list. The exception: when an employee has exactly one job today, the Jobs tab renders that job's row expanded to a 168px card carrying what they need without entering — job_sites.name, address, today's assignment window (assignments.starts_at–ends_at), the site supervisor's name, whether their SWMS is signed (safety_signatures for the site's active safety_documents), and a full-width [OPEN JOB] CTA. It is still a list — a second job appearing tomorrow collapses it back to rows with no ceremony and no migration. Everywhere else at count 1: the single row renders exactly as it would among twenty, keeping any section header ('Today · 1 photo' — the singular is computed, never '1 photos'). Every count string in the app pluralises: the built code does this ('photo'/'photos', 'location'/'locations') and it is a rule, not a nicety, because '1 photos' is the detail that makes a person distrust the numbers above it.

**Every tap target**

- The row / card → enters the job
- [OPEN JOB] → same

**States** — Loading: one skeleton row, not four — guessing high makes the screen collapse when data lands. Empty: falls through to 'nothing yet'. Offline/Error: as the parent list.

---

## Error — screen level

**inline**

**Reached by** — A query that fails: no network at first load, a 500, an expired token mid-session, an RLS refusal that is genuinely an error rather than a role boundary.

**Roles** — Same for all three. The one role-sensitive part: never say 'you do not have permission' for something a role legitimately cannot see — that is Role-restricted, and it is not an error.

Replaces the content area only. The title bar, tab bar and job header all stay live, so a person is never trapped. Block, centred, max-width 300: (1) 15/600 ink, plain and specific: 'Could not load this job's defects.' (2) 13.5/1.45 inkSoft, the cause in the reader's terms: 'Your phone is not on the network right now.' / 'The server did not answer.' / 'Your sign-in has expired.' (3) A 48px ghost [TRY AGAIN] — full-width at the gutter, not a small link. (4) For an expired session only: a second CTA [SIGN IN AGAIN]. (5) A 12 inkFaint line with the technical detail, collapsed behind a 'Details' disclosure: the actual message the built code already surfaces (`Server returned 500`, a Postgres message). Field staff never read it; the person on the phone to support does. Colour: the error block is NOT red. Red — alert #D2051E on alertFill #FDECEE — is reserved for severity in the domain (a critical defect, an overdue invoice, a failed flood test). A network failure painted the same red as a critical defect is how people learn to ignore red. Inline field errors and rejected writes are a different pattern (see next).

**Every tap target**

- TRY AGAIN → re-runs the query, showing the skeleton again
- SIGN IN AGAIN → signs out and shows AuthScreen
- Details → expands the technical line in place
- Tab bar / back → always live

**States** — This is the error state. Its loading variant is the skeleton returning on retry. If a retry fails three times consecutively, the block adds 'This has failed three times. Your office can check whether the site is down.' and a ghost 'Message the office' that opens the site channel.

---

## Error — inline, and the rejected write

**inline**

**Reached by** — A form field that fails validation, or a save the server refused (a Postgres check constraint, a trigger like shifts_worker_guard's 'A worker can set the cost code and break on their own open shift, nothing else', a unique violation on change_orders.co_no or waterproofing (site_id, area)).

**Roles** — Same for all three, but the messages differ because the triggers differ by role — a captain's shift edit succeeds where an employee's raises P0001.

FIELD LEVEL: the field's border turns alert #D2051E, and a 12.5/1.4 alertInk #A00417 line appears under it, 6px gap. The field keeps its value — never cleared. The message says what to do, not what is wrong: 'Pick a job site first.' (the built copy), 'A wet area with this name already exists on this job — open it instead of adding a second.' FORM LEVEL: a Banner in alertFill #FDECEE / 1px #F3C4CB / alertInk text, above the CTA and inside the scroll, so it is next to the thing it is about. The CTA stays ENABLED — a disabled CTA with no explanation is the most common cause of a person giving up. REJECTED WRITE, the important case: the write already looked successful because the app is optimistic. So the row that was added stays in place, turns to a 1px alert left border with an alertFill tint, and gains a 12.5 line: 'Not saved — [server's own message]' plus two 44px inline buttons, [Retry] and [Discard]. It is never removed silently. This matters most for anything queued offline that the server refuses when it drains — see Write conflict. THE SERVER'S OWN WORDS: where the database raises a message written for a human (schema_v19's waterproofing rules, schema_v23's sole-owner refusal, the shifts guard), show it verbatim. Those messages were written carefully and paraphrasing them loses the reason.

**Every tap target**

- Retry → re-sends that one write
- Discard → removes the row, after the Discard confirmation modal if it contains typed content
- The field → focuses it and clears its error border on the first keystroke

**States** — n/a

---

## Offline strip and the queued-writes contract

**inline**

**Reached by** — Appears automatically, directly beneath the status rail, whenever navigator.onLine is false OR the outbox is non-empty.

**Roles** — Same for all three. The counts differ only by what each role can write.

34px strip, full bleed, background borderSoft #EDEFF1, 1px bottom border #DCE0E6, a 15px struck-through wifi glyph (the built WifiOffIcon, with the strike in alert), and 12.5/500 inkMid text. It pushes content down; it never floats. COPY — it says what is waiting, in the reader's nouns, never 'sync': - 'Offline — 3 locations waiting to send' (this one is already built and real: the pending ref in Tracker, pings at PING_INTERVAL_MS = 20s). - 'Offline — 2 photos and 1 defect waiting to send' - 'Sending 2 photos…' when back online and draining, with a 2px accent progress line along the strip's bottom edge. - 'All sent' for 2 seconds, in successFill #EAF7EC with successInk #1B7A2C, then the strip removes itself. WHAT QUEUES, and this is the whole promise: queues — location pings (built), photos (site_files insert + storage upload), defects, site_instructions, progress_entries, daily_logs, messages, waterproofing photos, SWMS signatures, plan_pins, photo captions and categories. does NOT queue — anything whose result the person must trust before acting: a manual clock-in (the server alone decides, so it is refused with 'You need a connection to clock in manually — you will be clocked in automatically when you arrive anyway'), approving a variation, signing off a wet area (a certificate must not be stamped from a queue), approving timesheets, deleting an account. That split is the honest one: the server owns the clock and owns any record someone can be prosecuted over. EVERY QUEUED ITEM IS VISIBLE AND EDITABLE until it sends. Nothing disappears into a background.

**Every tap target**

- The strip anywhere → Outbox (half sheet)

**States** — Not applicable — the strip IS a state. It has no loading or empty state; when there is nothing queued and the network is up, it does not exist.

---

## Outbox — what is waiting to send

**half sheet**

**Reached by** — Tapping the offline strip. Also reachable from Me → 'Waiting to send' when the strip is not showing but items remain (a photo that has failed repeatedly).

**Roles** — Same for all three; contents are the person's own queued writes only.

Half sheet at the medium detent, promotable. Header: 'Waiting to send' 17/600, and a right-hand chip with the count. Grouped rows, 60px each: - Photos: 44px thumbnail from the local blob, the job name, the category, the time taken, and a per-item state — 'Waiting' (inkFaint), 'Sending 62%' (accent, with a 2px progress line under the row), 'Failed twice' (alertInk). - Records: a 22px icon, the record type and its first line ('Defect — Ensuite, chipped edge tile to shower hob'), the job, and its state. - Locations: a single collapsed row, 'Location reports · 14 waiting', not fourteen rows. They are machine data and a person cannot act on one. Footer: one full-width 52px ghost [SEND ALL NOW] when online; when offline, a 12.5 inkFaint line 'These send on their own when you have signal. You can close the app.' — which must be TRUE, so this is also a requirement on the build: the native shell keeps the queue and drains on connectivity, not on the app being open. Retention: queued items survive a force-quit and a phone restart. A queued item older than 7 days surfaces a warning row.

**Every tap target**

- A row → half-sheet drill in place showing the full record and its error, with [Retry] and [Delete]
- SEND ALL NOW → drains, with per-row progress
- Delete on a row → Discard confirmation modal naming what is lost
- Location reports row → drills to a plain explanation of what a location report is and how long they are kept (positions are pruned to 3 days by prune_positions(), schema_v22) — no map, no list of coordinates

**States** — Loading: never — the outbox is local. Empty: 'Nothing waiting. Everything you have taken or written today has reached the office.' with the last-sent time. Error: a per-row error, never a sheet-level one. Offline: this is its home state; SEND ALL NOW is replaced by the explanatory line.

---

## Write conflict — the server refused it after the fact

**half sheet**

**Reached by** — A queued write that drains and is rejected: a unique violation (change_orders.co_no, waterproofing (site_id, area)), a check constraint, an RLS refusal because the person's role or the job's captain_id changed while they were offline, or a record someone else has since changed.

**Roles** — Most likely for a captain whose captains_site() scope changed (a crew was pulled off the job, so assignments.crew_id no longer links them) and for an employee whose assignment ended.

Presented once, on next foreground, as a half sheet — not a toast, because work is at stake. Header: 'One thing could not be saved' (or 'N things'). Body per item: what it was (thumbnail or first line), when it was captured, and the reason in plain words derived from the failure: - unique violation → 'A wet area called Ensuite already exists on Lot 42. Someone added it while you were offline.' - RLS refusal → 'You are no longer on Lot 42, so this could not be added to it.' - constraint → the database's own message, verbatim. Actions per item, 44px each: [Merge into the existing one] where that is meaningful (photos, progress entries), [Save to a different job] (a site picker), [Keep a copy on my phone], [Delete]. Nothing is ever deleted for the person. A failed write that cannot be resolved stays in the Outbox with a 'Needs you' badge and the Me tab carries a dot until it is dealt with.

**Every tap target**

- Each action button → resolves that item and removes its block
- Item thumbnail → full-screen viewer
- Scrim → dismisses; the sheet returns on next launch until the outbox is clean

**States** — Loading: resolving an item shows the button's spinner. Error: a resolution that also fails shows inline and keeps the item. Offline: the sheet still opens (all local) but resolution actions that need the server queue again and say so.

---

## Role-restricted — a captain reaches money

**full screen**

**Reached by** — Only ever by a route the app did not draw: a push or in-app notification deep link, a link pasted in Chat, a job opened from a search result whose row carried a money field, or a screen reached after the office changed someone's role mid-session.

**Roles** — Captain and employee. An owner never sees it. This is NOT an error and NOT an empty state.

The design rule first, because the screen is the fallback and should be nearly unreachable: FOR A CAPTAIN, MONEY IS ABSENT, NOT DISABLED. No greyed rows, no lock icons, no blurred figures, no 'upgrade' framing. The Money tab does not exist in their job tab bar; contract_sum_ex, margin, cost_impact, rate and every invoice figure are never rendered; the profitability screen is not in their tree. When the screen is reached anyway: - A 22px lock glyph in inkGhost #B7BCC2 (not red — this is not a failure). - 17/600 ink: 'Contract figures are owner-only.' - 13.5/1.45 inkSoft: 'Crewline splits the work from the money. You run the job — the scope, the programme, the crew, the defects, the sign-offs. Contract sums, invoices, pay rates and margins stay with the owner. This is set in the database, not on your phone, so nobody can see them by accident.' - 13.5 line: 'What you CAN see on this job:' then four 44px rows that go somewhere useful — Scope · Programme · Defects · Crew. - One 44px ghost: [Ask Sam about this] → opens a DM channel with the company's owner (channels.kind='dm'). SAME PATTERN, DIFFERENT COPY for an employee reaching another person's hours or another job: 'You see your own hours. Your captain and the office see the crew's.' Why this is written so carefully: the RLS reality is that a captain's query for contracts/invoices/job_profit_v returns ZERO ROWS, indistinguishable from 'this job has no contract'. So the app must decide from workers.role which of the two states to render — and the default when a role could never see a row must be this screen, never 'nothing yet'.

**Every tap target**

- Each of the four 'what you can see' rows → that tab of the job
- Ask Sam about this → the DM channel
- Back → wherever they came from; if they arrived from a notification, back goes to the Jobs list

**States** — Loading: none — this is decided from role, which is already in memory. Empty/Error: none. Offline: renders identically; it needs no data.

---

## Permission denied — a job that is not yours

**full screen**

**Reached by** — A deep link, a stale notification, or a shared reference to a job the person is not on: a captain opening a job where captains_site() is false, an employee opening a job they have no assignments row for.

**Roles** — Captain and employee. Note the honest gap this design has to cover: job_sites_read in schema.sql lets EVERY company member select every job site row, so nothing in the database stops an employee seeing the whole company's job list. The filtering to 'jobs you are on' is client-side, from assignments and crews — which means this screen is a product decision, not a security boundary, and the inventory says so rather than implying RLS is doing it.

- 17/600 ink: 'You are not on this job.' - 13.5 inkSoft: 'Lot 42, Prospect is run by another crew. You will see it here the day you are rostered on it.' - The job's name and suburb ONLY — no address, no supervisor, no figures, no photos. - 44px ghost [See my jobs] → Jobs list. - 44px ghost [Ask the office] → the office DM channel, with the job name pre-filled in the composer. If the person was rostered on it and no longer is (an assignments row exists but has ended), say that instead: 'You came off Lot 42 on Fri, 1 Aug. Your photos and hours from it are still yours — they are under Photos and Time.' Both of those are true and reachable.

**Every tap target**

- See my jobs → Jobs list
- Ask the office → DM channel with a pre-filled first line
- Photos / Time links in the ex-job variant → those tabs, filtered to that job

**States** — Loading: the name is already known from the link; the rest needs nothing. Error: if even the name cannot be resolved, the copy degrades to 'That job is not one of yours.' Offline: identical.

---

## Session expired / not linked to a company

**full screen**

**Reached by** — Token refresh failure mid-session, or a first sign-in by someone whose auth user has no matching workers row (the invite_email has not been set by the office).

**Roles** — All three, before any role is known.

Two distinct screens sharing a layout, both already present in skeletal form in WorkerApp's Notice component: SESSION EXPIRED — 17/600 'Sign in again', 13.5 inkSoft 'Your sign-in has run out. Nothing you have taken or written is lost — it is waiting on this phone.' Then the outbox count if non-zero, as a reassuring 12.5 line: '2 photos and 1 defect are still waiting to send.' Full-width CTA [SIGN IN]. NOT LINKED — 17/600 'Not linked to a company', 13.5 'Ask your office to add you to the crew list with this email, then sign in again.' The email they signed in with is shown at 13.5/600 so they can check it against what the office typed (workers.invite_email is matched case-insensitively by a unique index on lower(invite_email)). Ghost [Sign out] and [Try again]. Neither screen has a tab bar. Neither offers a way in.

**Every tap target**

- SIGN IN → AuthScreen
- Try again → re-runs the workers lookup
- Sign out → clears the session

**States** — Loading: 'One moment.' full-screen, the only place a bare loading notice is allowed, because there is no shape to promise yet. Error: inline under the CTA. Offline: 'You need a connection to sign in.' with the outbox reassurance kept, because that is the thing the person is actually worried about.

---

## Location pre-prompt — the screen that earns 'Always'

**full screen**

**Reached by** — Shown once, full-screen, immediately after the first successful sign-in and before any OS permission dialog. Reachable again from Me → Tracking, and automatically after a denial.

**Roles** — All three. An owner tracks too — they are on sites — but the copy's second paragraph differs: for an employee it is about their hours; for an owner and captain it adds 'and it is how your crew's hours are produced'.

This is the app's whole premise, so it is the one screen allowed to be long. Scrolls; the CTA is pinned. (1) A 200px illustration: the ApproachMap treatment already in the codebase — the block plan, the accent geofence circle, the dashed approach trail. Not a photo, not an icon. (2) 20/600 ink: 'You get clocked on without touching your phone.' (3) 15/1.45 inkMid: 'Drive to a job and Crewline puts you on the clock two minutes after you have settled inside the site boundary — so driving past never opens a shift, and forgetting never costs you hours.' (Two minutes is DWELL_IN_MS = 2 × 60_000; the settle window is real and named.) (4) THE HONEST BLOCK — a panel with 1px #DCE0E6, three rows, each a 16px glyph and 13.5/1.45 inkMid: · 'Your position is sent about every 20 seconds while tracking is on — including the drive to work, not only when you are on site.' (PING_INTERVAL_MS = 20_000, and the codebase carries a comment recording that earlier copy claiming otherwise was wrong.) · 'Your office can see it as a trail on their map.' · 'The trail is deleted after 3 days. The hours it produced are kept — your employer must keep pay records for 7 years.' (positions are pruned by prune_positions() in schema_v22; shifts are kept, schema_v23.) (5) 13.5 inkSoft: 'Tracking only runs when you turn it on. Turning it off takes one tap and you can do it any time.' (6) Pinned footer: full-width 56px CTA [TURN ON TRACKING] in the yellow gradient; below it a 44px ghost [Not now]; below that a 12 inkFaint underlined link 'What Crewline records about you' → /privacy. WHY 'ALWAYS' AND HOW IT IS ASKED: iOS will not offer Always on first ask. So the flow is two-stage and the screen says so plainly at the point it matters, not in advance: Stage 1 — this screen's CTA triggers the OS prompt, and the app asks for While Using. The person taps Allow While Using. Stage 2 — the first time a shift is opened by the geofence, a half sheet appears: 'Keep this working with your phone in your pocket. Right now Crewline only records while this screen is open — so a phone that locks in the ute stops reporting, and a shift can be missed. Choosing “Change to Always Allow” fixes it.' with [SHOW ME THE OPTION] triggering the provisional-always prompt, and [Not now]. iOS's own prompt then does the asking, and it shows the trail — which is why stage 1's honesty matters: a person who was told the truth on this screen recognises the map iOS shows them. Android: the persistent foreground-service notification ('Crewline is tracking your location' / 'Recording your location while tracking is on. Tap to open.' — the literal strings in worker/location.ts) is introduced HERE, as a feature: 'Android shows a notification the whole time tracking is on. That is deliberate — you can always see when it is running.' Web build: the pre-prompt swaps its CTA subtitle for backendNote()'s exact string, 'In a browser, tracking pauses when your phone locks. Install the app to be clocked in without keeping this open.' Never promise background tracking a browser cannot do.

**Every tap target**

- TURN ON TRACKING → OS location prompt, then the Jobs list with the status rail live
- Not now → Jobs list with tracking off; the Jobs list carries a persistent 44px 'Tracking is off — you will not be clocked on' row in warnFill #FFF9E8 / warnInk #8A6100, tappable back to this screen
- What Crewline records about you → /privacy in a browser view
- SHOW ME THE OPTION (stage 2 sheet) → the OS Always prompt

**States** — Loading: none — this screen needs no data. Empty/Error: none. Offline: fully functional; permission is a device matter and this screen must work in a basement. If backend() === 'none' the CTA is replaced by a 13.5 alertInk line 'This device has no location services' and the screen offers manual options only.

---

## Location denied — the recovery

**full screen**

**Reached by** — The OS prompt was declined, or permission was later revoked in Settings, or iOS downgraded to 'While Using' and the person then denied the Always upgrade. Detected from the NOT_AUTHORIZED error the native watcher reports.

**Roles** — All three.

NOT a dead end and not a nag. Three tiers by severity: DENIED OUTRIGHT: · 17/600 ink 'Crewline cannot see where you are.' · 13.5 inkSoft, the consequence in hours, not in features: 'That means you will not be clocked on when you get to site, and clocking in by hand will not work either — the app checks your position before it opens a shift, so it has nothing to check.' (True: manual clock-in sends the same ping and is refused outside a fence.) · A 3-step, numbered, device-specific instruction with real labels: 'Settings → Crewline → Location → Always'. Each step 44px with a 13.5 line. · Full-width 52px CTA [OPEN SETTINGS] — the OS deep link. On web, this is replaced by 'Tap the padlock in your browser's address bar → Location → Allow'. · 44px ghost [Tell the office I cannot clock on] → posts a message to the site channel: 'I cannot clock on — location is off on my phone.' This is the recovery that matters, because the alternative is a person losing a day's pay silently. DOWNGRADED TO 'WHILE USING': · A warnFill banner, not a full screen: 'Tracking pauses when your phone locks. Keep Crewline open, or change to Always.' with [Change to Always] and [Keep it this way]. Choosing to keep it is respected and not re-asked for 30 days. PRECISE LOCATION OFF (iOS reduced accuracy): · warnFill banner: 'Approximate location is not accurate enough for a site boundary. Turn on Precise Location.' with [Open Settings]. RE-ASK POLICY: the app asks once at onboarding, once at the first geofence shift (the Always upgrade), and thereafter only when the person taps something that needs it. Never on launch. Never twice in a day.

**Every tap target**

- OPEN SETTINGS → the OS app settings deep link
- Tell the office I cannot clock on → site channel with the message pre-filled and the composer focused
- Change to Always → the OS prompt
- Keep it this way → dismisses for 30 days
- Back → Jobs list; the app is fully usable without location for everything except clocking on, and the Jobs, Photos, Work and Chat tabs must all keep working

**States** — Loading: none. Error: if OPEN SETTINGS cannot deep-link (some Android OEMs), the instruction text stays and the button becomes 'Copy these steps'. Offline: identical — nothing here needs a network except the message to the office, which queues.

---

## Tracking status rail and the stop-tracking confirm

**inline**

**Reached by** — Appears automatically as a 40px band under the system status bar whenever tracking is on, on every root and job screen. Not present when tracking is off.

**Roles** — All three. The rail is identical; what it says depends on the server-returned phase, never on the phone's own opinion.

40px, full bleed, and it is the one piece of chrome that changes colour: · offsite / tracking on, not near a site — appBg #F5F6F7, inkSoft text: 'Tracking on · Headed to Lot 42, 1.4 km' · arriving (the settle window) — warnFill #FFF9E8, warnInk #8A6100, with a 16px determinate ring counting down: 'Confirming you are on site · 1:24' · onsite — successFill #EAF7EC, successInk #1B7A2C, a 8px success dot: 'On the clock at Lot 42 · 6h 12m' with the elapsed ticking each second in tabular-nums so the digits do not jitter. · departing — same green, 'Leaving Lot 42 — still on the clock' · signal lost — fill #F1F3F5, inkSoft: 'No GPS for 4 min' All five phases come from the /api/ping response, which is the server's dwell machine. The rail must never render a phase the phone inferred. Tapping it opens the TRACKING SHEET (half sheet): the live GPS line ('GPS ±12 m · reporting every 20s' — the built PrivacyLine), the site and distance, the settle-window explanation, backendNote() verbatim on the web build, a 44px [Clock in manually] when off-clock and inside no fence (which sends a manual-flagged ping — the server still refuses it outside a boundary, and its refusal message is shown verbatim), and at the bottom a 48px [STOP TRACKING] in the ctaRed treatment. STOP TRACKING opens the confirmation modal with the copy that has already been fought over in this codebase: stopping does not clock you out; only the boundary can, and an open shift stays open. That sentence is load-bearing and must not be shortened.

**Every tap target**

- The rail → Tracking sheet (half sheet)
- Clock in manually (in the sheet) → sends a manual ping; on refusal shows the server's own note in an info Banner inside the sheet
- STOP TRACKING → confirmation modal → stops the watcher, removes the rail, returns to the Jobs list

**States** — Loading: before the first fix, the rail reads 'Tracking on · waiting for GPS' in inkSoft with a 16px indeterminate ring. Empty: n/a. Error: a watcher error (NOT_AUTHORIZED) turns the rail alertFill with 'Location is off — tap to fix', opening the denied-recovery screen. Offline: the rail keeps its last server-confirmed phase and appends '· offline' at 12/500; it must NOT claim a phase change while offline, because the phone does not decide the clock.

---

## Notification permission pre-prompt

**half sheet**

**Reached by** — Never at launch. Triggered the first time the person does something whose answer arrives later: submitting a punch correction (shift_corrections insert), requesting time off (time_off_requests), or an owner raising a variation that awaits approval.

**Roles** — All three, with role-shaped copy naming the notifications each actually receives (the notifications.kind check constraint is the source: roster_published, leave_decided, correction_raised, correction_decided, timeoff_requested, shift_flagged).

Half sheet, medium detent, opened on the moment of relevance rather than on launch. · 17/600 ink: 'Want to know when the office decides?' · 13.5/1.45 inkMid: 'You have just asked the office to fix Tuesday's punch. We can tell you the moment they answer, instead of you checking.' · Three 13.5 rows with 16px ticks, naming the real kinds for this role — employee: 'when your roster goes out', 'when leave is decided', 'when a punch correction is decided', 'when a shift of yours is flagged'. Owner adds 'when a variation is waiting on you' and 'when someone raises a correction'. · 52px CTA [YES, TELL ME] → OS notification prompt. 44px ghost [No thanks]. HONESTY REQUIREMENT: schema_v7 states plainly that there is 'still no email, SMS or push transport' — notifications today are rows in a table read in-app over Supabase realtime. So this sheet must not be built until a transport exists, and until then the app uses only the in-app banner and the tab-bar dot. Drawing a push prompt the backend cannot honour is exactly the kind of screen that gets built twice. This entry exists so the designer knows the prompt's shape AND its precondition.

**Every tap target**

- YES, TELL ME → OS prompt
- No thanks → dismisses, does not re-ask for 60 days, and the in-app banner continues to carry everything

**States** — Loading: none. Error: if the OS prompt was already permanently denied, this sheet is replaced by a 13.5 line and [Open Settings]. Offline: renders fine; permission is local.

---

## In-app notification banner

**inline**

**Reached by** — Appears automatically when a notifications row arrives over realtime with read_at null and worker_id = me (or worker_id null and the person is office).

**Roles** — All three. An owner also receives company-wide notices (worker_id null), per notifications_read.

The built NoticeBanner, formalised. A card in accentFill #E7F1FF with a 1px accent #007BFF border, radius 4, margin 0 20px, padding 11/13, sitting directly under the title bar and above the content — pushing content, not floating. · notifications.title at 13.5/700 in #0A4E9E. · notifications.body at 12.5 in #0A4E9E. · When more than one is unread: 'and 3 more — tap to clear' at 11.5, 80% opacity. It does not auto-dismiss and it does not stack — one banner, showing the newest, with a count. SEVERITY OVERRIDE: a notification of kind 'shift_flagged' renders in warnFill #FFF9E8 / warnInk, because it is about the person's pay and blue reads as informational. Tapping the banner marks the shown notifications read (a single update setting read_at) and navigates via notifications.link_nav — which is why link_nav exists and why every trigger that inserts a notification must set it. A banner that goes nowhere is worse than no banner.

**Every tap target**

- The banner → marks read and navigates to link_nav's destination (roster → Diary; correction_decided → the Time tab, that day's row sheet; shift_flagged → the same; timeoff_requested, owner → the Diary's requests list)
- Nothing else on it is tappable — no separate X, because tapping it clears it

**States** — Loading: absent until data arrives; it never renders a skeleton, because a skeleton notification is a lie. Empty: not rendered at all — never 'no notifications'. Error: if the read query fails the banner simply does not appear; the tab-bar dot is the backstop. Offline: a banner already on screen stays; marking-read queues (the update is a queueable write) and the banner disappears optimistically.

---

## Notification centre

**full sheet**

**Reached by** — The bell in the title bar, or the tab-bar dot on Me.

**Roles** — All three; an owner's list additionally contains worker_id-null company notices.

Full sheet at 92%. Sticky header 'Notifications' with a right-hand 'Mark all read' (12.5 accent). Rows, 64px: a 22px kind glyph, notifications.title at 14.5/600, notifications.body at 12.5 inkSoft truncated to one line, created_at as a relative time right-aligned at 12 inkFaint ('4 min ago', 'Tue 3:40pm', en-AU). Unread rows carry a 6px accent dot at the left gutter and a panel background; read rows are appBg with no dot. Grouped by day with a 12/700/.06em uppercase inkFaint header: TODAY · YESTERDAY · WED, 6 AUG. No filters, no search. It is a short list by nature.

**Every tap target**

- A row → marks it read and navigates via link_nav, dismissing the sheet
- Mark all read → sets read_at on everything visible, in place, with the dots fading over 180ms
- Drag down / scrim → dismiss

**States** — Loading: 6 skeleton rows. Empty: 'Nothing new. You will hear about a roster going out, a punch correction being decided, and a shift the office has flagged.' — naming the actual kinds, so the reader learns what this is for. Error: full-height error with Retry. Offline: shows what is cached with a 12.5 inkFaint 'Up to date as of 4:12pm'; marking read queues.

---

## The one-handed capture form — the generic pattern

**full screen**

**Reached by** — Every create/edit flow: a variation, a defect, a progress entry, an instruction, a daily log, a punch correction, a time-off request, a wet area.

**Roles** — The same shape for all three; which forms exist differs. A captain has no money form of any kind. An employee has defects, instructions, photos, daily logs, corrections and time off.

A PUSH, never a sheet — every one of these has more than five fields or opens a camera. LAYOUT, top to bottom: · 52px header: [Cancel] left (44px, accent), title 16/600 centred, and NOTHING on the right. The save is at the bottom where the thumb is, never top-right. · Scrolling body, 20px gutter, fields stacked in one column. · A pinned 84px footer: full-width 56px CTA in the yellow gradient, and a 12.5 inkFaint line under it saying what the save actually does — 'Adds a dated, geotagged photo to today's photos', 'Raises VO-4 against Lot 42. It adds nothing to the contract until the builder approves it.' FIELD ORDER — the thumb rule: the fields a person can answer without thinking go first (choices, chips, dates), the ones needing typing go last, and the camera goes first of all where a photo is the evidence. A form a person abandons at field 3 should still have captured the photo. CONTROLS, in order of preference: 1. CHIP ROWS for any enum. 44px tall, 15px horizontal padding, radius 19, selected = ink #1A1D21 fill / white / 600, unselected = panel / 1px #DCE0E6 / ink. This is how every check-constrained column is captured — defects.severity (minor/major/critical), defects.responsible (us/builder/other_trade/client/unknown), site_instructions.how (verbal/email/site_meeting/written/drawing), waterproofing_photos.stage, shift_corrections.reason_code (parked_offsite/access_changed/blocked/forgot/other), progress_entries.unit (m2/lm/item/room/%). Never a <select> for an enum under 7 values. 2. STEPPERS for small integers: waterproofing.coats (1–5, the check constraint), flood_test_hours. 44×44 minus and plus with the value 20/600 between. 3. NUMERIC PADS: inputmode='decimal' for quantity, done_quantity, cost_impact, wall_height_mm; inputmode='numeric' for days_impact. Never a spinner, never a slider for a number that has to be right. 4. DATE: a 52px row opening the native date picker. Default to today (every relevant column defaults to current_date in the schema). en-AU format everywhere: 'Sat, 9 Aug 2026'. 5. TEXT: 52px single-line inputs, 16px font minimum on iOS or the page zooms on focus — this is a hard requirement and it overrides the 14.5 body preference for inputs specifically. Multi-line: 3 rows minimum, auto-growing, never scrolling internally under 6 lines. 6. VOICE: any multi-line field has a 44×44 mic button in its top-right. Typing with gloves does not happen. It fills the field as editable text which the person then confirms — never posts on their behalf. KEYBOARD: the pinned CTA rises with the keyboard and stays visible. The focused field scrolls to 120px below the header, never under the keyboard. A [Done] accessory bar above the keyboard for numeric pads, which have no return key. DIRTY-STATE: any typed character or attached photo makes the form dirty; Cancel and back then route through the Discard confirmation modal. DRAFTS: a dirty form that is backgrounded is kept locally and restored with a 12.5 line 'Picked up where you left off, 20 min ago'. OPTIMISM: on save, the form dismisses IMMEDIATELY, the new row appears in the list behind it in its final position, and the toast confirms. If the write fails it becomes a rejected-write row (see Inline error) — the person is never held on a spinner.

**Every tap target**

- Cancel → discard confirmation if dirty, else dismiss
- Any chip → selects (single-select) or toggles (multi)
- Camera / Add photo row → camera capture
- Mic → dictation into that field
- Date row → native picker
- The CTA → saves, dismisses, toasts

**States** — Loading: forms open instantly; only a pre-filled form (editing an existing record) skeletons its fields, and it keeps the title and the Cancel live. Empty: n/a. Error: field-level and form-level as per the Inline error pattern; the CTA never disables. Offline: the CTA reads the same and the toast reads 'Saved on your phone — it will send when you have signal'. The one exception is any form whose result must be server-stamped (waterproofing sign-off), where the CTA is disabled offline with a plain reason.

---

## Variation capture and the approve/decline decision

**full screen**

**Reached by** — Owner: job → Money → Variations → [+], or from a site instruction sheet where site_instructions.is_variation is true ('Turn this into a variation'). Approve/decline: tapping a change_orders row with status 'pending_client'.

**Roles** — OWNER ONLY for both capture and decision — raising or approving a variation is committing the company's money, and schema_v18 says so explicitly ('They still cannot raise or approve one'). CAPTAIN sees the variation list on their own jobs (change_orders_read was widened for captains_site) as read-only, without cost_impact, because the captain is 'the person the builder collars on site about extra work'. EMPLOYEE does not see variations at all; they log a site instruction instead.

CAPTURE (push, the generic form pattern): · Photos first — camera or picker, multiple, shown as 72px thumbnails. · change_orders.description (single line, the title that will print on the PDF). · change_orders.detail (multi-line, with the mic). · REASON — a chip row, and this is the field the client asked for by name. It maps to the linked site_instructions row where one exists (how: verbal / email / site_meeting / written / drawing, plus from_name), because 'the builder's supervisor told me on Tuesday' is the whole defence. · change_orders.cost_impact — decimal pad, with an 'Ex GST' chip beside it. · change_orders.days_impact — numeric pad, labelled 'Days added to the programme'. · Lines (change_order_lines: cost_code, name, detail, amount, sort) — optional, added by a 44px [Add a line] row, each line a compact 3-field group. If lines exist, cost_impact becomes their sum and locks with a 12.5 note. · change_orders.co_no is generated, shown read-only at the top as 'VO-4', with the unique (company_id, co_no) constraint surfaced as a rejected-write if two devices race. · Footer note: 'Raises VO-4 as pending. It adds nothing to the contract sum until it is approved.' — hard rule 6 of the brief, stated on the screen that could break it. DECISION (half sheet, because it is one record and one decision): · Header 'VO-4' + status chip (draft grey / pending_client warnFill / approved successFill / rejected alertFill). · description, detail, raised_on, cost_impact 'ex GST', days_impact, photo strip. · Two stacked 52px buttons: [APPROVE] in the yellow CTA, [Decline] in the ctaRed ghost. · APPROVE opens the signature step (push): 'Who approved this, and when?' — a name field and a signature canvas writing change_orders.signature jsonb {name, signed_at}; the database then stamps approved_on via change_orders_stamp_approval, and the app must display approved_on rather than the signature date, because a variation can be agreed on site and signed a fortnight later. · DECLINE opens the confirmation modal naming the consequence. · Once approved, the sheet's chip becomes 'ON THE CONTRACT · VO-4' in successFill and the buttons are replaced by a single ghost [Open the contract].

**Every tap target**

- Add photo → camera
- Add a line → inline line group
- APPROVE → signature push
- Decline → confirmation modal
- A photo thumbnail → full-screen viewer
- Open the contract (approved) → the contract screen, owner only
- 'Turn this into a variation' on an instruction sheet → this form, pre-filled with the instruction's text and photo, and setting site_instructions.change_order_id on save

**States** — Loading: the decision sheet opens with everything the list row knew; photos skeleton. Empty: the variations list empty state (see Empty patterns). Error: a co_no collision surfaces as a rejected-write with [Retry] which regenerates the number. Offline: capture queues; APPROVE and DECLINE DO NOT queue — approving a variation is authority to bill, and the buttons are replaced by a 13.5 line 'You need a connection to approve this.'

---

## Defect capture

**full screen**

**Reached by** — Job → Work → Defects → [+]. Also from a photo's viewer ('Raise a defect from this photo', carrying the site_files row into defects.photo_path) and from a plan pin (carrying plan_pins.id into defects.plan_pin_id).

**Roles** — All three can raise one (defects_field_insert allows any company member). Only owner and captain-on-their-own-job can edit or close one. cost_estimate is OWNER ONLY on the phone — and note that unlike contracts, nothing in RLS hides it from a captain who queries the table, so this is a client-side rule that ought to be a database one.

Field order, tuned to one hand standing in the room the defect is in: 1. PHOTO first — full-width 56px [TAKE A PHOTO] CTA, because a defect without a photo is a defect that gets argued about. Writes defects.photo_path. 2. defects.location — a text field, but pre-populated with a chip row of the rooms already used on this job (distinct location values from existing defects rows) so the second defect in the same ensuite is one tap. 3. defects.description — multi-line with the mic. 4. defects.severity — chip row: minor / major / critical, coloured inkSoft / warnInk / alert. 5. defects.responsible — chip row: us / builder / other_trade / client / unknown, labelled 'Whose is it?' with a 12.5 note 'Half a tiler's defect list is another trade's damage, and this decides who pays.' 6. defects.raised_by_party — chip row: builder / client / us / certifier / other, labelled 'Who raised it?' 7. defects.due_on — date, optional. 8. defects.note — optional multi-line. (defects.ref is generated; created_by and raised_on are stamped.) CLOSING A DEFECT is the mirror flow, from the defect's half sheet: [Mark fixed] → camera → writes fixed_photo_path and fixed_on and sets status 'fixed'. A defect cannot be marked fixed without a photo — the sheet's CTA opens the camera rather than the status picker, which is the design enforcing what the schema comment already says ('A defect closed without a photo is a defect reopened'). Verification (status 'verified', verified_on, verified_by) is owner/captain only.

**Every tap target**

- TAKE A PHOTO → camera
- Location chips → fills the field
- Every chip row → single select
- Mic → dictation
- Save → dismisses, the new defect appears at the top of the open list, toast 'Defect raised on Lot 42. The office can see it now.'
- On the sheet: Mark fixed → camera → save; Reopen → confirmation modal

**States** — Loading: instant. Empty: n/a. Error: inline. Offline: queues fully, including the photo; the defect appears in the list with an 'Waiting to send' chip in fill #F1F3F5.

---

## Progress entry capture

**full screen**

**Reached by** — Job → Work → Progress → [+], and from the job overview's progress bar ('Update progress').

**Roles** — OWNER AND CAPTAIN ONLY. schema_v19 excludes progress_entries from the field-insert policy on purpose: 'a progress percentage is what a claim is justified with, so letting anyone type one in makes over-claiming an accident rather than a decision.' An employee sees the resulting percentage and cannot write one. This is the one place where 'anyone can report' does not apply, and the empty state for an employee must say why rather than leaving a missing button unexplained.

1. progress_entries.area — text with a chip row of the areas already assessed on this job (from site_progress_v's latest-per-area), because progress is re-assessed on the same areas week after week and typing 'Level 2 balconies' twice invites two areas that are one. 2. progress_entries.cost_code — optional, chip row of codes used on this job. 3. progress_entries.unit — chip row: m2 / lm / item / room / %. 4. progress_entries.quantity — decimal pad, 'How big is the whole area?' 5. progress_entries.done_quantity — decimal pad, 'How much is done?' 6. progress_entries.pct_complete — auto-computed from 4 and 5 and shown as a large 26/600 read-only figure with a progress bar; editable by tapping it, which unlinks it from the quantities and shows a 12.5 note that it is now a judgement rather than a measurement. Check constraint 0–100 enforced in the pad. 7. progress_entries.assessed_on — date, defaults today. 8. progress_entries.note. Footer note, which is the reason this screen exists: 'Progress is rolled up weighted by quantity, so 100% of a 2 m² powder room does not cancel out 10% of 300 m² of balconies.' (site_progress_v's own logic.) After save, the job overview's percentage animates from the old to the new value over 400ms — the one number in the app allowed to animate, because the change is the point.

**Every tap target**

- Area chips → fill the field
- Unit chips → select
- pct_complete figure → unlock for manual entry, with the note
- Save → dismisses, overview bar animates
- On the resulting list row → half sheet with the history of that area's assessments

**States** — Loading: instant. Empty (the list): 'Nobody has measured this job yet. Progress here is what a claim is justified with, area by area — not a feeling.' plus the CTA for owner/captain, and for an employee the same first sentence plus 'Your captain or the office records this.' Error: inline. Offline: queues.

---

## Signature capture

**full screen**

**Reached by** — Three places, all of them consequential: signing a SWMS or induction (safety_signatures), signing off a wet area (waterproofing.status → signed_off), and recording a builder's approval of a variation (change_orders.signature jsonb).

**Roles** — SWMS: everyone signs their own. Waterproofing sign-off: owner or captain only — schema_v19's trigger silently downgrades a signed_off insert from anyone else to 'in_progress', so the UI must not offer the button to an employee or it will appear to work and not have. Variation approval: owner only.

A push, always full-screen, always landscape-tolerant. · Header: [Cancel] and the title 'Sign on' / 'Sign off the membrane' / 'Builder's approval'. · The DOCUMENT ABOVE THE PEN, always. A signature box with nothing above it is worthless: safety_documents.title, version and the body's control lines rendered as a checklist; for waterproofing, the record being attested — area, product_name, batch_no, coats, bond_breaker, angle_fillet, wall_height_mm, flood_tested and flood_test_hours — as label/value rows. · A scroll-to-end gate for SWMS: the signature box is dimmed with 'Read to the end first' until the document has been scrolled to its bottom. · The canvas: full-width, 180px tall, 1px #DCE0E6, radius 8, panel background, a 12 inkFaint 'Sign here' placeholder that clears on first touch. Stroke 2.4px, round cap and join, ink #1A1D21, device-pixel-ratio scaled (this is exactly what SafetyScreen already does). · A 44px [Clear] ghost right-aligned above the canvas. · The CTA is DEAD until there is ink — the built code's rule, and the reason for it is on the screen: 'A SWMS signed with an empty box is worth nothing after an incident, which is the only time anyone reads one.' · Under the CTA, a 12.5 inkFaint line stating what is being stamped and by whom: 'Your name and the time are recorded from the server when you sign. Neither can be changed afterwards.' For waterproofing this is literally true — waterproofing_stamp_signoff sets signed_off_at, signed_off_by and signed_off_name in the database and refuses to take them from the client. · For a variation, an additional name field above the canvas ('Who is signing?'), because the signatory is the builder, not the app's user.

**Every tap target**

- Clear → wipes the canvas, disables the CTA
- The canvas → draws
- CTA [SIGN AND START] / [SIGN OFF] / [RECORD APPROVAL] → writes and dismisses
- Cancel → discard confirmation if there is ink

**States** — Loading: the document skeletons; the canvas does not appear until the document has loaded, because signing something that has not rendered is the failure mode. Empty: for SWMS, if no active safety_documents row exists for this site the screen is not reachable and the Safety list says 'The office has not put a SWMS or induction on this site yet, so there is nothing to sign' (the built copy). Error: inline; the ink is never lost on a failed save — the canvas keeps its strokes and the CTA becomes [Try again]. Offline: SWMS signatures QUEUE (safety_signatures is a record of an act that happened at a time, and the time is stamped locally then reconciled). Waterproofing sign-off and variation approval DO NOT queue — both are server-stamped certificates; the CTA is disabled with 'You need a connection to sign this off.'

---

## Camera capture and tagging

**full screen**

**Reached by** — Every [TAKE PHOTO] and [ADD PHOTOS] in the app: the Photos tab CTA, a defect's evidence, a wet area's stage photos, a plan pin, a daily log, a site instruction, a receipt.

**Roles** — All three. site_files write is open to the company; waterproofing_photos_field_insert is explicitly open because 'a worker photographing the membrane they just laid is the entire point.'

Modal presentation over everything, no tab bar. (1) CAPTURE: the OS camera (input capture='environment' on web; the native camera in the shell). Multi-shot: after each frame the person returns to a filmstrip with [Take another] and [Done, tag these] — one trip to the ensuite yields six photos and one tagging pass, not six. (2) TAGGING, one screen for the batch: · The strip of thumbnails, 72px, with a per-photo X. · Category chip row — site_files.category: Progress · Issue · Before · After · Inspection. (For a wet area the chips are waterproofing_photos.stage instead: Substrate · Primer · Fillet · Membrane · Second coat · Flood test · Other.) · Caption, multi-line with the mic, applied to the batch with a per-photo override on tapping a thumbnail. · A locked metadata block, each row with a small padlock in inkGhost, showing what is being attached and cannot be edited: Site (job_sites.name), Taken (taken_at), GPS ('±12 m' or 'No fix yet' — site_files.lat/lng). The padlocks are the point: a geotagged photo is evidence because nobody can adjust it. · Job picker, shown ONLY when the person is not currently on a site — otherwise the current site is used and stated. (3) The 56px CTA: 'UPLOAD 6 PHOTOS TO LOT 42'. It dismisses immediately and hands off to the upload tray. GPS HONESTY: if no fix is available the GPS row says 'No fix yet' and the photo still uploads — a photo without coordinates is worth more than no photo. It is never silently given the last known position.

**Every tap target**

- Take another → camera
- A thumbnail → per-photo caption and category override (half-sheet drill)
- X on a thumbnail → removes it from the batch
- Category / stage chips → select for the batch
- Mic → dictation
- Job picker → a select, only when off-site
- UPLOAD → dismisses to the parent with the tray running

**States** — Loading: none before capture. Empty: the pre-capture state is the striped placeholder and a single [OPEN CAMERA] CTA (already built). Error: camera permission denied → a plain screen: 'Crewline cannot open the camera. Settings → Crewline → Camera.' with [Open Settings] and a fallback [Choose from my photos], which must exist because a person may have already taken the shot in the OS camera. Offline: the whole flow works; the upload queues and the tray says so.

---

## Upload tray and photo progress

**inline**

**Reached by** — Appears automatically after any upload starts. Persists across navigation.

**Roles** — All three.

A 48px bar docked directly above the tab bar (or above the pinned CTA on a form), panel #FFFFFF, 1px top border, sliding up over 200ms. · A 32px thumbnail of the photo currently sending. · 13.5/600 'Sending 3 of 6 to Lot 42'. · A 2px determinate progress line along the top edge of the bar in accent — determinate ONLY when the transport reports bytes; otherwise it is a 2px indeterminate sweep and the label carries the honest unit instead ('3 of 6'), never a fake percentage. · A 44px [Cancel] on the right for the batch. On completion: the bar turns successFill for 1.6s with 'All 6 sent' and a tick, then slides away. The photos are already in the grid behind it — they were inserted optimistically at capture time with a 60% opacity and a small clock badge, which clear as each one lands. On failure: the bar turns warnFill, 'Could not send 2 — waiting for signal', and becomes a permanent entry point to the Outbox rather than disappearing. Background upload: on the native shell the batch continues with the app backgrounded; the tray reflects reality on return. On the web build it cannot, and the tray says so once: 'Keep this open until these finish.'

**Every tap target**

- The bar → Outbox (half sheet)
- Cancel → confirmation modal ('2 of 6 have already sent. Cancel the other 4?')

**States** — This is itself a progress state. Empty: not rendered. Error: the warnFill variant above. Offline: 'Waiting for signal — 6 photos' with no progress line, and no spinner, because nothing is happening and a spinning thing that is not moving is a lie.

---

## Photo viewer

**full screen**

**Reached by** — Tapping any photo thumbnail: the grid, a defect sheet, a wet area, a plan pin, a chat attachment, a variation.

**Roles** — All three. The 'Raise a defect from this' action is available to everyone (defects field insert); 'Add to a variation' is owner only.

Modal, black background (#000, not rail), no tab bar, edge to edge. · The image, contain-fit, pinch to zoom to 4×, double-tap to toggle 1×/2×, drag to pan when zoomed. · Swipe left/right between photos in the current set; a 12 inkFaint '3 of 11' top-centre. · Top bar, translucent: [X] left, [⋯] right. · Bottom sheet-let, translucent over the image, that hides on a single tap and returns on the next: site_files.caption at 14.5, then a meta line at 12 — who took it (workers.name via uploaded_by), taken_at, category chip, and a GPS badge reading 'On site' where the photo's lat/lng falls inside job_sites.radius_m of the site, 'Off site' where it does not, and nothing at all where lat is null. (PhotosTab already computes exactly this comparison; the null case must render as absence, never as a guess.) The single tap to hide chrome is the only gesture that is not also available as a button, and that is acceptable because the photo is still fully visible either way.

**Every tap target**

- X → dismiss back to where you came from
- ⋯ → action menu sheet: Raise a defect from this · Add to a wet area · Share · Save to phone · Delete (uploader or owner only, with confirmation)
- Caption area → edit caption (half sheet with a single field), for the uploader and for owner/captain
- Swipe down → dismiss, with the image scaling back to its thumbnail's position over 240ms

**States** — Loading: the thumbnail is scaled up as a blurred placeholder while the full image decodes, with a small centred spinner after 600ms — one of the three sanctioned spinner uses. Empty: n/a. Error: 'This photo could not be loaded' with [Try again] on black, and the meta still shown, because who took it and when is often the thing being checked. Offline: cached photos open; uncached ones show the error with 'Not downloaded yet'.

---

## Toast — the confirmation of what happened

**inline**

**Reached by** — After any successful write that dismissed its own screen.

**Roles** — All three.

A 52px pill docked 12px above the tab bar, panel #FFFFFF, radius 8, 1px #DCE0E6, shadow 0 6px 18px rgba(26,29,33,.14). Slides up 200ms, holds 3.2s, fades 200ms. · A 16px success tick in success #28A745, then 13.5/500 ink text. · An optional 44px trailing action in accent — usually [Undo] or [View]. COPY RULE, taken from the brief and worth restating because it is what makes this app sound like a person: say what happened, in the world, not what the system did. 'Left Maple Ridge at 3:31pm — clocked out. 8.8 hrs today.' Not 'Event recorded.' 'VO-4 raised against Lot 42.' Not 'Change order created successfully.' 'Defect raised. The office can see it now.' 'Saved on your phone — it will send when you have signal.' UNDO is offered only where a true undo exists (deleting a queued item, clearing a filter, marking notifications read). It is never offered for a server write that has already happened; for those the toast offers [View] instead. One toast at a time; a second replaces the first without re-animating the container. Toasts never carry errors. An error is inline, where the thing that failed is.

**Every tap target**

- Undo / View → the action
- The toast body → dismisses it early
- Swipe down on it → dismisses

**States** — n/a — a toast is a moment. Under prefers-reduced-motion it appears and disappears by opacity only, with the hold extended to 4.5s to compensate for the missing motion cue.

---

## Filter and search bar

**inline**

**Reached by** — Any list with more than roughly a dozen rows: photos, defects, the job list for an owner, hours, messages, the booking grid.

**Roles** — The chips available differ by role only in that a captain has no money filters (no 'unpaid', no 'over budget').

A 56px horizontally scrolling chip row directly under the title bar, sticky on scroll, panel background with a 1px bottom border. · Chips 44px tall (the mobile size, deliberately chunkier than the desktop kit's 34–38px), radius 22, 15px horizontal padding. · Selected = ink #1A1D21 fill, white text, 600. Unselected = panel, 1px #DCE0E6. · A count inside the chip in tabular-nums when the count is meaningful: 'Issues 2'. The count is live and computed from the loaded set — 'Issues 2' where category='issue'. When the count is zero the chip stays but loses its number; a chip that disappears when its count hits zero makes the row jump. · A severity dot (6px, alert) on a chip whose set contains something urgent — an open critical defect, an overdue item. · The first chip is always 'All' and is selected by default. SEARCH is a separate 44px row that appears only where free text helps (photos by caption, defects by location or description, messages). It is collapsed to a magnifier icon in the title bar and expands in place, pushing the chips down. Filters are client-side over the loaded set wherever the set is small enough to hold, so switching a chip is instant and works offline. Where a filter must hit the server (a date range over months of shifts), the list shows its skeleton and the chip shows an 18px inline spinner in place of its count.

**Every tap target**

- Any chip → applies the filter, re-runs the list, and scrolls the list to top
- Magnifier → expands the search field and focuses it
- Clear (x) in the search field → clears the term, keeps the chips
- A chip already selected → deselects back to All

**States** — Loading: chips render with labels and no counts; counts fade in. Empty: if a list is empty overall, the filter row is not rendered at all — filtering nothing is noise. Error: the row renders regardless; filters are the way out of a bad list state. Offline: fully functional over cached rows, with a 12.5 inkFaint line under the row: 'Filtering what is on your phone.'

---

## Freshness, pull-to-refresh, and realtime

**inline**

**Reached by** — Every list.

**Roles** — All three.

THREE MECHANISMS, and the design has to be clear about which is doing the work: (1) REALTIME. shifts, positions, geofence_events, notifications, crews, crew_members, site_instructions, defects, progress_entries, waterproofing and waterproofing_photos are all in the supabase_realtime publication. So those lists UPDATE THEMSELVES. A row that arrives while the person is looking slides in over 240ms with a 1.2s accentFill #E7F1FF flash that fades — the only 'new' treatment in the app. A row that changes updates in place with the same flash on the changed value only. (2) PULL TO REFRESH. Present on every list anyway, because a person who does not trust a screen pulls it, and denying them that reads as the app being stuck. 64px pull threshold, a 20px ring that fills with the pull and then spins, and on release the list keeps its content and reloads underneath — never a skeleton over data that is already there. (3) FRESHNESS LINE. At the bottom of any list whose data is not realtime (job_profit_v, company_overview_v, programmes, invoices, contracts), a 12 inkFaint centred line: 'Figures from 4:12pm.' It appears only once the data is more than 5 minutes old, and turns warnInk past an hour. No auto-refresh on foreground for money screens — an owner reading a margin should see it change because they pulled, not because they blinked. Realtime lists do refresh on foreground.

**Every tap target**

- Pull down → refresh
- The freshness line → refresh (it is a 44px tap target despite the small text)

**States** — Loading: the pull ring; the list content stays. Empty: pull-to-refresh works on an empty list and is often the first thing a person does — the empty state must survive the pull without jumping. Error: a failed refresh leaves the old content and shows a toast 'Could not refresh — showing what you had.' The list is never emptied by a failed refresh. Offline: the pull completes, the ring shows, and the toast says 'You are offline — this is what is on your phone.'

---

## Typography scale

**inline**

**Reached by** — Specification. theme.font is the family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif.

**Roles** — Role-independent.

The phone scale, which is NOT the desktop scale — the desktop kit's 10–11.5px labels are unreadable on a slab at 7am and are forbidden below. 34 / 600 / -.02em — the countdown numeral only (settle window). 26 / 600 / -.02em — the one hero figure per screen: the site you are headed to, the time you clocked in, a job's percent complete, a margin. Never two on one screen. 20 / 600 — screen title in the title bar. 17 / 600 — sheet titles, section headings, the primary line of an empty state. 16 / 600 — modal titles; also the MINIMUM font-size for any text <input> on iOS, which overrides everything else in this list for inputs specifically (below 16 the page zooms on focus and the layout breaks). 15 / 400 / 1.45 — the lead sentence, and list-row primary text where the row is a sentence. 14.5 / 600 — list-row primary text where the row is a label/value, and sheet values. 13.5 / 400 / 1.45 — BODY. This is the floor for anything a person has to read. The brief's daylight rule. 12.5 / 400 — secondary text that is genuinely secondary: a caption, a meta line, a helper under a CTA. Never a number a person acts on. 12 / 700 / .06em / uppercase — section labels. (The desktop token is 10.5/.08em; on the phone it goes to 12, because uppercase at 10.5 in sunlight is a smudge.) 11 / 700 — chips only. 10.5 / 700 — tab bar labels only, and only because they sit under a 22px icon that carries the meaning. NOTHING BELOW 10.5. NOTHING a person must READ below 13.5. COLOUR BY WEIGHT OF MEANING: ink #1A1D21 for anything acted on; inkMid #4A5057 for body; inkSoft #696D74 for secondary prose; inkFaint #8B9096 for labels, captions and meta ONLY; inkGhost #B7BCC2 for placeholder text ONLY. inkFaint is never used for a value, a name, a time or a number. NUMBERS: font-variant-numeric: tabular-nums on every figure that sits in a column or ticks — elapsed time, hours, quantities, money, counts. Non-negotiable: a running clock in proportional figures jitters. DYNAMIC TYPE: the scale honours the OS text size up to 130%. Above that, list rows grow taller rather than truncating, chips wrap to two rows, and the tab bar labels hide leaving icons only — the one place truncation is allowed to become removal.

**Every tap target**

- Nothing — this is a token sheet.

**States** — n/a

---

## Spacing, touch targets and the daylight constraint

**inline**

**Reached by** — Specification.

**Roles** — Role-independent.

SPACING — a 2px-based scale, used as: 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 26 · 34. Screen gutter: 20px (what the built worker screens use). Sheet gutter: 20px. Between a label and its value: 3px. Between fields: 14px. Between sections: 22px. Above a pinned footer: 14px + a 1px #DCE0E6 rule. List row vertical padding: 13px, giving a 52px row at 14.5px text. Card padding: 15px. Card gap in a stack: 10px. RADII: 3 controls and buttons (the codebase's control radius) · 8 cards, panels, image blocks · 14 sheet top corners · 19–22 pills and chips · 50% avatars. BORDERS: 1px #DCE0E6 for any real division; 1px #EDEFF1 for row dividers inside a list. Never both on the same edge, and never a shadow where a border will do — shadows on #F5F6F7 in sunlight are invisible and cost a repaint. TOUCH TARGETS: 44×44 minimum for EVERYTHING tappable, measured on the hit area, not the ink. Primary CTA 56px tall and full width at the gutter. Secondary 52px. Ghost/text buttons 44px. Tab bar items 56px. List rows 52px minimum. Chips 44px. Icon buttons 44×44 with a 22px glyph inside. 8px minimum between two adjacent independent targets. Two destructive targets are never adjacent. The primary action on any screen is a full-width bar at the bottom, never an icon in a corner — glove rule. DAYLIGHT LEGIBILITY, the constraint from the brief, made checkable: · Body text ≥ 13.5px, contrast ≥ 7:1 against its background for anything load-bearing (ink on panel is 15.8:1; inkSoft on panel is 5.9:1 and is therefore secondary-only; inkFaint on panel is 3.6:1 and is labels-only, which is exactly why the rules above restrict it). · No text over a photograph without a solid or ≥55% gradient scrim behind it (the photo footer already does this). · No colour-only signals. Every status that is coloured also carries a word or a shape: the on-clock rail is green AND says 'On the clock'; a critical defect is red AND says 'Critical'. · The yellow CTA — linear-gradient(180deg,#FFCD11,#F7B244), 1px #E0A032, ink text, 700, .04em, uppercase — is the highest-contrast element on any screen and there is exactly ONE per screen. 180 degrees, that stop order, always the border; theme.ts records that every hand-rolled copy in the codebase got at least one of the three wrong. · Nothing important is placed in the bottom 34px (home indicator) or the top 8px of the safe area.

**Every tap target**

- Nothing — this is a token sheet.

**States** — n/a

---

## Motion — what moves, what does not, and reduced motion

**inline**

**Reached by** — Specification.

**Roles** — Role-independent.

DURATIONS AND CURVES, the whole vocabulary: 120ms linear — a tap's own feedback (a row's background to accentFill and back). 180ms ease-out — anything appearing or disappearing in place: banners, badges, error lines, skeleton-to-content cross-fade. 200ms cubic-bezier(.32,.72,0,1) — toasts, the upload tray, in-sheet drills. 240ms cubic-bezier(.32,.72,0,1) — sheet present and dismiss, and the scrim's fade. 280ms cubic-bezier(.32,.72,0,1) — a screen push and pop. 320ms — the job context switch, as one coordinated move (push + tab-bar cross-fade + underline sweep). 400ms ease-in-out — the ONE value animation: a progress percentage counting from its old figure to its new one after a progress entry is saved. WHAT NEVER ANIMATES, and this is the more important half of the spec: · Numbers, except the single case above. A margin, an hours total, a queue count and a badge all change instantly. A figure that counts up is a figure a person cannot read while it is moving, and half the numbers in this app are the ones being argued about. · List reordering. A realtime row lands where it belongs; it does not fly. · Content between root tabs. Switching tab swaps content with no transition at all. A tab bar is a set of places, not a filmstrip. · Skeleton-to-content. Cross-fade only, no layout move, which is why skeleton row heights must match real row heights. · Anything on the tracking rail except the settle-window ring, which is a real countdown, not decoration. EXISTING ANIMATIONS, kept: cl-ping 2.4s ease-out infinite (the arrival pulse on the map) and cl-spin (.9s for an inline busy ring, 2.6s for the settle arc). HAPTICS (native only): a light impact on a chip select and a sheet snapping to a detent; a success notification haptic on a clock-in — the one moment worth feeling — and a warning haptic on a rejected write. Nothing else. A phone in a tool belt that buzzes constantly gets left in the ute. prefers-reduced-motion: reduce — · Sheets present and dismiss by opacity over 160ms, no translate. They are still draggable; drag tracks the finger 1:1 with no spring, and release snaps instantly. · Screen pushes become 160ms cross-fades. The job context switch keeps the tab-bar cross-fade (it is information) and drops the underline sweep (it is decoration). · cl-ping and cl-spin stop: the arrival pulse becomes a static ring, and the settle window becomes a plain 34/600 countdown numeral with the word REMAINING — the number was always the information. · The skeleton shimmer stops; blocks stay static #F1F3F5. · The progress count-up becomes an instant set. · Toast hold extends from 3.2s to 4.5s, since the motion cue that drew the eye is gone. Nothing becomes unreachable and no information is lost in reduced motion — every animated cue in this app has a static equivalent, which is the test.

**Every tap target**

- Nothing — this is a specification.

**States** — n/a

---

## Keyboard, safe areas and one-handed reach

**inline**

**Reached by** — Specification. Applies to every screen that takes input.

**Roles** — Role-independent.

SAFE AREAS: env(safe-area-inset-top) above the status rail; env(safe-area-inset-bottom) added to the tab bar's 56px and to every pinned footer's padding. No content in the bottom 34px. Landscape is supported only by the photo viewer, the plan viewer and the signature canvas; everything else is portrait-locked, because a one-column layout in landscape on a 390px device is 200px of usable height. KEYBOARD: · The pinned CTA rises with the keyboard and remains visible and tappable. It never scrolls away — the most common phone-form failure is a save button under a keyboard. · The focused field scrolls so its top sits 120px below the header, leaving the label and the field visible together. · A 44px accessory bar above the keyboard for numeric and decimal pads, carrying [Done] right-aligned, because those keyboards have no return key. · Return advances to the next field; the last field's return dismisses the keyboard rather than submitting — a form in this app is never submitted by a keyboard. · Tapping anywhere outside a field dismisses the keyboard. Scrolling dismisses it on drag start. REACH: everything a person must tap repeatedly lives in the bottom third — the tab bar, the primary CTA, chip rows on capture forms. Everything in the top third is navigational or informational: back, title, bell. The one deliberate exception is [Cancel] at top-left on a form, which is placed out of reach on purpose. GESTURES: the app uses exactly three — vertical scroll, sheet drag, and horizontal swipe between photos. No swipe-to-delete anywhere (a swipe over a defect row with gloves is how a defect gets deleted), no long-press menus, no pull-down-to-search. Every action has a visible target.

**Every tap target**

- Nothing — this is a specification.

**States** — n/a

---
