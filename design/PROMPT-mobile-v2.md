# Design brief — the Crewline phone app, all of it

Hand this to Claude Design together with:

- `design/mobile/Crewline-Mobile.dc.html` — the phone screens that already exist
- `design/screens/isClockin.html` and `design/screens/isCrewMobile.html` — the two
  original phone screens, and the house style everything else grew from
- `design/mobile/NOTES-mobile.md` — the decisions already taken, which stand
- `apps/dashboard/src/theme.ts` — the tokens, measured from the 21 desktop screens

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
2. **An employee sees themselves.** Their hours, their photos, the jobs they are rostered
   on. Not a colleague's rate, not another job's defect list.
3. **The server owns the clock.** No screen may imply the phone decided a shift started.
   Clock-in is a consequence of where you were, confirmed by the server, and the two-minute
   settle window is real — a drive-by must not open a shift.
4. **Location honesty.** Tracking records a position roughly every 20 seconds while it is
   on, *including the drive to work*, and the office can see the trail. The app says so
   plainly. Do not draw copy implying it only records on site — an earlier version did, and
   it was wrong.
5. **Nothing invented.** Every figure on every screen comes from something the database
   actually holds. Where the inventory below names columns, use those.
6. **Unapproved work is not value.** A pending variation adds nothing to a contract sum and
   must never be drawn as though it does.

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

## 7. The screens
