// ---------------------------------------------------------------------------
// SEO Competitor Enrichment – reusable pipeline for a single competitor domain
// Used by: approveCompetitorAction, refreshSeoAction
// ---------------------------------------------------------------------------

import { fetchDomainRankOverview } from "@/lib/providers/dataforseo/domain-rank-overview"
import { fetchRankedKeywords } from "@/lib/providers/dataforseo/ranked-keywords"
import { fetchRelevantPages } from "@/lib/providers/dataforseo/relevant-pages"
import { fetchHistoricalRankOverview } from "@/lib/providers/dataforseo/historical-rank-overview"
import { fetchDomainIntersection } from "@/lib/providers/dataforseo/domain-intersection"
import {
  normalizeDomainRankOverview,
  normalizeRankedKeywords,
  normalizeRelevantPages,
  normalizeHistoricalRankOverview,
  normalizeDomainIntersection,
} from "@/lib/seo/normalize"
import { hashDomainRankSnapshot, hashRankedKeywords, hashJsonPayload } from "@/lib/seo/hash"
import { SEO_SNAPSHOT_TYPES } from "@/lib/seo/types"
import { getSeoRankedKeywordsLimit, isSeoIntersectionEnabled, getSeoIntersectionLimit } from "@/lib/billing/limits"
import type { SubscriptionTier } from "@/lib/billing/tiers"
import type { SupabaseClient } from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// enrichCompetitorSeo – run the full SEO pipeline for one competitor domain
// ---------------------------------------------------------------------------

export async function enrichCompetitorSeo(
  competitorId: string,
  domain: string,
  locationDomain: string | null,
  dateKey: string,
  tier: SubscriptionTier,
  supabase: SupabaseClient
): Promise<{ warnings: string[] }> {
  const warnings: string[] = []

  // 1. Domain Rank Overview
  try {
    const result = await fetchDomainRankOverview({ target: domain })
    if (result) {
      const normalized = normalizeDomainRankOverview(result, domain)
      const diffHash = hashDomainRankSnapshot(normalized)
      await supabase.from("snapshots").upsert(
        {
          competitor_id: competitorId,
          captured_at: new Date().toISOString(),
          date_key: dateKey,
          provider: "dataforseo_labs",
          snapshot_type: SEO_SNAPSHOT_TYPES.domainRankOverview,
          raw_data: normalized as unknown as Record<string, unknown>,
          diff_hash: diffHash,
        },
        { onConflict: "competitor_id,date_key,snapshot_type" }
      )
      console.log(`[SEO Enrich] Domain Rank Overview saved for ${domain}`)
    }
  } catch (err) {
    console.warn(`[SEO Enrich] Domain Rank Overview failed for ${domain}:`, err)
    warnings.push(`Domain rank overview failed for ${domain}`)
  }

  // 2. Ranked Keywords
  try {
    const limit = getSeoRankedKeywordsLimit(tier)
    const result = await fetchRankedKeywords({ target: domain, limit })
    if (result) {
      const normalized = normalizeRankedKeywords(result)
      const diffHash = hashRankedKeywords(normalized)
      await supabase.from("snapshots").upsert(
        {
          competitor_id: competitorId,
          captured_at: new Date().toISOString(),
          date_key: dateKey,
          provider: "dataforseo_labs",
          snapshot_type: SEO_SNAPSHOT_TYPES.rankedKeywords,
          raw_data: { version: "1.0", domain, keywords: normalized } as unknown as Record<string, unknown>,
          diff_hash: diffHash,
        },
        { onConflict: "competitor_id,date_key,snapshot_type" }
      )
      console.log(`[SEO Enrich] Ranked Keywords saved for ${domain}: ${normalized.length} keywords`)
    }
  } catch (err) {
    console.warn(`[SEO Enrich] Ranked Keywords failed for ${domain}:`, err)
    warnings.push(`Ranked keywords failed for ${domain}`)
  }

  // 3. Relevant Pages
  try {
    const result = await fetchRelevantPages({ target: domain, limit: 25 })
    if (result) {
      const normalized = normalizeRelevantPages(result)
      await supabase.from("snapshots").upsert(
        {
          competitor_id: competitorId,
          captured_at: new Date().toISOString(),
          date_key: dateKey,
          provider: "dataforseo_labs",
          snapshot_type: SEO_SNAPSHOT_TYPES.relevantPages,
          raw_data: { version: "1.0", domain, pages: normalized } as unknown as Record<string, unknown>,
          diff_hash: hashJsonPayload(normalized),
        },
        { onConflict: "competitor_id,date_key,snapshot_type" }
      )
      console.log(`[SEO Enrich] Relevant Pages saved for ${domain}: ${normalized.length} pages`)
    }
  } catch (err) {
    console.warn(`[SEO Enrich] Relevant Pages failed for ${domain}:`, err)
    warnings.push(`Relevant pages failed for ${domain}`)
  }

  // 4. Historical Rank (12 months)
  try {
    const result = await fetchHistoricalRankOverview({ target: domain })
    if (result) {
      const normalized = normalizeHistoricalRankOverview(result)
      await supabase.from("snapshots").upsert(
        {
          competitor_id: competitorId,
          captured_at: new Date().toISOString(),
          date_key: dateKey,
          provider: "dataforseo_labs",
          snapshot_type: SEO_SNAPSHOT_TYPES.historicalRank,
          raw_data: { version: "1.0", domain, history: normalized } as unknown as Record<string, unknown>,
          diff_hash: hashJsonPayload(normalized),
        },
        { onConflict: "competitor_id,date_key,snapshot_type" }
      )
      console.log(`[SEO Enrich] Historical Rank saved for ${domain}: ${normalized.length} months`)
    }
  } catch (err) {
    console.warn(`[SEO Enrich] Historical Rank failed for ${domain}:`, err)
    warnings.push(`Historical rank failed for ${domain}`)
  }

  // 5. Domain Intersection (vs location domain)
  if (locationDomain && isSeoIntersectionEnabled(tier)) {
    try {
      const limit = getSeoIntersectionLimit(tier)
      const result = await fetchDomainIntersection({
        target1: locationDomain,
        target2: domain,
        limit,
      })
      if (result) {
        const normalized = normalizeDomainIntersection(result)
        await supabase.from("snapshots").upsert(
          {
            competitor_id: competitorId,
            captured_at: new Date().toISOString(),
            date_key: dateKey,
            provider: "dataforseo_labs",
            snapshot_type: SEO_SNAPSHOT_TYPES.domainIntersection,
            raw_data: { version: "1.0", rows: normalized } as unknown as Record<string, unknown>,
            diff_hash: hashJsonPayload(normalized),
          },
          { onConflict: "competitor_id,date_key,snapshot_type" }
        )
        console.log(`[SEO Enrich] Domain Intersection saved for ${locationDomain} vs ${domain}: ${normalized.length} keywords`)
      }
    } catch (err) {
      console.warn(`[SEO Enrich] Domain Intersection failed for ${domain}:`, err)
      warnings.push(`Domain intersection failed for ${domain}`)
    }
  }

  return { warnings }
}
