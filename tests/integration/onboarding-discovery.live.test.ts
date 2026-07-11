// LIVE probe of the identity-aware competitor discovery core (ALT: la Madeleine
// incident, 2026-07-10). Exercises the REAL modules the onboarding action composes —
// Places details (identity) → tiled searchNearby (recall) → Sonnet re-rank via
// generateStructured (precision) — against the actual la Madeleine Dallas location
// that produced the bad demo. No DB/auth: this is everything discoverCompetitorsForLocation
// does except persistence.
//
// Run: set -a; . ./.env.local; set +a; npx vitest run --config vitest.integration.config.ts tests/integration/onboarding-discovery.live.test.ts
//
// Expectations encode the operator's ground truth: the pool must contain the
// fast-casual bakery-café rivals (Panera is 744m away), and the ranker must score
// bakery/café/breakfast places above the dinner-scene spots the old path suggested
// (The Finch, JOEY Dallas et al).
import { describe, it, expect } from "vitest"
import { fetchAutocomplete, fetchPlaceDetails, fetchNearbyPlaces } from "@/lib/places/google"
import { generateStructured } from "@/lib/ai/provider"
import { scoreCompetitor, EXCLUDED_COMPETITOR_TYPES } from "@/lib/providers/scoring"
import {
  buildTargetIdentity,
  buildRerankPrompt,
  parseRerank,
  sanitizeWhy,
  discoveryTypeTiles,
  DISCOVERY_RADIUS_METERS,
  RERANK_POOL_CAP,
  RERANK_VETO_BELOW,
  DISCOVERY_KEEP,
  type RerankEntry,
} from "@/lib/competitors/discover"

const LA_MADELEINE = {
  placeId: "ChIJ12PBdxCfToYRTHXqhgQC3TA",
  lat: 32.837095,
  lng: -96.781288,
  name: "la Madeleine",
}

describe("onboarding competitor discovery (live)", () => {
  it("biased autocomplete finds the typed competitor WITH a distance per result", async () => {
    const results = await fetchAutocomplete("Corner Bakery", {
      lat: LA_MADELEINE.lat,
      lng: LA_MADELEINE.lng,
      radius: 50000,
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => /corner bakery/i.test(r.description))).toBe(true)
    // origin → distanceMeters rides along in the same call (no extra latency)
    expect(
      results.some((r) => typeof r.distance_meters === "number" && r.distance_meters > 0)
    ).toBe(true)
  }, 30_000)

  it("finds and ranks a bakery-café competitive set for la Madeleine Dallas", async () => {
    // 1) Identity
    const details = await fetchPlaceDetails(LA_MADELEINE.placeId)
    const identity = buildTargetIdentity(LA_MADELEINE.name, details, "Restaurant")
    expect(identity.editorial).toMatch(/French cafe/i)

    // 2) Recall — tiled nearby sweep (the exact tiles + radius the action uses)
    const tiles = discoveryTypeTiles("restaurant")
    const tileResults = await Promise.all(
      tiles.map((includedTypes) =>
        fetchNearbyPlaces(LA_MADELEINE.lat, LA_MADELEINE.lng, {
          includedTypes,
          radius: DISCOVERY_RADIUS_METERS,
          excludePlaceId: LA_MADELEINE.placeId,
        }).catch(() => [])
      )
    )
    const byId = new Map(tileResults.flat().map((p) => [p.placeId, p]))
    const pool = Array.from(byId.values())
      .filter((p) => p.name.trim().toLowerCase() !== LA_MADELEINE.name.toLowerCase())
      .filter((p) => !p.types.some((t) => EXCLUDED_COMPETITOR_TYPES.has(t)))
      .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
      .slice(0, RERANK_POOL_CAP)

    expect(pool.length).toBeGreaterThan(30)
    const panera = pool.find((p) => /panera/i.test(p.name))
    expect(panera, "Panera Bread (744m) must be in the recall pool").toBeTruthy()

    // 3) Precision — the same structured call the action makes
    const rerank = await generateStructured<Map<number, RerankEntry> | null>(
      {
        tier: "reasoning",
        prompt: buildRerankPrompt(identity, pool),
        temperature: 0.2,
        maxOutputTokens: 8192,
        label: "competitor-rerank-live-test",
      },
      { validate: (raw) => parseRerank(raw, pool.length), fallback: () => null }
    )
    expect(rerank, "re-rank must parse (fallback null means model output unusable)").toBeTruthy()

    // 4) Choose exactly like the action does
    const kept = pool
      .map((p, i) => {
        const heuristic = scoreCompetitor({
          distanceMeters: p.distanceMeters ?? undefined,
          category: p.primaryType ?? undefined,
          targetCategory: "Restaurant",
          rating: p.rating ?? undefined,
          reviewCount: p.reviewCount ?? undefined,
          types: p.types,
        })
        const entry = rerank!.get(i)
        return {
          name: p.name,
          primaryType: p.primaryType,
          distanceMeters: p.distanceMeters,
          score: entry?.score ?? null,
          why: sanitizeWhy(entry?.why ?? null),
          heuristic: heuristic.score,
        }
      })
      .filter((s) => s.heuristic > 0)
      // Mirror the action: with a rerank in hand, unranked candidates are dropped
      // (an omission is noise, not a free pass past the veto).
      .filter((s) => s.score !== null && s.score >= RERANK_VETO_BELOW)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, DISCOVERY_KEEP)

    // eslint-disable-next-line no-console
    console.log("[live] top picks:", kept.map((k) => `${k.score} ${k.name} — ${k.why ?? "(fallback why)"}`))

    // Panera is the canonical direct competitor — it must survive near the top.
    expect(kept.slice(0, 5).some((k) => /panera/i.test(k.name))).toBe(true)
    // The old incident set (dinner-scene spots) must NOT dominate: at most one of
    // them may sneak into the kept list.
    const oldOffenders = kept.filter((k) =>
      /the finch|joey dallas|rh rooftop|hg sply|ramble room/i.test(k.name)
    )
    expect(oldOffenders.length).toBeLessThanOrEqual(1)
    // Every kept pick shows an operator-readable why (model-written or fallback) —
    // and the model-written ones survived the voice gate.
    const withWhys = kept.filter((k) => k.why)
    expect(withWhys.length).toBeGreaterThanOrEqual(Math.ceil(kept.length / 2))
  }, 180_000)
})
