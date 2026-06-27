// ---------------------------------------------------------------------------
// Partner-entity catalog (§4.1) — the grassroots-growth detection spine (sibling
// of lib/events/venue-catalog.ts).
//
// Where venue_catalog sweeps DEMAND venues (stadiums/arenas/parks that DRIVE foot
// traffic), partner_catalog sweeps the nearby NON-competitor entities whose AUDIENCE
// a restaurant can borrow: schools/PTA, youth-sports, churches/boosters, gyms,
// offices/coworking, hospitals, hotels, dealerships, theaters, breweries, bakeries,
// farmers-markets. These are the named anchors the upgraded grassroots skill turns
// into partner-named playbooks (spirit nights, catering drivers, reciprocal cross-promos).
//
// REUSE, don't rebuild: this calls the SAME `fetchNearbyPlaces` (Google Places
// searchNearby) the venue catalog uses, and mirrors its build → enrich → upsert →
// TTL-refresh cache pattern beat-for-beat. The only new thing is the partner-type
// TAXONOMY + a COARSE audience-size proxy per type (enrollment band / headcount or
// SQFT proxy / venue capacity) — never a fabricated precise headcount; we carry an
// ordinal band + a LOW numeric anchor + a confidence flag, exactly like capacity.
//
// EXPERTS-FIRST: this catalog does NOT decide which orgs matter — it just CATALOGS
// what's nearby, tagged by partner type. The grassroots EXPERTISE (the archetypes'
// mechanics) decides which entity an archetype can anchor on. We deliberately do NOT
// pull "Chamber of Commerce" — Bryan flagged it as old-school/ineffective; the audience
// here is the school's families, the office's staff, the church's congregation, etc.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchNearbyPlaces } from "@/lib/places/google"
import { haversineMiles } from "@/lib/events/geo"

const M_PER_MILE = 1609.34

// ── Partner taxonomy ─────────────────────────────────────────────────────────
// The coarse audience-size proxy is what the grassroots economics scale ON (the org's
// "size proxy"), alongside the location's own check-average. It is intentionally a BAND
// (the LOW anchor + an ordinal label), NEVER a precise headcount — a school's true
// enrollment, an office's true headcount, a hotel's true occupancy are unknown to us.

/** The partner TYPE a grassroots archetype can anchor on. Stable strings — also the
 *  feedback-rollup sub-key the click stream learns by (which partner type lands). */
export type PartnerType =
  | "school" // K-12 / PTA / PTO — spirit-night anchor
  | "youth_sports" // teams/leagues/rec centers — team fundraiser anchor
  | "church" // congregations + boosters — community fundraiser anchor
  | "gym" // gyms / studios — reciprocal cross-promo (post-workout fuel)
  | "office" // offices / coworking — weekday catering / lunch-driver cluster
  | "hospital" // hospitals / clinics — shift-worker catering + late daypart
  | "hotel" // hotels — concierge referral + guest perk
  | "dealership" // car dealerships — waiting-room catering + reciprocal
  | "theater" // movie/live theaters — pre/post-show reciprocal
  | "brewery" // breweries / taprooms (no kitchen) — food-pairing reciprocal
  | "bakery" // bakeries / coffee — daypart-complementary reciprocal
  | "farmers_market" // farmers markets — sampling + dated activation

/** Coarse audience-size confidence: a measured anchor (rare) vs the type prior band. */
export type SizeConfidence = "measured" | "prior"

/** Ordinal audience-size band — what the prose + economics scale on (never a fabricated count). */
export type SizeBand = "small" | "medium" | "large"

export type PartnerEntity = {
  placeId: string | null
  name: string
  partnerType: PartnerType
  /** Raw Google Places primaryType (provenance / debugging). */
  primaryType: string | null
  lat: number | null
  lng: number | null
  distanceMi: number | null
  /** LOW end of the audience-size proxy RANGE (enrollment / headcount / capacity). The
   *  economics scale on this anchor + the ordinal band; we never assert it as a true count. */
  sizeProxyLow: number | null
  sizeProxyHigh: number | null
  sizeBand: SizeBand
  sizeConfidence: SizeConfidence
  /** What the proxy MEASURES, so downstream copy can phrase it honestly
   *  (e.g. "enrollment band", "staff headcount", "rooms"). */
  sizeProxyKind: string
}

// Places includedType → partner type + search ring + audience-size prior (LOW/HIGH) + band + kind.
// One searchNearby call per row (≤20 results) so no category truncates; invalid/empty types fail
// soft in the sweep (try/catch), exactly like the venue catalog. Rings are tuned to grassroots
// REACH: a borrowed-audience play needs the partner CLOSE (families/staff will detour a few minutes,
// not 10 miles), so these rings are TIGHTER than the venue catalog's demand-venue rings.
type PartnerTaxonomyEntry = {
  includedType: string
  partnerType: PartnerType
  radiusMi: number
  sizeLow: number
  sizeHigh: number
  band: SizeBand
  sizeProxyKind: string
}

export const PARTNER_TAXONOMY: PartnerTaxonomyEntry[] = [
  // Schools — the strongest grassroots anchor (spirit nights). Enrollment band as the proxy.
  { includedType: "primary_school", partnerType: "school", radiusMi: 3, sizeLow: 300, sizeHigh: 700, band: "medium", sizeProxyKind: "enrollment band" },
  { includedType: "secondary_school", partnerType: "school", radiusMi: 3, sizeLow: 800, sizeHigh: 2200, band: "large", sizeProxyKind: "enrollment band" },
  { includedType: "school", partnerType: "school", radiusMi: 3, sizeLow: 300, sizeHigh: 1500, band: "medium", sizeProxyKind: "enrollment band" },
  // Youth sports — team/league fundraiser anchor (families per team/league).
  { includedType: "sports_club", partnerType: "youth_sports", radiusMi: 4, sizeLow: 60, sizeHigh: 400, band: "small", sizeProxyKind: "families across teams" },
  { includedType: "sports_activity_location", partnerType: "youth_sports", radiusMi: 4, sizeLow: 60, sizeHigh: 400, band: "small", sizeProxyKind: "families across teams" },
  // Churches / congregations — community fundraiser + bulletin reach.
  { includedType: "church", partnerType: "church", radiusMi: 3, sizeLow: 150, sizeHigh: 1200, band: "medium", sizeProxyKind: "congregation band" },
  { includedType: "place_of_worship", partnerType: "church", radiusMi: 3, sizeLow: 150, sizeHigh: 1200, band: "medium", sizeProxyKind: "congregation band" },
  // Gyms / studios — reciprocal cross-promo (post-workout fuel); members as the audience.
  { includedType: "gym", partnerType: "gym", radiusMi: 2, sizeLow: 200, sizeHigh: 2000, band: "medium", sizeProxyKind: "membership band" },
  { includedType: "fitness_center", partnerType: "gym", radiusMi: 2, sizeLow: 200, sizeHigh: 2000, band: "medium", sizeProxyKind: "membership band" },
  // Offices / coworking — weekday-lunch catering cluster; staff headcount as the proxy.
  { includedType: "corporate_office", partnerType: "office", radiusMi: 1.5, sizeLow: 30, sizeHigh: 500, band: "medium", sizeProxyKind: "staff headcount" },
  { includedType: "coworking_space", partnerType: "office", radiusMi: 1.5, sizeLow: 50, sizeHigh: 400, band: "medium", sizeProxyKind: "member headcount" },
  // Hospitals / clinics — shift-worker catering + a late/off-peak daypart audience.
  { includedType: "hospital", partnerType: "hospital", radiusMi: 3, sizeLow: 300, sizeHigh: 3000, band: "large", sizeProxyKind: "staff headcount" },
  { includedType: "doctor", partnerType: "hospital", radiusMi: 1.5, sizeLow: 20, sizeHigh: 150, band: "small", sizeProxyKind: "staff headcount" },
  // Hotels — concierge referral + a guest-perk audience.
  { includedType: "hotel", partnerType: "hotel", radiusMi: 2, sizeLow: 60, sizeHigh: 400, band: "medium", sizeProxyKind: "rooms" },
  { includedType: "lodging", partnerType: "hotel", radiusMi: 2, sizeLow: 40, sizeHigh: 400, band: "medium", sizeProxyKind: "rooms" },
  // Dealerships — waiting-room catering + reciprocal.
  { includedType: "car_dealer", partnerType: "dealership", radiusMi: 4, sizeLow: 20, sizeHigh: 120, band: "small", sizeProxyKind: "staff headcount" },
  // Theaters — pre/post-show reciprocal (capacity as the audience anchor).
  { includedType: "movie_theater", partnerType: "theater", radiusMi: 3, sizeLow: 300, sizeHigh: 2500, band: "medium", sizeProxyKind: "seats / showings" },
  // Breweries / taprooms (often no kitchen) — food-pairing reciprocal.
  { includedType: "bar", partnerType: "brewery", radiusMi: 1.5, sizeLow: 50, sizeHigh: 300, band: "small", sizeProxyKind: "taproom seats" },
  // Bakeries / coffee — daypart-complementary reciprocal.
  { includedType: "bakery", partnerType: "bakery", radiusMi: 1.5, sizeLow: 30, sizeHigh: 200, band: "small", sizeProxyKind: "daily foot traffic" },
  { includedType: "cafe", partnerType: "bakery", radiusMi: 1.5, sizeLow: 30, sizeHigh: 200, band: "small", sizeProxyKind: "daily foot traffic" },
  // Farmers markets — sampling + a dated weekend activation.
  { includedType: "market", partnerType: "farmers_market", radiusMi: 3, sizeLow: 200, sizeHigh: 3000, band: "medium", sizeProxyKind: "weekend foot traffic" },
]

/** Map a raw Google Places type onto its partner type, or null if it isn't a partner we catalog.
 *  Pure + testable — the populator's type mapping is asserted by the unit test. The FIRST taxonomy
 *  row whose includedType matches wins (taxonomy order is the precedence). */
export function partnerTypeForPlacesType(placesType: string | null | undefined): PartnerType | null {
  if (!placesType) return null
  const hit = PARTNER_TAXONOMY.find((t) => t.includedType === placesType)
  return hit ? hit.partnerType : null
}

/** Human label for a partner type (used in prose / dossier; stable). */
export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  school: "school / PTA",
  youth_sports: "youth sports team or league",
  church: "church / congregation",
  gym: "gym or fitness studio",
  office: "office / coworking",
  hospital: "hospital / clinic",
  hotel: "hotel",
  dealership: "car dealership",
  theater: "theater",
  brewery: "brewery / taproom",
  bakery: "bakery / cafe",
  farmers_market: "farmers market",
}

// ---------------------------------------------------------------------------
// Sweep — build the partner catalog from a lat/lng (network: Places searchNearby)
// ---------------------------------------------------------------------------

export async function buildPartnerCatalog(
  lat: number,
  lng: number,
  opts: { excludePlaceId?: string } = {},
): Promise<PartnerEntity[]> {
  const byPlaceId = new Map<string, PartnerEntity>()

  const consider = (
    p: {
      placeId: string
      name: string
      primaryType: string | null
      lat?: number | null
      lng?: number | null
      distanceMeters: number | null
    },
    t: PartnerTaxonomyEntry,
  ) => {
    if (!p.placeId || p.placeId === opts.excludePlaceId || !p.name) return
    const distanceMi =
      p.distanceMeters != null ? Math.round((p.distanceMeters / M_PER_MILE) * 10) / 10 : null
    const existing = byPlaceId.get(p.placeId)
    // If a place surfaces under multiple type passes, keep the LARGER audience proxy + the
    // first-seen partner type (taxonomy precedence). Mirrors the venue catalog's max-capacity merge.
    if (existing) {
      existing.sizeProxyHigh = Math.max(existing.sizeProxyHigh ?? 0, t.sizeHigh)
      existing.sizeProxyLow = Math.max(existing.sizeProxyLow ?? 0, t.sizeLow)
      return
    }
    byPlaceId.set(p.placeId, {
      placeId: p.placeId,
      name: p.name,
      partnerType: t.partnerType,
      primaryType: p.primaryType,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      distanceMi,
      sizeProxyLow: t.sizeLow,
      sizeProxyHigh: t.sizeHigh,
      sizeBand: t.band,
      sizeConfidence: "prior",
      sizeProxyKind: t.sizeProxyKind,
    })
  }

  for (const t of PARTNER_TAXONOMY) {
    try {
      const places = await fetchNearbyPlaces(lat, lng, {
        includedTypes: [t.includedType],
        radius: Math.round(t.radiusMi * M_PER_MILE),
        maxResultCount: 20,
        excludePlaceId: opts.excludePlaceId,
      })
      for (const p of places) consider(p, t)
    } catch (err) {
      console.warn(`[partner-catalog] type "${t.includedType}" sweep failed:`, String(err))
    }
  }

  return Array.from(byPlaceId.values()).sort(
    (a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity),
  )
}

// ---------------------------------------------------------------------------
// Persistence (mirror of upsertVenueCatalog / loadVenueCatalog / ensureVenueCatalog)
// ---------------------------------------------------------------------------

export async function upsertPartnerCatalog(
  supabase: SupabaseClient,
  locationId: string,
  partners: PartnerEntity[],
): Promise<void> {
  if (partners.length === 0) return
  const rows = partners.map((p) => ({
    location_id: locationId,
    place_id: p.placeId,
    name: p.name,
    partner_type: p.partnerType,
    primary_type: p.primaryType,
    lat: p.lat,
    lng: p.lng,
    distance_mi: p.distanceMi,
    size_proxy_low: p.sizeProxyLow,
    size_proxy_high: p.sizeProxyHigh,
    size_band: p.sizeBand,
    size_confidence: p.sizeConfidence,
    size_proxy_kind: p.sizeProxyKind,
    refreshed_at: new Date().toISOString(),
  }))
  const { error } = await supabase.from("partner_catalog").upsert(rows, { onConflict: "location_id,place_id" })
  if (error) throw new Error(`partner_catalog upsert failed: ${error.message}`)
}

const CATALOG_TTL_DAYS = 90 // partners are static; rebuild quarterly (same as venue catalog)

export async function loadPartnerCatalog(
  supabase: SupabaseClient,
  locationId: string,
): Promise<PartnerEntity[]> {
  // FAIL-SOFT: the partner_catalog table may not exist yet (pre-migration). Any error → [] so a
  // missing table NEVER breaks a brief; the grassroots skill then stays on its number-free fallback.
  try {
    const { data } = await supabase
      .from("partner_catalog")
      .select(
        "place_id,name,partner_type,primary_type,lat,lng,distance_mi,size_proxy_low,size_proxy_high,size_band,size_confidence,size_proxy_kind",
      )
      .eq("location_id", locationId)
      .order("distance_mi", { ascending: true })

    return (data ?? []).map((r) => ({
      placeId: (r.place_id as string | null) ?? null,
      name: r.name as string,
      partnerType: (r.partner_type as PartnerType) ?? "office",
      primaryType: (r.primary_type as string | null) ?? null,
      lat: (r.lat as number | null) ?? null,
      lng: (r.lng as number | null) ?? null,
      distanceMi: (r.distance_mi as number | null) ?? null,
      sizeProxyLow: (r.size_proxy_low as number | null) ?? null,
      sizeProxyHigh: (r.size_proxy_high as number | null) ?? null,
      sizeBand: ((r.size_band as string) ?? "medium") as SizeBand,
      sizeConfidence: ((r.size_confidence as string) ?? "prior") as SizeConfidence,
      sizeProxyKind: (r.size_proxy_kind as string | null) ?? "audience size",
    }))
  } catch (err) {
    console.warn(`[partner-catalog] load failed for ${locationId} (table may be absent):`, String(err))
    return []
  }
}

/** Load the catalog, building it (Places sweep) when missing/stale (>90d). Self-healing + fail-soft,
 *  beat-for-beat the venue catalog's ensure path: the events pipeline (which already has lat/lng +
 *  the service-role client) calls this, so the partner catalog rides the SAME ~quarterly refresh —
 *  no separate onboarding hook to keep in sync. Any error returns whatever is cached (or []). */
export async function ensurePartnerCatalog(
  supabase: SupabaseClient,
  locationId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
  opts: { excludePlaceId?: string; now?: Date } = {},
): Promise<PartnerEntity[]> {
  const now = opts.now ?? new Date()
  try {
    const { data: meta } = await supabase
      .from("partner_catalog")
      .select("refreshed_at")
      .eq("location_id", locationId)
      .order("refreshed_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const refreshedAt = meta?.refreshed_at as string | undefined
    const fresh = refreshedAt && now.getTime() - Date.parse(refreshedAt) < CATALOG_TTL_DAYS * 86400_000
    if (fresh) return loadPartnerCatalog(supabase, locationId)
    if (lat == null || lng == null) return loadPartnerCatalog(supabase, locationId)

    const partners = await buildPartnerCatalog(lat, lng, { excludePlaceId: opts.excludePlaceId })
    await upsertPartnerCatalog(supabase, locationId, partners)
    return partners
  } catch (err) {
    console.warn(`[partner-catalog] ensure failed for ${locationId}:`, String(err))
    return loadPartnerCatalog(supabase, locationId)
  }
}
