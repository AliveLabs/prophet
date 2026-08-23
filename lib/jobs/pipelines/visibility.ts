// ---------------------------------------------------------------------------
// Visibility (SEO) Pipeline – step definitions
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { asSubscriptionTier, type SubscriptionTier } from "@/lib/billing/tiers"
import {
  getSeoRankedKeywordsLimit,
  getSeoTrackedKeywordsLimit,
  isSeoIntersectionEnabled,
  getSeoIntersectionLimit,
  isSeoAdsEnabled,
} from "@/lib/billing/limits"
import { fetchPlaceDetails } from "@/lib/places/google"
import { fetchDomainRankOverview } from "@/lib/providers/dataforseo/domain-rank-overview"
import { fetchRankedKeywords } from "@/lib/providers/dataforseo/ranked-keywords"
import { fetchKeywordsForSite } from "@/lib/providers/dataforseo/keywords-for-site"
import { fetchCompetitorsDomain } from "@/lib/providers/dataforseo/competitors-domain"
import { fetchDomainIntersection } from "@/lib/providers/dataforseo/domain-intersection"
import { fetchSerpOrganic } from "@/lib/providers/dataforseo/serp-organic"
import { fetchAdsSearch } from "@/lib/providers/dataforseo/ads-search"
import { fetchRelevantPages } from "@/lib/providers/dataforseo/relevant-pages"
import { fetchSubdomains } from "@/lib/providers/dataforseo/subdomains"
import { fetchHistoricalRankOverview } from "@/lib/providers/dataforseo/historical-rank-overview"
import {
  buildLocationName,
  withLocationScope,
  LOCATION_CODE_US,
  type LocationArg,
  type LocationScope,
} from "@/lib/providers/dataforseo/location-scope"
import { DataForSEOError } from "@/lib/providers/dataforseo/client"
import {
  normalizeDomainRankOverview,
  normalizeRankedKeywords,
  normalizeKeywordsForSite,
  normalizeSerpOrganic,
  normalizeDomainIntersection,
  normalizeAdsSearch,
  normalizeCompetitorsDomain,
  normalizeRelevantPages,
  normalizeSubdomains,
  normalizeHistoricalRankOverview,
} from "@/lib/seo/normalize"
import {
  hashDomainRankSnapshot,
  hashRankedKeywords,
  hashSerpRanks,
  hashJsonPayload,
} from "@/lib/seo/hash"
import { generateSeoInsights, type SeoInsightContext } from "@/lib/seo/insights"
import { SEO_SNAPSHOT_TYPES } from "@/lib/seo/types"
import type {
  DomainRankSnapshot,
  NormalizedRankedKeyword,
  SerpRankEntry,
  NormalizedIntersectionRow,
  NormalizedAdCreative,
  NormalizedRelevantPage,
  HistoricalTrafficPoint,
} from "@/lib/seo/types"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type VisibilityPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  tier: SubscriptionTier
  location: {
    id: string
    name: string | null
    website: string | null
    primary_place_id: string | null
    // ALT-636: needed to ask DataForSEO about THIS market rather than about the United States.
    city: string | null
    region: string | null
    country: string | null
  }
  locationDomain: string | null
  seedDomain: string | null
  allDomains: string[]
  dateKey: string
  competitors: Array<{
    id: string
    name: string | null
    website: string | null
    domain: string
  }>
  state: {
    /** ALT-636: the location argument every SEO call in THIS run uses, learned once. See seoCall(). */
    locationArg?: LocationArg
    /** Which market the run's numbers describe. Stamped onto every snapshot this run writes. */
    locationScope?: LocationScope
    locationRankSnapshot: DomainRankSnapshot | null
    currentKeywords: NormalizedRankedKeyword[]
    serpEntries: SerpRankEntry[]
    intersectionRows: NormalizedIntersectionRow[]
    adCreatives: NormalizedAdCreative[]
    warnings: string[]
  }
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function getPreviousDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

// ── ALT-636: ask about the location's market, once per run ───────────────────
//
// Every SEO fetch used to send DataForSEO's default `location_code: 2840`, the whole United States,
// so "local search visibility" was national data by construction. These calls now carry the
// location's own `location_name`.
//
// WHY THIS IS MEMOISED rather than each call falling back on its own. DataForSEO rejects some real
// place names with status 40501 ("McKinney,Texas,United States" is refused while Forney and
// Arlington are accepted), and this pipeline makes 13 calls. Falling back per call would DOUBLE the
// request count on exactly the locations that are already failing, on our largest vendor line. So
// the first call learns the answer and the remaining twelve reuse it.
//
// The learned value lives on `c.state`, which is per-run, so a location whose name starts working
// picks it up on the next run rather than being stuck.
async function seoCall<T>(
  c: VisibilityPipelineCtx,
  call: (arg: LocationArg) => Promise<T>,
): Promise<T> {
  if (c.state.locationArg) return call(c.state.locationArg)

  const name = buildLocationName(c.location)
  const { result, scope } = await withLocationScope(name, call)
  c.state.locationArg =
    scope === "local" && name ? { locationName: name } : { locationCode: LOCATION_CODE_US }
  c.state.locationScope = scope
  // Logged once per run, on both branches. Bryan accepted one week of broken week-over-week deltas
  // when this shipped (the numbers change because the QUESTION changed, not because rankings moved),
  // so what matters is being able to say later exactly which runs were national and which were not.
  // This line plus the deploy date is enough to explain any discontinuity in the history without
  // having to stamp all thirteen snapshot rows.
  console.log(
    `[visibility] location ${c.locationId} SEO scope=${scope}` +
      (scope === "local" ? ` (${name})` : " (US-national)"),
  )
  return result
}

/** The scope to stamp on a snapshot. Defaults to national: if no SEO call has resolved yet, the
 *  provider default is what would have been used, and recording the optimistic value would be a
 *  claim we have not earned. */
function scopeOf(c: VisibilityPipelineCtx): LocationScope {
  return c.state.locationScope ?? "national"
}

export function buildVisibilitySteps(): PipelineStepDef<VisibilityPipelineCtx>[] {
  const steps: PipelineStepDef<VisibilityPipelineCtx>[] = [
    {
      name: "domain_rank",
      label: "Fetching domain rank overview",
      run: async (c) => {
        let count = 0
        for (const domain of c.allDomains) {
          const result = await seoCall(c, (loc) => fetchDomainRankOverview({ target: domain, ...loc }))
          if (!result) continue
          count++
          const normalized = normalizeDomainRankOverview(result, domain)
          const diffHash = hashDomainRankSnapshot(normalized)

          if (domain === c.locationDomain) {
            c.state.locationRankSnapshot = normalized
            await c.supabase.from("location_snapshots").upsert(
              {
                location_id: c.locationId,
                provider: "seo_domain_rank_overview",
                date_key: c.dateKey,
                captured_at: new Date().toISOString(),
                raw_data: normalized as unknown as Record<string, unknown>,
                diff_hash: diffHash,
              },
              { onConflict: "location_id,provider,date_key" }
            )
          } else {
            const comp = c.competitors.find((cm) => cm.domain === domain)
            if (comp) {
              await c.supabase.from("snapshots").upsert(
                {
                  competitor_id: comp.id,
                  captured_at: new Date().toISOString(),
                  date_key: c.dateKey,
                  provider: "dataforseo_labs",
                  snapshot_type: SEO_SNAPSHOT_TYPES.domainRankOverview,
                  raw_data: normalized as unknown as Record<string, unknown>,
                  diff_hash: diffHash,
                },
                { onConflict: "competitor_id,date_key,snapshot_type" }
              )
            }
          }
        }
        return { domainsAnalyzed: count }
      },
    },
    {
      name: "ranked_keywords",
      label: "Analyzing ranked keywords",
      run: async (c) => {
        // ALT-708: `seedDomain` falls back to the FIRST COMPETITOR'S domain when the location has
        // no website of its own (see visibility/actions.ts: `locationDomain ?? compDomains[0]?.domain`).
        // That fallback is right for its actual job, seeding competitor DISCOVERY with "find domains
        // like this one". It is wrong here: ranked keywords fetched for a competitor's domain were
        // stored and rendered as the operator's own, so a website-less restaurant was shown a rival's
        // search performance under "Keywords you win".
        //
        // Own-domain only. No website means we have nothing true to say about their search
        // visibility, and saying nothing is the correct output.
        const rkDomain = c.locationDomain
        if (!rkDomain) return { keywords: 0, skipped: "location has no website of its own" }

        const rkResult = await seoCall(c, (loc) => fetchRankedKeywords({
          target: rkDomain,
          limit: getSeoRankedKeywordsLimit(c.tier),
          ...loc,
        }))
        if (!rkResult) return { keywords: 0 }

        c.state.currentKeywords = normalizeRankedKeywords(rkResult)
        const diffHash = hashRankedKeywords(c.state.currentKeywords)
        await c.supabase.from("location_snapshots").upsert(
          {
            location_id: c.locationId,
            provider: "seo_ranked_keywords",
            date_key: c.dateKey,
            captured_at: new Date().toISOString(),
            raw_data: {
              version: "1.0",
              domain: rkDomain,
              keywords: c.state.currentKeywords,
            } as unknown as Record<string, unknown>,
            diff_hash: diffHash,
          },
          { onConflict: "location_id,provider,date_key" }
        )
        return { keywords: c.state.currentKeywords.length }
      },
    },
    {
      name: "keyword_seeding",
      label: "Seeding tracked keywords",
      run: async (c) => {
        const { data: existingKws } = await c.supabase
          .from("tracked_keywords")
          .select("id")
          .eq("location_id", c.locationId)
          .limit(1)

        if ((existingKws?.length ?? 0) > 0) return { status: "already seeded" }

        if (!c.seedDomain) return { status: "no seed domain" }
        const seed = c.seedDomain

        const kfsResult = await seoCall(c, (loc) => fetchKeywordsForSite({
          target: seed,
          limit: getSeoTrackedKeywordsLimit(c.tier),
          ...loc,
        }))
        if (!kfsResult) return { seeded: 0 }

        const candidates = normalizeKeywordsForSite(kfsResult)
        const kwRows = candidates
          .filter((k) => k.keyword)
          .slice(0, getSeoTrackedKeywordsLimit(c.tier))
          .map((k) => ({
            location_id: c.locationId,
            keyword: k.keyword,
            source: "auto" as const,
            tags: { searchVolume: k.searchVolume, cpc: k.cpc },
          }))

        if (kwRows.length > 0) {
          await c.supabase
            .from("tracked_keywords")
            .upsert(kwRows, { onConflict: "location_id,keyword" })
        }
        return { seeded: kwRows.length }
      },
    },
    {
      name: "competitor_discovery",
      label: "Discovering organic competitors",
      run: async (c) => {
        if (!c.seedDomain) return { competitors: 0 }
        const seed = c.seedDomain

        const cdResult = await seoCall(c, (loc) => fetchCompetitorsDomain({
          target: seed,
          limit: 10,
          ...loc,
        }))
        if (!cdResult) return { competitors: 0 }

        const normalizedComps = normalizeCompetitorsDomain(cdResult)
        await c.supabase.from("location_snapshots").upsert(
          {
            location_id: c.locationId,
            provider: "seo_competitors_domain",
            date_key: c.dateKey,
            captured_at: new Date().toISOString(),
            raw_data: {
              version: "1.0",
              domain: c.seedDomain,
              competitors: normalizedComps,
            } as unknown as Record<string, unknown>,
            diff_hash: hashJsonPayload(normalizedComps),
          },
          { onConflict: "location_id,provider,date_key" }
        )
        return { competitors: normalizedComps.length }
      },
    },
    {
      name: "serp_tracking",
      label: "Tracking SERP positions",
      run: async (c) => {
        const { data: trackedKws } = await c.supabase
          .from("tracked_keywords")
          .select("keyword")
          .eq("location_id", c.locationId)
          .eq("is_active", true)
          .limit(getSeoTrackedKeywordsLimit(c.tier))

        for (const kw of trackedKws ?? []) {
          try {
            const serpResult = await seoCall(c, (loc) => fetchSerpOrganic({ keyword: kw.keyword, ...loc }))
            if (serpResult) {
              c.state.serpEntries.push(
                normalizeSerpOrganic(serpResult, kw.keyword, c.allDomains)
              )
            }
          } catch (e) {
            // A payment/credit outage is account-level → propagate so the worker stamps vendor health.
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            /* continue */
          }
        }

        if (c.state.serpEntries.length > 0) {
          await c.supabase.from("location_snapshots").upsert(
            {
              location_id: c.locationId,
              provider: "seo_serp_keywords",
              date_key: c.dateKey,
              captured_at: new Date().toISOString(),
              raw_data: {
                version: "1.0",
                entries: c.state.serpEntries,
              } as unknown as Record<string, unknown>,
              diff_hash: hashSerpRanks(c.state.serpEntries),
            },
            { onConflict: "location_id,provider,date_key" }
          )
        }
        return { keywords: c.state.serpEntries.length }
      },
    },
    {
      name: "domain_intersection",
      label: "Analyzing keyword overlap with competitors",
      run: async (c) => {
        if (!isSeoIntersectionEnabled(c.tier) || !c.locationDomain)
          return { status: "skipped" }

        const limit = getSeoIntersectionLimit(c.tier)
        // Hoisted past the guard above: the seoCall closure cannot carry the narrowing.
        const ownDomain = c.locationDomain
        let total = 0
        for (const comp of c.competitors.slice(0, 5)) {
          try {
            const diResult = await seoCall(c, (loc) => fetchDomainIntersection({
              target1: ownDomain,
              target2: comp.domain,
              limit,
              ...loc,
            }))
            if (diResult) {
              const normalized = normalizeDomainIntersection(diResult)
              c.state.intersectionRows.push(...normalized)
              total += normalized.length
              await c.supabase.from("snapshots").upsert(
                {
                  competitor_id: comp.id,
                  captured_at: new Date().toISOString(),
                  date_key: c.dateKey,
                  provider: "dataforseo_labs",
                  snapshot_type: SEO_SNAPSHOT_TYPES.domainIntersection,
                  raw_data: {
                    version: "1.0",
                    rows: normalized,
                  } as unknown as Record<string, unknown>,
                  diff_hash: hashJsonPayload(normalized),
                },
                { onConflict: "competitor_id,date_key,snapshot_type" }
              )
            }
          } catch (e) {
            // A payment/credit outage is account-level → propagate so the worker stamps vendor health.
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            /* continue */
          }
        }
        return { sharedKeywords: total }
      },
    },
    {
      name: "ads_search",
      label: "Fetching ad intelligence",
      run: async (c) => {
        if (!isSeoAdsEnabled(c.tier)) return { status: "skipped" }

        // ALT-721: `allDomains` includes the OPERATOR'S OWN domain, and every creative landed in
        // one bucket that /visibility renders as "Competitor ad creatives: live ad copy your rivals
        // are running". So an operator was shown their own ads as a rival's. The rank-overview step
        // above already distinguishes the own domain (`domain === c.locationDomain`); this step just
        // never did.
        //
        // Skipping it rather than tagging and filtering downstream: this surface is competitor-only,
        // and the own domain was also costing a paid vendor call per run to populate a bucket
        // nothing should have shown it in. If "your own ads" ever becomes a surface, it gets its own
        // fetch and its own label.
        const competitorDomains = c.allDomains.filter((d) => d !== c.locationDomain)
        for (const domain of competitorDomains.slice(0, 5)) {
          try {
            const adsResult = await seoCall(c, (loc) => fetchAdsSearch({ target: domain, ...loc }))
            if (adsResult) {
              c.state.adCreatives.push(...normalizeAdsSearch(adsResult, domain))
            }
          } catch (e) {
            // A payment/credit outage is account-level → propagate so the worker stamps vendor health.
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            /* continue */
          }
        }

        if (c.state.adCreatives.length > 0) {
          await c.supabase.from("location_snapshots").upsert(
            {
              location_id: c.locationId,
              provider: "seo_ads_search",
              date_key: c.dateKey,
              captured_at: new Date().toISOString(),
              raw_data: {
                version: "1.0",
                creatives: c.state.adCreatives,
              } as unknown as Record<string, unknown>,
              diff_hash: hashJsonPayload(c.state.adCreatives),
            },
            { onConflict: "location_id,provider,date_key" }
          )
        }
        return { adCreatives: c.state.adCreatives.length }
      },
    },
    {
      name: "pages_subdomains_history",
      label: "Collecting pages, subdomains & history",
      run: async (c) => {
        const preview: Record<string, unknown> = {}

        // Relevant pages
        if (c.locationDomain) {
          const ownDomain = c.locationDomain
          try {
            const rpResult = await seoCall(c, (loc) => fetchRelevantPages({
              target: ownDomain,
              limit: 25,
              ...loc,
            }))
            if (rpResult) {
              const normalizedPages = normalizeRelevantPages(rpResult)
              preview.pages = normalizedPages.length
              await c.supabase.from("location_snapshots").upsert(
                {
                  location_id: c.locationId,
                  provider: "seo_relevant_pages",
                  date_key: c.dateKey,
                  captured_at: new Date().toISOString(),
                  raw_data: {
                    version: "1.0",
                    pages: normalizedPages,
                  } as unknown as Record<string, unknown>,
                  diff_hash: hashJsonPayload(normalizedPages),
                },
                { onConflict: "location_id,provider,date_key" }
              )
            }
          } catch (e) {
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            c.state.warnings.push("Relevant pages failed")
          }
        }

        // Subdomains
        if (c.locationDomain) {
          // Hoisted: inside the seoCall closure TypeScript cannot keep the narrowing from the
          // enclosing `if`, since the closure could in principle run later.
          const ownDomain = c.locationDomain
          try {
            const sdResult = await seoCall(c, (loc) => fetchSubdomains({
              target: ownDomain,
              limit: 10,
              ...loc,
            }))
            if (sdResult) {
              const normalizedSubs = normalizeSubdomains(sdResult)
              preview.subdomains = normalizedSubs.length
              await c.supabase.from("location_snapshots").upsert(
                {
                  location_id: c.locationId,
                  provider: "seo_subdomains",
                  date_key: c.dateKey,
                  captured_at: new Date().toISOString(),
                  raw_data: {
                    version: "1.0",
                    subdomains: normalizedSubs,
                  } as unknown as Record<string, unknown>,
                  diff_hash: hashJsonPayload(normalizedSubs),
                },
                { onConflict: "location_id,provider,date_key" }
              )
            }
          } catch (e) {
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            c.state.warnings.push("Subdomains failed")
          }
        }

        // Historical rank
        if (c.locationDomain) {
          const ownDomain = c.locationDomain
          try {
            const hrResult = await seoCall(c, (loc) => fetchHistoricalRankOverview({
              target: ownDomain,
              ...loc,
            }))
            if (hrResult) {
              const normalizedHistory = normalizeHistoricalRankOverview(hrResult)
              preview.historyMonths = normalizedHistory.length
              await c.supabase.from("location_snapshots").upsert(
                {
                  location_id: c.locationId,
                  provider: "seo_historical_rank",
                  date_key: c.dateKey,
                  captured_at: new Date().toISOString(),
                  raw_data: {
                    version: "1.0",
                    history: normalizedHistory,
                  } as unknown as Record<string, unknown>,
                  diff_hash: hashJsonPayload(normalizedHistory),
                },
                { onConflict: "location_id,provider,date_key" }
              )
            }
          } catch (e) {
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            c.state.warnings.push("Historical rank failed")
          }
        }

        return preview
      },
    },
    {
      name: "competitor_seo_data",
      label: "Collecting competitor SEO data",
      run: async (c) => {
        let total = 0
        const rkLimit = getSeoRankedKeywordsLimit(c.tier)
        for (const comp of c.competitors) {
          try {
            const rkResult = await seoCall(c, (loc) => fetchRankedKeywords({
              target: comp.domain,
              limit: rkLimit,
              ...loc,
            }))
            if (rkResult) {
              const normalized = normalizeRankedKeywords(rkResult)
              total += normalized.length
              await c.supabase.from("snapshots").upsert(
                {
                  competitor_id: comp.id,
                  captured_at: new Date().toISOString(),
                  date_key: c.dateKey,
                  provider: "dataforseo_labs",
                  snapshot_type: SEO_SNAPSHOT_TYPES.rankedKeywords,
                  raw_data: {
                    version: "1.0",
                    domain: comp.domain,
                    keywords: normalized,
                  } as unknown as Record<string, unknown>,
                  diff_hash: hashRankedKeywords(normalized),
                },
                { onConflict: "competitor_id,date_key,snapshot_type" }
              )
            }
          } catch (e) {
            // A payment/credit outage is account-level → propagate so the worker stamps vendor health.
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            /* continue */
          }

          try {
            const rpResult = await seoCall(c, (loc) => fetchRelevantPages({
              target: comp.domain,
              limit: 25,
              ...loc,
            }))
            if (rpResult) {
              const normalized = normalizeRelevantPages(rpResult)
              await c.supabase.from("snapshots").upsert(
                {
                  competitor_id: comp.id,
                  captured_at: new Date().toISOString(),
                  date_key: c.dateKey,
                  provider: "dataforseo_labs",
                  snapshot_type: SEO_SNAPSHOT_TYPES.relevantPages,
                  raw_data: {
                    version: "1.0",
                    domain: comp.domain,
                    pages: normalized,
                  } as unknown as Record<string, unknown>,
                  diff_hash: hashJsonPayload(normalized),
                },
                { onConflict: "competitor_id,date_key,snapshot_type" }
              )
            }
          } catch (e) {
            // A payment/credit outage is account-level → propagate so the worker stamps vendor health.
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            /* continue */
          }

          try {
            const hrResult = await seoCall(c, (loc) => fetchHistoricalRankOverview({
              target: comp.domain,
              ...loc,
            }))
            if (hrResult) {
              const normalized = normalizeHistoricalRankOverview(hrResult)
              await c.supabase.from("snapshots").upsert(
                {
                  competitor_id: comp.id,
                  captured_at: new Date().toISOString(),
                  date_key: c.dateKey,
                  provider: "dataforseo_labs",
                  snapshot_type: SEO_SNAPSHOT_TYPES.historicalRank,
                  raw_data: {
                    version: "1.0",
                    domain: comp.domain,
                    history: normalized,
                  } as unknown as Record<string, unknown>,
                  diff_hash: hashJsonPayload(normalized),
                },
                { onConflict: "competitor_id,date_key,snapshot_type" }
              )
            }
          } catch (e) {
            // A payment/credit outage is account-level → propagate so the worker stamps vendor health.
            if (e instanceof DataForSEOError && e.isPaymentRequired) throw e
            /* continue */
          }
        }
        return { competitorKeywords: total }
      },
    },
    {
      name: "seo_insights",
      label: "Generating SEO insights",
      run: async (c) => {
        const prevDateKey = getPreviousDateKey(c.dateKey, 7)

        const { data: prevRankSnap } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "seo_domain_rank_overview")
          .eq("date_key", prevDateKey)
          .maybeSingle()
        const previousRank = prevRankSnap?.raw_data as DomainRankSnapshot | null

        const { data: prevKwSnap } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "seo_ranked_keywords")
          .eq("date_key", prevDateKey)
          .maybeSingle()
        const previousKeywords =
          ((prevKwSnap?.raw_data as Record<string, unknown>)
            ?.keywords as NormalizedRankedKeyword[]) ?? []

        const { data: prevSerpSnap } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "seo_serp_keywords")
          .eq("date_key", prevDateKey)
          .maybeSingle()
        const previousSerpEntries =
          ((prevSerpSnap?.raw_data as Record<string, unknown>)
            ?.entries as SerpRankEntry[]) ?? []

        const { data: prevAdsSnap } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "seo_ads_search")
          .eq("date_key", prevDateKey)
          .maybeSingle()
        const previousAdCreatives =
          ((prevAdsSnap?.raw_data as Record<string, unknown>)
            ?.creatives as NormalizedAdCreative[]) ?? []

        const { data: prevPagesSnap } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "seo_relevant_pages")
          .eq("date_key", prevDateKey)
          .maybeSingle()
        const previousPages =
          ((prevPagesSnap?.raw_data as Record<string, unknown>)
            ?.pages as NormalizedRelevantPage[]) ?? []

        const { data: curPagesSnap } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "seo_relevant_pages")
          .eq("date_key", c.dateKey)
          .maybeSingle()
        const currentPages =
          ((curPagesSnap?.raw_data as Record<string, unknown>)
            ?.pages as NormalizedRelevantPage[]) ?? []

        const { data: hrSnap } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "seo_historical_rank")
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()
        const historicalTraffic =
          ((hrSnap?.raw_data as Record<string, unknown>)
            ?.history as HistoricalTrafficPoint[]) ?? []

        const insightContext: SeoInsightContext = {
          locationName: c.location.name ?? "Your location",
          // ALT-708: own domain or nothing. Passing the competitor seed here let downstream
          // insight copy attribute a rival's domain to the operator.
          locationDomain: c.locationDomain,
          competitors: c.competitors.map((cm) => ({
            id: cm.id,
            name: cm.name,
            domain: cm.domain,
          })),
        }

        const insights = generateSeoInsights({
          currentRank: c.state.locationRankSnapshot,
          previousRank,
          currentKeywords: c.state.currentKeywords,
          previousKeywords,
          serpEntries: c.state.serpEntries,
          previousSerpEntries,
          intersectionRows: c.state.intersectionRows,
          previousIntersectionRows: [],
          adCreatives: c.state.adCreatives,
          previousAdCreatives,
          currentBacklinks: null,
          previousBacklinks: null,
          currentPages,
          previousPages,
          historicalTraffic,
          context: insightContext,
        })

        if (insights.length > 0) {
          const insightsPayload = insights.map((insight) => ({
            location_id: c.locationId,
            competitor_id: insight.evidence?.competitor_id
              ? String(insight.evidence.competitor_id)
              : null,
            date_key: c.dateKey,
            insight_type: insight.insight_type,
            title: insight.title,
            summary: insight.summary,
            confidence: insight.confidence,
            severity: insight.severity,
            evidence: insight.evidence,
            recommendations: insight.recommendations,
            status: "new",
          }))

          await c.supabase.from("insights").upsert(insightsPayload, {
            onConflict: "location_id,competitor_id,date_key,insight_type",
          })
        }
        return { insightsGenerated: insights.length }
      },
    },
  ]

  return steps
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export async function buildVisibilityContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<VisibilityPipelineCtx> {
  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()
  const tier = asSubscriptionTier(org?.subscription_tier)

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, website, primary_place_id, organization_id, city, region, country")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!location) throw new Error("Location not found")

  let resolvedWebsite = location.website as string | null
  if (!resolvedWebsite && location.primary_place_id) {
    try {
      const placeDetails = await fetchPlaceDetails(location.primary_place_id)
      if (placeDetails?.websiteUri) {
        resolvedWebsite = placeDetails.websiteUri
        await supabase
          .from("locations")
          .update({ website: resolvedWebsite })
          .eq("id", locationId)
      }
    } catch {
      /* non-fatal */
    }
  }

  const locationDomain = extractDomain(resolvedWebsite)

  const { data: allComps } = await supabase
    .from("competitors")
    .select("id, name, website, metadata, is_active")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const competitors = (allComps ?? [])
    .filter(
      (c) =>
        (c.metadata as Record<string, unknown> | null)?.status === "approved"
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      website: c.website,
      domain: extractDomain(c.website) ?? "",
    }))
    .filter((c) => c.domain !== "")

  const allDomains = [
    locationDomain,
    ...competitors.map((c) => c.domain),
  ].filter(Boolean) as string[]
  const seedDomain = locationDomain ?? competitors[0]?.domain ?? null

  if (allDomains.length === 0)
    throw new Error("No website configured for this location or its competitors")

  const dateKey = new Date().toISOString().slice(0, 10)

  return {
    supabase,
    locationId,
    organizationId,
    tier,
    location: {
      id: location.id,
      name: location.name,
      website: resolvedWebsite,
      primary_place_id: location.primary_place_id,
      city: location.city ?? null,
      region: location.region ?? null,
      country: location.country ?? null,
    },
    locationDomain,
    seedDomain,
    allDomains,
    dateKey,
    competitors,
    state: {
      locationRankSnapshot: null,
      currentKeywords: [],
      serpEntries: [],
      intersectionRows: [],
      adCreatives: [],
      warnings: [],
    },
  }
}
