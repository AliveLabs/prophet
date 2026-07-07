// ---------------------------------------------------------------------------
// Skill layer — output contract (Phase B foundation; engine rewrite)
//
// EnrichedRecommendation is the recipe-level output a skill produces. It is a
// SUPERSET of today's flat { title, rationale } so the legacy insight card keeps
// working, but enriched plays are persisted to the new `brief_plays` table (NOT
// back into insights.recommendations — the insights unique key cannot hold per-
// skill rows). See ~/.claude/plans/we-are-going-to-jiggly-newell.md.
//
// These are plain TS types for now. Zod schemas can formalize them later; the
// deterministic eval checks in lib/eval/checks.ts validate them without zod.
// ---------------------------------------------------------------------------

export type OwnerRole = "owner" | "gm" | "marketing" | "kitchen" | "foh"

export type RecKind = "prepare" | "capitalize" | "positioning" | "reputation" | "ops"

export type Confidence = "high" | "medium" | "directional"

/**
 * P11 calibration: the OPERATOR INTENT a play encodes, independent of RecKind.
 *  - `fix`     — there is a real problem to correct (negative trend / complaint / encroachment).
 *  - `capture` — there is fresh upside to seize (an event, demand, a competitor gap).
 *  - `maintain`— keep doing a good thing (a best-practice / standing habit).
 * Stance drives calibration: a `maintain` play's impact is RISK-OF-STOPPING, not novelty, so a
 * "keep replying to reviews" play cannot outrank a real problem unless a failure signal is present.
 * Defaults to `capture` when a producer doesn't stamp one (the prior behavior — no impact cap).
 */
export type Stance = "fix" | "capture" | "maintain"

/**
 * P11: a count expressed as a RATE with its denominator, so the brief reads
 * "3 of your last 20 reviews (15%)" instead of the bare "3 reviews". Carried on an
 * Evidence entry; the presenter renders the rate, and a checks.ts gate requires the
 * denominator to be present whenever a count-based number is surfaced.
 */
export type EvidenceRate = { numerator: number; denominator: number; pct: number }

/**
 * P11: ONE piece of REAL cited source text behind a play — the verbatim artifact, not a
 * category chip. Resolved by `lib/skills/presenter.ts#resolveEvidence` from the dossier
 * (e.g. a byte-exact `ReviewSentiment.themes[].examples[]` quote, an event name+date+venue,
 * a competitor menu line). Surfaced inline on the brief card + detail page. `quote` MUST
 * byte-match a stored example (no paraphrase) and the originating ref MUST pass `buildRefIndex`
 * grounding. `relativeStat` is a RELATIONAL framing ("12% slower than your Friday peak") that
 * the presenter only keeps when paired with an operational consequence (`soWhat`).
 */
export type Evidence = {
  /** The verbatim cited text (e.g. a real review quote). Byte-matches a stored example. */
  quote?: string
  /** The dossier ref this evidence resolves from — MUST be in the play's evidenceRefs. */
  source: string
  /** A public link to the artifact, when one exists (review URL, event page). */
  sourceUrl?: string
  /** ISO date the artifact is "as of". */
  asOf?: string
  /** A relational framing of a number ("12% slower than your Friday peak"). */
  relativeStat?: string
  /** The operational consequence paired with `relativeStat` ("so you can cut one closer"). */
  soWhat?: string
  /** A count expressed as a rate with its denominator (replaces a bare count). */
  rate?: EvidenceRate
}

/**
 * Operator-facing DOMAIN of a play — used by the scoring priors, drill-down, and the
 * per-operator rerank controls (P2/P3/P8). Declared INTRINSICALLY on each ProducerSkill;
 * NOT derived from RecKind (local-demand and marketing both carry kind "capitalize" yet are
 * different categories). RecKind stays the play SHAPE (prepare/capitalize/…); Category is the
 * domain a play belongs to.
 *
 * P12: `social` is its OWN domain — the social counter-strategist (lib/skills/social-counter)
 * owns competitor social-feed teardown + counter-plays, split from the generic `marketing`
 * lens (which still covers the operator's own content cadence/mix) so the operator sees a
 * distinct competitive-social lens and the per-operator rerank can weight it independently.
 * Its lead click-feedback domain is also `social` (the P14 learning hook).
 */
export type Category = "demand" | "marketing" | "social" | "menu" | "grassroots" | "positioning" | "reputation" | "operations" | "convergence"

/** One concrete step of the plan — everything short of executing it. */
export type RecipeStep = {
  channel: string // "Meta geo-ads" | "loyalty/digital wallet" | "in-store" | "Google Business" | ...
  platforms: string[] // ["Instagram","Meta Ads","Apple/Google Wallet"]
  audience: string // "concert attendees within 1 mi, 30 min before the show ends"
  window: { start?: string; end?: string; note: string }
  offer?: string // "pre-show prix-fixe $35"
  /** CUSTOMER-FACING message text, written in the RESTAURANT's voice (not Ticket's). */
  copy?: string
  /** Direction only, never a produced asset: "shoot a tight crop of the sear, warm side light". */
  creativeDirection?: string
  dependencies?: string[] // ["wallet pass exists","POS can ring a prix-fixe"]
}

/**
 * Qualitative leverage. Dollar ranges are computed INTERNALLY (basisInternal)
 * for ranking + a "see the math" drill, but never surfaced to the customer as a
 * dollar promise. Any reach quantity must be grounded in real data — otherwise
 * `label` is ordinal only and `reach` is omitted (anti-fabrication).
 */
export type Leverage = {
  reach?: string // ONLY when grounded in real data; otherwise omit
  label: "high" | "medium" | "low"
  basisInternal: string // internal only: the opportunity-sizing math + assumptions
}

// ---------------------------------------------------------------------------
// Structured evidence-forward presentation layer (insight-quality upgrade).
//
// The concepts (Bryan + Chris, 2026-06-26) read closer to target than prod NOT
// because prod's rationales are weak, but because the engine stopped at prose +
// machine refs and never COMPOSED the evidence-forward, comparative, quantified
// layer the dossier already holds. These types carry exactly what the concept
// cards render. Each block is OPTIONAL + fail-soft (producers / old persisted
// briefs simply lack it — mirrors how combinedScore / category were added), is
// composed DETERMINISTICALLY by the presenter from the dossier, and is honest-
// gated there. HARD RULE: never a POS/$ claim (margins, ticket counts, $ lift) —
// estimates are ESTIMATED + percentage/ordinal framed; quotes are verbatim.
// See docs/engine-rewrite/insight-quality-upgrade-plan.md.
// ---------------------------------------------------------------------------

/** A verbatim, attributed review quote behind a play (the "breakout quotes" rolldown). `text` MUST
 *  byte-match a stored review example (no paraphrase); `source` traces to a grounded review.theme ref. */
export type BreakoutQuote = {
  /** The verbatim review text — byte-matches a stored dossier example. */
  text: string
  /** The dossier ref this quote resolves from (e.g. review.theme:slow-service) — must be grounded. */
  source: string
  /** A named competitor when the quote is from a competitor's reviews; absent ⇒ the operator's own. */
  competitor?: string
  /** Star rating of the originating review, when known. */
  rating?: number
  /** ISO date the review is "as of", when known. */
  date?: string
}

/** Negative-sentiment share within one review category — the food/wait/price/cleanliness breakdown.
 *  `pct` is a SHARE (0-100) of the categorized theme mentions, never a fabricated count of customers. */
export type SentimentCategory = {
  /** A normalized review category: food | service | wait | price | cleanliness | ambiance | ... */
  category: string
  /** Share of mentions in this category, 0-100 (rounded). */
  pct: number
  direction: "positive" | "negative" | "mixed"
}

/** One decodable you-vs-set (or you-vs-top-competitor) comparison on a real metric. */
export type HeadToHead = {
  /** What is compared, humanized: "review velocity", "local visibility", "social engagement", ... */
  metric: string
  /** The operator's value, pre-humanized for display (e.g. "4.6 stars", "12 a week"). */
  you: string
  /** The comparison value — the set average or a named top competitor (pre-humanized). */
  setOrCompetitor: string
  /** Who leads on this metric. */
  lead: "you" | "them" | "even"
  /** A one-line, plain-language framing of the delta ("You earn reviews about twice as fast as the set"). */
  label: string
}

/** The single best competitor social post to embed on a social play — the #1-praised concept feature.
 *  Pulled from the already-computed social signals (image + OCR'd caption + engagement). */
export type ExemplarSocialPost = {
  /** The competitor whose post this is. */
  competitor: string
  /** "instagram" | "facebook" | "tiktok" (kept as string to avoid coupling the core contract). */
  platform: string
  /** Public media URL of the post image/thumbnail (Supabase-storage or platform CDN). */
  mediaUrl: string
  /** The post caption / OCR'd on-image text. */
  caption: string
  /** Engagement framed as a % (likes+comments over followers) when derivable; omitted otherwise. */
  engagementPct?: number
  likes?: number
  comments?: number
  /** The dossier ref this post traces to (a social.* ref) — for grounding. */
  source: string
  /** Normalized 0..1 focal point of the post image (from its visual analysis), for anchoring
   *  the crop when this post is rendered as a hero. Omitted for posts analyzed before focal
   *  detection existed — the renderer defaults to center. */
  focalPoint?: { x: number; y: number }
}

/** A HONEST, %-framed (or ordinal/range) estimate of reach or frequency — NEVER a $ / POS figure.
 *  `isEstimated` is always true so the renderer can flag it as an estimate, not a measured fact. */
export type PlayEstimate = {
  /** The pre-formatted, honest estimate ("roughly 1 in 25 visitors", "10-15% of weekend guests"). */
  value: string
  /** The shape of the value, for the renderer. */
  unit: "%" | "range" | "count"
  /** How it was derived, in plain language (the honest basis). */
  basis: string
  /** Always true — this is an estimate, not a measured fact. */
  isEstimated: true
}

/** One line of the "why we're confident" expansion — a source plus what we actually saw from it. */
export type ConfidenceBasisItem = {
  /** Humanized source label ("Reviews", "Events", "SEO", "Competitor social"). */
  source: string
  /** What that source actually showed, in one readable line. */
  whatWeSaw: string
}

/** The structured evidence-forward presentation block a play may carry. Composed by the presenter
 *  from the dossier, honest-gated; OPTIONAL + fail-soft throughout. Never carries POS/$ claims. */
export type PlayPresentation = {
  /** 1-3 verbatim, attributed review quotes (own + competitor) behind a review-grounded play. */
  breakoutQuotes?: BreakoutQuote[]
  /** Negative-sentiment-by-category % breakdown derived from review analysis. */
  sentimentByCategory?: SentimentCategory[]
  /** Decodable you-vs-set / you-vs-competitor deltas. */
  headToHead?: HeadToHead[]
  /** The embedded competitor exemplar post on a social play. */
  exemplarSocialPost?: ExemplarSocialPost
  /** A %-framed honest estimate of reach/frequency (never $). */
  estimate?: PlayEstimate
  /** true ⇒ "press the advantage" (you're winning); false ⇒ "steal the cue"; unset ⇒ neither framing. */
  advantage?: boolean
  /** The structured "why we're confident" rolldown content. */
  confidenceBasis?: ConfidenceBasisItem[]
}

export type EnrichedRecommendation = {
  // --- back-compat (the legacy card reads these) ---
  title: string
  rationale: string

  // --- the recipe layer ---
  skillId: string
  ownerRole: OwnerRole
  kind: RecKind
  recipe: RecipeStep[]
  confidence: Confidence
  leverage?: Leverage
  /** insight_type / evidence keys this play is grounded in. MUST resolve to real dossier rule outputs. */
  evidenceRefs: string[]
  /**
   * P11: the REAL cited artifacts behind this play (verbatim review quotes, event name+date+venue,
   * competitor menu lines), each tracing to a ref in `evidenceRefs`. Populated by the presenter pass
   * (`resolveEvidence`); rendered inline on the card + detail page so the operator sees the actual
   * source text, not a category tag. Optional so producer plays and old persisted briefs type-check.
   */
  evidence?: Evidence[]
  /**
   * P11 calibration: the play's operator intent (fix/capture/maintain). Drives the maintain-impact
   * cap in scoring. Optional — unset is treated as `capture` (prior behavior, no cap).
   */
  stance?: Stance
  knowledgeVersion: string
  /** Reviewer's boldness score (0 on-brand .. 3 wild), stamped by applyHarmReview —
   *  carried onto feedback so tolerance recalibration actually moves. */
  severity?: number
  /** P3 display: the 0-100 combined score this play ranked on, and its operator-facing
   *  domain. Stamped by synthesis; optional so older persisted briefs deserialize cleanly
   *  and the deterministic eval fixtures (which omit them) still type-check. */
  combinedScore?: number
  category?: Category
  /** P7a: a deterministic identity that survives regeneration, set on FUSED plays (whose
   *  model-written title is non-deterministic). playKey() prefers it, so dismissing a fused
   *  play keeps it suppressed even after re-fusion rewords the title. Unset on producer plays
   *  (their skillId:title-slug key is already stable). */
  stableKey?: string
  /** Insight-quality upgrade: the structured, evidence-forward presentation block (breakout quotes,
   *  sentiment-by-category, head-to-head, embedded competitor post, %-estimate, advantage flag, the
   *  structured why-confident). Composed by the presenter from the dossier; optional + fail-soft so
   *  producer plays and old persisted briefs deserialize cleanly. Never carries POS/$ claims. */
  presentation?: PlayPresentation
}

/** One signal source the engine checked when building the brief (the "what we checked" view). */
export type BriefCoverage = {
  label: string
  present: boolean
  detail?: string
  /** ISO date this signal was last refreshed (null if never / not present). */
  asOf?: string | null
  /** true when the signal is present but older than the freshness threshold (served last-good). */
  stale?: boolean
}

/** Per-producer health for one brief build. Recorded so the pipeline watchdog can catch the
 *  "every skill silently served its deterministic floor" failure (the 2026-06 truncation bug),
 *  which the brief-level `fallback` flag misses — that flag only trips when the WHOLE brief
 *  degrades, but a brief built from 9 fallback producers still saves with fallback=false. */
export type SkillHealth = {
  skillId: string
  /** "ok" = produced model plays (or a clean fallback); "failed" = the skill threw (0 plays). */
  status: "ok" | "failed"
  /** true when this skill served its DETERMINISTIC fallback instead of real model output. */
  usedFallback: boolean
  /** Why it fell back (truncated | timeout | rate_limited | transport_error | unparseable), if known. */
  reason?: string
  /** Wall-clock ms for this producer's model call. Fleet p95 over these is the early warning that
   *  producers are drifting toward the abort ceiling (→ timeout-fallbacks). Absent pre-2026-07-04. */
  elapsedMs?: number
  /** Differential builds: this run's input-slice hash (see lib/skills/input-hash.ts). Tomorrow's
   *  build compares its fresh hash against this to decide run-vs-reuse. Absent pre-2026-07-07. */
  inputHash?: string
}

/** The synthesized brief that the home renders (persisted to daily_briefs + brief_plays). */
export type Brief = {
  locationId: string
  dateKey: string
  headline: string
  deck: string
  /** The ranked set of plays. Weekly brief = the deep spine (up to ~7); a daily glance trims to 1-3. */
  plays: EnrichedRecommendation[]
  /** "as of" freshness stamp for the freshness/staleness model. */
  asOf: string
  /** Which signal sources fired vs were missing when this brief was built (transparency). */
  coverage?: BriefCoverage[]
  /** true when this brief was served from a model failure fallback (e.g. yesterday's good brief). */
  fallback?: boolean
  /** Per-producer health from this build (see SkillHealth). Absent on briefs built before 2026-07-03. */
  skillHealth?: SkillHealth[]
  /** Anthropic call counters for this build: `requests` attempted, of which `rateLimited` (429/529).
   *  Feeds the fleet-wide rateLimitedRate health signal — the leading indicator of the rate ceiling.
   *  Absent on briefs built before 2026-07-04. */
  providerStats?: { requests: number; rateLimited: number }
  /** Differential builds: each producer's RAW grounded plays from this build, keyed by skillId.
   *  Brief.plays only holds the post-synthesis survivors, so reuse (Phase 1) carries these forward
   *  when a skill's inputHash matches. Fallback-served skills are stored too but NEVER reused
   *  (skillHealth.usedFallback gates that). Absent pre-2026-07-07. */
  skillOutputs?: Record<string, EnrichedRecommendation[]>
}
