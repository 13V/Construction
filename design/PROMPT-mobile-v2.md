# Design brief — the Crewline phone app, all of it

Hand this to Claude Design together with:

- `design/mobile/Crewline-Mobile.dc.html` — the phone screens that already exist
- `design/screens/isClockin.html` and `design/screens/isCrewMobile.html` — the two
  original phone screens, and the house style everything else grew from
- `design/mobile/NOTES-mobile.md` — the decisions already taken, which stand
- `apps/dashboard/src/theme.ts` — the tokens, measured from the 21 desktop screens
- **`design/mobile/screens/`** — the inventory. 272 screens, enumerated from the code and
  the schema, with every tap target and every state. Section 8 is the map into it

Everything here has to sit beside those without looking like a different product.

---

## 1. What changed, and why this brief exists

The last phone brief was written when the phone was **one surface for one person**: a
worker, clocking on. That app shipped. Since then the product grew a commercial spine —
contracts, variations, job profitability, defects, waterproofing certificates, the
builder's programme, crews — and the client has asked for the phone to carry the business,
not just the timesheet.

So the single biggest change is this: **the phone is now three apps wearing one skin.**

| Role | What the phone is for them |
|---|---|
| **Owner** | Running the business from a ute. Every job, every dollar, who is on site right now, what needs deciding today. |
| **Crew captain** | Running *their* jobs. Everything about the work. Nothing about the money — not a pay rate, not a contract sum, not a margin, on any job. |
| **Employee** | Their own day. Clock on, photos, safety, the job they are standing on. |

This is not a permissions afterthought to bolt on at the end. It is enforced in the
database — a captain querying a contract gets an empty result, not a hidden button — so a
design that implies otherwise is a design that cannot be built. **Draw each screen for the
role that sees it, and where a screen differs by role, draw both.**

---

## 2. Who is holding the phone

Unchanged, and still the thing that decides every layout call.

A tiler, 7am, on a slab, in the sun, gloves on, one hand free, phone in the other. Cracked
screen protector. Data is patchy. The owner is the same person three years later, in the
ute between two sites, with the engine running.

- **Nothing smaller than a thumb.** Tap targets ≥ 44 px. The primary action on a screen is
  a full-width bar, not an icon in a corner.
- **One column.** No side-by-side panels, no horizontal scroll, no tables. The
  profitability screen is where this bites hardest — solve it, don't shrink a spreadsheet.
- **Legible in daylight.** Body text ≥ 13.5 px. Muted grey is for labels, never for
  anything anyone has to read.
- **Say what happened, not what the system did.** "Left Maple Ridge at 3:31pm — clocked
  out. 8.8 hrs today." Never "Event recorded."
- **Offline is normal.** Any screen that writes shows what is queued — a thin strip
  reading "Offline — 3 punches will sync", never a blocking error.
- **Australian.** Variation, not change order. Programme, not schedule. Ex GST / inc GST.
  Metres. `en-AU` dates: 9 Aug 2026, never 8/9/26.

---

## 3. The three structural decisions

The client was specific about these. They are not up for redesign; everything else is.

### The app opens on jobs

Not a clock, not a dashboard. A list of jobs. For an owner that is every active job; for a
captain the jobs they run; for an employee the job they are on, and it should feel like one
job rather than a list of one.

The dashboard figures the client listed — projects active, teams working, employees on
site, projects starting, variations awaiting approval, projects requiring attention — live
**with** that list, not on a separate screen nobody opens. Decide whether that is a header
that scrolls away, a pinned strip, or a segmented peer, and commit.

### Entering a job changes the tab bar

Tapping a job is a context switch, and the tab bar changes to that job's tabs. Getting back
out has to be obvious and one tap. Draw the transition — a person must never wonder which
context they are in.

The client listed nineteen things an owner can reach inside a job. **Nineteen tabs is not a
tab bar.** Four or five, and the rest are rows on an overview that push or open a sheet.
The grouping is a real design decision and the brief expects you to argue for yours.

### Half sheets

Tapping something for detail slides a sheet up to about half the screen, keeping the
context behind it visible. This is the client's explicit ask and it should be the app's
signature interaction.

Define it properly and give a rule anyone can apply:

- What height, and does it have a second detent?
- Draggable, or dismiss only?
- What happens to the screen behind — dimmed, scaled, inert?
- The grabber, the dismiss target, the safe area.
- **When a half sheet is the wrong answer.** A sheet is for looking; a push is for doing.
  If the thing has its own sub-navigation or a form longer than a thumb-scroll, it is a
  screen. Say where the line is.

---

## 4. Hard rules — what the app is allowed to show

Breaking one of these makes a screen that cannot be built.

1. **A captain never sees money.** No pay rate, no contract sum, no invoice, no margin, no
   job value, no cost. Not greyed out — absent. If they somehow reach a money screen they
   get a plain explanation, not an empty table.
2. **Everybody sees the work; money is the only thing that is rationed.** This is the
   single most important correction to the last version of this brief, which said an
   employee sees "not another job's defect list". That was wrong, and a design built on it
   would have been wrong in the same direction. The database is deliberately open about
   work: `job_sites`, `defects`, `site_instructions`, `progress_entries` and
   `waterproofing` are all readable by the whole company, with the reason written into
   `schema_v19` — *"a tiler needs to know what the defect list says about the shower they
   are standing in, and a chippie needs to know the membrane is not signed off before they
   screed over it."*

   So the difference between an employee and an owner is **what they can do, not what they
   can see**. Anyone can raise a defect, because a defect noticed by the labourer standing
   in front of it is worth more than the same defect found by the office three weeks later.
   Only the office or that job's captain can close one. Nobody but the office can type a
   progress percentage, because a progress percentage is what a payment claim is justified
   with. Draw the same screen for all three and vary the buttons.
3. **A worker's own record is theirs.** Their hours, their shifts, their location trail.
   `shifts` is self-only for an employee; a captain reaches the shifts of people on the
   jobs they run, and nobody else's.
4. **The server owns the clock.** No screen may imply the phone decided a shift started.
   Clock-in is a consequence of where you were, confirmed by the server, and the two-minute
   settle window is real — a drive-by must not open a shift.
5. **Location honesty.** Tracking records a position roughly every 20 seconds while it is
   on, *including the drive to work*, and the office can see the trail. The app says so
   plainly. Do not draw copy implying it only records on site — an earlier version did, and
   it was wrong.
6. **Nothing invented.** Every figure on every screen comes from something the database
   actually holds. Where the inventory names columns, use those.
7. **Unapproved work is not value.** A pending variation adds nothing to a contract sum and
   must never be drawn as though it does.
8. **A restriction is a sentence, never an empty table.** Where a role cannot have
   something, say what it is and who to ask — "Contract sums are office-only. Ray can send
   you the scope." A blank panel reads as a bug, and the person will tap it again tomorrow.

---

## 5. Visual system

Take the tokens from `apps/dashboard/src/theme.ts` — they were measured from the design
files, not invented, and two of them were wrong before and have been corrected.

| Role | Token | Hex |
|---|---|---|
| App background | `appBg` | `#F5F6F7` |
| Panels | `panel` | `#FFFFFF` |
| Primary text | `ink` | `#1A1D21` |
| Body, one step down | `inkMid` | `#4A5057` |
| Secondary | `inkSoft` | `#696D74` |
| Labels, captions, meta | `inkFaint` | `#8B9096` |
| Borders | `border` | `#DCE0E6` |
| Row dividers | `borderSoft` | `#EDEFF1` |
| Accent | `accent` | `#007BFF` |
| Dark rail | `rail` | `#2B2F33` |
| Alert | `alert` | `#D2051E` |
| Success | `success` | `#28A745` |
| Warning ink | `warnInk` | `#8A6100` |
| Brand yellow | `brandYellow` | `#FFCD11` |

The one primary button treatment is `linear-gradient(180deg, #FFCD11, #F7B244)` with a 1px
`#E0A032` border and dark text. That angle, that stop order, that border — every hand-rolled
copy in the codebase got at least one of the three wrong.

Uppercase labels are 10.5px / 700 / `.08em`. Figures that line up in a column use
`tabular-nums`. Severity colour is separate from the accent and never decorative.

---

## 6. What to deliver

Follow the structure already in `Crewline.dc.html`: `<sc-if>` blocks driven by one `screen`
state, 390 px phone columns at gap 22, inline styles only, the verbatim status bar. Add to
the demo index; do not start a parallel document.

For every screen: the default state, and — where they differ meaningfully — empty, loading,
error, offline, and role-restricted. An empty state that says "No defects" is a wasted
screen; say what a defect is for and how one gets raised.

Where a screen has a half sheet, draw the sheet open over its parent, not floating alone.

---

## 7. The architecture

### One structure, and the owner has one more tab

This was tested against the policies rather than assumed, and it holds — for a reason
better than convenience. **The database can only make two kinds of distinction.**
`current_is_office()` is literally `role = 'owner'`, a binary existence gate.
`captains_site(site_id)` is a per-row scope test that never removes a table from anyone, it
narrows which rows come back and which writes land. There is no third mechanism —
`current_worker_role()` exists and is referenced by zero policies, zero views and zero
lines of app code.

So the data layer is incapable of expressing "the captain gets a different set of screens".
It can only say *this class of data does not exist for you*, or *you get fewer rows and
fewer buttons*. A navigation with one owner-only tab and otherwise scoped content is a
one-to-one transcription of that. Any other navigation would be inventing a distinction
nothing can enforce.

The clinching fact: run down what the owner's extra tab contains and ask what the other two
actually get from it. `contracts` 0 rows. `invoices` 0. `estimates` 0. `purchase_orders` 0.
`subcontractors` 0. `worker_pay` 0. `job_value_v`, `job_cost_v`, `job_profit_v`,
`company_overview_v`, `job_money_v` — 0, 0, 0, 0, 0. Not filtered. Empty, permanently, by
policy. **The owner's extra tab is the only tab whose every data source is a blank screen
for everybody else.** Removing it for them is not a role fork; it is declining to ship a
blank page.

The codebase already reached this conclusion once and only applied it in one place —
`JobSiteFolder.tsx:69` is an eight-tab array with exactly one `officeOnly: true`, and the
comment above it is right: *"a display rule, not the security boundary … hiding the tab
just stops it looking broken."* This brief is that decision applied consistently.

### The root tab bar

```
employee   Jobs · Schedule · Chat · Me
captain    Jobs · Schedule · Chat · Me
owner      Jobs · Schedule · Chat · Me · Business
```

Four, and five. Byte-identical for the first four, and the opening screen is not merely the
same *layout* for all three — it is the same *data*. `job_sites_read` is
`company_id = current_company_id()`, defined once and never narrowed in twenty-three
subsequent migrations. `schema_v18` added `job_sites.captain_id` and never referenced it in
a read policy. The owner, the captain and the chippie open the app to the same list of jobs
in the same order.

**Jobs** carries the client's dashboard figures — projects active, teams working, employees
on site, projects starting, variations awaiting approval, projects needing attention. Decide
whether that is a header that scrolls away, a pinned strip or a segmented peer, and commit.
For an employee the counters mostly collapse to one job, so design what that degrades to; a
list of one should feel like a job, not like a list.

**Schedule** merges two things the client listed separately — the calendar and the
Crew 1/2/3 × Mon–Thu booking grid — because both answer "when". A segmented control, not
two tabs. `assignments` and `programme_tasks` are company-wide for everyone; `shifts` is the
one scoped source (employee sees their own, captain sees theirs plus everyone on jobs they
run, owner sees all), so nobody gets a blank Schedule.

**Me** is the worker's own record: their hours, their certifications and white card, the
SWMS they have signed, their photos, account and privacy. An owner's Me is their own hours
too — it is not a lesser version of anything.

**Business** is the owner's fifth. Named Business rather than Money because it holds the
company overview as well as the commercial documents, and because "running the business from
a ute" is what it is for.

### Entering a job replaces the tab bar

```
employee   Overview · Work · Spec · Programme
captain    Overview · Work · Spec · Programme
owner      Overview · Work · Spec · Programme · Money
```

Same shape, one level down. Getting out is the back arrow and a right-swipe, and it restores
the root bar — draw the transition, because a person must never wonder which context they
are in.

Two things live on the pinned job header rather than in the bar, because both are wanted
from every tab: **chat** (with its unread count) and **the camera**. Photos are a daily
action and do not need a permanent slot.

### Where the client's nineteen things go

| | |
|---|---|
| **Overview** | where the job is up to, who is on site right now, what needs doing, readiness against the programme. Live sign on and off. For a worker standing on that site, the clock is the primary action — a full-width bar, not a button in a corner. |
| **Work** | scope · site instructions · defects · progress · waterproofing · materials · photos |
| **Spec** | plans and marked-up drawings · tile codes and technical data · grout, silicone and angle colours · mitres, grates, strip drains · SWMS |
| **Programme** | the builder's programme and its revisions · our window · who is booked on · the job calendar · a variation's `days_impact` |
| **Money** *(owner)* | quote · contract · contractor PO · variations with their values · contractor invoice · current cost · projected profit |

**Spec** is its own tab and not a folder inside Work because it is what a tiler opens
standing at the wall — wrong grout colour is a day of grinding. It is read-mostly for
everyone, which makes it the easiest tab in the app and the one most often got wrong by
burying it.

Money needs its own sub-navigation, which by §3's own rule makes each of its destinations a
pushed screen, never a half sheet.

### What actually differs by role, and why buttons must be absent

Within the shared tabs the difference is overwhelmingly **write**, not read. On defects,
site instructions and waterproofing, the captain tier does not narrow reads at all — a
captain gets the identical company-wide read an employee gets. It bites only on write:
office anywhere, captain on their own jobs. Same list, same sheet, **different footer**.

This is not a stylistic preference. The database has three different ways of refusing a
write and not one of them is presentable:

1. **No policy exists** — an employee inserting a progress entry gets a raw `42501`.
   `schema_v19` skips that policy deliberately: a progress percentage is what a payment
   claim is justified with, so letting anyone type one makes over-claiming an accident
   rather than a decision.
2. **A policy exists but excludes the row** — every employee update on a site record, every
   captain update on a job they do not run. The client gets **success, zero rows affected**.
   Nothing to show. No error to catch.
3. **The write lands and is silently rewritten** — an employee who submits a waterproofing
   record claiming `signed_off` gets a `201`, and a trigger forces the row back to
   `in_progress` with the certificate fields nulled.

So: **a button a role cannot use is not disabled, it is not drawn.** Case 2 in particular
would otherwise produce a tap that appears to work and changes nothing, which is the worst
outcome available.

### What to draw first

The inventory is 272 screens. In order of what unblocks the most:

1. The root Jobs list with the dashboard figures on it, all three roles.
2. The job shell — pinned header, the tab swap, the transition in and out.
3. The half-sheet system itself: height, detents, grabber, what happens behind, and the
   line where a sheet becomes a push.
4. Overview, including clock-on as the primary bar.
5. Work, with one row opened as a sheet and the footer drawn three times — owner, captain,
   employee.
6. Then the rest, against the inventory.

---

## 8. The screens

The full inventory lives in **`design/mobile/screens/`** — 272 screens across six files,
enumerated from the code and the schema rather than from imagination. Each entry gives what
the screen is reached by, what is on it down to the column names, every tap target and where
it goes, how it differs by role, and its empty, loading, error and offline states.

| | |
|---|---|
| [`00-the-way-in.md`](mobile/screens/00-the-way-in.md) | 36 — launch, auth, the jobs list, the dashboard block, search, notifications, account, privacy |
| [`01-inside-a-job.md`](mobile/screens/01-inside-a-job.md) | 52 — the job shell, the tab swap, and every work tab |
| [`02-commercial.md`](mobile/screens/02-commercial.md) | 48 — profitability, contracts, quotes, POs, claims, variations |
| [`03-on-the-slab.md`](mobile/screens/03-on-the-slab.md) | 54 — geofenced sign on and off, safety, toolbox, photos, defects |
| [`04-time-and-crews.md`](mobile/screens/04-time-and-crews.md) | 38 — the booking grid, crews, the programme as a calendar |
| [`05-patterns.md`](mobile/screens/05-patterns.md) | 44 — the half-sheet system, both tab bars, offline, errors, empty states |

Read `05-patterns.md` first. It settles the interaction rules the other five assume.

Two things in there are flagged rather than drawn, and both need a decision before they can
be:

- **A captain cannot load the builder's name.** `job_sites.builder_id` is readable by
  everyone but `builders` is office-only, so a captain resolving it gets zero rows. Today a
  job header can honestly show only `client_name` and `builder_job_ref`. Closing this needs
  a `builders_public_v` exposing id and name. Do not draw a builder name a captain cannot
  load.
- **There is no password reset anywhere in the app.** For a workforce where the person who
  set the account up is usually not the person holding the phone, that is a real omission,
  not a nicety.
