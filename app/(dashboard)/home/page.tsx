import Link from "next/link"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Card } from "@/components/ui/card"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import { fetchHomePageData } from "@/lib/cache/home"
import { computeRelevanceScore } from "@/lib/insights/scoring"
import IntelligenceBrief from "@/components/home/intelligence-brief"
import MetricCards from "@/components/home/metric-cards"
import ActivityFeed from "@/components/home/activity-feed"
import CompetitorWatch from "@/components/home/competitor-watch"
import HomeChartsSection from "./home-charts-section"

const TYPE_MAP: Record<string, { badge: string; type: string }> = {
  competitor_rating_change: { badge: "Review", type: "review" },
  competitor_review_growth: { badge: "Review", type: "review" },
  competitor_sentiment: { badge: "Review", type: "review" },
  social_engagement: { badge: "Social", type: "social" },
  social_followers: { badge: "Social", type: "social" },
  social_visual: { badge: "Social", type: "social" },
  weather_impact: { badge: "Weather", type: "weather" },
  traffic_peak: { badge: "Traffic", type: "traffic" },
  visibility_ranking: { badge: "Visibility", type: "visibility" },
  menu_change: { badge: "Menu", type: "menu" },
  pricing_change: { badge: "Pricing", type: "pricing" },
}

const IMPACT_FROM_SEVERITY: Record<string, "high" | "medium" | "low"> = {
  critical: "high",
  warning: "medium",
  info: "low",
  positive: "low",
}

const COMP_COLORS = [
  "bg-primary/[0.18] text-vatic-indigo-soft",
  "bg-signal-gold/[0.15] text-signal-gold",
  "bg-precision-teal/[0.14] text-precision-teal",
  "bg-destructive/[0.13] text-destructive",
  "bg-muted-violet/[0.18] text-muted-violet",
]

const BAR_COLOR_KEYS = ["indigo", "gold", "teal", "red", "muted"]

export default async function HomePage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const cached = await fetchHomePageData(organizationId)

  const defaultLocationId = cached.locations[0]?.id ?? null
  const hasLocations = cached.locationCount > 0
  const hasCompetitors = cached.competitorCount > 0
  const hasInsights = cached.insightCount > 0
  const isNewUser = !hasCompetitors && !hasInsights

  const scoredInsights = cached.recentInsights
    .map((ins) => ({
      ...ins,
      score: computeRelevanceScore(ins.severity, ins.confidence),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  // Build brief text from top insight
  const topInsight = scoredInsights[0]
  const briefText = topInsight
    ? `<em>${topInsight.title}</em> — ${topInsight.summary}`
    : undefined
  const topRec = topInsight
    ? ((topInsight.recommendations ?? []) as Array<{ title?: string; rationale?: string }>)[0]
    : undefined

  // Signal pills from insight categories
  const typeCounts = new Map<string, number>()
  for (const ins of scoredInsights.slice(0, 10)) {
    const t = ins.insight_type
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
  }
  const signalPills = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => {
      const tm = TYPE_MAP[type]
      const label = `${tm?.badge ?? type} · ${count} signal${count !== 1 ? "s" : ""}`
      const color: "gold" | "teal" | "indigo" =
        tm?.type === "review" || tm?.type === "pricing" || tm?.type === "traffic"
          ? "gold"
          : tm?.type === "weather" || tm?.type === "visibility"
            ? "teal"
            : "indigo"
      return { label, color }
    })

  // Build activity feed items from insights
  const feedItems = scoredInsights.slice(0, 10).map((ins, idx) => {
    const tm = TYPE_MAP[ins.insight_type] ?? { badge: "Signal", type: "social" }
    const recs = (ins.recommendations ?? []) as Array<{ title?: string; rationale?: string }>
    return {
      id: ins.id,
      competitorName: ins.competitor_id ? `Competitor` : "Your Location",
      initials: ins.competitor_id ? "C" + ((idx % 5) + 1) : "YL",
      colorClass: COMP_COLORS[idx % COMP_COLORS.length],
      type: tm.type,
      typeBadge: tm.badge,
      description: `<strong>${ins.title}</strong>. ${ins.summary}`,
      impact: IMPACT_FROM_SEVERITY[ins.severity ?? "info"] ?? ("low" as const),
      recommendation: recs[0]?.title
        ? `<strong>${recs[0].title}</strong>${recs[0].rationale ? " — " + recs[0].rationale : ""}`
        : undefined,
      timeAgo: formatRelativeTime(ins.created_at),
    }
  })

  // Build competitor watch from insight frequency
  const compSignals = new Map<string, number>()
  for (const ins of cached.recentInsights) {
    if (ins.competitor_id) {
      compSignals.set(ins.competitor_id, (compSignals.get(ins.competitor_id) ?? 0) + 1)
    }
  }
  const competitorWatchItems = Array.from(compSignals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([, count], idx) => ({
      name: `Competitor ${idx + 1}`,
      changePercent: Math.round((count / Math.max(cached.recentInsights.length, 1)) * 100),
      changeDir: "up" as const,
      barPercent: Math.min(100, Math.round((count / 10) * 100)),
      barColor: BAR_COLOR_KEYS[idx % BAR_COLOR_KEYS.length],
      signalCount: count,
      summary: "Active signals this week",
    }))

  // Trending topics
  const trendingPills = signalPills.map((p) => ({
    label: p.label.split(" · ")[0],
    color: p.color,
  }))

  // Today's new insights count
  const today = new Date().toISOString().split("T")[0]
  const todayCount = cached.recentInsights.filter(
    (i) => i.created_at.startsWith(today)
  ).length
  const yesterdayCount = cached.recentInsights.filter((i) => {
    const d = new Date(i.created_at)
    d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0] === today
  }).length

  // KPI metrics
  const metrics = [
    {
      label: "Nearby Competitors",
      value: cached.competitorCount,
      colorClass: "text-vatic-indigo-soft",
      delta: cached.competitorCount > 0 ? `${cached.competitorCount} tracked` : undefined,
      deltaType: "up" as const,
      icon: (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="4" cy="4.5" r="2.5" />
          <circle cx="9" cy="4.5" r="2.5" />
          <path d="M0.5 10.5 C0.5 8.5 2 7.5 4 7.5" />
        </svg>
      ),
    },
    {
      label: "Active Alerts",
      value: cached.recentInsights.filter((i) => i.severity === "critical" || i.severity === "warning").length,
      colorClass: "text-signal-gold",
      delta: "need your attention",
      deltaType: "warn" as const,
      icon: (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M6 1 C3.2 1 1 3.2 1 6 C1 8.8 3.2 11 6 11 C8.8 11 11 8.8 11 6 C11 3.2 8.8 1 6 1Z" />
          <path d="M6 3.5 L6 6.5M6 8 L6 8.2" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: "New Signals Today",
      value: todayCount,
      delta: todayCount > yesterdayCount
        ? `+${todayCount - yesterdayCount} from yesterday`
        : todayCount < yesterdayCount
          ? `${yesterdayCount - todayCount} fewer than yesterday`
          : "same as yesterday",
      deltaType: todayCount >= yesterdayCount ? ("up" as const) : ("down" as const),
      icon: (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <polyline points="1,10 3.5,6.5 6,8 8.5,3.5 11,1.5" />
        </svg>
      ),
    },
    {
      label: "Top Threat",
      value: 0,
      valueName: competitorWatchItems[0]?.name ?? "None",
      colorClass: competitorWatchItems.length > 0 ? "text-destructive" : "text-muted-foreground",
      delta: competitorWatchItems[0]
        ? `${competitorWatchItems[0].signalCount} signals this week`
        : "No competitor activity",
      deltaType: competitorWatchItems.length > 0 ? ("down" as const) : ("flat" as const),
      icon: (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <polyline points="1,9.5 3,6.5 6,8 11,2" />
          <path d="M8 2 L11 2 L11 5" />
        </svg>
      ),
    },
  ]

  return (
    <section className="space-y-5">
      {/* Onboarding checklist for new users */}
      {isNewUser && (
        <Card className="border-primary/30 bg-primary/10">
          <h2 className="text-sm font-bold text-foreground">Getting Started</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete these steps to start receiving competitive insights.
          </p>
          <div className="mt-4 space-y-3">
            <ChecklistItem done={hasLocations} label="Add your first location" href="/locations" />
            <ChecklistItem done={hasCompetitors} label="Discover and approve competitors" href="/competitors" />
            <ChecklistItem done={hasInsights} label="Generate your first insights" href="/insights" />
          </div>
        </Card>
      )}

      {/* Intelligence Brief */}
      <IntelligenceBrief
        briefText={briefText}
        recommendedAction={topRec?.title ? `<strong>${topRec.title}</strong>${topRec.rationale ? " " + topRec.rationale : ""}` : undefined}
        signalPills={signalPills}
        updatedAgo={scoredInsights[0] ? formatRelativeTime(scoredInsights[0].created_at) : "never"}
      />

      {/* KPI Metric Cards */}
      <MetricCards metrics={metrics} />

      {/* Quick Actions */}
      {defaultLocationId && hasCompetitors && (
        <div className="flex flex-wrap items-center gap-2">
          <JobRefreshButton
            type="refresh_all"
            locationId={defaultLocationId}
            label="Refresh All Data"
            pendingLabel="Refreshing all data pipelines"
          />
          <JobRefreshButton
            type="insights"
            locationId={defaultLocationId}
            label="Generate Insights"
            pendingLabel="Generating insights"
          />
        </div>
      )}

      {/* Two-column grid: Activity Feed + Competitor Watch */}
      <div className="grid min-h-0 grid-cols-1 gap-5 lg:grid-cols-[1fr_350px]">
        <ActivityFeed items={feedItems} />
        <CompetitorWatch
          competitors={competitorWatchItems}
          trending={trendingPills}
        />
      </div>

      {/* Charts (existing) */}
      {hasInsights && (
        <HomeChartsSection allInsights={cached.allInsights} />
      )}

      {/* Empty state */}
      {!hasInsights && hasCompetitors && (
        <Card className="border-dashed bg-card py-8 text-center">
          <svg
            className="mx-auto h-10 w-10 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
            />
          </svg>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No insights generated yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Refresh your data pipelines first, then generate insights to see intelligence here.
          </p>
        </Card>
      )}
    </section>
  )
}

function ChecklistItem({ done, label, href }: { done: boolean; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-primary/20 bg-card px-4 py-3 transition-colors hover:bg-primary/10"
    >
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-precision-teal text-white" : "border-2 border-muted-foreground text-transparent"
        }`}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <span className={`text-sm ${done ? "text-muted-foreground line-through" : "font-medium text-foreground"}`}>
        {label}
      </span>
    </Link>
  )
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  const diffMs = now - then
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}
