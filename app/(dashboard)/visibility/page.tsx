import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { getTierFromPriceId } from "@/lib/billing/tiers"
import { isSeoIntersectionEnabled, isSeoAdsEnabled } from "@/lib/billing/limits"
import { refreshSeoAction } from "./actions"
import VisibilityCharts from "@/components/visibility/visibility-charts"
import VisibilityFilters from "@/components/visibility/visibility-filters"
import type { DomainRankSnapshot, NormalizedRankedKeyword, SerpRankEntry, NormalizedIntersectionRow, NormalizedAdCreative } from "@/lib/seo/types"

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
  // Fetch SEO data from snapshots
  // -----------------------------------------------------------------------

  // Domain Rank Overview (location)
  const { data: rankSnap } = selectedLocationId
    ? await supabase
        .from("location_snapshots")
        .select("raw_data, date_key")
        .eq("location_id", selectedLocationId)
        .eq("provider", "seo_domain_rank_overview")
        .order("date_key", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  const rankData = rankSnap?.raw_data as DomainRankSnapshot | null

  // Ranked Keywords
  const { data: kwSnap } = selectedLocationId
    ? await supabase
        .from("location_snapshots")
        .select("raw_data, date_key")
        .eq("location_id", selectedLocationId)
        .eq("provider", "seo_ranked_keywords")
        .order("date_key", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  const rankedKeywords = ((kwSnap?.raw_data as Record<string, unknown>)?.keywords ?? []) as NormalizedRankedKeyword[]

  // Determine last refreshed date from any available snapshot
  const lastRefreshed = rankSnap?.date_key ?? kwSnap?.date_key ?? null

  // SERP entries
  const { data: serpSnap } = selectedLocationId
    ? await supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", selectedLocationId)
        .eq("provider", "seo_serp_keywords")
        .order("date_key", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  const serpEntries = ((serpSnap?.raw_data as Record<string, unknown>)?.entries ?? []) as SerpRankEntry[]

  // Tracked keywords count
  const { count: trackedKwCount } = selectedLocationId
    ? await supabase
        .from("tracked_keywords")
        .select("id", { count: "exact", head: true })
        .eq("location_id", selectedLocationId)
        .eq("is_active", true)
    : { count: 0 }

  // Competitor rank snapshots
  const { data: compSnapshots } = selectedLocationId
    ? await supabase
        .from("competitors")
        .select("id, name, website")
        .eq("location_id", selectedLocationId)
        .eq("is_active", true)
    : { data: [] }

  // Domain Intersection rows (most recent)
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

  // Ad creatives
  let adCreatives: NormalizedAdCreative[] = []
  if (isSeoAdsEnabled(tier) && selectedLocationId) {
    const { data: adSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", selectedLocationId)
      .eq("provider", "seo_ads_search")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    adCreatives = ((adSnap?.raw_data as Record<string, unknown>)?.creatives ?? []) as NormalizedAdCreative[]
  }

  // -----------------------------------------------------------------------
  // Compute KPIs – prefer Domain Rank Overview, fall back to ranked keywords
  // -----------------------------------------------------------------------

  let organicEtv: number
  let organicKeywords: number
  let top3: number
  let top10: number
  let kpiSource: "rank_overview" | "ranked_keywords" | "none"

  if (rankData) {
    kpiSource = "rank_overview"
    organicEtv = rankData.organic?.etv ?? 0
    organicKeywords = rankData.organic?.rankedKeywords ?? 0
    top3 = rankData.organic?.distribution?.pos_1
      ? (rankData.organic.distribution.pos_1 + rankData.organic.distribution.pos_2_3)
      : 0
    top10 = top3 + (rankData.organic?.distribution?.pos_4_10 ?? 0)
  } else if (rankedKeywords.length > 0) {
    // Fallback: compute from individual ranked keyword entries
    kpiSource = "ranked_keywords"
    organicKeywords = rankedKeywords.length
    top3 = rankedKeywords.filter((kw) => kw.rank <= 3).length
    top10 = rankedKeywords.filter((kw) => kw.rank <= 10).length
    // ETV is not available from ranked keywords alone – sum search volume as proxy
    organicEtv = rankedKeywords.reduce((sum, kw) => sum + (kw.searchVolume ?? 0), 0)
  } else {
    kpiSource = "none"
    organicEtv = 0
    organicKeywords = 0
    top3 = 0
    top10 = 0
  }

  const paidEtv = rankData?.paid?.etv ?? 0
  const paidKeywords = rankData?.paid?.rankedKeywords ?? 0

  // Share of Voice from SERP entries
  const locationDomain = selectedLocation?.website
    ? (() => {
        try { return new URL(selectedLocation.website.startsWith("http") ? selectedLocation.website : `https://${selectedLocation.website}`).hostname.replace(/^www\./, "") }
        catch { return null }
      })()
    : null

  const sovData: Array<{ name: string; value: number }> = []
  if (serpEntries.length > 0) {
    const domainCounts = new Map<string, number>()
    for (const entry of serpEntries) {
      for (const [domain, rank] of Object.entries(entry.positions)) {
        if (rank !== null && rank <= 10) {
          domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
        }
      }
    }
    for (const [domain, count] of domainCounts) {
      sovData.push({ name: domain, value: count })
    }
    sovData.sort((a, b) => b.value - a.value)
  }

  // Top movers (keyword rank changes vs previous)
  const { data: prevSerpSnapRows } = selectedLocationId
    ? await supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", selectedLocationId)
        .eq("provider", "seo_serp_keywords")
        .order("date_key", { ascending: false })
        .range(1, 1)
    : { data: null }
  const prevSerpSnap = prevSerpSnapRows?.[0] ?? null
  const prevSerpEntries = ((prevSerpSnap?.raw_data as Record<string, unknown>)?.entries ?? []) as SerpRankEntry[]
  const prevSerpMap = new Map(prevSerpEntries.map((e) => [e.keyword, e]))

  type TopMover = { keyword: string; yourRank: number | null; bestCompRank: number | null; delta: number | null; volume: number | null }
  const topMovers: TopMover[] = []
  if (locationDomain) {
    for (const entry of serpEntries) {
      const prev = prevSerpMap.get(entry.keyword)
      const curRank = entry.positions[locationDomain] ?? null
      const prevRank = prev?.positions[locationDomain] ?? null
      const delta = curRank !== null && prevRank !== null ? prevRank - curRank : null
      const compRanks = Object.entries(entry.positions)
        .filter(([d]) => d !== locationDomain)
        .map(([, r]) => r)
        .filter((r): r is number => r !== null)
      const bestCompRank = compRanks.length > 0 ? Math.min(...compRanks) : null
      topMovers.push({ keyword: entry.keyword, yourRank: curRank, bestCompRank, delta, volume: entry.searchVolume })
    }
    topMovers.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
  }

  // Gap opportunities
  const gapOpportunities = intersectionRows
    .filter((r) => r.gapType === "loss" && (r.searchVolume ?? 0) > 0)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 20)

  // Paid overlap
  const paidOverlap = intersectionRows
    .filter((r) => r.gapType === "shared" && r.domain1Rank !== null && r.domain2Rank !== null)
    .slice(0, 20)

  // Freshness label
  const freshnessLabel = tier === "free" || tier === "starter" ? "Weekly refresh" : "Daily refresh available"

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Search Visibility</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Organic + paid search performance for your location vs competitors.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
              {freshnessLabel}
            </span>
            {selectedLocationId && (
              <form action={refreshSeoAction}>
                <input type="hidden" name="location_id" value={selectedLocationId} />
                <button type="submit" className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                  Refresh SEO
                </button>
              </form>
            )}
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

        {/* Location + Tab selectors -- auto-navigates on change */}
        <VisibilityFilters
          locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
          selectedLocationId={selectedLocationId ?? ""}
          activeTab={activeTab}
        />
      </div>

      {/* Missing website warning */}
      {selectedLocation && !selectedLocation.website && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>No website configured.</strong> Add a website URL to &quot;{selectedLocation.name}&quot; in{" "}
          <a href="/locations" className="underline hover:text-amber-900">Locations</a>{" "}
          to enable full domain-level SEO tracking. Competitor domains with websites will still be analyzed.
        </div>
      )}

      {/* Last refreshed */}
      {lastRefreshed && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Last refreshed: {new Date(lastRefreshed + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          {selectedLocation?.website && (
            <span className="ml-2 text-slate-400">
              Domain: <strong className="text-slate-600">{locationDomain ?? selectedLocation.website}</strong>
            </span>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* ORGANIC TAB */}
      {/* ================================================================= */}
      {activeTab === "organic" && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={kpiSource === "ranked_keywords" ? "Total Search Volume" : "Est. Organic Traffic"}
              value={organicEtv.toLocaleString()}
              sub={kpiSource === "ranked_keywords" ? "from ranked keywords" : "monthly visits"}
              accent="indigo"
            />
            <KpiCard label="Ranking Keywords" value={organicKeywords.toLocaleString()} sub={`${trackedKwCount ?? 0} tracked`} accent="violet" />
            <KpiCard label="Top 3 Keywords" value={String(top3)} accent="emerald" />
            <KpiCard label="Top 10 Keywords" value={String(top10)} accent="sky" />
          </div>

          {kpiSource === "ranked_keywords" && (
            <p className="text-xs text-amber-600">
              KPIs are estimated from ranked keyword data. Full domain-level traffic estimates will be available after domain rank overview data is collected.
            </p>
          )}

          {/* Charts (client component) */}
          <VisibilityCharts
            sovData={sovData}
            locationDomain={locationDomain}
          />

          {/* Top Movers table */}
          {topMovers.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Top Movers</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400">
                      <th className="py-2 pr-4 font-medium">Keyword</th>
                      <th className="py-2 pr-4 font-medium">Your Rank</th>
                      <th className="py-2 pr-4 font-medium">Best Competitor</th>
                      <th className="py-2 pr-4 font-medium">Change</th>
                      <th className="py-2 font-medium">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMovers.slice(0, 20).map((m) => (
                      <tr key={m.keyword} className="border-b border-slate-50">
                        <td className="py-2 pr-4 font-medium text-slate-700">{m.keyword}</td>
                        <td className="py-2 pr-4 text-slate-600">{m.yourRank ?? "—"}</td>
                        <td className="py-2 pr-4 text-slate-600">{m.bestCompRank ?? "—"}</td>
                        <td className="py-2 pr-4">
                          {m.delta !== null ? (
                            <span className={m.delta > 0 ? "font-semibold text-emerald-600" : m.delta < 0 ? "font-semibold text-rose-600" : "text-slate-400"}>
                              {m.delta > 0 ? `+${m.delta}` : m.delta === 0 ? "—" : String(m.delta)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 text-slate-500">{m.volume?.toLocaleString() ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Keyword Gap Opportunities */}
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

          {/* Ranked keywords list */}
          {rankedKeywords.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Top Ranked Keywords ({rankedKeywords.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400">
                      <th className="py-2 pr-4 font-medium">Keyword</th>
                      <th className="py-2 pr-4 font-medium">Rank</th>
                      <th className="py-2 pr-4 font-medium">Volume</th>
                      <th className="py-2 pr-4 font-medium">CPC</th>
                      <th className="py-2 font-medium">Competition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedKeywords.slice(0, 25).map((kw) => (
                      <tr key={kw.keyword} className="border-b border-slate-50">
                        <td className="py-2 pr-4 font-medium text-slate-700">{kw.keyword}</td>
                        <td className="py-2 pr-4 text-slate-600">#{kw.rank}</td>
                        <td className="py-2 pr-4 text-slate-600">{kw.searchVolume?.toLocaleString() ?? "—"}</td>
                        <td className="py-2 pr-4 text-slate-500">{kw.cpc ? `$${kw.cpc.toFixed(2)}` : "—"}</td>
                        <td className="py-2 text-slate-500">{kw.competitionLevel ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty state */}
          {kpiSource === "none" && serpEntries.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm text-slate-500">
                No SEO data yet. Click &quot;Refresh SEO&quot; to fetch search visibility data.
                {!selectedLocation?.website && (
                  <span className="mt-1 block text-amber-600">
                    Tip: Add a website URL to your location in Settings to enable domain-level SEO tracking.
                  </span>
                )}
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
                        <p className="text-sm font-semibold text-indigo-700">
                          {ad.headline ?? "Ad creative"}
                        </p>
                        {ad.description && (
                          <p className="mt-0.5 text-xs text-slate-600">{ad.description}</p>
                        )}
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
              <p className="text-sm text-slate-500">
                {isSeoAdsEnabled(tier)
                  ? "No paid search data yet. Click \"Refresh SEO\" to fetch ad data."
                  : "Paid search intelligence is available on Pro and Agency tiers."}
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

function KpiCard({ label, value, sub, accent }: {
  label: string
  value: string
  sub?: string
  accent: string
}) {
  const colorMap: Record<string, string> = {
    indigo: "border-l-indigo-500 bg-indigo-50/30",
    violet: "border-l-violet-500 bg-violet-50/30",
    emerald: "border-l-emerald-500 bg-emerald-50/30",
    sky: "border-l-sky-500 bg-sky-50/30",
    amber: "border-l-amber-500 bg-amber-50/30",
    orange: "border-l-orange-500 bg-orange-50/30",
    rose: "border-l-rose-500 bg-rose-50/30",
  }
  const cls = colorMap[accent] ?? colorMap.indigo

  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${cls} p-4 shadow-sm`}>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}
