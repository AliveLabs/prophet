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
 * Operator-facing DOMAIN of a play — used by the scoring priors, drill-down, and the
 * per-operator rerank controls (P2/P3/P8). Declared INTRINSICALLY on each ProducerSkill;
 * NOT derived from RecKind (local-demand and marketing both carry kind "capitalize" yet are
 * different categories). Social folds into marketing for now (no skill owns it yet). RecKind
 * stays the play SHAPE (prepare/capitalize/…); Category is the domain a play belongs to.
 */
export type Category = "demand" | "marketing" | "positioning" | "reputation" | "operations"

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
  knowledgeVersion: string
  /** Reviewer's boldness score (0 on-brand .. 3 wild), stamped by applyHarmReview —
   *  carried onto feedback so tolerance recalibration actually moves. */
  severity?: number
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
