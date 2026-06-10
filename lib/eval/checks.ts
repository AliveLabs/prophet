// ---------------------------------------------------------------------------
// Deterministic eval checks (Phase B) — run in CI on every brief.
//
// These are the regression guard for the engine rewrite. They are pure,
// dependency-free, and fast, so they belong in PR CI (the LLM-as-judge in
// judge.ts runs offline/nightly). They enforce the structural + grounding +
// voice contract without judging "quality". See the rewrite plan, Phase B.
// ---------------------------------------------------------------------------

import type { EnrichedRecommendation, Brief } from "@/lib/skills/types"
import { lintVoice } from "@/lib/eval/voice-rules"

const OWNER_ROLES = new Set(["owner", "gm", "marketing", "kitchen", "foh"])
const REC_KINDS = new Set(["prepare", "capitalize", "positioning", "reputation", "ops"])
const CONFIDENCE = new Set(["high", "medium", "directional"])

/** Forbidden keys that would imply Ticket executes for the operator (intelligence without execution). */
const EXECUTABLE_KEYS = [
  "apiToken",
  "accessToken",
  "token",
  "postNow",
  "publish",
  "scheduleAt",
  "scheduledFor",
  "send",
  "execute",
  "credentials",
  "oauth",
]

export type Violation = { code: string; recIndex: number; detail: string }
export type CheckResult = { ok: boolean; violations: Violation[] }

/**
 * A lightweight index of what the dossier actually proved, derived once per
 * brief. evidenceRefs must be a subset of `allowedRefs`; any number a recipe
 * states must appear in `evidenceNumbers` (anti-fabrication).
 */
export type RefIndex = {
  allowedRefs: Set<string>
  evidenceNumbers: Set<number>
}

/** Extract distinct numbers from free text (e.g. "$35", "30,000", "43%"). */
export function extractNumbers(text: string | undefined | null): number[] {
  if (!text) return []
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []
  return matches.map((m) => Number(m.replace(/,/g, ""))).filter((n) => Number.isFinite(n))
}

// ── individual checks ──────────────────────────────────────────────────────

export function checkEnums(rec: EnrichedRecommendation, i: number): Violation[] {
  const v: Violation[] = []
  if (!OWNER_ROLES.has(rec.ownerRole)) v.push({ code: "bad_owner_role", recIndex: i, detail: rec.ownerRole })
  if (!REC_KINDS.has(rec.kind)) v.push({ code: "bad_kind", recIndex: i, detail: rec.kind })
  if (!CONFIDENCE.has(rec.confidence)) v.push({ code: "bad_confidence", recIndex: i, detail: rec.confidence })
  return v
}

export function checkRecipeCompleteness(rec: EnrichedRecommendation, i: number): Violation[] {
  const v: Violation[] = []
  if (!rec.title?.trim()) v.push({ code: "missing_title", recIndex: i, detail: "" })
  if (!rec.rationale?.trim()) v.push({ code: "missing_rationale", recIndex: i, detail: "" })
  if (!rec.skillId?.trim()) v.push({ code: "missing_skillId", recIndex: i, detail: "" })
  if (!Array.isArray(rec.recipe) || rec.recipe.length === 0) {
    v.push({ code: "empty_recipe", recIndex: i, detail: "" })
    return v
  }
  rec.recipe.forEach((step, s) => {
    if (!step.channel?.trim()) v.push({ code: "step_missing_channel", recIndex: i, detail: `step ${s}` })
    if (!step.audience?.trim()) v.push({ code: "step_missing_audience", recIndex: i, detail: `step ${s}` })
    if (!step.window?.note?.trim()) v.push({ code: "step_missing_window", recIndex: i, detail: `step ${s}` })
  })
  return v
}

export function checkNoExecutableFields(rec: EnrichedRecommendation, i: number): Violation[] {
  const v: Violation[] = []
  const scan = (obj: unknown, path: string) => {
    if (!obj || typeof obj !== "object") return
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (EXECUTABLE_KEYS.includes(key)) v.push({ code: "executable_field", recIndex: i, detail: `${path}.${key}` })
      scan((obj as Record<string, unknown>)[key], `${path}.${key}`)
    }
  }
  rec.recipe?.forEach((step, s) => scan(step, `recipe[${s}]`))
  return v
}

export function checkEvidenceRefsResolve(rec: EnrichedRecommendation, i: number, index: RefIndex): Violation[] {
  const v: Violation[] = []
  if (!Array.isArray(rec.evidenceRefs) || rec.evidenceRefs.length === 0) {
    v.push({ code: "no_evidence_refs", recIndex: i, detail: "every play must cite >=1 grounded ref" })
    return v
  }
  for (const ref of rec.evidenceRefs) {
    if (!index.allowedRefs.has(ref)) v.push({ code: "unresolved_evidence_ref", recIndex: i, detail: ref })
  }
  return v
}

/**
 * Anti-fabrication: a stated FACTUAL QUANTITY must trace to real evidence.
 * Scoped to `leverage.reach` (an explicit claim about the world, e.g. "30,000 attendees").
 * Deliberately NOT applied to recipe offer/copy/window — those are PRESCRIPTIVE
 * suggestions (a recommended special price, a proposed window), which the skill is
 * allowed to propose. Deeper prose-level grounding is the LLM-judge's job, not a
 * deterministic check (which would false-positive on legitimate suggested values).
 */
export function checkNumbersTraceToEvidence(rec: EnrichedRecommendation, i: number, index: RefIndex): Violation[] {
  const v: Violation[] = []
  for (const n of extractNumbers(rec.leverage?.reach)) {
    if (!index.evidenceNumbers.has(n)) v.push({ code: "ungrounded_reach", recIndex: i, detail: `${n}` })
  }
  return v
}

/** Ticket-voice lint over the narrative fields (NOT recipe.copy, which is the restaurant's voice). */
export function checkVoice(rec: EnrichedRecommendation, i: number): Violation[] {
  const v: Violation[] = []
  for (const text of [rec.title, rec.rationale]) {
    for (const vio of lintVoice(text)) v.push({ code: `voice_${vio.kind}`, recIndex: i, detail: vio.detail })
  }
  return v
}

/**
 * Geo-sanity (event geo-relevance · Layer 5): a play citing event evidence may only
 * make DEMAND claims (prepare/ops/staffing) when the dossier actually has LOCAL events.
 * With only metro hooks (far major events), event-citing plays must be marketing tie-ins
 * (capitalize/positioning) and never high leverage. Pretest 2026-06-09: the model
 * staffed a "pre-game rush" for a game 22 miles away — this check makes that a FAILURE.
 */
export function checkEventGeoSanity(
  rec: EnrichedRecommendation,
  i: number,
  geo: { localEventCount: number; metroHookCount: number }
): Violation[] {
  const citesEvents = rec.evidenceRefs.some((r) => r.startsWith("events.") || r.startsWith("cross_event"))
  if (!citesEvents || geo.localEventCount > 0) return []
  const v: Violation[] = []
  if (geo.metroHookCount === 0) {
    v.push({ code: "event_geo_ungrounded", recIndex: i, detail: `cites event evidence but the dossier has no local events or metro hooks: "${rec.title}"` })
    return v
  }
  if (rec.kind === "prepare" || rec.kind === "ops") {
    v.push({ code: "event_geo_demand_claim", recIndex: i, detail: `demand/prep play from far-away events only (metro hooks are tie-in material): "${rec.title}"` })
  }
  if (rec.leverage?.label === "high") {
    v.push({ code: "event_geo_overweighted", recIndex: i, detail: `high leverage from far-away events only: "${rec.title}"` })
  }
  return v
}

// ── aggregate ────────────────────────────────────────────────────────────────

/** Run all deterministic checks over a brief's plays. */
export function evaluateBrief(
  brief: Pick<Brief, "plays">,
  index: RefIndex,
  geo?: { localEventCount: number; metroHookCount: number }
): CheckResult {
  const violations: Violation[] = []
  brief.plays.forEach((rec, i) => {
    violations.push(
      ...checkEnums(rec, i),
      ...checkRecipeCompleteness(rec, i),
      ...checkNoExecutableFields(rec, i),
      ...checkEvidenceRefsResolve(rec, i, index),
      ...checkNumbersTraceToEvidence(rec, i, index),
      ...checkVoice(rec, i),
      ...(geo ? checkEventGeoSanity(rec, i, geo) : []),
    )
  })
  // brief-level voice (headline/deck) too
  return { ok: violations.length === 0, violations }
}
