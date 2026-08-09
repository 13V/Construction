# Time, crews and the calendar

Time, crews and the calendar — the booking grid, crew management, the builder's programme as a calendar, clashes and gaps, the individual's roster, leave, and the readiness gate that makes a job allocatable.

38 screens. Generated from the codebase, not imagined — every figure named here comes from a table or view that exists. Part of the inventory referenced by `design/PROMPT-mobile-v2.md` section 7.

---

## Diary — the crew booking grid (crew-first mode) [RECOMMENDED SOLUTION]

**full screen**

**Reached by** — Root context, second tab of the company-level tab bar (Jobs / Diary / Crew / More). Also from a job's overview row 'Who's on this job' → 'See the whole week'. Deep-linked from a roster_published notification (notifications.link_nav = 'Schedule').

**Roles** — OWNER: every crew, every job, can tap any cell to book. CAPTAIN: read-only — assignments and crews are office-write-only in RLS (schema_v2 assignments_office_write, schema_v18 crews_office_write), so a captain has no booking affordance at all; they see the full company week because crews/crew_members/assignments are company-wide READ. Their own crew's row is pinned to the top and outlined. No 'Projected labour' money footer for a captain — that multiplies workers.rate and is owner-only. EMPLOYEE: does not get this screen; they get 'My week' instead.

Header: week range in en-AU ('Mon 10 – Sun 16 Aug'), ‹ › week paging, 'This week' reset. Body is a vertical list of CREW CARDS — crews.name, crews.colour dot, member count from crew_members, captain name from crews.captain_id via crew_v.name. Inside each card a strip of SEVEN DAY PILLS, Mon–Sun, all seven visible at 390px (44px pill + 4px gap = 332px inside 358px of content width, no horizontal scroll). Each pill carries: the weekday initial and date above the strip as a sticky sub-header, and inside the pill either (a) a 3-character job code with the job's deterministic tint when assignments rows exist for that crew_id + day, (b) the word 'Avail' in inkFaint on a hollow pill when no assignments row exists, (c) a hatched pill with a leave glyph when every member has an approved time_off_requests row (status='approved') covering that date, (d) a red-cornered pill when a clash is detected. Pill content is derived from assignments (crew_id, worker_id, site_id, starts_at, ends_at, published) grouped by crew_id and date(starts_at at Australia/Adelaide). A dashed pill border means published = false on any of the rows behind it. Under the strip: a one-line summary — 'Mon–Wed Lot 42 · Thu Available · Fri Kensington' — and per-crew week hours, summed from (ends_at - starts_at). A 'PEOPLE NOT IN A CREW' card at the bottom lists workers from crew_v with no crew_members row, same 7-pill strip, one row each. Footer strip (owner only): 'N shifts · M not yet published · projected labour $X' — the money half is absent for a captain. Sticky bottom bar (owner): 'PUBLISH THE WEEK' with the unpublished count.

**Every tap target**

- A day pill with a booking → half sheet: 'Crew-day sheet (booked)'
- A day pill reading 'Avail' → half sheet: 'Crew-day sheet (available)' which is the booking entry point
- A day pill showing leave → half sheet: 'Time off — request detail' for that worker/crew
- The crew name/colour dot → full screen: 'Crew detail'
- The member count → half sheet: 'Crew members' (roster of who is in it, tap a face for their week load)
- The week range → half sheet: month picker, jump to any week
- ‹ / › → paginates the week in place, no navigation
- 'This week' → resets weekOffset to 0
- Segmented control at the top (Crews | Days) → switches to the day-first mode of the same screen, same data, no navigation
- The job-code legend chip in the footer → half sheet: 'Job legend'
- 'PUBLISH THE WEEK' → half sheet: 'Publish the week'
- A red-cornered clash pill → half sheet: 'Clash detail'
- Long-press a pill with a booking → half sheet with Move / Pull off / Edit, skipping the read step

**States** — EMPTY (no crews at all): a full-card explanation — 'A crew is the unit that actually goes to a job. Two tilers and a labourer, booked as one thing. Make one and you can book a whole week in a few taps.' with a 'MAKE A CREW' button (owner) or 'Nobody has set up crews yet — the office does that' (captain). EMPTY (crews exist, nothing booked this week): all pills read 'Avail', and a single line above the list — 'Nothing booked this week. Every crew is free.' — which is information, not an error. ONE ITEM (one crew): the single card renders full width with no list chrome and the summary line reads 'Your only crew' rather than a count. LOADING: the crew cards render immediately from cache with their names and colours; the pill strips are grey 44px placeholders that fill in — never a blank screen, because crew names change far less often than bookings. ERROR: an inline red strip above the list carrying the PostgREST message verbatim plus 'Pull down to try again'; the last-loaded week stays on screen underneath rather than being cleared. OFFLINE: a thin amber strip under the header — 'Offline — showing last loaded 10 Aug, 6:42am'. Every pill becomes non-tappable for booking; tapping one opens the read sheet with its actions disabled and the line 'You need signal to change a booking.' Nothing about the roster is queued for later write — see the offline note on the booking sheet.

---

## Diary — day-first mode (the second half of the grid answer)

**full screen**

**Reached by** — The Crews | Days segmented control on the Diary screen. Same route, same week, same data — a mode, not a separate destination.

**Roles** — Same as the crew-first mode. OWNER can book; CAPTAIN reads.

A vertical list of the seven days as sticky section headers ('MON 10 AUG', today highlighted in accent). Under each day, one row per crew: crews.colour dot, crews.name, then either the job_sites.name + '7–3' from assignments.starts_at/ends_at, or 'Available' in inkFaint, or 'Leave — Jack B' from time_off_requests. Rows are 56px, full width, no truncation of the job name — which is the entire reason this mode exists. A day with nothing booked collapses to a single line: 'Nothing on — 4 crews free'. Under each day, a final row 'Unallocated: Lot 42 starts today' when a job's site_programme_v.our_start equals that date and no assignments row for that site exists on it.

**Every tap target**

- A crew row with a booking → half sheet: 'Crew-day sheet (booked)'
- A crew row reading 'Available' → half sheet: 'Crew-day sheet (available)'
- A day header → collapses/expands that day in place
- The 'Unallocated' row → half sheet: 'Clash detail' in its gap variant
- Segmented control → back to crew-first

**States** — EMPTY: 'Nothing booked between Mon 10 and Sun 16.' plus the same 'MAKE A CREW' or 'the office books the week' line. LOADING: seven day headers render with a single shimmer row each. ERROR / OFFLINE: identical treatment to the crew-first mode — same fetch, same strip.

---

## Grid design note — the rejected option, and why

**inline**

**Reached by** — Not a screen. Recorded here so the decision is not relitigated in the redesign.

**Roles** — n/a

OPTION C, REJECTED: the literal drawing — a frozen 104px crew rail on the left and horizontally-scrolling 96px day columns, three days visible at 390px, snap-scrolled. It is the closest thing to what the client sketched and it is what the desktop Schedule.tsx does (gridTemplateColumns '186px repeat(7,minmax(0,1fr))', minWidth 900, overflowX auto). It is rejected on the phone for three reasons: the brief's own rule forbids horizontal scroll and tables; a frozen rail plus a scroll container inside a vertically-scrolling page is the single most common place a touch gesture is captured by the wrong axis; and at 96px a job name truncates to 'Kensin…', which means the grid no longer answers the question it exists to answer. RECOMMENDATION: ship the crew-first pill strip as the default — it keeps the client's two axes (crews down, days across), shows all seven days, has 44px targets, and never scrolls sideways — with the day-first list as a one-tap mode for the 'what's on Tuesday' question. Colour is per JOB (a deterministic hue off job_sites.id, as siteTint already does) and not per crew, because the question a pill has to answer is 'which job', and crews.colour is then free to identify the crew itself in its card header — the column exists (schema_v18) and nothing in the app reads it today.

**States** — n/a

---

## Job legend

**half sheet**

**Reached by** — Tapping the legend chip in the Diary footer, or the '?' beside the first 3-character job code a user meets.

**Roles** — All three, identically. It names jobs, not money.

One row per job_sites row that appears anywhere in the visible week: the colour swatch, the 3-character code the grid uses, job_sites.name, job_sites.address, and job_sites.status ('active' / 'starting soon' / 'archived') as a chip. Ordered by how many pills that job holds this week.

**Every tap target**

- A row → full screen: that job's overview (leaves the Diary context; the tab bar changes to the job's tabs)
- The swatch → nothing; it is a legend

**States** — EMPTY: cannot be empty — the sheet is only reachable when at least one job is on the board. ONE ITEM: renders as a single row with the line 'Only one job has anyone on it this week.' LOADING: instant, the data is already in memory from the grid. ERROR: n/a — no fetch of its own. OFFLINE: fine, no fetch.

---

## Crew-day sheet — booked

**half sheet**

**Reached by** — Tapping a day pill that holds a booking, on either Diary mode; or from a job's 'Who's on' row.

**Roles** — OWNER: all three actions live. CAPTAIN: read-only body, action row replaced by one line — 'The office books crews. Ring them if this needs moving.' EMPLOYEE: never reaches it.

Title line: crews.name + ' · ' + full en-AU date ('Tue 11 Aug'). Then job_sites.name, job_sites.address, and the shift window from assignments.starts_at–ends_at rendered as '7:00am – 3:00pm', with the hours count. A published state chip: 'Published' or 'Draft — not sent to the crew' driven by assignments.published. Then the people: one row per assignments row sharing this crew_id and day, showing crew_v.initials, crew_v.name, crew_v.trade, and — where a shifts row exists for the same worker and date — the actual signed-on state ('On the clock since 7:04am' from shifts.started_at with ended_at null, or '8.8 hrs' from a closed pair). Anyone in crew_members without an assignments row for the day appears greyed at the bottom under 'Not booked this day' with the reason if one is knowable (an approved time_off_requests row overlapping the date). assignments.note, if set, in full underneath.

**Every tap target**

- 'MOVE' → half sheet: 'Move a booking'
- 'PULL THE CREW OFF' → half sheet: 'Pull the crew off — confirm'
- 'EDIT TIMES' → half sheet: 'Edit a booking'
- A person row → half sheet: 'Worker week load'
- The job name → full screen: that job (context switch, tab bar changes)
- The address → opens the phone's maps app (action)
- A greyed 'not booked' person → half sheet: their leave request, or 'Add them to this booking' (owner)

**States** — EMPTY: not reachable empty. ONE ITEM: a crew of one renders the person list as a single row and the title reads the person's name rather than a crew count. LOADING: the sheet opens instantly with what the grid already had (crew, job, times) and the per-person sign-on line fills in a beat later from shifts. ERROR: if the shifts read fails, the person rows simply omit the live line and a footnote reads 'Couldn't check who has signed on.' — the booking itself is still correct and still actionable. OFFLINE: the whole sheet renders from cache; the three action buttons are visibly disabled with 'Needs signal' beneath them.

---

## Crew-day sheet — available

**half sheet**

**Reached by** — Tapping a hollow 'Avail' pill.

**Roles** — OWNER only in any useful form. CAPTAIN sees the same body with the button replaced by 'Nothing booked. The office allocates crews.'

Title: crews.name + date. One line stating the fact plainly — 'Nobody in this crew has anything on Tuesday.' Then the useful context that turns a gap into a decision: the crew's hours so far this week (summed from assignments), each member's week load against workers.ordinary_hours (default 38) as a small bar, and — the part that earns the sheet — 'Jobs that could use them': job_sites rows where site_programme_v.our_start falls within the visible week and no assignments row exists for that site on this day, each with the days_until_start figure from the view.

**Every tap target**

- 'BOOK THIS CREW' → half sheet: 'Book a crew', pre-filled with this crew and this day
- A suggested job row → half sheet: 'Book a crew', pre-filled with this crew, this day and that job
- A member's load bar → half sheet: 'Worker week load'

**States** — EMPTY (no suggestions): the suggestion block is replaced by 'No job on the programme needs anyone that day.' — never an empty heading. LOADING: the fact line and hours are instant; the suggestions block shows two placeholder rows while site_programme_v is read. ERROR: suggestions block reads 'Couldn't read the programmes just now' and the BOOK button stays live, because booking does not depend on it. OFFLINE: button disabled, 'Needs signal to book.'

---

## Book a crew

**half sheet**

**Reached by** — 'BOOK THIS CREW' from an available pill; the '+' on the Diary header; or a job's 'Allocate a team' row once that job passes the readiness gate.

**Roles** — OWNER only. There is no captain path — assignments has no captain write policy, and a screen that lets them try would produce a silent zero-row write.

Four fields, thumb-sized, in the order a person thinks: CREW (a row of crew chips, each showing crews.name and its member count from crew_members; a chip with zero members is shown disabled with 'nobody in it yet'), JOB (a row showing the pre-filled job or 'Pick a job' → opens the picker), DAYS (a Mon–Sun toggle row so a crew can be booked Mon–Wed in one action rather than three; this is the single biggest improvement over the desktop screen, which books one day at a time), and TIMES (two large time fields defaulting to 07:00 and 15:00 — the defaults already in Schedule.tsx). Below: an optional NOTE, one line, writing assignments.note. A live consequence line above the button, computed before anything is written: 'Books 3 people × 3 days = 9 shifts. Kel is already on Kensington Wednesday and will be left alone.' The button reads 'BOOK THE CREW' and states that this saves as a DRAFT — assignments.published = false — and that nobody is told until the week is published.

**Every tap target**

- A crew chip → selects it, recomputes the consequence line
- 'Pick a job' → half sheet: 'Job picker'
- A day toggle → toggles, recomputes
- A time field → the platform time picker (action)
- 'BOOK THE CREW' → writes, dismisses to the grid with the new pills animating in
- 'Cancel' / the grabber → dismisses, writes nothing

**States** — EMPTY (crew has no members): the button is disabled and the line reads 'That crew has nobody in it yet — add people on the Crew screen.' matching the message the desktop already gives. EMPTY (no jobs): 'No job sites yet' in the job field, button disabled. LOADING: not applicable on open (all data is already resident); the button shows 'BOOKING…' during the write. ERROR: the write is a multi-row insert into assignments; on failure the sheet stays open with the message inline and nothing partially applied is claimed. PARTIAL SUCCESS is a real outcome and gets its own treatment — see the next screen. OFFLINE: the sheet can be opened and filled but the button is disabled with 'You'll need signal to book. Nothing is lost — this stays filled in.' A booking is NOT queued to an outbox: the roster is a shared document that other people act on, and a booking that lands two hours later when someone has already been sent elsewhere is worse than one that never landed. This is a deliberate difference from photos and time-off, which do queue.

---

## Booking result — partial

**half sheet**

**Reached by** — Automatically, after 'BOOK THE CREW' when some members were skipped.

**Roles** — OWNER only.

Plain sentence of what actually happened: 'Booked 2 of 4. Kel and Sam already had something on Tuesday and were left alone.' Then a row per skipped person: crew_v.name, and what they were already on (job_sites.name and times from their existing assignments row) or the leave that blocked them. Two choices: leave it, or book the skipped people anyway, which knowingly creates a double-booking. The second is a real option — a database exclusion constraint exists on shifts (schema_v8 shifts_no_overlap) but NOT on assignments, so overlapping bookings are possible and the office sometimes means them (a half-day on each of two jobs). The button therefore reads 'BOOK THEM ANYWAY — they'll be on two jobs' and the resulting pills carry the clash marker.

**Every tap target**

- 'THAT'S FINE' → dismisses to the grid
- 'BOOK THEM ANYWAY' → second insert, then dismisses; the affected pills render with the clash corner
- A skipped person's row → half sheet: their existing booking

**States** — Not reachable empty. LOADING: n/a — the result is already known. ERROR: only if the 'book them anyway' write fails; message inline. OFFLINE: unreachable, since it only follows a successful write.

---

## Move a booking

**half sheet**

**Reached by** — 'MOVE' on the crew-day sheet, or long-press a pill.

**Roles** — OWNER only.

'Move the wet area crew off Tuesday.' Two destinations offered as tabs: ANOTHER DAY (a Mon–Sun row within the visible week, plus 'next week') and ANOTHER JOB (same day, different job_sites row). Whichever is chosen, the sheet restates the move in words before it commits — 'Wet area crew: Lot 42 Tuesday → Lot 42 Thursday. 3 people, 3 assignments rows updated.' Because a crew booking is N rows sharing crew_id, the move updates every row carrying that crew_id for that starts_at date, and the sheet says so: 'All three move together.' A warning appears when the destination already holds a booking for any of them. A second warning appears when the row being moved has published = true: 'This week is already published. Moving it does not send anyone a new notice — the app has no way to tell them. Ring them.' — which is the plain truth given notify_roster_published only fires on the false→true transition of the published flag.

**Every tap target**

- A day chip → selects the destination day
- 'Another job' tab → job picker
- 'MOVE IT' → updates the assignments rows and dismisses
- 'Cancel' → dismisses

**States** — LOADING: 'MOVING…' on the button. ERROR: inline, sheet stays open, original booking untouched. OFFLINE: button disabled with 'Needs signal'. EMPTY: n/a.

---

## Pull the crew off — confirm

**half sheet**

**Reached by** — 'PULL THE CREW OFF' on the crew-day sheet.

**Roles** — OWNER only.

A destructive confirmation that names exactly what disappears: 'Take the wet area crew off Lot 42 on Tuesday? That removes 3 bookings — Dave, Kel, Sam.' If the rows are published = true it adds: 'They have already been told they are on. Nothing tells them it is off — ring them.' If any of the three has already signed on that day (a shifts row exists with started_at on the date), a stronger line: 'Dave signed on at Lot 42 at 7:04am today. Removing the booking does not touch his hours — his timesheet stands.' This distinction matters and must be drawn: assignments and shifts are unrelated tables, and deleting a booking never deletes worked time. The action deletes every assignments row sharing this crew_id and date; a single-person removal is on the edit sheet instead.

**Every tap target**

- 'PULL THEM OFF' (destructive, alert red) → deletes and dismisses
- 'Keep it' → dismisses
- A named person → half sheet: that person's day, in case only one should come off

**States** — LOADING: button reads 'REMOVING…'. ERROR: inline; nothing removed. OFFLINE: disabled with 'Needs signal'. EMPTY: n/a.

---

## Edit one person's booking

**half sheet**

**Reached by** — 'EDIT TIMES' on the crew-day sheet, or tapping one person inside it and choosing 'Just this person'.

**Roles** — OWNER only.

The single-assignment editor: worker name (fixed — moving a booking to a different person is a delete plus a book, and the sheet says so), job_sites picker, start and end time (assignments.starts_at / ends_at), and assignments.note. A footer line shows what the change does to that person's week total against workers.ordinary_hours: '38.0 → 42.0 hrs. Four hours over their ordinary week.' Owner-only extension of that line, since it needs workers.rate: nothing — rate is never shown here even to an owner, because this screen is about time; the cost consequence lives on the Diary footer.

**Every tap target**

- Job field → job picker sheet
- Time fields → platform time picker
- 'SAVE' → updates the single assignments row
- 'Remove just this person' (ghost, alert) → deletes the one row after a confirm line, leaving the rest of the crew booked
- 'Cancel' → dismisses

**States** — LOADING: 'SAVING…'. ERROR: inline, keeps the form. VALIDATION: 'End time has to be after the start time' — the schema's own check (ends_at > starts_at) restated before it fires. OFFLINE: disabled. EMPTY: n/a.

---

## Publish the week

**half sheet**

**Reached by** — 'PUBLISH THE WEEK' on the Diary, or the unpublished badge.

**Roles** — OWNER only.

'Send this week to the crew.' Then the count, honestly composed: 'N shifts, M people, week of 10 Aug.' A list of the people who will get a notice, with what each of them will see — the notification body is generated by the notify_roster_published trigger as job name plus 'Dy DD Mon, HH12:MIam' in Australia/Adelaide, so the sheet can preview the actual first line each person receives. Then the single most important sentence on this screen, carried over verbatim in spirit from the desktop: 'The notice is in-app only. Nobody is texted or emailed. Someone who does not open the app will not know.' There is no push transport in this product and the design must not imply one. Below that, what publishing does not do: it does not arm a geofence (api/ping.ts never reads assignments) and it does not lock anything. Note for the build: the trigger fires only on an UPDATE that flips published false→true, so publishing must remain a separate step from booking — a row inserted already-published notifies nobody.

**Every tap target**

- 'PUBLISH' → updates every unpublished assignments row in the week range, dismisses, pills go from dashed to solid
- A person's preview row → half sheet: their week as they will see it
- 'Not yet' → dismisses

**States** — EMPTY (nothing unpublished): the button is absent and the sheet reads 'This week is fully published.' or, when there is nothing at all, 'Nothing scheduled this week yet.' — both sentences already exist in the desktop and are honest. LOADING: 'PUBLISHING…'. ERROR: inline; the sheet reports how many rows were affected rather than claiming success. OFFLINE: disabled with 'Needs signal — nobody would get the notice anyway.'

---

## Needs attention — clashes and gaps

**full screen**

**Reached by** — The amber count chip in the Diary header ('3 to look at'), or the dashboard's 'Projects requiring attention' counter.

**Roles** — OWNER: the full list. CAPTAIN: only rows touching a job they run (job_sites.captain_id = them, or a crew they captain is booked on) — which is exactly what captains_site() already scopes, and none of the rows carry money. EMPLOYEE: not reachable.

Four sections, each computed, none of them a stored flag. (1) DOUBLE-BOOKED — a worker with two assignments rows whose starts_at fall on the same day, or whose ranges overlap. Each row: the person, the two jobs, the two windows. Worth stating in the design that the database does not prevent this: schema_v8's exclusion constraint is on shifts, not assignments. (2) BOOKED WHILE ON LEAVE — an assignments row whose date falls inside an approved time_off_requests range (status='approved', starts_on..ends_on) for the same worker_id. (3) NOBODY ON A JOB THAT STARTS — job_sites rows where site_programme_v.our_start is inside the next 14 days and no assignments row exists for that site in the week containing our_start; shows days_until_start and site_programme_v.ready. This is the client's 'a job with nobody allocated the week it is due to start'. (4) CREW WITH NOTHING ON — crews with zero assignments rows in the visible week, with the member count and each member's week hours, so 'idle' is visible before payroll makes it obvious. Each section header carries its count; a section with zero is drawn as a single satisfied line ('No one is double-booked.') rather than being hidden, so the absence of a problem is itself readable.

**Every tap target**

- A double-booking row → half sheet: 'Clash detail'
- A leave clash row → half sheet: 'Clash detail' (leave variant)
- An unallocated job row → half sheet: 'Book a crew' pre-filled with that job and the start date
- An idle crew row → half sheet: 'Crew-day sheet (available)' for the first free day
- A section header → collapses the section

**States** — EMPTY (nothing wrong): the whole screen is four green satisfied lines plus 'Nothing needs sorting this week.' — not a blank screen, because the point of opening it is reassurance. ONE ITEM: the single row renders with its section header intact so a person can tell which of the four kinds it is. LOADING: section headers with counts render first from the assignments already in memory; sections 3 and 4 fill in after site_programme_v resolves. ERROR: a failed programme read collapses section 3 to 'Couldn't check which jobs start soon.' and leaves the other three working. OFFLINE: computed entirely from cached assignments for sections 1, 2 and 4; section 3 shows the offline note. Read-only screen, writes nothing.

---

## Clash detail

**half sheet**

**Reached by** — A row on 'Needs attention', or a red-cornered pill on the Diary.

**Roles** — OWNER acts. CAPTAIN reads, with the actions replaced by 'The office sorts bookings.'

DOUBLE-BOOKED VARIANT: the person's name and initials, then the two bookings side by side vertically — job_sites.name, address, assignments.starts_at–ends_at, published state, and which crew_id put them there. A line stating the consequence in the crew's language: 'Dave is on two jobs on Tuesday. Whichever he drives to, the other job is a person short.' LEAVE VARIANT: the booking on one side, the approved time_off_requests row on the other (kind, starts_on, ends_on, reason), and 'Sam's leave was approved on 2 Aug. He is booked on Lot 42 that Thursday.' GAP VARIANT: the job, site_programme_v.our_start / our_task / days_until_start / ready / blocked_by, and 'Nobody is booked the week this starts.'

**Every tap target**

- 'Take him off Kensington' → the pull-off confirm for that one row
- 'Take him off Lot 42' → the same for the other
- 'Leave it — he's doing both' → dismisses and marks nothing (there is no dismissed/acknowledged column; the sheet says so rather than pretending the warning goes away)
- 'BOOK SOMEONE' (gap variant) → 'Book a crew' pre-filled
- The job name → the job (context switch)

**States** — LOADING: instant from data already held. ERROR: only on the corrective write, shown inline. OFFLINE: read fine, actions disabled. EMPTY: n/a.

---

## Crew — the list of crews

**full screen**

**Reached by** — Third tab of the company-level tab bar; or the crew name on any Diary card.

**Roles** — OWNER: full, with 'NEW CREW'. CAPTAIN: reads the list (crews and crew_members are company-read), no create/edit. Their own crew is first and marked 'Yours'. EMPLOYEE: sees only the crew they belong to, as a single card, and the screen is titled 'My crew'.

One card per crews row where active = true: crews.colour dot, crews.name, the captain's name from crews.captain_id resolved through crew_v, the member count from crew_members, and this week's booked days as a compact 7-dot strip. Under the list, a 'NOT IN A CREW' section listing crew_v rows with no crew_members row — crew_v.name, crew_v.trade, crew_v.role — because a person who belongs to nothing is invisible on a crew-first grid and that is how someone gets forgotten. Inactive crews (active = false) sit behind a 'Show past crews' disclosure.

**Every tap target**

- A crew card → full screen: 'Crew detail'
- 'NEW CREW' (owner) → half sheet: 'New crew'
- A person in the 'not in a crew' section → half sheet: 'Worker week load', with 'Add to a crew' (owner)
- 'Show past crews' → expands in place

**States** — EMPTY: the explanation card described on the Diary — what a crew is and why naming one matters (it is also what gives a captain the run of a job, since captains_site() reaches through crews.captain_id). LOADING: three placeholder cards. ONE ITEM: renders full width with 'Your only crew' and, for an owner, a prompt that a second crew is what makes the booking grid worth having. ERROR: inline strip with the message and a retry. OFFLINE: the list renders from cache; 'NEW CREW' disabled.

---

## Crew detail

**full screen**

**Reached by** — Tapping a crew card, or a crew name anywhere on the Diary.

**Roles** — OWNER: everything editable. CAPTAIN: reads; if it is their own crew, a line explains what being captain gives them — their scope follows the crew onto whatever job it is booked on. EMPLOYEE: reads their own crew's people and this week only.

Header: crews.colour, crews.name, crews.note, active state. Then THE PEOPLE — one row per crew_members row, resolved through crew_v: initials, name, trade, role ('captain' badge where crew_v.id = crews.captain_id), and this week's hours from assignments. Note crew_members has no role column of its own, so 'captain' is the only distinction the data supports and the design must not imply seniority beyond it. Then THIS WEEK — the crew's seven pills, same component as the Diary card. Then WHERE THEY'VE BEEN — the last 14 days of assignments grouped by job. Then, owner only, a plain-language box: 'Dave can run whichever job this crew is booked on — variations, materials, the daily log, and approving the crew's hours. Not pay rates, invoices or contract sums.' That sentence is the RLS made readable and it should survive the redesign verbatim.

**Every tap target**

- A person row → half sheet: 'Worker week load'
- 'ADD PEOPLE' (owner) → half sheet: 'Crew members picker'
- The captain badge / 'Set a captain' (owner) → half sheet: 'Captain picker'
- 'BOOK THIS CREW' (owner) → 'Book a crew' pre-filled
- Edit name/colour/note (owner) → half sheet: 'Edit crew'
- 'Retire this crew' (owner, ghost, at the bottom) → confirm sheet; sets crews.active = false and explains that past bookings keep their crew_id and nothing historical changes
- A past job row → the job (context switch)

**States** — EMPTY (crew with no members): the people section reads 'Nobody in this crew yet. A crew with nobody in it cannot be booked — the grid will show it, greyed.' with 'ADD PEOPLE'. LOADING: header instant, people and week fill in. ERROR: inline. OFFLINE: reads from cache, all edit affordances disabled with a single note at the top rather than one per button.

---

## New crew / Edit crew

**half sheet**

**Reached by** — 'NEW CREW' on the Crew list, or 'Edit' on Crew detail.

**Roles** — OWNER only.

Three fields: NAME (crews.name, placeholder 'Wet area crew' — the placeholder the desktop already uses), COLOUR (a row of swatches writing crews.colour; free text in the schema, so the palette can change without a migration), and CAPTAIN (a picker writing crews.captain_id, defaulting to 'Nobody'). Below the captain field, the consequence stated before it is chosen: 'Whoever you name gets the run of every job this crew is booked on. Not the money on it.' NOTE (crews.note) optional, one line.

**Every tap target**

- A colour swatch → selects
- 'Captain' → half sheet: 'Captain picker' (stacked, or inline expansion — do not stack three sheets deep; expand inline)
- 'CREATE' / 'SAVE' → writes and dismisses
- 'Cancel' → dismisses

**States** — VALIDATION: the button is disabled until the name is non-blank. LOADING: 'SAVING…'. ERROR: inline. OFFLINE: disabled. EMPTY: n/a.

---

## Crew members picker

**half sheet**

**Reached by** — 'ADD PEOPLE' on Crew detail; also from the member-count chip on a Diary card (read-only there).

**Roles** — OWNER writes. CAPTAIN and EMPLOYEE see the same list read-only when they arrive from the member count.

Every active person from crew_v (name, initials, trade, role) as a toggle chip — the same chip pattern the desktop uses. A person already in another crew shows that crew's name and colour under their name; this is allowed (crew_members is keyed on crew_id + worker_id, so someone can be in two crews) and the sheet says so rather than blocking it: 'Already in the wet area crew. Being in two is allowed — the grid will show them on both.' A person on approved leave for the coming week carries a small leave glyph. workers.rate is nowhere on this sheet for anyone, ever — the phone reads crew_v, which does not carry it.

**Every tap target**

- A person chip → toggles, writing or deleting a crew_members row immediately (no save step; it is a membership, not a form)
- 'Done' / the grabber → dismisses

**States** — EMPTY (no other workers): 'Everyone on the books is already in this crew.' or, for a brand-new company, 'Nobody on the books yet — the office adds people on the Crew screen.' LOADING: chips render as grey pills. ERROR: the toggle reverts visually and an inline line explains; a failed membership write must never leave a chip looking on. OFFLINE: chips are non-interactive with a single note; membership is not queued.

---

## Captain picker

**half sheet**

**Reached by** — The captain field on New/Edit crew, or 'Set a captain' on Crew detail.

**Roles** — OWNER only.

A list of crew_v rows with their current role ('owner' / 'captain' / 'employee'). Choosing someone whose workers.role is still 'employee' shows the consequence explicitly before it commits: 'Kel is an employee. Making them captain of this crew lets them see and run every job this crew lands on — the variations, materials, defects, daily log, and approving their crew's hours. It does not show them pay, invoices or contract sums.' Promoting is a deliberate act, which matches the schema's own comment: unticking a box makes someone an employee, never a captain, and only a deliberate change makes one.

**Every tap target**

- A person row → selects, shows the consequence line, arms the confirm
- 'MAKE THEM CAPTAIN' → sets crews.captain_id, and (owner's choice, presented as a checked line) also sets workers.role = 'captain' if they were an employee
- 'Nobody' → clears crews.captain_id
- 'Cancel' → dismisses

**States** — EMPTY: cannot be empty while the company has one worker. LOADING: instant. ERROR: inline. OFFLINE: disabled.

---

## Worker week load

**half sheet**

**Reached by** — Tapping a person anywhere in this domain — a crew-day sheet, Crew detail, the 'not in a crew' list, a clash row.

**Roles** — OWNER: everything below. CAPTAIN: the same screen minus nothing, because nothing on it is money — hours are not a rate. EMPLOYEE: reaches only their own, from 'My week'.

crew_v.name, initials, trade, role. Then the week as seven small day rows: for each, what they are booked on (job_sites.name from assignments) and, where it exists, what they actually did (shifts.started_at / ended_at less shifts.break_minutes). Booked-versus-worked side by side is the point: a person booked 8 and on the clock 5.5 is a conversation. Totals: booked hours this week, worked hours this week, and workers.ordinary_hours (default 38, per person, not a hardcoded 38/40) as the line they are measured against, with an amber state over ordinary and a red state well over. Then any time_off_requests rows overlapping the week with their status. Explicitly ABSENT for every role: workers.rate and any dollar figure. The desktop's 'Projected labour $X' belongs on the owner's Diary footer, not on a person.

**Every tap target**

- A day row with a booking → the crew-day sheet
- A day row with worked time → the shift detail (Time domain)
- 'Book them' (owner) → 'Book a crew' pre-filled with the crew they are in
- A leave row → 'Time off — request detail'

**States** — EMPTY (nothing booked, nothing worked): 'Nothing booked and nothing worked this week.' plus their ordinary hours for context. LOADING: the identity line is instant; the seven days shimmer. ERROR: if shifts fails, the worked column reads '—' with a footnote; booked still shows. OFFLINE: from cache, with the stale-time note.

---

## My week — the individual's roster

**full screen**

**Reached by** — EMPLOYEE: the 'My week' tab in the personal tab bar, and the primary destination of a roster_published notification. CAPTAIN and OWNER: the same screen from their account sheet, showing their own bookings.

**Roles** — All three see only themselves: the query is assignments where worker_id = me and published = true. An unpublished booking is invisible by design — 'nobody sees a draft roster' — and the screen must never hint that something exists but is hidden.

Sections by day, next 21 days (the window the app already uses), each headed 'Today', 'Tomorrow', or 'Thu 13 Aug'. Under each: job_sites.name, job_sites.address, the window from assignments.starts_at–ends_at, assignments.note in full, and — the thing a tiler actually wants at 6am — who else is on with them, resolved from the other assignments rows sharing crew_id and date through crew_v (names and trades only). Today's card carries the live state from shifts: 'On the clock since 7:04am' or 'Not signed on yet'. Any approved time_off_requests day is drawn as its own day card reading 'Annual leave — approved', so leave and work sit on one timeline. At the top, a single sentence answering the most-asked question: 'You're on Lot 42 tomorrow, 7am.'

**Every tap target**

- A day card → half sheet: 'My day'
- The address → the phone's maps app (action)
- The job name → the job's crew-facing screens (context switch; a captain gets the job's full tabs, an employee gets the reduced set)
- 'Ask for time off' (footer row) → full screen: 'Time off'
- A colleague's name → nothing (deliberately inert — an employee has no business opening a colleague's record)

**States** — EMPTY: 'Nothing published for the next three weeks. Your foreman publishes the roster from the office and it shows up here.' — already the app's wording and already correct. ONE ITEM: a single day card fills the screen with the summary sentence above it; no list chrome. LOADING: 'Loading…' replaced by two placeholder day cards. ERROR: inline strip, with the last cached week left visible. OFFLINE: renders entirely from cache with a strip reading 'Offline — as at 6:42am today'; this screen writes nothing, so nothing queues.

---

## My day

**half sheet**

**Reached by** — Tapping a day card on 'My week'.

**Roles** — All three, for themselves.

Date, job_sites.name, address, the booked window, assignments.note, and the crew on with them. Then, from site_programme_v for that job: 'We're on 12–19 Aug', and, when ready = false, the plain warning 'The job may not be ready — waiting on: screed, plumbing rough-in' from blocked_by. That warning is the single most valuable thing this sheet can carry for a person about to drive an hour. Below it, today-only: the live shift state and a 'Sign on' affordance if the geofence has not already done it (the server owns the clock; the sheet must not imply the phone decided anything).

**Every tap target**

- 'Get directions' → maps (action)
- 'Can't make it' → full screen: 'Time off', pre-filled with that date and kind = 'personal'
- 'The job's not ready' → opens the job's daily log / message thread (other domain) pre-filled with the date
- The job name → the job

**States** — EMPTY: n/a. LOADING: the booking is instant; the programme readiness line arrives a beat later and is absent, not falsely green, until it does. ERROR: readiness line reads 'Couldn't check the programme.' OFFLINE: booking from cache; readiness line hidden with the same note.

---

## Notices — the roster published notification and the inbox

**full screen**

**Reached by** — The bell / banner at the top of the app; the OS notification, once a transport exists.

**Roles** — EMPLOYEE and CAPTAIN: rows where notifications.worker_id = them. OWNER: those plus rows where worker_id is null, which is how the triggers address the office (timeoff_requested, correction_raised).

A list of notifications rows: kind, title, body, created_at, read_at. The kinds this domain produces are 'roster_published' ('You are rostered on' / 'Lot 42 — Tue 11 Aug, 7:00am', generated in Australia/Adelaide by the trigger), 'leave_decided' ('Time off approved' / '11 Aug – 15 Aug'), and 'timeoff_requested' ('Jack asked for time off'), which goes to the office. Unread rows carry a dot; tapping marks read_at. notifications.link_nav carries where to go and today holds 'Schedule', 'Crew' or 'Timesheets' — the phone must map those to its own destinations rather than showing the raw value. A standing line at the bottom of the roster_published group, because it is true and people plan around it: 'These notices only appear in the app. Nothing is texted or emailed.'

**Every tap target**

- A roster_published row → 'My week', scrolled to that day
- A leave_decided row → 'Time off — request detail'
- A timeoff_requested row (owner) → 'Time off — inbox'
- 'Mark all read' → updates read_at on the visible rows

**States** — EMPTY: 'Nothing new. Rosters, leave decisions and punch corrections land here.' LOADING: three placeholder rows. ONE ITEM: renders plainly, no grouping headers. ERROR: inline. OFFLINE: shows cached rows; marking read is the one write in this domain that SHOULD queue locally and reconcile, because it is idempotent and losing it costs nothing.

---

## Notification permission prompt

**half sheet**

**Reached by** — Once, after the first roster_published notice arrives while the app is open; never on first launch.

**Roles** — All three.

An explanation before the OS prompt, so a refusal is informed: 'Your roster changed. Right now the only way to find out is to open the app — there is no text message and no email. Turn on notifications and the phone will tell you when the week is published or your leave is decided.' Two lines on what will and will not be sent: roster published, leave decided, punch correction decided; never location, never marketing. A note that this is the app's only outbound channel, which is the current honest position.

**Every tap target**

- 'TURN THEM ON' → triggers the OS permission dialog (action)
- 'Not now' → dismisses; re-offered at most once more, from the notices screen

**States** — DENIED PREVIOUSLY: the sheet is replaced by a row on the notices screen — 'Notifications are off for Crewline. Turn them on in Settings.' with a deep link (action). LOADING / ERROR / OFFLINE: n/a — no network involved.

---

## Time off — my requests

**full screen**

**Reached by** — 'Ask for time off' on My week; the account sheet; a 'Can't make it' tap on My day.

**Roles** — EMPLOYEE and CAPTAIN: their own requests, and the ability to raise one — time_off_self_insert allows an insert where worker_id = me and status = 'pending'. A CAPTAIN cannot decide anyone's leave: the guard trigger and the office-write policy are both current_is_office(), so a captain's Approve would fail. There must be no decision affordance on a captain's screen anywhere. OWNER: reaches this for their own, and the inbox for everyone else's.

Top: the form — FIRST DAY and LAST DAY (time_off_requests.starts_on / ends_on, defaulting to today), TYPE (kind: annual / personal / unpaid / other, labelled 'Annual leave', 'Personal / sick', 'Unpaid', 'Other'), REASON (optional, time_off_requests.reason). Under it a consequence line computed from assignments: 'You are booked on Lot 42 on the 12th and 13th. The office will need to cover those.' — which no existing screen shows and which is the difference between a request and a surprise. Button: 'REQUEST TIME OFF'. Below: YOUR REQUESTS — the last twelve rows, each showing the date range and a status chip: pending → 'Waiting on the office', approved → 'Approved', declined → 'Declined', cancelled → 'Withdrawn'. time_off_requests.hours is nullable and null means 'the whole of those days'; the form does not ask for hours and the design should say 'whole days' rather than leave it ambiguous.

**Every tap target**

- Date fields → platform date pickers (action)
- Type → a segmented row, not a dropdown
- 'REQUEST TIME OFF' → inserts and clears the reason field
- A request row → half sheet: 'Time off — request detail'
- A pending row's 'Withdraw' → sets status = 'cancelled' (the only status change a worker is permitted)

**States** — EMPTY (no past requests): the YOUR REQUESTS section reads 'You have not asked for any time off through the app yet.' rather than being hidden — its absence otherwise reads as a bug. VALIDATION: 'The last day cannot be before the first day.' — restating the schema's own check before it fires. LOADING: the form is instant, the list shows two placeholders. ERROR: inline banner above the button with the message; the form keeps its values. OFFLINE: this is the one write in this domain that SHOULD queue. A leave request is personal, additive, and harmless if it lands twenty minutes late — unlike a booking. The button stays live, the row appears in the list immediately with a 'Waiting to send' chip, and the offline strip reads 'Offline — 1 request will send'. On reconnect it inserts and the chip becomes 'Waiting on the office'.

---

## Time off — request detail

**half sheet**

**Reached by** — A row on 'My requests'; a leave_decided notification; a hatched leave pill on the Diary (owner/captain); a leave clash row.

**Roles** — EMPLOYEE/CAPTAIN viewing their own: read plus withdraw. OWNER viewing someone else's: read plus decide, which is the next screen's action set surfaced here.

time_off_requests: worker name (from crew_v), kind, starts_on – ends_on rendered en-AU, the working days that spans, hours if set ('or the whole of those days' if null), reason, status, and — when decided — decided_at, decision_note, and the decider's name from decided_by. Under it, the roster consequence: any assignments rows for that worker inside the range, each with the job and date, and whether they are published. If any exist and the request is approved, a clear line: 'Still booked on Lot 42 on the 12th. Approving leave does not remove a booking.' That is true — nothing in the schema links the two — and it is exactly the kind of quiet failure this screen should prevent.

**Every tap target**

- 'Withdraw' (own, pending only) → confirm, then status = 'cancelled'
- 'APPROVE' / 'DECLINE' (owner only) → half sheet: 'Time off — decision'
- A conflicting booking row → the crew-day sheet, so the cover can be arranged from here
- The person's name (owner) → 'Worker week load'

**States** — LOADING: instant from the list; the conflicting-bookings block fills in. ERROR: the bookings block collapses to 'Couldn't check the roster.' OFFLINE: read from cache; withdraw and decide disabled. EMPTY: n/a.

---

## Time off — inbox

**full screen**

**Reached by** — A timeoff_requested notification; a 'N waiting' chip on the Crew tab; the owner's dashboard.

**Roles** — OWNER ONLY. This screen must not exist in a captain's navigation at all — not greyed, absent — because the decision columns are guarded by a trigger that raises 'Only the office can decide a time off request'.

Pending requests first, oldest at the top: person, kind, date range, working days, reason, and how long it has been waiting (created_at). Each row carries its roster consequence inline — 'Booked on Lot 42 Tue–Wed' or 'Nothing booked' — so a decision can be made without opening anything. Under that, DECIDED — the last month, with status, decided_at and decider. A footer counter: 'N waiting, M decided this month.'

**Every tap target**

- A pending row → half sheet: 'Time off — decision'
- Swipe a pending row → quick Approve / Decline with a confirm line, no sheet
- A decided row → 'Time off — request detail'
- The person's name → 'Worker week load'

**States** — EMPTY: 'Nobody has asked for time off.' plus one line explaining that requests come in from the phone and land here, so an owner who has never seen one knows the path exists. ONE ITEM: single row, header still reads '1 waiting'. LOADING: placeholders. ERROR: inline. OFFLINE: reads cached; both decisions disabled with 'Needs signal — the person gets a notice the moment you decide.'

---

## Time off — decision

**half sheet**

**Reached by** — A pending row on the inbox, or 'APPROVE'/'DECLINE' on a request detail.

**Roles** — OWNER only.

Restates the request: person, kind, dates, reason. Then the two things the owner needs to decide with: the conflicting assignments rows inside the range, and how many other people already have approved leave overlapping those dates (a count from time_off_requests, so two tilers are not off in the same week by accident). A NOTE field writing time_off_requests.decision_note, offered on both paths and strongly encouraged on a decline. The consequence line: 'Jack gets a notice: "Time off approved — 11 Aug – 15 Aug". In the app only.' — matching the notify_leave_decided trigger's actual body. Approving sets status, decided_by and decided_at; the sheet does not claim to have cleared the bookings, because it has not.

**Every tap target**

- 'APPROVE' → writes and dismisses; if bookings conflict, chains straight into 'Pull the crew off' for those days rather than leaving the clash
- 'DECLINE' → writes and dismisses
- 'Cancel' → dismisses

**States** — LOADING: 'SAVING…'. ERROR: inline; the request stays pending. OFFLINE: both buttons disabled. EMPTY: n/a.

---

## Calendar — the whole business by week

**full screen**

**Reached by** — The date range on the Diary header; the dashboard's TODAY block; a 'Programme' row inside any job ('see this against everything else').

**Roles** — OWNER: every job. CAPTAIN: only jobs they run — programmes and programme_tasks are company-read, so a captain could technically see all, but the design scopes it to captains_site() jobs because a captain's calendar of other people's jobs is noise, not access. No money on this screen for anyone, so it needs no further role split. EMPLOYEE: not reachable; their calendar is 'My week'.

This is the client's 'programming future works once the contract is accepted', and it is built from the builder's programme rather than invented. A vertical list of WEEKS (six ahead, two behind), each headed 'Week of 10 Aug'. Under each week, one bar per job whose site_programme_v.our_start..our_end overlaps it: job_sites.name, the job's colour, our_task ('Tiling — wet areas'), the dates, and three signals read straight off the view — days_until_start, start_moved_days ('+9 days since Rev C' in warnInk when non-zero, which is the whole reason revisions are kept rather than overwritten), and ready (Yes / No / Unknown, where Unknown is honestly 'the programme names nothing we follow', never a green light). Under each bar, who is booked that week from assignments grouped by crew_id — or, in alert, 'Nobody booked'. A week with no job on it collapses to one line: 'Nothing programmed.' A top strip shows the source of truth: 'From the builders' programmes. Latest revision received 4 Aug.' from programmes.revision / received_on.

**Every tap target**

- A job bar → half sheet: 'Calendar — job week detail'
- The 'Nobody booked' line → 'Book a crew' pre-filled with that job and the Monday of that week
- A 'moved +9 days' chip → half sheet showing the task's starts_on against prev_starts_on
- A week header → collapses
- 'Jump to' in the header → month picker sheet

**States** — EMPTY (no programmes imported anywhere): the strongest empty state in this domain, because it explains the mechanism — 'Nothing here yet. This calendar is built from the builders' programmes. Import one on a job and its tiling dates appear here, with what moved since the last revision.' plus 'Which jobs have no programme? 4 of 6' as a tappable row. EMPTY (programmes exist but no line marked as ours): 'Four programmes are loaded but none has a line ticked as ours, so there is nothing to place. Open a job's programme and tick the tiling line.' LOADING: week headers render immediately from the date maths; bars fill in. ERROR: inline strip; the week skeleton stays. OFFLINE: renders from cache with the stale note. Read-only, writes nothing.

---

## Calendar — job week detail

**half sheet**

**Reached by** — A job bar on the calendar.

**Roles** — OWNER and CAPTAIN (own jobs). No money on it.

job_sites.name and address; from site_programme_v: our_task, our_start, our_end, our_status, our_pct, days_until_start, start_moved_days, prev_starts_on, ready, blockers_open, blocked_by, revision, received_on. Then who is on it that week from assignments grouped by crew_id, with each crew's days. Then the readiness summary as a single line with a chevron — 'Ready to allocate: 5 of 6' — linking to the checklist. When ready = false the blocked_by names sit in an alert note with the sentence that justifies the whole feature: 'Sending a crew before those are finished is a day's wages against a job that cannot be worked, and it never appears on an invoice.'

**Every tap target**

- 'BOOK A CREW' → 'Book a crew' pre-filled
- A crew row → the crew-day sheet
- 'Ready to allocate: 5 of 6' → full screen: 'Ready to allocate'
- 'See the programme' → the job's Programme tab (context switch)
- blocked_by names → the programme task list, scrolled to those lines

**States** — LOADING: identity instant, view fields fill. ERROR: 'Couldn't read the programme' with the booking half still usable. OFFLINE: cached, actions disabled. EMPTY: a job with a programme but no crew booked shows 'Nobody booked this week' as content, not as an empty state.

---

## Job → Programme tab

**full screen**

**Reached by** — Inside a job, the Programme row on the job overview (or a tab, depending on the final grouping — it is one of the client's nineteen and belongs behind the overview, not in the tab bar).

**Roles** — OWNER: read and import. CAPTAIN: read AND import — programmes and programme_tasks are the one place schema_v21 deliberately widened write access to captains_site(), because 'are we on next Tuesday' is asked from a ute. EMPLOYEE: read only (company-wide read), and in practice reaches it as the readiness line on 'My day'.

Top block, four facts from site_programme_v: WE'RE ON (our_start, 'through 19 Aug'), THAT'S IN (days_until_start, or 'N days ago'), MOVED (start_moved_days, 'No change' / '+9 days', with 'first revision' when prev is null), READY FOR US (Yes / No / Unknown, with blockers_open behind it). Then, when not ready, the blocked_by alert note. Then the task list from programme_tasks for the current programme: ref, name, trade, starts_on, ends_on, status, pct_complete, with 'ours' and 'we follow' flags visible on each row (is_ours, is_predecessor) and prev_starts_on shown as a struck-through date where it moved. Header carries programmes.revision, received_on and source ('from Rev C, received 4 Aug, read off the PDF').

**Every tap target**

- 'IMPORT THE PROGRAMME' / 'IMPORT A REVISION' → the file picker (action), then the review screen
- A task row → half sheet: 'Programme task'
- The revision chip → half sheet: 'Programme revisions'
- 'READY FOR US' fact → the readiness checklist
- The original file link → opens the stored site_files document (action)

**States** — EMPTY (no programme): 'Import the builder's programme and this answers when the crew is on, whether the job will be ready, and what moved since the last revision. Excel and CSV are read here on the phone; a PDF Gantt is read by the extractor.' EMPTY (programme, but no line marked ours with a date ahead): 'The current programme has no line marked as ours with a date still ahead. Tick the right line below and it will show here.' — both wordings already exist and are right. UNKNOWN READINESS: an amber note — 'Nothing on this programme is marked as a trade we follow, so readiness is unknown rather than clear. Tick "we follow" on the screed, rough-in or set-out lines.' LOADING: 'Loading…' then the fact grid. ERROR: inline red strip carrying the PostgREST message. OFFLINE: reads cached; import disabled ('Reading a programme needs signal').

---

## Programme import — review before it lands

**full screen**

**Reached by** — Automatically after a file is read — .xlsx/.xlsm/.csv parsed on the phone, .pdf sent to /api/parse-programme.

**Roles** — OWNER and CAPTAIN (own job).

'Check this before it lands.' The import note verbatim from the extractor ('Sheet 2: 41 rows read'). Then every parsed row as a tall card, not a table row — ref, name, starts_on, ends_on — each with two 44px toggles: OURS and WE FOLLOW (writing is_ours and is_predecessor; ticking OURS clears WE FOLLOW, as the desktop already does). The rows the extractor already guessed are pre-ticked and visually distinguished from ones a person ticked, so a wrong guess is findable. A running counter at the top: '2 marked ours, 5 we follow, 34 ignored.' The footer states what importing does: 'This becomes the current programme. The one from 4 Aug is kept as superseded, and any date that moved will be shown against it.' — which is exactly what the programmes_one_current trigger and programme_carry_previous() do.

**Every tap target**

- An OURS / WE FOLLOW toggle → toggles in the draft only; nothing is written until import
- A row → expands to show trade, duration_days, pct_complete
- 'IMPORT' → inserts the programmes row as status='current', inserts programme_tasks, then calls programme_carry_previous
- 'Discard' → drops the draft with a confirm, since a PDF parse is slow and expensive to redo

**States** — EMPTY (nothing dated could be read): 'Nothing dated could be read off that PDF. Ask for the Excel export, or enter the dates by hand.' with both paths offered. ERROR (PDF, no AI key — HTTP 501): 'Reading a PDF programme needs the AI key configured. Ask the builder for the Excel export, or enter the dates by hand.' ERROR (file too large, >24MB): 'That PDF is too large to read. Send the tiling pages on their own.' ERROR (wrong type): 'Send the programme as .xlsx, .csv or .pdf.' LOADING: 'READING…' on the button, with a note that a PDF takes a moment because the bars are being read off the timeline. PARTIAL FAILURE: if the programme row saves and the tasks insert fails, the exact message is 'The programme saved but its tasks failed' — never a generic error, because the two halves have different fixes. OFFLINE: unreachable; the import button is disabled upstream. A half-reviewed draft is discarded when the user switches jobs and the screen says so on the way out.

---

## Programme task

**half sheet**

**Reached by** — A task row on the Programme tab.

**Roles** — OWNER and CAPTAIN (own job) can edit; EMPLOYEE reads.

programme_tasks: ref, name, trade, starts_on, ends_on, duration_days, status (planned / in_progress / done / not_started / slipped), pct_complete, is_ours, is_predecessor, note. Where prev_starts_on / prev_ends_on exist and differ, both dates are shown with the delta in words: 'Was 3 Aug on Rev C. Nine days later now.' Two toggles, OURS and WE FOLLOW, with a line under each explaining what it changes: ticking OURS is what makes 'we're on' answerable; ticking WE FOLLOW is what makes readiness answerable, and untick everything and readiness reads Unknown, not Yes.

**Every tap target**

- OURS / WE FOLLOW toggles → immediate write to programme_tasks
- 'Mark done' → sets status = 'done', which is what clears a blocker on site_programme_v; the sheet says so: 'This is one of three we're waiting on. Marking it done moves the job to Ready.'
- 'Add a note' → inline field writing note
- The ref → nothing; it is the builder's own line number, shown so a phone call can quote it

**States** — LOADING: instant. ERROR: the toggle reverts and an inline line explains — a toggle that looks on but did not write is the exact failure schema_v13 was written to stop. OFFLINE: toggles disabled with one note at the top. EMPTY: n/a.

---

## Programme revisions

**half sheet**

**Reached by** — The revision chip on the Programme tab.

**Roles** — Same as the Programme tab.

Every programmes row for this site, newest first: revision, received_on, issued_on, source (pdf / excel / csv / manual), status (current / superseded / draft), imported_by resolved through crew_v, and import_note. The current one is marked. Under each superseded row, the one thing that matters: how many task dates changed against it, and by how much for our line. A row can open the original file through programmes.file_id / storage_path.

**Every tap target**

- A revision row → expands to show its our-line dates against the current
- 'Open the original' → opens the stored file (action)
- 'Make this the current one' (owner) → confirm sheet; setting status='current' supersedes the other by trigger, and the sheet says 'Rev C goes back to superseded automatically — there is only ever one current programme.'

**States** — EMPTY: unreachable — the chip only exists when a programme does. ONE ITEM: a single row reading 'First revision. Nothing to compare against yet.' LOADING: two placeholder rows. ERROR: inline. OFFLINE: cached, 'make current' disabled.

---

## Ready to allocate — the readiness checklist

**full screen**

**Reached by** — The 'Ready to allocate: 5 of 6' row on a job's overview and on the calendar job sheet; the 'Projects starting' counter on the dashboard; a blocked 'Allocate a team' button.

**Roles** — THIS SCREEN DIFFERS BY ROLE MORE THAN ANY OTHER IN THE DOMAIN, and the difference is not cosmetic. OWNER sees all six items with their real state. CAPTAIN cannot read four of the six: estimates, contracts, purchase_orders and change_orders are all office-only SELECT (schema_v14, schema_v17), so a captain's query returns zero rows and the phone genuinely cannot tell whether a contract exists. Those four items therefore render for a captain as a locked row reading 'The office confirms this' — never as a red cross, which would assert something false, and never as a tick, which would assert something the phone cannot know. A captain sees the true state of the two items they can read: the programme and the SWMS. EMPLOYEE does not reach this screen.

The client's process flow made visible, in their order, as six rows. Nothing here is a stored flag — there is no readiness column anywhere in the schema and the design must not pretend there is; each row is derived live. (1) QUOTE — estimates for this site_id: the latest revision, status ('draft' / 'awaiting_approval' / 'approved' / 'rejected' / 'superseded'), sent_at. Green at 'approved'. (2) SIGNED CONTRACT — contracts for this site_id (unique per site): contract_no, order_no, signed_on, starts_on, due_on, status. Green when a row exists with signed_on set and status='active'. The contract SUM is not shown on this screen even to an owner — this screen is about whether a thing exists, and putting a figure on it makes it a money screen a captain must never see any version of. (3) PROGRAMME — a programmes row with status='current' AND at least one programme_task with is_ours = true and starts_on not null. Green then; amber when a programme exists with nothing ticked as ours ('loaded, but no line is marked as ours'). (4) PROJECT DETAILS — the drawing, from site_files where category in ('plan','drawing'); the scope of works, which has NO dedicated column and is a site_files document by name or job_sites.job_type / schedule_note, and the design must say that plainly rather than invent one; and the selections from site_products joined to products, counted by products.kind — tile, grout, silicone, sealer, adhesive, trim. Grout colour, silicone colour, angles colour, mitres, grates and strip drains are NOT columns: they are site_products rows of kind 'trim' or 'other' with site_products.area and note, and the row should list what is actually recorded rather than showing six empty labelled fields. (5) SWMS — safety_documents where site_id = this job, kind='swms', active = true; plus the count of safety_signatures against it. Green when a document exists; a sub-line reads 'Signed by 0 of 3 booked' because a SWMS nobody has signed is not the same as one that is not uploaded. (6) CONTRACTOR PO — purchase_orders for this site_id: po_no, vendor, issued_on, status. Each row shows a tick, a cross, or a lock, the specific missing thing in words, and a chevron. At the bottom, the gate itself: 'ALLOCATE A TEAM', live only when all six are green, and when it is not, the button is replaced by the plain sentence 'Two things are still outstanding. A job goes live to allocate once the quote, contract, programme, details, SWMS and PO are all in.' Beneath, always, an override for the owner: 'Book anyway' — because the real world does not wait, and a gate with no override gets worked around outside the app. Choosing it asks once, in words, and records nothing (there is no column for it), which the sheet admits.

**Every tap target**

- A green row → half sheet: that item's detail (the contract sheet, the programme summary, the SWMS document, the PO)
- A red row → half sheet: the same, in its 'not yet' form, with the one action that fixes it (owner)
- A locked row (captain) → half sheet: 'The office holds the contract and the PO for this job. They confirm it is in place before a crew is allocated.' — an explanation, not an empty table
- 'ALLOCATE A TEAM' → half sheet: 'Book a crew', pre-filled with this job and the programme's our_start week
- 'Book anyway' → confirm sheet, then the same booking sheet
- The job status chip → half sheet offering to move job_sites.status from 'starting_soon' to 'active', which is the nearest thing the schema has to 'live' and should be set here rather than left to the office screen

**States** — EMPTY: cannot be empty — six rows always render; an all-red checklist is the state of a brand-new job and reads as a to-do list, which is exactly right. ONE-ITEM-LEFT: when five of six are green the screen leads with the single outstanding thing at the top in its own card rather than making a person scan for the cross. LOADING: all six rows render as labelled skeletons in order — the shape of the process is itself information and should be visible before the data arrives. Rows resolve independently; a slow programme read must not hold up the SWMS row. ERROR: per-row. A row whose query fails reads 'Couldn't check' in inkFaint with a retry, and the gate button is disabled with 'One check didn't finish' — never green on incomplete information. ROLE-RESTRICTED: as described, four locked rows for a captain, and the gate button absent for them entirely (they cannot write assignments). OFFLINE: every row renders from cache with the stale-time strip; the gate button is disabled with 'Needs signal to book a crew.' The screen itself writes nothing except the optional job_sites.status change, which is disabled offline.

---

## Readiness item — the not-yet sheet

**half sheet**

**Reached by** — Tapping any red row on the readiness checklist.

**Roles** — OWNER for the four commercial items; OWNER and CAPTAIN for the programme and the SWMS.

One pattern, six fills. Each states what is missing in the client's own language, what it unblocks, and offers exactly one action. QUOTE: 'No quote has been approved for this job.' → 'Open quotes'. CONTRACT: 'No contract has been entered. Until there is one, the job has no value and nothing can be claimed against it.' → 'Enter the contract'. PROGRAMME: 'No programme from the builder. Without it, there is no date to book a crew against and no way to tell whether the job will be ready.' → 'Import the programme'. DETAILS: lists exactly which of the details are present and which are not, from site_files and site_products — 'Drawing: yes. Scope of works: not uploaded. Tiles: 3 selections. Grout: none recorded. Silicone: none recorded. Trims and grates: none recorded.' → 'Add project details'. SWMS: 'No SWMS for this job. Nobody can sign on to work they have not been given a method statement for.' → 'Upload the SWMS'. PO: 'No contractor purchase order recorded.' → 'Enter the PO'. Each sheet also carries the one honest caveat where it applies — notably that scope of works, grout colour, silicone colour, angles, mitres, grates and strip drains have no dedicated columns and are held as documents and site_products rows.

**Every tap target**

- The single action button → pushes the relevant full screen in the job's context (a form is a push, not a sheet — it is doing, not looking)
- 'Not my job' / dismiss → back to the checklist

**States** — LOADING: n/a, the state is already known. ERROR: only on the action's own screen. OFFLINE: the action button is disabled with 'Needs signal'. EMPTY: n/a.

---

## Go live — confirm

**half sheet**

**Reached by** — 'ALLOCATE A TEAM' when all six are green, or 'Book anyway' when they are not.

**Roles** — OWNER only.

'Lot 42 is ready to allocate.' A six-line recap of what is in place, each with its identifying detail (contract_no, programmes.revision, purchase_orders.po_no, the SWMS title, the count of site_products selections, the quote revision) so the tick is auditable rather than decorative. Then what happens next: job_sites.status moves from 'starting_soon' to 'active', the job appears on the calendar's booking prompts, and the booking sheet opens. In the override form the tone changes: 'Two things are still outstanding — the SWMS and the PO. Booking a crew anyway is your call. Nothing records that this was overridden.' — true, and the schema has nowhere to record it, so the design must not imply an audit trail that does not exist.

**Every tap target**

- 'BOOK A CREW' → the booking sheet
- 'Just mark it active' → sets job_sites.status = 'active' without booking
- 'Cancel' → dismisses

**States** — LOADING: 'SAVING…' on the status write. ERROR: inline. OFFLINE: disabled. EMPTY: n/a.

---

## Today — who's on, and where

**full screen**

**Reached by** — The TODAY block on the dashboard ('Teams working', 'Employees on site'); the Diary's today column; the app's opening state for an owner before 8am.

**Roles** — OWNER: everyone. CAPTAIN: only people on jobs they run — which is what captains_site() scopes, and shifts already carries a captain read/write policy for their sites. EMPLOYEE: not reachable; they see their own state on My week. Overlaps the dashboard domain — this is the crew-and-time half of it, and whichever domain owns the dashboard should own the counters while this owns the detail.

The date and day in full en-AU at the top ('Monday 10 August'). Then, grouped by job: job_sites.name, and under it every person booked today (assignments where date(starts_at) = today, published = true) with their live state from shifts — 'On the clock since 7:04am' (started_at, ended_at null), 'Signed off 3:31pm · 8.8 hrs' (a closed pair less break_minutes), or 'Not signed on' in amber when the booked start time has passed by more than thirty minutes. Then a section 'ON SITE BUT NOT BOOKED' — a shifts row today with no matching assignments row, which is how the roster and reality diverge and is worth surfacing. Then 'BOOKED BUT NOT SIGNED ON'. Counters at the top match the client's list exactly: projects active, teams working (distinct crew_id on today's assignments), employees on site (open shifts).

**Every tap target**

- A person row → the shift detail (Time domain) or 'Worker week load'
- A job header → the job (context switch)
- A 'not signed on' row → half sheet with 'Message them' (opens the job channel) and, for an owner, 'Sign them on' which routes to the manual clock-in path rather than writing a shift from this screen
- A counter → the matching list, filtered

**States** — EMPTY (nothing booked today): 'Nobody is booked today.' plus, if it is a weekday, the gentler 'Sunday' or 'Nothing published for today — the week may not have been published yet.' with a link to the Diary. LOADING: counters render as dashes, groups fill in. ERROR: the live column collapses to '—' with a footnote and the booked list still renders — knowing who was meant to be where is useful even when the clock read fails. OFFLINE: the booked half renders from cache; the live half is hidden entirely with 'Can't see who's signed on while offline' rather than showing stale clock states, which would be actively misleading. Writes nothing.

---
