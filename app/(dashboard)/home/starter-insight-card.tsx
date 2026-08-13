"use client"

// The first-run STARTER insight card (beta rescue 3.1).
//
// The same wiring pattern BriefInsightCard uses, and deliberately thinner: `playToUnifiedInsight`
// (the existing adapter) does the translation, `UnifiedInsightCard` owns the chrome. No new card,
// no new adapter, no second vocabulary. The card is self-sufficient for styling, so this renders
// correctly on the onboarding Build step as well as on /home.
//
// READ-ONLY, on purpose. Keep and Dismiss write against a BRIEF (locationId, dateKey, playKey) and
// feed the learning loop through it. The starter exists precisely because no brief has been built
// yet, so there is no record for those writes to attach to, and inventing one would put a play in
// the brief's suppression/momentum ledger that the brief never produced. The verbs arrive with the
// brief. We do not tell the operator this insight WILL reappear there, because that is the
// producer's decision on the day, not a promise we can keep.

import UnifiedInsightCard from "@/components/insights/unified-insight-card"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { playToUnifiedInsight } from "./unified-insight-adapter"

export default function StarterInsightCard({
  play,
  todayKey,
}: {
  play: EnrichedRecommendation
  /** The day the starter was generated, as a YYYY-MM-DD key. The adapter measures its timing
   *  chips against this, so the caller owns "now" (same contract as the brief card). */
  todayKey: string
}) {
  const insight = playToUnifiedInsight(play, {
    todayKey,
    id: `starter:${play.skillId}`,
    stateLabel: "Your first insight",
  })
  return <UnifiedInsightCard insight={insight} variant="lead" readOnly />
}
