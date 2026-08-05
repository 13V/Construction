# Style reference — Fieldwire (by Hilti)

Analysis of https://www.fieldwire.com, taken from the live stylesheets and product
screenshots rather than from impressions. This is the source for the visual direction
in [DESIGN-PROMPT.md](DESIGN-PROMPT.md).

## The governing idea

**The content is the canvas; the chrome recedes.** In Fieldwire's plan viewer the blueprint
runs edge to edge and every control floats on top of it in a dark rail. Navigation is thin
and quiet. Nothing competes with the thing the user actually came to look at.

That translates directly to a crew tracking app: the **map is the canvas**, worker and job
site markers are the data, and the roster, stats, and controls float above it.

## Palette (pulled from the production CSS)

| Role | Hex | Notes |
|---|---|---|
| App background | `#F5F6F7` | Very light warm gray |
| Panels | `#FFFFFF` | |
| Primary text | `#1A1D21` | Near-black, slightly cool — most-used color in the CSS after white |
| Secondary text | `#696D74` | |
| Borders | `#DCE0E6` | 1px, does all the separating work |
| Interactive accent | `#007BFF` | Links, active nav, selected states, prices |
| Active nav fill | pale blue band | Full-width highlight behind the active sidebar row |
| Tool rails | `#2B2F33` | Charcoal, white line icons, floats over canvas |
| Brand CTA | `#F7B244 → #FFCD11` | Gold gradient, dark text, uppercase label |
| Alert / markup | `#D2051E` | Hilti red — issues, RFIs, anything needing a human |

Blue is the *interactive* accent; gold is reserved for the single highest-emphasis CTA per
screen; red means "look at this." The UI is otherwise achromatic.

## Type

- **Inter** for headings, **Lato** for body — a real pairing in their CSS, not a guess.
- Dense working type: 13px and 14px dominate the UI; 1rem body; 2.5–3rem display headings.
- Primary button labels are **uppercase with ~0.04em letter-spacing**.

## Chrome details worth stealing

- **Small radii** — 3px buttons, 8px cards. Nothing pill-shaped.
- **Two-row top bar.** Row 1: project switcher (circular logo mark + name + chevron), search,
  then bell / help / user menu. Row 2: contextual actions left (`← All plans`, `Actions ▾`),
  filters and view controls right — all small white buttons with thin borders.
- **Sidebar ~190px**, white, small line icon + 13px label. Active row = full-width pale blue
  band with icon and label in blue. Divider, then a small gray section label with sub-items.
- **Floating charcoal tool rails** over the canvas — vertical stacks of white line icons,
  ~6px radius. Zoom controls in one stack; drawing/markup tools in another. Legible over any
  background, which is why they work over both blueprints and maps.
- **Pin markers as first-class objects.** On mobile, RFIs and issues are colored pins dropped
  directly on the drawing, with callout labels and freehand red markup. The pin *is* the
  record — tap it to open it.
- Small dark date chip bottom-left of the canvas; sheet paging arrows bottom-left.
- Marketing surfaces are much airier than the product: big bold near-black headings, a short
  gold underline bar as a section accent, industrial site photography with a cool overlay,
  white cards with thin borders, hollow-circle bullet lists in blue.

## What not to carry over

- Their marketing hero photography — a mockup filled with stock construction photos reads as
  a template. Flat gray placeholder blocks look more like real software.
- Bootstrap's default blue-heavy button set. Fieldwire ships on Bootstrap, but the product UI
  is far more restrained than the framework defaults.
