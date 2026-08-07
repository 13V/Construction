# Notes back on the six phone screens

## Where they live

The brief asked for six files in `design/screens/`. The 21 existing screens are not 21
files — they are 21 `<sc-if>` blocks in one document, driven by one `screen` state and one
demo index. Six separate files could not have shared the left nav, the keyboard paging or
the index, and would have drifted from the house style within a week. So the six stories
are six new screens **inside `Crewline.dc.html`**, numbered 12–17 in the demo index, keyboard
order after Crew time. Every structural rule in section 4 is kept: the 40 px toolbar strip,
the h1 + 13.5 px/790 px paragraph, the 390 px phone columns at gap 22, the numbered step
badge, the verbatim status bar, inline styles only.

## Decisions the brief did not cover

**`isCrewTime` was already taken.** A screen called `crewtime` exists — corrections,
sign-off, breaks, switching jobs. The brief's D is a different screen (this week's total,
the day list). I named the new one **`crewhours`** and left the old one alone. The two
overlap on Fix a Punch; the old screen tells it from Alicia's side, the new one from the
Time tab. Worth merging later, but not by me, silently.

**Chat.** Section 7 puts Chat in the tab bar and section 6A puts a Chat tab on the job, but
no screen draws it. I drew it as the fourth tab inside `crewjob` — tap it in frame ①.
It is the site channel, which is what the schema has (one per site, auto-created).

**Fix a Punch and Time Off.** Both under Time, per section 7. Time Off is a segmented
control at the top — Hours · Time off — because it is a peer of your hours, not a child of
one shift. Fix a Punch is not: it is about a single punch, so it starts by tapping that day
and hitting "Not right? Fix this". The five reasons on that screen are the exact five
`shift_corrections.reason_code` values, not invented ones.

**The tab bar wins; the six-tile grid goes.** Frame ③ on `crewjob` draws both at size and
says why. The tiles are all one-way trips, so there is no persistent home for Time or
Photos — which is fatal for the two screens a worker opens most. Safety and Fieldwork
deliberately get no tab: they are moments, not places.

**Tap targets.** The brief says ≥ 44 px, the existing files use 34–38 px chips. I went with
44 px for anything that is genuinely tappable (filter chips, tab bar rows, list rows,
signature box) and left the read-only status pills small. The photo filter chips are
therefore visibly chunkier than the ones on `isCrewMobile`.

**Imagery.** Striped placeholders with a monospace label everywhere a real photo or drawing
goes — site photos, the docket, sheet A-12, the fence map. All of them are drop-in slots;
nothing is hand-drawn.

## What I think is wrong with the brief

**1. The Australian rule fights the other 21 screens.** Section 3 says en-AU, metric,
Adelaide suburbs, a 38-hour week. The existing screens say `0.3 mi`, `128 ft`, `$42.00`,
`Aug 5`, and — on the crew time screen — "Meal break not taken, **CA rule**". They are a
US product. I followed the brief: the six new screens are metric, en-AU, 38 hours,
"Wed, 5 Aug", "3:31 pm", real trade language. I kept the four **site names** (Maple Ridge,
Northgate Plaza…) because they are in the shared left nav on every screen, and gave them
Adelaide addresses instead. This is the one decision I would most like overturned or
confirmed: either these six are the start of an AU conversion of all 21, or section 3
should lose the Australian rule. Half a product in each is worse than either.

**2. "Never invent a number" is the best rule in the brief, and four things break it.**
Each is called out on the screen itself, in an amber or red panel, rather than drawn as a
plausible number:

- **The SWMS and the induction have no table.** A safety record can only be a JHA, an
  incident, a toolbox talk or a hazard. Neither document on the sign-on screen has a row to
  live in and neither signature has anywhere to land. This is the largest gap in the six —
  it is a schema change, not a screen, and E cannot be built until it is made.
- **"What an expired ticket stops you doing" has no source.** A certification stores a name
  and an expiry. Either ship a fixed ticket → restriction map, or that sentence goes and
  the card just shows the date. I drew it because the brief asked for it; it is invented.
- **The weather is not auto-filled by anything.** There is a free-text weather column and a
  lat/lng on every site, but nothing joins them. Section 6F says "auto-filled from the
  site's location" as though it exists. It also needs a decision: the 7 am observation, the
  day's range, or rain since midnight? I drew range + rainfall, because that is what a
  delay claim argues about.
- **Receipt confidence is per-docket, not per-field.** Screen F flags four uncertain fields.
  There is one `ai_confidence` number for the whole read. Either add per-field confidence,
  or the rule gets cruder — below a threshold, nothing is pre-filled at all.

**3. The 38-hour week is a constant, and it will be wrong for someone.** Nothing stores a
worker's ordinary hours. The first part-timer, apprentice on a different award, or anyone
on a 76-hour fortnight gets a wrong denominator on the one screen the brief says has to be
unarguable. One column on `workers` fixes it.

**4. There is no leave balance anywhere, and the brief nearly implies one.** Time Off shows
requests and their status and never "12.4 days accrued", because accruals live in payroll.
If workers expect a balance on this screen, that is an integration, not a screen.

**5. A plan pin has no resolved state.** Only created. So the pin count on a sheet only ever
grows and there is no honest way to draw "2 open, 6 done". Decide before this ships whether
pins are permanent annotations or have a lifecycle.

**6. Section 2 says "no tables", section 6D asks for a day-by-day list with in, out and
total.** That is a table. I drew it as rows with the total right-aligned and the evidence
hidden until you tap the day, which is the phone-shaped version of the same information —
but it is worth being explicit that four columns of numbers is what payday actually needs.

## Small things

- "Issues 2" on the photo filter is a live count of `category = 'issue'`, so it will be 0
  on a clean job. The chip keeps its red dot only when non-zero, as specified.
- The offline strip appears on the job Chat tab and the photo upload flow. I did not put it
  on read-only screens, since nothing is queued there.
- `RL` is used in the brief as trade language (reduced level). I avoided giving anyone those
  initials so the avatars do not read as a survey abbreviation.
- Every phone frame shows only jobs Sam is scheduled on and only people clocked in at his
  site today. No money appears anywhere on any of the six except the worker's own docket
  total, per section 3.
