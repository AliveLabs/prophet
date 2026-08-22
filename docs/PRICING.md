# Ticket pricing: the guide

**This is the single authoritative pricing reference.** If a number here disagrees with a vault
note, a Notion ticket, a landing page, a slide, or your memory, **this file wins**. Read this first
and stop reconstructing pricing from scattered notes.

Established 2026-08-22. Numbers decided 2026-08-19 by Bryan and Chris, corrected 2026-08-20, add-on
purchase rules added 2026-08-22.

**What this file is not.** It does not re-derive the cost basis, the margin gates or the support
model. Those live in [`PRICING-2026-08-19.md`](./PRICING-2026-08-19.md), which stays as the decision
record and the analysis behind these numbers. This file is the operational answer: what the prices
are, what the rules are, where each number is enforced, and what is still open.

---

## 1. The prices

Every price is **per location, per month**. Annual is billed as **10 months** (two months free,
16.7% off), so the "annual" column is the effective monthly rate, and the actual annual charge is
that column x 12, or equivalently the monthly column x 10.

| Line | Monthly | Annual (effective /mo) | Billed annually | Enforced in |
| --- | --- | --- | --- | --- |
| **Starter** base | **$119** | **$99** | $1,190 | `TIER_PRICING.entry` |
| **Standard** base | **$299** | **$249** | $2,990 | `TIER_PRICING.mid` |
| **Multi-Location** base, per location | **$275** | **$229** | $2,750 | `TIER_PRICING.top` |
| Additional **Starter** location | **$119** | **$99** | $1,190 | `ADD_ON_PRICING.location.entry` |
| Additional **Standard** location | **$275** | **$229** | $2,750 | `ADD_ON_PRICING.location.mid` |
| Additional **competitor** | **$18** | **$15** | $180 | `ADD_ON_PRICING.competitor` |

All of these live in `lib/billing/tiers.ts` and are pinned by
`tests/unit/billing/tier-copy-is-derived.test.ts`. Nothing else may hold a copy.

### What each tier includes

| Tier | Key | Brief cadence | Competitors | Locations | Sold how |
| --- | --- | --- | --- | --- | --- |
| Starter | `entry` | weekly, Mondays | **3** | 1 | self-serve |
| Standard | `mid` | daily | **5** | 1 | self-serve, **the only tier with a trial** |
| Multi-Location | `top` | daily | **10** | 1 per unit | **contact us only** |

**The Starter-versus-Standard price gap IS the brief cadence, and it is enforced.** Verified
2026-08-22: `runCadence` gates the daily cron through `isRunDueToday`, and a real Starter location in
prod ran Mondays only. (The old `briefingCadence` field, which sat in the "sold" block and enforced
nothing while `eventsCadence` did the gating, no longer exists.) This matters because the entire
$180/month gap between the two tiers is that one difference: if it ever stops being enforced, Starter
customers are being charged less for the same product.

`SELF_SERVE_TIERS` is `["entry", "mid"]`. Multi-Location is deliberately not purchasable online:
`isSelfServeTier("top")` is false, and both money endpoints gate on it. That gate exists because
Multi-Location's per-location list price ($275) is *below* Standard's ($299) with strictly more
entitlement, so offering it as a one-click upgrade was a live arbitrage (ALT-735).

## 1a. The shape of the offer. Settled, do not re-litigate.

Decided by Bryan and Chris, restated by Bryan 2026-08-22 because it had been re-argued more than
once. **Written here so it does not have to be discussed again.**

**There are two self-serve tiers and one contact-us tier. There are exactly two add-ons. Nothing
else exists.**

| | What it is | How it is priced |
| --- | --- | --- |
| **Starter** | one location, weekly brief | published, self-serve |
| **Standard** | one location, daily brief | published, self-serve, the trial tier |
| **Multi-Location** (a.k.a. Custom) | groups and chains | **custom quote, contact us** |
| **Additional location** | add-on | published, per plan |
| **Additional competitor** | add-on | published, flat, allocated to one location |

**Those are the only two add-ons.** If a future capability is sold separately it becomes a third
add-on and gets a row here. It does not become a tier.

### Why Multi-Location is contact-us, and why that is not laziness

Two reasons, both Bryan's, and the second is the one that keeps getting forgotten:

1. **The price genuinely varies.** A six-location group and a sixty-location group get different
   per-location rates, and what each is worth to us differs by more than headcount. There is no
   band table for this on purpose: see below.
2. **That many locations needs work we have not built.** Regions, middle-tier management, roll-up
   reporting: a chain needs organisational structure a single restaurant does not, and some of it
   will be custom each time. **So we must not publish a price that gives the discount away before
   we know what the setup costs.** A quote can be adjusted for setup complexity. A published price
   cannot.

The second reason is why "just put a price on it" is the wrong answer, and why the discount schedule
below is a **starting point for a conversation, not an entitlement**. Volume alone never earns a
discount: it is earned by what we get back, and it can be offset by setup we have to build.

### Should `top` exist in code? Yes. It is the contract vehicle.

`top` stays in `TIER_LIMITS`, `TIER_PRICING` and Stripe, and it stays **out** of `SELF_SERVE_TIERS`.

It is not dead code and it is not a fourth tier. It is the billing vehicle a signed custom deal
lands on. Deleting it would mean modelling a custom customer as Standard plus N location add-ons,
which loses the ability to bill them at a negotiated per-location rate at all: the add-on price is a
list price. Keeping it also means the Stripe product and price already exist when the first deal
closes, rather than being created under time pressure.

What keeps it safe: `isSelfServeTier("top")` is false, both money endpoints gate on it, and a guard
test fails if it is ever added to the self-serve list while undercutting Standard. That gate exists
because it was once purchasable, which was a live arbitrage (ALT-735).

**Naming:** the customer-facing name is **Multi-Location**, which is what the marketing site ships
and what says who it is for. "Custom" describes how it is priced, not who it is for. One string in
`PLAIN_TIER_NAMES` if that is ever preferred.

### Multi-Location: there is no schedule, and that is the decision

**No published price. No discount bands. Nothing to quote from.** Decided by Bryan 2026-08-22, and
this replaces the volume schedule that used to sit here.

The reason is not squeamishness about numbers. It is that **we do not yet know what supporting a
genuinely custom arrangement takes.** A chain needs regions, middle-tier management and roll-up
reporting we have not built, and each deal is likely to need something different. Publishing a
discount schedule commits us to a price before we know the cost of the work, which is the one thing
a quote is supposed to protect us from.

Percentages like "10%, 12%, 15%" have appeared in conversation and in the 08-19 decision record.
**They were illustrations of why this is contact-us, not a schedule.** Do not treat them as bands,
do not encode them, and do not quote from them.

### The margin gates are an ENGINEERING guardrail. They do not veto a deal.

This is worth stating plainly because an agent got it wrong on 2026-08-22 and argued the point at
some length before Bryan corrected it.

**Where the 70% / 60% gates apply:** published, self-serve prices. Starter, Standard, the two add-ons.
Anywhere a machine sells at a fixed number with no human judgement in the loop, an arbitrage or a
thin line is a bug, and the gates catch it. That is what they are for, and the tests that enforce
them have caught two real arbitrages.

**Where they do not apply:** a negotiated contract. Bryan's words: *"these are the human decisions of
doing business that go beyond protecting it. Let's treat the 70% gate as your gate and not mine."*

A large multi-location contract can be worth more than its contribution margin: it can make the
company fundable, saleable, licensable, or a reference that sells the next ten. Those returns do not
appear in a per-location margin calculation, and refusing the deal to protect a percentage would be
optimising the wrong thing. Thin margins have built very large companies.

So: **run the numbers, hand them to whoever is quoting, and do not treat them as a gate.** Knowing a
band costs 57% of contribution is useful. Concluding that it therefore cannot be offered is not the
agent's call.

If someone wants the cost basis for a specific configuration, `estimateTierCost(tier, { cadence })`
in `lib/billing/tier-cost.ts` is the repo's own model and reports it directly. For reference, on
today's `top` entitlement it returns $86.08 per location against Standard's $70.33, the difference
being competitor count and roughly 4x the SEO keyword allocation. That is **information for the
conversation**, not a floor.

### One real operational gap when a Custom deal closes

`TIER_LIMITS.top` is a fixed default (10 competitors, biweekly SEO, daily brief). There is currently
**no per-org entitlement override**, so a signed deal either matches those defaults or needs one.
Locations and competitors are already purchasable per org and per location, which covers most of it;
brief cadence and the SEO allocation are not adjustable per customer. Not urgent, since no Custom
customer exists, but it is the thing to build first when one does.

---

## 2. The three "discounts", which are three different things

These get conflated every time, including by Bryan on 2026-08-22 and by me before that. They are
distinct and each has a documented reason.

| # | The discount | Rate | Applies to |
| --- | --- | --- | --- |
| 1 | **Annual** | **16.7%** (two months free) | every line, both tiers, all add-ons |
| 2 | **Additional Standard location** | **8%** ($275 vs $299; $229 vs $249) | the location add-on on Standard only |
| 3 | **Multi-Location volume** | **0 / 10 / 12 / 15%** | the contract tier, by location count |

**There is no 10% additional-location discount.** The 10% is band 2 of the Multi-Location volume
schedule (#3), not the add-on (#2). Related: the additional-location price was briefly drafted at
10% off ($269) and rejected.

**Additional Starter locations are at parity, not discounted, and that is deliberate.** A single
flat $229 add-on broke against Starter's $99 base: two Starter accounts cost $198 where one
two-location Starter account cost $328, so a customer saved $130 by splitting. Parity is the
simplest arbitrage-free answer: splitting gains nothing.

**Annual is two months free, never "20% off".** Two months lands within a couple of dollars of a
clean x1.2 on every line; 20% would force ugly monthly numbers ($125, $311) for three extra points.
`ANNUAL_MONTHS_FREE`, `ANNUAL_DISCOUNT_PCT` (16.7) and `ANNUAL_SAVINGS_LABEL` ("Two months free")
are all derived, and a test pins the words to the number.

---

## 3. The invariants. Do not change a price without checking these.

**An add-on may never cost more than the base plan it attaches to.** Otherwise a customer opens a
second account instead of adding a location. This has been violated twice by drafts ($269 flat, then
$229 flat) and caught by `tests/unit/billing` guard tests both times, not by re-reading the sheet.
That is the argument for the tests.

**Price must be linear in the cost drivers.** Non-linear price over a linear cost driver always
creates arbitrage. This is the sheet's own stated rule, and the competitor add-on currently
**violates it** (see §6).

**Margin gates: 70% excluding support (external), 60% fully loaded (internal).** Settled 2026-08-20.
Reasoning, because it sets the bar for everything: the goal is subscriber count to prove the model
and raise capital, not near-term profit, and 70% sits at the top of the defensible AI-native band
(50 to 70% where per-unit inference is real) rather than a classic-SaaS 80% we could not support.

**Every reachable configuration clears the gate.** Floor 70.6%, ceiling 78.2%. Verified across the
grid from "1 location weekly, 3 competitors" ($99, 78.2%) to "10 locations all daily" ($2,310,
70.6%).

**No $499 tier.** Deleted: 47% margin, and it sold locations at 55% of the Standard price while each
cost more to serve.

---

## 4. Trials

- **Standard is the only tier with a trial.** `TRIAL_ELIGIBLE_TIERS` is `["mid"]`.
- 14 days. A card is optional: card-less "skip for now" trials exist and get the full real data pull
  as accepted CAC.
- Day 10 and Day 13 reminder emails are promised at checkout and are sent by
  `/api/cron/trial-reminders`.
- **Mid-trial downgrade to Starter is allowed** even though Starter has no trial of its own. Losing
  the account costs far more than a few days of Starter serve cost.
- **A trial cannot buy add-ons.** Decided by Bryan 2026-08-22: purchasing a location or a competitor
  requires converting to paid first. See §5.

**Known live gap (ALT-756-adjacent, see §6):** because Starter has no trial, a Starter checkout
charges immediately, while one onboarding screen still says "nothing is charged today". Either the
copy or the trial eligibility has to change, and that is a pricing decision, not a code decision.

---

## 5. Add-ons: the rules

Two add-ons exist and both are **already live in Stripe**. What does not exist is any way for a
customer to buy one, which is `ALT-689`.

**Naming.** The sheet calls them **"Additional location"** and **"Additional competitor"**. Prefer
those. Avoid calling the location add-on "Multi-Location": that is the name of the contract tier, and
using one name for two different things is how this repo ended up with four meanings of "tier".

**Decided rules:**

1. **Trials cannot purchase add-ons.** Convert to paid first. (Bryan, 2026-08-22.)
2. **Additional locations run on the same plan as the first**, which has to mean the same price.
   That is why the location add-on is per-plan rather than one flat rate.
3. **Show the monthly-equivalent price on annual plans**, and state the billing period plainly.
4. **Say what will be charged before confirming.** Prorate correctly.
5. **Removing must be as easy as adding.** If it is easy to add and hard to remove, we built a trap.
6. Never name a data provider in billing UI (standing rule).

**A competitor unit attaches to ONE location, not all of them.** Decided by Bryan 2026-08-22 and
implemented as ALT-756. So one location can run 4 competitors while another runs 3, and only the one
extra is billed. The previous model granted each purchased unit at *every* location, which put the
line underwater by $30.50/mo at 10 locations because the cost is per location and the price is not.

**Where the quantities live**, and these are two different facts rather than two copies of one:

| Column | Answers | Written by |
| --- | --- | --- |
| `organizations.competitors_purchased` | how many units are **billed** | the Stripe webhook, mirroring subscription-item quantity |
| `locations.competitors_purchased` | where those units are **placed** | the app, on purchase or reallocation |
| `organizations.locations_purchased` | how many extra locations are billed | the Stripe webhook |

Invariant: the sum of the per-location allocations must never exceed the org's billed total.
Enforced by `ensureCompetitorAllocation` and pinned by a test. It is not a CHECK constraint because
it spans two tables, and not a trigger because it only changes on purchase.

Resolve a cap through `resolveCompetitorAllowance(org, location)`. **Both arguments are required on
purpose:** the location parameter was made mandatory so that every call site had to be revisited by
the compiler rather than silently keeping the old org-wide behaviour.

**Stripe mechanics that have already bitten:**
- A subscription carries a base item **plus up to two add-on items**, and Stripe does not promise an
  order. Never assume `items.data[0]` is the base plan. `resolveAddOnPriceInfo` returns non-null only
  for add-on prices, so it is the discriminator (ALT-755).
- Add-on prices must **never** enter the Portal's `subscription_update.products` allow-list, or an
  add-on could replace the base plan.
- Add-on price env vars are a different family from base prices:
  `STRIPE_PRICE_ID_{BRAND}_ADDON_{KIND}{_TIER}_{CADENCE}`.

---

## 6. Still open, and what each one blocks

**These are the reasons pricing is not "done". Read before quoting anything unusual.**

| Item | Ticket | What it blocks |
| --- | --- | --- |
| ~~The competitor add-on is priced flat but granted at every location~~ | ~~ALT-756~~ | **RESOLVED 2026-08-22.** A unit now attaches to one location. See §5. |
| ~~The Multi-Location quote schedule's margins are computed against Standard's cost~~ | ~~ALT-757~~ | **CLOSED BY DECISION 2026-08-22.** The finding was arithmetically right and answering the wrong question: there is no schedule to fix, because Custom is deliberately unpriced. See §1. |
| No way to buy an additional location at all. | ALT-754 | Expansion revenue; every add-on is a support conversation. |
| Add-on purchase UI (billing page, in-context prompts at the cap, location switcher, Portal quantity changes). | **ALT-689**, High | The whole metered model being self-serve. |
| Purchased competitor slots are billed and displayed but the nightly dossier truncates them away. | filed 08-22 | Fires the moment add-on purchasing ships. |
| Starter has no trial while onboarding copy implies one. | see §4 | Honest checkout copy. |
| **Deflection rate assumed at 50%** in the support model, the single biggest lever. Measurable from day one if every inbound is stamped with account and minutes. | PRICING §8 | An evidence-based revision instead of another estimate. |
| Tickets per account assumed at 1.0 and 2.5, from 8 prompted-tester rows. | PRICING §8 | Same. |
| **Nothing above 5 competitors or 1 location has ever run.** Treat all multi-location cost as provisional. | PRICING §8 | Confidence in the whole right-hand side of the grid. |

---

## 7. Answering a pricing question without re-searching

1. **A price?** §1. It is also in `lib/billing/tiers.ts`, and the two agree because a test says so.
2. **A discount?** §2. Check which of the three you mean before answering.
3. **Can I change this number?** §3 first, then run `npx vitest run tests/unit/billing`. Two drafts
   have already created arbitrage that only the tests caught.
4. **Why is it this shape?** `PRICING-2026-08-19.md` §2 (shape), §3 (cost basis), §6 (support), §7
   (margin gates).
5. **Quoting Multi-Location?** §1 volume schedule, then `PRICING-2026-08-19.md` §5 for floor prices
   and the rules for whoever takes the call.
6. **Is it safe to sell?** §6. Two live items (ALT-756, the dossier truncation) mean the competitor
   add-on is not safe to sell to a multi-location account today.

## Surfaces that must agree, and how they are kept honest

| Surface | Source | Guard |
| --- | --- | --- |
| App landing pricing tiles | `lib/billing/tier-copy.ts`, derived | `tier-copy-is-derived.test.ts` |
| App settings, upsell seams, API errors | `tierDisplayName()`, derived | same |
| Marketing site pricing page | `ticket-marketing/components/Pricing.tsx`, hand-written | separate repo, **verify by hand against §1** |
| Stripe products and prices | live, 12 price-ID env vars | a restricted key cannot read products back; verify a write by making an invalid one error |

The marketing site is the one surface with no automated tie to §1. It was correct as of 2026-08-22
(Starter $119 with 3 competitors, Standard $299 with 5, Multi-Location contact-us, add-ons
$119/$275/$18). **Re-check it by hand whenever a number here changes.**
