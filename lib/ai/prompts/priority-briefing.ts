// ---------------------------------------------------------------------------
// Priority Briefing Prompt -- Gemini 3 Pro
//
// Summarizes all current insights into top-5 actionable priorities,
// factoring in the organization's historical preferences.
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

export function buildPriorityBriefingPrompt(
  insights: InsightForBriefing[],
  preferences: InsightPreference[],
  locationName: string
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

  return `You are Prophet, an AI competitive intelligence assistant for local businesses.

Analyze the following ${insights.length} insights for "${locationName}" and produce a priority briefing — the TOP 5 most actionable items the business owner should focus on RIGHT NOW.

${prefContext ? `BUSINESS PREFERENCES:\n${prefContext}\n` : ""}
INSIGHTS:
${insightList}

Return a JSON object with this exact structure:
{
  "priorities": [
    {
      "title": "Short, punchy headline (max 10 words)",
      "why": "One sentence explaining why this matters urgently",
      "urgency": "critical" | "warning" | "info",
      "action": "One concrete, specific action the owner should take today",
      "source": "competitors" | "events" | "seo" | "content",
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
- Be specific and actionable — not generic advice
- Factor in the business's historical preferences when ranking
- Do NOT invent data; only reference what's in the insights above

CRITICAL DIVERSITY RULE:
- The 5 priorities MUST cover at least 3 different source categories
- Source categories: competitors (GBP/reviews), events (local events), seo (search visibility), content (website/menu), photos (visual intelligence), traffic (foot traffic patterns)
- For each priority, set "source" to one of: "competitors", "events", "seo", "content", "photos", "traffic"
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
  const categories: SourceCategory[] = ["competitors", "events", "seo", "content", "photos", "traffic"]

  // Round 1: pick the top insight from each available category
  for (const cat of categories) {
    const arr = byCategory.get(cat)
    if (arr && arr.length > 0 && picked.length < 5) {
      picked.push(arr[0])
      pickedIds.add(arr[0].title)
    }
  }

  // Round 2: fill remaining slots from the highest-scoring unpicked insights
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
