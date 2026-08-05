# Competitor pricing — modeled at 20 users

Published list prices as of August 2026. Modeled on a realistic 20-person construction
company: **3 office users** (owner, office manager, PM/estimator) + **17 field workers**.

> ⚠️ **Jack prices differently by region and the gap is large.** Its pricing page carries two
> separate card sets. **AUD: $349/mo base + $59 per Full Access user + $10 per Mobile Only.**
> **USD: $299/mo base + $18 Full Access + $8 Mobile Only.** An AUD Full Access seat is $59
> against USD $18 — about A$84 vs A$26 at current rates, roughly **3× the price in its home
> market**. Check which market you're pricing for before using any of this.

## AUD — for an Australian buyer

| Product | Plan | Monthly | Annual | Billed in |
|---|---|---|---|---|
| Workyard | Starter (annual) | **A$242** | A$2,904 | USD |
| Workyard | Starter (monthly) | **A$299** | A$3,588 | USD |
| ClockShark | Standard | **A$313** | A$3,756 | USD |
| busybusy | Pro | **A$327** | A$3,924 | USD |
| ClockShark | Pro | **A$398** | A$4,776 | USD |
| busybusy | Premium | **A$462** | A$5,544 | USD |
| Buildertrend | custom (low est.) | **A$482** | A$5,784 | USD |
| Workyard | Pro | **A$526** | A$6,312 | USD |
| **JACK** | **annual** | **A$584** | **A$7,007** | **AUD** |
| **JACK** | **monthly** | **A$637** | **A$7,644** | **AUD** |
| Fieldwire | Pro | **A$1,220** | A$14,640 | AUD |
| Buildertrend | custom (high est.) | **A$1,562** | A$18,744 | USD |
| Fieldwire | Business | **A$2,000** | A$24,000 | AUD |
| Fieldwire | Business Plus | **A$2,780** | A$33,360 | AUD |

USD-billed products converted at **1 AUD = 0.7035 USD** (4 Aug 2026). Those buyers also carry FX and card fees.

## USD — for a US buyer

| Product | Plan | Monthly | Annual |
|---|---|---|---|
| Workyard | Starter (annual) | **$170** | $2,040 |
| Workyard | Starter (monthly) | **$210** | $2,520 |
| ClockShark | Standard | **$220** | $2,640 |
| busybusy | Pro | **$230** | $2,758 |
| ClockShark | Pro | **$280** | $3,360 |
| busybusy | Premium | **$325** | $3,898 |
| Workyard | Pro | **$370** | $4,440 |
| **JACK** | **annual** | **$432** | **$5,181** |
| **JACK** | **monthly** | **$471** | **$5,652** |
| Fieldwire | Pro | **$780** | $9,360 |
| Fieldwire | Business | **$1,280** | $15,360 |
| Fieldwire | Business Plus | **$1,780** | $21,360 |
| Buildertrend | custom quote | ~$339–$1,099 | flat, unlimited users |

Workyard Autopilot is custom-quoted and unpublished in both currencies — see the warning below.

## The math, product by product

**JACK** — base fee includes one Full Access user; annual billing gives one month free (so annual = 11 months).
- **AUD:** `$349 + (2 × $59) + (17 × $10) = A$637/mo`. Annual: `(349 × 11) + (2 × $649) + (17 × $110) = A$7,007/yr` → A$584/mo effective.
- **USD:** `$299 + (2 × $18) + (17 × $8) = $471/mo`. Annual → $5,181/yr, $432/mo effective.
- Seat mix dominates: all 20 on Full Access is **A$1,470/mo** vs A$637 — more than double.
- **Subs, vendors and clients are free seats** in both regions.

**Workyard** — $50/mo base + per user. Starter `$50 + (20 × $8) = $210/mo`, $6/user annual → $170/mo. Pro `$50 + (20 × $16) = $370/mo`.
⚠️ **Automatic worksite detection — geofenced auto clock-in, our core feature — is gated to the top "Autopilot" tier, which is custom-quoted.** The published numbers are not comparable to what we're building.

**busybusy** — $40/mo admin license including the first user, then per user. Pro `$40 + (19 × $9.99) = $230/mo`. Premium `$40 + (19 × $14.99) = $325/mo`. Clock-in photo verification sits in Pro.

**ClockShark** — Standard `$40 + (20 × $9) = $220/mo`. Pro `$60 + (20 × $11) = $280/mo`. GPS and geofencing in both tiers. **A three-year contract term applies to all plans.**

**Fieldwire** — flat per-user with no discounted field seat, annual billing: A$61 / A$100 / A$139 (US$39 / $64 / $89). At 20 users that's A$1,220–A$2,780/mo. Monthly billing costs more again. Priced for GCs, not crews.

**Buildertrend** — dropped published tiers in 2026 for volume-based custom quotes; third-party estimates put it near US$339–$1,099/mo. **Flat-rate with unlimited users**, so headcount doesn't move the price.

## The Australian angle nobody else covers

Workyard, busybusy and ClockShark integrate with **QuickBooks, ADP, Gusto, Paychex** — all US payroll. None of them handle **Xero or MYOB**, and none handle **Australian modern awards**: penalty rates, allowances, RDOs, casual loading, long service leave, superannuation.

So in Australia those three are time-capture tools that hand you a CSV, not payroll solutions. Jack integrates with Xero, which is a large part of why it charges 3× there.

**That's the wedge.** In the Australian market, GPS auto clock-in that lands correctly costed hours into Xero or MYOB under award rules has no direct competitor. The US tools can't follow without building award interpretation, which is genuinely hard.

## What this says about pricing our product

**Australia:** the imported trackers land at **A$242–A$526** but can't do payroll. Jack sits at **A$584–A$637** and does the business but not GPS. Doing both credibly supports **A$450–A$600/mo at 20 users** — undercutting Jack while beating the trackers on capability.

**US:** the tracker band is a tight **$170–$370**, Jack is $432–$471. A structure like **$99–$149 base + $20–25/office + $8–12/field** lands near **$300–$400** at 20 users.

**The seat model is the real lever.** A construction company is ~85% field workers. Jack charges A$10 for a mobile-only seat and nothing for subs and clients; Fieldwire charges A$100 for everyone and is triple the price as a result. Any product sold into crews needs a cheap field tier.

Three angles to sell against: **no long contract** (vs ClockShark's three-year term), **auto clock-in at every tier** (vs Workyard gating it to Autopilot), and **award-compliant hours straight into Xero/MYOB** (vs everyone).

## Gap in this research

If Australia is the target market, the competitor set above is incomplete — it's US-centric plus Jack. AU-native players not yet researched: **Assignar** (closest match — Australian construction workforce management with GPS), **simPRO**, **AroFlo**, **NextMinute**, **Tradify**, **ServiceM8**, **Damstra**.

---

*Sources: vendor pricing pages, August 2026. Buildertrend and Workyard Autopilot are
custom-quoted; those figures are third-party estimates, not quotes.*
