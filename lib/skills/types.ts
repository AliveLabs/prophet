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
 * different categories). Social folds into marketing for now (no skill owns it yet). RecKind
 * stays the play SHAPE (prepare/capitalize/…); Category is the domain a play belongs to.
 */
export type Category = "demand" | "marketing" | "menu" | "grassroots" | "positioning" | "reputation" | "operations" | "convergence"

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
}
