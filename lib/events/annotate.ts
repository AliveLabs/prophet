// ---------------------------------------------------------------------------
// Geo-annotation — stamp distance / catalog-match / magnitude / role on events
//
// Shared by the cron events pipeline AND the manual /events refresh action so both
// paths apply the SAME geo gate (previously the manual path skipped geo entirely,
// surfacing metro-wide events as if local). Geocoding uses the persistent cache
// (pass `supabase`); the catalog enables the rebrand-proof "major" upgrade.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { NormalizedEvent } from "./types"
import { geocodeVenueDetailed, resolveVenueWebsite, haversineMiles } from "./geo"
import { classifyEventMagnitude, classifyEventRole, isRouteEventTitle } from "./relevance"
import { matchEventToCatalog, isMajorCapacity, type CatalogVenue } from "./venue-catalog"
import type { DensityClass } from "@/lib/local/census-density"

const GEO_BATCH = 5

// Per-run cap on website BACKFILL calls (venues geocoded before website capture). The nearest
// few are most likely to be surfaced; the rest fill in over subsequent runs. Bounds the extra
// searchText spend, which decays to zero once the cache is warm. Mirrors the catalog's bounded
// best-effort enrichment (enrichCapacityFromWikidata).
const WEBSITE_BACKFILL_BUDGET = 8

export async function annotateEventsGeo(
  events: NormalizedEvent[],
  lat: number,
  lng: number,
  // R2: pass `densityClass` to scale the foot/traffic relevance ring by true local
  // density. Omitted/undefined → suburban ring = today's exact 0.5/3.0mi (no-op).
  opts: { supabase?: SupabaseClient; catalog?: CatalogVenue[]; densityClass?: DensityClass | null } = {},
): Promise<void> {
  const catalog = opts.catalog ?? []

  for (let i = 0; i < events.length; i += GEO_BATCH) {
    await Promise.all(
      events.slice(i, i + GEO_BATCH).map(async (e) => {
        const isRoute = e.isRouteEvent ?? isRouteEventTitle(e.title)
        e.isRouteEvent = isRoute

        const pos = await geocodeVenueDetailed(e.venue?.name, e.venue?.address, { supabase: opts.supabase })
        if (pos) {
          e.venue = { ...(e.venue ?? {}), lat: pos.lat, lng: pos.lng }
          e.distanceMiles = haversineMiles(lat, lng, pos.lat, pos.lng)
          // The venue's official website rode along on the geocode call (free on a miss). It
          // lets pickEventDeepLink land on a real venue site instead of a generic bureau page.
          if (pos.website) e.venueWebsite = pos.website

          // Catalog coordinate-match: inherit capacity + a deterministic "major"
          // upgrade. Rebrand-proof (fixes "Dallas Stadium", which the title regex
          // can't catch) because it matches on COORDINATES, not name.
          const match = matchEventToCatalog(pos.lat, pos.lng, catalog)
          if (match) {
            e.catalogVenueName = match.name
            e.capacityLow = match.capacityLow
            e.capacityHigh = match.capacityHigh
            e.capacityConfidence = match.capacityConfidence
          }
        } else {
          e.distanceMiles = null
        }

        const baseMagnitude = classifyEventMagnitude(e)
        e.magnitude = isMajorCapacity(e.capacityHigh) ? "major" : baseMagnitude
        e.role = classifyEventRole(e.distanceMiles, e.magnitude, { isRoute, densityClass: opts.densityClass })
      }),
    )
  }

  // ── Website backfill (bounded) ──────────────────────────────────────────────
  // A venue geocoded BEFORE website capture has a cache row with no website, so the geocode
  // above returns it from cache without one. Resolve the nearest few such venues' official sites
  // (a website-only searchText each, persisted back onto the cache row) so existing locations
  // fill in over a few runs instead of staying inert. Bounded by WEBSITE_BACKFILL_BUDGET +
  // fail-soft; needs a supabase client to read/write the cache. New venues already got their
  // website on the geocode call above and are skipped here.
  if (opts.supabase) {
    const needWebsite = events
      .filter((e) => e.venue?.lat != null && !e.venueWebsite && (e.venue?.name || e.venue?.address))
      .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
      .slice(0, WEBSITE_BACKFILL_BUDGET)
    await Promise.all(
      needWebsite.map(async (e) => {
        const site = await resolveVenueWebsite(e.venue?.name, e.venue?.address, { supabase: opts.supabase })
        if (site) e.venueWebsite = site
      }),
    )
  }
}
