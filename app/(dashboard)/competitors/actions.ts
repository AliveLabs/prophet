"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { fetchPlaceDetails, mapPlaceToLocation } from "@/lib/places/google"

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
import { ensureCompetitorLimit, computeSwapCooldown, COMPETITOR_SWAP_COOLDOWN_DAYS } from "@/lib/billing/limits"
import { asSubscriptionTier, TIER_LIMITS } from "@/lib/billing/tiers"
import { requireUser } from "@/lib/auth/server"
import { enrichCompetitorSeo } from "@/lib/seo/enrich"
import { enrichCompetitorContent } from "@/lib/content/enrich"

// (Removed) discoverCompetitorsAction — the old Gemini keyword-discovery form action.
// No UI called it, and onboarding now does identity-aware discovery (see
// app/onboarding/actions.ts + lib/competitors/discover.ts). Operators add
// competitors through the Places picker + addCompetitorAction below.

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

  const tier = asSubscriptionTier(organization?.subscription_tier)

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
  // Fire-and-forget background enrichment so the UI isn't blocked
  // =========================================================================
  const dateKey = new Date().toISOString().slice(0, 10)
  const compMeta = competitor.metadata as Record<string, unknown> | null
  const placeDetails = compMeta?.placeDetails as Record<string, unknown> | null

  const compWebsite =
    competitor.website ??
    (placeDetails?.websiteUri as string | undefined) ??
    (compMeta?.website as string | undefined) ??
    null
  const compDomain = extractDomainFromUrl(compWebsite)

  const locationWebsite = (locationRecord as { website?: string } | null)?.website ?? null
  const locationDomain = extractDomainFromUrl(locationWebsite)

  const competitorName = competitor.name ?? "Competitor"

  // Run enrichment in background – don't await
  void (async () => {
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
          console.warn(`[Approve] SEO enrichment warnings for ${competitorName}:`, warnings)
        }
      } catch (err) {
        console.warn(`[Approve] SEO enrichment failed for ${competitorName}:`, err)
      }
    }

    if (compWebsite) {
      try {
        const compAddress = (placeDetails?.formattedAddress as string) ?? null
        const { warnings } = await enrichCompetitorContent(
          competitorId,
          competitorName,
          compWebsite,
          organizationId,
          dateKey,
          supabase,
          compAddress
        )
        if (warnings.length > 0) {
          console.warn(`[Approve] Content enrichment warnings for ${competitorName}:`, warnings)
        }
      } catch (err) {
        console.warn(`[Approve] Content enrichment failed for ${competitorName}:`, err)
      }
    }

    console.log(`[Approve] Background enrichment complete for ${competitorName}`)
  })()

  redirect(
    `/competitors?success=${encodeURIComponent(
      `${competitorName} approved. Data enrichment started in background.`
    )}`
  )
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

  // ALT-195 — one competitor swap per 30 days. A swap begins with a removal, so we
  // gate the remove step: if another competitor at this location was removed inside
  // the cooldown window, this removal is locked. Bypass-proof (the UI also disables
  // the remove button + shows the rule). Derived from existing timestamps — no migration.
  const { data: priorRemovals } = await supabase
    .from("competitors")
    .select("updated_at, metadata")
    .eq("location_id", competitor.location_id)
    .eq("is_active", false)
  let lastRemovalAt: string | null = null
  for (const r of priorRemovals ?? []) {
    if ((r.metadata as Record<string, unknown> | null)?.status !== "ignored") continue
    const ts = r.updated_at as string | null
    if (ts && (!lastRemovalAt || ts > lastRemovalAt)) lastRemovalAt = ts
  }
  // ALT-261: the cooldown only binds a real SWAP — a removal while the set is already at
  // the plan cap. Below the cap, removing just frees a slot (not a swap), so it must not
  // be blocked. Mirror the UI's atLimit guard + computeSwapCooldown's documented intent.
  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()
  const tier = asSubscriptionTier(org?.subscription_tier)
  const { count: activeCount } = await supabase
    .from("competitors")
    .select("id", { count: "exact", head: true })
    .eq("location_id", competitor.location_id)
    .eq("is_active", true)
  const atCap = (activeCount ?? 0) >= TIER_LIMITS[tier].maxCompetitorsPerLocation

  const cooldown = computeSwapCooldown(lastRemovalAt)
  if (atCap && cooldown.locked) {
    redirect(
      `/competitors?error=${encodeURIComponent(
        `You can swap a competitor once every ${COMPETITOR_SWAP_COOLDOWN_DAYS} days. Locked for ${cooldown.daysRemaining} more day${cooldown.daysRemaining === 1 ? "" : "s"}.`
      )}`
    )
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

// ---------------------------------------------------------------------------
// Add-a-competitor with real discovery (complete-picture · Batch 3). The operator
// picks a place via authed autocomplete; we persist it APPROVED (their explicit
// choice) and force a first-pull through the durable queue — no fire-and-forget.
// ---------------------------------------------------------------------------

import { revalidatePath } from "next/cache"
import { enqueueAdhocLocation } from "@/lib/jobs/queue"

export async function addCompetitorAction(input: {
  locationId: string
  placeId: string
}): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: location } = await supabase
    .from("locations")
    .select("id, organization_id, name, primary_place_id, geo_lat, geo_lng, settings")
    .eq("id", input.locationId)
    .maybeSingle()
  if (!location) return { ok: false, error: "Location not found" }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", location.organization_id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only admins can add competitors" }
  }

  if (input.placeId === location.primary_place_id) {
    return { ok: false, error: "That's your own restaurant" }
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", location.organization_id)
    .maybeSingle()
  const tier = asSubscriptionTier(org?.subscription_tier)
  const { count: activeCount } = await supabase
    .from("competitors")
    .select("id", { count: "exact", head: true })
    .eq("location_id", location.id)
    .eq("is_active", true)
  try {
    ensureCompetitorLimit(tier, activeCount ?? 0)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const admin = createAdminSupabaseClient()

  // Already on file (e.g. surfaced by discovery, never approved)? Approve that row.
  const { data: existing } = await admin
    .from("competitors")
    .select("id, name, metadata")
    .eq("location_id", location.id)
    .eq("provider_entity_id", input.placeId)
    .maybeSingle()

  let competitorId: string
  let competitorName: string
  if (existing) {
    const metadata = { ...(existing.metadata as Record<string, unknown> | null), status: "approved" }
    const { error } = await admin
      .from("competitors")
      .update({ is_active: true, metadata })
      .eq("id", existing.id)
    if (error) return { ok: false, error: error.message }
    competitorId = existing.id
    competitorName = existing.name ?? "Competitor"
  } else {
    let details: Awaited<ReturnType<typeof fetchPlaceDetails>>
    try {
      details = await fetchPlaceDetails(input.placeId)
    } catch (err) {
      return { ok: false, error: `Couldn't load that place: ${err instanceof Error ? err.message : err}` }
    }
    const mapped = mapPlaceToLocation(details)
    if (mapped.name && location.name && mapped.name.trim().toLowerCase() === location.name.trim().toLowerCase()) {
      return { ok: false, error: "That's your own restaurant" }
    }

    const targetCategory = (location.settings as { category?: string } | null)?.category ?? null
    const distanceMeters =
      typeof mapped.geo_lat === "number" && typeof mapped.geo_lng === "number" &&
      typeof location.geo_lat === "number" && typeof location.geo_lng === "number"
        ? haversineMeters({ lat1: location.geo_lat, lng1: location.geo_lng, lat2: mapped.geo_lat, lng2: mapped.geo_lng })
        : null
    const { score, factors } = scoreCompetitor({
      distanceMeters: distanceMeters ?? undefined,
      category: mapped.category ?? undefined,
      targetCategory,
      rating: details.rating ?? undefined,
      reviewCount: details.userRatingCount ?? undefined,
      types: mapped.types ?? null,
    })

    const { data: inserted, error } = await admin
      .from("competitors")
      .insert({
        location_id: location.id,
        provider: "google_places",
        provider_entity_id: input.placeId,
        name: mapped.name || "Competitor",
        category: mapped.category ?? targetCategory ?? null,
        address: mapped.address_line1,
        phone: mapped.phone,
        website: mapped.website,
        relevance_score: score,
        is_active: true,
        metadata: {
          status: "approved",
          addedBy: "operator",
          distanceMeters,
          rating: details.rating ?? null,
          reviewCount: details.userRatingCount ?? null,
          address: mapped.address_line1,
          city: mapped.city,
          region: mapped.region,
          latitude: mapped.geo_lat,
          longitude: mapped.geo_lng,
          placeDetails: {
            placeId: details.id ?? null,
            businessStatus: details.businessStatus ?? null,
            priceLevel: details.priceLevel ?? null,
            mapsUri: details.googleMapsUri ?? null,
            shortFormattedAddress: details.shortFormattedAddress ?? null,
            regularOpeningHours: details.regularOpeningHours ?? null,
            reviews: details.reviews ?? null,
            types: details.types ?? null,
            primaryType: details.primaryType ?? null,
            rating: details.rating ?? null,
            reviewCount: details.userRatingCount ?? null,
          },
          factors,
        },
      })
      .select("id, name")
      .single()
    if (error || !inserted) return { ok: false, error: error?.message ?? "Couldn't save competitor" }
    competitorId = inserted.id
    competitorName = inserted.name ?? "Competitor"
  }

  // First-pull for the new rival through the durable queue (content/visibility/social/
  // photos now; insights follows on the run's delay) — same path the refresh buttons use.
  await enqueueAdhocLocation(admin, {
    organizationId: location.organization_id,
    locationId: location.id,
    pipelines: ["content", "visibility", "social", "photos"],
  })

  revalidatePath("/competitors")
  return { ok: true, id: competitorId, name: competitorName }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALT-225 — operator-set DISPLAY LABEL for a watched competitor (display-only).
// Shown INSTEAD of the canonical Google name wherever the competitor renders; the
// raw `name` is never touched, so matching/de-dup + the Places link stay intact.
// Blank ⇒ NULL ⇒ fall back to the canonical name. Managed on the competitor detail
// page (where the operator is already looking at that rival).
// ─────────────────────────────────────────────────────────────────────────────
export async function updateCompetitorDisplayLabelAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const competitorId = String(formData.get("competitor_id") ?? "").trim()
  const displayLabel = String(formData.get("display_label") ?? "").trim() || null
  if (!competitorId) redirect("/competitors?error=Missing%20competitor")

  // RLS-scoped read: a foreign competitor returns null (never leaks another org's row).
  const { data: competitor } = await supabase
    .from("competitors")
    .select("id, location_id")
    .eq("id", competitorId)
    .maybeSingle()
  if (!competitor) redirect("/competitors?error=Competitor%20not%20found")

  const { data: location } = await supabase
    .from("locations")
    .select("organization_id")
    .eq("id", competitor.location_id)
    .maybeSingle()
  if (!location) redirect("/competitors?error=Competitor%20not%20found")

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", location.organization_id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect(`/competitors/${competitorId}?error=Unauthorized`)
  }

  const { error } = await supabase
    .from("competitors")
    .update({ display_label: displayLabel })
    .eq("id", competitorId)
  if (error) {
    redirect(`/competitors/${competitorId}?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath("/competitors")
  revalidatePath(`/competitors/${competitorId}`)
  redirect(`/competitors/${competitorId}?success=Display%20label%20updated`)
}
