// Beta rescue 2.4 — regression coverage for the SEO-insight clobbering bug.
//
// lib/jobs/pipelines/visibility.ts's `seo_insights` step calls generateSeoInsights() with a
// REAL 7-day-prior snapshot in every `previous*` field, but only runs on SEO-due days
// (isSeoDue: Monday, or Monday+Thursday for the biweekly tier).
//
// lib/jobs/pipelines/insights.ts's `enriched_seo_insights` step ALSO calls generateSeoInsights()
// with the SAME location/competitor and the SAME (location_id, competitor_id, date_key,
// insight_type) upsert key — but it runs every day and hardcodes previousRank/previousKeywords/
// previousAdCreatives/previousIntersectionRows/previousPages to null/[] because it has no prior
// snapshot to diff against. On a day both pipelines run (a SEO-due day), insights.ts runs AFTER
// visibility.ts (see DAILY_PIPELINES order in lib/jobs/queue.ts) and its no-diff upsert can
// silently overwrite visibility's correctly-diffed row for the same key.
//
// Two of the detectors have no guard against an empty "previous" array and don't just produce
// nothing when starved of diff data — they produce FALSE insights, flagging the entire current
// snapshot as new/changed:
//   - detectNewCompetitorAds: previousAdCreatives=[] means every current competitor ad reads
//     as "new" advertising, every single day, even for ads that have run for months.
//   - detectPaidOverlapSpike: previousIntersectionRows=[] means previousPaidOverlap is always 0,
//     so any nonzero current overlap above the threshold reads as a "spike".
//
// The fix: filterNoDiffSafeSeoInsights() is a pure allowlist filter applied at the one call site
// that has no real diff data (insights.ts). It keeps only insight types that are safe to persist
// without a real prior snapshot, so a diffed row written by visibility.ts can never be replaced
// by a no-diff row for the same key — the no-diff caller structurally cannot produce that type.

import { describe, it, expect } from "vitest"
import {
  generateSeoInsights,
  filterNoDiffSafeSeoInsights,
  NO_DIFF_SAFE_SEO_INSIGHT_TYPES,
  type SeoInsightContext,
} from "@/lib/seo/insights"
import type { GeneratedInsight } from "@/lib/insights/types"
import type {
  NormalizedAdCreative,
  NormalizedIntersectionRow,
  DomainRankSnapshot,
} from "@/lib/seo/types"

const ctx: SeoInsightContext = {
  locationName: "Test Kitchen",
  locationDomain: "testkitchen.com",
  competitors: [{ id: "comp-1", name: "Rival Diner", domain: "rivaldiner.com" }],
}

function insight(insight_type: string): GeneratedInsight {
  return {
    insight_type,
    title: "t",
    summary: "s",
    confidence: "medium",
    severity: "info",
    evidence: {},
    recommendations: [],
  }
}

describe("NO_DIFF_SAFE_SEO_INSIGHT_TYPES — allowlist, not denylist", () => {
  it("contains exactly the types that never need a real diff to mean something", () => {
    expect([...NO_DIFF_SAFE_SEO_INSIGHT_TYPES].sort()).toEqual(
      [
        "seo_competitor_growth_trend",
        "seo_competitor_keyword_portfolio",
        "seo_competitor_top_page_threat",
        "seo_historical_traffic_trend",
        "seo_keyword_opportunity_gap",
      ].sort()
    )
  })

  it("excludes every diff-branded or false-positive-prone type visibility.ts owns", () => {
    const diffOwnedTypes = [
      "seo_organic_visibility_up",
      "seo_organic_visibility_down",
      "seo_paid_visibility_change",
      "seo_keyword_win",
      "seo_competitor_overtake",
      "seo_new_competitor_ads_detected",
      "seo_paid_keyword_overlap_spike",
      "seo_backlink_growth",
      "seo_backlink_decline",
      "seo_top_page_traffic_shift",
    ]
    for (const t of diffOwnedTypes) {
      expect(NO_DIFF_SAFE_SEO_INSIGHT_TYPES.has(t), t).toBe(false)
    }
  })
})

describe("filterNoDiffSafeSeoInsights — pure filter", () => {
  it("keeps allowlisted types and drops everything else", () => {
    const input = [
      insight("seo_keyword_opportunity_gap"),
      insight("seo_new_competitor_ads_detected"),
      insight("seo_paid_keyword_overlap_spike"),
      insight("seo_competitor_growth_trend"),
      insight("seo_organic_visibility_up"),
    ]
    const kept = filterNoDiffSafeSeoInsights(input).map((i) => i.insight_type)
    expect(kept).toEqual(["seo_keyword_opportunity_gap", "seo_competitor_growth_trend"])
  })

  it("passes through an empty list unchanged", () => {
    expect(filterNoDiffSafeSeoInsights([])).toEqual([])
  })

  it("drops a fabricated future insight_type by default (fail closed, not fail open)", () => {
    const kept = filterNoDiffSafeSeoInsights([insight("seo_some_new_type_nobody_reviewed_yet")])
    expect(kept).toEqual([])
  })
})

describe("regression: the no-diff call site's raw detector output before filtering", () => {
  // This reproduces insights.ts's exact generateSeoInsights() call shape: previousRank null,
  // previousAdCreatives/previousIntersectionRows/previousKeywords/previousSerpEntries/
  // previousPages all empty, because that call site has no prior snapshot at all.

  const newAd: NormalizedAdCreative = {
    headline: "50% off tonight",
    description: null,
    displayUrl: null,
    domain: "rivaldiner.com",
    position: 1,
    keyword: "best diner",
    fetchedAt: "2026-08-12T00:00:00Z",
  }

  const sharedRows: NormalizedIntersectionRow[] = Array.from({ length: 6 }, (_, i) => ({
    keyword: `shared-keyword-${i}`,
    searchVolume: 100,
    cpc: 1.2,
    competition: 0.5,
    domain1Rank: 3,
    domain2Rank: 5,
    gapType: "shared" as const,
  }))

  const lossRow: NormalizedIntersectionRow = {
    keyword: "gap-keyword",
    searchVolume: 500,
    cpc: 2,
    competition: 0.6,
    domain1Rank: null,
    domain2Rank: 4,
    gapType: "loss",
  }

  function rawNoDiffInsights() {
    return generateSeoInsights({
      currentRank: null,
      previousRank: null,
      currentKeywords: [],
      previousKeywords: [],
      serpEntries: [],
      previousSerpEntries: [],
      intersectionRows: [...sharedRows, lossRow],
      previousIntersectionRows: [],
      adCreatives: [newAd],
      previousAdCreatives: [],
      currentBacklinks: null,
      previousBacklinks: null,
      currentPages: [],
      previousPages: [],
      historicalTraffic: [],
      context: ctx,
    })
  }

  it("without the filter, a no-diff call produces the false-positive types (documents the bug)", () => {
    const types = rawNoDiffInsights().map((i) => i.insight_type)
    expect(types).toContain("seo_new_competitor_ads_detected")
    expect(types).toContain("seo_paid_keyword_overlap_spike")
    // The genuinely safe type is also present, mixed in with the false positives.
    expect(types).toContain("seo_keyword_opportunity_gap")
  })

  it("filterNoDiffSafeSeoInsights strips the false positives and keeps the safe type", () => {
    const filtered = filterNoDiffSafeSeoInsights(rawNoDiffInsights()).map((i) => i.insight_type)
    expect(filtered).not.toContain("seo_new_competitor_ads_detected")
    expect(filtered).not.toContain("seo_paid_keyword_overlap_spike")
    expect(filtered).toEqual(["seo_keyword_opportunity_gap"])
  })
})

describe("clobber guarantee: a diffed row is never replaced by a no-diff row for the same key", () => {
  it("a real diff from visibility.ts and the no-diff insights.ts payload never collide on insight_type", () => {
    // visibility.ts's real 7-day diff: organic traffic actually grew.
    const previousRank: DomainRankSnapshot = {
      domain: "testkitchen.com",
      organic: { etv: 1000, rankedKeywords: 40, newKeywords: 0, lostKeywords: 0 },
      paid: { etv: 0, rankedKeywords: 0 },
    } as unknown as DomainRankSnapshot
    const currentRank: DomainRankSnapshot = {
      domain: "testkitchen.com",
      organic: { etv: 2000, rankedKeywords: 55, newKeywords: 15, lostKeywords: 0 },
      paid: { etv: 0, rankedKeywords: 0 },
    } as unknown as DomainRankSnapshot

    const diffedInsights = generateSeoInsights({
      currentRank,
      previousRank,
      currentKeywords: [],
      previousKeywords: [],
      serpEntries: [],
      previousSerpEntries: [],
      intersectionRows: [],
      previousIntersectionRows: [],
      adCreatives: [],
      previousAdCreatives: [],
      currentBacklinks: null,
      previousBacklinks: null,
      currentPages: [],
      previousPages: [],
      historicalTraffic: [],
      context: ctx,
    })
    const diffedKeys = new Set(diffedInsights.map((i) => i.insight_type))
    expect(diffedKeys.has("seo_organic_visibility_up")).toBe(true)

    // insights.ts's no-diff call, same day, same location — after the fix, its filtered
    // payload for upsert.
    const noDiffPayload = filterNoDiffSafeSeoInsights(rawNoDiffInsightsWithAdsAndOverlap())
    const noDiffKeys = new Set(noDiffPayload.map((i) => i.insight_type))

    // The guarantee: no overlap between what visibility diffed and what insights.ts's no-diff
    // call is now allowed to upsert. An upsert of noDiffPayload can never touch a key
    // diffedInsights already wrote.
    for (const key of diffedKeys) {
      expect(noDiffKeys.has(key), key).toBe(false)
    }
  })

  function rawNoDiffInsightsWithAdsAndOverlap() {
    const newAd: NormalizedAdCreative = {
      headline: "grand opening",
      description: null,
      displayUrl: null,
      domain: "rivaldiner.com",
      position: 1,
      keyword: "best diner",
      fetchedAt: "2026-08-12T00:00:00Z",
    }
    const sharedRows: NormalizedIntersectionRow[] = Array.from({ length: 6 }, (_, i) => ({
      keyword: `shared-keyword-${i}`,
      searchVolume: 100,
      cpc: 1.2,
      competition: 0.5,
      domain1Rank: 3,
      domain2Rank: 5,
      gapType: "shared" as const,
    }))
    return generateSeoInsights({
      currentRank: null,
      previousRank: null,
      currentKeywords: [],
      previousKeywords: [],
      serpEntries: [],
      previousSerpEntries: [],
      intersectionRows: sharedRows,
      previousIntersectionRows: [],
      adCreatives: [newAd],
      previousAdCreatives: [],
      currentBacklinks: null,
      previousBacklinks: null,
      currentPages: [],
      previousPages: [],
      historicalTraffic: [],
      context: ctx,
    })
  }
})
