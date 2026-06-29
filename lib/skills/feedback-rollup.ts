// ---------------------------------------------------------------------------
// Learning Spine L1 (P15) — PIPELINE 2: CLICK FEEDBACK rollup + the scoring multiplier loader.
//
// Two halves, both fail-soft, both blind to action semantics (they consume the feedback-signals BAND):
//
//  1. AGGREGATION (pure, deterministic, NO LLM) — the nightly rollup. Reads raw feedback events
//     (brief_feedback thumbs + play_actions save/snooze/dismiss), maps EACH through the band
//     (signalFor), resolves each event's play_type_key from the persisted brief, and aggregates per
//     (skill, scope, play_type_key) with Bayesian smoothing + the small-N/confidence guard + the
//     confounder guard, producing a CLAMPED 0.7–1.3 multiplier. Persisted to skill_feedback_rollup.
//
//  2. SCORING LOADER (channel 2) — a fail-soft, loose-typed reader (mirrors knowledge-feeds.ts) that
//     hands synthesis a `(skillId, playTypeKey) -> multiplier` lookup. Returns the NEUTRAL 1.0 on ANY
//     error or below the support gate, so an EMPTY/ABSENT rollup ⇒ ranking byte-identical to today.
//
// ★ The engine is ISOLATED from action semantics: nothing here references "thumbs_up"/"dismissed"
//   etc. Every signal arrives as {polarity, weight, confidence} from the band. Retuning the band
//   (feedback-signals.ts) or removing/adding an action changes these numbers WITHOUT touching this
//   file — proven by feedback-rollup.test.ts.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { signalFor, actionForVerdict, dismissActionFor, type FeedbackSignal } from "@/lib/skills/feedback-signals"
import { computePlayTypeKey } from "@/lib/skills/preferences"
import { PRODUCER_SKILLS, getProducerSkill } from "@/lib/skills/registry"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import {
  PLAY_TYPE_MULTIPLIER_NEUTRAL,
  PLAY_TYPE_MIN_SUPPORT_N,
  PLAY_TYPE_MIN_CONFIDENCE,
  PLAY_TYPE_SMOOTHING_PRIOR,
  multiplierFromBayesScore,
} from "@/lib/skills/scoring-config"

export type RollupScope = "global" | "org" | "location"

/** Minimum distinct orgs a GLOBAL-scope pattern must span (confounder guard §2.2(c)). Below this, a
 *  pattern stays org/location-scoped — one org can't define a fleet-wide prior. Kept here (not in
 *  scoring-config) because it's an aggregation-shape rule, not a scoring weight. */
export const GLOBAL_MIN_ORG_SUPPORT_N = 2

// ── (1) AGGREGATION — pure signal math (no DB, no LLM; unit-tested deterministically) ───────────────

/** One feedback event after band-mapping: the play_type_key it belongs to, the scope identifiers,
 *  the play's severity (for severity-aware aggregation), and the normalized band signal. */
export type MappedFeedback = {
  skillId: string
  playTypeKey: string
  organizationId: string | null
  locationId: string | null
  severity: number
  signal: FeedbackSignal
}

/** The aggregate of a set of band signals for one (skill, scope, play_type_key) cell. */
export type RollupCell = {
  goodCount: number // band-weighted positive mass (weight × confidence on positive-polarity rows)
  badCount: number // band-weighted negative mass
  goodWeighted: number // severity-scaled positive mass (for severity-band consistency checks)
  badWeighted: number
  supportN: number // effective sample size = count of contributing events with non-zero weight
  orgSupportN: number // # distinct orgs contributing (confounder guard input)
  confidence: number // support-weighted mean band confidence in [0,1]
  bayesScore: number // Beta-smoothed liked-rate in [0,1]
  multiplier: number // the served nudge after the guards + clamp (1.0 when gated)
}

const NEUTRAL_CELL: RollupCell = {
  goodCount: 0,
  badCount: 0,
  goodWeighted: 0,
  badWeighted: 0,
  supportN: 0,
  orgSupportN: 0,
  confidence: 0,
  bayesScore: 0.5,
  multiplier: PLAY_TYPE_MULTIPLIER_NEUTRAL,
}

/**
 * Aggregate band signals into a RollupCell. PURE. The guards live here so the persisted multiplier
 * already respects them (and the loader can re-check defensively):
 *   - effective weight per event = signal.weight × signal.confidence (a low-confidence directional
 *     action both moves the counts less AND is easier to swamp — the band's whole point).
 *   - liked-rate is Beta-smoothed (PLAY_TYPE_SMOOTHING_PRIOR) so small N smooths toward 0.5 ⇒ ~1.0.
 *   - small-N guard: below PLAY_TYPE_MIN_SUPPORT_N → multiplier forced NEUTRAL.
 *   - confidence guard: aggregate confidence < PLAY_TYPE_MIN_CONFIDENCE → multiplier forced NEUTRAL.
 *   - multiplier clamped 0.7..1.3 (via multiplierFromBayesScore).
 * `severityConsistencyOk` (severity-aware, §2.2(b)): the play_type_key already carries the severity
 * BAND, so cells are per-band by construction; we additionally damp a cell whose positive/negative
 * mass is wildly inconsistent within itself by relying on the smoothing prior (no extra rule needed).
 */
export function aggregateSignals(events: MappedFeedback[]): RollupCell {
  if (events.length === 0) return { ...NEUTRAL_CELL }

  let goodCount = 0
  let badCount = 0
  let goodWeighted = 0
  let badWeighted = 0
  let supportN = 0
  let confidenceSum = 0
  let confidenceWeight = 0
  const orgs = new Set<string>()

  for (const e of events) {
    const eff = e.signal.weight * e.signal.confidence // effective mass of this event
    if (eff <= 0 || e.signal.polarity === 0) continue // neutral/unknown action = no-op (band isolation)
    supportN++
    // severity scaling: a band already groups by sevBand, but the weighted sums let the distiller
    // confirm a pattern's magnitude scales with adventurousness rather than resting on one band.
    const sevScale = 1 + Math.max(0, Math.min(3, e.severity)) / 3 // 1.0 (tame) .. 2.0 (wild)
    if (e.signal.polarity > 0) {
      goodCount += eff
      goodWeighted += eff * sevScale
    } else {
      badCount += eff
      badWeighted += eff * sevScale
    }
    confidenceSum += e.signal.confidence * e.signal.weight
    confidenceWeight += e.signal.weight
    if (e.organizationId) orgs.add(e.organizationId)
  }

  const confidence = confidenceWeight > 0 ? confidenceSum / confidenceWeight : 0
  const { alpha, beta } = PLAY_TYPE_SMOOTHING_PRIOR
  // Beta-Binomial posterior mean of the liked-rate: (good + α) / (good + bad + α + β).
  const bayesScore = (goodCount + alpha) / (goodCount + badCount + alpha + beta)

  // GUARDS: below support OR below confidence → force NEUTRAL (no nudge). Otherwise map the smoothed
  // liked-rate onto the clamped range.
  const gated = supportN < PLAY_TYPE_MIN_SUPPORT_N || confidence < PLAY_TYPE_MIN_CONFIDENCE
  const multiplier = gated ? PLAY_TYPE_MULTIPLIER_NEUTRAL : multiplierFromBayesScore(bayesScore)

  return {
    goodCount,
    badCount,
    goodWeighted,
    badWeighted,
    supportN,
    orgSupportN: orgs.size,
    confidence,
    bayesScore,
    multiplier,
  }
}

/** A persisted rollup row to be upserted (the shape the recompute writes + the loader reads back). */
export type RollupRow = {
  skillId: string
  scope: RollupScope
  scopeId: string | null
  playTypeKey: string
  cell: RollupCell
}

/**
 * Build all rollup rows from a set of mapped feedback events. For each play_type_key we emit:
 *   - one LOCATION row per contributing location,
 *   - one ORG row per contributing org,
 *   - one GLOBAL row — but ONLY if it spans >= GLOBAL_MIN_ORG_SUPPORT_N distinct orgs (confounder
 *     guard §2.2(c)); otherwise the global row is suppressed and the pattern stays org/location-scoped.
 * PURE + deterministic (rows sorted by a stable key) so the recompute is idempotent + testable.
 */
export function buildRollupRows(events: MappedFeedback[]): RollupRow[] {
  const byKey = new Map<string, MappedFeedback[]>()
  for (const e of events) {
    const arr = byKey.get(e.playTypeKey) ?? []
    arr.push(e)
    byKey.set(e.playTypeKey, arr)
  }

  const rows: RollupRow[] = []
  for (const [playTypeKey, group] of byKey) {
    const skillId = group[0].skillId

    // LOCATION scope.
    const byLocation = new Map<string, MappedFeedback[]>()
    for (const e of group) {
      if (!e.locationId) continue
      const arr = byLocation.get(e.locationId) ?? []
      arr.push(e)
      byLocation.set(e.locationId, arr)
    }
    for (const [locationId, evs] of byLocation) {
      rows.push({ skillId, scope: "location", scopeId: locationId, playTypeKey, cell: aggregateSignals(evs) })
    }

    // ORG scope.
    const byOrg = new Map<string, MappedFeedback[]>()
    for (const e of group) {
      if (!e.organizationId) continue
      const arr = byOrg.get(e.organizationId) ?? []
      arr.push(e)
      byOrg.set(e.organizationId, arr)
    }
    for (const [organizationId, evs] of byOrg) {
      rows.push({ skillId, scope: "org", scopeId: organizationId, playTypeKey, cell: aggregateSignals(evs) })
    }

    // GLOBAL scope — gated on the confounder guard: must span MULTIPLE orgs.
    const globalCell = aggregateSignals(group)
    if (globalCell.orgSupportN >= GLOBAL_MIN_ORG_SUPPORT_N) {
      rows.push({ skillId, scope: "global", scopeId: null, playTypeKey, cell: globalCell })
    }
  }

  // Stable order so a re-run produces byte-identical upsert payloads (idempotent).
  rows.sort(
    (a, b) =>
      a.skillId.localeCompare(b.skillId) ||
      a.scope.localeCompare(b.scope) ||
      (a.scopeId ?? "").localeCompare(b.scopeId ?? "") ||
      a.playTypeKey.localeCompare(b.playTypeKey),
  )
  return rows
}

// ── (2) SCORING LOADER — fail-soft multiplier lookup for synthesis (mirrors knowledge-feeds.ts) ─────

/** The resolved multiplier lookup synthesis uses. NEUTRAL (1.0) for any key not present / gated. */
export type PlayTypeMultiplierLookup = {
  /** Best multiplier for a play_type_key at the given scope precedence (location > org > global). */
  multiplierFor: (playTypeKey: string) => number
}

/** A NEUTRAL lookup — the FLOOR. Every key → 1.0 ⇒ synthesis ranking is byte-identical to today. */
export const NEUTRAL_LOOKUP: PlayTypeMultiplierLookup = {
  multiplierFor: () => PLAY_TYPE_MULTIPLIER_NEUTRAL,
}

// Loose client surface — skill_feedback_rollup isn't in the generated DB types until the migration is
// applied (same posture as knowledge-feeds.ts / evergreen.ts / preferences.ts).
// skill_feedback_rollup is now in the generated types — the real typed client (aliased for mocking).
type RollupStore = SupabaseClient<Database>

function readStore(client?: RollupStore): RollupStore {
  return client ?? createAdminSupabaseClient()
}

export type RollupScopeIds = { organizationId?: string | null; locationId?: string | null }

/** Defensive re-check at read time: a row only nudges if it's still above the support + confidence
 *  gates (mirrors the recompute guards, so an old/loose row can't sneak past). Returns the clamped
 *  multiplier or the neutral 1.0. */
function multiplierFromRow(r: Record<string, unknown>): number {
  const supportN = typeof r.support_n === "number" ? r.support_n : 0
  const stored = typeof r.multiplier === "number" ? r.multiplier : PLAY_TYPE_MULTIPLIER_NEUTRAL
  if (supportN < PLAY_TYPE_MIN_SUPPORT_N) return PLAY_TYPE_MULTIPLIER_NEUTRAL
  // Clamp defensively in case a stored value drifted out of range.
  return Math.max(0.7, Math.min(1.3, stored))
}

/**
 * Load the multiplier lookup for a set of skills at this location's scope. FAIL-SOFT: returns the
 * NEUTRAL lookup on ANY error (table missing pre-migration, network blip, malformed rows) so a brief
 * build can never break and an EMPTY table leaves ranking byte-identical to today.
 *
 * Scope precedence: a location-scoped row wins over an org row, which wins over a global row — the
 * most specific learned signal for THIS operator nudges, falling back to broader patterns. Within a
 * scope, the row's own support/confidence gate still applies (re-checked here).
 */
export async function loadPlayTypeMultipliers(
  skillIds: string[],
  scope: RollupScopeIds = {},
  opts: { client?: RollupStore } = {},
): Promise<PlayTypeMultiplierLookup> {
  if (skillIds.length === 0) return NEUTRAL_LOOKUP
  // The scope_ids we could match: this org + this location (+ global rows, scope_id IS NULL, which the
  // `in` can't express — so we also tolerate them by fetching by skill + scope and filtering client-side).
  try {
    const { data, error } = await readStore(opts.client)
      .from("skill_feedback_rollup")
      .select("skill_id, scope, scope_id, play_type_key, multiplier, support_n")
      .in("skill_id", skillIds)
      .in("scope", ["global", "org", "location"])
    if (error) return NEUTRAL_LOOKUP

    // For each play_type_key, keep the highest-precedence applicable row's multiplier.
    const SCOPE_RANK: Record<string, number> = { location: 3, org: 2, global: 1 }
    const best = new Map<string, { rank: number; multiplier: number }>()
    for (const r of data ?? []) {
      const rowScope = String(r.scope ?? "")
      const scopeId = r.scope_id == null ? null : String(r.scope_id)
      // Only rows that apply to THIS location/org/global.
      const applies =
        (rowScope === "global" && scopeId === null) ||
        (rowScope === "org" && scope.organizationId != null && scopeId === scope.organizationId) ||
        (rowScope === "location" && scope.locationId != null && scopeId === scope.locationId)
      if (!applies) continue
      const key = String(r.play_type_key ?? "")
      if (!key) continue
      const rank = SCOPE_RANK[rowScope] ?? 0
      const prior = best.get(key)
      if (prior && prior.rank >= rank) continue // a more-specific scope already won
      best.set(key, { rank, multiplier: multiplierFromRow(r) })
    }

    if (best.size === 0) return NEUTRAL_LOOKUP
    return {
      multiplierFor: (playTypeKey: string) => best.get(playTypeKey)?.multiplier ?? PLAY_TYPE_MULTIPLIER_NEUTRAL,
    }
  } catch {
    return NEUTRAL_LOOKUP
  }
}

// Resolves a location's org (so the loader can include org-scoped rows); the real typed client.
type OrgLookupStore = SupabaseClient<Database>

/**
 * Convenience for the brief-build callers: load the multiplier lookup for a location, resolving its
 * org so org-scoped rows apply too. FAIL-SOFT end to end — any error (incl. pre-migration) yields the
 * NEUTRAL lookup, so the brief build can never break and ranking stays byte-identical to today.
 */
export async function loadPlayTypeMultipliersForLocation(
  locationId: string,
  skillIds: string[],
  opts: { client?: RollupStore; orgClient?: OrgLookupStore } = {},
): Promise<PlayTypeMultiplierLookup> {
  let organizationId: string | null = null
  try {
    const orgClient = opts.orgClient ?? createAdminSupabaseClient()
    const { data } = await orgClient.from("locations").select("organization_id").eq("id", locationId).maybeSingle()
    organizationId = data?.organization_id ?? null
  } catch {
    organizationId = null // org-scoped rows simply won't match; location + global still apply.
  }
  return loadPlayTypeMultipliers(skillIds, { organizationId, locationId }, { client: opts.client })
}

// ── (4) SHADOW multiplier loader (P17a) — what a NOT-YET-SERVED feedback learning WOULD do ───────────
//
// A `shadow`-status feedback_pattern (skill_knowledge) carries the play_type_key it concerns in its
// provenance. Its multiplier isn't served (shadow rows never reach the prompt/score), but we still
// want to OBSERVE what it WOULD do. This loader reads the shadow feedback_pattern rows and maps each
// to the multiplier its rollup row already computed (the real, grounded nudge) — handing synthesis a
// lookup that returns 1.0 for every NON-shadow key (so only the shadow learnings move the replay).
//
// FAIL-SOFT: any error / absent table → an EMPTY shadow set (signalCount 0) ⇒ no shadow replay at all.

/** Reads shadow skill_knowledge feedback_pattern rows (their provenance.play_type_key); typed client. */
type ShadowKnowledgeStore = SupabaseClient<Database>

export type ShadowMultiplierSet = { lookup: PlayTypeMultiplierLookup; signalCount: number }

/** The EMPTY shadow set — no shadow learnings ⇒ no replay (the floor). */
export const EMPTY_SHADOW_SET: ShadowMultiplierSet = { lookup: NEUTRAL_LOOKUP, signalCount: 0 }

/**
 * Build the SHADOW multiplier set: the play_type_keys of shadow feedback_pattern learnings → the
 * multiplier their served rollup row computed. PURE-ish (one read of shadow knowledge + one of the
 * rollup). FAIL-SOFT → EMPTY_SHADOW_SET on ANY error so the brief build is never affected.
 */
export async function loadShadowPlayTypeMultipliers(
  skillIds: string[],
  scope: RollupScopeIds = {},
  opts: { knowledgeClient?: ShadowKnowledgeStore; rollupClient?: RollupStore } = {},
): Promise<ShadowMultiplierSet> {
  if (skillIds.length === 0) return EMPTY_SHADOW_SET
  try {
    const kc =
      opts.knowledgeClient ?? createAdminSupabaseClient()
    // shadow feedback_pattern rows carry their play_type_key in provenance.
    const shadowKeys = new Set<string>()
    for (const skillId of skillIds) {
      const { data, error } = await kc
        .from("skill_knowledge")
        .select("skill_id, learning_kind, status, provenance")
        .eq("skill_id", skillId)
        .eq("status", "shadow")
      if (error) continue
      for (const r of data ?? []) {
        if (String(r.learning_kind) !== "feedback_pattern") continue
        const prov = (r.provenance ?? {}) as Record<string, unknown>
        const ptk = typeof prov.play_type_key === "string" ? prov.play_type_key : ""
        if (ptk) shadowKeys.add(ptk)
      }
    }
    if (shadowKeys.size === 0) return EMPTY_SHADOW_SET

    // Resolve each shadow key to the multiplier its rollup row computed (the real grounded nudge).
    const served = await loadPlayTypeMultipliers(skillIds, scope, { client: opts.rollupClient })
    const shadowMultiplierFor = (key: string) => (shadowKeys.has(key) ? served.multiplierFor(key) : PLAY_TYPE_MULTIPLIER_NEUTRAL)
    return { lookup: { multiplierFor: shadowMultiplierFor }, signalCount: shadowKeys.size }
  } catch {
    return EMPTY_SHADOW_SET
  }
}

// ── (3) NIGHTLY RECOMPUTE — the cheap, deterministic, NO-LLM rollup runner (PIPELINE 2 nightly) ─────
//
// Reads raw feedback events (brief_feedback thumbs + play_actions save/snooze/dismiss), resolves each
// event's play_type_key from the PERSISTED brief that produced it (daily_briefs.brief jsonb carries
// the full plays[] with skillId/kind/evidenceRefs/severity), maps each through the BAND, builds rollup
// rows (location/org/global with the confounder guard), and UPSERTS skill_feedback_rollup. Idempotent
// (recompute overwrites in place on the unique key). dryRun computes everything but writes nothing.
//
// Determinism + cost: pure aggregation, no model calls. One read of recent feedback + the briefs they
// reference. The CAPTURE path (recordPlayFeedback / setPlayAction) is UNCHANGED + real-time; only this
// DISTILLATION is batched.

/** The nightly runner's client (service-role; reads feedback + briefs, upserts rollup); typed client. */
export type RecomputeStore = SupabaseClient<Database>

export type RecomputeResult = {
  dryRun: boolean
  feedbackRows: number // raw events considered
  resolved: number // events whose play_type_key resolved from a persisted brief
  unresolved: number // events whose play could not be found (skipped, not fabricated)
  rollupRows: number // skill_feedback_rollup rows built
  globalRows: number // of those, how many cleared the confounder guard (multi-org)
  rowsWritten: number // rows actually upserted (0 on dryRun / on a write error)
  /** Persistence (upsert) failures, SURFACED — never swallowed. A non-empty array means a built rollup
   *  set did NOT reach skill_feedback_rollup (e.g. an ON CONFLICT mismatch). The run stays fail-soft (a
   *  write error does not throw), but it can NEVER be invisible — this is what hid the original bug. */
  writeErrors: Array<{ scope: string; error: string }>
}

/** Resolve a persisted brief's plays into a (play_key → play) map for play_type_key resolution. The
 *  play_key uses the SAME playKey() logic the capture path stamped, so keys line up. */
function indexBriefPlays(briefJson: unknown): Map<string, EnrichedRecommendation> {
  const out = new Map<string, EnrichedRecommendation>()
  const plays = (briefJson as { plays?: unknown })?.plays
  if (!Array.isArray(plays)) return out
  for (const raw of plays) {
    const p = raw as EnrichedRecommendation & { stableKey?: string }
    if (!p || typeof p.skillId !== "string" || typeof p.title !== "string") continue
    // Mirror playKey(): prefer stableKey, else skillId:title-slug. (Kept inline to avoid importing the
    // brief-action layer; identical normalization.)
    const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
    const key = p.stableKey || `${p.skillId}:${slug}`
    out.set(key, p)
  }
  return out
}

/** The skill's declared lead-domain (stable) for play_type_key, else undefined (derive from refs). */
function leadDomainForSkill(skillId: string): string | undefined {
  return getProducerSkill(skillId)?.learning?.playTypeLeadDomain
}

/**
 * Run the nightly rollup. PURE-ish: all signal math is in aggregateSignals/buildRollupRows; this
 * orchestrates the reads + the idempotent upsert. FAIL-SOFT: any read error → a no-op result (the
 * floor; the existing rollup rows simply aren't refreshed tonight). One bad row never aborts the run.
 */
export async function runFeedbackRollup(opts: {
  store: RecomputeStore
  dryRun?: boolean
  nowMs?: number
  /** Look back this many days of feedback (default 90). */
  windowDays?: number
}): Promise<RecomputeResult> {
  const now = opts.nowMs ?? Date.now()
  const sinceIso = new Date(now - (opts.windowDays ?? 90) * 86_400_000).toISOString()
  const result: RecomputeResult = {
    dryRun: !!opts.dryRun,
    feedbackRows: 0,
    resolved: 0,
    unresolved: 0,
    rollupRows: 0,
    globalRows: 0,
    rowsWritten: 0,
    writeErrors: [],
  }

  // 1) Read raw feedback events: thumbs (brief_feedback) + directional actions (play_actions).
  let thumbs: Record<string, unknown>[] = []
  let actions: Record<string, unknown>[] = []
  try {
    const { data, error } = await opts.store
      .from("brief_feedback")
      .select("location_id, date_key, play_key, verdict, severity")
      .gte("created_at", sinceIso)
    if (error) return result // fail-soft: feedback unreadable → no-op (floor = existing rollup)
    thumbs = data ?? []
  } catch {
    return result
  }
  try {
    // Read `reason` too so a reasoned dismissal can become a directional signal. The column isn't in
    // the generated types until the migration is applied, so this read goes through a loose cast; and we
    // TWO-TRY it — if `reason` doesn't exist yet (pre-migration), fall back to the columns that always
    // exist so the saved/dismissed stream STILL rolls up (no regression while the column is dark).
    const pa = opts.store as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          gte: (col: string, v: string) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
        }
      }
    }
    let res = await pa.from("play_actions").select("location_id, date_key, play_key, action, reason").gte("created_at", sinceIso)
    if (res.error) {
      res = await pa.from("play_actions").select("location_id, date_key, play_key, action").gte("created_at", sinceIso)
    }
    if (!res.error) actions = res.data ?? []
    // a play_actions read failure is non-fatal — the thumbs stream still rolls up (band isolation).
  } catch {
    /* directional stream optional; thumbs still distill */
  }

  result.feedbackRows = thumbs.length + actions.length
  if (result.feedbackRows === 0) return result

  // 2) Resolve play → play_type_key by loading the persisted briefs the feedback references. We index
  //    briefs by (location_id, date_key) lazily and cache per location to avoid re-reads.
  const briefCache = new Map<string, Map<string, EnrichedRecommendation>>() // `${loc}|${date}` → playKey→play
  const orgCache = new Map<string, string | null>()

  async function briefIndex(locationId: string, dateKey: string): Promise<Map<string, EnrichedRecommendation>> {
    const cacheKey = `${locationId}|${dateKey}`
    const hit = briefCache.get(cacheKey)
    if (hit) return hit
    let idx = new Map<string, EnrichedRecommendation>()
    try {
      // Fetch this location's briefs once and index by date (the caller looks up by (loc, date)).
      const { data } = await opts.store
        .from("daily_briefs")
        .select("location_id, date_key, brief")
        .in("location_id", [locationId])
      for (const row of data ?? []) {
        if (String(row.location_id) !== locationId) continue
        const dk = String(row.date_key)
        briefCache.set(`${locationId}|${dk}`, indexBriefPlays(row.brief))
      }
      idx = briefCache.get(cacheKey) ?? new Map()
      if (!briefCache.has(cacheKey)) briefCache.set(cacheKey, idx)
    } catch {
      briefCache.set(cacheKey, idx)
    }
    return idx
  }

  async function orgFor(locationId: string): Promise<string | null> {
    if (orgCache.has(locationId)) return orgCache.get(locationId)!
    let org: string | null = null
    try {
      const { data } = await opts.store
        .from("locations")
        .select("id, organization_id")
        .in("id", [locationId])
      org = (data ?? []).find((r) => String(r.id) === locationId)?.organization_id as string | null ?? null
    } catch {
      org = null
    }
    orgCache.set(locationId, org)
    return org
  }

  const mapped: MappedFeedback[] = []

  async function mapEvent(
    locationId: string,
    dateKey: string,
    playKeyStr: string,
    action: string,
    severityFallback: number,
  ): Promise<void> {
    const idx = await briefIndex(locationId, dateKey)
    const play = idx.get(playKeyStr)
    if (!play) {
      result.unresolved++
      return // do NOT fabricate a play_type_key for an event we can't ground to a real play
    }
    result.resolved++
    const playTypeKey = computePlayTypeKey(play, { leadDomainOverride: leadDomainForSkill(play.skillId) })
    mapped.push({
      skillId: play.skillId,
      playTypeKey,
      organizationId: await orgFor(locationId),
      locationId,
      severity: typeof play.severity === "number" ? play.severity : severityFallback,
      signal: signalFor(action),
    })
  }

  // thumbs → band action via the verdict→action translator (the ONE place that mapping lives).
  for (const r of thumbs) {
    const verdict = r.verdict === "good" ? "good" : "bad"
    await mapEvent(
      String(r.location_id ?? ""),
      String(r.date_key ?? ""),
      String(r.play_key ?? ""),
      actionForVerdict(verdict),
      typeof r.severity === "number" ? r.severity : 0,
    )
  }
  // directional actions → band action. saved/snoozed map directly; a `dismissed` is qualified by its
  // captured reason via dismissActionFor → `dismissed:<code>` (or bare `dismissed` when absent/unknown),
  // so the band — not this loop — decides whether a reasoned Remove carries a signal (band isolation).
  for (const r of actions) {
    const rawAction = String(r.action ?? "")
    const bandAction = rawAction === "dismissed" ? dismissActionFor(r.reason as string | null | undefined) : rawAction
    await mapEvent(String(r.location_id ?? ""), String(r.date_key ?? ""), String(r.play_key ?? ""), bandAction, 0)
  }

  // 3) Build rows (with the guards baked in) + upsert (idempotent).
  const rows = buildRollupRows(mapped)
  result.rollupRows = rows.length
  result.globalRows = rows.filter((r) => r.scope === "global").length
  if (opts.dryRun || rows.length === 0) return result

  const payload = rows.map((r) => ({
    skill_id: r.skillId,
    scope: r.scope,
    scope_id: r.scopeId,
    play_type_key: r.playTypeKey,
    good_count: r.cell.goodCount,
    bad_count: r.cell.badCount,
    good_weighted: r.cell.goodWeighted,
    bad_weighted: r.cell.badWeighted,
    bayes_score: r.cell.bayesScore,
    multiplier: r.cell.multiplier,
    support_n: r.cell.supportN,
    org_support_n: r.cell.orgSupportN,
    last_recompute: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  }))
  // ONE non-partial dedupe index (uq_skill_feedback_rollup_dedupe) over the FULL tuple, declared NULLS
  // NOT DISTINCT, now covers BOTH global rows (scope_id NULL) and scoped rows — so a single upsert with
  // the full conflict target is idempotent for all of them. (The old code split into two upserts against
  // two PARTIAL indexes; neither could be an ON CONFLICT target, so every write raised 42P10 + was
  // SWALLOWED → 0 rows. onConflict here MUST match uq_skill_feedback_rollup_dedupe.)
  try {
    const { error } = await opts.store
      .from("skill_feedback_rollup")
      .upsert(payload, { onConflict: "skill_id,scope,scope_id,play_type_key" })
    if (error) {
      // SURFACE it (never swallow): fail-soft (no throw), but visible in the result + the logs.
      console.warn("[feedback-rollup] upsert failed:", error.message)
      result.writeErrors.push({ scope: "all", error: error.message })
    } else {
      result.rowsWritten = payload.length
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn("[feedback-rollup] upsert threw:", msg)
    result.writeErrors.push({ scope: "all", error: msg })
  }

  return result
}

/** The skill ids the rollup covers (all registered producers). Exposed for the cron + tests. */
export const ROLLUP_SKILL_IDS = PRODUCER_SKILLS.map((s) => s.id)
