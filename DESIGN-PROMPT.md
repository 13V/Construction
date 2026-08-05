# Design prompt — construction crew tracking app

Paste everything below the line into Claude to generate the visual prototype.

Style direction is modeled on **Fieldwire (by Hilti)** — see [STYLE-REFERENCE.md](STYLE-REFERENCE.md)
for the analysis the palette and chrome specs below are drawn from.

---

Build me a clickable visual prototype of a workforce tracking app for a small-to-mid construction company (roughly 6–40 field workers, 3–8 active job sites). This is a **pitch mockup**, not working software — it needs to look real enough that a construction business owner immediately understands the product, but nothing has to actually function beyond navigating between screens.

## Who uses it

There are two surfaces, and I want to see both:

1. **Owner / office dashboard** — desktop web. The owner and his office manager live here. They watch the map, approve timesheets, manage job site folders, review expenses.
2. **Worker app** — phone. Simple, glanceable, big touch targets, usable with gloves on and in sunlight. Show these as phone frames (roughly 390×844) rendered next to or below the desktop screens.

## Visual direction

Follow the design language of **Fieldwire by Hilti** — a field-first construction tool. The governing principle: **the content is the canvas, and the chrome recedes.** Thin quiet navigation, and all the real information living as markers on a map or rows in a dense table.

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

**Typography:** Inter for headings, Lato (or system sans) for body — that's Fieldwire's actual pairing. UI type is small and dense: **13px in tables and sidebars, 14px body, 16px section headings.** Use tabular numerals for all times, hours, and dollar amounts.

**Chrome:**
- **Small radii** — 3px on buttons, 8px on cards. Nothing pill-shaped except status chips.
- 1px `#DCE0E6` borders do the separating work. Almost no shadows — only floating elements above the canvas get one.
- **Buttons:** secondary = white fill, thin gray border, dark label. Primary = the gold gradient. Fieldwire sets button labels in **UPPERCASE with ~0.04em letter-spacing** — do that for primary CTAs only, sentence case elsewhere.
- Icons are small, monochrome, line-style. No filled/duotone icon sets, no emoji.
- Generous whitespace in marketing-ish surfaces, genuinely dense in working surfaces (tables, roster lists). Don't let the timesheet breathe — contractors want to see the whole week at once.

**Two-row top chrome** (copy this structure):
- Row 1: project/company switcher on the far left with a small circular logo mark, a search field, then right-aligned: notification bell, help `?`, and the user's name with a chevron.
- Row 2: a toolbar of small bordered buttons — contextual actions left-aligned (`← All sites`, `Actions ▾`), filters and view controls right-aligned.

**Left sidebar** (~190px, white, thin right border): small icon + label rows — Map, Timesheets, Job Sites, Crew, Expenses, Files. The active row gets a **full-width pale blue `#E7F1FF` band with the icon and label in `#007BFF`**. Below a divider, a small gray section label "JOB SITES" with the four active sites listed as sub-items.

**Floating dark tool rails** — this is Fieldwire's signature move and I want it on the map screen. A vertical charcoal rail with white line icons, rounded 6px, floating over the canvas rather than docked in a panel. It reads clearly over any background.

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

**Canvas-first, exactly like Fieldwire's plan viewer.** The map is the content — it runs edge to edge under the two-row top chrome, with no card wrapper and no padding around it. Everything else floats on top.

- **Do not embed a real map service** — draw a stylized, abstract map as inline SVG/CSS: soft gray blocks for parcels, thin white road lines, a couple of street labels. It should read as "map" at a glance without any external tiles or images.
- **Floating charcoal tool rail**, top-left over the canvas: fullscreen, zoom in, zoom out, then a divider, then filter-by-site, layers, and a "recenter" target icon.
- Each job site is a **pin marker** with a translucent blue circle around it — that's the **geofence**. Site pins use the accent blue; the circle is `#007BFF` at ~12% opacity with a 1px stroke. Label chip on each: "Maple Ridge · 500 ft · 3 on site".
- Workers are small circular avatars with initials, clustered inside geofences, with a colored ring for status (green on the clock, amber traveling, red exception). Sam sits on a road between two sites with a small motion treatment. **Alicia sits just outside a geofence ring with a `#D2051E` marker** — borrow Fieldwire's red markup convention: red always means "a human needs to look at this."
- **Floating roster panel**, docked right over the canvas (white, 8px radius, subtle shadow, ~300px): crew grouped by site, each row = avatar, name, trade, clock-in time, status dot. Alicia's row flagged "Outside geofence — review" in red.
- **Floating stat strip**, top-center or top-right: **On the clock 4 · Active sites 3 · Hours today 21.5 · Labor cost today $1,284**. Compact, tabular numerals.
- A small dark date/time chip bottom-left (Fieldwire puts one exactly there), plus a day scrubber for replaying where crews were. Static is fine — just show the control.
- Visible and unmissable, a small privacy line: **"Location tracked 6:00 AM – 4:00 PM on scheduled shifts only."** This matters to me — workers need to see the app isn't following them home.

### 2. Auto clock-in — worker phone

This is the feature I'm selling, so give it three phone frames side by side telling the story. Follow Fieldwire's mobile pattern: **white chrome, blue interactive elements, content dominant, one floating dark rail for actions.**

1. **Approaching** — driving toward site, card reads "Maple Ridge · 0.3 mi away — you'll clock in automatically when you arrive."
2. **Clocked in** — big green confirmation: "Clocked in at 6:42 AM · Maple Ridge," with a small map thumbnail showing arrival inside the geofence, plus "Automatic — you didn't have to do anything." A subtle blue "Not right? Fix this" text link.
3. **On the clock (today view)** — running hours counter (`2:47` elapsed), today's site, crew also on site (row of avatars), and three big buttons: **Take Photo**, **Upload Receipt**, **Site Chat**. Below, today's timeline: arrived 6:42 AM, break 9:30–9:45, still on site.

Show the auto clock-out counterpart small: a phone notification reading "Left Maple Ridge at 3:31 PM — clocked out. 8.8 hrs today."

### 3. Timesheets (desktop)

A week grid — the screen the office manager uses on payroll day. **Dense. 13px type. This is the screen that should look like a serious tool.**

- Row-2 toolbar: week selector (Mon–Sun), site filter, crew filter on the left; **Export to payroll** as the gold CTA on the right.
- Rows = workers. Columns = Mon through Sun, then **Total**, then an **Approve** action.
- Each cell shows hours (`8.2`) with a tiny icon indicating provenance: a **pin icon = auto-captured by GPS**, a **pencil icon = manually edited** (edited cells get a soft amber tint). This distinction is the whole trust story — make it legible.
- Overtime over 40 hrs renders red in the Total column. Miguel is at 46.5.
- An **Exceptions strip** above the table — white panel, red left border, listing three items: "Alicia Moreno — clocked in outside geofence Tue," "Danny Whitfield — no clock-out Wed, auto-closed 6:00 PM," "Sam Nguyen — phone location off 1.5 hrs Thu." Each with Approve / Edit.
- One expanded row showing a day broken out by job site (5.0 hrs Maple Ridge / 3.2 hrs Northgate) — guys move between sites and the hours have to land on the right job.
- Bottom summary bar: total hours, total labor cost, approved vs pending counts.

### 4. Job sites list (desktop)

A grid of cards, one per site. Each: thumbnail (flat gray placeholder block with a small line icon — **no stock photography**), site name, address, job type, crew avatar row, and three compact metrics — **hours this week**, **spend vs budget** (thin progress bar), **unread messages**. Status chip in the corner (Active / Starting Mon). Gold **New job site** button in the toolbar row.

### 5. Job site folder — the detail view (desktop)

The "folder for each job site." Header with site name, address, job type, dates, foreman, crew avatar row. Below, tabs: **Overview · Photos · Plans & Docs · Expenses · Chat · Time**. Style the tabs Fieldwire-style: text labels with a 2px blue underline on the active one, not boxed tabs.

Design all six tab states:

- **Overview** — left column: job details, scope notes, client contact, schedule dates. Right column: a compact activity feed ("Danny uploaded 4 photos · 20 min ago", "Receipt from Ferguson Plumbing logged to Expenses · $842.19 · 1 hr ago", "Miguel clocked in · 6:42 AM"). Small stat cards: hours to date, spend to date, budget remaining.
- **Photos** — dropzone at top, then a date-grouped grid (gray placeholder tiles). Uploader initials and time on each tile. Filter row: All / Progress / Issues / Before & After / Inspections. One tile carries a red dot as an "Issue," captioned "Water intrusion at NE corner — Miguel, 9:14 AM."
- **Plans & Docs** — a file list with type icons: `Maple-Ridge-Plans-RevC.pdf`, `Framing-Permit.pdf`, `Truss-Layout.pdf`, `Owner-Change-Order-2.pdf`, `Site-Survey.pdf`. Columns: name, uploaded by, date, size, version badge (`Rev C`), download. A "2 older versions" link showing Rev C supersedes Rev B. **Then, below the list, show an opened plan in a viewer** — the blueprint as simple black line work on white, canvas-first, with the floating charcoal tool rail (pin, measure, markup, text, camera) and **two or three red pin markers dropped on the drawing**: one labeled "Photo — NE corner," one "Issue #2 — water intrusion." Pinning a photo or a problem to a spot on the actual plan is the thing that will sell this tab.
- **Expenses** — detailed below.
- **Chat** — detailed below.
- **Time** — hours logged on this site by worker, a small weekly bar chart, a table of who worked when, total labor cost on the job.

### 6. Expenses tab + AI receipt capture

The workflow: a worker photographs an invoice on his phone, and it lands in the right job site's expenses, already read and categorized, waiting for the owner to confirm.

**Phone side — two frames:**
1. Camera view framing a receipt, capture button, hint "Snap the invoice — we'll file it."
2. Result screen: thumbnail left, extracted fields right — **Vendor:** Ferguson Plumbing Supply · **Date:** today · **Total:** $842.19 · **Tax:** $61.19 · **Category:** Materials — Plumbing · **Job site:** Maple Ridge. Fields editable, each with a subtle "AI read this" marker. High-confidence fields plain; the **Job site** field carries a soft amber note "Assumed from your location — tap to change." Gold **Save to Maple Ridge** button. Three parsed line items collapsed under "3 line items."

**Desktop side — the Expenses tab:**
- Stat cards: **Spend to date $48,720 · Budget $65,000 · Remaining $16,280**, thin budget bar, plus a category breakdown as a horizontal bar list (Materials, Subs, Equipment Rental, Permits, Fuel). **No pie charts.**
- Table: date, vendor, category, job site, amount, receipt thumbnail, submitted-by avatar, **status chip** — `Confirmed` (green), `Needs review` (amber), `Flagged` (red).
- Three rows with distinct AI-note treatments so the intelligence is visible:
  - Ferguson Plumbing $842.19 — `Needs review` — *"Read from photo. Matched to Maple Ridge from GPS at time of purchase."*
  - Home Depot $211.04 — `Confirmed` — *"Auto-categorized Materials — Lumber based on line items."*
  - United Rentals $1,340.00 — `Flagged` — *"Possible duplicate of invoice #88213 logged Tuesday. Also $340 over the equipment rental line."*
- One expanded row showing the receipt image beside the extracted line items, so it's obvious the owner can verify what the AI read.

### 7. Chat

Two contexts, both visible:

- **Job site channel** — left rail lists channels (`#maple-ridge`, `#northgate-plaza`, `#harbor-view-3b`) with unread count badges, then a **Direct messages** section listing workers with presence dots. Thread mixes text and inline attachments: Miguel posting a photo with "NE corner needs a look before drywall," Rosa asking about trim stock, the owner replying. Include **system messages** in a distinct muted gray style: *"Danny Whitfield clocked in · 6:51 AM"* and *"Receipt from Ferguson Plumbing added to Expenses · $842.19."* Those tie the whole app together — clearly not-a-person, but in the flow.
- **Direct message** — one-to-one with Rosa: owner sends a plan snippet, Rosa replies with a photo. Header shows her name, trade, current site.
- Phone version of the site channel as a frame, since that's where crews actually use it.

## How to build it

- One self-contained HTML page. Everything inline — no external CSS, fonts, scripts, images, or map tiles (they won't load). Use system fonts, inline SVG, and CSS for every visual.
- Make the left sidebar and the job-site tabs **actually clickable** so I can walk the owner through it live. Screens swap with plain JS show/hide. Phone frames can be static.
- Include a small screen index at the top so I can jump straight to any screen during the demo.
- Fill every screen with realistic data — no lorem ipsum, no empty states, no "Coming soon." A screen that looks half-built kills the pitch.
- Responsive enough to survive being shown on a laptop.

The whole point is that a contractor looks at this for 90 seconds and says "yes, that's what I want." Prioritize clarity and realism over cleverness.
