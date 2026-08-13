// The all-insights view — everything the product has recommended or observed for the
// operator's location, on ONE page with ONE card.
//
// This is the surface /preview/insight-card section 4 specified: no tabs, two sections in
// a fixed order, and the second one is honest about why it is second.
//
//   1. "Ready to act on"  — pool entries whose play carries a real recipe. These render
//      through the SAME wired <BriefInsightCard/> the home brief mounts, so Keep/Dismiss/
//      thumbs here are the same signals, key for key.
//   2. "Observations"     — everything without a plan: recipe-less pool entries plus the
//      detector rows from the insights feed, both through the unified card.
//
// Each section batches six at a time (the ALT-292 reveal), which is what retires the old
// /home/pool page's single uncapped ~15,000px list. /home/pool now redirects here.

import Link from "next/link"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { loadPoolEntries, POOL_RETENTION_DAYS, type PoolEntry } from "@/lib/insights/insight-pool"
import { loadLatestPlayActionsByKey } from "@/lib/insights/momentum"
import { scoreInsights, type InsightPreference } from "@/lib/insights/scoring"
import { resolveDisplayName } from "../../operator-data"
import { RevealOnView, TkTooltipLayer } from "@/components/ticket"
import type { FeedInsight } from "../insights-feed-kit"
import AllInsightsFeed, { type PlanItem, type ObservationItem } from "./all-insights-feed"
import "../insights.css"
import "../../home/brief.css"

type LocRow = { id: string; name: string | null }

/** The detector rows that back the Observations section: active rows from the same
 *  trailing window the pool retains, so the two datasets describe the same stretch. */
async function fetchObservationRows(
  organizationId: string,
  locationId: string,
  locationName: string | null,
): Promise<FeedInsight[]> {
  const admin = createAdminSupabaseClient()
  const startDate = new Date(Date.now() - POOL_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10)

  const [{ data: rows }, { data: prefsRaw }, { data: competitorsRaw }] = await Promise.all([
    admin
      .from("insights")
      .select(
        "id, title, summary, confidence, severity, status, user_feedback, evidence, recommendations, date_key, competitor_id, insight_type",
      )
      .eq("location_id", locationId)
      .gte("date_key", startDate)
      .not("status", "in", '("dismissed","snoozed","inaccurate")')
      .order("date_key", { ascending: false }),
    admin
      .from("insight_preferences")
      .select("insight_type, weight, useful_count, dismissed_count")
      .eq("organization_id", organizationId),
    admin.from("competitors").select("id, name, display_label").eq("location_id", locationId).eq("is_active", true),
  ])

  const preferences: InsightPreference[] = (prefsRaw ?? []).map((p) => ({
    insight_type: p.insight_type,
    weight: Number(p.weight),
    useful_count: p.useful_count,
    dismissed_count: p.dismissed_count,
  }))

  const competitorNameMap = new Map<string, string>()
  for (const c of competitorsRaw ?? []) {
    competitorNameMap.set(c.id, resolveDisplayName(c.display_label, c.name, "Competitor"))
  }

  const insights = rows ?? []
  const scoredMap = new Map(
    scoreInsights(
      insights.map((i) => ({
        id: i.id,
        insight_type: i.insight_type as string,
        confidence: i.confidence,
        severity: i.severity,
      })),
      preferences,
    ).map((s) => [s.id, s]),
  )

  return insights.map((insight) => {
    const scored = scoredMap.get(insight.id)
    const insightType = insight.insight_type as string
    const subjectLabel = insightType.startsWith("events.")
      ? "Local events"
      : insightType.startsWith("seo_")
        ? "Search visibility"
        : insight.competitor_id
          ? competitorNameMap.get(insight.competitor_id) ?? "Competitor"
          : locationName ?? "Your location"

    return {
      id: insight.id,
      title: insight.title,
      summary: insight.summary,
      insightType,
      competitorId: insight.competitor_id,
      confidence: insight.confidence,
      severity: insight.severity,
      status: insight.status,
      userFeedback: (insight.user_feedback as string | null) ?? null,
      relevanceScore: scored?.relevanceScore ?? 0,
      urgencyLevel: scored?.urgencyLevel ?? "info",
      suppressed: scored?.suppressed ?? false,
      evidence: (insight.evidence as Record<string, unknown>) ?? {},
      recommendations: (insight.recommendations as Array<Record<string, unknown>>) ?? [],
      subjectLabel,
      dateKey: insight.date_key as string,
    }
  })
}

export default async function AllInsightsPage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/onboarding")

  const { data: locRow } = await (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => { maybeSingle: () => Promise<{ data: LocRow | null }> }
            }
          }
        }
      }
    }
  )
    .from("locations")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!locRow) redirect("/home")

  // loadPoolEntries / the row fetch are admin-client reads behind the page-level auth
  // above (the same posture the retired /home/pool page used); loadPoolEntries is
  // fail-soft ([] on any error).
  const [entries, playActions, rows] = await Promise.all([
    loadPoolEntries(locRow.id),
    loadLatestPlayActionsByKey(locRow.id),
    fetchObservationRows(organizationId, locRow.id, locRow.name),
  ])

  const hasPlan = (e: PoolEntry) => (e.play?.recipe?.length ?? 0) > 0

  const toPlanItem = (e: PoolEntry): PlanItem => {
    const action = playActions[e.play_key]
    return {
      entry: e,
      // The action-row date (undo hits the right row), or the date the play's brief last
      // served it — the same (location, date, play) contract the brief's own calls use.
      dateKey: action?.dateKey ?? e.last_seen_date,
      current: action?.action ?? null,
    }
  }

  // Kept plays lead the section (the operator's own picks), then the pool's order:
  // this week's top, then most recent.
  const planned = entries.filter(hasPlan).map(toPlanItem)
  const planItems = [
    ...planned.filter((p) => p.current === "saved"),
    ...planned.filter((p) => p.current !== "saved"),
  ]

  // Observations: recipe-less pool entries + active detector rows, one run ordered by
  // recency (ties: higher-scored rows first).
  const observations: ObservationItem[] = [
    ...entries.filter((e) => !hasPlan(e)).map((e) => ({ kind: "play" as const, item: toPlanItem(e) })),
    ...rows.map((row) => ({ kind: "row" as const, row })),
  ].sort((a, b) => {
    const da = a.kind === "play" ? a.item.entry.last_seen_date : a.row.dateKey
    const db = b.kind === "play" ? b.item.entry.last_seen_date : b.row.dateKey
    if (da !== db) return db.localeCompare(da)
    const sa = a.kind === "row" ? a.row.relevanceScore : 0
    const sb = b.kind === "row" ? b.row.relevanceScore : 0
    return sb - sa
  })

  return (
    // .ticket-brief scopes the shared play-card evidence styles the wired brief card
    // reuses — the same wrapper /home and /insights put over their kit surfaces.
    <div className="ticket-brief tk-kit">
      <TkTooltipLayer />
      <div className="pv-page">
        <Link href="/home" className="pv-back">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to your brief
        </Link>
        <RevealOnView as="header" className="pv-page-head">
          <div className="pv-kicker">All insights</div>
          <h1 className="pv-h1">
            All your insights{locRow.name ? <span className="ins-all-loc"> · {locRow.name}</span> : null}
          </h1>
          <p className="pv-sub">
            Everything from your recent briefs and sweeps collects here. The top few surface on
            your brief each morning; the rest stay here, ready when you are.
          </p>
        </RevealOnView>

        <hr className="pv-rule" />

        <AllInsightsFeed planItems={planItems} observations={observations} locationId={locRow.id} />
      </div>
    </div>
  )
}
