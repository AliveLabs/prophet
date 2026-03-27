import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { type SubscriptionTier } from "@/lib/billing/tiers"
import { isSeoIntersectionEnabled } from "@/lib/billing/limits"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import VisibilityFilters from "@/components/visibility/visibility-filters"
import TrafficChart from "@/components/visibility/traffic-chart"
import RankingDistribution from "@/components/visibility/ranking-distribution"
import KeywordTabs from "@/components/visibility/keyword-tabs"
import IntentSerpPanels from "@/components/visibility/intent-serp-panels"
import { fetchVisibilityPageData } from "@/lib/cache/visibility"
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
  const tier = (org?.subscription_tier ?? "free") as SubscriptionTier

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
  // Fetch all SEO data (cached, 7-day TTL)
  // -----------------------------------------------------------------------
  const cached = selectedLocationId
    ? await fetchVisibilityPageData(selectedLocationId)
    : { snapshots: {}, trackedKwCount: 0, competitors: [], intersectionSnaps: [] }

  const rankSnap = cached.snapshots["seo_domain_rank_overview"]
  const rankData = rankSnap?.raw_data as DomainRankSnapshot | null

  const kwSnap = cached.snapshots["seo_ranked_keywords"]
  const rankedKeywords = ((kwSnap?.raw_data as Record<string, unknown>)?.keywords ?? []) as NormalizedRankedKeyword[]
  const lastRefreshed = rankSnap?.date_key ?? kwSnap?.date_key ?? null

  const serpSnap = cached.snapshots["seo_serp_keywords"]
  const serpEntries = ((serpSnap?.raw_data as Record<string, unknown>)?.entries ?? []) as SerpRankEntry[]

  const cdSnap = cached.snapshots["seo_competitors_domain"]
  const organicCompetitors = ((cdSnap?.raw_data as Record<string, unknown>)?.competitors ?? []) as NormalizedOrganicCompetitor[]

  const rpSnap = cached.snapshots["seo_relevant_pages"]
  const relevantPages = ((rpSnap?.raw_data as Record<string, unknown>)?.pages ?? []) as NormalizedRelevantPage[]

  const sdSnap = cached.snapshots["seo_subdomains"]
  const subdomains = ((sdSnap?.raw_data as Record<string, unknown>)?.subdomains ?? []) as NormalizedSubdomain[]

  const hrSnap = cached.snapshots["seo_historical_rank"]
  const historicalData = ((hrSnap?.raw_data as Record<string, unknown>)?.history ?? []) as HistoricalTrafficPoint[]

  const adSnap = cached.snapshots["seo_ads_search"]
  const adCreatives = ((adSnap?.raw_data as Record<string, unknown>)?.creatives ?? []) as NormalizedAdCreative[]

  const trackedKwCount = cached.trackedKwCount

  const intersectionRows: NormalizedIntersectionRow[] = []
  if (isSeoIntersectionEnabled(tier) && selectedLocationId) {
    for (const snap of cached.intersectionSnaps) {
      const rows = (snap.raw_data as Record<string, unknown>)?.rows as NormalizedIntersectionRow[] | undefined
      if (rows) intersectionRows.push(...rows)
    }
  }

  // -----------------------------------------------------------------------
  // Compute KPIs
  // -----------------------------------------------------------------------
  let organicEtv = 0
  let organicKeywords = 0
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
  // Render
  // -----------------------------------------------------------------------

  return (
    <section className="space-y-5">
      {/* Filter + Actions Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <VisibilityFilters
          locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
          selectedLocationId={selectedLocationId ?? ""}
          activeTab={activeTab}
        />
        {selectedLocationId && (
          <JobRefreshButton
            type="visibility"
            locationId={selectedLocationId}
            label="Refresh SEO"
            pendingLabel="Refreshing SEO data"
          />
        )}
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {freshnessLabel}
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {decodeURIComponent(error)}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-precision-teal/30 bg-precision-teal/10 px-4 py-3 text-sm text-precision-teal">
          {decodeURIComponent(success)}
        </div>
      )}

      {locationDomain && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
          <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
          </svg>
          <span>
            Tracking domain:{" "}
            <span className="font-medium text-foreground">{locationDomain}</span>
          </span>
          <a href="/locations" className="ml-auto font-medium text-primary hover:text-primary/80">
            Change URL
          </a>
        </div>
      )}

      {/* Missing website warning */}
      {selectedLocation && !selectedLocation.website && (
        <div className="rounded-xl border border-signal-gold/30 bg-signal-gold/10 px-4 py-3 text-sm text-signal-gold">
          <strong>No website configured.</strong> Click &quot;Refresh SEO&quot; to auto-resolve from Google Places, or add a website URL in{" "}
          <a href="/locations" className="underline hover:text-signal-gold">Locations</a>.
        </div>
      )}

      {/* Last refreshed */}
      {lastRefreshed && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-precision-teal" />
          Last refreshed: {new Date(lastRefreshed + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          {locationDomain && (
            <span className="ml-2 text-muted-foreground">
              Domain: <strong className="text-muted-foreground">{locationDomain}</strong>
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
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-foreground">Traffic Trends</h2>
            <p className="mb-3 text-xs text-muted-foreground">Organic and paid traffic over the past 12 months.</p>
            <TrafficChart data={historicalData} />
          </div>

          {/* ROW 3: Keywords + Organic Competitors */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Organic Keywords with tabs */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
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
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                Organic Competitors ({organicCompetitors.length})
              </h2>
              {organicCompetitors.length > 0 ? (
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-muted-foreground">
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
                          <tr key={comp.domain} className="border-b border-border hover:bg-secondary/50">
                            <td className="max-w-[140px] truncate py-2 pr-3 font-medium text-primary">
                              {comp.domain}
                            </td>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-1.5">
                                <div className="h-2 w-16 overflow-hidden rounded-full bg-secondary">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-destructive via-signal-gold to-precision-teal"
                                    style={{ width: `${overlapPct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground">{comp.intersections}</span>
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground">{comp.organicKeywords.toLocaleString()}</td>
                            <td className="py-2 text-muted-foreground">{comp.organicEtv.toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No organic competitor data yet.</p>
              )}
            </div>
          </div>

          {/* ROW 4: Keywords by Intent + SERP Features */}
          <IntentSerpPanels intentData={intentData} serpFeatures={serpFeatures} />

          {/* ROW 5: Ranking Distribution */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Keyword Ranking Distribution</h2>
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
              <p className="text-sm text-muted-foreground">No distribution data available.</p>
            )}
          </div>

          {/* ROW 6: Top Pages + Subdomains */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top Pages */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                Top Pages in Organic Search ({relevantPages.length})
              </h2>
              {relevantPages.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">URL</th>
                        <th className="py-2 pr-3 font-medium text-right">Traffic Share</th>
                        <th className="py-2 font-medium text-right">Total Traffic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relevantPages.slice(0, 15).map((page) => (
                        <tr key={page.url} className="border-b border-border">
                          <td className="max-w-[220px] truncate py-2 pr-3">
                            <a
                              href={page.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              {page.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                            </a>
                          </td>
                          <td className="py-2 pr-3 text-right text-muted-foreground">{page.trafficShare}%</td>
                          <td className="py-2 text-right text-muted-foreground">{page.organicEtv.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No top pages data yet.</p>
              )}
            </div>

            {/* Subdomains */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                Top Subdomains ({subdomains.length})
              </h2>
              {subdomains.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">URL</th>
                        <th className="py-2 pr-3 font-medium text-right">Traffic Share</th>
                        <th className="py-2 font-medium text-right">Total Traffic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subdomains.slice(0, 10).map((sub) => (
                        <tr key={sub.subdomain} className="border-b border-border">
                          <td className="max-w-[220px] truncate py-2 pr-3 font-medium text-foreground">
                            {sub.subdomain}
                          </td>
                          <td className="py-2 pr-3 text-right text-muted-foreground">{sub.trafficShare}%</td>
                          <td className="py-2 text-right text-muted-foreground">{sub.organicEtv.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No subdomain data yet.</p>
              )}
            </div>
          </div>

          {/* ROW 7: Keyword Gap Opportunities */}
          {gapOpportunities.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-foreground">Keyword Gap Opportunities</h2>
              <p className="mb-3 text-xs text-muted-foreground">Keywords competitors rank for that you don&apos;t appear for.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Keyword</th>
                      <th className="py-2 pr-4 font-medium">Comp. Rank</th>
                      <th className="py-2 pr-4 font-medium">Volume</th>
                      <th className="py-2 font-medium">CPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapOpportunities.map((g) => (
                      <tr key={g.keyword} className="border-b border-border">
                        <td className="py-2 pr-4 font-medium text-foreground">{g.keyword}</td>
                        <td className="py-2 pr-4 text-muted-foreground">#{g.domain2Rank ?? "—"}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{g.searchVolume?.toLocaleString() ?? "—"}</td>
                        <td className="py-2 text-muted-foreground">{g.cpc ? `$${g.cpc.toFixed(2)}` : "—"}</td>
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
                <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                  <span className="text-xs text-muted-foreground">Featured Snippets</span>
                  <p className="text-lg font-bold text-foreground">{featuredSnippets}</p>
                </div>
              )}
              {localPackCount > 0 && (
                <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                  <span className="text-xs text-muted-foreground">Local Pack</span>
                  <p className="text-lg font-bold text-foreground">{localPackCount}</p>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {kpiSource === "none" && serpEntries.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
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
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Paid Keyword Overlap</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Keyword</th>
                      <th className="py-2 pr-4 font-medium">Your Rank</th>
                      <th className="py-2 pr-4 font-medium">Comp. Rank</th>
                      <th className="py-2 pr-4 font-medium">Volume</th>
                      <th className="py-2 font-medium">CPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paidOverlap.map((r) => (
                      <tr key={r.keyword} className="border-b border-border">
                        <td className="py-2 pr-4 font-medium text-foreground">{r.keyword}</td>
                        <td className="py-2 pr-4 text-muted-foreground">#{r.domain1Rank ?? "—"}</td>
                        <td className="py-2 pr-4 text-muted-foreground">#{r.domain2Rank ?? "—"}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{r.searchVolume?.toLocaleString() ?? "—"}</td>
                        <td className="py-2 text-muted-foreground">{r.cpc ? `$${r.cpc.toFixed(2)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ad Creatives feed */}
          {adCreatives.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Competitor Ad Creatives</h2>
              <div className="space-y-3">
                {adCreatives.slice(0, 20).map((ad, i) => (
                  <div key={i} className="rounded-xl border border-border bg-secondary/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-primary">{ad.headline ?? "Ad creative"}</p>
                        {ad.description && <p className="mt-0.5 text-xs text-muted-foreground">{ad.description}</p>}
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                          {ad.displayUrl && <span>{ad.displayUrl}</span>}
                          {ad.domain && <span className="font-medium text-muted-foreground">{ad.domain}</span>}
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
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                No paid advertising detected
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
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
    indigo: "border-l-primary bg-primary/10",
    violet: "border-l-vatic-indigo-soft bg-vatic-indigo-soft/10",
    emerald: "border-l-precision-teal bg-precision-teal/10",
    sky: "border-l-primary bg-primary/10",
    amber: "border-l-signal-gold bg-signal-gold/10",
    orange: "border-l-signal-gold bg-signal-gold/10",
    rose: "border-l-destructive bg-destructive/10",
    blue: "border-l-primary bg-primary/10",
    slate: "border-l-muted-foreground bg-secondary",
  }
  const cls = colorMap[accent] ?? colorMap.indigo

  const badgeColorMap: Record<string, string> = {
    emerald: "bg-precision-teal/15 text-precision-teal",
    rose: "bg-destructive/15 text-destructive",
    amber: "bg-signal-gold/15 text-signal-gold",
  }

  return (
    <div className={`rounded-xl border border-border border-l-4 ${cls} p-3 shadow-sm`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-bold text-foreground">{value}</span>
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
        {badge && (
          <span className="ml-1 rounded-full bg-signal-gold/15 px-1.5 py-0.5 text-[9px] font-medium text-signal-gold">
            {badge}
          </span>
        )}
      </div>
      {badges && badges.length > 0 && (
        <div className="mt-1 flex gap-1">
          {badges.map((b) => (
            <span
              key={b.label}
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${badgeColorMap[b.color] ?? "bg-secondary text-muted-foreground"}`}
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
