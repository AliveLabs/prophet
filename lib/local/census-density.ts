// ---------------------------------------------------------------------------
// True local population density (events R2 · §4.5) — US Census tract density.
//
// The Events Impact Engine scales its surface bars + relevance radius with how
// dense a restaurant's surroundings are. Today that density is a SATURATING proxy:
// a Places nearby-restaurant count that caps at the Places-20 ceiling (see
// lib/events/density.ts), so a strip mall and Times Square both read "dense_urban"
// and a true-rural diner can read "suburban" the moment a few competitors cluster.
//
// This module replaces that proxy (when a key is present) with a TRUE residential
// density measure — people per square mile from the US Census — by:
//   1) GEOCODE the lat/lng → the containing Census tract (FIPS + land area in m²)
//      via the public Census Geocoder geographies endpoint.
//   2) POPULATION for that tract from the ACS 5-year API (B01003_001E).
//   3) density = population ÷ (land_area_m² → sq mi).
//
// KEY DECISION (plan §7): free US Census API for v1; the paid drive-time isochrone
// path is deliberately NOT built here. Swapping the density SOURCE later is a
// contained change — only this module + its return shape are the contract; nothing
// downstream knows it's "Census".
//
// GRACEFUL NO-OP (cardinal rule): gated on CENSUS_API_KEY. When the key is ABSENT —
// or the Census geocoder/ACS errors, times out, or returns nothing — this returns
// null and the caller falls back to the EXACT competitor-count proxy + suburban
// radius (byte-identical to prod today). It NEVER throws.
//
// CACHE: mirrors lib/events/geo.ts (in-process L1) + the location_density table (L2,
// the SAME table the competitor proxy writes), with a long TTL — residential density
// changes on a census cadence, not weekly — so we never hammer the Census API.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { DensityTier } from "@/lib/events/impact"

/** The density SOURCE contract. Downstream code depends on this shape, not on "Census",
 *  so a future isochrone provider can return the same thing without ripple. */
export type LocalDensity = {
  /** Residential population per square mile (true measure, not a proxy). */
  peoplePerSqMi: number
  /** The events-R2 radius CLASS this density falls into (§3.3 breakpoints). */
  densityClass: DensityClass
  /** The impact-model density TIER (lib/events/impact.ts has 4 tiers; we map onto them). */
  tier: DensityTier
  /** Provenance for the cache row + debugging. */
  source: "census"
}

/** The three radius classes the events-R2 spec scales the relevance ring by (§3.3).
 *  Distinct from impact.ts's 4 DensityTiers — the radius collapses urban→dense_urban
 *  onto the tight ring; see densityClassToTier for the mapping. */
export type DensityClass = "dense_urban" | "suburban" | "rural"

// ── Documented density breakpoints (people / sq mi) ──────────────────────────
// Seed thresholds, tunable. Anchored to common US Census urban/suburban/rural reading:
//   • rural        < 1,000 /sq mi  — exurban / small-town / countryside
//   • suburban     1,000–6,000     — typical American suburb (today's default behavior)
//   • dense_urban  ≥ 6,000         — urban core / major-city neighborhood
export const DENSITY_BREAKPOINTS = {
  ruralMax: 1_000,
  denseMin: 6_000,
} as const

/** Map a true people/sq-mi measure to the events-R2 radius CLASS. Pure + testable. */
export function densityClassFromPeoplePerSqMi(peoplePerSqMi: number): DensityClass {
  if (!Number.isFinite(peoplePerSqMi) || peoplePerSqMi < DENSITY_BREAKPOINTS.ruralMax) return "rural"
  if (peoplePerSqMi >= DENSITY_BREAKPOINTS.denseMin) return "dense_urban"
  return "suburban"
}

/** Map the radius CLASS to the impact-model 4-tier DensityTier (for DENSITY_BARS). The
 *  radius spec only distinguishes 3 classes; "urban" is folded into the dense ring, so we
 *  carry the dense bar for it. suburban ↔ suburban keeps today's bars unchanged. */
export function densityClassToTier(densityClass: DensityClass): DensityTier {
  if (densityClass === "dense_urban") return "dense_urban"
  if (densityClass === "rural") return "rural"
  return "suburban"
}

const CENSUS_TTL_DAYS = 365 // residential density changes on a census cadence — refresh yearly
const FETCH_TIMEOUT_MS = 8_000
const M2_PER_SQ_MILE = 2_589_988.110336

// L1: in-process cache keyed by rounded lat/lng (mirrors geo.ts's Map). Cold on most
// serverless invocations, which is exactly why we ALSO persist to location_density (L2).
const l1 = new Map<string, LocalDensity | null>()

function coordKey(lat: number, lng: number): string {
  // ~11m precision — plenty to land in the same tract while still sharing the cache
  // across a venue's multiple geocodes.
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

function getCensusKey(): string | null {
  const key = process.env.CENSUS_API_KEY
  return key && key.trim() ? key.trim() : null
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

type TractGeography = {
  /** state FIPS (2-digit) */ state: string
  /** county FIPS (3-digit) */ county: string
  /** tract code (6-digit) */ tract: string
  /** land area in square meters (Census AREALAND) */ landAreaM2: number
}

/** Resolve a lat/lng to its containing Census tract (FIPS + land area) via the public
 *  Census Geocoder geographies endpoint (Census Tracts layer of the current ACS vintage). */
async function geocodeToTract(lat: number, lng: number): Promise<TractGeography | null> {
  const url =
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates` +
    `?x=${encodeURIComponent(lng)}&y=${encodeURIComponent(lat)}` +
    `&benchmark=Public_AR_Current&vintage=Current_Current` +
    `&layers=Census%20Tracts&format=json`
  const data = await fetchJson(url)
  const tracts = (data as { result?: { geographies?: Record<string, unknown[]> } })?.result?.geographies?.[
    "Census Tracts"
  ]
  const t = Array.isArray(tracts) ? (tracts[0] as Record<string, unknown> | undefined) : undefined
  if (!t) return null
  const state = String(t.STATE ?? t.state ?? "")
  const county = String(t.COUNTY ?? t.county ?? "")
  const tract = String(t.TRACT ?? t.tract ?? "")
  const landAreaM2 = Number(t.AREALAND ?? t.arealand)
  if (!state || !county || !tract || !Number.isFinite(landAreaM2) || landAreaM2 <= 0) return null
  return { state, county, tract, landAreaM2 }
}

/** Total population for a tract from the ACS 5-year API (B01003_001E). Keyed (gated above). */
async function fetchTractPopulation(geo: TractGeography, key: string): Promise<number | null> {
  const url =
    `https://api.census.gov/data/2022/acs/acs5` +
    `?get=B01003_001E&for=tract:${encodeURIComponent(geo.tract)}` +
    `&in=state:${encodeURIComponent(geo.state)}%20county:${encodeURIComponent(geo.county)}` +
    `&key=${encodeURIComponent(key)}`
  const data = await fetchJson(url)
  // Shape: [["B01003_001E","state","county","tract"], ["1234","48","113","012345"]]
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) return null
  const pop = Number((data[1] as unknown[])[0])
  return Number.isFinite(pop) && pop >= 0 ? pop : null
}

/**
 * TRUE local population density for a lat/lng, or null when unavailable.
 *
 * Returns null (→ caller falls back to today's competitor proxy + suburban radius) when:
 *   • CENSUS_API_KEY is absent (the no-op gate),
 *   • coords are missing/non-finite,
 *   • the Census geocoder can't place the point in a tract,
 *   • the ACS population lookup fails or the tract land area is zero,
 *   • ANY fetch errors or times out.
 * NEVER throws.
 */
export async function fetchCensusDensity(
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<LocalDensity | null> {
  const key = getCensusKey()
  if (!key) return null // ← graceful no-op gate
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const ck = coordKey(lat, lng)
  if (l1.has(ck)) return l1.get(ck) ?? null

  try {
    const geo = await geocodeToTract(lat, lng)
    if (!geo) {
      l1.set(ck, null)
      return null
    }
    const pop = await fetchTractPopulation(geo, key)
    if (pop == null) {
      l1.set(ck, null)
      return null
    }
    const sqMi = geo.landAreaM2 / M2_PER_SQ_MILE
    if (!(sqMi > 0)) {
      l1.set(ck, null)
      return null
    }
    const peoplePerSqMi = pop / sqMi
    const densityClass = densityClassFromPeoplePerSqMi(peoplePerSqMi)
    const out: LocalDensity = {
      peoplePerSqMi,
      densityClass,
      tier: densityClassToTier(densityClass),
      source: "census",
    }
    l1.set(ck, out)
    return out
  } catch {
    // Fail-soft: any Census error/timeout → null → caller uses today's proxy. Cache the
    // null in L1 so a transient failure doesn't re-hammer the API within the same run.
    l1.set(ck, null)
    return null
  }
}

/**
 * Cached TRUE-density resolution for a location: L1 (in-process) → L2 (location_density
 * table, source='census', TTL'd a year) → live Census fetch → persist. Returns null
 * whenever Census is unavailable, so the caller's no-op fallback kicks in BYTE-IDENTICALLY
 * to today. Never throws.
 *
 * REUSES the existing location_density table (residential_density + source columns the
 * P2 migration already provisioned) — no new migration needed.
 */
export async function ensureCensusDensity(
  supabase: SupabaseClient,
  locationId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
  now: Date = new Date(),
): Promise<LocalDensity | null> {
  if (!getCensusKey()) return null // ← no-op gate (don't even touch the cache without a key)

  // L2: a fresh, census-sourced row already has the measure — reuse it, no fetch.
  try {
    const { data } = await supabase
      .from("location_density")
      .select("residential_density, source, refreshed_at")
      .eq("location_id", locationId)
      .maybeSingle()
    const fresh =
      data?.refreshed_at &&
      now.getTime() - Date.parse(data.refreshed_at as string) < CENSUS_TTL_DAYS * 86400_000
    const cachedPpsm = typeof data?.residential_density === "number" ? data.residential_density : null
    if (data?.source === "census" && fresh && cachedPpsm != null && Number.isFinite(cachedPpsm)) {
      const densityClass = densityClassFromPeoplePerSqMi(cachedPpsm)
      return {
        peoplePerSqMi: cachedPpsm,
        densityClass,
        tier: densityClassToTier(densityClass),
        source: "census",
      }
    }
  } catch {
    /* cache read is best-effort; fall through to a live fetch */
  }

  const live = await fetchCensusDensity(lat, lng)
  if (!live) return null

  // Persist into the SAME location_density row (mirrors ensureLocationDensity's upsert).
  // We set the tier too so the existing competitor-proxy consumers stay coherent.
  try {
    await supabase.from("location_density").upsert(
      {
        location_id: locationId,
        tier: live.tier,
        residential_density: live.peoplePerSqMi,
        source: "census",
        refreshed_at: now.toISOString(),
      },
      { onConflict: "location_id" },
    )
  } catch {
    /* persistence is best-effort; the measure is still usable this run */
  }
  return live
}

/** Test-only: clear the in-process L1 cache so cache-hit assertions are deterministic. */
export function __clearCensusDensityCacheForTests(): void {
  l1.clear()
}
