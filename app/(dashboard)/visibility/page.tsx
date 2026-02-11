import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { getTierFromPriceId } from "@/lib/billing/tiers"
import { isSeoIntersectionEnabled } from "@/lib/billing/limits"
import { refreshSeoAction } from "./actions"
import VisibilityFilters from "@/components/visibility/visibility-filters"
import TrafficChart from "@/components/visibility/traffic-chart"
import RankingDistribution from "@/components/visibility/ranking-distribution"
import KeywordTabs from "@/components/visibility/keyword-tabs"
import IntentSerpPanels from "@/components/visibility/intent-serp-panels"
import RefreshOverlay from "@/components/ui/refresh-overlay"
import type {
  DomainRankSnapshot,
  NormalizedRankedKeyword,
  SerpRankEntry,
  NormalizedIntersectionRow,
  NormalizedAdCreative,
  NormalizedOrganicCompetitor,
  NormalizedRelevantPage,
  NormalizedSubdomain,
  HistoricalTrafficPoint,
} from "@/lib/seo/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageProps = {
  searchParams?: Promise<{
    location_id?: string
    tab?: string
    error?: string
    success?: string
  }>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function VisibilityPage({ searchParams }: PageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()
  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()
  const tier = getTierFromPriceId(org?.subscription_tier)

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, website")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedParams = await Promise.resolve(searchParams)
  const selectedLocationId = resolvedParams?.location_id ?? locations?.[0]?.id ?? null
  const activeTab = resolvedParams?.tab ?? "organic"
  const error = resolvedParams?.error
  const success = resolvedParams?.success
  const selectedLocation = locations?.find((l) => l.id === selectedLocationId) ?? null

  // -----------------------------------------------------------------------
  // Helper: fetch latest location snapshot
  // -----------------------------------------------------------------------
  async function latestSnap(provider: string) {
    if (!selectedLocationId) return null
    const { data } = await supabase
      .from("location_snapshots")
      .select("raw_data, date_key")
      .eq("location_id", selectedLocationId)
      .eq("provider", provider)
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    return data
  }

  // -----------------------------------------------------------------------
  // Fetch all SEO snapshots
  // -----------------------------------------------------------------------
  const rankSnap = await latestSnap("seo_domain_rank_overview")
  const rankData = rankSnap?.raw_data as DomainRankSnapshot | null

  const kwSnap = await latestSnap("seo_ranked_keywords")
  const rankedKeywords = ((kwSnap?.raw_data as Record<string, unknown>)?.keywords ?? []) as NormalizedRankedKeyword[]
  const lastRefreshed = rankSnap?.date_key ?? kwSnap?.date_key ?? null

  const serpSnap = await latestSnap("seo_serp_keywords")
  const serpEntries = ((serpSnap?.raw_data as Record<string, unknown>)?.entries ?? []) as SerpRankEntry[]

  const cdSnap = await latestSnap("seo_competitors_domain")
  const organicCompetitors = ((cdSnap?.raw_data as Record<string, unknown>)?.competitors ?? []) as NormalizedOrganicCompetitor[]

  const rpSnap = await latestSnap("seo_relevant_pages")
  const relevantPages = ((rpSnap?.raw_data as Record<string, unknown>)?.pages ?? []) as NormalizedRelevantPage[]

  const sdSnap = await latestSnap("seo_subdomains")
  const subdomains = ((sdSnap?.raw_data as Record<string, unknown>)?.subdomains ?? []) as NormalizedSubdomain[]

  const hrSnap = await latestSnap("seo_historical_rank")
  const historicalData = ((hrSnap?.raw_data as Record<string, unknown>)?.history ?? []) as HistoricalTrafficPoint[]

  const adSnap = await latestSnap("seo_ads_search")
  const adCreatives = ((adSnap?.raw_data as Record<string, unknown>)?.creatives ?? []) as NormalizedAdCreative[]

  // Tracked keywords count
  const { count: trackedKwCount } = selectedLocationId
    ? await supabase
        .from("tracked_keywords")
        .select("id", { count: "exact", head: true })
        .eq("location_id", selectedLocationId)
        .eq("is_active", true)
    : { count: 0 }

  // Competitor rank snapshots for intersection
  const { data: compSnapshots } = selectedLocationId
    ? await supabase
        .from("competitors")
        .select("id, name, website")
        .eq("location_id", selectedLocationId)
        .eq("is_active", true)
    : { data: [] }

  let intersectionRows: NormalizedIntersectionRow[] = []
  if (isSeoIntersectionEnabled(tier) && selectedLocationId) {
    const compIds = (compSnapshots ?? []).map((c) => c.id)
    if (compIds.length > 0) {
      const { data: diSnaps } = await supabase
        .from("snapshots")
        .select("raw_data")
        .in("competitor_id", compIds)
        .eq("snapshot_type", "seo_domain_intersection_weekly")
        .order("date_key", { ascending: false })
        .limit(5)
      for (const snap of diSnaps ?? []) {
        const rows = (snap.raw_data as Record<string, unknown>)?.rows as NormalizedIntersectionRow[] | undefined
        if (rows) intersectionRows.push(...rows)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Compute KPIs
  // -----------------------------------------------------------------------
  let organicEtv = 0
  let organicKeywords = 0
  let top3 = 0
  let top10 = 0
  let newKw = 0
  let lostKw = 0
  let upKw = 0
  let downKw = 0
  let trafficCost = 0
  let featuredSnippets = 0
  let localPackCount = 0
  let kpiSource: "rank_overview" | "ranked_keywords" | "none" = "none"

  // Check if rank overview has meaningful data (not all zeros for small domains)
  const rankHasData = rankData && ((rankData.organic?.etv ?? 0) > 0 || (rankData.organic?.rankedKeywords ?? 0) > 0)

  if (rankHasData) {
    kpiSource = "rank_overview"
    organicEtv = Math.round(rankData.organic?.etv ?? 0)
    organicKeywords = rankData.organic?.rankedKeywords ?? 0
    top3 = (rankData.organic?.distribution?.pos_1 ?? 0) + (rankData.organic?.distribution?.pos_2_3 ?? 0)
    top10 = top3 + (rankData.organic?.distribution?.pos_4_10 ?? 0)
    newKw = rankData.organic?.newKeywords ?? 0
    lostKw = rankData.organic?.lostKeywords ?? 0
    upKw = rankData.organic?.upKeywords ?? 0
    downKw = rankData.organic?.downKeywords ?? 0
    trafficCost = Math.round(rankData.organic?.estimatedPaidTrafficCost ?? 0)
    featuredSnippets = rankData.organic?.featuredSnippetCount ?? 0
    localPackCount = rankData.organic?.localPackCount ?? 0
  } else if (rankedKeywords.length > 0) {
    kpiSource = "ranked_keywords"
    organicKeywords = rankedKeywords.length
    top3 = rankedKeywords.filter((kw) => kw.rank <= 3).length
    top10 = rankedKeywords.filter((kw) => kw.rank <= 10).length
    // Estimate organic traffic using a CTR model (not raw search volume sum)
    organicEtv = rankedKeywords.reduce((sum, kw) => {
      const vol = kw.searchVolume ?? 0
      const rank = kw.rank
      // Approximate CTR by rank position
      let ctr = 0
      if (rank === 1) ctr = 0.30
      else if (rank === 2) ctr = 0.15
      else if (rank === 3) ctr = 0.10
      else if (rank <= 5) ctr = 0.06
      else if (rank <= 10) ctr = 0.03
      else if (rank <= 20) ctr = 0.01
      else ctr = 0.005
      return sum + Math.round(vol * ctr)
    }, 0)
  }

  const paidEtv = Math.round(rankData?.paid?.etv ?? 0)
  const paidKeywords = rankData?.paid?.rankedKeywords ?? 0

  // Location domain
  const locationDomain = selectedLocation?.website
    ? (() => {
        try {
          return new URL(
            selectedLocation.website.startsWith("http")
              ? selectedLocation.website
              : `https://${selectedLocation.website}`
          ).hostname.replace(/^www\./, "")
        } catch {
          return null
        }
      })()
    : null

  // Keyword gap opportunities
  const gapOpportunities = intersectionRows
    .filter((r) => r.gapType === "loss" && (r.searchVolume ?? 0) > 0)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 20)

  // Intent breakdown (from ranked keywords)
  const intentMap = new Map<string, { count: number; traffic: number }>()
  for (const kw of rankedKeywords) {
    const intent = kw.intent ?? "unknown"
    const existing = intentMap.get(intent) ?? { count: 0, traffic: 0 }
    existing.count += 1
    existing.traffic += kw.searchVolume ?? 0
    intentMap.set(intent, existing)
  }
  const totalIntentKw = rankedKeywords.length || 1
  const intentData = Array.from(intentMap.entries())
    .filter(([key]) => key !== "unknown")
    .map(([intent, data]) => ({
      intent,
      count: data.count,
      traffic: data.traffic,
      percent: Math.round((data.count / totalIntentKw) * 10000) / 100,
    }))
    .sort((a, b) => b.count - a.count)

  // SERP features breakdown
  const serpFeatureMap = new Map<string, number>()
  for (const kw of rankedKeywords) {
    for (const feature of kw.serpFeatures) {
      serpFeatureMap.set(feature, (serpFeatureMap.get(feature) ?? 0) + 1)
    }
  }
  const serpFeatures = Array.from(serpFeatureMap.entries())
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count)

  // Paid overlap
  const paidOverlap = intersectionRows
    .filter((r) => r.gapType === "shared" && r.domain1Rank !== null && r.domain2Rank !== null)
    .slice(0, 20)

  const freshnessLabel = tier === "free" || tier === "starter" ? "Weekly refresh" : "Daily refresh"

  // -----------------------------------------------------------------------
  // Quick facts for loading overlay
  // -----------------------------------------------------------------------
  const seoQuickFacts: string[] = []
  if (organicKeywords > 0) seoQuickFacts.push(`You rank for ${organicKeywords.toLocaleString()} keywords organically.`)
  if (top10 > 0) seoQuickFacts.push(`${top10.toLocaleString()} keywords are in the top 10 results.`)
  if (newKw > 0) seoQuickFacts.push(`${newKw} new keywords gained since last refresh.`)
  if (lostKw > 0) seoQuickFacts.push(`${lostKw} keywords lost since last refresh.`)
  if (gapOpportunities.length > 0) seoQuickFacts.push(`${gapOpportunities.length} keyword gap opportunities found vs competitors.`)
  if (organicCompetitors.length > 0) seoQuickFacts.push(`Top organic competitor: ${organicCompetitors[0].domain} (${organicCompetitors[0].intersections} shared keywords).`)
  if (relevantPages.length > 0) seoQuickFacts.push(`Your top page drives ${relevantPages[0].trafficShare}% of organic traffic.`)
  if (featuredSnippets > 0) seoQuickFacts.push(`You hold ${featuredSnippets} featured snippets in search results.`)
  if (localPackCount > 0) seoQuickFacts.push(`Your business appears in ${localPackCount} Local Pack results.`)

  const seoGeminiContext = locationDomain
    ? `Domain: ${locationDomain}. Organic keywords: ${organicKeywords}. Top 10: ${top10}. Organic traffic est: ${organicEtv}. Competitors tracked: ${compSnapshots?.length ?? 0}.`
    : `Local business SEO analysis. ${organicKeywords} organic keywords.`

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <section className="space-y-6">
      {/* ================================================================= */}
      {/* HEADER */}
      {/* ================================================================= */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Search Visibility</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Domain overview, organic + paid search performance vs competitors.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
              {freshnessLabel}
            </span>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {decodeURIComponent(error)}
          </p>
        )}
        {success && (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {decodeURIComponent(success)}
          </p>
        )}

        <VisibilityFilters
          locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
          selectedLocationId={selectedLocationId ?? ""}
          activeTab={activeTab}
        />

        {/* Refresh SEO action with interactive overlay */}
        {selectedLocationId && (
          <form action={refreshSeoAction} className="mt-4">
            <input type="hidden" name="location_id" value={selectedLocationId} />
            <RefreshOverlay
              label="Refresh SEO"
              pendingLabel="Refreshing SEO data"
              quickFacts={seoQuickFacts}
              geminiContext={seoGeminiContext}
              steps={[
                "Fetching domain overview...",
                "Analyzing ranked keywords...",
                "Scanning SERP positions...",
                "Comparing competitor domains...",
                "Collecting historical trends...",
                "Processing ad creatives...",
                "Building insights...",
              ]}
            />
          </form>
        )}
      </div>

      {/* Missing website warning */}
      {selectedLocation && !selectedLocation.website && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>No website configured.</strong> Click &quot;Refresh SEO&quot; to auto-resolve from Google Places, or add a website URL in{" "}
          <a href="/locations" className="underline hover:text-amber-900">Locations</a>.
        </div>
      )}

      {/* Last refreshed */}
      {lastRefreshed && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Last refreshed: {new Date(lastRefreshed + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          {locationDomain && (
            <span className="ml-2 text-slate-400">
              Domain: <strong className="text-slate-600">{locationDomain}</strong>
            </span>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* ORGANIC TAB */}
      {/* ================================================================= */}
      {activeTab === "organic" && (
        <div className="space-y-6">

          {/* ROW 1: Overview KPI Strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Organic Traffic"
              value={organicEtv.toLocaleString()}
              sub="est. clicks/mo"
              accent="emerald"
              badge={kpiSource === "ranked_keywords" ? "est." : undefined}
            />
            <KpiCard
              label="Paid Traffic"
              value={paidEtv.toLocaleString()}
              sub="est. clicks/mo"
              accent="violet"
            />
            <KpiCard
              label="Traffic Cost"
              value={trafficCost > 0 ? `$${Math.round(trafficCost).toLocaleString()}` : "—"}
              sub={trafficCost > 0 ? "organic equiv." : undefined}
              accent="amber"
            />
            <KpiCard
              label="Keywords"
              value={organicKeywords.toLocaleString()}
              sub={`${trackedKwCount ?? 0} tracked`}
              accent="indigo"
              badges={[
                { label: `+${newKw}`, color: "emerald" },
                { label: `-${lostKw}`, color: "rose" },
              ]}
            />
          </div>

          {/* ROW 2: Historical Traffic Chart */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Traffic Trends</h2>
            <p className="mb-3 text-xs text-slate-400">Organic and paid traffic over the past 12 months.</p>
            <TrafficChart data={historicalData} />
          </div>

          {/* ROW 3: Keywords + Organic Competitors */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Organic Keywords with tabs */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Organic Keywords ({organicKeywords.toLocaleString()})
              </h2>
              <KeywordTabs
                keywords={rankedKeywords}
                newCount={newKw}
                upCount={upKw}
                downCount={downKw}
                lostCount={lostKw}
              />
            </div>

            {/* Organic Competitors */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Organic Competitors ({organicCompetitors.length})
              </h2>
              {organicCompetitors.length > 0 ? (
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100 text-slate-400">
                        <th className="py-2 pr-3 font-medium">Domain</th>
                        <th className="py-2 pr-3 font-medium">Overlap</th>
                        <th className="py-2 pr-3 font-medium">Keywords</th>
                        <th className="py-2 font-medium">Traffic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {organicCompetitors.slice(0, 15).map((comp) => {
                        const maxOverlap = Math.max(...organicCompetitors.map((c) => c.intersections), 1)
                        const overlapPct = Math.round((comp.intersections / maxOverlap) * 100)
                        return (
                          <tr key={comp.domain} className="border-b border-slate-50 hover:bg-slate-50/50">
                            <td className="max-w-[140px] truncate py-2 pr-3 font-medium text-indigo-600">
                              {comp.domain}
                            </td>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-1.5">
                                <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400"
                                    style={{ width: `${overlapPct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-slate-400">{comp.intersections}</span>
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-slate-600">{comp.organicKeywords.toLocaleString()}</td>
                            <td className="py-2 text-slate-500">{comp.organicEtv.toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No organic competitor data yet.</p>
              )}
            </div>
          </div>

          {/* ROW 4: Keywords by Intent + SERP Features */}
          <IntentSerpPanels intentData={intentData} serpFeatures={serpFeatures} />

          {/* ROW 5: Ranking Distribution */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Keyword Ranking Distribution</h2>
            {rankHasData ? (
              <RankingDistribution distribution={rankData!.organic.distribution} />
            ) : rankedKeywords.length > 0 ? (
              <RankingDistribution distribution={{
                pos_1: rankedKeywords.filter((kw) => kw.rank === 1).length,
                pos_2_3: rankedKeywords.filter((kw) => kw.rank >= 2 && kw.rank <= 3).length,
                pos_4_10: rankedKeywords.filter((kw) => kw.rank >= 4 && kw.rank <= 10).length,
                pos_11_20: rankedKeywords.filter((kw) => kw.rank >= 11 && kw.rank <= 20).length,
                pos_21_50: rankedKeywords.filter((kw) => kw.rank >= 21 && kw.rank <= 50).length,
                pos_51_100: rankedKeywords.filter((kw) => kw.rank >= 51 && kw.rank <= 100).length,
              }} />
            ) : (
              <p className="text-sm text-slate-400">No distribution data available.</p>
            )}
          </div>

          {/* ROW 6: Top Pages + Subdomains */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top Pages */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Top Pages in Organic Search ({relevantPages.length})
              </h2>
              {relevantPages.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100 text-slate-400">
                        <th className="py-2 pr-3 font-medium">URL</th>
                        <th className="py-2 pr-3 font-medium text-right">Traffic Share</th>
                        <th className="py-2 font-medium text-right">Total Traffic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relevantPages.slice(0, 15).map((page) => (
                        <tr key={page.url} className="border-b border-slate-50">
                          <td className="max-w-[220px] truncate py-2 pr-3">
                            <a
                              href={page.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:underline"
                            >
                              {page.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                            </a>
                          </td>
                          <td className="py-2 pr-3 text-right text-slate-600">{page.trafficShare}%</td>
                          <td className="py-2 text-right text-slate-600">{page.organicEtv.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No top pages data yet.</p>
              )}
            </div>

            {/* Subdomains */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Top Subdomains ({subdomains.length})
              </h2>
              {subdomains.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100 text-slate-400">
                        <th className="py-2 pr-3 font-medium">URL</th>
                        <th className="py-2 pr-3 font-medium text-right">Traffic Share</th>
                        <th className="py-2 font-medium text-right">Total Traffic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subdomains.slice(0, 10).map((sub) => (
                        <tr key={sub.subdomain} className="border-b border-slate-50">
                          <td className="max-w-[220px] truncate py-2 pr-3 font-medium text-slate-700">
                            {sub.subdomain}
                          </td>
                          <td className="py-2 pr-3 text-right text-slate-600">{sub.trafficShare}%</td>
                          <td className="py-2 text-right text-slate-600">{sub.organicEtv.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No subdomain data yet.</p>
              )}
            </div>
          </div>

          {/* ROW 7: Keyword Gap Opportunities */}
          {gapOpportunities.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-slate-900">Keyword Gap Opportunities</h2>
              <p className="mb-3 text-xs text-slate-400">Keywords competitors rank for that you don&apos;t appear for.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400">
                      <th className="py-2 pr-4 font-medium">Keyword</th>
                      <th className="py-2 pr-4 font-medium">Comp. Rank</th>
                      <th className="py-2 pr-4 font-medium">Volume</th>
                      <th className="py-2 font-medium">CPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapOpportunities.map((g) => (
                      <tr key={g.keyword} className="border-b border-slate-50">
                        <td className="py-2 pr-4 font-medium text-slate-700">{g.keyword}</td>
                        <td className="py-2 pr-4 text-slate-600">#{g.domain2Rank ?? "—"}</td>
                        <td className="py-2 pr-4 text-slate-600">{g.searchVolume?.toLocaleString() ?? "—"}</td>
                        <td className="py-2 text-slate-500">{g.cpc ? `$${g.cpc.toFixed(2)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SERP Features metrics */}
          {(featuredSnippets > 0 || localPackCount > 0) && (
            <div className="flex flex-wrap gap-3">
              {featuredSnippets > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <span className="text-xs text-slate-400">Featured Snippets</span>
                  <p className="text-lg font-bold text-slate-900">{featuredSnippets}</p>
                </div>
              )}
              {localPackCount > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <span className="text-xs text-slate-400">Local Pack</span>
                  <p className="text-lg font-bold text-slate-900">{localPackCount}</p>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {kpiSource === "none" && serpEntries.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm text-slate-500">
                No SEO data yet. Click &quot;Refresh SEO&quot; to fetch search visibility data.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* PAID TAB */}
      {/* ================================================================= */}
      {activeTab === "paid" && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Est. Paid Traffic" value={paidEtv.toLocaleString()} sub="monthly visits" accent="amber" />
            <KpiCard label="Paid Keywords" value={paidKeywords.toLocaleString()} accent="orange" />
            <KpiCard label="Ad Creatives" value={String(adCreatives.length)} sub="detected" accent="rose" />
            <KpiCard label="Paid Overlap" value={String(paidOverlap.length)} sub="shared keywords" accent="violet" />
          </div>

          {/* Paid Keyword Overlap table */}
          {paidOverlap.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Paid Keyword Overlap</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400">
                      <th className="py-2 pr-4 font-medium">Keyword</th>
                      <th className="py-2 pr-4 font-medium">Your Rank</th>
                      <th className="py-2 pr-4 font-medium">Comp. Rank</th>
                      <th className="py-2 pr-4 font-medium">Volume</th>
                      <th className="py-2 font-medium">CPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paidOverlap.map((r) => (
                      <tr key={r.keyword} className="border-b border-slate-50">
                        <td className="py-2 pr-4 font-medium text-slate-700">{r.keyword}</td>
                        <td className="py-2 pr-4 text-slate-600">#{r.domain1Rank ?? "—"}</td>
                        <td className="py-2 pr-4 text-slate-600">#{r.domain2Rank ?? "—"}</td>
                        <td className="py-2 pr-4 text-slate-600">{r.searchVolume?.toLocaleString() ?? "—"}</td>
                        <td className="py-2 text-slate-500">{r.cpc ? `$${r.cpc.toFixed(2)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ad Creatives feed */}
          {adCreatives.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Competitor Ad Creatives</h2>
              <div className="space-y-3">
                {adCreatives.slice(0, 20).map((ad, i) => (
                  <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-indigo-700">{ad.headline ?? "Ad creative"}</p>
                        {ad.description && <p className="mt-0.5 text-xs text-slate-600">{ad.description}</p>}
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
                          {ad.displayUrl && <span>{ad.displayUrl}</span>}
                          {ad.domain && <span className="font-medium text-slate-500">{ad.domain}</span>}
                          {ad.keyword && <span>kw: {ad.keyword}</span>}
                          {ad.position && <span>pos: #{ad.position}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty paid state */}
          {paidEtv === 0 && adCreatives.length === 0 && paidOverlap.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm font-medium text-slate-600">
                No paid advertising detected
              </p>
              <p className="mt-1 text-xs text-slate-400">
                No Google Ads data found for this domain or its competitors.
                This is common for local businesses that rely on organic search.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// KPI Card component
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  accent,
  badge,
  badges,
}: {
  label: string
  value: string
  sub?: string
  accent: string
  badge?: string
  badges?: Array<{ label: string; color: string }>
}) {
  const colorMap: Record<string, string> = {
    indigo: "border-l-indigo-500 bg-indigo-50/30",
    violet: "border-l-violet-500 bg-violet-50/30",
    emerald: "border-l-emerald-500 bg-emerald-50/30",
    sky: "border-l-sky-500 bg-sky-50/30",
    amber: "border-l-amber-500 bg-amber-50/30",
    orange: "border-l-orange-500 bg-orange-50/30",
    rose: "border-l-rose-500 bg-rose-50/30",
    blue: "border-l-blue-500 bg-blue-50/30",
    slate: "border-l-slate-500 bg-slate-50/30",
  }
  const cls = colorMap[accent] ?? colorMap.indigo

  const badgeColorMap: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700",
    rose: "bg-rose-100 text-rose-700",
    amber: "bg-amber-100 text-amber-700",
  }

  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${cls} p-3 shadow-sm`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-bold text-slate-900">{value}</span>
        {sub && <span className="text-[10px] text-slate-400">{sub}</span>}
        {badge && (
          <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
            {badge}
          </span>
        )}
      </div>
      {badges && badges.length > 0 && (
        <div className="mt-1 flex gap-1">
          {badges.map((b) => (
            <span
              key={b.label}
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${badgeColorMap[b.color] ?? "bg-slate-100 text-slate-600"}`}
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
