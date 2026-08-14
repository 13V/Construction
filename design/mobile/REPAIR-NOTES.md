# Repair log — Crewline-Mobile.dc.html

## RESOLVED
A scripted edit matched the **live** sheet in set 1 instead of the **static illustration**
in set 3 (both used `height:439px`) and deleted ~48k chars between them, taking out all of
screen set 2 and the wrappers for sets 2 and 3.

Restored:
- **Set 2 "The job shell"** — rebuilt: the looping swap animation (390x844, four layers),
  the "What happens when" timing table, "Three bars, one shape", and "Nineteen things,
  four tabs and a fifth". The six `@keyframes` and `swapSteps` had survived in the helmet
  and logic class, so only markup needed writing back.
- **Set 3 "Half sheets"** — given back its own `isSheets` wrapper, heading and toolbar;
  frames renumbered 1-4. Its medium-detent illustration is not redrawn: the charcoal sheet
  is now LIVE on set 1 frame 1, which is better than a still, and set 3 links to it.
- Template balanced: sc-if 92/92, sc-for 125/125, logic parses, 6 animations run.

## Rule that caused this — do not repeat
Never locate an edit with a bare `indexOf` on markup that repeats across screen sets.
Anchor forward from a heading unique to the target set, and assert the slice length is
both positive and smaller than that set.
