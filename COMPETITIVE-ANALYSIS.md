# Competitive analysis

Research across the two markets this app sits between: **builder business platforms**
(Jack, Buildertrend) and **GPS field-ops tools** (Workyard, busybusy, ClockShark).

## The key finding

**Jack has no GPS tracking at all.** It's an Australian builder platform built around the
money — estimating, takeoffs, cashflow forecasting, invoicing, client portals. The GPS
auto-clock-in idea that started this project lives in a *different* product category
(Workyard, busybusy, ClockShark), and none of those tools do the commercial side well.

So "match Jack's features" and "build the GPS tracking app" are two different products.
The opportunity is the union — but the demo has to lead with one.

## Who does what

| | **Jack** | **Buildertrend** | **Workyard** | **busybusy** | **ClockShark** |
|---|---|---|---|---|---|
| GPS tracking / breadcrumbs | — | — | ✅ core | ✅ core | ✅ |
| Geofenced auto clock-in | — | — | ✅ (top tier only) | ✅ | ✅ |
| Timesheets & approval | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cost codes / job costing | ✅ | ✅ | ✅ | ✅ deepest | ✅ |
| Scheduling / dispatch | ✅ | ✅ | ✅ (Pro+) | ✅ | ✅ |
| Photos with GPS+time stamp | ✅ | ✅ | ✅ | ✅ | — |
| Plans & documents | ✅ | ✅ | — | ✅ basic | — |
| Daily logs / reports | ✅ | ✅ | ✅ forms | ✅ | — |
| Expenses / receipt capture | ✅ | ✅ | ✅ + expense cards | ✅ basic | — |
| **AI reads & files the receipt** | — | — | — | — | — |
| Estimating & takeoffs | ✅ core | ✅ | — | — | — |
| Purchase orders | ✅ | ✅ | — | — | — |
| Invoicing / progress claims | ✅ | ✅ | — | — | ✅ |
| Cashflow forecasting | ✅ core | — | — | — | — |
| Change orders / variations | ✅ | ✅ | — | — | — |
| Client portal | ✅ free users | ✅ | — | — | — |
| Sub / vendor portal | ✅ free users | ✅ | — | — | — |
| Safety — JHA, incidents | ✅ | — | ✅ forms | ✅ | — |
| Equipment tracking | — | — | ✅ forms | ✅ differentiator | — |
| Offline mode | — | — | ✅ | ✅ | ✅ |
| Crew/supervisor bulk clock-in | — | — | ✅ | ✅ | ✅ |
| Payroll integrations | Xero | ✅ | ✅ 9+ systems | ✅ | ✅ |
| Real chat | — | portal comments | — | — | — |

## Pricing for context

- **Jack** — $299/mo base incl. 1 full user, then $18/full user, $8/mobile-only. **Subs, vendors and clients are free users.** That free-portal-user model is a real growth lever.
- **Workyard** — $50/mo base + $8/user (Starter), $16/user (Pro). Notably, **automatic worksite detection is gated to their top "Autopilot" tier** — the headline feature is an upsell.
- **busybusy** — free tier exists, paid ~$11–20/user.
- **ClockShark** — ~$8–10/user + base.

## Gaps worth attacking

Four things the research surfaced that nobody handles well:

1. **Drive-by clock-ins.** The single most common complaint about geofencing — reviewers report Workyard "sometimes clocks people in just when they drive by." Fix it visibly with a dwell requirement (must stay inside the fence a few minutes before the punch counts) and show rejected drive-bys in the UI.
2. **Buddy punching.** ClockShark's answer is facial recognition at clock-in. Owners care about this a lot; it's worth at least a photo-verification treatment.
3. **Daily logs are still manual.** Everyone makes the foreman fill out a form at 4pm. We already know who was on site, for how long, what photos were taken, and what got bought — the log should draft itself and just ask for confirmation.
4. **Comms are an afterthought.** Buildertrend has portal comments, Fieldwire has task threads, the GPS tools have nothing. A real per-site chat with clock-ins and expenses threading through as system messages is genuinely differentiated.

## Recommended positioning

Lead with **GPS-first field operations** and carry the commercial modules behind it.
Leading with estimating makes this a worse Jack. Leading with the live map and automatic
timesheets — with the money features present — makes it something neither category has.
