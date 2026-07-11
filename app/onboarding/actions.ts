"use server"

import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { triggerInitialLocationData } from "@/lib/jobs/triggers"
import {
  fetchPlaceDetails,
  fetchNearbyPlaces,
  mapPlaceToLocation,
  type DiscoveredCompetitor as NearbyPlace,
} from "@/lib/places/google"
import { scoreCompetitor, EXCLUDED_COMPETITOR_TYPES } from "@/lib/providers/scoring"
import { generateStructured } from "@/lib/ai/provider"
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
import { enqueueFirstRun } from "@/lib/jobs/queue"
import { rateLimit } from "@/lib/http/rate-limit"
import { asSubscriptionTier, type SubscriptionTier, TIER_LIMITS } from "@/lib/billing/tiers"
import { ensureCanAddLocation } from "@/lib/billing/limits"
import { isTrialActive } from "@/lib/billing/trial"
import type { Json } from "@/types/database.types"
import { sendEmail } from "@/lib/email/send"
import { Welcome } from "@/lib/email/templates/welcome"

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

export async function createOrganizationAction(formData: FormData) {
  const user = await requireUser()
  const supabaseAdmin = createAdminSupabaseClient()

  const organizationName = String(formData.get("organization_name") ?? "").trim()
  const organizationSlug = String(formData.get("organization_slug") ?? "").trim()
  const locationName = String(formData.get("location_name") ?? "").trim()
  const primaryPlaceId = String(formData.get("primary_place_id") ?? "").trim()
  const category = String(formData.get("category") ?? "").trim() || null
  const placeTypesRaw = String(formData.get("place_types") ?? "[]")
  let placeTypes: string[] = []
  try {
    placeTypes = JSON.parse(placeTypesRaw)
  } catch {
    placeTypes = []
  }

  if (!organizationName || !locationName || !primaryPlaceId) {
    redirect("/onboarding?error=Missing%20required%20fields")
  }

  const slug = organizationSlug ? slugify(organizationSlug) : slugify(organizationName)
  if (!slug) {
    redirect("/onboarding?error=Organization%20slug%20is%20invalid")
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .insert({
      name: organizationName,
      slug,
      billing_email: user.email ?? null,
    })
    .select("id")
    .single()

  if (orgError || !org) {
    redirect(`/onboarding?error=${encodeURIComponent(orgError?.message ?? "Failed to create organization")}`)
  }

  const { error: memberError } = await supabaseAdmin
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: user.id,
      role: "owner",
    })

  if (memberError) {
    redirect(`/onboarding?error=${encodeURIComponent(memberError.message)}`)
  }

  const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
    id: user.id,
    email: user.email ?? null,
    current_organization_id: org.id,
  })

  if (profileError) {
    redirect(`/onboarding?error=${encodeURIComponent(profileError.message)}`)
  }

  const geoLatValue = String(formData.get("geo_lat") ?? "").trim()
  const geoLngValue = String(formData.get("geo_lng") ?? "").trim()
  const geoLat = geoLatValue ? Number.parseFloat(geoLatValue) : null
  const geoLng = geoLngValue ? Number.parseFloat(geoLngValue) : null

  const website = String(formData.get("website") ?? "").trim() || null

  const { data: newLocation, error: locationError } = await supabaseAdmin
    .from("locations")
    .insert({
      organization_id: org.id,
      name: locationName,
      address_line1: String(formData.get("address_line1") ?? "").trim() || null,
      address_line2: String(formData.get("address_line2") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      region: String(formData.get("region") ?? "").trim() || null,
      postal_code: String(formData.get("postal_code") ?? "").trim() || null,
      country: String(formData.get("country") ?? "").trim() || "US",
      timezone: String(formData.get("timezone") ?? "").trim() || "America/New_York",
      primary_place_id: primaryPlaceId || null,
      website,
      settings: {
        category,
        types: placeTypes,
      },
      geo_lat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
      geo_lng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
    })
    .select("id")
    .single()

  if (locationError || !newLocation) {
    redirect(`/onboarding?error=${encodeURIComponent(locationError?.message ?? "Failed to create location")}`)
  }

  // Fire-and-forget: initial data collection (content scrape + weather)
  triggerInitialLocationData(newLocation.id, org.id, {
    website,
    geoLat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
    geoLng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
  }).catch(() => {})

  redirect(
    `/competitors?location_id=${newLocation.id}&onboarding=true`
  )
}

export async function createLocationAction(formData: FormData) {
  const user = await requireUser()
  const supabaseAdmin = createAdminSupabaseClient()

  const organizationId = String(formData.get("organization_id") ?? "").trim()
  const locationName = String(formData.get("location_name") ?? "").trim()
  const primaryPlaceId = String(formData.get("primary_place_id") ?? "").trim()

  if (!organizationId || !locationName) {
    redirect("/onboarding?error=Missing%20required%20fields")
  }

  const { data: membership } = await supabaseAdmin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) {
    redirect("/onboarding?error=Unauthorized")
  }

  const { data: orgRow } = await supabaseAdmin
    .from("organizations")
    .select("subscription_tier, trial_ends_at, payment_state, org_kind")
    .eq("id", organizationId)
    .maybeSingle()

  const { count: locationCount } = await supabaseAdmin
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)

  try {
    if (!orgRow) throw new Error("Organization not found")
    ensureCanAddLocation(orgRow, locationCount ?? 0)
  } catch (err) {
    redirect(`/onboarding?error=${encodeURIComponent(String(err instanceof Error ? err.message : err))}`)
  }

  const geoLatValue = String(formData.get("geo_lat") ?? "").trim()
  const geoLngValue = String(formData.get("geo_lng") ?? "").trim()
  const geoLat = geoLatValue ? Number.parseFloat(geoLatValue) : null
  const geoLng = geoLngValue ? Number.parseFloat(geoLngValue) : null

  const website = String(formData.get("website") ?? "").trim() || null

  const { data: newLocation, error: locationError } = await supabaseAdmin
    .from("locations")
    .insert({
      organization_id: organizationId,
      name: locationName,
      address_line1: String(formData.get("address_line1") ?? "").trim() || null,
      address_line2: String(formData.get("address_line2") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      region: String(formData.get("region") ?? "").trim() || null,
      postal_code: String(formData.get("postal_code") ?? "").trim() || null,
      country: String(formData.get("country") ?? "").trim() || "US",
      timezone: String(formData.get("timezone") ?? "").trim() || "America/New_York",
      primary_place_id: primaryPlaceId || null,
      website,
      geo_lat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
      geo_lng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
    })
    .select("id")
    .single()

  if (locationError || !newLocation) {
    redirect(`/onboarding?error=${encodeURIComponent(locationError?.message ?? "Failed to create location")}`)
  }

  // Fire-and-forget: initial data collection
  triggerInitialLocationData(newLocation.id, organizationId, {
    website,
    geoLat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
    geoLng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
  }).catch(() => {})

  redirect("/home")
}

// ---------------------------------------------------------------------------
// New wizard actions (do NOT modify existing actions above)
// ---------------------------------------------------------------------------

type CreateOrgInput = {
  businessName: string
  cuisine: string | null
  industryType?: string
  place: {
    primary_place_id: string
    name: string
    category?: string | null
    types?: string[]
    address_line1: string | null
    city: string | null
    region: string | null
    postal_code: string | null
    country: string | null
    geo_lat: number | null
    geo_lng: number | null
    website?: string | null
  }
}

export async function createOrgAndLocationAction(
  input: CreateOrgInput
): Promise<
  { ok: true; orgId: string; locationId: string } | { ok: false; error: string }
> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  const baseSlug = slugify(input.businessName)
  if (!baseSlug) {
    return { ok: false, error: "Business name produces an invalid slug" }
  }

  // Retry slug with numeric suffix on collision (up to 5 attempts)
  let org: { id: string } | null = null
  let slugAttempt = baseSlug
  for (let attempt = 0; attempt < 5; attempt++) {
    const shouldSetIndustry =
      process.env.VERTICALIZATION_ENABLED === "true" && input.industryType

    // No trial clock at creation: the trial starts at Stripe checkout
    // (/onboarding/trial — mid tier, 14 days, card required). Until then the
    // org is blocked from recurring pulls/dashboard by the null clock; the
    // first_run pull during onboarding is deliberate acquisition cost.
    const { data, error } = await admin
      .from("organizations")
      .insert({
        name: input.businessName,
        slug: slugAttempt,
        billing_email: user.email ?? null,
        subscription_tier: "mid",
        ...(shouldSetIndustry ? { industry_type: input.industryType } : {}),
      })
      .select("id")
      .single()

    if (!error && data) {
      org = data
      break
    }

    if (error?.code === "23505") {
      slugAttempt = `${baseSlug}-${attempt + 2}`
      continue
    }

    return { ok: false, error: error?.message ?? "Failed to create organization" }
  }

  if (!org) {
    return { ok: false, error: "All slug variants are taken" }
  }

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: user.id,
      role: "owner",
    })

  if (memberError) {
    return { ok: false, error: memberError.message }
  }

  const geoLat = Number.isFinite(input.place.geo_lat) ? input.place.geo_lat : null
  const geoLng = Number.isFinite(input.place.geo_lng) ? input.place.geo_lng : null

  const { data: loc, error: locError } = await admin
    .from("locations")
    .insert({
      organization_id: org.id,
      name: input.place.name || input.businessName,
      address_line1: input.place.address_line1 ?? null,
      city: input.place.city ?? null,
      region: input.place.region ?? null,
      postal_code: input.place.postal_code ?? null,
      country: input.place.country ?? "US",
      timezone: "America/New_York",
      primary_place_id: input.place.primary_place_id ?? null,
      website: input.place.website ?? null,
      geo_lat: geoLat,
      geo_lng: geoLng,
      settings: {
        category: input.cuisine ?? input.place.category ?? null,
        types: input.place.types ?? [],
      },
    })
    .select("id")
    .single()

  if (locError || !loc) {
    return { ok: false, error: locError?.message ?? "Failed to create location" }
  }

  triggerInitialLocationData(loc.id, org.id, {
    website: input.place.website ?? null,
    geoLat,
    geoLng,
  }).catch(() => {})

  return { ok: true, orgId: org.id, locationId: loc.id }
}

type CreateLocationForOrgInput = {
  orgId: string
  cuisine: string | null
  businessName?: string
  place: CreateOrgInput["place"]
}

/**
 * Attach a FIRST location to an EXISTING org and kick initial data — the
 * "setup mode" counterpart to createOrgAndLocationAction. Used when an admin
 * completes a demo/test org (created as a bare placeholder) through the same
 * onboarding wizard, and (later) when a member adds a location to an org they
 * already belong to. Membership-gated + ensureCanAddLocation; NEVER creates an
 * org. This is the keystone that decouples provisioning from new-account signup.
 */
export async function createLocationForOrgAction(
  input: CreateLocationForOrgInput
): Promise<{ ok: true; locationId: string } | { ok: false; error: string }> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  const { data: membership } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", input.orgId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) {
    return { ok: false, error: "You are not a member of this organization." }
  }

  const { data: orgRow } = await admin
    .from("organizations")
    .select("subscription_tier, trial_ends_at, payment_state, org_kind")
    .eq("id", input.orgId)
    .maybeSingle()

  if (!orgRow) {
    return { ok: false, error: "Organization not found." }
  }

  const { count: locationCount } = await admin
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", input.orgId)

  try {
    ensureCanAddLocation(orgRow, locationCount ?? 0)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const geoLat = Number.isFinite(input.place.geo_lat) ? input.place.geo_lat : null
  const geoLng = Number.isFinite(input.place.geo_lng) ? input.place.geo_lng : null

  const { data: loc, error: locError } = await admin
    .from("locations")
    .insert({
      organization_id: input.orgId,
      name: input.place.name || input.businessName || "New location",
      address_line1: input.place.address_line1 ?? null,
      city: input.place.city ?? null,
      region: input.place.region ?? null,
      postal_code: input.place.postal_code ?? null,
      country: input.place.country ?? "US",
      timezone: "America/New_York",
      primary_place_id: input.place.primary_place_id ?? null,
      website: input.place.website ?? null,
      geo_lat: geoLat,
      geo_lng: geoLng,
      settings: {
        category: input.cuisine ?? input.place.category ?? null,
        types: input.place.types ?? [],
      },
    })
    .select("id")
    .single()

  if (locError || !loc) {
    return { ok: false, error: locError?.message ?? "Failed to create location" }
  }

  triggerInitialLocationData(loc.id, input.orgId, {
    website: input.place.website ?? null,
    geoLat,
    geoLng,
  }).catch(() => {})

  return { ok: true, locationId: loc.id }
}

// ---------------------------------------------------------------------------
// Competitor discovery — identity-aware, no redirect.
//
// Recall: Places searchNearby tiled over type families (fast, complete, real
// place IDs). Identity: the target's own Places details (editorial summary +
// serves* + price) — primaryType alone is uselessly generic. Precision: one
// Sonnet call scores every candidate 0-100 ("would the operator consider this
// a direct competitor?") with a plain-language why; on any model failure the
// heuristic score ranks instead (discovery never hard-fails on the model).
//
// The old shape (Gemini grounded discovery fed the typed keyword AS the target
// business name, distance-dominant scoring, substring "same cuisine") produced
// the la Madeleine incident: a French bakery-café "competing" with steakhouses
// and cocktail bars. See lib/competitors/discover.ts for the probe-validated
// design notes.
// ---------------------------------------------------------------------------

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function haversineMeters(input: {
  lat1: number
  lng1: number
  lat2: number
  lng2: number
}) {
  const R = 6371000
  const dLat = toRadians(input.lat2 - input.lat1)
  const dLng = toRadians(input.lng2 - input.lng1)
  const lat1 = toRadians(input.lat1)
  const lat2 = toRadians(input.lat2)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

type DiscoveredCompetitor = {
  id: string
  name: string | null
  category: string | null
  address: string | null
  provider_entity_id: string | null
  metadata: Record<string, unknown>
  relevance_score: number | null
}

const COMPETITOR_PROVIDER = "google_places"

/** Pending (not yet approved, not ignored) candidates for a location, best first. */
async function pendingCandidates(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  locationId: string
): Promise<DiscoveredCompetitor[]> {
  const { data } = await admin
    .from("competitors")
    .select("id, name, category, address, provider_entity_id, metadata, relevance_score")
    .eq("location_id", locationId)
    .eq("is_active", false)
    .order("relevance_score", { ascending: false })
  return (data ?? [])
    .filter(
      (c) => ((c.metadata as Record<string, unknown> | null)?.status ?? "pending") === "pending"
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      address: c.address,
      provider_entity_id: c.provider_entity_id,
      metadata: (c.metadata as Record<string, unknown>) ?? {},
      relevance_score: c.relevance_score,
    }))
}

type LocationForDiscovery = {
  id: string
  organization_id: string
  geo_lat: number | null
  geo_lng: number | null
  settings: Json | null
  primary_place_id: string | null
  name: string | null
  city: string | null
  region: string | null
}

async function loadLocationForMember(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  locationId: string,
  userId: string
): Promise<{ ok: true; location: LocationForDiscovery } | { ok: false; error: string }> {
  const { data: location, error: locError } = await admin
    .from("locations")
    .select(
      "id, organization_id, geo_lat, geo_lng, settings, primary_place_id, name, city, region"
    )
    .eq("id", locationId)
    .single()

  if (locError || !location) {
    return { ok: false, error: locError?.message ?? "Location not found" }
  }

  // Owner/admin only — matches addCompetitorAction's gate. A plain member could
  // otherwise burn discovery spend (Places sweeps + a model call) on a set they
  // aren't allowed to change. Onboarding always runs as the org creator (owner).
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", location.organization_id)
    .eq("user_id", userId)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only admins can manage competitors." }
  }

  return { ok: true, location }
}

export async function discoverCompetitorsForLocation(
  locationId: string,
  placesApiType?: string
): Promise<
  | { ok: true; competitors: DiscoveredCompetitor[] }
  | { ok: false; error: string }
> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  // Each run spends ~tiles Places sweeps + up to DISCOVERY_KEEP details calls + one
  // Sonnet completion — cap the cadence per user (fail-open like every rateLimit use).
  const rl = await rateLimit(user.id, {
    prefix: "competitor-discovery",
    limit: 6,
    windowSeconds: 600,
  })
  if (!rl.ok) {
    return { ok: false, error: "We just scanned — give it a minute and try again." }
  }

  const loaded = await loadLocationForMember(admin, locationId, user.id)
  if (!loaded.ok) return loaded
  const { location } = loaded

  if (location.geo_lat === null || location.geo_lng === null) {
    return { ok: false, error: "Location is missing coordinates" }
  }

  const targetCategory =
    (location.settings as { category?: string } | null)?.category ?? null

  // 1) Identity — who IS the target? Fail-soft to name + stored category.
  let identity = buildTargetIdentity(location.name ?? "this business", null, targetCategory)
  if (location.primary_place_id) {
    try {
      const details = await fetchPlaceDetails(location.primary_place_id)
      identity = buildTargetIdentity(location.name ?? "this business", details, targetCategory)
    } catch (err) {
      console.warn(`[competitor-discovery] target details failed (identity degrades to name+category): ${String(err)}`)
    }
  }

  // 2) Recall — tiled nearby sweep. A failed tile shrinks the pool; ALL failed = error.
  // The location's existing competitor rows load alongside: WATCHED (is_active)
  // and IGNORED rows must never enter the pool. Discovery once ran only during
  // onboarding (nothing active yet); from the dashboard, a watched rival that
  // re-enters the pool would be upserted back to is_active:false — silently
  // un-watching it. The exclusion here is what makes a re-scan non-destructive.
  const tiles = discoveryTypeTiles(placesApiType)
  let failedTiles = 0
  const [tileResults, existingRowsRes] = await Promise.all([
    Promise.all(
      tiles.map((includedTypes) =>
        fetchNearbyPlaces(location.geo_lat!, location.geo_lng!, {
          includedTypes,
          radius: DISCOVERY_RADIUS_METERS,
          excludePlaceId: location.primary_place_id ?? undefined,
        }).catch((err) => {
          failedTiles++
          console.warn(`[competitor-discovery] tile ${includedTypes.join(",")} failed: ${String(err)}`)
          return [] as NearbyPlace[]
        })
      )
    ),
    admin
      .from("competitors")
      .select("id, provider, provider_entity_id, metadata, is_active")
      .eq("location_id", location.id),
  ])
  if (failedTiles === tiles.length) {
    return { ok: false, error: "Couldn't scan nearby businesses right now. Try again in a moment." }
  }
  // FAIL CLOSED on the safety read: the watched/ignored exclusions below are what
  // keep a scan from un-watching active rivals. If this SELECT errored, data is
  // null and the guards would silently guard nothing — abort instead.
  if (existingRowsRes.error) {
    return { ok: false, error: "Couldn't check your current competitor set. Try again in a moment." }
  }
  const existingRows = existingRowsRes.data ?? []
  const watchedPlaceIds = new Set(
    existingRows.filter((r) => r.is_active).map((r) => r.provider_entity_id)
  )
  const ignoredPlaceIds = new Set(
    existingRows
      .filter(
        (r) =>
          !r.is_active &&
          (r.metadata as Record<string, unknown> | null)?.status === "ignored"
      )
      .map((r) => r.provider_entity_id)
  )

  const byPlaceId = new Map<string, NearbyPlace>()
  for (const list of tileResults) {
    for (const p of list) if (!byPlaceId.has(p.placeId)) byPlaceId.set(p.placeId, p)
  }
  const ownName = (location.name ?? "").trim().toLowerCase()
  const pool = Array.from(byPlaceId.values())
    .filter((p) => p.placeId !== location.primary_place_id)
    .filter((p) => !ownName || p.name.trim().toLowerCase() !== ownName)
    .filter((p) => !p.types.some((t) => EXCLUDED_COMPETITOR_TYPES.has(t)))
    .filter((p) => !watchedPlaceIds.has(p.placeId) && !ignoredPlaceIds.has(p.placeId))
    .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
    .slice(0, RERANK_POOL_CAP)

  if (pool.length === 0) {
    // Nothing around (rural edge case) — surface whatever is already pending
    // (e.g. operator-added) instead of an error.
    return { ok: true, competitors: await pendingCandidates(admin, locationId) }
  }

  // 3) Precision — one structured call; null = heuristic ranking (never a hard fail).
  const rerank = await generateStructured<Map<number, RerankEntry> | null>(
    {
      tier: "reasoning",
      prompt: buildRerankPrompt(identity, pool),
      temperature: 0.2,
      maxOutputTokens: 8192,
      label: "competitor-rerank",
    },
    {
      validate: (raw) => parseRerank(raw, pool.length),
      fallback: () => null,
      onFallback: ({ reason, elapsedMs }) =>
        console.warn(
          `[competitor-rerank] heuristic ranking fallback (reason=${reason}, ${elapsedMs}ms, pool=${pool.length})`
        ),
    }
  )

  // 4) Score + choose. Model score leads; heuristic fills gaps and breaks nothing.
  const scored = pool
    .map((p, i) => {
      const heuristic = scoreCompetitor({
        distanceMeters: p.distanceMeters ?? undefined,
        category: p.primaryType ?? undefined,
        targetCategory,
        rating: p.rating ?? undefined,
        reviewCount: p.reviewCount ?? undefined,
        types: p.types,
      })
      const entry = rerank?.get(i)
      return {
        place: p,
        heuristic,
        rerankScore: entry?.score ?? null,
        why: sanitizeWhy(entry?.why ?? null),
      }
    })
    .filter((s) => s.heuristic.score > 0)
    // With a rerank in hand, a candidate the model didn't score is NOT a free pass —
    // the prompt demands full coverage, so an omission is noise, and letting it
    // through would rank it by the distance-heavy heuristic (the exact failure this
    // rewrite removes). Heuristic ranking applies only when the whole rerank failed.
    .filter((s) =>
      rerank ? s.rerankScore !== null && s.rerankScore >= RERANK_VETO_BELOW : true
    )
    .sort(
      (a, b) =>
        (b.rerankScore ?? b.heuristic.score * 100) -
        (a.rerankScore ?? a.heuristic.score * 100)
    )
    .slice(0, DISCOVERY_KEEP)

  // 5) Enrich only what we keep (details are edge-cached ~7d). Fail-soft per candidate.
  const enriched = await Promise.all(
    scored.map(async (s) => {
      try {
        const details = await fetchPlaceDetails(s.place.placeId)
        return { ...s, details, mapped: mapPlaceToLocation(details) }
      } catch {
        return { ...s, details: null, mapped: null }
      }
    })
  )

  // 6) Persist. Refresh REPLACES prior discovery suggestions; operator-added pending
  // rows survive, ignored competitors never come back, and WATCHED rows can never
  // be clobbered back to pending (the pool excluded them; the filter here is the
  // second lock on the same door).
  const rows = enriched
    .filter(
      (s) => !ignoredPlaceIds.has(s.place.placeId) && !watchedPlaceIds.has(s.place.placeId)
    )
    .map(({ place, heuristic, rerankScore, why, details, mapped }) => {
      const relevance =
        rerankScore !== null ? Number((rerankScore / 100).toFixed(4)) : heuristic.score
      return {
        location_id: location.id,
        provider: COMPETITOR_PROVIDER,
        provider_entity_id: place.placeId,
        name: mapped?.name || place.name,
        category: mapped?.category ?? place.primaryType ?? targetCategory ?? null,
        address: mapped?.address_line1 ?? place.address,
        phone: mapped?.phone ?? null,
        website: mapped?.website ?? null,
        relevance_score: relevance,
        is_active: false,
        metadata: {
          status: "pending",
          source: "discovery",
          why,
          rerankScore,
          distanceMeters: place.distanceMeters,
          rating: details?.rating ?? place.rating,
          reviewCount: details?.userRatingCount ?? place.reviewCount,
          address: mapped?.address_line1 ?? place.address,
          city: mapped?.city ?? null,
          region: mapped?.region ?? null,
          latitude: mapped?.geo_lat ?? place.lat ?? null,
          longitude: mapped?.geo_lng ?? place.lng ?? null,
          placeDetails: details
            ? JSON.parse(
                JSON.stringify({
                  businessStatus: details.businessStatus ?? null,
                  priceLevel: details.priceLevel ?? null,
                  mapsUri: details.googleMapsUri ?? null,
                  editorialSummary: details.editorialSummary?.text ?? null,
                  shortFormattedAddress: details.shortFormattedAddress ?? null,
                  reviews: details.reviews ?? null,
                  types: details.types ?? null,
                  primaryType: details.primaryType ?? null,
                })
              )
            : null,
          factors: JSON.parse(JSON.stringify(heuristic.factors)),
        } as Json,
      }
    })

  if (rows.length) {
    const { error } = await admin.from("competitors").upsert(rows, {
      onConflict: "provider,provider_entity_id,location_id",
    })
    if (error) {
      return { ok: false, error: error.message }
    }
  }

  // Sweep stale pending DISCOVERY rows (previous runs, the old gemini-era junk).
  // Watched, operator-added, and ignored rows are untouched; the fresh set was
  // just upserted. `!r.is_active` is load-bearing: existingRows now includes the
  // WATCHED set, and an active row with legacy metadata (no status) would
  // otherwise read as "pending" and be deleted.
  const keptPlaceIds = new Set(rows.map((r) => r.provider_entity_id))
  const staleIds = existingRows
    .filter((r) => {
      if (r.is_active) return false
      const meta = r.metadata as Record<string, unknown> | null
      const status = (meta?.status as string | undefined) ?? "pending"
      const source = meta?.source as string | undefined
      // A row survives only if it's the exact row the fresh upsert just refreshed
      // (same provider + place). A legacy-provider row for the same place would
      // otherwise linger next to its fresh twin.
      const refreshed =
        r.provider === COMPETITOR_PROVIDER && keptPlaceIds.has(r.provider_entity_id ?? "")
      return status === "pending" && source !== "operator" && !refreshed
    })
    .map((r) => r.id)
  if (staleIds.length) {
    const { error: sweepError } = await admin.from("competitors").delete().in("id", staleIds)
    if (sweepError) {
      // Non-fatal: stale suggestions linger but the fresh set still ranks first.
      console.warn(`[competitor-discovery] stale-suggestion sweep failed: ${sweepError.message}`)
    }
  }

  return { ok: true, competitors: await pendingCandidates(admin, locationId) }
}

// ---------------------------------------------------------------------------
// Operator adds a specific competitor by Google place — the step-2 search picker.
// Persists as a PENDING candidate (approval still happens at "Track these N").
// ---------------------------------------------------------------------------

export async function addCompetitorCandidateAction(input: {
  locationId: string
  placeId: string
}): Promise<
  | { ok: true; competitor: DiscoveredCompetitor }
  | { ok: false; error: string }
> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  // Each add costs a Places details call and a permanent row — cap the cadence
  // (fail-open like every rateLimit use).
  const rl = await rateLimit(user.id, {
    prefix: "competitor-add",
    limit: 20,
    windowSeconds: 60,
  })
  if (!rl.ok) {
    return { ok: false, error: "That's a lot of adds at once — give it a minute." }
  }

  const loaded = await loadLocationForMember(admin, input.locationId, user.id)
  if (!loaded.ok) return loaded
  const { location } = loaded

  if (input.placeId === location.primary_place_id) {
    return { ok: false, error: "That's your own location." }
  }

  // Hard ceiling on queued-but-unapproved rows per location: onboarding tracks at
  // most a handful, so an ever-growing pending pile is only ever abuse or a bug.
  const { count: pendingCount } = await admin
    .from("competitors")
    .select("id", { count: "exact", head: true })
    .eq("location_id", location.id)
    .eq("is_active", false)
  if ((pendingCount ?? 0) >= 30) {
    return {
      ok: false,
      error: "You've got plenty queued already — pick from what's here or remove some first.",
    }
  }

  // Already on file (discovery suggested it, or it was ignored before)? Reuse the
  // row — re-adding an ignored competitor is an explicit operator decision.
  const { data: existing } = await admin
    .from("competitors")
    .select("id, name, category, address, provider_entity_id, metadata, relevance_score, is_active")
    .eq("location_id", location.id)
    .eq("provider_entity_id", input.placeId)
    .maybeSingle()
  if (existing) {
    const metadata = {
      ...(existing.metadata as Record<string, unknown> | null),
      status: existing.is_active ? "approved" : "pending",
      source: "operator",
    }
    const { error: updateError } = await admin
      .from("competitors")
      .update({ metadata })
      .eq("id", existing.id)
    if (updateError) {
      return { ok: false, error: updateError.message }
    }
    return {
      ok: true,
      competitor: {
        id: existing.id,
        name: existing.name,
        category: existing.category,
        address: existing.address,
        provider_entity_id: existing.provider_entity_id,
        metadata,
        relevance_score: existing.relevance_score,
      },
    }
  }

  let details: Awaited<ReturnType<typeof fetchPlaceDetails>>
  try {
    details = await fetchPlaceDetails(input.placeId)
  } catch (err) {
    return { ok: false, error: `Couldn't load that place: ${err instanceof Error ? err.message : String(err)}` }
  }
  const mapped = mapPlaceToLocation(details)
  if (
    mapped.name &&
    location.name &&
    mapped.name.trim().toLowerCase() === location.name.trim().toLowerCase()
  ) {
    return { ok: false, error: "That's your own location." }
  }

  const targetCategory =
    (location.settings as { category?: string } | null)?.category ?? null
  const distanceMeters =
    typeof mapped.geo_lat === "number" &&
    typeof mapped.geo_lng === "number" &&
    typeof location.geo_lat === "number" &&
    typeof location.geo_lng === "number"
      ? haversineMeters({
          lat1: location.geo_lat,
          lng1: location.geo_lng,
          lat2: mapped.geo_lat,
          lng2: mapped.geo_lng,
        })
      : null
  const { factors } = scoreCompetitor({
    distanceMeters: distanceMeters ?? undefined,
    category: mapped.category ?? undefined,
    targetCategory,
    rating: details.rating ?? undefined,
    reviewCount: details.userRatingCount ?? undefined,
    types: mapped.types ?? null,
  })

  const metadata = {
    status: "pending",
    source: "operator",
    why: "You added this one.",
    rerankScore: null,
    distanceMeters,
    rating: details.rating ?? null,
    reviewCount: details.userRatingCount ?? null,
    address: mapped.address_line1,
    city: mapped.city,
    region: mapped.region,
    latitude: mapped.geo_lat,
    longitude: mapped.geo_lng,
    placeDetails: JSON.parse(
      JSON.stringify({
        businessStatus: details.businessStatus ?? null,
        priceLevel: details.priceLevel ?? null,
        mapsUri: details.googleMapsUri ?? null,
        editorialSummary: details.editorialSummary?.text ?? null,
        shortFormattedAddress: details.shortFormattedAddress ?? null,
        reviews: details.reviews ?? null,
        types: details.types ?? null,
        primaryType: details.primaryType ?? null,
      })
    ),
    factors: JSON.parse(JSON.stringify(factors)),
  } as Json

  const { data: inserted, error } = await admin
    .from("competitors")
    .insert({
      location_id: location.id,
      provider: COMPETITOR_PROVIDER,
      provider_entity_id: input.placeId,
      name: mapped.name || "Competitor",
      category: mapped.category ?? targetCategory ?? null,
      address: mapped.address_line1,
      phone: mapped.phone,
      website: mapped.website,
      // Operator intent outranks every model suggestion.
      relevance_score: 0.99,
      is_active: false,
      metadata,
    })
    .select("id, name, category, address, provider_entity_id, metadata, relevance_score")
    .single()

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "Couldn't add that competitor." }
  }

  return {
    ok: true,
    competitor: {
      id: inserted.id,
      name: inserted.name,
      category: inserted.category,
      address: inserted.address,
      provider_entity_id: inserted.provider_entity_id,
      metadata: (inserted.metadata as Record<string, unknown>) ?? {},
      relevance_score: inserted.relevance_score,
    },
  }
}

// ---------------------------------------------------------------------------
// Complete onboarding — set profile, approve competitors, save prefs, trigger enrichment
// ---------------------------------------------------------------------------

function extractDomainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      ""
    )
  } catch {
    return null
  }
}

export async function completeOnboardingAction(input: {
  orgId: string
  locationId: string
  competitorIds: string[]
  monitoringPrefs: Record<string, boolean>
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  const { data: membership } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", input.orgId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) {
    return { ok: false, error: "You are not a member of this organization." }
  }

  const { data: locOwnership } = await admin
    .from("locations")
    .select("id")
    .eq("id", input.locationId)
    .eq("organization_id", input.orgId)
    .maybeSingle()

  if (!locOwnership) {
    return { ok: false, error: "Location does not belong to this organization." }
  }

  // Org row — used for the current-org claim rule, the competitor cap, and the
  // welcome-email gate.
  const { data: org } = await admin
    .from("organizations")
    .select("subscription_tier, org_kind, trial_ends_at, payment_state")
    .eq("id", input.orgId)
    .maybeSingle()

  // 1. Claim current_organization_id only on a FIRST org (user has none yet) or
  // when the target is already trial-active (e.g. admin demo setup). For an
  // ADDITIONAL not-yet-paid org (multi-location path 2b), keep the user on their
  // existing org until checkout completes — abandoning setup must not strand a
  // paying customer on an unpaid org. (checkout-complete switches them in on pay.)
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()
  const claimCurrentOrg =
    !existingProfile?.current_organization_id || (org ? isTrialActive(org) : false)

  const profilePayload: {
    id: string
    email: string | null
    current_organization_id?: string
  } = { id: user.id, email: user.email ?? null }
  if (claimCurrentOrg) profilePayload.current_organization_id = input.orgId

  const { error: profileError } = await admin.from("profiles").upsert(profilePayload)

  if (profileError) {
    return { ok: false, error: profileError.message }
  }

  // 2. Save monitoring preferences to location settings
  const { data: loc } = await admin
    .from("locations")
    .select("settings")
    .eq("id", input.locationId)
    .single()

  const existingSettings = (loc?.settings as Record<string, unknown> | null) ?? {}
  const { error: settingsError } = await admin
    .from("locations")
    .update({
      settings: {
        ...existingSettings,
        monitoring_preferences: input.monitoringPrefs,
      },
    })
    .eq("id", input.locationId)

  if (settingsError) {
    return { ok: false, error: settingsError.message }
  }

  // 3. Bulk approve selected competitors (capped to tier limit)
  const onboardTier = asSubscriptionTier(org?.subscription_tier)
  const maxCompetitors = TIER_LIMITS[onboardTier].maxCompetitorsPerLocation
  const cappedCompetitorIds = input.competitorIds.slice(0, maxCompetitors)

  if (cappedCompetitorIds.length > 0) {
    for (const compId of cappedCompetitorIds) {
      const { data: comp } = await admin
        .from("competitors")
        .select("metadata, name, website, location_id")
        .eq("id", compId)
        .eq("location_id", input.locationId)
        .single()

      if (!comp) continue

      const metadata = {
        ...(comp.metadata as Record<string, unknown> | null),
        status: "approved",
      }

      await admin
        .from("competitors")
        .update({ is_active: true, metadata })
        .eq("id", compId)
    }
  }

  // Kick the FIRST-RUN pull sequence through the durable queue (replaces the old
  // per-competitor fire-and-forget SEO/content enrichment — which was unbounded, ran
  // only 2 of the signals, and died when the action returned). enqueueFirstRun queues
  // every pipeline once (forced, cadence-ignored); the worker drains them and the first
  // brief lands within the honest "processing" window the onboarding UI already shows.
  try {
    await enqueueFirstRun(admin, { organizationId: input.orgId, locationId: input.locationId })
  } catch (err) {
    console.warn("[Onboarding] enqueueFirstRun failed:", err)
  }

  // Fire-and-forget welcome email — real customers only. Demo/test orgs are
  // admin-built showcases; don't send the admin a customer "welcome" email.
  const isShowcase =
    org?.org_kind === "demo" || org?.org_kind === "test"
  const userEmail = user.email
  if (userEmail && !isShowcase) {
    const { data: locInfo } = await admin
      .from("locations")
      .select("name")
      .eq("id", input.locationId)
      .single()

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const userName =
      user.user_metadata?.full_name ?? userEmail.split("@")[0] ?? "there"

    sendEmail({
      to: userEmail,
      subject: "Welcome to Ticket — your feed is live",
      react: Welcome({
        userName,
        locationName: locInfo?.name ?? "Your location",
        competitorCount: input.competitorIds.length,
        dashboardUrl: `${appUrl}/home`,
      }),
      clientFacing: true,
      overrideClientEmailPause: false,
    }).catch((err) => console.error("Welcome email failed:", err))
  }

  return { ok: true }
}
