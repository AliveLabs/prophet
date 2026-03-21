// ---------------------------------------------------------------------------
// Priority Briefing Prompt – Gemini 2.5 Pro
//
// Summarizes all current insights into top-5 actionable priorities,
// factoring in the organization's historical preferences and full
// business context (weather, traffic, photos, content, SEO, events).
// Enforces diversity across source categories.
// ---------------------------------------------------------------------------

import {
  getSourceCategory,
  type InsightPreference,
  type SourceCategory,
} from "@/lib/insights/scoring"

export type PriorityItem = {
  title: string
  why: string
  urgency: "critical" | "warning" | "info"
  action: string
  source: SourceCategory
  relatedInsightTypes: string[]
}

export type InsightForBriefing = {
  insight_type: string
  title: string
  summary: string
  severity: string
  confidence: string
  relevanceScore: number
  competitorId?: string | null
  evidenceHighlights?: string
}

export type BusinessContext = {
  weatherSummary?: string | null
  trafficSummary?: string | null
  photoSummary?: string | null
  socialSummary?: string | null
  locationRating?: number | null
  locationReviewCount?: number | null
  menuItemCount?: number | null
  avgMenuPrice?: string | null
  competitorCount?: number
}

export function buildPriorityBriefingPrompt(
  insights: InsightForBriefing[],
  preferences: InsightPreference[],
  locationName: string,
  context?: BusinessContext | null
): string {
  const sorted = [...preferences].sort((a, b) => b.weight - a.weight)
  const topPrefs = sorted.filter((p) => p.weight > 1.0).slice(0, 5)
  const lowPrefs = sorted.filter((p) => p.weight < 0.8).slice(0, 3)

  const prefContext = [
    topPrefs.length > 0
      ? `This business tends to find these insight types most valuable: ${topPrefs.map((p) => `${p.insight_type} (weight: ${p.weight.toFixed(1)})`).join(", ")}.`
      : "",
    lowPrefs.length > 0
      ? `They tend to dismiss: ${lowPrefs.map((p) => `${p.insight_type} (weight: ${p.weight.toFixed(1)})`).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ")

  const insightList = insights
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 30)
    .map((i, idx) => {
      const src = getSourceCategory(i.insight_type, i.competitorId ?? null)
      return `${idx + 1}. [${src}] [${i.severity}/${i.confidence}] (score: ${i.relevanceScore}) "${i.title}" — ${i.summary}${i.evidenceHighlights ? ` | Evidence: ${i.evidenceHighlights}` : ""}`
    })
    .join("\n")

  // Build the rich business context section
  const contextLines: string[] = []
  if (context) {
    if (context.locationRating != null) {
      contextLines.push(`- Google rating: ${context.locationRating}/5${context.locationReviewCount != null ? ` (${context.locationReviewCount.toLocaleString()} reviews)` : ""}`)
    }
    if (context.competitorCount != null && context.competitorCount > 0) {
      contextLines.push(`- Active competitors tracked: ${context.competitorCount}`)
    }
    if (context.weatherSummary) {
      contextLines.push(`- Current weather: ${context.weatherSummary}`)
    }
    if (context.trafficSummary) {
      contextLines.push(`- Foot traffic patterns: ${context.trafficSummary}`)
    }
    if (context.photoSummary) {
      contextLines.push(`- Visual intelligence: ${context.photoSummary}`)
    }
    if (context.socialSummary) {
      contextLines.push(`- Social media: ${context.socialSummary}`)
    }
    if (context.menuItemCount != null) {
      contextLines.push(`- Menu: ${context.menuItemCount} items tracked${context.avgMenuPrice ? `, avg price ${context.avgMenuPrice}` : ""}`)
    }
  }

  const contextBlock = contextLines.length > 0
    ? `\nBUSINESS CONTEXT for "${locationName}":\n${contextLines.join("\n")}\n`
    : ""

  return `You are Vatic, an AI competitive intelligence assistant for local businesses. You provide sharp, data-driven briefings that help business owners make better decisions.

Analyze the following ${insights.length} insights for "${locationName}" and produce a priority briefing — the TOP 5 most actionable items the business owner should focus on RIGHT NOW.
${contextBlock}
${prefContext ? `BUSINESS PREFERENCES:\n${prefContext}\n` : ""}
INSIGHTS:
${insightList}

Return a JSON object with this exact structure:
{
  "priorities": [
    {
      "title": "Short, punchy headline (max 10 words)",
      "why": "2-3 sentences explaining why this matters urgently. Reference specific numbers, competitors, or data points from the insights and context above. Connect dots across multiple sources when relevant.",
      "urgency": "critical" | "warning" | "info",
      "action": "One concrete, specific action with numbers or dates where possible. Example: 'Respond to the 3 negative reviews posted this week by Friday' instead of 'Respond to reviews'.",
      "source": "competitors" | "events" | "seo" | "social" | "content" | "photos" | "traffic",
      "relatedInsightTypes": ["insight_type_1", "insight_type_2"]
    }
  ]
}

Rules:
- Return EXACTLY 5 priorities (or fewer if there are fewer than 5 insights)
- Rank by business impact: revenue threats first, then opportunities, then informational
- "critical" = needs action within 24-48 hours
- "warning" = needs action this week
- "info" = good to know, plan for later
- Be specific and actionable — NOT generic advice. Reference competitor names, specific numbers, dates, or metrics.
- Factor in the business's historical preferences when ranking
- Do NOT invent data; only reference what's in the insights and context above
- For "why": Write 2-3 complete sentences. Explain the business impact and connect dots across multiple data sources when possible (e.g., "Weather is clearing up AND foot traffic at [competitor] peaks on Fridays — this is your window to run a weekend promotion")
- For "action": Be concrete with specifics (who, what, when, how much). Avoid vague advice like "monitor the situation" or "take appropriate action"

CROSS-SOURCE REASONING (important):
- If weather data and traffic patterns are both available, correlate them (e.g., severe weather → lower foot traffic → opportunity or risk)
- If a competitor's review count is growing while yours is stagnant, connect that to SEO/visibility implications
- If menu prices differ significantly from competitors, connect that to positioning strategy
- If photo analysis shows competitors investing in ambiance/decor, connect that to customer experience strategy
- If social media data shows a competitor is running promotions, connect that to competitive strategy and foot traffic implications
- If a competitor has rapid follower growth on social while your Google reviews are stagnant, connect those signals
- If social engagement is high but SEO visibility is low, recommend leveraging social audience to drive website traffic
- Always ground your recommendations in the specific data provided, not general business advice

CRITICAL DIVERSITY RULE:
- The 5 priorities MUST cover at least 3 different source categories
- Source categories: competitors (GBP/reviews), events (local events), seo (search visibility), social (social media), content (website/menu), photos (visual intelligence), traffic (foot traffic patterns)
- For each priority, set "source" to one of: "competitors", "events", "seo", "social", "content", "photos", "traffic"
- Do NOT pick more than 2 priorities from the same source category
- If a category has no insights, skip it and spread across available categories`
}

// ---------------------------------------------------------------------------
// Deterministic fallback -- round-robin across categories then fill by score
// ---------------------------------------------------------------------------

export function buildDeterministicBriefing(
  insights: InsightForBriefing[]
): PriorityItem[] {
  if (insights.length === 0) return []

  const byCategory = new Map<SourceCategory, InsightForBriefing[]>()
  for (const ins of insights) {
    const cat = getSourceCategory(ins.insight_type, ins.competitorId ?? null)
    const arr = byCategory.get(cat) ?? []
    arr.push(ins)
    byCategory.set(cat, arr)
  }

  for (const [, arr] of byCategory) {
    arr.sort((a, b) => b.relevanceScore - a.relevanceScore)
  }

  const picked: InsightForBriefing[] = []
  const pickedIds = new Set<string>()
  const categories: SourceCategory[] = ["competitors", "events", "seo", "social", "content", "photos", "traffic"]

  for (const cat of categories) {
    const arr = byCategory.get(cat)
    if (arr && arr.length > 0 && picked.length < 5) {
      picked.push(arr[0])
      pickedIds.add(arr[0].title)
    }
  }

  if (picked.length < 5) {
    const remaining = insights
      .filter((i) => !pickedIds.has(i.title))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
    for (const ins of remaining) {
      if (picked.length >= 5) break
      picked.push(ins)
    }
  }

  return picked.map((ins) => ({
    title: ins.title,
    why: ins.summary.length > 120 ? ins.summary.slice(0, 117) + "..." : ins.summary,
    urgency: (ins.severity === "critical"
      ? "critical"
      : ins.severity === "warning"
        ? "warning"
        : "info") as PriorityItem["urgency"],
    action: "Review this insight and take appropriate action.",
    source: getSourceCategory(ins.insight_type, ins.competitorId ?? null),
    relatedInsightTypes: [ins.insight_type],
  }))
}
