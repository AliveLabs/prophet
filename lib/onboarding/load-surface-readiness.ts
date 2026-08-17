// The read half of the surface readiness gate (ALT-629). Every rule lives next door in
// ./surface-readiness (pure, unit-tested); this only fetches rows and hands them over.
//
// One indexed single-location query, no joins, no vendor calls. Cheap enough to sit at the top of
// every gated page, which is the point: a gate that pages skip because it is expensive is not a
// gate. Read with the ADMIN client because `signal_jobs` carries no RLS policy for operators, and
// the caller has already resolved the location through the user-scoped client.
//
// FAILS OPEN on any error, matching the pure module: if we cannot read the queue we render the
// page. Hiding a working surface because a SELECT failed is a worse outage than the partial render
// this was built to prevent.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  surfaceReadiness,
  surfaceReadinessMap,
  type SurfaceJobRead,
  type SurfaceKey,
  type SurfaceReadiness,
} from "./surface-readiness"

/**
 * Every job row on the location. Bounded: a location accumulates one row per pipeline per run, and
 * readiness only ever asks "has this pipeline EVER settled", so the newest rows answer it. The cap
 * is a runaway guard, not a filter.
 */
async function loadJobs(locationId: string): Promise<SurfaceJobRead[]> {
  try {
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin
      .from("signal_jobs")
      .select("pipeline, status")
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(400)
    if (error) {
      console.warn("[surface-readiness] job read failed, rendering anyway:", error.message)
      return []
    }
    return (data ?? []) as SurfaceJobRead[]
  } catch (err) {
    console.warn("[surface-readiness] job read threw, rendering anyway:", err)
    return []
  }
}

/** Whether one surface may render for this location. */
export async function loadSurfaceReadiness(
  surface: SurfaceKey,
  locationId: string | null | undefined,
): Promise<SurfaceReadiness> {
  // No location = nothing to gate; the page's own "add your location" path owns that case.
  if (!locationId) return { state: "ready", pending: [], headline: "", detail: "" }
  return surfaceReadiness(surface, await loadJobs(locationId))
}

/** Several surfaces from one read, for pages that span more than one. */
export async function loadSurfaceReadinessMap(
  surfaces: readonly SurfaceKey[],
  locationId: string | null | undefined,
): Promise<Record<string, SurfaceReadiness>> {
  if (!locationId) return surfaceReadinessMap(surfaces, [])
  return surfaceReadinessMap(surfaces, await loadJobs(locationId))
}
