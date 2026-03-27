"use server"

import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { triggerInitialLocationData } from "@/lib/jobs/triggers"
import { getProvider } from "@/lib/providers"
import {
  fetchAutocomplete,
  fetchPlaceDetails,
  mapPlaceToLocation,
} from "@/lib/places/google"
import { scoreCompetitor } from "@/lib/providers/scoring"
import { enrichCompetitorSeo } from "@/lib/seo/enrich"
import { enrichCompetitorContent } from "@/lib/content/enrich"
import { type SubscriptionTier, TIER_LIMITS } from "@/lib/billing/tiers"
import { ensureLocationLimit } from "@/lib/billing/limits"
import { TRIAL_DURATION_DAYS } from "@/lib/billing/trial"
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
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()
  const tier = (orgRow?.subscription_tier ?? "free") as SubscriptionTier

  const { count: locationCount } = await supabaseAdmin
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)

  try {
    ensureLocationLimit(tier, locationCount ?? 0)
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
  restaurantName: string
  cuisine: string | null
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

  const baseSlug = slugify(input.restaurantName)
  if (!baseSlug) {
    return { ok: false, error: "Restaurant name produces an invalid slug" }
  }

  // Retry slug with numeric suffix on collision (up to 5 attempts)
  let org: { id: string } | null = null
  let slugAttempt = baseSlug
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await admin
      .from("organizations")
      .insert({
        name: input.restaurantName,
        slug: slugAttempt,
        billing_email: user.email ?? null,
        trial_started_at: new Date().toISOString(),
        trial_ends_at: new Date(
          Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000
        ).toISOString(),
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
      name: input.place.name || input.restaurantName,
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

// ---------------------------------------------------------------------------
// Competitor discovery — pure function (no redirect)
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
  metadata: Record<string, unknown>
  relevance_score: number | null
}

export async function discoverCompetitorsForLocation(
  locationId: string,
  query?: string
): Promise<
  | { ok: true; competitors: DiscoveredCompetitor[] }
  | { ok: false; error: string }
> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()
  const radiusMeters = 5000

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

  const { data: membership } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", location.organization_id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) {
    return { ok: false, error: "You are not a member of this organization." }
  }

  if (location.geo_lat === null || location.geo_lng === null) {
    return { ok: false, error: "Location is missing coordinates" }
  }

  const provider = getProvider("gemini")
  const targetCategory =
    (location.settings as { category?: string } | null)?.category ?? null
  const keywordBase = query ?? targetCategory ?? "restaurant"
  const normalizedBase = keywordBase.replace(/_/g, " ").trim()
  const locationHint = location.city ?? location.name ?? undefined
  const keyword = [normalizedBase, locationHint, location.region]
    .filter((v): v is string => Boolean(v?.trim()))
    .join(" ")

  let candidates: Awaited<ReturnType<typeof provider.fetchCompetitorsNear>>
  try {
    candidates = await provider.fetchCompetitorsNear({
      lat: location.geo_lat,
      lng: location.geo_lng,
      radiusMeters,
      query: keyword,
    })
  } catch (err) {
    return { ok: false, error: `Discovery failed: ${String(err)}` }
  }

  if (!candidates?.length) {
    return { ok: true, competitors: [] }
  }

  // Resolve place IDs and enrich
  const resolvedCandidates = await Promise.all(
    candidates.map(async (candidate) => {
      const raw = (candidate.raw ?? {}) as Record<string, unknown>
      const rawPlaceId =
        typeof raw.placeId === "string" ? raw.placeId : undefined
      let providerEntityId = rawPlaceId ?? candidate.providerEntityId
      let placeDetailsError: string | null = null
      const isLikelyCid = (v: string) => /^\d{6,}$/.test(v)

      if (providerEntityId.startsWith("places/")) {
        providerEntityId = providerEntityId.replace("places/", "")
      }

      if (
        providerEntityId.startsWith("unknown:") ||
        providerEntityId.startsWith("cid:") ||
        isLikelyCid(providerEntityId)
      ) {
        const q = [candidate.name, location.city, location.region]
          .filter(Boolean)
          .join(" ")
          .trim()
        if (q) {
          try {
            const suggestions = await fetchAutocomplete(q)
            if (suggestions[0]?.place_id) {
              providerEntityId = suggestions[0].place_id
            } else {
              placeDetailsError = "Unable to resolve a valid Google Place ID."
            }
          } catch {
            placeDetailsError = "Unable to resolve a valid Google Place ID."
          }
        }
      }

      let enrichedRaw = { ...(candidate.raw as Record<string, unknown> | null) }
      let enrichedName = candidate.name
      let enrichedCategory = candidate.category
      let enrichedDistance = candidate.distanceMeters
      if (
        providerEntityId &&
        !providerEntityId.startsWith("unknown:") &&
        !providerEntityId.startsWith("cid:") &&
        !isLikelyCid(providerEntityId)
      ) {
        try {
          const details = await fetchPlaceDetails(providerEntityId)
          const mapped = mapPlaceToLocation(details)
          enrichedName = mapped.name || enrichedName
          enrichedCategory = mapped.category ?? enrichedCategory
          enrichedRaw = {
            ...enrichedRaw,
            address: mapped.address_line1,
            city: mapped.city,
            region: mapped.region,
            website: mapped.website,
            latitude: mapped.geo_lat,
            longitude: mapped.geo_lng,
            placeId: providerEntityId,
            rating: details.rating ?? null,
            placeDetails: {
              businessStatus: details.businessStatus ?? null,
              priceLevel: details.priceLevel ?? null,
              mapsUri: details.googleMapsUri ?? null,
              editorialSummary: details.editorialSummary?.text ?? null,
              shortFormattedAddress: details.shortFormattedAddress ?? null,
              reviews: details.reviews ?? null,
            },
          }
          if (
            typeof mapped.geo_lat === "number" &&
            typeof mapped.geo_lng === "number"
          ) {
            enrichedDistance = haversineMeters({
              lat1: location.geo_lat!,
              lng1: location.geo_lng!,
              lat2: mapped.geo_lat,
              lng2: mapped.geo_lng,
            })
          }
        } catch (err) {
          placeDetailsError = `Places details error: ${String(err)}`
        }
      }

      return {
        ...candidate,
        providerEntityId,
        name: enrichedName,
        category: enrichedCategory,
        distanceMeters: enrichedDistance,
        raw: { ...enrichedRaw, placeDetailsError },
      }
    })
  )

  // Build rows and upsert to DB
  const rows = resolvedCandidates
    .filter((c) => {
      if (c.providerEntityId === location.primary_place_id) return false
      if (c.name && location.name) {
        return c.name.trim().toLowerCase() !== location.name.trim().toLowerCase()
      }
      return true
    })
    .map((c) => {
      const raw = (c.raw ?? {}) as Record<string, unknown>
      const address =
        typeof raw.address === "string"
          ? raw.address
          : typeof raw.shortFormattedAddress === "string"
            ? raw.shortFormattedAddress
            : null
      const { score, factors } = scoreCompetitor({
        distanceMeters: c.distanceMeters,
        category: c.category,
        targetCategory,
        rating: c.rating,
        reviewCount: c.reviewCount,
      })

      return {
        location_id: location.id,
        provider: provider.name,
        provider_entity_id: c.providerEntityId,
        name: c.name,
        category: c.category ?? targetCategory ?? null,
        address,
        phone: typeof raw.phone === "string" ? raw.phone : null,
        website: typeof raw.website === "string" ? raw.website : null,
        relevance_score: score,
        is_active: false,
        metadata: {
          status: "pending",
          distanceMeters: c.distanceMeters ?? null,
          rating: c.rating ?? null,
          reviewCount: c.reviewCount ?? null,
          address,
          city: typeof raw.city === "string" ? raw.city : null,
          region: typeof raw.region === "string" ? raw.region : null,
          latitude: typeof raw.latitude === "number" ? raw.latitude : null,
          longitude: typeof raw.longitude === "number" ? raw.longitude : null,
          placeDetails: JSON.parse(JSON.stringify(raw.placeDetails ?? null)),
          factors: JSON.parse(JSON.stringify(factors)),
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

  // Re-fetch from DB so we have actual IDs
  const { data: dbCompetitors } = await admin
    .from("competitors")
    .select("id, name, category, address, metadata, relevance_score")
    .eq("location_id", locationId)
    .eq("is_active", false)
    .order("relevance_score", { ascending: false })

  return {
    ok: true,
    competitors: (dbCompetitors ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      address: c.address,
      metadata: (c.metadata as Record<string, unknown>) ?? {},
      relevance_score: c.relevance_score,
    })),
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

  // 1. Set current_organization_id on profile
  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    email: user.email ?? null,
    current_organization_id: input.orgId,
  })

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
  const { data: onboardOrgData } = await admin
    .from("organizations")
    .select("subscription_tier")
    .eq("id", input.orgId)
    .maybeSingle()
  const onboardTier = (onboardOrgData?.subscription_tier ?? "free") as SubscriptionTier
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

      // Fire-and-forget enrichment for each approved competitor
      const compMeta = comp.metadata as Record<string, unknown> | null
      const placeDetails = compMeta?.placeDetails as Record<string, unknown> | null
      const compWebsite =
        comp.website ??
        (placeDetails?.websiteUri as string | undefined) ??
        (compMeta?.website as string | undefined) ??
        null
      const compDomain = extractDomainFromUrl(compWebsite)
      const dateKey = new Date().toISOString().slice(0, 10)

      const { data: locData } = await admin
        .from("locations")
        .select("website")
        .eq("id", comp.location_id)
        .single()
      const locationDomain = extractDomainFromUrl(locData?.website)

      const { data: orgData } = await admin
        .from("organizations")
        .select("subscription_tier")
        .eq("id", input.orgId)
        .single()
      const tier = (orgData?.subscription_tier ?? "free") as SubscriptionTier

      const supabase = await createServerSupabaseClient()

      void (async () => {
        if (compDomain) {
          try {
            await enrichCompetitorSeo(
              compId,
              compDomain,
              locationDomain,
              dateKey,
              tier,
              supabase
            )
          } catch (err) {
            console.warn(`[Onboarding] SEO enrichment failed for ${comp.name}:`, err)
          }
        }
        if (compWebsite) {
          try {
            await enrichCompetitorContent(
              compId,
              comp.name ?? "Competitor",
              compWebsite,
              input.orgId,
              dateKey,
              supabase,
              null
            )
          } catch (err) {
            console.warn(
              `[Onboarding] Content enrichment failed for ${comp.name}:`,
              err
            )
          }
        }
      })()
    }
  }

  // Fire-and-forget welcome email
  const userEmail = user.email
  if (userEmail) {
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
      subject: "Welcome to Vatic — your intelligence is live",
      react: Welcome({
        userName,
        locationName: locInfo?.name ?? "Your location",
        competitorCount: input.competitorIds.length,
        dashboardUrl: `${appUrl}/home`,
      }),
    }).catch((err) => console.error("Welcome email failed:", err))
  }

  return { ok: true }
}
