// ---------------------------------------------------------------------------
// Events Pipeline – step definitions
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { asSubscriptionTier, type SubscriptionTier } from "@/lib/billing/tiers"
import { getEventsQueriesPerRun, getEventsMaxDepth } from "@/lib/billing/limits"
import { fetchGoogleEvents } from "@/lib/providers/dataforseo/google-events"
import { fetchGroundedEvents, GroundedEventsError } from "@/lib/providers/gemini/google-events"
import { normalizeEventsSnapshot } from "@/lib/events/normalize"
import { normalizeGroundedEvents } from "@/lib/events/normalize-grounded"
import { mergeEventSnapshots } from "@/lib/events/merge"
import { computeEventsSnapshotDiffHash } from "@/lib/events/hash"
import { matchEventsToCompetitors } from "@/lib/events/match"
import {
  generateEventInsights,
  type InsightContext,
} from "@/lib/events/insights"
import type {
  EventsQuery,
  NormalizedEventsSnapshotV1,
} from "@/lib/events/types"
import { fetchPlaceDetails } from "@/lib/places/google"
import { annotateEventsGeo } from "@/lib/events/annotate"
import { buildEventQueryPlan } from "@/lib/events/keywords"
import { ensureVenueCatalog } from "@/lib/events/venue-catalog"
import { ensurePartnerCatalog } from "@/lib/local/partner-catalog"
import { loadFixtureIndex } from "@/lib/events/fixtures/loader"
import { validateEvents } from "@/lib/events/validate"
import { ensureLocationBaseline } from "@/lib/events/baseline"
import { ensureLocationDensity, ensureLocationDensityClass } from "@/lib/events/density"
import { deriveServiceModel, deriveHoursGate } from "@/lib/events/service-model"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type EventsPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  tier: SubscriptionTier
  location: {
    id: string
    name: string | null
    city: string | null
    region: string | null
    country: string | null
    primary_place_id: string | null
    geo_lat: number | null
    geo_lng: number | null
  }
  dateKey: string
  state: {
    snapshot: NormalizedEventsSnapshotV1 | null
    matchRecords: Array<Record<string, unknown>>
    warnings: string[]
  }
}

function buildLocationName(location: {
  city?: string | null
  region?: string | null
  country?: string | null
}): string {
  return [location.city, location.region, location.country ?? "United States"]
    .filter(Boolean)
    .join(",")
}

function getPreviousDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ── Events source flag (Events source migration · P0) ───────────────────────
// Unknown/unset → "dataforseo": the source-swap is DARK by default, so this pipeline is
// byte-identical to pre-migration behavior until EVENTS_SOURCE is flipped globally.
//   grounded — Gemini google_search grounding only (DataForSEO is the sole fallback on a throw)
//   hybrid   — DataForSEO breadth + grounded accuracy, merged (grounded identity wins)
// Per-location canary override (Phase 2) is a deliberate follow-up — not wired here.
const GROUNDED_MAX_EVENTS = 25

export function resolveEventsSource(): "dataforseo" | "grounded" | "hybrid" {
  const v = (process.env.EVENTS_SOURCE ?? "").toLowerCase().trim()
  return v === "grounded" || v === "hybrid" ? v : "dataforseo"
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

export function buildEventsSteps(): PipelineStepDef<EventsPipelineCtx>[] {
  return [
    {
      name: "fetch_events",
      label: "Fetching local events",
      // When the grounded/hybrid source is active, a TOTAL fetch failure (grounded threw AND the
      // DataForSEO fallback threw) must FAIL the job → retry, never launder stale data to "done"
      // (risk #3). On the default DataForSEO path this stays falsy — today's exact behavior.
      critical: resolveEventsSource() !== "dataforseo",
      run: async (c) => {
        const locationName = buildLocationName(c.location)
        const maxQueries = getEventsQueriesPerRun(c.tier)
        const depth = getEventsMaxDepth(c.tier)

        // L0/L1: probe DataForSEO BY the marquee venues cataloged near this location
        // (catches the stadium mega-event that generic "events" buries) + a generic
        // net, all within the same per-run query budget. Falls back to generic
        // "events" when no catalog exists yet (cold start / venue-less area).
        const catalog = await ensureVenueCatalog(
          c.supabase,
          c.locationId,
          c.location.geo_lat,
          c.location.geo_lng,
          { excludePlaceId: c.location.primary_place_id ?? undefined },
        )
        // P16 §4.1: populate the grassroots partner-entity catalog on the SAME beat as the venue
        // catalog (shared lat/lng + service-role client + ~quarterly TTL refresh). Fail-soft — its
        // own try/catch returns whatever is cached (or []) so a partner-sweep blip never aborts the
        // events run, and a missing partner_catalog table is a silent no-op until Bryan migrates.
        try {
          await ensurePartnerCatalog(
            c.supabase,
            c.locationId,
            c.location.geo_lat,
            c.location.geo_lng,
            { excludePlaceId: c.location.primary_place_id ?? undefined },
          )
        } catch (err) {
          c.state.warnings.push(`Partner catalog refresh skipped: ${String(err)}`)
        }
        // ── Source selection (Events source migration · P0). Default "dataforseo" runs the
        // exact original path below; grounded/hybrid activate the Gemini-grounded source. ──
        const source = resolveEventsSource()

        // DataForSEO breadth fetch, encapsulated so grounded/hybrid reuse it as the fallback.
        const fetchDataForSeoSnapshot = async (): Promise<NormalizedEventsSnapshotV1> => {
          const queryDefs = buildEventQueryPlan({ catalog, maxQueries, dateKey: c.dateKey })
          const rawResults = await Promise.all(
            queryDefs.map((q) =>
              fetchGoogleEvents({
                keyword: q.keyword,
                locationName,
                dateRange: q.dateRange,
                depth,
                lat: c.location.geo_lat,
                lng: c.location.geo_lng,
              })
            )
          )
          const queries: EventsQuery[] = queryDefs.map((q) => ({
            keyword: q.keyword,
            locationName,
            dateRange: q.dateRange,
            depth,
          }))
          return normalizeEventsSnapshot(rawResults, queries)
        }

        if (source === "dataforseo") {
          c.state.snapshot = await fetchDataForSeoSnapshot()
        } else {
          // DataForSEO is best-effort breadth for hybrid; the sole fallback for grounded.
          let dfSnapshot: NormalizedEventsSnapshotV1 | null = null
          if (source === "hybrid") {
            try {
              dfSnapshot = await fetchDataForSeoSnapshot()
            } catch (e) {
              c.state.warnings.push(`[events] hybrid: DataForSEO breadth unavailable: ${errMessage(e)}`)
            }
          }
          try {
            const grounded = await fetchGroundedEvents({
              locationName,
              lat: c.location.geo_lat,
              lng: c.location.geo_lng,
              maxEvents: GROUNDED_MAX_EVENTS,
            })
            // Well-formed empty is a real "nothing on", not a failure — flag it as a per-location
            // zero-events anomaly (telemetry, risk #3) but don't force a fallback.
            if (grounded.length === 0) {
              c.state.warnings.push(`[events] grounded returned 0 events for ${c.location.name ?? c.locationId}`)
            }
            const groundedSnapshot = normalizeGroundedEvents(grounded, {
              queries: [{ keyword: "grounded", locationName, dateRange: "month", depth: 0 }],
              horizon: "month",
            })
            c.state.snapshot = dfSnapshot
              ? mergeEventSnapshots(dfSnapshot, groundedSnapshot)
              : groundedSnapshot
          } catch (gErr) {
            // A grounded THROW is a SIGNAL, never "no events" — fall back to DataForSEO so a Gemini
            // blip can't zero the demand rail (risk #3). Log the distinct code (quota/http/parse).
            const code = gErr instanceof GroundedEventsError ? gErr.code : "unknown"
            c.state.warnings.push(`[events] grounded fetch failed (${code}) — falling back to DataForSEO: ${errMessage(gErr)}`)
            console.warn(`[events] grounded fetch failed for ${c.location.name ?? c.locationId}`, gErr)
            // Hybrid: reuse the breadth base if we got one. Grounded: fetch DataForSEO now. If THAT
            // also throws it propagates → step fails → (critical) → retry, never a silent empty.
            c.state.snapshot = dfSnapshot ?? (await fetchDataForSeoSnapshot())
          }
        }

        // ── Geo-relevance (Layer 1/2): geography is the event's content_as_of. ──
        // Geocode each venue, measure distance, catalog-match for a rebrand-proof
        // magnitude upgrade, classify role. "Returned by the search" is NOT "nearby".
        if (c.location.geo_lat != null && c.location.geo_lng != null) {
          // R2: resolve the TRUE-density CLASS (Census) to scale the relevance ring. null
          // when no CENSUS_API_KEY / Census fails → annotate uses the suburban 0.5/3.0mi ring
          // (byte-identical to today). Cached, so the tier lookup below reuses it.
          const densityClass = await ensureLocationDensityClass(
            c.supabase,
            c.locationId,
            c.location.geo_lat,
            c.location.geo_lng,
          )
          await annotateEventsGeo(c.state.snapshot.events, c.location.geo_lat, c.location.geo_lng, {
            supabase: c.supabase,
            catalog,
            densityClass,
          })

          // ── Validation gate (P13 R1): VALIDATE-then-rank. Resolve a stable venue identity,
          // cross-check scheduled-league listings against the authoritative fixture schedule
          // (WC2026 seed; fail-soft to in-code seed when the `fixtures` table is absent), and
          // write VALIDATED FIELDS + a possibly-downgraded role back onto each event. This is
          // the World Cup mis-location/mis-dating fix: an unresolved venue can never claim local,
          // and a league listing at the wrong venue/date is downgraded to metro_hook BEFORE it
          // reaches the local snapshot or any demand reasoning. Dedupes by (venue,date,title).
          const fixtureIndex = await loadFixtureIndex(c.supabase)
          const validated = validateEvents(c.state.snapshot.events, catalog, fixtureIndex)
          // Dedupe collapses the snapshot to the surviving (strongest) occurrences.
          c.state.snapshot.events = validated.map((v) => {
            const e = v.event
            e.role = v.role
            e.venueConfidence = v.venueConfidence
            e.validatedVenueName = v.fields.canonicalVenue
            e.authoritativeLocalStart = v.fields.authoritativeLocalStart
            e.fixtureRef = v.fields.fixtureRef
            e.leagueValidated = v.leagueValidated
            return e
          })
          c.state.snapshot.summary.totalEvents = c.state.snapshot.events.length

          const roles = c.state.snapshot.events.reduce<Record<string, number>>((acc, e) => {
            const r = e.role ?? "ungeocoded"
            acc[r] = (acc[r] ?? 0) + 1
            return acc
          }, {})
          const downgrades = validated.filter((v) => v.downgradeReason).length
          console.log(
            `[Events] geo roles for ${c.location.name}:`,
            JSON.stringify(roles),
            `| validation downgrades: ${downgrades}`,
          )
        } else {
          c.state.warnings.push("Location has no geo coordinates — events left ungeocoded (no local-demand claims)")
          for (const e of c.state.snapshot.events) e.role = "ungeocoded"
        }

        const diffHash = computeEventsSnapshotDiffHash(c.state.snapshot)

        await c.supabase.from("location_snapshots").upsert(
          {
            location_id: c.locationId,
            provider: "dataforseo_google_events",
            date_key: c.dateKey,
            captured_at: new Date().toISOString(),
            raw_data: c.state.snapshot as unknown as Record<string, unknown>,
            diff_hash: diffHash,
          },
          { onConflict: "location_id,provider,date_key" }
        )

        return { eventsFound: c.state.snapshot.events.length }
      },
    },
    {
      name: "match_competitors",
      label: "Matching events to competitors",
      run: async (c) => {
        if (!c.state.snapshot) return { matches: 0 }

        const { data: approvedCompetitors } = await c.supabase
          .from("competitors")
          .select("id, name, address, website, metadata, is_active")
          .eq("location_id", c.locationId)
          .eq("is_active", true)

        const competitors = (approvedCompetitors ?? [])
          .filter((comp) => {
            const meta = comp.metadata as Record<string, unknown> | null
            return meta?.status === "approved"
          })
          .map((comp) => ({
            id: comp.id,
            name: comp.name,
            address: comp.address,
            website: comp.website,
          }))

        const matchRecords = matchEventsToCompetitors(
          c.state.snapshot.events,
          competitors,
          { locationId: c.locationId, dateKey: c.dateKey }
        )
        c.state.matchRecords = matchRecords as unknown as Array<
          Record<string, unknown>
        >

        if (matchRecords.length > 0) {
          await c.supabase
            .from("event_matches")
            .delete()
            .eq("location_id", c.locationId)
            .eq("date_key", c.dateKey)

          await c.supabase.from("event_matches").insert(matchRecords)
        }

        return { matches: matchRecords.length }
      },
    },
    {
      name: "generate_event_insights",
      label: "Generating event insights",
      run: async (c) => {
        if (!c.state.snapshot) return { insights: 0 }

        const previousDateKey = getPreviousDateKey(c.dateKey, 1)

        const { data: prevSnapRow } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "dataforseo_google_events")
          .eq("date_key", previousDateKey)
          .maybeSingle()
        const previousSnapshot =
          prevSnapRow?.raw_data as NormalizedEventsSnapshotV1 | null

        const { data: prevMatchRows } = await c.supabase
          .from("event_matches")
          .select("*")
          .eq("location_id", c.locationId)
          .eq("date_key", previousDateKey)

        const { data: approvedCompetitors } = await c.supabase
          .from("competitors")
          .select("id, name, metadata, is_active")
          .eq("location_id", c.locationId)
          .eq("is_active", true)

        const insightContext: InsightContext = {
          locationName: c.location.name ?? "Your location",
          locationRating: null,
          locationReviewCount: null,
          competitors: (approvedCompetitors ?? [])
            .filter((comp) => {
              const meta = comp.metadata as Record<string, unknown> | null
              return meta?.status === "approved"
            })
            .map((comp) => {
              const meta = comp.metadata as Record<string, unknown> | null
              const pd = meta?.placeDetails as Record<string, unknown> | null
              return {
                id: comp.id,
                name: comp.name ?? null,
                rating: (pd?.rating as number | null) ?? null,
                reviewCount: (pd?.reviewCount as number | null) ?? null,
              }
            }),
        }

        // Fetch location rating + service-model/daypart signals (one Places call).
        try {
          if (c.location.primary_place_id) {
            const details = await fetchPlaceDetails(c.location.primary_place_id)
            insightContext.locationRating =
              typeof details.rating === "number" ? details.rating : null
            insightContext.locationReviewCount =
              typeof details.userRatingCount === "number"
                ? details.userRatingCount
                : null
            insightContext.serviceModel = deriveServiceModel(details)
            insightContext.hours = deriveHoursGate(details)
          }
        } catch {
          /* non-critical */
        }

        // Impact-model inputs: density tier + the restaurant's own baseline curve
        // (cached; refreshed weekly off the synchronous path). Both fail soft.
        insightContext.densityTier = await ensureLocationDensity(
          c.supabase,
          c.locationId,
          c.location.geo_lat,
          c.location.geo_lng,
        )
        insightContext.baselineCurveByDow = await ensureLocationBaseline(
          c.supabase,
          c.locationId,
          c.location.primary_place_id,
        )

        // Geo gate: only LOCAL events (≤3mi tiers) may generate "nearby event"
        // insights — a metro-wide search result is not local demand. metro_hook
        // events stay in the stored snapshot (the brief's marketing-hook channel)
        // but never produce density/high-signal "nearby" claims.
        const localEvents = c.state.snapshot.events.filter(
          (e) => e.role === "local_foot" || e.role === "local_traffic"
        )
        const localSnapshot = {
          ...c.state.snapshot,
          events: localEvents,
          summary: { ...c.state.snapshot.summary, totalEvents: localEvents.length },
        }
        const localPrevious = previousSnapshot
          ? {
              ...previousSnapshot,
              events: (previousSnapshot.events ?? []).filter(
                (e) => e.role === "local_foot" || e.role === "local_traffic"
              ),
            }
          : previousSnapshot

        const insights = generateEventInsights({
          current: localSnapshot,
          previous: localPrevious,
          matches:
            c.state.matchRecords as unknown as Parameters<
              typeof generateEventInsights
            >[0]["matches"],
          previousMatches: prevMatchRows ?? null,
          locationId: c.locationId,
          dateKey: c.dateKey,
          context: insightContext,
          // Full geo-annotated list (incl. route_corridor) for the impact rule; legacy
          // rules keep using the local snapshot above.
          allEvents: c.state.snapshot.events,
        })

        if (insights.length > 0) {
          const insightsPayload = insights.map((insight) => ({
            location_id: c.locationId,
            competitor_id: insight.evidence?.competitor_id
              ? String(insight.evidence.competitor_id)
              : null,
            date_key: c.dateKey,
            insight_type: insight.insight_type,
            title: insight.title,
            summary: insight.summary,
            confidence: insight.confidence,
            severity: insight.severity,
            evidence: insight.evidence,
            recommendations: insight.recommendations,
            status: "new",
          }))

          await c.supabase.from("insights").upsert(insightsPayload, {
            onConflict: "location_id,competitor_id,date_key,insight_type",
          })
        }

        return { insights: insights.length }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export async function buildEventsContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<EventsPipelineCtx> {
  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()
  const tier = asSubscriptionTier(org?.subscription_tier)

  const { data: location } = await supabase
    .from("locations")
    .select(
      "id, name, city, region, country, geo_lat, geo_lng, organization_id, primary_place_id"
    )
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!location) throw new Error("Location not found")

  return {
    supabase,
    locationId,
    organizationId,
    tier,
    location: {
      id: location.id,
      name: location.name,
      city: location.city,
      region: location.region,
      country: location.country,
      primary_place_id: location.primary_place_id,
      geo_lat: location.geo_lat,
      geo_lng: location.geo_lng,
    },
    dateKey: new Date().toISOString().slice(0, 10),
    state: {
      snapshot: null,
      matchRecords: [],
      warnings: [],
    },
  }
}
