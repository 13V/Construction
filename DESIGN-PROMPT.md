# Design prompt — construction crew tracking app

Style direction is modeled on **Fieldwire (by Hilti)** — see [STYLE-REFERENCE.md](STYLE-REFERENCE.md).
Feature scope is set by [COMPETITIVE-ANALYSIS.md](COMPETITIVE-ANALYSIS.md).

**Generate this in two passes.** Paste Part A first — it's the pitch and it stands alone.
Then paste Part B into the same conversation to fill out the commercial modules. Trying to
get all 17 screens in one shot produces something thin everywhere.

---

# PART A — the core product

Build me a clickable visual prototype of a workforce tracking app for a small-to-mid construction company (roughly 6–40 field workers, 3–8 active job sites). This is a **pitch mockup**, not working software — it needs to look real enough that a construction business owner immediately understands the product, but nothing has to function beyond navigating between screens.

## Who uses it

1. **Owner / office dashboard** — desktop web. The owner and his office manager live here: the map, timesheet approvals, job site folders, expenses, scheduling.
2. **Worker app** — phone. Simple, glanceable, big touch targets, usable with gloves on and in sunlight. Show as phone frames (~390×844) beside or below the desktop screens.
3. **Foreman** — same phone app plus crew powers: clock in the whole crew, confirm the daily log.

## Visual direction

Follow the design language of **Fieldwire by Hilti** — a field-first construction tool. The governing principle: **the content is the canvas, and the chrome recedes.** Thin, quiet navigation; the real information lives as markers on a map or rows in a dense table.

**Palette — use these exact values:**

| Role | Hex |
|---|---|
| App background | `#F5F6F7` |
| Panels / cards | `#FFFFFF` |
| Primary text | `#1A1D21` |
| Secondary text | `#696D74` |
| Borders / dividers | `#DCE0E6` |
| Interactive accent (links, active nav, selected) | `#007BFF` |
| Active nav fill | `#E7F1FF` (pale blue band) |
| Floating tool rails | `#2B2F33` charcoal, white icons |
| High-emphasis CTA | gold gradient `#F7B244 → #FFCD11`, dark text |
| Alert / issue / markup | `#D2051E` |
| Success / on the clock | `#28A745` |
| Warning / needs review | `#FFC107` |

**Typography:** Inter for headings, Lato (or system sans) for body — Fieldwire's actual pairing. UI type is small and dense: **13px in tables and sidebars, 14px body, 16px section headings.** Tabular numerals for all times, hours, and dollar amounts.

**Chrome:**
- **Small radii** — 3px buttons, 8px cards. Nothing pill-shaped except status chips.
- 1px `#DCE0E6` borders do the separating work. Almost no shadows — only elements floating above the canvas.
- **Buttons:** secondary = white fill, thin gray border, dark label. Primary = the gold gradient, **UPPERCASE with ~0.04em letter-spacing**. Sentence case everywhere else.
- Small monochrome line icons. No filled/duotone sets, no emoji.
- Generous whitespace in overview surfaces; genuinely dense in working surfaces. Don't let the timesheet breathe — contractors want the whole week at once.

**Two-row top chrome:**
- Row 1: company switcher far left with a small circular logo mark, a search field, then right-aligned notification bell, help `?`, user name with chevron.
- Row 2: a toolbar of small bordered buttons — contextual actions left (`← All sites`, `Actions ▾`), filters and view controls right.

**Left sidebar** (~190px, white, thin right border): small icon + 13px label rows — Map, Schedule, Timesheets, Job Sites, Expenses, Daily Logs, Crew, Equipment, Safety. Active row gets a **full-width pale blue `#E7F1FF` band with icon and label in `#007BFF`**. Below a divider, a small gray "JOB SITES" label with the four active sites as sub-items.

**Floating dark tool rails** — Fieldwire's signature move, and I want it on the map. A vertical charcoal rail of white line icons, 6px radius, floating over the canvas rather than docked in a panel.

## Sample data — use this exact data so screens stay consistent with each other

**Job sites**
| Site | Address | Type | Status |
|---|---|---|---|
| Maple Ridge | 4412 Maple Ridge Dr | Custom home — framing | Active |
| Northgate Plaza | 1900 Northgate Blvd, Suite 210 | Tenant improvement | Active |
| Harbor View 3B | 88 Harbor View Ct, Unit 3B | Condo remodel | Active |
| City Line Storage | 7715 Industrial Pkwy | Slab & site work | Starting Mon |

**Crew**
| Name | Trade | Today |
|---|---|---|
| Miguel Ortiz | Foreman | On the clock — Maple Ridge, in since 6:42 AM |
| Danny Whitfield | Framer | On the clock — Maple Ridge, in since 6:51 AM |
| Rosa Delgado | Finish carpenter | On the clock — Harbor View 3B, in since 7:03 AM |
| Tre Coleman | Laborer | On the clock — Maple Ridge, in since 6:44 AM |
| Sam Nguyen | Electrician | Traveling — left Northgate 9:12 AM |
| Bobby Kaminski | Equipment operator | Off — no shift scheduled |
| Alicia Moreno | Drywall | Exception — clocked in 0.4 mi outside geofence |

**Cost codes** (these appear on timesheets, expenses, and budgets — keep them consistent)
`01-100` General Conditions · `03-300` Concrete · `06-100` Rough Carpentry · `06-200` Finish Carpentry · `15-400` Plumbing · `16-100` Electrical

**Equipment**
`S-12` Skid steer — Maple Ridge, operator Bobby Kaminski · `E-04` Mini excavator — City Line Storage, idle · `L-07` Scissor lift — Northgate Plaza, in use · `C-03` Air compressor — Maple Ridge, idle 3 days

Use today's date, a weekday, and morning-to-midday times so the map has people on it.

## Screens

### 1. Live map — the home screen, and what I'll open the demo with

**Canvas-first, exactly like Fieldwire's plan viewer.** The map is the content — edge to edge under the two-row top chrome, no card wrapper, no padding. Everything else floats on top.

- **Do not embed a real map service** — draw a stylized abstract map as inline SVG/CSS: soft gray parcels, thin white road lines, a couple of street labels. It should read as "map" instantly without external tiles.
- **Floating charcoal tool rail**, top-left: fullscreen, zoom in, zoom out, divider, filter-by-site, layers, recenter target.
- Job sites are **pin markers** with a translucent blue geofence circle (`#007BFF` at ~12%, 1px stroke). Label chip: "Maple Ridge · 500 ft · 3 on site".
- Workers are small circular avatars with initials clustered inside geofences, with a status ring — green on the clock, amber traveling, red exception. Sam sits on a road between two sites. **Alicia sits just outside a fence with a `#D2051E` marker** — red always means "a human needs to look at this."
- **Equipment markers** in a distinct shape (rounded square, not a circle) so machines read differently from people: skid steer at Maple Ridge, scissor lift at Northgate.
- **One worker's GPS breadcrumb trail** drawn as a dotted blue path — Sam's route from Northgate, with small dots at each ping. This is the audit trail that settles hour disputes; make it visible.
- **Floating roster panel**, docked right (~300px, white, 8px radius, subtle shadow): crew grouped by site — avatar, name, trade, clock-in time, status dot. Alicia flagged "Outside geofence — review" in red.
- **Floating stat strip**: **On the clock 4 · Active sites 3 · Hours today 21.5 · Labor cost today $1,284**.
- Small dark date/time chip bottom-left, plus a day scrubber for replaying crew positions. Static control is fine.
- Unmissable privacy line: **"Location tracked 6:00 AM – 4:00 PM on scheduled shifts only."** Workers need to see the app isn't following them home.

### 2. Auto clock-in — worker phone

The feature I'm selling. White chrome, blue interactive elements, content dominant. Give me **five phone frames**:

1. **Approaching** — "Maple Ridge · 0.3 mi away — you'll clock in automatically when you arrive."
2. **Confirming** — arrived inside the fence, but a small progress indicator reads **"Confirming you're on site… 2 min"** with subtext *"We wait until you've settled in so driving past doesn't clock you in."* This is deliberate — the biggest complaint about every competitor is that geofences clock people in when they merely drive by. Show that we fixed it.
3. **Clocked in** — big green confirmation: "Clocked in at 6:42 AM · Maple Ridge," small map thumbnail showing arrival inside the fence, "Automatic — you didn't have to do anything," and a small verification thumbnail captioned *"Photo verified"* (guards against buddy punching). Subtle blue "Not right? Fix this" link.
4. **On the clock (today view)** — running counter (`2:47` elapsed), today's site, **cost code selector showing `06-100 Rough Carpentry`** with a "Switch task" link, crew avatars also on site, and three big buttons: **Take Photo**, **Upload Receipt**, **Site Chat**. Below, today's timeline: arrived 6:42, break 9:30–9:45, still on site. A small gray **"Offline — 3 punches will sync"** banner, because sites lose signal and every competitor sells this.
5. **Foreman crew clock-in** — Miguel's view: a checklist of his four crew members with toggles, all selected, one button **CLOCK IN CREW (4)**, and a note that each worker's GPS is still verified individually.

Also show small: a phone notification reading "Left Maple Ridge at 3:31 PM — clocked out. 8.8 hrs today," and a rejected drive-by notice — *"Passed Northgate Plaza 11:04 AM — not clocked in (under 2 min on site)."*

### 3. Schedule / dispatch board — desktop

This is what makes auto clock-in work: you assign someone to a site, and the geofence arms itself for that shift.

- A week board. Rows = crew members, columns = Mon–Sun. Each cell is a small colored block naming the job site and shift hours (`Maple Ridge · 7–3:30`). Color-code blocks by site, muted, not neon.
- Unassigned strip at the top: two open shifts needing someone.
- Drag affordances visible (grab handles, a dashed drop target on one cell) even though it won't work.
- Right rail: crew availability — who's on PTO (Bobby, Friday), who's already at 38 hrs and would tip into overtime if given another shift. That overtime warning is the thing an owner will lean forward at.
- Toolbar: week selector, filter by site/trade, and a gold **PUBLISH SCHEDULE** button with subtext "Notifies 6 crew."

### 4. Timesheets — desktop

The payroll-day screen. **Dense. 13px. This should look like a serious tool.**

- Toolbar: week selector (Mon–Sun), site filter, crew filter; **EXPORT TO PAYROLL** as the gold CTA, with a small row of integration names beneath — QuickBooks, ADP, Gusto, Paychex.
- Rows = workers. Columns = Mon–Sun, then **Total**, then **Approve**.
- Each cell shows hours (`8.2`) with a provenance icon: **pin = auto-captured by GPS**, **pencil = manually edited** (edited cells get a soft amber tint). This distinction is the whole trust story — make it legible.
- Overtime over 40 hrs renders red in Total. Miguel is at 46.5.
- **Exceptions strip** above the table — white panel, red left border: "Alicia Moreno — clocked in outside geofence Tue," "Danny Whitfield — no clock-out Wed, auto-closed 6:00 PM," "Sam Nguyen — phone location off 1.5 hrs Thu." Each with Approve / Edit.
- One **expanded row** breaking a day out by job site *and cost code* — 5.0 hrs Maple Ridge `06-100 Rough Carpentry`, 3.2 hrs Northgate `16-100 Electrical`. Hours have to land on the right job and the right code or job costing is worthless.
- A **compliance column or badge**: one worker flagged "Meal break not taken — CA rule," another "Signed off ✓ 3:34 PM" with a small signature mark.
- Bottom summary bar: total hours, total labor cost, approved vs pending counts.

### 5. Job site folder — the detail view, desktop

Header: site name, address, job type, dates, foreman, crew avatar row. Tabs styled Fieldwire-fashion — text labels with a 2px blue underline on the active one, not boxed: **Overview · Photos · Plans & Docs · Expenses · Daily Logs · Chat · Time · Budget**.

- **Overview** — left column: job details, scope notes, client contact, schedule dates. Right column: activity feed ("Danny uploaded 4 photos · 20 min ago", "Receipt from Ferguson Plumbing logged to Expenses · $842.19 · 1 hr ago", "Miguel clocked in · 6:42 AM"). Stat cards: hours to date, spend to date, budget remaining.
- **Photos** — dropzone, then a date-grouped grid of flat gray placeholder tiles (**no stock photography**). Uploader initials, time, and a small GPS pin stamp on each. Filters: All / Progress / Issues / Before & After / Inspections. One tile carries a red dot as an "Issue," captioned "Water intrusion at NE corner — Miguel, 9:14 AM."
- **Plans & Docs** — file list with type icons: `Maple-Ridge-Plans-RevC.pdf`, `Framing-Permit.pdf`, `Truss-Layout.pdf`, `Owner-Change-Order-2.pdf`, `Site-Survey.pdf`. Columns: name, uploaded by, date, size, version badge (`Rev C`), download. A "2 older versions" link showing Rev C supersedes Rev B. **Below the list, show an opened plan in a viewer** — blueprint as black line work on white, canvas-first, floating charcoal tool rail (pin, measure, markup, text, camera), and **two or three red pin markers dropped on the drawing**: "Photo — NE corner," "Issue #2 — water intrusion." Pinning a photo or a problem to a spot on the actual plan is what sells this tab.
- **Expenses** — see below.
- **Daily Logs** — see below.
- **Chat** — see below.
- **Time** — hours on this site by worker, small weekly bar chart, table of who worked when, total labor cost.
- **Budget** — see Part B, screen 9.

### 6. Expenses tab + AI receipt capture

A worker photographs an invoice; it lands in the right job site's expenses, already read and categorized, waiting for the owner to confirm. **No competitor does this** — make it look effortless.

**Phone — two frames:**
1. Camera framing a receipt, capture button, hint "Snap the invoice — we'll file it."
2. Result: thumbnail left, extracted fields right — **Vendor:** Ferguson Plumbing Supply · **Date:** today · **Total:** $842.19 · **Tax:** $61.19 · **Category:** Materials — Plumbing · **Cost code:** `15-400 Plumbing` · **Job site:** Maple Ridge. Fields editable, each with a subtle "AI read this" marker. High-confidence fields plain; **Job site** carries a soft amber note "Assumed from your location — tap to change." Gold **SAVE TO MAPLE RIDGE** button. Three parsed line items collapsed under "3 line items."

**Desktop — the Expenses tab:**
- Stat cards: **Spend to date $48,720 · Budget $65,000 · Remaining $16,280**, thin budget bar, plus a category breakdown as a horizontal bar list (Materials, Subs, Equipment Rental, Permits, Fuel). **No pie charts.**
- Table: date, vendor, category, cost code, amount, receipt thumbnail, submitted-by avatar, **status chip** — `Confirmed` green, `Needs review` amber, `Flagged` red.
- Three rows with distinct AI notes so the intelligence is visible:
  - Ferguson Plumbing $842.19 — `Needs review` — *"Read from photo. Matched to Maple Ridge from GPS at time of purchase."*
  - Home Depot $211.04 — `Confirmed` — *"Auto-categorized Materials — Lumber from line items. Coded 06-100."*
  - United Rentals $1,340.00 — `Flagged` — *"Possible duplicate of invoice #88213 logged Tuesday. Also $340 over the equipment rental line."*
- One expanded row showing the receipt image beside the extracted line items, so the owner can verify what the AI read.

### 7. Daily log — AI-drafted

Every competitor makes the foreman fill out a form at 4pm. We already know who was on site, how long, what photos were taken, and what got bought — so the log drafts itself.

- Desktop view of today's Maple Ridge log, headed **"Draft — generated 3:40 PM. Review and confirm."** in an amber band.
- Auto-filled sections, each with a small "from your data" marker: **Crew on site** (4 workers, 21.5 hrs, pulled from timesheets) · **Weather** (72°F, clear, wind 6mph — auto-captured) · **Work completed** (a short generated paragraph referencing rough carpentry hours and the photos) · **Materials delivered** (Ferguson Plumbing order, from the receipt) · **Equipment on site** (skid steer S-12, 6.2 hrs) · **Issues** (the NE corner water intrusion, pulled from the flagged photo).
- A free-text "Anything else?" box, the only thing the foreman actually has to type.
- Gold **CONFIRM & SEND** button, with subtext "Sends to owner + client portal."
- A phone frame of the same thing — foreman reviewing the draft on site, three taps to confirm.

### 8. Chat

- **Job site channel** — left rail lists channels (`#maple-ridge`, `#northgate-plaza`, `#harbor-view-3b`) with unread badges, then **Direct messages** with presence dots. Thread mixes text and inline attachments: Miguel posts a photo with "NE corner needs a look before drywall," Rosa asks about trim stock, the owner replies. Include **system messages** in a distinct muted gray style: *"Danny Whitfield clocked in · 6:51 AM"*, *"Receipt from Ferguson Plumbing added to Expenses · $842.19"*, *"Daily log confirmed by Miguel Ortiz · 3:52 PM."* These tie the whole app together — clearly not-a-person, but in the flow.
- **Direct message** — one-to-one with Rosa: owner sends a plan snippet, Rosa replies with a photo. Header shows name, trade, current site.
- Phone version of the site channel, since that's where crews actually use it.

---

# PART B — commercial and admin modules

Paste this after Part A is generated, into the same conversation. Same styling, same data, same navigation. These are lower-fidelity — **one good screen each**, enough to prove the footprint exists. Don't spend detail here at the expense of Part A.

**9. Budget & job costing** — the Budget tab of the job site folder. Table by cost code: estimated hours, actual hours, estimated cost, actual cost, variance (red when over). Rows for the six cost codes. Labor vs materials split. A top-line "Projected margin 18.4% — down from 22% at bid" with a small trend indicator. This is the screen that tells the owner whether he's making money.

**10. Estimates & takeoffs** — a quote builder: line items grouped by cost code, quantity, unit, unit price, markup %, line total. Running total with margin. A "Convert to job" action. Beside it, a small revision history (`Rev 3 — sent to client Tue`) and a status chip (`Awaiting approval`).

**11. Purchase orders** — a PO list (number, vendor, job site, amount, status: Draft / Sent / Partially received / Received) plus one open PO showing line items and a "Receive items" action. Note where a matched receipt from Expenses has auto-linked to a PO line.

**12. Invoices & progress claims** — invoice list with status chips (Draft / Sent / Overdue / Paid), an aging summary, and one progress claim showing % complete by cost code with the claimed amount. Include a simple **cashflow forecast** strip — money in vs money out over the next 8 weeks as a small bar chart. This is Jack's core differentiator; a thin version of it matters.

**13. Change orders** — list with status (Pending / Approved / Rejected), and one change order detail: description, cost impact, schedule impact in days, client approval state with a signature block.

**14. Safety** — a compliance dashboard: JHAs completed this week, open hazards, incident count, certification expiries coming up. Plus one filled **Job Hazard Analysis** form and one **incident report** with a photo attachment. Toolbox talk sign-off sheet with crew signatures.

**15. Equipment** — list of the four machines: ID, type, current site, current operator, hours this week, status (In use / Idle / Maintenance due). Flag `C-03 Air compressor — idle 3 days at Maple Ridge` as an underutilization callout, and `E-04` as maintenance due. Small map inset showing equipment positions.

**16. Crew directory** — worker list with trade, phone, status, hourly rate (permission-gated visual treatment), certifications with expiry dates, and PTO balance. One worker profile: hours this month, sites worked, documents on file (W-9, OSHA 30, license), and a time-off request awaiting approval.

**17. Client & subcontractor portals** — two simplified read-only views. The **client portal**: project progress %, schedule milestones, recent photos, daily logs, selections awaiting their approval, and their invoices. The **sub/vendor portal**: only their assigned tasks, relevant plans, POs, and safety docs. Both should feel deliberately stripped down — fewer nav items, no financial internals. Note on screen that these are **free user seats**, because that's how this gets into a client's hands.

---

## How to build it

- One self-contained HTML page. Everything inline — no external CSS, fonts, scripts, images, or map tiles (they won't load). System fonts, inline SVG, CSS for every visual.
- Make the left sidebar and the job-site tabs **actually clickable** so I can walk the owner through it live. Screens swap with plain JS show/hide. Phone frames can be static.
- Include a small screen index at the top so I can jump straight to any screen during the demo.
- Fill every screen with realistic data — no lorem ipsum, no empty states, no "Coming soon." A half-built screen kills the pitch.
- Responsive enough to survive being shown on a laptop.

The whole point is that a contractor looks at this for 90 seconds and says "yes, that's what I want." Prioritize clarity and realism over cleverness.
