"use client"

// The Pass — the /insights priority section, DETERMINISTIC.
//
// REPLACES the model-generated Priority Briefing (a gemini-2.5-pro call on every
// /insights cache-miss, fronted by an in-process cache that barely hit on Fluid).
// This is the same shape /home already proved: a fixed-size pick over scores that
// already exist (`pickPriorityInsights` — one insight per source category first,
// then fill by score), rendered as the SAME unified insight card the feed uses.
// Zero model calls; the insight cards themselves are the content.
//
// What the model call used to add was synthesized prose (a "why now" narrative and
// an invented action line). Neither can be composed deterministically, so both are
// CUT rather than faked — the card's own title, summary, scores and suggestion are
// already the honest version of that content.

import type { CSSProperties } from "react"
import { RevealOnView, TkSectionHead, TkToastProvider } from "@/components/ticket"
import { InsightRowCard } from "./insight-row-card"
import type { FeedInsight } from "./insights-feed-kit"

export default function InsightsPrioritySection({
  insights,
  locationName,
}: {
  insights: FeedInsight[]
  locationName: string
}) {
  if (insights.length === 0) return null
  return (
    <TkToastProvider>
      <div className="ins-priority">
        <TkSectionHead
          title="Priority"
          sub={`What matters most for ${locationName} right now, ranked from your live signals`}
        />
        <RevealOnView className="tk-grid ins-grid" stagger>
          {insights.map((insight, i) => (
            <div key={insight.id} style={{ "--tk-i": i } as CSSProperties}>
              <InsightRowCard insight={insight} />
            </div>
          ))}
        </RevealOnView>
      </div>
    </TkToastProvider>
  )
}
