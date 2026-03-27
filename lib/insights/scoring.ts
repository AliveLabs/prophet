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

export type SourceCategory = "competitors" | "events" | "seo" | "content" | "photos" | "traffic" | "social"

export function getSourceCategory(insightType: string, competitorId: string | null): SourceCategory {
  void competitorId
  if (insightType.startsWith("social.")) return "social"
  if (insightType.startsWith("events.")) return "events"
  if (insightType.startsWith("seo_") || insightType.startsWith("cross_")) return "seo"
  if (insightType.startsWith("menu.") || insightType.startsWith("content.")) return "content"
  if (insightType.startsWith("photo.") || insightType.startsWith("visual.")) return "photos"
  if (insightType.startsWith("traffic.") || insightType.startsWith("busy_times.")) return "traffic"
  return "competitors"
}

export const SOURCE_LABELS: Record<SourceCategory, string> = {
  competitors: "Google Business Profile",
  events: "Local Events",
  seo: "Search Visibility",
  content: "Website & Menu",
  photos: "Visual Intelligence",
  traffic: "Foot Traffic",
  social: "Social Media",
}

// ---------------------------------------------------------------------------
// Monitoring-preferences filter
// Maps insight types to the preference keys stored in
// locations.settings.monitoring_preferences.
// ---------------------------------------------------------------------------

export type MonitoringPreferences = {
  pricing_changes?: boolean
  menu_updates?: boolean
  promotions?: boolean
  review_activity?: boolean
  new_openings?: boolean
}

const INSIGHT_TO_PREF: Record<string, keyof MonitoringPreferences> = {
  "price.change": "pricing_changes",
  "price.increase": "pricing_changes",
  "price.decrease": "pricing_changes",
  "menu.item_added": "menu_updates",
  "menu.item_removed": "menu_updates",
  "menu.change": "menu_updates",
  "content.menu_change": "menu_updates",
  "promotions.new": "promotions",
  "promotions.ended": "promotions",
  "events.upcoming": "promotions",
  "events.local_event": "promotions",
  "review.spike": "review_activity",
  "review.drop": "review_activity",
  "review.sentiment_shift": "review_activity",
  "competitor.new_opening": "new_openings",
}

export function isInsightEnabledByPreferences(
  insightType: string,
  preferences: MonitoringPreferences | null | undefined
): boolean {
  if (!preferences) return true
  const prefKey = INSIGHT_TO_PREF[insightType]
  if (!prefKey) return true
  return preferences[prefKey] !== false
}

export const SOURCE_COLORS: Record<SourceCategory, { bg: string; text: string; border: string; dot: string }> = {
  competitors: { bg: "bg-precision-teal/15", text: "text-precision-teal", border: "border-precision-teal/30", dot: "bg-precision-teal" },
  events: { bg: "bg-signal-gold/15", text: "text-signal-gold", border: "border-signal-gold/30", dot: "bg-signal-gold" },
  seo: { bg: "bg-primary/15", text: "text-primary", border: "border-primary/30", dot: "bg-primary" },
  content: { bg: "bg-precision-teal/15", text: "text-precision-teal", border: "border-precision-teal/30", dot: "bg-precision-teal" },
  photos: { bg: "bg-signal-gold/15", text: "text-signal-gold", border: "border-signal-gold/30", dot: "bg-signal-gold" },
  traffic: { bg: "bg-signal-gold/15", text: "text-signal-gold", border: "border-signal-gold/30", dot: "bg-signal-gold" },
  social: { bg: "bg-primary/15", text: "text-primary", border: "border-primary/30", dot: "bg-primary" },
}
