import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { asSubscriptionTier } from "@/lib/billing/tiers"
import { isSeoIntersectionEnabled } from "@/lib/billing/limits"
import { fetchVisibilityPageData } from "@/lib/cache/visibility"
import { loadCoverageHealth, EMPTY_COVERAGE } from "@/lib/jobs/vendor-health"
import { VendorUnavailableBanner } from "@/components/ui/vendor-unavailable-banner"
import {
  RevealOnView,
  TkWidgetGrid,
  TkWidget,
  TkSectionHead,
  TkEmptyState,
  TkRule,
} from "@/components/ticket"
import {
  VisibilityControlBar,
  VisibilityTrend,
  VisibilityH2H,
  VisibilityDistribution,
  VisibilityKeywords,
  VisibilityIntentSerp,
  VisibilityPages,
  VisibilityGaps,
  VisibilityPaidOverlap,
  VisibilityAds,
  VisibilityTooltips,
} from "./visibility-client"
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
import "./visibility.css"

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
  const tier = asSubscriptionTier(org?.subscription_tier)

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, website")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedParams = await Promise.resolve(searchParams)
  const requestedLocationId = resolvedParams?.location_id ?? null
  const selectedLocationId = (requestedLocationId && locations?.some((l: { id: string }) => l.id === requestedLocationId))
    ? requestedLocationId
    : locations?.[0]?.id ?? null
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

  // Live (uncached) vendor health — an outage must surface even though the page data above is
  // served from a 7-day cache that a failed refresh never busts.
  const coverageHealth = selectedLocationId
    ? await loadCoverageHealth(supabase, selectedLocationId)
    : EMPTY_COVERAGE

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

  const freshnessLabel =
    tier === "entry" ? "Weekly refresh" : "Daily refresh"

  // -----------------------------------------------------------------------
  // Presentation mapping (The Pass) — derived, serializable views of the data.
  // Business logic above is untouched; this only shapes it for the kit.
  // -----------------------------------------------------------------------

  // Honest history estimate for the 30-day trend gate: each historical point is
  // one monthly snapshot, so ~30 days of history per point we hold. With <2
  // points there's no line we can honestly draw.
  const historyDays = historicalData.length * 30

  const trendData = historicalData.map((p) => ({
    date: new Date(`${p.date}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    organicEtv: p.organicEtv,
    paidEtv: p.paidEtv,
    organicKeywords: p.organicKeywords,
  }))

  const distribution =
    rankHasData && rankData?.organic?.distribution
      ? rankData.organic.distribution
      : rankedKeywords.length > 0
        ? {
            pos_1: rankedKeywords.filter((kw) => kw.rank === 1).length,
            pos_2_3: rankedKeywords.filter((kw) => kw.rank >= 2 && kw.rank <= 3).length,
            pos_4_10: rankedKeywords.filter((kw) => kw.rank >= 4 && kw.rank <= 10).length,
            pos_11_20: rankedKeywords.filter((kw) => kw.rank >= 11 && kw.rank <= 20).length,
            pos_21_50: rankedKeywords.filter((kw) => kw.rank >= 21 && kw.rank <= 50).length,
            pos_51_100: rankedKeywords.filter((kw) => kw.rank >= 51 && kw.rank <= 100).length,
          }
        : null

  const keywordViews = rankedKeywords.map((kw) => ({
    keyword: kw.keyword,
    rank: kw.rank,
    searchVolume: kw.searchVolume,
    cpc: kw.cpc,
    competition: kw.competition,
    intent: kw.intent,
  }))

  const competitorViews = organicCompetitors.map((c) => ({
    domain: c.domain,
    intersections: c.intersections,
    organicKeywords: c.organicKeywords,
    organicEtv: c.organicEtv,
  }))

  const pageViews = relevantPages.map((p) => ({
    url: p.url,
    organicEtv: p.organicEtv,
    trafficShare: p.trafficShare,
  }))

  const subdomainViews = subdomains.map((s) => ({
    subdomain: s.subdomain,
    organicEtv: s.organicEtv,
    trafficShare: s.trafficShare,
  }))

  const gapViews = gapOpportunities.map((g) => ({
    keyword: g.keyword,
    domain2Rank: g.domain2Rank,
    searchVolume: g.searchVolume,
    cpc: g.cpc,
  }))

  const adViews = adCreatives.map((ad) => ({
    headline: ad.headline,
    description: ad.description,
    displayUrl: ad.displayUrl,
    domain: ad.domain,
    keyword: ad.keyword,
    position: ad.position,
  }))

  const paidOverlapViews = paidOverlap.map((r) => ({
    keyword: r.keyword,
    domain1Rank: r.domain1Rank,
    domain2Rank: r.domain2Rank,
    searchVolume: r.searchVolume,
    cpc: r.cpc,
  }))

  const refreshedLabel = lastRefreshed
    ? new Date(`${lastRefreshed}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null

  const organicEmpty = kpiSource === "none" && serpEntries.length === 0
  const paidEmpty = paidEtv === 0 && adCreatives.length === 0 && paidOverlap.length === 0

  // -----------------------------------------------------------------------
  // Render — The Pass
  // -----------------------------------------------------------------------

  return (
    <div className="pv-page tk-kit">
      <VisibilityTooltips />

      <div className="pv-page-head">
        <span className="pv-kicker">Local visibility</span>
        <h1 className="pv-h1">Where you show up</h1>
        <p className="pv-sub">
          How findable {locationDomain ? <b>{locationDomain}</b> : "your location"} is in local search —
          the keywords you win, where rivals out-rank you, and which searches you&apos;re missing.
        </p>
      </div>
      <TkRule />

      <div className="viz-body">
        {/* ── Control bar (location + organic/paid + refresh + freshness) ── */}
        <VisibilityControlBar
          locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
          selectedLocationId={selectedLocationId ?? ""}
          activeTab={activeTab}
          freshnessLabel={freshnessLabel}
        />

        {/* ── Status / notices ── */}
        {error && (
          <div className="viz-banner viz-banner-err" role="alert">
            {decodeURIComponent(error)}
          </div>
        )}
        {success && (
          <div className="viz-banner viz-banner-ok" role="status">
            {decodeURIComponent(success)}
          </div>
        )}
        {coverageHealth.visibility.unavailable && (
          <VendorUnavailableBanner source="Search visibility data" asOf={lastRefreshed} />
        )}
        {selectedLocation && !selectedLocation.website && (
          <div className="viz-banner viz-banner-warn" role="status">
            <span>
              <strong>No website yet.</strong> Hit “Refresh SEO” to auto-resolve it from your Google listing, or add a URL
              in <a href="/locations">Locations</a>.
            </span>
          </div>
        )}
        {locationDomain && (
          <div className="viz-domain-pill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
            </svg>
            <span>
              Tracking <b>{locationDomain}</b>
            </span>
            <a href="/locations">Change URL</a>
          </div>
        )}
        {refreshedLabel && (
          <div className="viz-refreshed">
            <span className="viz-dot" aria-hidden="true" />
            Last refreshed {refreshedLabel}
          </div>
        )}

        {/* ================================================================= */}
        {/* ORGANIC                                                            */}
        {/* ================================================================= */}
        {activeTab === "organic" &&
          (organicEmpty ? (
            <TkEmptyState
              title="No search data yet"
              description="Hit “Refresh SEO” above and we'll read how your location ranks across local search — keywords, rivals, and the searches you're missing."
            />
          ) : (
            <>
              {/* At-a-glance weighted widgets (honest, %-/est.-framed) */}
              <RevealOnView>
                <TkWidgetGrid>
                  <TkWidget
                    tone="rust"
                    size="wide"
                    label="Estimated organic reach"
                    value={organicEtv.toLocaleString()}
                    sub={kpiSource === "ranked_keywords" ? "est. clicks/mo · modeled from rank" : "est. clicks/mo"}
                    data-tip="Estimated monthly clicks from organic search, modeled from rank position and search volume"
                    data-tipv={`${organicEtv.toLocaleString()} est. clicks/mo`}
                    spark={
                      <svg viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true">
                        <path
                          d="M0 50 L30 46 L55 40 L75 18 L95 10 L120 22"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                        />
                      </svg>
                    }
                  />
                  <TkWidget
                    tone="teal"
                    label="Keywords you win"
                    value={organicKeywords.toLocaleString()}
                    sub={`${(trackedKwCount ?? 0).toLocaleString()} tracked`}
                    data-tip="Search terms your domain currently ranks for"
                    data-tipv={`${organicKeywords.toLocaleString()} ranked`}
                  />
                  <TkWidget
                    tone="slate"
                    label="Moving up / down"
                    value={`+${newKw} / -${lostKw}`}
                    sub={`${upKw} improved · ${downKw} slipped`}
                    data-tip="New vs lost keywords since the last read"
                    data-tipv={`+${newKw} new · -${lostKw} lost`}
                  />
                  <TkWidget
                    tone="gold"
                    label="Featured / local pack"
                    value={`${featuredSnippets} / ${localPackCount}`}
                    sub="rich-result placements"
                    data-tip="Featured snippets and local-pack placements you appear in"
                    data-tipv={`${featuredSnippets} featured · ${localPackCount} local pack`}
                  />
                  {trafficCost > 0 && (
                    <TkWidget
                      tone="slate"
                      label="Ad-equivalent value"
                      value={`$${trafficCost.toLocaleString()}`}
                      sub="what this reach would cost in ads · est."
                      data-tip="Estimated cost to buy your current organic search traffic via paid ads — not your revenue"
                      data-tipv={`~$${trafficCost.toLocaleString()}/mo in ad spend`}
                    />
                  )}
                </TkWidgetGrid>
              </RevealOnView>

              {/* Trend over time — gated <30 days with TkStillLearning */}
              <VisibilityTrend data={trendData} historyDays={historyDays} />

              {/* You vs your market (TkH2HBars) */}
              <VisibilityH2H
                yourEtv={organicEtv}
                yourKeywords={organicKeywords}
                competitors={competitorViews}
              />

              {/* Ranked keywords */}
              <VisibilityKeywords
                keywords={keywordViews}
                newCount={newKw}
                upCount={upKw}
                downCount={downKw}
              />

              {/* Intent + SERP features */}
              <RevealOnView>
                <TkSectionHead title="What you rank for" sub="Intent mix & rich-result placements" />
              </RevealOnView>
              <VisibilityIntentSerp intentData={intentData} serpFeatures={serpFeatures} />

              {/* Ranking distribution */}
              <VisibilityDistribution distribution={distribution} />

              {/* Top pages + subdomains */}
              <RevealOnView>
                <TkSectionHead title="What's pulling the traffic" sub="Your top pages & subdomains" />
              </RevealOnView>
              <VisibilityPages pages={pageViews} subdomains={subdomainViews} />

              {/* Keyword gap opportunities */}
              <VisibilityGaps gaps={gapViews} />
            </>
          ))}

        {/* ================================================================= */}
        {/* PAID                                                               */}
        {/* ================================================================= */}
        {activeTab === "paid" &&
          (paidEmpty ? (
            <TkEmptyState
              title="No paid advertising detected"
              description="No Google Ads activity found for this domain or its rivals — common for local businesses that lean on organic search."
            />
          ) : (
            <>
              <RevealOnView>
                <TkWidgetGrid>
                  <TkWidget
                    tone="rust"
                    size="wide"
                    label="Estimated paid reach"
                    value={paidEtv.toLocaleString()}
                    sub="est. visits/mo"
                    data-tip="Estimated monthly visits from paid search"
                    data-tipv={`${paidEtv.toLocaleString()} est. visits/mo`}
                  />
                  <TkWidget
                    tone="gold"
                    label="Paid keywords"
                    value={paidKeywords.toLocaleString()}
                    sub="terms bid on"
                    data-tip="Keywords this domain runs paid ads against"
                    data-tipv={`${paidKeywords.toLocaleString()} paid terms`}
                  />
                  <TkWidget
                    tone="slate"
                    label="Ad creatives seen"
                    value={String(adCreatives.length)}
                    sub="detected"
                    data-tip="Distinct competitor ad creatives we captured"
                    data-tipv={`${adCreatives.length} creatives`}
                  />
                  <TkWidget
                    tone="teal"
                    label="Shared paid terms"
                    value={String(paidOverlap.length)}
                    sub="you & a rival both bid"
                    data-tip="Keywords where you and a rival both run paid ads"
                    data-tipv={`${paidOverlap.length} overlapping`}
                  />
                </TkWidgetGrid>
              </RevealOnView>

              <VisibilityPaidOverlap rows={paidOverlapViews} />
              <VisibilityAds ads={adViews} />
            </>
          ))}
      </div>
    </div>
  )
}
