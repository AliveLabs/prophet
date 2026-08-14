// /insights — the ONE canonical insights page (2026-08-13 consolidation).
//
// Merges the two surfaces that used to describe this data: the all-insights view built
// in #213 (two sections, unified card, batch reveal) and the useful filtering from the
// old detector-row feed page this file replaced. Two sections in a fixed order, and the
// second one is honest about why it is second:
//
//   1. "Ready to act on"  — pool entries whose play carries a real recipe. These render
//      through the SAME wired <BriefInsightCard/> the home brief mounts, so Keep/Dismiss/
//      thumbs here are the same signals, key for key. The latest brief's picks carry the
//      "Top this week" chip — the pinned-top treatment — wherever they land.
//   2. "Observations"     — everything without a plan: recipe-less pool entries plus the
//      detector rows from the nightly sweeps, both through the unified card.
//
// One URL-driven filter state (insights-filters.ts) applies across BOTH sections:
// type (the card's own chip labels — plays from the shared category map, rows from
// their signal source, see ALT-554), the #213 status views, and confidence/impact as
// word levels only. Filters land in
// searchParams via <AutoFilterForm/>, so a filtered view is shareable.
//
// /insights/all and /home/pool both redirect here.

import Link from "next/link"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { loadPoolEntries, POOL_RETENTION_DAYS, type PoolEntry } from "@/lib/insights/insight-pool"
import { loadLatestPlayActionsByKey } from "@/lib/insights/momentum"
import { scoreInsights, type InsightPreference } from "@/lib/insights/scoring"
import AutoFilterForm from "@/components/filters/auto-filter-form"
import { resolveDisplayName } from "../operator-data"
import { RevealOnView, TkSoftPanel, TkTooltipLayer } from "@/components/ticket"
import { confLevel, impactLevel, playChipLabel } from "../home/pass-map"
import {
  insightChipLabel,
  insightConfLevel,
  insightImpactLevel,
  type FeedInsight,
} from "./insights-map"
import {
  filtersActive,
  matchesFilters,
  parseInsightFilters,
  playStatusGroup,
  rowStatusGroup,
  typeOptions,
  type FilterableInsight,
  type InsightFilterState,
} from "./insights-filters"
import AllInsightsFeed, { type PlanItem, type ObservationItem } from "./all-insights-feed"
import "./insights.css"
import "../home/brief.css"

type LocRow = { id: string; name: string | null }

type InsightsPageProps = {
  searchParams?: Promise<{
    location_id?: string
    type?: string
    status?: string
    confidence?: string
    impact?: string
    // ALT-230: opaque JSON viz context carried from a viz-card T-bubble's "Generate
    // insight". Forwarded as a raw string to the client feed; NEVER parsed into any
    // server content, so a generated insight can't reach a server-rendered surface.
    generate?: string
  }>
}

/** The detector rows that back the Observations section: rows from the same trailing
 *  window the pool retains, so the two datasets describe the same stretch. ALL statuses
 *  are fetched — the page-level status filter is what decides visibility, and the
 *  Dismissed / Reported-inaccurate views need the cleared rows to review or undo. */
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

/* ── Filter descriptors: derived with the SAME functions the cards render with, so the
   filter and the chip/score it filters on agree by construction. ── */

function planFilterable(item: PlanItem): FilterableInsight {
  return {
    typeLabel: playChipLabel(item.entry.play),
    statusGroup: playStatusGroup(item.current),
    confidence: confLevel(item.entry.play.confidence),
    impact: impactLevel(item.entry.play),
  }
}

function rowFilterable(row: FeedInsight): FilterableInsight {
  return {
    typeLabel: insightChipLabel(row),
    statusGroup: rowStatusGroup(row.status),
    confidence: insightConfLevel(row.confidence),
    impact: insightImpactLevel(row.severity),
  }
}

function observationFilterable(o: ObservationItem): FilterableInsight {
  return o.kind === "play" ? planFilterable(o.item) : rowFilterable(o.row)
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/onboarding")

  const { data: locRows } = await supabase
    .from("locations")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })

  const locations: LocRow[] = locRows ?? []
  if (locations.length === 0) redirect("/home")

  const params = await Promise.resolve(searchParams)
  const requestedLocationId = params?.location_id ?? null
  const location =
    (requestedLocationId ? locations.find((l) => l.id === requestedLocationId) : null) ?? locations[0]
  const filters: InsightFilterState = parseInsightFilters(params)
  const hasFilters = filtersActive(filters)

  // loadPoolEntries / the row fetch are admin-client reads behind the page-level auth
  // above (the same posture the retired /home/pool page used); loadPoolEntries is
  // fail-soft ([] on any error).
  const [entries, playActions, rows] = await Promise.all([
    loadPoolEntries(location.id),
    loadLatestPlayActionsByKey(location.id),
    fetchObservationRows(organizationId, location.id, location.name),
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

  const allPlanItems = entries.filter(hasPlan).map(toPlanItem)

  // Observations: recipe-less pool entries + detector rows, one run ordered by recency
  // (ties: higher-scored rows first).
  const allObservations: ObservationItem[] = [
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

  // The type dropdown is derived from what actually exists (any status), so the option
  // set stays stable while the operator moves between status views.
  const typeOpts = typeOptions([
    ...allPlanItems.map((p) => planFilterable(p).typeLabel),
    ...allObservations.map((o) => observationFilterable(o).typeLabel),
  ])

  // Apply the one filter state to BOTH sections. Kept plays lead the first section
  // (the operator's own picks), then the pool's order: this week's top, then most recent.
  const planned = allPlanItems.filter((p) => matchesFilters(planFilterable(p), filters))
  const planItems = [
    ...planned.filter((p) => p.current === "saved"),
    ...planned.filter((p) => p.current !== "saved"),
  ]
  const observations = allObservations.filter((o) => matchesFilters(observationFilterable(o), filters))

  const anythingToFilter = allPlanItems.length > 0 || allObservations.length > 0

  return (
    // .ticket-brief scopes the shared play-card evidence styles the wired brief card
    // reuses — the same wrapper /home puts over its kit surfaces.
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
          <div className="pv-kicker">{location.name ?? "Your market"}</div>
          <h1 className="pv-h1">Insights</h1>
          <p className="pv-sub">
            Everything from your recent briefs and sweeps collects here. The top few surface on
            your brief each morning; the rest stay here, ready when you are.
          </p>
        </RevealOnView>

        <hr className="pv-rule" />

        {/* Filters — URL-driven, one state across both sections. Hidden while the
            account has nothing to filter (the still-filling state owns the page). */}
        {anythingToFilter || hasFilters ? (
          <TkSoftPanel className="ins-bar">
            <AutoFilterForm
              filters={[
                ...(locations.length > 1
                  ? [
                      {
                        name: "location_id",
                        defaultValue: location.id,
                        options: locations.map((l) => ({ value: l.id, label: l.name ?? "Location" })),
                      },
                    ]
                  : []),
                {
                  name: "type",
                  defaultValue: filters.type,
                  options: [{ value: "", label: "All types" }, ...typeOpts],
                },
                {
                  // Keep/Dismiss vocabulary (the Track menu's read/to-do/done/snoozed
                  // splits are retired): "Kept" spans every positive status, legacy
                  // Track-era rows included, so nothing an operator marked disappears.
                  name: "status",
                  defaultValue: filters.status,
                  options: [
                    { value: "", label: "All active" },
                    { value: "new", label: "New" },
                    { value: "kept", label: "Kept" },
                    { value: "dismissed", label: "Dismissed" },
                    { value: "inaccurate", label: "Reported inaccurate" },
                  ],
                },
                {
                  // Word levels only — the same words the card's score axes display.
                  name: "confidence",
                  defaultValue: filters.confidence,
                  options: [
                    { value: "", label: "All confidence" },
                    { value: "high", label: "High confidence" },
                    { value: "medium", label: "Medium confidence" },
                    { value: "directional", label: "Directional" },
                  ],
                },
                {
                  name: "impact",
                  defaultValue: filters.impact,
                  options: [
                    { value: "", label: "All impact" },
                    { value: "high", label: "High impact" },
                    { value: "medium", label: "Medium impact" },
                    { value: "low", label: "Low impact" },
                  ],
                },
              ]}
            />
          </TkSoftPanel>
        ) : null}

        <AllInsightsFeed
          planItems={planItems}
          observations={observations}
          planTotal={allPlanItems.length}
          obsTotal={allObservations.length}
          hasFilters={hasFilters}
          locationId={location.id}
          generateRequest={params?.generate ?? null}
        />
      </div>
    </div>
  )
}
