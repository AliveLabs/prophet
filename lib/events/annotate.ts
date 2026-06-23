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
import { geocodeVenue, haversineMiles } from "./geo"
import { classifyEventMagnitude, classifyEventRole, isRouteEventTitle } from "./relevance"
import { matchEventToCatalog, isMajorCapacity, type CatalogVenue } from "./venue-catalog"

const GEO_BATCH = 5

export async function annotateEventsGeo(
  events: NormalizedEvent[],
  lat: number,
  lng: number,
  opts: { supabase?: SupabaseClient; catalog?: CatalogVenue[] } = {},
): Promise<void> {
  const catalog = opts.catalog ?? []

  for (let i = 0; i < events.length; i += GEO_BATCH) {
    await Promise.all(
      events.slice(i, i + GEO_BATCH).map(async (e) => {
        const isRoute = e.isRouteEvent ?? isRouteEventTitle(e.title)
        e.isRouteEvent = isRoute

        const pos = await geocodeVenue(e.venue?.name, e.venue?.address, { supabase: opts.supabase })
        if (pos) {
          e.venue = { ...(e.venue ?? {}), lat: pos.lat, lng: pos.lng }
          e.distanceMiles = haversineMiles(lat, lng, pos.lat, pos.lng)

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
        e.role = classifyEventRole(e.distanceMiles, e.magnitude, { isRoute })
      }),
    )
  }
}
