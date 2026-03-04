import PriorityBriefing from "@/components/insights/priority-briefing"
import { generatePriorityBriefing } from "./actions"
import type { InsightForBriefing, BusinessContext } from "@/lib/ai/prompts/priority-briefing"
import type { InsightPreference } from "@/lib/insights/scoring"

type Props = {
  insights: InsightForBriefing[]
  preferences: InsightPreference[]
  locationName: string
  cacheKey?: string | null
  context?: BusinessContext | null
}

export default async function PriorityBriefingSection({
  insights,
  preferences,
  locationName,
  cacheKey,
  context,
}: Props) {
  const priorities = await generatePriorityBriefing(
    insights,
    preferences,
    locationName,
    cacheKey,
    context
  )

  if (priorities.length === 0) return null

  return <PriorityBriefing priorities={priorities} />
}
