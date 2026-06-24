// ---------------------------------------------------------------------------
// Positioning & Pricing skill — menu/value moves grounded in pricing + content rules.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { EntityVisualProfile } from "@/lib/social/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { selectAdjacentSignals } from "@/lib/skills/domain-map"
import { POSITIONING_KNOWLEDGE } from "@/lib/skills/positioning/knowledge"

const POS_PREFIXES = ["menu.", "content.", "seo_competitor"]

function isPositioningInsight(t: string): boolean {
  return POS_PREFIXES.some((p) => t.startsWith(p))
}

/**
 * Distil the Gemini Vision profile (EntityVisualProfile) into a COMPACT positioning read —
 * a synthesis, never the raw profile. The raw profile carries a `postAnalyses` array (one
 * entry per analyzed photo) that would blow the prompt's token budget and bury the signal;
 * we keep only the aggregate scores + the dominant content the camera is actually pointed at
 * + the atmosphere/quality cues that tell the model what the place LOOKS like. PV (vision →
 * positioning): premium cues (polished plating, a consistent on-brand look, a full room) are
 * positioning PROOF POINTS — they make a higher price feel earned. Returns null when there is
 * no usable vision data so the prompt is byte-identical to the pre-vision behavior (many orgs
 * have no Gemini profile yet). */
function visualPositioningRead(v: EntityVisualProfile | null | undefined) {
  if (!v) return null
  // contentMix is a {category: share} map; surface only what the camera points at most.
  const topContent = Object.entries(v.contentMix ?? {})
    .filter(([, share]) => typeof share === "number" && share > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([category, share]) => ({ category, share: Math.round(share * 100) / 100 }))
  // Atmosphere read from the analyzed posts — the room/energy cues, deduped & capped.
  const atmosphere = Array.from(
    new Set(
      (v.postAnalyses ?? [])
        .map((p) => p.analysis?.atmosphereSignals)
        .flatMap((a): string[] =>
          a ? [a.crowdLevel, a.energy].filter((x): x is typeof x => !!x && x !== "n/a") : [],
        ),
    ),
  ).slice(0, 4)
  const hasSignal =
    topContent.length > 0 ||
    atmosphere.length > 0 ||
    [v.avgVisualQualityScore, v.foodPresentationScore, v.brandConsistencyScore, v.crowdSignalScore].some(
      (s) => typeof s === "number" && s > 0,
    )
  if (!hasSignal) return null
  return {
    // 0–100 aggregate scores from the photo analysis — quantified "what it looks like".
    visualQualityScore: v.avgVisualQualityScore,
    foodPresentationScore: v.foodPresentationScore,
    brandConsistencyScore: v.brandConsistencyScore,
    crowdSignalScore: v.crowdSignalScore,
    professionalContentPct: v.professionalContentPct,
    topContent,
    atmosphere,
  }
}

function selectInput(d: Dossier) {
  // PV: positioning now reads the venue's LOOK. Distilled (token-budget-aware), and omitted
  // entirely when absent so no-vision orgs see the exact pre-PV prompt.
  const visualRead = visualPositioningRead(d.location.visual)
  // P5 adjacency: the GROUNDED reputation rule-outputs (rating/review insight_types) — a
  // citeable counterpart to the prose reviewThemes, so a price move can lean on a real ref
  // when guests actually flag value. Omitted when none → byte-identical to the pre-P5 prompt.
  const adjacentSignals = selectAdjacentSignals(d, "positioning")
  return {
    pricingSignals: d.ruleOutputs.filter((i) => isPositioningInsight(i.insight_type)),
    ownMenu: d.location.menu ?? null,
    ownFeatures: d.location.features ?? null,
    competitorMenus: d.competitors.map((c) => ({ name: c.name, menu: c.menu ?? null, features: c.features ?? null })),
    // Review themes ground price-mismatch reasoning: only act on price when guests actually
    // flag it (see HANDLING PRICE MISMATCHES in the playbook); otherwise position on value.
    reviewThemes: d.location.reviews?.themes ?? null,
    // What the place LOOKS like (Gemini Vision). Present only when there is real vision data —
    // see WHAT THE PLACE LOOKS LIKE in the playbook for how to turn it into positioning proof.
    ...(visualRead ? { visualProfile: visualRead } : {}),
    ...(adjacentSignals.length ? { adjacentSignals } : {}),
  }
}

/** Deterministic, grounded, NUMBER-FREE fallback. Brand-aware: premium places position on quality. */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isPositioningInsight(i.insight_type)).slice(0, 2)
  const tier = (d.profile.attributes.priceTier ?? "").toLowerCase()
  const premium = tier.includes("premium") || tier.includes("upscale") || tier.includes("fine")
  return signals.map((ins) =>
    premium
      ? {
          title: "Answer the undercut with quality, not a discount",
          rationale: `Grounded in ${ins.title}. You are the premium option; lean into the cut, the room, and your rating rather than chasing a cheaper rival.`,
          skillId: "positioning",
          ownerRole: "owner" as const,
          kind: "positioning" as const,
          recipe: [
            {
              channel: "menu wording + Google Business + your social",
              platforms: d.tier.ownSocialPlatforms,
              audience: "diners choosing where the occasion is worth it",
              window: { note: "ongoing" },
              creativeDirection: "on your phone, take a few photos that show why the price is worth it: a signature dish leaving the kitchen and the room when it's full; pick the best one",
              dependencies: ["menu/site copy refresh"],
            },
          ],
          confidence: "medium" as const,
          leverage: { label: "medium" as const, basisInternal: "defends premium position; sized ordinally from the pricing gap" },
          evidenceRefs: [ins.insight_type],
          knowledgeVersion: "positioning@v3",
        }
      : {
          title: "Add a value entry point, do not start a price war",
          rationale: `Grounded in ${ins.title}. Enter the comparison with one lower-priced item; hold your dinner pricing.`,
          skillId: "positioning",
          ownerRole: "owner" as const,
          kind: "positioning" as const,
          recipe: [
            {
              channel: "menu + Google Business + your social",
              platforms: d.tier.ownSocialPlatforms,
              audience: "midday searchers and value-comparing diners",
              window: { note: "before the weekend" },
              creativeDirection: "a clear phone photo of the new value dish in daylight; give it a name people would search for",
              dependencies: ["menu update", "POS can ring the new item"],
            },
          ],
          confidence: "medium" as const,
          leverage: { label: "medium" as const, basisInternal: "comparison-set entry; sized ordinally from the pricing gap" },
          evidenceRefs: [ins.insight_type],
          knowledgeVersion: "positioning@v3",
        },
  )
}

export const positioningSkill: ProducerSkill = {
  id: "positioning",
  displayName: "Positioning & Pricing expert",
  ownerRole: "owner",
  kind: "positioning",
  category: "positioning",
  tier: "reasoning",
  temperature: 0.4,
  knowledgeVersion: "positioning@v3",
  knowledge: POSITIONING_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(positioningSkill, d, selectInput(d), k),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "positioning", knowledgeVersion: "positioning@v3", defaultKind: "positioning", defaultOwner: "owner" }),
  fallback,
}
