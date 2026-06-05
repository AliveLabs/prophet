// ---------------------------------------------------------------------------
// Baseline brief — represents TODAY's output (the legacy per-competitor narrative
// recommendations already sitting in the dossier's rule outputs). The new engine
// must beat this head-to-head on the judge's axes. Recipes are intentionally
// empty because the legacy output has none — that gap is exactly what the new
// engine closes (specificity / actionable), so the A/B is honest.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { Brief, EnrichedRecommendation, Confidence } from "@/lib/skills/types"

function mapConfidence(c: string): Confidence {
  return c === "high" ? "high" : c === "medium" ? "medium" : "directional"
}

export function buildBaselineBrief(dossier: Dossier, max = 3): Brief {
  const plays: EnrichedRecommendation[] = []
  for (const ins of dossier.ruleOutputs) {
    for (const rec of ins.recommendations ?? []) {
      const r = rec as { title?: unknown; rationale?: unknown }
      if (typeof r.title !== "string") continue
      plays.push({
        title: r.title,
        rationale: typeof r.rationale === "string" ? r.rationale : "",
        skillId: "legacy",
        ownerRole: "owner",
        kind: "ops",
        recipe: [], // legacy has no recipe — the point of the comparison
        confidence: mapConfidence(ins.confidence),
        evidenceRefs: [ins.insight_type],
        knowledgeVersion: "legacy",
      })
      if (plays.length >= max) break
    }
    if (plays.length >= max) break
  }
  return {
    locationId: dossier.locationId,
    dateKey: dossier.dateKey,
    headline: "Your insights this week",
    deck: "The current recommendations from your watched competitors and signals.",
    plays,
    asOf: dossier.generatedAt,
  }
}
