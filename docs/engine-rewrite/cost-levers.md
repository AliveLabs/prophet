# Cost model, headroom & levers — Tier 1 / Tier 2 / Tier 3 (corrected 2026-06-04)

> Grounded in Anand's API Cost Model (`Vatic_Pricing_Model_v3`, "Unit Cost Reference" + Model B). Corrects
> earlier conflations: (1) market PRICE vs our COST, (2) Google Places photo *fetch* (expensive) vs Gemini
> Vision *analysis* (cheap, and kept), (3) how Data365 actually bills. Tier code names dropped — Tier 1/2/3.

## Price is what the subscriber pays. Cost is what it takes us to serve them. Keep them separate.

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| **Market price / mo** | $149 | $299 | $499 |
| Includes | 1 location, 3 competitors, Instagram, weekly SEO, weekly digest | 5 competitors, IG+FB+TikTok, weekly SEO, daily briefings | 10 competitors, 3 locations, all social, 2x/week SEO, daily + alerts |
| **Our COGS / mo (model, optimized, 10+ workspaces)** | **$58.18** | **$105.46** | **$153.03** |
| COGS as % of price | 39% | 35% | 31% |
| "X below price" | 2.6x | 2.8x | 3.3x |
| Gross margin | 58% | 62% | 66% |

## The headroom question (Bryan's real concern)

Goal: cost should be **multiple-x below price with room to absorb a cost surge** (more processing, surge
data, AI-price volatility). Stress test — **if our cost doubles**:

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| COGS at 2x | $116 | $211 | $306 |
| % of price | 78% | 71% | 61% |
| Margin | **22%** | 29% | 39% |

**Finding:** the current model targets healthy-SaaS margins (~60%, ~2.6-3.3x below price), **NOT the
aggressive surge-absorbing headroom we want — especially Tier 1, which a 2x cost spike would crush to ~22%.**
So the honest answer to "are we multiple-x below with surge room?" is: *somewhat, and it improves with
scale, but not enough on Tier 1 early.*

Two things move it in our favor:
- **Scale.** The fixed floor is $676/mo (Data365-dominated). Amortized it drops from **$67.60/ws at 10
  workspaces to $22.53/ws at 30**. The model itself says the first ~5 customers run 35-40% margin; headroom
  arrives past ~20-30 subscribers.
- **Our weekly cadence.** The model's per-competitor $6.42 assumes *daily* Places + Gemini. A weekly-brief
  product can pull Places/photos weekly too, cutting per-competitor cost further than the model shows.

**To actually hit "multiple-x with 2x-surge headroom":** (a) weekly (not daily) Places/Gemini for the
weekly tiers, (b) grow past ~20-30 subs fast to amortize the Data365 floor, (c) if we want the headroom even
at low scale, either lift Tier 1 price or trim Tier 1's daily pulls. **This is a strategic call: ~60% margin
(current model) vs a lower-cost / higher-headroom target.** Flag for Bryan + Chris.

## Real unit costs (from the model, optimized, 10+ ws)

- **Per competitor: $6.42/mo** = Places details+reviews $0.75 (daily) + Places photos **deduped** $1.96
  (was ~$6.5; 70% cut from hash dedup) + **Gemini analysis $0.30** + DataForSEO $3.30 (weekly) + Firecrawl
  $0.10 + Outscraper $0.01 + weather $0.
- **Per location (own): $3.01/mo.**
- **Per social platform/ws (~10ws): Instagram $22, +Facebook $11, +TikTok $11.**
- **Fixed (amortized): $676/mo → $67.60 (10ws) → $22.53 (30ws).** Data365 is $660 of it.

## The actual cost drivers and the CORRECT levers

1. **Google Places photo FETCH = the big driver (33%).** Hash dedup already cuts it 70% ($1.96/comp).
   Lever: **weekly (not daily) photo fetch** for weekly tiers. **Do not touch the Places details+reviews
   pull** (it's our reviews source and only $0.75).
2. **Gemini Vision is CHEAP ($0.30/comp) and ESSENTIAL — we keep it.** We must know what is *in* a photo to
   judge why a post engaged or flopped. **Photo plan:** analyze both high- AND low-engagement posts (learn
   what works and what to avoid recommending), Flash-tier vision, dedup so unchanged images are not
   re-analyzed. This is a tiny cost and a core capability, not a lever to cut.
3. **Data365 = one connection, bulk credits, 3 networks.** €300/0.5M credits = Instagram; +€300 = FB+TikTok.
   ~5,220 credits/ws. The lever is **credit-budget vs subscriber count, by network**: Tier 1 = Instagram
   only (consumes only IG credits), Tier 2/3 = all three. Manage so that for every N subscribers at a tier
   we stay under the plan's credit cap and the amortized cost is covered. This is a tier *gate*, not a
   per-network plan we toggle per customer.
4. **DataForSEO: weekly (T1/T2), 2x/week (T3).** Only real "turn-down": trim 3 low-value endpoints
   (paid-visibility, backlinks-summary, subdomains → feed evidence-only rules). Reversible.
5. **Claude synthesis (new):** offset by weekly cadence + dedup + the 3 trimmed SEO endpoints. Keep
   Gemini-Flash for the cheap tasks (vision, menu extraction); Claude for the reasoning passes.

## Levers: required (permanent) vs dial (reversible)
- **Required (margin-critical):** photo hash dedup (done); weekly-cadence tiering; Tier 1 = Instagram-only
  (Data365 credit management).
- **Dial up/down (reversible, our cost knobs):** photo *fetch* frequency (not analysis, not reviews); the
  SEO endpoint set; SEO cadence per tier; Claude token budget/depth.
- **Never cut:** Gemini Vision analysis (cheap + essential); the Places reviews pull.

## New spend approved (all cheap — confirmed by the model)
Own foot traffic (Outscraper, ~$0.01/mo), fuller reviews (Outscraper — cheap, monitor volume, cap to a
recent window), menu tags (extend Firecrawl+Gemini parse, ~free). None of these move the needle on cost.

## Open: want a proper sensitivity model?
The above uses the model's 10+-ws optimized COGS. If useful, I can build a small sensitivity table (COGS per
tier at 10 / 30 / 50 subscribers × weekly vs daily cadence) so the "multiple-x headroom" target is a dial we
can read directly. Say the word.
