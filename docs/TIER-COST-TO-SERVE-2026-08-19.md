# Cost to serve, per tier

ALT-668. Analysis run 2026-08-19. **Every number here is reproducible**: run
`tests/unit/billing/tier-cost.test.ts`, or call `estimateTierCost(tier)` from
`lib/billing/tier-cost.ts`.

## The answer

| Tier | Price/mo | Variable cost/mo | Variable margin | Verdict |
| --- | --- | --- | --- | --- |
| `entry` $149 | $149 | **$12.43** | 91.7% | healthy |
| `mid` $299 | $299 | **$70.33** | 76.5% | healthy |
| `top` $499 | $499 | **$258.24** | **48.3%** | **underwater** |

Two of the three prices are fine. **The top tier is not.** It keeps less than half its price before
a single dollar of fixed cost, support, or acquisition.

Variable margin is not gross margin: it excludes the fixed floors. Fold those in and the picture
separates into two different problems:

| Subscribers | Fixed floor each | `entry` | `mid` | `top` |
| --- | --- | --- | --- | --- |
| 5 | $223.60 | **-58%** | 2% | 3% |
| 10 | $111.80 | 17% | 39% | 26% |
| 25 | $44.72 | 62% | 62% | **39%** |
| 50 | $22.36 | 77% | 69% | **44%** |

(Fixed floor modelled at $1,118/mo: the Data365 standard plan at $918 plus roughly $200 of
Supabase, Vercel and Resend. Adjust the input, the shape does not change.)

**`entry` and `mid` are subscriber-count problems that scale away. `top` is a variable-cost problem
that does not.** At fifty subscribers the top tier is still the worst of the three.

## What actually drives it, and it is not what anyone expected

The concern going in was search volume: the top tier declares 200 tracked keywords against mid's 50,
so the fear was something on the order of 28x the provider spend for 1.67x the price.

Search volume is genuinely 24x, and it is not the problem.

`top` variable cost, $258.24 broken out:

| Source | $/mo | Share |
| --- | --- | --- |
| **Claude (briefs)** | **$159.30** | **62%** |
| Data365 (social) | $42.36 | 16% |
| DataForSEO (search + events) | $32.67 | 13% |
| Places photos | $10.83 | 4% |
| Gemini (menus + vision) | $5.73 | 2% |
| Places details | $5.70 | 2% |
| Firecrawl, Outscraper, weather | $1.65 | 1% |

**Sixty-two percent of the top tier's cost is brief generation.** 30 briefs per month × 3 locations
× $1.77 per brief. Search providers, the thing we were worried about, are 13%.

That number only appears if you use the **measured** cost per brief. `cost-model.ts` models a brief
as ten Claude calls at $0.024, i.e. about $0.24. The observed figure from the spend-cap work is
**$1.77 average, $2.12 p95** — roughly 7x higher, because the model predates adaptive thinking and
32k producer budgets. With the modelled number the top tier looks healthy at 76%. With the real one
it is underwater at 48%. That single substitution is the whole finding, and there is a test pinning
it so nobody reverts to the comfortable number by accident.

## The cleanest statement of the problem

- `mid` is **$299 for one location.**
- `top` is **$499 for three locations**, so about **$166 per location.**
- A top-tier location costs **more** to serve than a mid one (10 competitors instead of 5, 200
  keywords instead of 50, denser SEO cadence).

**We sell locations at 55% of the mid price while each one costs more to serve.** The top tier is not
mispriced by a little; its structure inverts.

## Two things the analysis had to fix before it could be trusted

**1. Three pipelines were billed at the wrong cadence.** The model used the brief cadence as a
stand-in for how often each pipeline runs. Checked against what the daily cron actually enqueues:

| Pipeline | Model assumed | Actually enqueued | Effect |
| --- | --- | --- | --- |
| `content` | daily | weekly (`isWeeklyFullBuildDay`) | overstated Firecrawl + Gemini menu ~7x |
| `busy_times` | daily | weekly (Mondays) | overstated Outscraper ~7x |
| `events` | SEO cadence | **daily, unconditional** | **understated** DataForSEO events, our priciest unit at $0.04 |

Two overstatements and one understatement, so it was never going to cancel out. This is the same
class of error as the 2026-08-10 incident, where the model priced SEO weekly while the pipeline ran
it daily and the real bill came in at roughly 7x the modelled rate. Fixed by reading the cron
instead of guessing.

**2. `seoLabsCadence` and `seoSerpCadence` are dead fields.** They say the top tier pulls search
data *daily*, and they have **zero readers anywhere in the codebase**. The enforced field is
`seoCadence`, which says `biweekly` (Mondays and Thursdays, via `isSeoDue`). Pricing off the dead
field is what produced the original 28x estimate. `RUNS_PER_MONTH` had no `biweekly` entry either,
so the model silently fell back to weekly and understated the top tier's largest search line by 2x.
Both fixed.

Also dead: `eventsKeywordSets` (no readers), and `ensureTrackedKeywordLimit()` has no callers, so the
tracked-keyword cap is not enforced where a keyword is added. Spend is still bounded, because
`visibility.ts` slices to the limit before pulling, so that one is a UX gap rather than a cost leak.

## Answering the ticket's "answer this first" question

**Are the SEO limits per location or per organization? Per location.** The daily cron loops over
locations, gates `seoDue` per location, and enqueues `visibility` per location; the pipeline then
applies the tier's keyword limit inside that per-location run. A three-location top-tier org pulls
the full 200-keyword allowance three times over.

So the top-vs-mid load multiples are:

| Axis | Multiple | vs price 1.67x |
| --- | --- | --- |
| Search volume (keywords × locations × cadence) | **23.9x** | outruns |
| Entities monitored (competitors × locations) | **5.5x** | outruns |
| Briefs generated | **3x** | outruns |

Every axis outruns the price. Against `entry` the search multiple is **79.7x** for 3.35x the price.

## Recommendation

**Hold `entry` and `mid`. Do not launch paid traffic to `top` at $499 for three locations as
structured.**

Per the standing rule that a threshold tripping at demo scale is a per-unit-cost problem, and per
the ticket's own hint that changing a limit is cheaper than changing a price before anyone has
bought, the options in order of preference:

1. **Price per location above the first.** $299 for the first location and something like $149 for
   each additional one puts $597 on a three-location account, roughly 57% variable margin, and
   removes the inversion entirely. This is the standard answer and the honest one: locations are the
   cost driver, so locations should be the meter.
2. **Give only the primary location a daily brief**; additional locations get the weekly digest.
   Claude drops from $159 to about $68 and the tier lands near 66% variable margin. Cheaper to build
   than repricing, but it makes the flagship tier feel *less* capable per location than mid, which is
   hard to sell.
3. **Cut `top.maxLocations` to 2.** Gets to roughly 61%. Still thin, and it shrinks the product.
4. **Reduce $/brief.** The real long-term fix, and it helps every tier at once. Two live threads
   already point at it: ALT-681 (the brief time estimate is 3.6x its observed maximum) and the
   per-brief spend ceiling below. Worth doing regardless, but not something to bet a price on before
   it is measured.

I would take (1). It is the only option that fixes the structure rather than trimming the symptom,
and it is free to do before anyone has bought.

**This has not cleared `top` at $499, so it has not cleared ALT-645 either** — the marketing pricing
page should not publish a three-location $499 tier until this is settled.

## What this unblocks for free

**ALT-552 / ALT-553** have been inert since 2026-08-10 waiting for exactly these numbers:

- `ANTHROPIC_PER_BRIEF_CEILING_USD` — observed $1.77 avg, $2.12 p95. A runaway guard wants clear air
  above p95, not a budget: **$5** is the standing recommendation and it holds.
- `ANTHROPIC_FLEET_DAILY_CAP_USD` — about $18/day observed fleet-wide. **$90** is the standing
  recommendation, roughly 5x headroom.

Both are guards against a runaway, not spending limits. Sizing them tighter to "save money" converts
a cost question into an outage.

## Honest limits of this analysis

- Provider costs are **bottom-up projections**: verified unit prices × call volumes read from the
  pipeline code. They are not reconciled against actual vendor invoices. Only the Claude line is a
  measured figure.
- **Per-tier attribution of observed provider spend does not exist.** We have a fleet total, not a
  split by org or tier. Building that attribution is a separate piece of work, and it is what would
  turn this from a defensible projection into a verified one. The Claude line is the exception
  because per-brief telemetry already records it.
- **ALT-636 distorts the search line.** `location_code` defaults to the whole US across ten search
  clients with no caller override, so we are buying national data. Fixing it is likely to *reduce*
  the DataForSEO figure, which is only 13% of the top tier's cost, so it does not change the
  recommendation.
- Call volumes in `VOLUMES` were calibrated in 2026-06 and are marked in that file as needing
  re-verification against real usage. The cadences are now correct; the per-run call counts still
  carry that caveat.
