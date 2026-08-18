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
import { TRIAL_DURATION_DAYS } from "@/lib/billing/trial"
import { shouldClaimCurrentOrg } from "@/lib/onboarding/claim-current-org"
import {
  classifyPlaceCollision,
  type CollisionOrgRow,
  type PlaceCollision,
} from "@/lib/onboarding/org-collision"
import { canRequesterEscalate, type AccessRequestStatus } from "@/lib/onboarding/access-request"
import {
  loadOrgManagerRecipients,
  notifyOps,
} from "@/lib/onboarding/access-request-notify"
import type { Json } from "@/types/database.types"
import { sendEmail } from "@/lib/email/send"
import { Welcome } from "@/lib/email/templates/welcome"
import { AccessRequest } from "@/lib/email/templates/access-request"
import { mirrorLifecycleToMarketing } from "@/lib/marketing/trial-lifecycle"

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

// ---------------------------------------------------------------------------
// Duplicate-org prevention (beta rescue phase 3.5, pairs with ALT-576's merge
// tool, which cleans up existing duplicates; this stops new ones).
//
// A signup that picks a place already owned by a live org must NOT create a
// second org or grant ownership. Classification is pure
// (lib/onboarding/org-collision.ts); this resolver just loads the rows.
// ---------------------------------------------------------------------------

/** What the wizard renders instead of proceeding. See classifyPlaceCollision. */
export type SignupCollisionKind = "real" | "demo" | "already_member"

type ResolvedCollision = {
  collision: PlaceCollision
  /** Name of the colliding org (internal alerts only, never shown to the requester). */
  orgName: string | null
}

async function resolvePlaceCollision(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  placeId: string,
  userId: string
): Promise<ResolvedCollision> {
  const none: ResolvedCollision = { collision: { kind: "none" }, orgName: null }
  if (!placeId) return none

  // FAIL OPEN on read errors: blocking every signup because a SELECT failed is a worse
  // outage than one duplicate org, which the admin merge tool can fold away afterwards
  // (same posture as the fleet daily cap in /api/cron/build-brief).
  const { data: locRows, error: locErr } = await admin
    .from("locations")
    .select("organization_id")
    .eq("primary_place_id", placeId)
  if (locErr) {
    console.error("[org-collision] locations lookup failed (failing open):", locErr.message)
    return none
  }

  const orgIds = Array.from(new Set((locRows ?? []).map((l) => l.organization_id)))
  if (orgIds.length === 0) return none

  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, org_kind, deleted_at")
    .in("id", orgIds)
  if (orgErr) {
    console.error("[org-collision] organizations lookup failed (failing open):", orgErr.message)
    return none
  }

  // Membership read failing just means "treat as not a member": the request-access
  // action re-checks membership before writing anything, so this degrades safely.
  const { data: memberships } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .in("organization_id", orgIds)
  const memberOrgIds = new Set((memberships ?? []).map((m) => m.organization_id))

  const rows: CollisionOrgRow[] = (orgs ?? []).map((o) => ({
    orgId: o.id,
    orgKind: o.org_kind,
    deletedAt: o.deleted_at,
    isMember: memberOrgIds.has(o.id),
  }))

  const collision = classifyPlaceCollision(rows)
  const orgName =
    collision.kind === "none"
      ? null
      : ((orgs ?? []).find((o) => o.id === collision.orgId)?.name ?? null)
  return { collision, orgName }
}

const COLLISION_COPY: Record<SignupCollisionKind, string> = {
  real: "This restaurant is already set up on Ticket. Ask your team's account owner to add you.",
  demo: "This restaurant is already connected to Ticket. Leave your details and we will get you set up.",
  already_member: "You already have access to this restaurant on Ticket.",
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

  // Duplicate-org prevention (phase 3.5). This legacy form action has no collision screen,
  // so it degrades to the error banner; the wizard path renders the full flow.
  const { collision: legacyCollision } = await resolvePlaceCollision(
    supabaseAdmin,
    primaryPlaceId,
    user.id
  )
  if (legacyCollision.kind !== "none") {
    redirect(`/onboarding?error=${encodeURIComponent(COLLISION_COPY[legacyCollision.kind])}`)
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
    .select("subscription_tier, trial_ends_at, payment_state, org_kind, deleted_at")
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
  | { ok: true; orgId: string; locationId: string; maxCompetitors: number }
  | { ok: false; error: string; collision?: SignupCollisionKind }
> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  // Duplicate-org prevention: a place that already belongs to a live org never mints a
  // second org (beta rescue phase 3.5). The wizard reads `collision` and swaps in the
  // request-access / we'll-set-you-up screen; `error` is the plain-copy fallback.
  const { collision, orgName } = await resolvePlaceCollision(
    admin,
    input.place.primary_place_id,
    user.id
  )
  if (collision.kind !== "none") {
    if (collision.kind === "demo") {
      // Sales signal, fired at detection so it exists even if they bounce without
      // leaving contact details (ruling: alert AND show the contact screen).
      void notifyOps("Signup collision with a demo org", [
        `${user.email ?? user.id} tried to set up "${input.businessName}" during onboarding.`,
        `That place (${input.place.primary_place_id}) belongs to the demo/test org "${orgName ?? "unknown"}" (${collision.orgId}).`,
        `They were shown the "we'll get you set up" screen; a contact submission may follow.`,
      ])
    }
    return { ok: false, error: COLLISION_COPY[collision.kind], collision: collision.kind }
  }

  const baseSlug = slugify(input.businessName)
  if (!baseSlug) {
    return { ok: false, error: "Business name produces an invalid slug" }
  }

  // Retry slug with numeric suffix on collision (up to 5 attempts)
  // ALT-663: carries subscription_tier so the plan cap returned to the wizard comes
  // from the written row.
  let org: { id: string; subscription_tier: string | null } | null = null
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
      // ALT-663: select the tier back so the cap we hand the client comes from the row
      // that was actually written, not from re-reading the literal above.
      .select("id, subscription_tier")
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

  // ALT-663: hand the client the PLAN cap. The wizard used to carry a module-level
  // `MAX_TRACKED = 5`, so an org on any other tier was told the wrong maximum and then
  // had its extra picks silently sliced off during completion. New orgs are created on
  // `mid` (see subscription_tier above), but the cap must come from the tier, never from
  // the assumption that a new org is always mid.
  return {
    ok: true,
    orgId: org.id,
    locationId: loc.id,
    maxCompetitors:
      TIER_LIMITS[asSubscriptionTier(org.subscription_tier)].maxCompetitorsPerLocation,
  }
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
    .select("subscription_tier, trial_ends_at, payment_state, org_kind, deleted_at")
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
      // ALT-299: never leak a raw DB error to the onboarding UI — log it, show friendly copy.
      console.error("[discovery] competitor upsert failed:", error.message)
      return { ok: false, error: "Something went wrong saving your competitors. Try again in a moment." }
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
    .select("subscription_tier, org_kind, trial_ends_at, payment_state, deleted_at")
    .eq("id", input.orgId)
    .maybeSingle()

  // Demo/test orgs are admin-built showcases opened explicitly via the org
  // detail page ("Open demo dashboard"), not the admin's working org.
  const isShowcase = org?.org_kind === "demo" || org?.org_kind === "test"

  // 1. Claim current_organization_id per shouldClaimCurrentOrg: first org, or a
  // real trial-active org. Showcase orgs never hijack an existing current org,
  // so setting up a second demo while the first's brief is still building can't
  // silently repoint the admin's /home (ALT-300).
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()
  const claimCurrentOrg = shouldClaimCurrentOrg(
    existingProfile?.current_organization_id,
    org
  )

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
  // ALT-663: this slice used to be silent. The wizard now receives the same cap from
  // createOrgAndLocationAction, so arriving here with more picks than the plan allows
  // means the two disagreed — a bug, not a user action. Say so loudly rather than
  // quietly discarding competitors the operator deliberately chose. Still non-fatal:
  // dropping the extras beats failing the whole onboarding at the last step.
  if (input.competitorIds.length > maxCompetitors) {
    console.error(
      `[Onboarding] ALT-663 cap mismatch: location ${input.locationId} submitted ` +
        `${input.competitorIds.length} competitors on tier '${onboardTier}' (max ` +
        `${maxCompetitors}). Dropped ${input.competitorIds.length - maxCompetitors}. ` +
        `The client cap and the plan cap are out of sync.`
    )
  }

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

    // ALT-591: make the contact visible to Chris's n8n flows the moment
    // onboarding completes (self-serve signups never hit the waitlist mirror).
    // 'access_granted' here also means the later trial transition -- card-backed
    // OR card-less -- lands as a status UPDATE, which his trigger stamps.
    // upsertMarketingContact never downgrades an existing trial/paid/churned
    // row, so a wizard re-submit after trial start is harmless. Awaited (not
    // fire-and-forget) so the write isn't cut off when the action returns;
    // it never throws, and it no-ops unless MARKETING_CONTACTS_ENABLED=true.
    const fullName: string | null = user.user_metadata?.full_name ?? null
    const [firstName, ...restName] = (fullName ?? "").trim().split(/\s+/)
    await mirrorLifecycleToMarketing({
      organizationId: input.orgId,
      status: "access_granted",
      fallbackEmail: userEmail,
      firstName: firstName || null,
      lastName: restName.length ? restName.join(" ") : null,
    })
  }

  return { ok: true }
}

/**
 * "Skip for now" on the onboarding card step — start the trial WITHOUT a card.
 *
 * Grants the org a platform-managed trial clock (trial_started_at / trial_ends_at) and
 * leaves payment_state null. That is the long-standing card-less trial state the access
 * rule already understands (isTrialActive: payment_state null -> gate on the clock), so
 * nothing downstream needs a new branch: the trial banner already renders "no card on
 * file" copy, and the day-14 paywall already handles an org that never had a card.
 *
 * Conversion still happens through Stripe checkout later (banner + paywall both link to
 * /settings/billing); unlike a card-backed trial there is no automatic charge, so the
 * day 10 / 13 reminders carry "add a card" copy instead (see lib/billing/trial-reminders).
 *
 * COST NOTE (decided 2026-07-24, deliberate): card-less orgs still get the full REAL
 * first-run data pull — live Places/DataForSEO/Firecrawl/AI spend — because the product is
 * worth nothing without real data. That is accepted CAC, not an oversight. If usage data
 * shows it's a bad call, tighten in this order: email verification before the first run →
 * shorter card-less trial → queue/throttle the pull → reduced first run → re-gate on a
 * card. Rationale + the metrics to watch: vault brain/decisions/cardless-signup-first-run-data-pull.md
 */
export async function startTrialWithoutCardAction() {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  const { data: profile } = await admin
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const orgId = profile?.current_organization_id
  if (!orgId) {
    redirect("/onboarding?error=No%20organization%20found")
  }

  // Only an owner/admin of THIS org may start its trial (never trust the caller's org).
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/onboarding?error=Unauthorized")
  }

  const { data: org } = await admin
    .from("organizations")
    .select("payment_state, trial_ends_at")
    .eq("id", orgId)
    .maybeSingle()

  // Idempotent: if Stripe already owns this org's clock, or a live clock already exists,
  // this is a double-submit / back-button replay. Don't extend or overwrite either one.
  if (org?.payment_state != null) {
    redirect("/home")
  }
  if (org?.trial_ends_at && new Date(org.trial_ends_at) > new Date()) {
    redirect("/home")
  }

  const startedAt = new Date()
  const endsAt = new Date(startedAt.getTime() + TRIAL_DURATION_DAYS * 86_400_000)

  const { error } = await admin
    .from("organizations")
    .update({
      trial_started_at: startedAt.toISOString(),
      trial_ends_at: endsAt.toISOString(),
    })
    .eq("id", orgId)

  if (error) {
    redirect(`/onboarding/trial?error=${encodeURIComponent(error.message)}`)
  }

  // ALT-591: the card-less trial start is the one lifecycle transition Stripe
  // never sees, so the webhook mirror can't write it -- without this line the
  // org's contact never reaches status 'trial' and Chris's n8n drip skips them
  // entirely. Awaited BEFORE the redirect (redirect() throws, which would cut
  // off a fire-and-forget promise); never throws; no-ops unless
  // MARKETING_CONTACTS_ENABLED=true.
  await mirrorLifecycleToMarketing({
    organizationId: orgId,
    status: "trial",
    fallbackEmail: user.email ?? null,
  })

  redirect("/home")
}

// ---------------------------------------------------------------------------
// Access requests: the follow-ups to a signup collision (phase 3.5).
//
// All three actions re-resolve the collision from the PLACE ID server-side rather than
// trusting an orgId from the client, so they can only ever target the org that actually
// owns the place the requester picked (no spraying requests at arbitrary orgs).
// Writes use select-then-insert, NOT upsert: the one-open-request guarantee is a partial
// unique index, and PostgREST onConflict can't address partial indexes (known gotcha).
// ---------------------------------------------------------------------------

const OPEN_REQUEST_STATUSES: AccessRequestStatus[] = ["pending", "nudged", "escalated"]

function requesterDisplayName(user: { email?: string | null; user_metadata?: Record<string, unknown> }) {
  const metaName = user.user_metadata?.full_name
  if (typeof metaName === "string" && metaName.trim()) return metaName.trim()
  return user.email?.split("@")[0] ?? "A teammate"
}

/**
 * "Request access" on the already-on-Ticket screen: records the request and notifies the
 * org's owner to grant a role via Settings -> Team. The daily access-requests cron nudges
 * at day 4, escalates to us at day 7, and marks it granted once membership appears.
 * Idempotent: a second click (or a second signup attempt days later) reuses the open request.
 */
export async function requestOrgAccessAction(input: {
  placeId: string
}): Promise<{ ok: true; alreadyRequested: boolean } | { ok: false; error: string }> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  const rl = await rateLimit(user.id, {
    prefix: "org-access-request",
    limit: 5,
    windowSeconds: 3600,
  })
  if (!rl.ok) {
    return { ok: false, error: "That's a few tries in a row. Give it a minute." }
  }

  const { collision, orgName } = await resolvePlaceCollision(admin, input.placeId, user.id)
  if (collision.kind === "already_member") {
    return { ok: false, error: "You already have access to this restaurant. Head to your dashboard." }
  }
  if (collision.kind !== "real") {
    return { ok: false, error: "We couldn't match that restaurant to an existing account. Try the search again." }
  }

  const { data: existing } = await admin
    .from("org_access_requests")
    .select("id, status")
    .eq("organization_id", collision.orgId)
    .eq("requester_user_id", user.id)
    .eq("kind", "request_access")
    .in("status", OPEN_REQUEST_STATUSES)
    .maybeSingle()
  if (existing) {
    return { ok: true, alreadyRequested: true }
  }

  const { error: insertError } = await admin.from("org_access_requests").insert({
    organization_id: collision.orgId,
    requester_user_id: user.id,
    requester_email: user.email ?? null,
    requester_name: requesterDisplayName(user),
    place_id: input.placeId,
    kind: "request_access",
    status: "pending",
  })
  if (insertError) {
    // 23505 = the partial unique index caught a racing double-submit; treat as already sent.
    if (insertError.code === "23505") return { ok: true, alreadyRequested: true }
    console.error("[org-access] request insert failed:", insertError.message)
    return { ok: false, error: "Something went wrong sending your request. Try again in a moment." }
  }

  // Notify the owner. Best-effort: a failed send is not a failed request, because the
  // day-4 cron nudge retries the same notification path.
  const recipients = await loadOrgManagerRecipients(admin, collision.orgId)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  await Promise.all(
    recipients.map((r) =>
      sendEmail({
        to: r.email,
        subject: `${requesterDisplayName(user)} is asking to join ${orgName ?? "your account"} on Ticket`,
        react: AccessRequest({
          ownerName: r.name,
          requesterName: requesterDisplayName(user),
          requesterEmail: user.email ?? "unknown",
          orgName: orgName ?? "your account",
          teamUrl: `${appUrl}/settings/team`,
        }),
        clientFacing: true,
        // A person is actively waiting on this, same reasoning as the team-invite email:
        // it must not sit behind the marketing-email pause.
        overrideClientEmailPause: true,
      }).catch((err) => console.error("[org-access] owner notification failed:", err))
    )
  )
  if (recipients.length === 0) {
    // An org nobody reachable owns is exactly what escalation exists for; surface it to
    // us now instead of letting the request sit silent until the day-7 escalation.
    void notifyOps("Access request created for an org with no reachable owner", [
      `${user.email ?? user.id} asked to join "${orgName ?? "unknown"}" (${collision.orgId}) and no owner/admin has an email on file.`,
    ])
  }

  return { ok: true, alreadyRequested: false }
}

/**
 * "The owner isn't reachable" on the SAME screen (not just a timeout fallback): the
 * requester often already knows the owner left. Marks the request escalated and notifies
 * us with their contact details; we validate before any transfer (the admin side is
 * convertDemoToCustomer / transferOrgOwnership in app/actions/org-management.ts).
 */
export async function escalateOrgAccessAction(input: {
  placeId: string
  contact: string
  message?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  const rl = await rateLimit(user.id, {
    prefix: "org-access-escalate",
    limit: 3,
    windowSeconds: 3600,
  })
  if (!rl.ok) {
    return { ok: false, error: "We've got your note. Give us a little time to reach out." }
  }

  const { collision, orgName } = await resolvePlaceCollision(admin, input.placeId, user.id)
  if (collision.kind !== "real") {
    return { ok: false, error: "We couldn't match that restaurant to an existing account. Try the search again." }
  }

  const contact = input.contact.trim() || user.email || user.id
  const message = input.message?.trim() || null
  const now = new Date().toISOString()

  const { data: existing } = await admin
    .from("org_access_requests")
    .select("id, status")
    .eq("organization_id", collision.orgId)
    .eq("requester_user_id", user.id)
    .eq("kind", "request_access")
    .in("status", OPEN_REQUEST_STATUSES)
    .maybeSingle()

  if (existing) {
    const patch: Record<string, unknown> = { contact_info: contact, message, updated_at: now }
    if (canRequesterEscalate(existing.status as AccessRequestStatus)) {
      patch.status = "escalated"
      patch.escalated_at = now
    }
    const { error } = await admin.from("org_access_requests").update(patch).eq("id", existing.id)
    if (error) {
      console.error("[org-access] escalate update failed:", error.message)
      return { ok: false, error: "Something went wrong. Try again in a moment." }
    }
  } else {
    // Escalating without requesting first is allowed, because the requester may already know
    // the owner is gone. The record starts life escalated.
    const { error } = await admin.from("org_access_requests").insert({
      organization_id: collision.orgId,
      requester_user_id: user.id,
      requester_email: user.email ?? null,
      requester_name: requesterDisplayName(user),
      place_id: input.placeId,
      kind: "request_access",
      status: "escalated",
      escalated_at: now,
      contact_info: contact,
      message,
    })
    if (error && error.code !== "23505") {
      console.error("[org-access] escalate insert failed:", error.message)
      return { ok: false, error: "Something went wrong. Try again in a moment." }
    }
  }

  await notifyOps("Access request escalated by the requester", [
    `${requesterDisplayName(user)} (${user.email ?? user.id}) says the owner of "${orgName ?? "unknown"}" (${collision.orgId}) is unreachable.`,
    `Contact: ${contact}`,
    message ? `Their note: ${message}` : "No note left.",
    "Validate before any ownership change. Admin tools: transfer ownership / convert demo on the org detail page.",
  ])

  return { ok: true }
}

/**
 * Demo-org collision contact capture ("we'll set you up"): a real operator wants a
 * location we run as a demo/test showcase. Stores their contact and pages us; nothing is
 * granted automatically. The handover itself is the packaged convertDemoToCustomer admin
 * action.
 */
export async function submitDemoContactAction(input: {
  placeId: string
  contact: string
  message?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()

  const rl = await rateLimit(user.id, {
    prefix: "org-demo-contact",
    limit: 3,
    windowSeconds: 3600,
  })
  if (!rl.ok) {
    return { ok: false, error: "We've got your details. Give us a little time to reach out." }
  }

  const { collision, orgName } = await resolvePlaceCollision(admin, input.placeId, user.id)
  if (collision.kind !== "demo") {
    return { ok: false, error: "We couldn't match that restaurant. Try the search again." }
  }

  const contact = input.contact.trim() || user.email || user.id
  const message = input.message?.trim() || null
  const now = new Date().toISOString()

  const { data: existing } = await admin
    .from("org_access_requests")
    .select("id")
    .eq("organization_id", collision.orgId)
    .eq("requester_user_id", user.id)
    .eq("kind", "demo_contact")
    .in("status", OPEN_REQUEST_STATUSES)
    .maybeSingle()

  if (existing) {
    const { error } = await admin
      .from("org_access_requests")
      .update({ contact_info: contact, message, updated_at: now })
      .eq("id", existing.id)
    if (error) {
      console.error("[org-access] demo contact update failed:", error.message)
      return { ok: false, error: "Something went wrong. Try again in a moment." }
    }
  } else {
    // Born escalated: a demo collision is ours to act on from the start (no owner to nudge).
    const { error } = await admin.from("org_access_requests").insert({
      organization_id: collision.orgId,
      requester_user_id: user.id,
      requester_email: user.email ?? null,
      requester_name: requesterDisplayName(user),
      place_id: input.placeId,
      kind: "demo_contact",
      status: "escalated",
      escalated_at: now,
      contact_info: contact,
      message,
    })
    if (error && error.code !== "23505") {
      console.error("[org-access] demo contact insert failed:", error.message)
      return { ok: false, error: "Something went wrong. Try again in a moment." }
    }
  }

  await notifyOps("Demo-org lead: signup collision contact submitted", [
    `${requesterDisplayName(user)} (${user.email ?? user.id}) wants "${orgName ?? "unknown"}" (${collision.orgId}), a demo/test org.`,
    `Contact: ${contact}`,
    message ? `Their note: ${message}` : "No note left.",
    "Handover: convertDemoToCustomer on the admin org detail page (transfer + reclassify + trial in one step).",
  ])

  return { ok: true }
}
