// ---------------------------------------------------------------------------
// Readiness-gated producer selection for the FIRST brief (beta rescue Phase 3.1).
//
// WHAT THIS IS NOT. It is not a shorter brief, and it is not a cheaper brief bought with quality.
// The set it removes is the set that provably contributes NOTHING:
//
//   1. every producer's `parse()` drops any play that does not cite its own domain family
//      (convergence: any play that does not span REQUIRED_FAMILIES distinct families);
//   2. every producer's deterministic `fallback()` returns [] when that same evidence is absent;
//   3. `runProducerSkill` then ground-filters whatever survives against the dossier's ref index.
//
// So for a producer whose grounding family is absent from the dossier, the set of plays that can
// reach the brief is empty by all three paths. Running it anyway spends a model call and holds the
// parallel producer stage open, and the brief it produces is BYTE-IDENTICAL either way. That is
// why this is a latency and spend change with no quality surface: the gate can only remove calls
// whose output was already unreachable.
//
// WHY FIRST-BRIEF-ONLY. On a nightly build every family is normally populated, so the gate would
// be a no-op — but "normally" is not "always", and a transient vendor outage that empties a family
// for one night is exactly the case where we would rather pay for a producer that returns nothing
// than quietly change what a paying location's brief is built from. The first brief has no such
// history to protect: nothing is being changed relative to yesterday, because there is no
// yesterday. `runBrief` therefore takes this path only when its caller says firstBrief.
//
// UNDECLARED SKILLS ALWAYS RUN. A skill with no `grounding` is never skipped. The cost of running
// a skippable producer is latency plus one call; the cost of skipping a productive one is a
// missing play. Only the first is acceptable, so absence of a declaration means run.
// ---------------------------------------------------------------------------

import type { ProducerSkill, SkillGrounding } from "@/lib/skills/skill-types"

/** Why a producer was left out of the first brief. Both values mean the same thing operationally:
 *  this skill could not have produced a play from this dossier. */
export type ProducerSkipReason =
  /** No rule output in this skill's own grounding family (its parse gate would drop everything). */
  | "no_grounding_signal"
  /** Fewer distinct signal families than the skill's parse gate requires (convergence). */
  | "insufficient_families"

export type ProducerSkipped = {
  skillId: string
  reason: ProducerSkipReason
  /** Operator/ops-facing one-liner, carried onto skillHealth so a skip is never a bare flag. */
  detail: string
}

export type ProducerReadiness =
  | { ready: true; matched: string[] }
  | { ready: false; reason: ProducerSkipReason; detail: string; matched: string[] }

/** Distinct, non-null families across a set of insight_types, in first-seen order. */
export function distinctFamiliesOf(
  insightTypes: readonly string[],
  familyOf: (ref: string) => string | null,
): string[] {
  const seen: string[] = []
  for (const t of insightTypes) {
    const fam = familyOf(t)
    if (fam && !seen.includes(fam)) seen.push(fam)
  }
  return seen
}

/**
 * Could this skill produce a play from a dossier carrying exactly `ruleOutputTypes`? Pure.
 *
 * Takes the insight_type list rather than a Dossier so the decision is testable without building
 * a fixture dossier — the same reason `starterReadiness` takes a narrowed read.
 */
export function producerReadiness(grounding: SkillGrounding | undefined, ruleOutputTypes: readonly string[]): ProducerReadiness {
  if (!grounding) return { ready: true, matched: [] } // undeclared ⇒ always run

  if (grounding.kind === "family") {
    const matched = ruleOutputTypes.filter((t) => grounding.matches(t))
    if (matched.length > 0) return { ready: true, matched }
    return {
      ready: false,
      reason: "no_grounding_signal",
      detail: "no rule output in this skill's grounding family had landed when the first brief was built",
      matched: [],
    }
  }

  const families = distinctFamiliesOf(ruleOutputTypes, grounding.familyOf)
  if (families.length >= grounding.min) return { ready: true, matched: families }
  return {
    ready: false,
    reason: "insufficient_families",
    detail: `needs ${grounding.min} distinct signal families to cross domains; ${families.length} had landed`,
    matched: families,
  }
}

export type FirstBriefSelection = {
  /** The producers to run, in registry order. */
  run: ProducerSkill[]
  /** The producers left out, with the reason. Never silent: the caller records these. */
  skipped: ProducerSkipped[]
}

/**
 * Split the producer set for a FIRST brief into what can ground and what cannot.
 *
 * Order is preserved for the survivors, because the registry's order is deliberate (convergence
 * last, so the domain experts' plays are produced alongside it).
 *
 * SAFETY VALVE: if every producer would be skipped, run them ALL instead. A dossier with no
 * citable signal at all is a data problem, not a selection problem, and a brief built from zero
 * producers is a worse artifact than one built from producers that fall back honestly. The
 * degradation stays visible through the existing skillHealth fallback path rather than being
 * converted into an empty run this module invented.
 */
export function selectFirstBriefProducers(
  skills: readonly ProducerSkill[],
  ruleOutputTypes: readonly string[],
): FirstBriefSelection {
  const run: ProducerSkill[] = []
  const skipped: ProducerSkipped[] = []
  for (const skill of skills) {
    const readiness = producerReadiness(skill.grounding, ruleOutputTypes)
    if (readiness.ready) run.push(skill)
    else skipped.push({ skillId: skill.id, reason: readiness.reason, detail: readiness.detail })
  }
  if (run.length === 0) return { run: [...skills], skipped: [] }
  return { run, skipped }
}
