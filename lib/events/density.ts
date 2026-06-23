// ---------------------------------------------------------------------------
// Local market density (Events Impact Engine · P2 density calibration)
//
// The impact model's surface bars scale with density: a rural diner surfaces the
// lone HS game; a dense-urban spot needs a true mega-event. That only works if each
// location actually HAS a density tier — otherwise everything defaults to "suburban"
// and the calibration is inert. We derive the tier with zero customer effort + no new
// vendor: a Places nearby-restaurant count (the universal "commercial density" proxy
// the plan specified — works in any country, no Census key). Cached 90d in
// location_density; self-heals on the events run like the venue catalog + baseline.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchNearbyPlaces } from "@/lib/places/google"
import type { DensityTier } from "./impact"

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
 *  location per quarter. Fails soft to the cached tier, else "suburban". */
export async function ensureLocationDensity(
  supabase: SupabaseClient,
  locationId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
  now: Date = new Date(),
): Promise<DensityTier> {
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
