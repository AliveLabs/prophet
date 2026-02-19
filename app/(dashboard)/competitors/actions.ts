"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getProvider } from "@/lib/providers"
import { fetchAutocomplete, fetchPlaceDetails, mapPlaceToLocation } from "@/lib/places/google"

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function haversineMeters(input: {
  lat1: number
  lng1: number
  lat2: number
  lng2: number
}) {
  const earthRadiusMeters = 6371000
  const dLat = toRadians(input.lat2 - input.lat1)
  const dLng = toRadians(input.lng2 - input.lng1)
  const lat1 = toRadians(input.lat1)
  const lat2 = toRadians(input.lat2)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(earthRadiusMeters * c)
}
import { scoreCompetitor } from "@/lib/providers/scoring"
import { ensureCompetitorLimit } from "@/lib/billing/limits"
import type { SubscriptionTier } from "@/lib/billing/tiers"
import { requireUser } from "@/lib/auth/server"
import { enrichCompetitorSeo } from "@/lib/seo/enrich"
import { enrichCompetitorContent } from "@/lib/content/enrich"

export async function discoverCompetitorsAction(formData: FormData) {
  await requireUser()
  const locationId = String(formData.get("location_id") ?? "")
  const query = String(formData.get("query") ?? "").trim() || undefined
  const radiusMeters = 5000

  if (!locationId) {
    redirect("/competitors?error=Missing%20location")
  }

  const supabase = await createServerSupabaseClient()
  const { data: location, error: locationError } = await supabase
    .from("locations")
    .select("id, organization_id, geo_lat, geo_lng, settings, primary_place_id, name, city, region")
    .eq("id", locationId)
    .single()

  if (locationError || !location) {
    redirect(`/competitors?error=${encodeURIComponent(locationError?.message ?? "Location not found")}`)
  }

  if (location.geo_lat === null || location.geo_lng === null) {
    redirect("/competitors?error=Location%20is%20missing%20coordinates")
  }

  const provider = getProvider("gemini")
  let targetCategory = (location.settings as { category?: string } | null)?.category ?? null
  if (!targetCategory && location.primary_place_id) {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/places/details?place_id=${encodeURIComponent(location.primary_place_id)}`
      )
      const data = await response.json()
      if (data?.place?.category) {
        targetCategory = data.place.category
        await supabase
          .from("locations")
          .update({
            settings: {
              ...(location.settings as Record<string, unknown> | null),
              category: data.place.category,
              types: data.place.types ?? [],
            },
          })
          .eq("id", location.id)
      }
    } catch {
      // Ignore category enrichment failures.
    }
  }
  const keywordBase = query ?? targetCategory ?? "restaurant"
  const normalizedBase = keywordBase.replace(/_/g, " ").trim()
  const locationHint = location.city ?? location.name ?? undefined
  const keyword = [normalizedBase, locationHint, location.region]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ")
  let candidates: Awaited<ReturnType<typeof provider.fetchCompetitorsNear>>
  try {
    candidates = await provider.fetchCompetitorsNear({
      lat: location.geo_lat,
      lng: location.geo_lng,
      radiusMeters,
      query: keyword,
    })
  } catch (error) {
    const debug = {
      locationId,
      keyword,
      query,
      targetCategory,
      lat: location.geo_lat,
      lng: location.geo_lng,
      radiusMeters,
      location: {
        name: location.name ?? null,
        city: location.city ?? null,
        region: location.region ?? null,
      },
      primaryPlaceId: location.primary_place_id ?? null,
      providerError: String(error),
    }
    redirect(
      `/competitors?error=${encodeURIComponent(String(error))}&debug=${encodeURIComponent(
        JSON.stringify(debug)
      )}`
    )
  }

  if (!candidates || candidates.length === 0) {
    const debug = {
      locationId,
      keyword,
      query,
      targetCategory,
      lat: location.geo_lat,
      lng: location.geo_lng,
      radiusMeters,
      location: {
        name: location.name ?? null,
        city: location.city ?? null,
        region: location.region ?? null,
      },
      primaryPlaceId: location.primary_place_id ?? null,
      providerError: "No competitors returned",
    }
    redirect(
      `/competitors?error=${encodeURIComponent(
        `No competitors found (keyword: ${keyword}).`
      )}&debug=${encodeURIComponent(JSON.stringify(debug))}`
    )
  }

  const resolvedCandidates = await Promise.all(
    candidates.map(async (candidate) => {
      const raw = (candidate.raw ?? {}) as Record<string, unknown>
      const rawPlaceId =
        typeof raw.placeId === "string" ? raw.placeId : undefined
      let providerEntityId = rawPlaceId ?? candidate.providerEntityId
      let placeDetailsError: string | null = null
      const isLikelyCid = (value: string) => /^\d{6,}$/.test(value)

      if (providerEntityId.startsWith("places/")) {
        providerEntityId = providerEntityId.replace("places/", "")
      }

      if (
        providerEntityId.startsWith("unknown:") ||
        providerEntityId.startsWith("cid:") ||
        isLikelyCid(providerEntityId)
      ) {
        const query = [candidate.name, location.city, location.region]
          .filter(Boolean)
          .join(" ")
          .trim()
        if (query) {
          try {
            const suggestions = await fetchAutocomplete(query)
            if (suggestions[0]?.place_id) {
              providerEntityId = suggestions[0].place_id
            } else {
              placeDetailsError = "Unable to resolve a valid Google Place ID."
            }
          } catch {
            placeDetailsError = "Unable to resolve a valid Google Place ID."
          }
        } else {
          placeDetailsError = "Missing location context to resolve Place ID."
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
          const placeDetails = await fetchPlaceDetails(providerEntityId)
          const placeDetailsPayload = {
            businessStatus: placeDetails.businessStatus ?? null,
            priceLevel: placeDetails.priceLevel ?? null,
            mapsUri: placeDetails.googleMapsUri ?? null,
            utcOffsetMinutes: placeDetails.utcOffsetMinutes ?? null,
            editorialSummary: placeDetails.editorialSummary?.text ?? null,
            shortFormattedAddress: placeDetails.shortFormattedAddress ?? null,
            adrFormatAddress: placeDetails.adrFormatAddress ?? null,
            currentOpeningHours: placeDetails.currentOpeningHours ?? null,
            regularOpeningHours: placeDetails.regularOpeningHours ?? null,
            reviews: placeDetails.reviews ?? null,
            types: placeDetails.types ?? null,
            primaryType: placeDetails.primaryType ?? null,
            placeId: placeDetails.id ?? null,
          }
          const mapped = mapPlaceToLocation(placeDetails)
          enrichedName = mapped.name || enrichedName
          enrichedCategory = mapped.category ?? enrichedCategory
          enrichedRaw = {
            ...enrichedRaw,
            address: mapped.address_line1,
            city: mapped.city,
            region: mapped.region,
            postalCode: mapped.postal_code,
            country: mapped.country,
            phone: mapped.phone,
            website: mapped.website,
            latitude: mapped.geo_lat,
            longitude: mapped.geo_lng,
            placeId: providerEntityId,
            types: mapped.types,
            shortFormattedAddress: placeDetails.shortFormattedAddress ?? null,
            adrFormatAddress: placeDetails.adrFormatAddress ?? null,
            placeDetails: placeDetailsPayload,
            placeDetailsFetchedAt: new Date().toISOString(),
          }
          if (
            typeof mapped.geo_lat === "number" &&
            typeof mapped.geo_lng === "number"
          ) {
            enrichedDistance = haversineMeters({
              lat1: location.geo_lat,
              lng1: location.geo_lng,
              lat2: mapped.geo_lat,
              lng2: mapped.geo_lng,
            })
          }
        } catch (error) {
          placeDetailsError = `Places details error: ${String(error)}`
        }
      } else {
        placeDetailsError =
          placeDetailsError ?? "Missing Google Places ID for this competitor."
      }

      return {
        ...candidate,
        providerEntityId,
        name: enrichedName,
        category: enrichedCategory,
        distanceMeters: enrichedDistance,
        raw: {
          ...enrichedRaw,
          placeDetailsError,
        },
      }
    })
  )

  const rows = resolvedCandidates
    .filter((candidate) => {
      if (candidate.providerEntityId === location.primary_place_id) {
        return false
      }
      if (candidate.name && location.name) {
        return candidate.name.trim().toLowerCase() !== location.name.trim().toLowerCase()
      }
      return true
    })
    .map((candidate) => {
    const raw = (candidate.raw ?? {}) as Record<string, unknown>
    const sources = Array.isArray(raw.sources) ? raw.sources : []
    const searchQueries = Array.isArray(raw.searchQueries) ? raw.searchQueries : []
    const searchEntryPointHtml =
      typeof raw.searchEntryPointHtml === "string" ? raw.searchEntryPointHtml : null
    const mapsWidgetContextToken =
      typeof raw.mapsWidgetContextToken === "string" ? raw.mapsWidgetContextToken : null
    const placeDetails = (raw.placeDetails as Record<string, unknown> | null) ?? null
    const placeDetailsError =
      typeof raw.placeDetailsError === "string" ? raw.placeDetailsError : null
    const address =
      typeof raw.address === "string"
        ? raw.address
        : typeof raw.shortFormattedAddress === "string"
          ? raw.shortFormattedAddress
          : typeof raw.adrFormatAddress === "string"
            ? raw.adrFormatAddress
            : null
    const city = typeof raw.city === "string" ? raw.city : null
    const region = typeof raw.region === "string" ? raw.region : null
    const phone = typeof raw.phone === "string" ? raw.phone : null
    const website = typeof raw.website === "string" ? raw.website : null
    const latitude = typeof raw.latitude === "number" ? raw.latitude : null
    const longitude = typeof raw.longitude === "number" ? raw.longitude : null
    const { score, factors } = scoreCompetitor({
      distanceMeters: candidate.distanceMeters,
      category: candidate.category,
      targetCategory,
      rating: candidate.rating,
      reviewCount: candidate.reviewCount,
    })

    const category = candidate.category ?? targetCategory ?? null
    return {
      location_id: location.id,
      provider: provider.name,
      provider_entity_id: candidate.providerEntityId,
      name: candidate.name,
      category,
      address,
      phone,
      website,
      relevance_score: score,
      is_active: false,
      metadata: {
        status: "pending",
        distanceMeters: candidate.distanceMeters ?? null,
        rating: candidate.rating ?? null,
        reviewCount: candidate.reviewCount ?? null,
        address,
        city,
        region,
        phone,
        website,
        placeDetails,
        placeDetailsError,
        latitude,
        longitude,
        factors,
        sources,
        searchQueries,
        searchEntryPointHtml,
        mapsWidgetContextToken,
      },
    }
    })

  if (rows.length) {
    const { error } = await supabase
      .from("competitors")
      .upsert(rows, {
        onConflict: "provider,provider_entity_id,location_id",
      })

    if (error) {
      redirect(`/competitors?error=${encodeURIComponent(error.message)}`)
    }
  }

  redirect("/competitors")
}

export async function approveCompetitorAction(formData: FormData) {
  const user = await requireUser()
  const competitorId = String(formData.get("competitor_id") ?? "")
  if (!competitorId) {
    redirect("/competitors?error=Missing%20competitor")
  }

  const supabase = await createServerSupabaseClient()
  const { data: competitor } = await supabase
    .from("competitors")
    .select("metadata, location_id, name, website, locations (organization_id, website)")
    .eq("id", competitorId)
    .single()

  if (!competitor) {
    redirect("/competitors?error=Competitor%20not%20found")
  }

  const locationRecord = Array.isArray(competitor?.locations)
    ? competitor?.locations?.[0]
    : competitor?.locations
  const organizationId = (locationRecord as { organization_id?: string } | null)
    ?.organization_id

  if (!organizationId) {
    redirect("/competitors?error=Organization%20not%20found")
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/competitors?error=Only%20admins%20can%20approve%20competitors")
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .single()

  const tier = (organization?.subscription_tier ?? "free") as SubscriptionTier

  const { count } = await supabase
    .from("competitors")
    .select("id", { count: "exact", head: true })
    .eq("location_id", competitor.location_id)
    .eq("is_active", true)

  try {
    ensureCompetitorLimit(tier, count ?? 0)
  } catch (error) {
    redirect(`/competitors?error=${encodeURIComponent(String(error))}`)
  }

  const metadata = {
    ...(competitor?.metadata as Record<string, unknown> | null),
    status: "approved",
  }

  const { data: updated, error } = await supabase
    .from("competitors")
    .update({ is_active: true, metadata })
    .eq("id", competitorId)
    .select("id")
    .maybeSingle()

  if (error || !updated) {
    const admin = createAdminSupabaseClient()
    const { data: adminUpdated, error: adminError } = await admin
      .from("competitors")
      .update({ is_active: true, metadata })
      .eq("id", competitorId)
      .select("id")
      .maybeSingle()

    if (adminError || !adminUpdated) {
      redirect(
        `/competitors?error=${encodeURIComponent(
          adminError?.message ?? "Unable to update competitor"
        )}`
      )
    }
  }

  // =========================================================================
  // Enrich competitor with SEO + Content data (non-blocking: failures logged)
  // =========================================================================
  const dateKey = new Date().toISOString().slice(0, 10)
  const compMeta = competitor.metadata as Record<string, unknown> | null
  const placeDetails = compMeta?.placeDetails as Record<string, unknown> | null

  // Resolve competitor domain
  const compWebsite =
    competitor.website ??
    (placeDetails?.websiteUri as string | undefined) ??
    (compMeta?.website as string | undefined) ??
    null
  const compDomain = extractDomainFromUrl(compWebsite)

  // Resolve location domain
  const locationWebsite = (locationRecord as { website?: string } | null)?.website ?? null
  const locationDomain = extractDomainFromUrl(locationWebsite)

  // SEO enrichment
  if (compDomain) {
    try {
      const { warnings } = await enrichCompetitorSeo(
        competitorId,
        compDomain,
        locationDomain,
        dateKey,
        tier,
        supabase
      )
      if (warnings.length > 0) {
        console.warn(`[Approve] SEO enrichment warnings for ${competitor.name}:`, warnings)
      }
    } catch (err) {
      console.warn(`[Approve] SEO enrichment failed for ${competitor.name}:`, err)
    }
  }

  // Content/menu enrichment
  if (compWebsite) {
    try {
      const compAddress = (placeDetails?.formattedAddress as string) ?? null
      const { warnings } = await enrichCompetitorContent(
        competitorId,
        competitor.name ?? "Competitor",
        compWebsite,
        organizationId,
        dateKey,
        supabase,
        compAddress
      )
      if (warnings.length > 0) {
        console.warn(`[Approve] Content enrichment warnings for ${competitor.name}:`, warnings)
      }
    } catch (err) {
      console.warn(`[Approve] Content enrichment failed for ${competitor.name}:`, err)
    }
  }

  redirect("/competitors")
}

function extractDomainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

export async function ignoreCompetitorAction(formData: FormData) {
  const user = await requireUser()
  const competitorId = String(formData.get("competitor_id") ?? "")
  if (!competitorId) {
    redirect("/competitors?error=Missing%20competitor")
  }

  const supabase = await createServerSupabaseClient()
  const { data: competitor } = await supabase
    .from("competitors")
    .select("metadata, location_id, locations (organization_id)")
    .eq("id", competitorId)
    .single()

  if (!competitor) {
    redirect("/competitors?error=Competitor%20not%20found")
  }

  const locationRecord = Array.isArray(competitor?.locations)
    ? competitor?.locations?.[0]
    : competitor?.locations
  const organizationId = (locationRecord as { organization_id?: string } | null)
    ?.organization_id

  if (!organizationId) {
    redirect("/competitors?error=Organization%20not%20found")
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/competitors?error=Only%20admins%20can%20ignore%20competitors")
  }

  const metadata = {
    ...(competitor?.metadata as Record<string, unknown> | null),
    status: "ignored",
  }

  const { data: updated, error } = await supabase
    .from("competitors")
    .update({ is_active: false, metadata })
    .eq("id", competitorId)
    .select("id")
    .maybeSingle()

  if (error || !updated) {
    const admin = createAdminSupabaseClient()
    const { data: adminUpdated, error: adminError } = await admin
      .from("competitors")
      .update({ is_active: false, metadata })
      .eq("id", competitorId)
      .select("id")
      .maybeSingle()

    if (adminError || !adminUpdated) {
      redirect(
        `/competitors?error=${encodeURIComponent(
          adminError?.message ?? "Unable to update competitor"
        )}`
      )
    }
  }

  redirect("/competitors")
}
