# Design brief — the rest of the Crewline phone app

Hand this to Claude along with `design/screens/isClockin.html` and
`design/screens/isCrewMobile.html` as reference. Those two are the house style;
everything below has to sit beside them without looking like a different product.

---

## 1. What this is

Crewline is a crew-tracking app for a residential builder in Adelaide, South
Australia. The wedge is automatic timesheets: a worker drives to a job site and
is on the clock before they get out of the ute. Nobody taps anything, nobody
forgets, and nobody gets paid for driving past — a two-minute settle window is
what stops a drive-by opening a shift.

There are two surfaces. The **office dashboard** is a dense desktop app (19
screens, already designed). The **worker app** is a phone, and only two of its
screens exist so far. This brief is the rest of the phone.

## 2. Who is holding the phone

A carpenter, 7am, on a slab, in the sun, gloves on, one hand free, phone in the
other. Cracked screen protector. Data is patchy.

That drives every layout decision:

- **Nothing smaller than a thumb.** Tap targets ≥ 44 px, and the primary action
  on a screen is a full-width bar, not an icon in a corner.
- **One column.** No side-by-side panels, no horizontal scroll, no tables.
- **Legible in daylight.** Body text ≥ 13.5 px. Muted grey is for labels, never
  for anything the worker has to read.
- **Say what happened, not what the system did.** "Left Maple Ridge at 3:31 PM —
  clocked out. 8.8 hrs today." Never "Event recorded."
- **Offline is normal.** Any screen that writes shows what is queued: a thin
  strip reading "Offline — 3 punches will sync", not a blocking error.

## 3. Hard rules

These are not style preferences, they are what the app is allowed to show.

- **No money on the phone. At all.** No pay rate, no job budget, no invoice, no
  estimate, no margin, no cost. A worker sees hours, never dollars. The existing
  file's chip says "Read-only on money and payroll" — keep that promise.
- **No other crews.** A worker sees jobs they are scheduled on and the people on
  site with them today. Not the full roster, not other sites.
- **Australian, throughout.** en-AU spelling. Metric — metres, not feet. AUD if
  a currency ever appears in the *office* screens. Adelaide street names and
  suburbs (Prospect, Norwood, Glenelg, Unley, Semaphore). Real trade language:
  chippie, sparky, brickie, RL, SWMS, White Card, toolbox talk. A 38-hour
  ordinary week, not 40. Dates as "Wed, 5 Aug". Times as "3:31 pm".
- **Never invent a number that has no source.** Every figure on these screens
  has to be something the app could actually compute. If a screen needs a total,
  say where it comes from.

## 4. File format — match this exactly

Each deliverable is one `.html` file in `design/screens/`, named `is<Thing>.html`,
following the structure of the two existing mobile files:

```
<sc-if value="{{ isThing }}">
  ... a 40px toolbar strip: "← Back to map" | context label | right-hand chip
  ... an <h1> (20px/600) naming the story, and a <p> (13.5px, #696D74, max-width
      790px) saying what problem these screens solve and why it matters commercially
  ... a flex-wrap row of phone columns, each 390px wide, gap 22px
```

Every phone column is:

1. A numbered step badge — 19 px circle, `#1A1D21` fill, white 10.5 px/700 text —
   next to a 13.5 px/600 label.
2. The device frame: `width:390px;height:844px;background:#2B2F33;border-radius:42px;padding:9px;box-shadow:0 8px 26px rgba(26,29,33,.18)`
3. Inside it: `background:#F5F6F7;border-radius:34px;overflow:hidden;display:flex;flex-direction:column`
4. A fake iOS status bar — 46 px tall, white, time on the left at 13.5 px/600,
   signal and battery SVGs on the right. Copy them verbatim from the existing
   files.

**Inline styles only. No classes, no `<style>` block, no external CSS.** That is
how the existing 21 files are written and the exporter depends on it.

Use `{{ handlebars }}` placeholders for repeated rows, exactly as
`isCrewMobile.html` does with `{{ j.name }}`, `{{ p.trade }}` and so on — one
real-looking row followed by a templated one.

## 5. Design tokens — use these, do not invent

Measured across all 21 exported screens; the number is how often each appears.

| Token | Hex | Use |
|---|---|---|
| ink | `#1A1D21` | headings, primary text |
| inkMid | `#4A5057` | body one step down |
| inkSoft | `#696D74` | secondary text |
| inkFaint | `#8B9096` | UPPERCASE LABELS, captions, meta |
| inkGhost | `#B7BCC2` | placeholder text only |
| border | `#DCE0E6` | every 1px divider |
| borderSoft | `#EDEFF1` | row dividers inside a list |
| appBg | `#F5F6F7` | screen background |
| panel | `#FFFFFF` | cards |
| rowFill | `#FAFBFC` | list header background |
| fill | `#F1F3F5` | muted chips |
| accent | `#007BFF` | links, active tab, selected border |
| accentFill | `#E7F1FF` | selected row tint |
| rail | `#2B2F33` | device bezel, avatars |
| success / ink / fill | `#28A745` / `#1B7A2C` / `#EAF7EC` | on the clock |
| alert / ink / fill | `#D2051E` / `#A00417` / `#FDECEE` | issues, overdue |
| warning / ink / fill | `#FFC107` / `#8A6100` / `#FFF9E8` | arriving, pending |

**The one primary button treatment**, used 24 times with no exceptions:

```
background:linear-gradient(180deg,#FFCD11,#F7B244); border:1px solid #E0A032;
color:#1A1D21; font-weight:700; letter-spacing:.04em; text-transform:uppercase
```

180 degrees, that stop order, always the border. Never a flat yellow button.

Type: 20px/600 page title · 17–18px/600 screen heading · 13.5px body · 12.5px
secondary · 12px/700 letter-spacing:.06em uppercase labels · 11px chips.
Radius: 3px controls, 8px cards, 13px pills, 34/42px the device.

## 6. The screens to produce

Six files. Each is one story told across 3–6 phone frames.

### A. `isCrewJob.html` — the job, as the crew sees it

`isCrewMobile.html` sketched this in one frame; it needs its own file. A job
detail with a tab bar: **Today · Photos · Plans · Chat**.

- **Today** — "YOUR TASK TODAY" with the cost code and a plain-English
  instruction. An "OPEN ISSUE — READ THIS" panel in `alertFill` when the site
  has an open issue, with the photo thumbnail. "ON SITE WITH YOU" — avatars and
  trades of whoever else is clocked in right now. A "PLANS — BUILD FROM REV C"
  strip naming the current drawing revision, because building from a superseded
  sheet is the expensive mistake.
- Tabs are `accent` underlined when active, `inkSoft` when not.
- Bottom: full-width **ADD PHOTOS** CTA and a secondary daily-log icon button.

### B. `isCrewPhotos.html` — the job's photos, on the phone

The gap that matters most: today a worker can send photos up and never see them.

- Filter chips: **All · Mine · Issues 2 · Progress**. Selected chip is
  `#1A1D21` fill, white text; the Issues chip carries a red dot when non-zero.
- Grouped by day — "Today · 11 photos", "Tue, 5 Aug · 9 photos".
- Three-across grid of square tiles. Each tile shows its timestamp bottom-right,
  a "YOU" tag if the worker took it, and a red dot if flagged as an issue.
- Tapping one opens a full-screen viewer: the photo, the caption, who took it,
  the time, the GPS badge ("On site"), and the category. Swipe between them.
- Bottom: full-width **TAKE PHOTO** CTA.

### C. `isCrewPlans.html` — the drawing, on a phone

- A sheet list first: sheet number, title, revision, and a red "SUPERSEDED"
  chip on anything that isn't current.
- Then the viewer: pinch-zoom, the sheet number floating top-left, and pins
  dropped on the drawing. A pin is a numbered circle — issue pins `alert`, note
  pins `accent`, photo pins `rail`.
- Tapping a pin raises a sheet from the bottom with its label, who dropped it,
  when, and the linked photo if there is one.
- A "Drop a pin here" mode with a crosshair, so a worker can mark exactly where
  the water is coming in.

### D. `isCrewTime.html` — my hours

The Time tab. This is the screen a worker checks on payday, so it has to be
unarguable.

- This week's total against the 38-hour ordinary week — a progress bar, hours
  as "31.4 / 38 hrs", and overtime shown separately if any.
- A day-by-day list: date, site, in and out times, total. Auto-recorded punches
  carry a small GPS tick; anything the office edited says so.
- Tapping a day expands it: the geofence evidence — "GPS put you 128 m inside
  the fence for 2 min before the clock started" — and a **"Not right? Fix this"**
  link into the punch-correction flow.
- A "Held for review" state in `warnFill` for a punch the office has flagged.
- **No pay rate and no dollar total anywhere on this screen.**

### E. `isCrewSafety.html` — inductions, SWMS and toolbox talks

- **My tickets**: White Card, EWP, asbestos awareness — each with an expiry date
  and a state. Expiring within 30 days is `warnFill`; expired is `alertFill` and
  says what it stops the worker doing.
- **Sign on**: the site induction and the SWMS for today's task, with a
  full-width **SIGN AND START** CTA and a finger-drawn signature box.
- **Toolbox talk**: today's topic, who ran it, and a tick-to-attend row.
- An unsigned SWMS should read as a blocker, not a suggestion.

### F. `isCrewFieldwork.html` — the daily log and receipts

- **Daily log**: weather (auto-filled from the site's location), what got done,
  who was on, materials delivered, delays. Voice-note button as the primary
  input, because typing with gloves on doesn't happen. Show a drafted log the
  worker reviews and edits, never one posted on their behalf silently.
- **Receipt capture**: photograph a docket, see the extracted vendor, date,
  total and line items *for review before anything is saved*, assign it to a
  job and a cost code. Show the review state, and show a low-confidence
  extraction with the uncertain fields flagged — that is the honest case.
- No dollar totals for the *job*; the receipt's own total is fine, it is the
  worker's own docket in their hand.

## 7. Also needed: the navigation

`isCrewMobile.html` specifies a bottom tab bar — **Jobs · Time · Photos · Chat**,
with an unread badge on Chat. Draw it once, properly, as a shared element at the
foot of every screen above: 4 tabs, icon over 10.5 px label, active tab in
`accent`, 56 px tall plus safe-area padding.

Note for whoever builds it: the app currently uses a six-tile grid on the Today
screen instead, and also has **Fix a Punch** and **Time Off** flows that appear
in no mock. Fold those two into the design — most likely under Time — so the
built app and the drawings agree.

## 8. What to hand back

Six `.html` files in `design/screens/`, plus one short note listing any decision
you made that the brief did not cover, and anything you think is wrong with the
brief. If a screen needs data the app cannot produce, say so rather than drawing
a plausible number — a mock that asserts data the database has no column for is
how a screen gets built twice.
