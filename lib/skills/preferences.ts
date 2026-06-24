// ---------------------------------------------------------------------------
// Brand-tolerance preference + feedback loop (Bryan's control system).
//
// - Each customer has a `brandTolerance` slider (0-100). They can set it directly,
//   or it self-tunes from good/bad feedback: liking a wild (high-severity) play
//   raises tolerance; disliking one lowers it.
// - Feedback is captured per play (the UI wires the thumbs later). Stored to
//   brief_feedback; loaded to recalibrate.
//
// Loose client surface because brief_feedback isn't in the generated DB types until
// the migration is applied (same pattern as daily-brief.ts).
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { EnrichedRecommendation } from "@/lib/skills/types"

export type Verdict = "good" | "bad"
export type PlayFeedback = { playKey: string; verdict: Verdict; severity: number }

/** Stable key for a play (for feedback + dismissal targeting), independent of brief ordering.
 *  Prefers an explicit stableKey when present (FUSED plays — their model-written title is not
 *  deterministic across regenerations; P7a). Producer plays fall back to skillId:title-slug. */
export function playKey(p: Pick<EnrichedRecommendation, "skillId" | "title"> & { stableKey?: string }): string {
  if (p.stableKey) return p.stableKey
  const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
  return `${p.skillId}:${slug}`
}

// ── P15: play_type_key — the stable, low-cardinality descriptor the feedback rollup keys on ────────
//
// The rollup aggregates feedback BY PLAY TYPE, not by the exact play (a specific play rarely recurs;
// its TYPE does). The key must be STABLE across regenerations (so feedback compounds) and LOW
// CARDINALITY (so support_n accumulates instead of fragmenting into singletons that never clear the
// small-N guard). It is: skillId + kind + lead-evidence-domain + severity-band. Lives beside playKey
// because both are "the identity of a play for the feedback system" (the spec says here or a sibling).

/** Severity (0 on-brand .. 3 wild, stamped by applyHarmReview) collapsed to a low-cardinality band,
 *  so feedback on a sev-2 and a sev-3 of the same play-type aggregate together rather than splitting:
 *  tame (0-1) | bold (2) | wild (3). Undefined severity → "tame" (the on-brand default). */
export function severityBand(severity: number | undefined): "tame" | "bold" | "wild" {
  if (typeof severity !== "number" || severity <= 1) return "tame"
  if (severity >= 3) return "wild"
  return "bold"
}

/** The lead evidence DOMAIN for a play — the stem of its first evidenceRef (the part before ":" or
 *  the first "_"-segment), lower-cased. This is the coarse "what kind of signal grounds this play"
 *  tag (e.g. `event`, `review`, `social`, `competitor`). A skill's declared learning.playTypeLeadDomain
 *  is the PREFERRED source (stable + intentional); evidenceRefs are the fallback when no hook is set.
 *  Empty refs → "none" (still low-cardinality, never undefined). */
export function leadEvidenceDomain(refs: readonly string[] | undefined): string {
  const first = refs?.find((r) => typeof r === "string" && r.trim().length > 0)
  if (!first) return "none"
  // Take the base before a ":" field-suffix, then the first underscore segment of that base, so
  // `seo_competitor_growth_trend:pct` and `seo_competitor_overtake` both reduce to `seo` — keeping
  // cardinality low while preserving the broad signal family.
  const base = first.split(":")[0]
  const stem = base.split("_")[0]
  return (stem || base).toLowerCase()
}

/**
 * computePlayTypeKey — the stable, low-cardinality key the feedback rollup aggregates on (P10/P15).
 * Shape: `${skillId}|${kind}|${leadDomain}|${severityBand}`.
 *
 * - skillId      : which expert produced it (the rollup is keyed BY SKILL so it feeds that skill's loop).
 * - kind         : the play SHAPE (prepare/capitalize/reputation/positioning/ops).
 * - leadDomain   : the coarse evidence family (the skill's declared lead-domain, else the first ref's
 *                  stem). Stable + intentional when the skill declares a hook.
 * - severityBand : tame | bold | wild — so feedback on adventurous vs on-brand variants aggregates
 *                  per band (severity-aware distillation, guardrail §2.2(b)).
 *
 * `leadDomainOverride` lets the caller pass the skill's declared learning.playTypeLeadDomain (the
 * preferred, stable source); when absent it's derived from evidenceRefs. Deterministic + pure.
 */
export function computePlayTypeKey(
  p: Pick<EnrichedRecommendation, "skillId" | "kind" | "evidenceRefs" | "severity">,
  opts: { leadDomainOverride?: string } = {},
): string {
  const lead = opts.leadDomainOverride?.trim() || leadEvidenceDomain(p.evidenceRefs)
  return [p.skillId, p.kind, lead.toLowerCase(), severityBand(p.severity)].join("|")
}

const STEP = 8
const clamp = (n: number) => Math.max(0, Math.min(100, n))

/**
 * Recalibrate the tolerance from feedback. Severity is how adventurous the play was
 * (0 on-brand .. 3 wild). Liking a wild play raises tolerance; disliking one lowers it.
 * Feedback on tame plays barely moves the slider (it is not about tolerance).
 */
export function recalibrateTolerance(current: number, feedback: PlayFeedback[]): number {
  let t = current
  for (const f of feedback) {
    if (f.severity >= 2) {
      t += f.verdict === "good" ? STEP : -STEP
    } else if (f.severity === 1 && f.verdict === "bad") {
      t -= STEP / 2
    }
  }
  return clamp(Math.round(t))
}

// ── persistence (loose client; gated on the migration) ─────────────────────
type FeedbackStore = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: Array<Record<string, unknown>> | null }>
        }
      }
    }
  }
}

function store(client?: FeedbackStore): FeedbackStore {
  return client ?? (createAdminSupabaseClient() as unknown as FeedbackStore)
}

export async function recordPlayFeedback(
  locationId: string,
  dateKey: string,
  fb: PlayFeedback,
  opts: { client?: FeedbackStore } = {},
): Promise<void> {
  const { error } = await store(opts.client)
    .from("brief_feedback")
    .insert({ location_id: locationId, date_key: dateKey, play_key: fb.playKey, verdict: fb.verdict, severity: fb.severity })
  if (error) throw new Error(`recordPlayFeedback failed: ${error.message}`)
}

export async function loadFeedback(locationId: string, opts: { limit?: number; client?: FeedbackStore } = {}): Promise<PlayFeedback[]> {
  const { data } = await store(opts.client)
    .from("brief_feedback")
    .select("play_key, verdict, severity")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200)
  return (data ?? []).map((r) => ({
    playKey: String(r.play_key ?? ""),
    verdict: (r.verdict === "good" ? "good" : "bad") as Verdict,
    severity: typeof r.severity === "number" ? r.severity : 0,
  }))
}
