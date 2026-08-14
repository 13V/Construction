# Crewline Simple — the design the app ships with

The 11-screen phone design that replaces the 272-screen programme as what
actually gets built. **This is the build target for the first TestFlight
build, implemented exactly as drawn.**

## Where this file came from

The checked-in copy is the one from the design project's own zip export
(uploaded 14 Aug), byte-identical in content to the claude.ai artifact
"Waiting for handoff files" — the two differ only in attribute serialization
(`viewBox` vs `sc-camel-view-box`, etc.) and the artifact's injected badge.
The design references `./support.js` (checked in beside it) and two React 18
UMD script URLs on unpkg.

So: **opening this file needs network access** for React 18.3.1, or serve
`react.production.min.js` / `react-dom.production.min.js` locally and rewrite
the two script tags. The `shots/` directory exists so the design is reviewable
with no browser at all.

## What it is

One interactive phone (390 × 844), eleven screen states, driven by the demo
chrome across the top. Not a side-by-side review canvas like
`../Crewline-Mobile.dc.html` — this one behaves like the app.

| Screen | What it holds |
|---|---|
| Home | dark calendar card (today + tomorrow, `Open schedule`), ON SITE and ATTENTION counters, today's jobs with colour edges and chips (`2 defects`, `Needs you`) |
| Job | dark header (name · suburb · trade · builder, `3 on site · 62% done`), camera always in reach, and **six tabs: Photos · Plans · Waterproofing · Chat · Money · Crew** |
| Projects | notifications, active projects with progress and assignment, future projects |
| New project | name, address, client, scope, **contract value ex GST** ("Margin only works once this is in"), start date, contract PDF attach, crew assignment, job colour |
| Schedule | week strip, tap a day then a job |
| Chat | job chats separate from people; NEEDS A REPLY block; DMs |
| Me | identity (owner · company), and the personal surface |
| Sign-up | three steps, starting with a photo of yourself |
| plus | photo capture flow, doc viewer, DM thread |

## Facts to build from

- **Accent is a prop, default `#6E56CF` (purple).** The Crewline blue
  `#007BFF` is one of the *options*, not the default. "Exact, no changes"
  means purple.
- Muted text is `#7B838B` (61 uses) — the readable grey. `#8B9096` appears
  only 25 times, in genuinely decorative roles. This settles the contrast
  argument the v2 brief fumbled: the design itself already made the swap.
- The rest of the palette is the existing system: ink `#1A1D21`, border
  `#DCE0E6`, bg `#F5F6F7`, charcoal `#2B2F33`, plus a deep red `#A3282E`
  and green `#1F7A4D` for status.
- Type runs 10–30px with the mass at 12.5–15.5 — the phone scale, not the
  dashboard's.
- The Money tab's own caption: *"Only owners and the office see this tab."*
  The design already encodes the role model the database enforces
  (schema_v17/v18/v24). Waterproofing as a first-class tab matches
  schema_v19.
- Every figure drawn maps to something that exists: margin → `job_profit_v`,
  Claimed → `invoices`, Variations "3 with the builder" → `change_orders`,
  Tile supply / Materials & hire → `materials` + `expenses`, Crew →
  `crew_v` + `shifts`.

## What this supersedes

`PROMPT-mobile-v2.md` §7's five-tab architecture and the 272-screen
inventory remain the reference for *behaviour* detail (states, offline,
error copy) where this document is silent — but where they disagree on
structure, **this document wins**. Six in-job tabs, five root tabs
(Home · Projects · Schedule · Chat · Me), purple accent.
