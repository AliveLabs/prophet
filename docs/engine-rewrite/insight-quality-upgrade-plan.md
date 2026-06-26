# Production Insight-Quality Upgrade — make prod insights/recommendations match the concepts

**2026-06-26.** Bryan + Chris: the concepts' INSIGHTS and RECOMMENDATIONS (not just the visuals) are much
closer to where we want to go than what production generates. This plan closes that gap. **Plan only — build
in a new session.** Scope = the INSIGHT/RECOMMENDATION ENGINE + the play data the brief renders. NOT the UI
(that's the design track). Pairs with the design concepts in `docs/design-concepts/round2/`.

## The gap (grounded in real prod — Raising Cane's latest brief)
Prod ALREADY produces good convergent, cross-source, actionable rationales. Real example (verbatim):
> "A World Cup match 0.6 miles away lets out around 10PM and you are open until 4AM when most fast food has
> closed... Pre-batch fingers and lemonade for a 10PM to 1AM second peak to protect the speed reputation that
> is your edge, and lead with lemonade since a recent review says the sweet tea is not sweet."
> refs: events.new_high_signal_event · review.theme · visual.weather_patio · seo_competitor_keyword_portfolio

That's strong. What it LACKS vs the concepts (and what Chris/Bryan explicitly praised) — the engine stops at
**prose + machine refs** and never composes/exposes the **evidence-forward, comparative, quantified** layer:

| Concept capability (praised in the review) | In prod today? | The data exists? |
|---|---|---|
| **Breakout review QUOTES** behind a theme (verbatim, attributed) | No (just `review.theme` ref) | YES — we store reviews |
| **Sentiment-by-category %** (food/wait/price/cleanliness) | No | Mostly — review analysis has categories |
| **Head-to-head** you-vs-set / top-competitor (decodable deltas) | No | YES — review-velocity, SEO, social signals all exist |
| **Embedded competitor SOCIAL POST** (image + caption + engagement) | No (brief never attaches it) | YES — rich social `visualAnalysis` is computed (verified) |
| **Honest QUANTIFIED estimates / reach** (%-framed) | Sparse (`leverage.reach` mostly null) | Partly — §4.6 economics pattern exists for grassroots |
| **"Press the advantage" (you're winning)** as a first-class signal | Weak (menu play was generic "fits the weather") | YES — derivable (menu uniqueness, velocity edge) |
| **Structured "why we're confident"** (sources + the actual data points) | No (only machine refs + a confidence label) | YES — refs already trace to real signals |
| **SEO/visibility** as a source-attributed data representation | Thin | YES — DataForSEO data exists |

**Conclusion:** this is mostly a COMPOSE-AND-EXPOSE problem (the dossier already holds the signals), plus a few
new derivations (sentiment-by-category, head-to-head deltas, advantage detection, exemplar-post selection). It
is NOT "rebuild the engine."

## The spine: a structured evidence block on each play
Extend `EnrichedRecommendation` (`lib/skills/types.ts`) with an OPTIONAL `presentation`/`evidence` block (fail-soft,
old briefs simply lack it; mirrors how `combinedScore`/`category` were added). Carries what the concept cards render:
```
breakoutQuotes?: { text; source; competitor?; rating?; date? }[]   // 1-3 verbatim, attributed
sentimentByCategory?: { category; pct; direction }[]               // food/wait/price/cleanliness, %
headToHead?: { metric; you; setOrCompetitor; lead: 'you'|'them'|'even'; label }[]
exemplarSocialPost?: { competitor; platform; mediaUrl; caption; engagementPct; likes; comments }
estimate?: { value; unit:'%'|'range'|'count'; basis; isEstimated:true }   // NEVER $ from POS
advantage?: boolean   // true = "press the advantage" (you're winning), false = "steal the cue"
confidenceBasis?: { source; whatWeSaw }[]                          // the "why we're confident" expansion
```
The presenter (`lib/skills/presenter.ts`, which already strips internal numerics) gates what reaches the
customer; honesty rules below apply at this layer.

## Honesty guardrails (hard rules, from the transcript)
- NO POS/sales: never claim margins, ticket/order counts, "highest-margin item", or $ lift we can't know. Use
  ESTIMATED / PERCENTAGE language ("you earn a review roughly every X% of visitors").
- Quotes are verbatim + attributed to a real source; never fabricated.
- Confidence honest: Directional must read clearly lower than High; `confidenceBasis` must trace to real signals.
- No QSR jargon in generated copy ("covers", "rail", "drink rail"); reads for a Subway/Chick-fil-A.
- CTAs name the real next step.

## Phases (sequenced for the build session)
**P1 — Schema + presenter plumbing.** Add the optional `presentation` block to the play type; thread it through
synthesis + the presenter (honest-gate it). No behavior change yet (everything optional). Tests + a Cane's
rebuild to confirm byte-identical until populated.

**P2 — Evidence-forward basics (highest praise, mostly compose-from-existing).**
- `confidenceBasis` — turn the existing `evidenceRefs` into readable "what we saw" lines per source (the
  "why we're confident" rolldown content). 
- `breakoutQuotes` — for any `review.theme`-grounded play, select 1-3 representative verbatim review quotes
  (own + competitor) from the reviews we store; attribute + date them.
- `estimate` — populate %-framed estimates/reach consistently (extend the §4.6 economics approach to other
  play types; never $/POS).

**P3 — Comparative layer.**
- `sentimentByCategory` — derive the negative-sentiment category % breakdown from review analysis.
- `headToHead` — compose you-vs-set (or you-vs-top-competitor) deltas on review velocity, local visibility,
  social engagement, menu uniqueness; decodable lead flags.
- `advantage` detection — flag "you're winning" plays (menu uniqueness, velocity edge, visibility lead) so the
  brief can present press-the-advantage vs steal-the-cue distinctly.

**P4 — Embedded competitor social.** Attach `exemplarSocialPost` to social plays: pick the competitor's
top-performing post from the already-computed `visualAnalysis` (image URL + OCR'd caption + engagement) so the
brief can embed the real winning post (the #1-praised feature).

**P5 — SEO/visibility representation.** Surface the source-attributed local-SEO/visibility movement (the data
Chris flagged as "a better representation... Claude take note") as a structured, drillable insight.

Each phase: producer/synthesis change → honesty gate → unit tests → rebuild Cane's brief via `cron.mts
build-brief` → compare the play content to the concept patterns (does it now carry quotes / sentiment-categories
/ head-to-head / social-embed / structured confidence?).

## Code areas
- `lib/skills/types.ts` (EnrichedRecommendation), `lib/skills/synthesis.ts`, `lib/skills/presenter.ts`
- Producers: `lib/skills/reputation/*` (quotes, sentiment-by-category), `lib/skills/social-counter/*` +
  `lib/social/visual-*` (exemplar post), `lib/skills/convergence/*` + `lib/skills/positioning/*` (head-to-head,
  advantage), `lib/skills/food-pairing/*` (menu uniqueness).
- Data already in the dossier (`lib/insights/dossier/build.ts`): reviews, social visualAnalysis, events,
  weather, SEO/DataForSEO, menus, competitor metrics.
- Verify: `scripts/db/cron.mts build-brief --param location_id=<Cane's>`.

## Definition of done
Re-pull Cane's brief and the plays carry: verbatim attributed quotes, sentiment-by-category %, a decodable
head-to-head, an embedded competitor post on the social play, %-framed honest estimates, a press-the-advantage
flag where true, and a structured "why we're confident" — i.e. the brief content reads like the concepts, with
zero POS/$ claims.
