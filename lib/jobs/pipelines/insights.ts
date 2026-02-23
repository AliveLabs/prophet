// ---------------------------------------------------------------------------
// Insights Pipeline – step definitions for the generate insights job
// Wraps the large generateInsightsAction logic into discrete steps
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { fetchPlaceDetails } from "@/lib/places/google"
import { diffSnapshots, buildInsights, buildWeeklyInsights } from "@/lib/insights"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import { generateGeminiJson } from "@/lib/ai/gemini"
import { buildInsightNarrativePrompt } from "@/lib/ai/prompts/insights"
import { generateContentInsights } from "@/lib/content/insights"
import type { MenuSnapshot, SiteContentSnapshot } from "@/lib/content/types"
import { generateSeoInsights, type SeoInsightContext } from "@/lib/seo/insights"
import { SEO_SNAPSHOT_TYPES } from "@/lib/seo/types"
import type {
  DomainRankSnapshot,
  NormalizedRankedKeyword,
  NormalizedRelevantPage,
  HistoricalTrafficPoint,
  NormalizedIntersectionRow,
  NormalizedAdCreative,
  SerpRankEntry,
} from "@/lib/seo/types"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type InsightsPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  location: {
    id: string
    name: string | null
    primary_place_id: string | null
  }
  dateKey: string
  competitors: Array<{
    id: string
    name: string | null
    metadata: Record<string, unknown> | null
  }>
  state: {
    locationSnapshot: NormalizedSnapshot | null
    insightsPayload: Array<Record<string, unknown>>
    warnings: string[]
  }
}

// ---------------------------------------------------------------------------
// Helpers (copied from insights/actions.ts to avoid breaking originals)
// ---------------------------------------------------------------------------

function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}
function getPreviousDateKey(baseKey: string, days: number) {
  const base = new Date(baseKey)
  base.setDate(base.getDate() - days)
  return getDateKey(base)
}
function getNumber(v: unknown) { return typeof v === "number" ? v : null }
function getString(v: unknown) { return typeof v === "string" ? v : null }
function getHoursRecord(v: unknown) {
  if (!v || typeof v !== "object") return null
  const record: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") record[k] = val
  }
  return Object.keys(record).length ? record : null
}
function clampReviews(reviews: Array<Record<string, unknown>>) {
  return reviews.map((r) => ({
    rating: typeof r.rating === "number" ? r.rating : undefined,
    text: (() => { const t = r.text as { text?: unknown } | undefined; return typeof t?.text === "string" ? t.text : undefined })(),
    date: typeof r.relativePublishTimeDescription === "string" ? r.relativePublishTimeDescription : undefined,
    author: (() => { const a = r.authorAttribution as { displayName?: unknown } | undefined; return typeof a?.displayName === "string" ? a.displayName : undefined })(),
  })).filter((r) => r.text).slice(0, 6)
}
function formatPriceLevel(v: string | null | undefined) {
  if (!v) return "not available"
  if (/^\d+$/.test(v)) return Number(v) > 0 ? "$".repeat(Math.min(Number(v), 4)) : "not available"
  return v.replace("PRICE_LEVEL_", "").toLowerCase()
}
function summarizeHours(hours: Record<string, string> | null | undefined) {
  if (!hours) return "hours not available"
  return Object.keys(hours).length > 0 ? `hours listed (${Object.keys(hours).length} days)` : "hours not available"
}
function buildDeterministicSummary(input: { location: { name?: string; rating?: number | null; reviewCount?: number | null; priceLevel?: string | null; hours?: Record<string, string> | null }; competitor: { name?: string; rating?: number | null; reviewCount?: number | null; priceLevel?: string | null; hours?: Record<string, string> | null } }) {
  return `${input.location.name ?? "Location"} has rating ${input.location.rating ?? "n/a"} with ${input.location.reviewCount ?? "n/a"} reviews. ${input.competitor.name ?? "Competitor"} has rating ${input.competitor.rating ?? "n/a"} with ${input.competitor.reviewCount ?? "n/a"} reviews. Price: ${formatPriceLevel(input.location.priceLevel)} vs ${formatPriceLevel(input.competitor.priceLevel)}. Hours: ${summarizeHours(input.location.hours)} vs ${summarizeHours(input.competitor.hours)}.`
}
function buildDeterministicRecommendations(input: { location: { rating?: number | null; reviewCount?: number | null }; competitor: { rating?: number | null; reviewCount?: number | null } }) {
  const recs: Array<{ title: string; rationale: string }> = []
  if (typeof input.location.rating === "number" && typeof input.competitor.rating === "number" && input.competitor.rating - input.location.rating >= 0.2)
    recs.push({ title: "Close the rating gap", rationale: "Competitor rating is higher; focus on service quality." })
  if (typeof input.location.reviewCount === "number" && typeof input.competitor.reviewCount === "number" && input.competitor.reviewCount - input.location.reviewCount >= 50)
    recs.push({ title: "Increase review volume", rationale: "Competitor has more reviews; run a review campaign." })
  if (!recs.length) recs.push({ title: "Maintain consistency", rationale: "No major gaps detected." })
  return recs
}

function buildSnapshotFromPlaceDetails(details: Awaited<ReturnType<typeof fetchPlaceDetails>> | null): NormalizedSnapshot | null {
  if (!details) return null
  const phone = details.internationalPhoneNumber ?? details.nationalPhoneNumber ?? undefined
  const hours = details.regularOpeningHours?.weekdayDescriptions?.reduce<Record<string, string>>((acc, line) => {
    const [day, rest] = line.split(":")
    if (day && rest) acc[day.trim()] = rest.trim()
    return acc
  }, {}) ?? undefined
  const recentReviews = details.reviews?.map((r, i) => ({
    id: `${details.id ?? "place"}-${i}`,
    rating: r.rating ?? 0,
    text: r.text?.text ?? "",
    date: r.relativePublishTimeDescription ?? "",
  })) ?? []
  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    profile: { title: details.displayName?.text ?? undefined, rating: details.rating ?? undefined, reviewCount: details.userRatingCount ?? undefined, priceLevel: details.priceLevel ?? undefined, address: details.formattedAddress ?? undefined, website: details.websiteUri ?? undefined, phone },
    hours,
    recentReviews,
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export function buildInsightsSteps(): PipelineStepDef<InsightsPipelineCtx>[] {
  return [
    {
      name: "load_location_data",
      label: "Loading location data from Google Places",
      run: async (c) => {
        if (c.location.primary_place_id) {
          const details = await fetchPlaceDetails(c.location.primary_place_id)
          c.state.locationSnapshot = buildSnapshotFromPlaceDetails(details)
        }
        return { hasPlacesData: !!c.state.locationSnapshot }
      },
    },
    {
      name: "competitor_analysis",
      label: "Analyzing competitors & generating narratives",
      run: async (c) => {
        let generated = 0
        for (const competitor of c.competitors) {
          const { data: currentSnapshot } = await c.supabase
            .from("snapshots")
            .select("raw_data, date_key")
            .eq("competitor_id", competitor.id)
            .order("date_key", { ascending: false })
            .limit(1)
            .maybeSingle()

          const metadata = competitor.metadata
          const placeDetails = metadata?.placeDetails as Record<string, unknown> | null
          const reviewSnippets = clampReviews((placeDetails?.reviews as Array<Record<string, unknown>>) ?? [])

          if (!currentSnapshot) {
            c.state.insightsPayload.push({
              location_id: c.locationId, competitor_id: competitor.id, date_key: c.dateKey,
              insight_type: "baseline_snapshot",
              title: `Baseline snapshot captured for ${competitor.name ?? "competitor"}`,
              summary: "First snapshot — future runs will compare against this baseline.",
              confidence: "low", severity: "info", evidence: { field: "baseline", date_key: c.dateKey }, recommendations: [], status: "new",
            })
          } else {
            const previousKey = getPreviousDateKey(currentSnapshot.date_key, 1)
            const weeklyKey = getPreviousDateKey(currentSnapshot.date_key, 7)
            const { data: prevSnap } = await c.supabase.from("snapshots").select("raw_data").eq("competitor_id", competitor.id).eq("date_key", previousKey).maybeSingle()
            const { data: weeklySnap } = await c.supabase.from("snapshots").select("raw_data").eq("competitor_id", competitor.id).eq("date_key", weeklyKey).maybeSingle()
            const diff = diffSnapshots((prevSnap?.raw_data as NormalizedSnapshot | null) ?? null, currentSnapshot.raw_data as NormalizedSnapshot)
            const weeklyDiff = diffSnapshots((weeklySnap?.raw_data as NormalizedSnapshot | null) ?? null, currentSnapshot.raw_data as NormalizedSnapshot)
            const combined = [...buildInsights(diff), ...buildWeeklyInsights(weeklyDiff)]
            for (const insight of combined) {
              c.state.insightsPayload.push({ location_id: c.locationId, competitor_id: competitor.id, date_key: currentSnapshot.date_key ?? c.dateKey, ...insight, status: "new" })
            }
            if (combined.length === 0 && prevSnap) {
              c.state.insightsPayload.push({ location_id: c.locationId, competitor_id: competitor.id, date_key: currentSnapshot.date_key ?? c.dateKey, insight_type: "no_significant_change", title: `No significant changes for ${competitor.name}`, summary: "No meaningful changes detected.", confidence: "low", severity: "info", evidence: { field: "snapshot" }, recommendations: [], status: "new" })
            }
          }

          // LLM narrative
          if (c.state.locationSnapshot || reviewSnippets.length) {
            try {
              const promptInput = {
                location: { name: c.location.name ?? undefined, rating: c.state.locationSnapshot?.profile?.rating ?? null, reviewCount: c.state.locationSnapshot?.profile?.reviewCount ?? null, priceLevel: c.state.locationSnapshot?.profile?.priceLevel ?? null, hours: c.state.locationSnapshot?.hours ?? null },
                competitor: { name: competitor.name ?? undefined, rating: getNumber(placeDetails?.rating), reviewCount: getNumber(placeDetails?.reviewCount), priceLevel: getString(placeDetails?.priceLevel), hours: getHoursRecord(placeDetails?.regularOpeningHours) },
                deltas: { ratingDelta: null, reviewCountDelta: null, hoursChanged: null },
                reviewSnippets,
              }
              const prompt = buildInsightNarrativePrompt(promptInput)
              const llm = (await generateGeminiJson(prompt)) as { summary?: string; recommendations?: Array<{ title?: string; rationale?: string }>; reviewThemes?: Array<{ theme?: string; sentiment?: string; examples?: string[] }> } | null
              const summary = llm?.summary && llm.summary.length > 40 ? llm.summary : buildDeterministicSummary(promptInput)
              const recs = llm?.recommendations?.length ? llm.recommendations : buildDeterministicRecommendations(promptInput)
              c.state.insightsPayload.push({ location_id: c.locationId, competitor_id: competitor.id, date_key: c.dateKey, insight_type: "competitive_summary", title: `Competitive summary: ${competitor.name}`, summary, confidence: "medium", severity: "info", evidence: { field: "summary" }, recommendations: recs.map((r) => ({ title: r.title ?? "Action", rationale: r.rationale ?? "" })), status: "new" })
              if (llm?.reviewThemes?.length) {
                const counts = llm.reviewThemes.reduce((a, t) => { const s = t.sentiment ?? "mixed"; if (s === "positive") a.positive++; else if (s === "negative") a.negative++; else a.mixed++; return a }, { positive: 0, negative: 0, mixed: 0 })
                c.state.insightsPayload.push({ location_id: c.locationId, competitor_id: competitor.id, date_key: c.dateKey, insight_type: "review_themes", title: `Review themes: ${competitor.name}`, summary: "Key themes from recent reviews.", confidence: "medium", severity: "info", evidence: { themes: llm.reviewThemes, sentimentCounts: counts }, recommendations: [], status: "new" })
              }
              generated++
            } catch { /* non-fatal */ }
          }
        }
        return { competitorsAnalyzed: c.competitors.length, narratives: generated }
      },
    },
    {
      name: "cross_source_correlation",
      label: "Correlating SEO, events & competitor data",
      run: async (c) => {
        let crossInsights = 0
        // SEO + Events cross-source
        const { data: seoSnaps } = await c.supabase.from("location_snapshots").select("provider, raw_data").eq("location_id", c.locationId).in("provider", ["seo_domain_rank_overview", "seo_historical_rank", "seo_ranked_keywords"]).order("date_key", { ascending: false }).limit(3)
        const seoMap = new Map<string, Record<string, unknown>>()
        for (const s of seoSnaps ?? []) { if (!seoMap.has(s.provider)) seoMap.set(s.provider, s.raw_data as Record<string, unknown>) }
        const historicalData = ((seoMap.get("seo_historical_rank") as Record<string, unknown>)?.history ?? []) as Array<{ date: string; organicEtv: number }>

        const { data: eventSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "dataforseo_google_events").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const eventsData = eventSnap?.raw_data as { events?: Array<{ title?: string }> } | null

        if (eventsData?.events?.length && historicalData.length >= 2) {
          const last = historicalData[historicalData.length - 1]
          const prev = historicalData[historicalData.length - 2]
          if (last && prev && last.organicEtv > prev.organicEtv) {
            const pct = ((last.organicEtv - prev.organicEtv) / (prev.organicEtv || 1)) * 100
            if (pct >= 5) {
              c.state.insightsPayload.push({ location_id: c.locationId, competitor_id: null, date_key: c.dateKey, insight_type: "cross_event_seo_opportunity", title: "Event-driven traffic opportunity detected", summary: `Organic traffic grew ${Math.round(pct)}% while ${eventsData.events.length} local events are upcoming.`, confidence: "medium", severity: "info", evidence: { traffic_growth_pct: Math.round(pct), upcoming_events: eventsData.events.slice(0, 3).map((e) => e.title) }, recommendations: [{ title: "Create event-related content", rationale: "Capitalize on event-related search demand." }], status: "new" })
              crossInsights++
            }
          }
        }
        return { crossInsights }
      },
    },
    {
      name: "enriched_seo_insights",
      label: "Generating enriched SEO insights",
      run: async (c) => {
        const { data: locObj } = await c.supabase.from("locations").select("website").eq("id", c.locationId).maybeSingle()
        const locationWebsite = locObj?.website as string | null
        let locationDomain: string | null = null
        if (locationWebsite) { try { locationDomain = new URL(locationWebsite.startsWith("http") ? locationWebsite : `https://${locationWebsite}`).hostname.replace(/^www\./, "") } catch {} }

        const { data: locKwSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "seo_ranked_keywords").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const locationKeywords = ((locKwSnap?.raw_data as Record<string, unknown>)?.keywords ?? []) as NormalizedRankedKeyword[]
        const { data: locRankSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "seo_domain_rank_overview").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const currentRank = locRankSnap?.raw_data as DomainRankSnapshot | null
        const { data: locPagesSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "seo_relevant_pages").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const currentPages = ((locPagesSnap?.raw_data as Record<string, unknown>)?.pages ?? []) as NormalizedRelevantPage[]
        const { data: locHistSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "seo_historical_rank").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const historicalTraffic = ((locHistSnap?.raw_data as Record<string, unknown>)?.history ?? []) as HistoricalTrafficPoint[]
        const { data: locSerpSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "seo_serp_keywords").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const serpEntries = ((locSerpSnap?.raw_data as Record<string, unknown>)?.entries ?? []) as SerpRankEntry[]
        const { data: locAdsSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "seo_ads_search").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const adCreatives = ((locAdsSnap?.raw_data as Record<string, unknown>)?.creatives ?? []) as NormalizedAdCreative[]

        const competitorRankedKeywords = new Map<string, NormalizedRankedKeyword[]>()
        const competitorRelevantPages = new Map<string, NormalizedRelevantPage[]>()
        const competitorHistoricalTraffic = new Map<string, HistoricalTrafficPoint[]>()
        const allIntersectionRows: NormalizedIntersectionRow[] = []

        for (const comp of c.competitors) {
          try { const { data: s } = await c.supabase.from("snapshots").select("raw_data").eq("competitor_id", comp.id).eq("snapshot_type", SEO_SNAPSHOT_TYPES.rankedKeywords).order("date_key", { ascending: false }).limit(1).maybeSingle(); if (s) { const kw = ((s.raw_data as Record<string, unknown>)?.keywords ?? []) as NormalizedRankedKeyword[]; if (kw.length) competitorRankedKeywords.set(comp.id, kw) } } catch {}
          try { const { data: s } = await c.supabase.from("snapshots").select("raw_data").eq("competitor_id", comp.id).eq("snapshot_type", SEO_SNAPSHOT_TYPES.relevantPages).order("date_key", { ascending: false }).limit(1).maybeSingle(); if (s) { const p = ((s.raw_data as Record<string, unknown>)?.pages ?? []) as NormalizedRelevantPage[]; if (p.length) competitorRelevantPages.set(comp.id, p) } } catch {}
          try { const { data: s } = await c.supabase.from("snapshots").select("raw_data").eq("competitor_id", comp.id).eq("snapshot_type", SEO_SNAPSHOT_TYPES.historicalRank).order("date_key", { ascending: false }).limit(1).maybeSingle(); if (s) { const h = ((s.raw_data as Record<string, unknown>)?.history ?? []) as HistoricalTrafficPoint[]; if (h.length) competitorHistoricalTraffic.set(comp.id, h) } } catch {}
          try { const { data: s } = await c.supabase.from("snapshots").select("raw_data").eq("competitor_id", comp.id).eq("snapshot_type", SEO_SNAPSHOT_TYPES.domainIntersection).order("date_key", { ascending: false }).limit(1).maybeSingle(); if (s) { const r = ((s.raw_data as Record<string, unknown>)?.rows ?? []) as NormalizedIntersectionRow[]; allIntersectionRows.push(...r) } } catch {}
        }

        const compMetas = c.competitors.map((comp) => {
          const pd = comp.metadata?.placeDetails as Record<string, unknown> | null
          const web = (comp.metadata?.website as string) ?? (pd?.websiteUri as string) ?? null
          let domain: string | null = null
          if (web) { try { domain = new URL(web.startsWith("http") ? web : `https://${web}`).hostname.replace(/^www\./, "") } catch {} }
          return { id: comp.id, name: comp.name ?? null, domain }
        })

        const seoCtx: SeoInsightContext = { locationName: c.location.name ?? "Your location", locationDomain, competitors: compMetas }
        const seoInsights = generateSeoInsights({
          currentRank, previousRank: null, currentKeywords: locationKeywords, previousKeywords: [],
          serpEntries, previousSerpEntries: [], intersectionRows: allIntersectionRows, previousIntersectionRows: [],
          adCreatives, previousAdCreatives: [], currentBacklinks: null, previousBacklinks: null,
          currentPages, previousPages: [], historicalTraffic,
          competitorRankedKeywords, competitorRelevantPages, competitorHistoricalTraffic,
          context: seoCtx,
        })
        for (const ins of seoInsights) {
          c.state.insightsPayload.push({ location_id: c.locationId, competitor_id: ins.evidence?.competitor_id ? String(ins.evidence.competitor_id) : null, date_key: c.dateKey, ...ins, status: "new" })
        }
        return { seoInsights: seoInsights.length }
      },
    },
    {
      name: "content_insights",
      label: "Generating content & menu insights",
      run: async (c) => {
        const { data: locMenuSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "firecrawl_menu").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const { data: locSiteSnap } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "firecrawl_site_content").order("date_key", { ascending: false }).limit(1).maybeSingle()
        const locMenu = locMenuSnap?.raw_data as MenuSnapshot | null
        const locSiteContent = locSiteSnap?.raw_data as SiteContentSnapshot | null
        if (!locMenu && !locSiteContent) return { contentInsights: 0 }

        const { data: prevMenuSnaps } = await c.supabase.from("location_snapshots").select("raw_data").eq("location_id", c.locationId).eq("provider", "firecrawl_menu").order("date_key", { ascending: false }).range(1, 1)
        const previousMenu = prevMenuSnaps?.[0]?.raw_data as MenuSnapshot | null

        type CompMenu = { competitorId: string; competitorName: string; menu: MenuSnapshot; siteContent: SiteContentSnapshot | null }
        const compMenus: CompMenu[] = []
        for (const comp of c.competitors) {
          const { data: s } = await c.supabase.from("snapshots").select("raw_data").eq("competitor_id", comp.id).eq("snapshot_type", "web_menu_weekly").order("date_key", { ascending: false }).limit(1).maybeSingle()
          if (s) compMenus.push({ competitorId: comp.id, competitorName: comp.name ?? "Competitor", menu: s.raw_data as MenuSnapshot, siteContent: null })
        }

        const insights = generateContentInsights(locMenu, compMenus, locSiteContent, previousMenu)
        for (const ins of insights) {
          const compName = (ins.evidence as Record<string, unknown>)?.competitor as string | undefined
          let compId: string | null = null
          if (compName) { const m = compMenus.find((cm) => cm.competitorName === compName); if (m) compId = m.competitorId }
          c.state.insightsPayload.push({ location_id: c.locationId, competitor_id: compId, date_key: c.dateKey, ...ins, status: "new" })
        }
        return { contentInsights: insights.length }
      },
    },
    {
      name: "save_insights",
      label: "Saving all insights",
      run: async (c) => {
        if (c.state.insightsPayload.length > 0) {
          await c.supabase.from("insights").upsert(c.state.insightsPayload, {
            onConflict: "location_id,competitor_id,date_key,insight_type",
          })
        }
        return { totalInsights: c.state.insightsPayload.length }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export async function buildInsightsContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<InsightsPipelineCtx> {
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, primary_place_id")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!location) throw new Error("Location not found")

  const { data: comps } = await supabase
    .from("competitors")
    .select("id, name, metadata, is_active")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const competitors = (comps ?? [])
    .filter((c) => (c.metadata as Record<string, unknown> | null)?.status === "approved")
    .map((c) => ({ id: c.id, name: c.name, metadata: c.metadata as Record<string, unknown> | null }))

  return {
    supabase,
    locationId,
    organizationId,
    location: { id: location.id, name: location.name, primary_place_id: location.primary_place_id },
    dateKey: new Date().toISOString().slice(0, 10),
    competitors,
    state: { locationSnapshot: null, insightsPayload: [], warnings: [] },
  }
}
