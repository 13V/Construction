# Design prompt — construction crew tracking app

Paste everything below the line into Claude to generate the visual prototype.

---

Build me a clickable visual prototype of a workforce tracking app for a small-to-mid construction company (roughly 6–40 field workers, 3–8 active job sites). This is a **pitch mockup**, not working software — it needs to look real enough that a construction business owner immediately understands the product, but nothing has to actually function beyond navigating between screens.

## Who uses it

There are two surfaces, and I want to see both:

1. **Owner / office dashboard** — desktop web. The owner and his office manager live here. They watch the map, approve timesheets, manage job site folders, review expenses.
2. **Worker app** — phone. Simple, glanceable, big touch targets, usable with gloves on and in sunlight. Show these as phone frames (roughly 390×844) rendered next to or below the desktop screens.

## Visual direction

Minimal and functional. This is a tool people open 30 times a day, not a marketing site.

- Light theme. Near-white app background (`#FAFAF9`), pure white cards, ink `#18181B`, secondary text `#71717A`.
- **One** accent color: safety orange `#EA580C`, used only for primary actions and active nav states. Do not paint the UI orange.
- Semantic colors only where they carry meaning: green `#16A34A` = on the clock, amber `#D97706` = needs review, red `#DC2626` = exception/problem.
- Flat design. 1px borders (`#E4E4E7`), 8px radius, almost no shadows, no gradients, no decorative illustration, no hero imagery.
- Inter or system UI font. 14px base, 13px in tables. **Tabular/monospaced numerals for all times, hours, and dollar amounts** so columns line up.
- Dense tables are good here — this audience wants to see a lot at once — but keep generous padding in cards and forms.
- Every screen gets a thin top bar with the company name ("Rivera Construction"), a date, and a user avatar. Left sidebar nav on desktop: Map, Timesheets, Job Sites, Crew, Expenses, Settings.

## Sample data — use this exact data so the screens are consistent with each other

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

Use today's date, a weekday, and morning-to-midday times so the map has people on it.

## Screens to design

### 1. Live map (the home screen, and the screen I'll open the demo with)

Split layout: map fills most of the frame, a roster rail sits on the right.

- **Do not embed a real map service** — draw a stylized, abstract map as inline SVG/CSS: soft gray blocks for parcels, thin white road lines, a couple of labels. It should read as "map" at a glance without any external tiles or images.
- Each job site is a labeled pin with a translucent orange circle around it — that's the **geofence**. Show the radius on hover/label ("Maple Ridge · 500 ft geofence · 3 on site").
- Workers are small circular avatars with initials, clustered inside geofences. One worker (Sam) is on a road between two sites with a small "traveling" treatment. One worker (Alicia) sits just outside a geofence ring with a red indicator.
- Top of the screen: four compact stat tiles — **On the clock: 4 · Active sites: 3 · Hours logged today: 21.5 · Labor cost today: $1,284**.
- Right rail: roster grouped by site, each worker row showing avatar, name, trade, clock-in time, and a green/amber/red status dot. Alicia's row is flagged with "Outside geofence — review."
- Somewhere visible and unmissable, a small privacy line: **"Location tracked 6:00 AM – 4:00 PM on scheduled shifts only."** This matters to me — I want workers to see the app isn't following them home.
- A day scrubber along the bottom that would replay where crews were during the day (static is fine, just show the control).

### 2. Auto clock-in — worker phone

This is the feature I'm selling, so give it three phone frames side by side telling the story:

1. **Approaching** — driving toward site, card reads "Maple Ridge · 0.3 mi away — you'll clock in automatically when you arrive."
2. **Clocked in** — big green confirmation: "Clocked in at 6:42 AM · Maple Ridge," with a small map thumbnail showing arrival inside the geofence, plus "Automatic — you didn't have to do anything." A subtle "Not right? Fix this" text link.
3. **On the clock (today view)** — running hours counter (`2:47` elapsed), today's site, crew also on site (row of avatars), and three big buttons: **Take Photo**, **Upload Receipt**, **Site Chat**. Below that, today's timeline: arrived 6:42 AM, break 9:30–9:45, still on site.

Show the auto clock-out counterpart small: a phone notification that reads "Left Maple Ridge at 3:31 PM — clocked out. 8.8 hrs today."

### 3. Timesheets (desktop)

A week grid — the screen the office manager uses on payroll day.

- Week selector at top (Mon–Sun), plus filters for site and crew member, and a prominent **Export to payroll** button.
- Rows = workers. Columns = Mon through Sun, then a **Total** column, then an **Approve** action.
- Each cell shows hours (`8.2`) with a tiny icon indicating provenance: a **pin icon = auto-captured by GPS**, a **pencil icon = manually edited** (and edited cells get an amber tint). This distinction is the whole trust story — make it legible.
- Overtime hours over 40 render in orange in the Total column. Show Miguel at 46.5 hrs.
- An **Exceptions** strip above the table listing three items needing attention: "Alicia Moreno — clocked in outside geofence Tue," "Danny Whitfield — no clock-out Wed, auto-closed at 6:00 PM," "Sam Nguyen — phone location off 1.5 hrs Thu." Each with Approve / Edit buttons.
- One expanded row detail showing the day broken out by job site (worker split 5.0 hrs Maple Ridge / 3.2 hrs Northgate), because guys move between sites and the hours have to land on the right job.
- Bottom summary bar: total hours, total labor cost, count approved vs pending.

### 4. Job sites list (desktop)

A grid of cards, one per site. Each card: site photo thumbnail (use a flat gray placeholder block with a small icon, no stock photography), site name, address, job type, a row of crew avatars currently on site, and three compact metrics — **hours this week**, **spend vs budget** (thin progress bar), **unread messages**. Status chip in the corner (Active / Starting Mon). Plus a "New job site" button.

### 5. Job site folder — the detail view (desktop)

This is the "folder for each job site" idea. Header with site name, address, job type, dates, foreman, and a crew avatar row. Below that, tabs: **Overview · Photos · Plans & Docs · Expenses · Chat · Time**.

Design all six tab states:

- **Overview** — left column: job details, scope notes, client contact, schedule dates. Right column: a compact activity feed ("Danny uploaded 4 photos · 20 min ago", "Receipt from Ferguson Plumbing logged to Expenses · $842.19 · 1 hr ago", "Miguel clocked in · 6:42 AM"). Small cards for hours-to-date, spend-to-date, budget remaining.
- **Photos** — a clean uploader dropzone at the top, then a date-grouped photo grid (gray placeholder tiles, no stock imagery). Each tile shows uploader initials and time on hover. Include a filter row: All / Progress / Issues / Before & After / Inspections. Show one tile flagged with a red dot as an "Issue" with a caption like "Water intrusion at NE corner — Miguel, 9:14 AM."
- **Plans & Docs** — a simple file list with type icons: `Maple-Ridge-Plans-RevC.pdf`, `Framing-Permit.pdf`, `Truss-Layout.pdf`, `Owner-Change-Order-2.pdf`, `Site-Survey.pdf`. Columns: name, uploaded by, date, size, version badge (`Rev C`), download. Highlight that Rev C supersedes Rev B — a small "2 older versions" link.
- **Expenses** — described in detail below.
- **Chat** — described in detail below.
- **Time** — hours logged on this site, by worker, with a small weekly bar chart and a table of who worked when. Total labor cost on this job.

### 6. Expenses tab + AI receipt capture

The workflow to show: a worker photographs an invoice or receipt on his phone, and it lands in the right job site's expenses, already read and categorized, waiting for the owner to confirm.

**Phone side — two frames:**
1. Camera view framing a receipt with a capture button and a hint "Snap the invoice — we'll file it."
2. Result screen: thumbnail on the left, extracted fields on the right — **Vendor:** Ferguson Plumbing Supply · **Date:** today · **Total:** $842.19 · **Tax:** $61.19 · **Category:** Materials — Plumbing · **Job site:** Maple Ridge. Each field is editable, with a subtle "AI read this" marker and a confidence treatment: high-confidence fields are plain, the **Job site** field shows a soft amber "Assumed from your location — tap to change." Big **Save to Maple Ridge** button. Show three parsed line items beneath (fittings, PVC, labor) collapsed under "3 line items."

**Desktop side — the Expenses tab:**
- Top row of small cards: **Spend to date $48,720 · Budget $65,000 · Remaining $16,280**, with a thin budget bar, plus a category breakdown as a simple horizontal bar list (Materials, Subs, Equipment Rental, Permits, Fuel) — no pie charts.
- A table of expenses: date, vendor, category, job site, amount, receipt thumbnail, submitted-by avatar, and a **status chip**: `Confirmed` (green), `Needs review` (amber), `Flagged` (red).
- Give three rows distinct AI-note treatments so the intelligence is visible:
  - Ferguson Plumbing $842.19 — `Needs review` — note: *"Read from photo. Matched to Maple Ridge from GPS at time of purchase."*
  - Home Depot $211.04 — `Confirmed` — note: *"Auto-categorized Materials — Lumber based on line items."*
  - United Rentals $1,340.00 — `Flagged` — note: *"Possible duplicate of invoice #88213 logged Tuesday. Also $340 over the equipment rental line."*
- One expanded row showing the receipt image side by side with extracted line items, so it's obvious the owner can verify what the AI read.

### 7. Chat

Two contexts, and I want both visible:

- **Job site channel** — a per-site thread the whole crew sees. Left rail lists channels (`#maple-ridge`, `#northgate-plaza`, `#harbor-view-3b`) with unread counts, then a **Direct messages** section listing individual workers with presence dots. Message thread shows a mix of text and inline attachments: Miguel posting a photo with "NE corner needs a look before drywall," Rosa asking about trim stock, the owner replying, and a **system message** in a distinct muted style: *"Danny Whitfield clocked in · 6:51 AM"* and *"Receipt from Ferguson Plumbing added to Expenses · $842.19."* Those system messages tie the whole app together — make them clearly not-a-person but still in the flow.
- **Direct message** — one-to-one thread with a single worker (Rosa), showing the owner sending a plan snippet and Rosa replying with a photo. Header shows her name, trade, and current site.
- Phone version of the site channel as a frame, since that's where crews will actually use it.

## How to build it

- One self-contained HTML page. Everything inline — no external CSS, fonts, scripts, images, or map tiles (they won't load). Use system fonts, inline SVG, and CSS for every visual.
- Make the left sidebar and the job-site tabs **actually clickable** so I can walk the owner through it live. Screens swap with plain JS show/hide. Phone frames can be static.
- Include a small screen index at the top so I can jump straight to any screen during the demo.
- Fill every screen with realistic data — no lorem ipsum, no empty states, no "Coming soon." A screen that looks half-built kills the pitch.
- Make it responsive enough to survive being shown on a laptop.

The whole point is that a contractor looks at this for 90 seconds and says "yes, that's what I want." Prioritize clarity and realism over cleverness.
