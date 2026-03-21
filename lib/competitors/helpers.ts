// ---------------------------------------------------------------------------
// Competitor page helpers — signal type mapping, aggregation, coverage stats
// ---------------------------------------------------------------------------

export type SignalCategory =
  | "seo"
  | "menu"
  | "reviews"
  | "social"
  | "photos"
  | "traffic"
  | "events"
  | "weather"
  | "content"

export type SignalConfig = {
  label: string
  color: string
  bgClass: string
  icon: string
}

export const SIGNAL_TYPE_CONFIG: Record<SignalCategory, SignalConfig> = {
  seo: {
    label: "SEO",
    color: "var(--vatic-indigo-soft)",
    bgClass: "bg-vatic-indigo-soft/14 text-vatic-indigo-soft",
    icon: "🔍",
  },
  menu: {
    label: "Menu",
    color: "var(--vatic-indigo)",
    bgClass: "bg-primary/12 text-primary",
    icon: "🍽️",
  },
  reviews: {
    label: "Reviews",
    color: "var(--precision-teal)",
    bgClass: "bg-precision-teal/12 text-precision-teal",
    icon: "⭐",
  },
  social: {
    label: "Social",
    color: "var(--signal-gold)",
    bgClass: "bg-signal-gold/14 text-signal-gold",
    icon: "📱",
  },
  photos: {
    label: "Photos",
    color: "var(--muted-violet)",
    bgClass: "bg-muted-violet/14 text-muted-violet",
    icon: "📸",
  },
  traffic: {
    label: "Traffic",
    color: "var(--precision-teal)",
    bgClass: "bg-precision-teal/12 text-precision-teal",
    icon: "📈",
  },
  events: {
    label: "Events",
    color: "var(--signal-gold)",
    bgClass: "bg-signal-gold/14 text-signal-gold",
    icon: "📅",
  },
  weather: {
    label: "Weather",
    color: "var(--deep-violet)",
    bgClass: "bg-deep-violet/14 text-deep-violet",
    icon: "🌤️",
  },
  content: {
    label: "Content",
    color: "var(--vatic-indigo)",
    bgClass: "bg-primary/12 text-primary",
    icon: "🌐",
  },
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
}

export function mapInsightToCategory(insightType: string): SignalCategory {
  if (insightType.startsWith("seo_") || insightType.startsWith("seo."))
    return "seo"
  if (insightType.startsWith("menu.")) return "menu"
  if (
    insightType.startsWith("rating_") ||
    insightType.startsWith("review_") ||
    insightType.startsWith("weekly_rating") ||
    insightType.startsWith("weekly_review")
  )
    return "reviews"
  if (insightType.startsWith("social.")) return "social"
  if (insightType.startsWith("photo.") || insightType.startsWith("visual."))
    return "photos"
  if (insightType.startsWith("traffic.")) return "traffic"
  if (insightType.startsWith("event.") || insightType.startsWith("event_"))
    return "events"
  if (insightType.startsWith("weather.")) return "weather"
  if (insightType.startsWith("content.")) return "content"
  return "reviews"
}

export type CompetitorSignalAggregate = {
  severity: "critical" | "warning" | "info"
  signalCount: number
  topSignal: {
    category: SignalCategory
    headline: string
    date: string
    dateKey: string
  } | null
}

type InsightRow = {
  id: string
  insight_type: string
  title: string
  severity: string
  date_key: string | null
}

export function aggregateCompetitorSignals(
  insights: InsightRow[],
  competitorId: string
): CompetitorSignalAggregate {
  const mine = insights.filter(
    (i) => (i as { competitor_id?: string | null }).competitor_id === competitorId
  )

  if (mine.length === 0) {
    return { severity: "info", signalCount: 0, topSignal: null }
  }

  let maxSev = 0
  let topInsight: InsightRow | null = null

  for (const ins of mine) {
    const rank = SEVERITY_RANK[ins.severity] ?? 0
    if (rank > maxSev) {
      maxSev = rank
      topInsight = ins
    }
  }

  const severity =
    maxSev >= 3 ? "critical" : maxSev >= 2 ? "warning" : "info"

  return {
    severity,
    signalCount: mine.length,
    topSignal: topInsight
      ? {
          category: mapInsightToCategory(topInsight.insight_type),
          headline: topInsight.title,
          date: formatRelativeDate(topInsight.date_key),
          dateKey: topInsight.date_key ?? "",
        }
      : null,
  }
}

export type CoverageStats = {
  tracked: number
  signals: number
  sources: number
}

export function computeCoverageStats(
  insights: InsightRow[],
  approvedCount: number
): CoverageStats {
  const categories = new Set<string>()
  for (const ins of insights) {
    categories.add(mapInsightToCategory(ins.insight_type))
  }
  return {
    tracked: approvedCount,
    signals: insights.length,
    sources: categories.size,
  }
}

function formatRelativeDate(dateKey: string | null): string {
  if (!dateKey) return ""
  const d = new Date(dateKey + "T00:00:00")
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function formatTimeSince(dateStr: string | null): string {
  if (!dateStr) return "Never"
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function getCurrentWeekRange(): { start: string; end: string; label: string } {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const label = `${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`

  return { start: fmt(monday), end: fmt(sunday), label }
}
