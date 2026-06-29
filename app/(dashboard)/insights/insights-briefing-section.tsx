// The Pass — the Suspense-streamed Priority Briefing section for /insights.
//
// Page-local replacement for <PriorityBriefingSection/> + the shared
// <PriorityBriefing/>: same server-action data flow (generatePriorityBriefing,
// cached), new kit presentation (<InsightsBriefingKit/>). Streams via the page's
// <Suspense>, never blocking the rest of the page.

import { generatePriorityBriefing } from "./actions"
import type { InsightForBriefing, BusinessContext } from "@/lib/ai/prompts/priority-briefing"
import type { InsightPreference } from "@/lib/insights/scoring"
import InsightsBriefingKit from "./insights-briefing-kit"

type Props = {
  insights: InsightForBriefing[]
  preferences: InsightPreference[]
  locationName: string
  cacheKey?: string | null
  context?: BusinessContext | null
}

export default async function InsightsBriefingSection({
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
    context,
  )

  if (priorities.length === 0) return null

  return <InsightsBriefingKit priorities={priorities} locationName={locationName} />
}

// Kit-styled streaming fallback (matches the briefing's hero + grid silhouette).
export function InsightsBriefingSkeleton() {
  return (
    <div className="ins-brief ins-brief-skel" aria-hidden="true">
      <div className="ins-skel-head" />
      <div className="ins-skel-hero tk-sweep" />
      <div className="ins-skel-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ins-skel-card tk-sweep" />
        ))}
      </div>
    </div>
  )
}
