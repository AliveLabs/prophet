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
import { hasFailureSignal } from "@/lib/skills/scoring-config"

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

// ── P11 presenter + calibration gates ───────────────────────────────────────

/**
 * Customer-facing narrative of a play. Covers title + rationale + the presented evidence text AND
 * the recipe copy fields (channel/audience/offer/copy/creativeDirection), which ARE shown in the
 * "The play" drilldown — so a raw internal score leaking into recipe copy is caught too.
 */
function customerText(rec: EnrichedRecommendation): string {
  const ev = (rec.evidence ?? []).flatMap((e) => [e.quote, e.relativeStat, e.soWhat]).filter(Boolean)
  const recipeCopy = (rec.recipe ?? []).flatMap((s) => [s.channel, s.audience, s.offer, s.copy, s.creativeDirection])
  return [rec.title, rec.rationale, ...ev, ...recipeCopy].filter(Boolean).join(" ")
}

/**
 * P11 gate (1) — NO customer-facing raw internal score. The presenter must strip ranking artifacts;
 * a brief must never surface "peak score of 100", "score of 87", "combined score", or the raw
 * busy-times index. Phrasing must be RELATIONAL ("12% below your Friday peak"), enforced here.
 */
const RAW_SCORE_PATTERNS: RegExp[] = [
  /\b(?:peak\s+)?score\s+of\s+\d+/i,
  /\bcombined\s*score\b/i,
  /\bbusy[-\s]?times?\s+index\b/i,
  /\binternal\s+score\b/i,
  /\bscore[:=]\s*\d+/i,
  // broader heuristic: a number sitting next to the INTERNAL-score vocabulary, in either order
  // ("ranked 92/100", "our index of 87", "scored 74", "rank: 3", "92/100 score").
  // Deliberately excludes bare "rating" — a star rating (4.6) or a rating delta ("rating fell 0.3")
  // is a legitimate customer fact, not the 0-100 ranking artifact this gate guards against.
  /\b(?:score|index|ranked|rank|scored)\b[^.]{0,12}?\d+/i,
  /\b\d+\s*\/\s*100\b/,
]
export function checkNoRawInternalScore(rec: EnrichedRecommendation, i: number): Violation[] {
  const v: Violation[] = []
  // CUSTOMER-FACING text only: title + rationale + presented evidence. leverage.basisInternal is
  // the internal sizing math — it lives on the play for ranking/drill but is never customer copy,
  // so it is intentionally NOT scanned here (the presenter strips it from the served leverage).
  const text = customerText(rec)
  for (const re of RAW_SCORE_PATTERNS) {
    if (re.test(text)) {
      v.push({ code: "raw_internal_score", recIndex: i, detail: `customer copy surfaces a raw internal score: "${rec.title}"` })
      break
    }
  }
  return v
}

/**
 * P11 gate (2) — every COUNT carries its denominator. When a play surfaces a count-of-reviews style
 * claim in its rationale ("3 reviews", "2 of your customers"), it MUST be expressed as a rate
 * (numerator/denominator/pct) via an evidence entry — never a bare count. Scoped to the common
 * "<n> review(s)/customer(s)/complaint(s)/mention(s)" pattern so it can't false-positive on prices,
 * dates, or windows.
 */
const BARE_COUNT_RE = /\b(\d[\d,]*)\s+(reviews?|customers?|complaints?|mentions?|people|guests?)\b/i
export function checkCountsHaveDenominator(rec: EnrichedRecommendation, i: number): Violation[] {
  const v: Violation[] = []
  const m = BARE_COUNT_RE.exec(rec.rationale ?? "")
  if (!m) return v
  const n = Number(m[1].replace(/,/g, ""))
  // OK when an evidence rate carries THIS bare count as its numerator over a real denominator, or the
  // rationale itself already frames it as a rate ("3 of your last 20", "15%"). The numerator MUST
  // match the bare count — an unrelated rate (e.g. {2,20,10}) does NOT supply this count's denominator.
  const hasRate = (rec.evidence ?? []).some((e) => e.rate && e.rate.denominator > 0 && e.rate.numerator === n)
  const ratePhrasing = /\bof\s+(?:your\s+)?(?:last\s+)?\d/i.test(rec.rationale ?? "") || /\d+\s*%/.test(rec.rationale ?? "")
  if (!hasRate && !ratePhrasing) {
    v.push({ code: "count_without_denominator", recIndex: i, detail: `bare count "${m[0]}" needs a denominator/rate` })
  }
  return v
}

/**
 * P11 gate (3) — a maintain play may only be HIGH impact with a failure signal. A "keep doing the
 * good thing" play earns high impact from RISK-OF-STOPPING, so it must cite at least one failure
 * signal (negative trend / complaint / competitor encroachment) to rank high. Mirrors the scoring
 * maintain-cap (so the served brief can't disagree with how it was ranked).
 */
export function checkMaintainImpactCalibration(rec: EnrichedRecommendation, i: number): Violation[] {
  if (rec.stance !== "maintain") return []
  if (rec.leverage?.label !== "high") return []
  if (hasFailureSignal(rec.evidenceRefs)) return []
  return [
    {
      code: "maintain_high_without_failure",
      recIndex: i,
      detail: `maintain play claims high impact with no failure-signal ref: "${rec.title}"`,
    },
  ]
}

/**
 * P11 grounding — evidence quotes must BYTE-MATCH a stored example (no paraphrase) and trace to a
 * cited ref. `storedQuotes` is the set of verbatim example strings the dossier captured; pass it
 * (built from review.theme evidence.examples) to enforce that the presenter never invented a quote.
 */
export function checkEvidenceGrounded(
  rec: EnrichedRecommendation,
  i: number,
  index: RefIndex,
  storedQuotes: Set<string>,
): Violation[] {
  const v: Violation[] = []
  for (const e of rec.evidence ?? []) {
    const base = e.source.split(":")[0]
    if (!index.allowedRefs.has(e.source) && !index.allowedRefs.has(base)) {
      v.push({ code: "evidence_ungrounded_source", recIndex: i, detail: e.source })
    }
    if (e.quote && !storedQuotes.has(e.quote.trim())) {
      v.push({ code: "evidence_quote_not_verbatim", recIndex: i, detail: e.quote.slice(0, 60) })
    }
    if (e.relativeStat && !e.soWhat?.trim()) {
      v.push({ code: "relative_stat_without_so_what", recIndex: i, detail: e.relativeStat })
    }
  }
  return v
}

/** Collect every verbatim review example the dossier stored — the allowed set for quote byte-match. */
export function collectStoredQuotes(ruleOutputs: { evidence?: Record<string, unknown> }[]): Set<string> {
  const out = new Set<string>()
  for (const insight of ruleOutputs) {
    const ex = insight.evidence?.examples
    if (Array.isArray(ex)) for (const q of ex) if (typeof q === "string" && q.trim()) out.add(q.trim())
  }
  return out
}

// ── aggregate ────────────────────────────────────────────────────────────────

/** Run all deterministic checks over a brief's plays. */
export function evaluateBrief(
  brief: Pick<Brief, "plays"> & Partial<Pick<Brief, "headline" | "deck">>,
  index: RefIndex,
  geo?: { localEventCount: number; metroHookCount: number },
  /** P11: the verbatim review examples the dossier stored — enables the evidence byte-match gate.
   *  Optional so existing callers keep working (the quote-grounding check is skipped when absent). */
  storedQuotes?: Set<string>,
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
      // P11 presenter + calibration gates
      ...checkNoRawInternalScore(rec, i),
      ...checkCountsHaveDenominator(rec, i),
      ...checkMaintainImpactCalibration(rec, i),
      ...(storedQuotes ? checkEvidenceGrounded(rec, i, index, storedQuotes) : []),
    )
  })
  // brief-level: the headline/deck are customer-facing too, so scan them for a raw internal score.
  const headerText = [brief.headline, brief.deck].filter(Boolean).join(" ")
  if (RAW_SCORE_PATTERNS.some((re) => re.test(headerText))) {
    violations.push({ code: "raw_internal_score", recIndex: -1, detail: "brief headline/deck surfaces a raw internal score" })
  }
  return { ok: violations.length === 0, violations }
}
