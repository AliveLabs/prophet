// ---------------------------------------------------------------------------
// Insight Relevance Scoring Engine
//
// Pure functions -- no DB calls. Receives data, returns scores.
// The algorithm is intentionally simple and transparent so users can
// understand why certain insights appear higher: "I keep dismissing X,
// so it shows less of X."
// ---------------------------------------------------------------------------

export type ScoredInsight = {
  id: string
  insight_type: string
  confidence: string
  severity: string
  relevanceScore: number
  urgencyLevel: "critical" | "warning" | "info"
  suppressed: boolean
}

export type InsightPreference = {
  insight_type: string
  weight: number
  useful_count: number
  dismissed_count: number
}

// ---------------------------------------------------------------------------
// Severity base scores
// ---------------------------------------------------------------------------

const SEVERITY_BASE: Record<string, number> = {
  critical: 90,
  warning: 60,
  info: 30,
}

const CONFIDENCE_MULTIPLIER: Record<string, number> = {
  high: 1.0,
  medium: 0.8,
  low: 0.5,
}

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------

export function computeRelevanceScore(
  severity: string,
  confidence: string,
  orgWeight = 1.0
): number {
  const base = SEVERITY_BASE[severity] ?? SEVERITY_BASE.info
  const confMult = CONFIDENCE_MULTIPLIER[confidence] ?? CONFIDENCE_MULTIPLIER.low
  return Math.min(100, Math.max(0, Math.round(base * confMult * orgWeight)))
}

export function getUrgencyLevel(score: number): "critical" | "warning" | "info" {
  if (score >= 75) return "critical"
  if (score >= 45) return "warning"
  return "info"
}

// ---------------------------------------------------------------------------
// Weight adjustment
// ---------------------------------------------------------------------------

const WEIGHT_FLOOR = 0.1
const WEIGHT_CEILING = 2.0
const WEIGHT_STEP = 0.1

export function updateWeight(
  currentWeight: number,
  feedback: "useful" | "not_useful"
): number {
  if (feedback === "useful") {
    return Math.min(WEIGHT_CEILING, currentWeight + WEIGHT_STEP)
  }
  return Math.max(WEIGHT_FLOOR, currentWeight - WEIGHT_STEP)
}

export function shouldSuppress(weight: number): boolean {
  return weight <= 0.3
}

// ---------------------------------------------------------------------------
// Batch scoring helper
// ---------------------------------------------------------------------------

export function scoreInsights(
  insights: Array<{
    id: string
    insight_type: string
    confidence: string
    severity: string
  }>,
  preferences: InsightPreference[]
): ScoredInsight[] {
  const weightMap = new Map<string, number>()
  for (const pref of preferences) {
    weightMap.set(pref.insight_type, pref.weight)
  }

  return insights.map((ins) => {
    const weight = weightMap.get(ins.insight_type) ?? 1.0
    const score = computeRelevanceScore(ins.severity, ins.confidence, weight)
    return {
      id: ins.id,
      insight_type: ins.insight_type,
      confidence: ins.confidence,
      severity: ins.severity,
      relevanceScore: score,
      urgencyLevel: getUrgencyLevel(score),
      suppressed: shouldSuppress(weight),
    }
  })
}

// ---------------------------------------------------------------------------
// Source category mapping
// ---------------------------------------------------------------------------

export type SourceCategory = "competitors" | "events" | "seo" | "content"

export function getSourceCategory(insightType: string, competitorId: string | null): SourceCategory {
  void competitorId
  if (insightType.startsWith("events.")) return "events"
  if (insightType.startsWith("seo_") || insightType.startsWith("cross_")) return "seo"
  if (insightType.startsWith("menu.") || insightType.startsWith("content.")) return "content"
  return "competitors"
}

export const SOURCE_LABELS: Record<SourceCategory, string> = {
  competitors: "Google Business Profile",
  events: "Local Events",
  seo: "Search Visibility",
  content: "Website & Menu",
}

export const SOURCE_COLORS: Record<SourceCategory, { bg: string; text: string; border: string; dot: string }> = {
  competitors: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-400" },
  events: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-400" },
  seo: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", dot: "bg-sky-400" },
  content: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", dot: "bg-teal-400" },
}
