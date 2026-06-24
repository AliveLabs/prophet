// ---------------------------------------------------------------------------
// Local market density (Events Impact Engine · P2 density calibration)
//
// The impact model's surface bars scale with density: a rural diner surfaces the
// lone HS game; a dense-urban spot needs a true mega-event. That only works if each
// location actually HAS a density tier — otherwise everything defaults to "suburban"
// and the calibration is inert.
//
// TWO density signals, in priority order:
//   1. TRUE residential density (events R2 · §4.5) — US Census tract people/sq-mi via
//      lib/local/census-density.ts. The REAL measure; not saturating. Used when a
//      CENSUS_API_KEY is present and the lookup succeeds.
//   2. COMPETITOR-COUNT PROXY (today's path) — a Places nearby-restaurant count (the
//      universal proxy: works in any country, no Census key). SATURATES at the Places-20
//      ceiling. This is the GRACEFUL NO-OP fallback: with no key / a Census failure, the
//      tier is computed EXACTLY as it is in prod today.
// The Census branch is purely additive — when it returns null, this file behaves
// byte-identically to before R2. Cached in location_density (shared row); self-heals
// on the events run like the venue catalog + baseline.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchNearbyPlaces } from "@/lib/places/google"
import type { DensityTier } from "./impact"
import { ensureCensusDensity, type DensityClass } from "@/lib/local/census-density"

const DENSITY_TTL_DAYS = 90
const DENSITY_RADIUS_M = 800 // ~0.5mi — a tight ring so saturation (Places caps at 20) reads as dense

/** Map a nearby-restaurant count (within ~0.5mi, 0..20 due to the Places cap) to a tier.
 *  Tunable seed thresholds; pure + testable. */
export function densityTierFromCount(count: number): DensityTier {
  if (count <= 2) return "rural"
  if (count <= 8) return "suburban"
  if (count <= 16) return "urban"
  return "dense_urban"
}

function isDensityTier(v: unknown): v is DensityTier {
  return v === "rural" || v === "suburban" || v === "urban" || v === "dense_urban"
}

/** Load the cached tier; sample + store it if missing/stale (>90d). One Places call per
 *  location per quarter. Fails soft to the cached tier, else "suburban".
 *
 *  R2: when a CENSUS_API_KEY is configured and the Census lookup succeeds, the TRUE
 *  residential-density tier wins (it isn't saturating). When Census is unavailable
 *  (no key / failure / null), control falls through to the EXACT competitor-count proxy
 *  path below — byte-identical to prod today. */
export async function ensureLocationDensity(
  supabase: SupabaseClient,
  locationId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
  now: Date = new Date(),
): Promise<DensityTier> {
  // ── R2 true-density branch (additive; no-op without a key) ──
  // ensureCensusDensity is internally gated on CENSUS_API_KEY and never throws — it
  // returns null whenever Census is unavailable, dropping us into the proxy path.
  const census = await ensureCensusDensity(supabase, locationId, lat, lng, now)
  if (census) return census.tier

  // ── Competitor-count proxy (today's path — untouched) ──
  const { data } = await supabase
    .from("location_density")
    .select("tier, refreshed_at")
    .eq("location_id", locationId)
    .maybeSingle()
  const cached = data?.tier
  const fresh =
    data?.refreshed_at && now.getTime() - Date.parse(data.refreshed_at as string) < DENSITY_TTL_DAYS * 86400_000
  if (isDensityTier(cached) && fresh) return cached
  if (lat == null || lng == null) return isDensityTier(cached) ? cached : "suburban"

  try {
    const places = await fetchNearbyPlaces(lat, lng, {
      includedTypes: ["restaurant"],
      radius: DENSITY_RADIUS_M,
      maxResultCount: 20,
    })
    const count = places.length
    const tier = densityTierFromCount(count)
    await supabase.from("location_density").upsert(
      {
        location_id: locationId,
        tier,
        commercial_proxy: count,
        source: "competitor_proxy",
        refreshed_at: now.toISOString(),
      },
      { onConflict: "location_id" },
    )
    return tier
  } catch (err) {
    console.warn(`[density] sample failed for ${locationId}:`, String(err))
    return isDensityTier(cached) ? cached : "suburban"
  }
}

/** R2: resolve the TRUE-density CLASS (for the density-scaled relevance ring), or null when
 *  Census is unavailable (no CENSUS_API_KEY / failure). null → caller uses the suburban ring
 *  = today's exact 0.5/3.0mi thresholds. Reuses the SAME cached Census lookup as the tier,
 *  so the radius and the bars stay coherent. Never throws. */
export async function ensureLocationDensityClass(
  supabase: SupabaseClient,
  locationId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
  now: Date = new Date(),
): Promise<DensityClass | null> {
  const census = await ensureCensusDensity(supabase, locationId, lat, lng, now)
  return census?.densityClass ?? null
}
