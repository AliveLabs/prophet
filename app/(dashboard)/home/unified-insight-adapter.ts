// EnrichedRecommendation → UnifiedInsight.
//
// The home brief's plays are the RICHEST record in the product: a real recipe, cited
// verbatim evidence, two calibrated score axes. This module translates one into the shape
// the unified card reads, and NOTHING here invents a field the play doesn't carry.
//
// Pure functions only (no JSX, no React) so it is server-safe and unit-testable — vitest
// collects `tests/unit/**/*.test.ts` and no `.tsx`, so logic that lives in a component
// cannot be tested at all. This is the same reason `pass-map.ts` exists.
//
// THE HONEST-GATING RULES, each of which is a decision not to guess:
//   · A `when` tag only appears when a recipe step carries a real window DATE. A window
//     whose end has already passed emits nothing rather than "Today".
//   · The validation line is DENOMINATED or absent. "3 of 20 reviews" is a basis; "high
//     confidence" is a score and belongs on the score axis, not in prose.
//   · No numerals reach a score. Confidence and impact are level WORDS.
//   · A play with an empty recipe is an OBSERVATION, not a plan with a missing plan. The
//     card then renders no action region at all, which is the truthful outcome.

import type { EnrichedRecommendation } from "@/lib/skills/types"
import type {
  UnifiedInsight,
  InsightTag,
  InsightPlanStep,
  InsightEvidence,
} from "@/components/insights/unified-insight-card"
import { humanizeLabel, distinctDomains, humanizeRef } from "@/lib/skills/evidence-format"
import { confLevel, impactLevel, playChipLabel, playWhyPoints, playQuotes } from "./pass-map"

const DAY_MS = 86_400_000
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** Midday UTC for a YYYY-MM-DD key, so a timezone offset can never shift the day. */
function dayFromKey(key: string): number | null {
  const t = Date.parse(`${key.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(t) ? null : t
}

/**
 * The timing chip for a recipe window, or null when there is no honest timing claim.
 * Urgency is the SOONEST tier only (today / tomorrow / the day after) — it is the one
 * red in the system, so it has to keep meaning "now".
 */
export function whenTagFor(
  window: { start?: string; end?: string } | undefined,
  todayKey: string,
): InsightTag | null {
  if (!window) return null
  const today = dayFromKey(todayKey)
  if (today == null) return null

  // A window that has already closed makes no claim about the future.
  const end = window.end ? dayFromKey(window.end) : null
  if (end != null && end < today) return null

  const start = window.start ? dayFromKey(window.start) : null
  if (start == null) return null

  const days = Math.round((start - today) / DAY_MS)
  // A start that has ALREADY passed only supports "Today" when an end keeps the window open. The
  // closed-end case returned null above, so reaching here with an end means it runs to today or
  // later, and "Today" is honest. With NO end there is nothing holding the window open, and calling
  // it "Today" invents a claim: this was the red urgent "Today" chip on a play about Saturday
  // night's concert, read on the Sunday. `days <= 0` used to lump the two together.
  if (days < 0) return end != null ? { axis: "when", label: "Today", urgent: true } : null
  if (days === 0) return { axis: "when", label: "Today", urgent: true }
  if (days === 1) return { axis: "when", label: "Tomorrow", urgent: true }
  if (days <= 6) {
    return { axis: "when", label: `By ${WEEKDAY[new Date(start).getUTCDay()]}`, urgent: days <= 2 }
  }
  const d = new Date(start)
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return { axis: "when", label: `From ${label}` }
}

/** The earliest window across the recipe — the timing that actually binds the operator. */
function earliestWindow(play: EnrichedRecommendation) {
  const windows = (play.recipe ?? []).map((s) => s.window).filter(Boolean)
  if (!windows.length) return undefined
  return windows.reduce((best, w) => {
    const a = w?.start ? dayFromKey(w.start) : null
    const b = best?.start ? dayFromKey(best.start) : null
    if (a == null) return best
    if (b == null) return w
    return a < b ? w : best
  })
}

/**
 * A ref's domain label as a COUNTABLE PLURAL, so "3 of 20 …" is grammatical.
 * `domainLabel` returns a singular category word ("Review"), which reads as a typo in a
 * sentence. Three shapes, all deterministic: already plural stays as-is, an acronym takes
 * an explicit noun rather than an ugly "SEOs", everything else takes an s.
 */
export function countableDomain(label: string): string {
  if (!label) return "signals we read"
  if (label === label.toUpperCase() && /^[A-Z]{2,}$/.test(label)) return `${label} signals`
  if (/s$/i.test(label)) return label.toLowerCase()
  return `${label.toLowerCase()}s`
}

/**
 * The "why we believe this" one-liner, DENOMINATED or absent.
 * Preference order is strongest basis first: a real rate with its denominator, then an
 * explicitly-flagged estimate, then a decodable you-vs-set comparison. When a play carries
 * none of the three we return null and the card simply omits the line, because an
 * unsupported validation line is worse than no validation line.
 */
export function validationLine(play: EnrichedRecommendation): string | null {
  const rated = (play.evidence ?? []).find((e) => e.rate)
  if (rated?.rate) {
    const { numerator, denominator } = rated.rate
    return `Based on ${numerator} of ${denominator} ${countableDomain(distinctDomains([rated.source])[0])}.`
  }

  const estimate = play.presentation?.estimate
  if (estimate) return `Estimated ${estimate.value}, based on ${estimate.basis}`

  const h2h = play.presentation?.headToHead?.[0]
  if (h2h?.label) return h2h.label

  return null
}

/** Recipe steps → plan steps. Channel/platform tokens are humanized; nothing is added. */
export function planStepsFor(play: EnrichedRecommendation): InsightPlanStep[] {
  return (play.recipe ?? []).map((s) => ({
    channel: humanizeLabel(s.channel ?? ""),
    platforms: s.platforms?.length ? s.platforms.map(humanizeLabel) : undefined,
    audience: s.audience || undefined,
    window: s.window?.note || undefined,
    offer: s.offer || undefined,
    creativeDirection: s.creativeDirection || undefined,
    copy: s.copy || undefined,
    dependencies: s.dependencies?.length ? s.dependencies : undefined,
  }))
}

/** Cited artifacts for the side sheet — verbatim review text only, with its attribution. */
function evidenceFor(play: EnrichedRecommendation): InsightEvidence[] | undefined {
  const quotes = playQuotes(play)
  if (!quotes.length) return undefined
  return quotes.map((q) => ({ label: q.who ?? humanizeRef(play.evidenceRefs[0] ?? "your signals"), text: q.text }))
}

export type PlayAdapterOptions = {
  /** Today, as a YYYY-MM-DD key. Passed in so the caller owns "now" and this stays pure. */
  todayKey: string
  /** The full details page for this play, when the surface has one. */
  detailHref?: string
  /** A surface-specific state chip ("Top this week"). The adapter never invents one. */
  stateLabel?: string
  /** A stable identity for the card — the surface's playKey, so React keys survive a refresh. */
  id: string
}

export function playToUnifiedInsight(
  play: EnrichedRecommendation,
  { todayKey, detailHref, stateLabel, id }: PlayAdapterOptions,
): UnifiedInsight {
  const plan = planStepsFor(play)
  const when = whenTagFor(earliestWindow(play), todayKey)

  // Order is irrelevant here: the card re-sorts by axis (soonest → when → what → state),
  // because reading position is a stronger prominence lever than hue.
  const tags: InsightTag[] = [
    ...(when ? [when] : []),
    { axis: "what", label: playChipLabel(play) },
    ...(stateLabel ? [{ axis: "state" as const, label: stateLabel }] : []),
  ]

  return {
    id,
    title: play.title,
    why: play.rationale,
    tags,
    confidence: confLevel(play.confidence),
    impact: impactLevel(play),
    validation: validationLine(play),
    evidence: evidenceFor(play),
    whyPoints: playWhyPoints(play),
    // An empty recipe means there are no steps to promise. The card derives `observation`
    // from that absence rather than us fabricating a suggestion to fill the region.
    plan: plan.length ? plan : undefined,
    suggestion: null,
    detailHref,
  }
}
