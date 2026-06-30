"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { triggerInitialLocationData } from "@/lib/jobs/triggers"
import { ensureCanAddLocation } from "@/lib/billing/limits"

export async function createLocationFromPlaceAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const organizationId = String(formData.get("organization_id") ?? "").trim()
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

  if (!organizationId || !locationName || !primaryPlaceId) {
    redirect("/locations?error=Missing%20required%20fields")
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/locations?error=Unauthorized")
  }

  const { data: orgRow } = await supabase
    .from("organizations")
    .select("subscription_tier, trial_ends_at, payment_state")
    .eq("id", organizationId)
    .maybeSingle()

  const { count: locationCount } = await supabase
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)

  try {
    if (!orgRow) throw new Error("Organization not found")
    ensureCanAddLocation(orgRow, locationCount ?? 0)
  } catch (err) {
    redirect(`/locations?error=${encodeURIComponent(String(err instanceof Error ? err.message : err))}`)
  }

  const geoLatValue = String(formData.get("geo_lat") ?? "").trim()
  const geoLngValue = String(formData.get("geo_lng") ?? "").trim()
  const geoLat = geoLatValue ? Number.parseFloat(geoLatValue) : null
  const geoLng = geoLngValue ? Number.parseFloat(geoLngValue) : null

  const website = String(formData.get("website") ?? "").trim() || null

  const { data: newLocation, error } = await supabase
    .from("locations")
    .insert({
      organization_id: organizationId,
      name: locationName,
      address_line1: String(formData.get("address_line1") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      region: String(formData.get("region") ?? "").trim() || null,
      postal_code: String(formData.get("postal_code") ?? "").trim() || null,
      country: String(formData.get("country") ?? "").trim() || "US",
      timezone: String(formData.get("timezone") ?? "").trim() || "America/New_York",
      primary_place_id: primaryPlaceId,
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

  if (error || !newLocation) {
    redirect(`/locations?error=${encodeURIComponent(error?.message ?? "Failed to create location")}`)
  }

  // Fire-and-forget: initial data collection
  triggerInitialLocationData(newLocation.id, organizationId, {
    website,
    geoLat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
    geoLng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
  }).catch(() => {})

  redirect("/locations")
}

export async function updateLocationAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const locationId = String(formData.get("location_id") ?? "").trim()
  // ALT-225 — `name` is the operator's DISPLAY name (shown across the dashboard). It does NOT
  // touch the Google link (primary_place_id), so editing it is safe. Address is handled
  // separately, map-verified (ALT-224 → updateLocationAddressFromPlaceAction).
  const name = String(formData.get("name") ?? "").trim()
  const website = String(formData.get("website") ?? "").trim() || null

  if (!locationId || !name) {
    redirect("/locations?error=Missing%20required%20fields")
  }

  const { data: location } = await supabase
    .from("locations")
    .select("organization_id")
    .eq("id", locationId)
    .maybeSingle()

  if (!location) {
    redirect("/locations?error=Location%20not%20found")
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", location.organization_id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/locations?error=Unauthorized")
  }

  const { error } = await supabase
    .from("locations")
    .update({ name, website })
    .eq("id", locationId)

  if (error) {
    redirect(`/locations?error=${encodeURIComponent(error.message)}`)
  }

  redirect("/locations")
}

// ─────────────────────────────────────────────────────────────────────────────
// ALT-224 — edit your OWN location's address, MAP-VERIFIED. The operator picks the new
// place from Google Places autocomplete; we write the verified address + coordinates AND
// re-link `primary_place_id` to that place. Re-linking is the point: when a restaurant
// moves, its Google place changes too, so pointing at the verified place keeps the data
// link CORRECT rather than breaking it. `name` (the display name) and `website` are left
// untouched. Competitor addresses are intentionally NOT editable (we wait for Google).
// ─────────────────────────────────────────────────────────────────────────────
export async function updateLocationAddressFromPlaceAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const locationId = String(formData.get("location_id") ?? "").trim()
  const primaryPlaceId = String(formData.get("primary_place_id") ?? "").trim()
  if (!locationId || !primaryPlaceId) {
    redirect("/locations?error=Pick%20a%20verified%20address%20from%20the%20suggestions")
  }

  const { data: location } = await supabase
    .from("locations")
    .select("organization_id")
    .eq("id", locationId)
    .maybeSingle()
  if (!location) {
    redirect("/locations?error=Location%20not%20found")
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", location.organization_id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/locations?error=Unauthorized")
  }

  const geoLatRaw = String(formData.get("geo_lat") ?? "").trim()
  const geoLngRaw = String(formData.get("geo_lng") ?? "").trim()
  const geoLat = geoLatRaw ? Number.parseFloat(geoLatRaw) : null
  const geoLng = geoLngRaw ? Number.parseFloat(geoLngRaw) : null

  const { error } = await supabase
    .from("locations")
    .update({
      primary_place_id: primaryPlaceId,
      address_line1: String(formData.get("address_line1") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      region: String(formData.get("region") ?? "").trim() || null,
      postal_code: String(formData.get("postal_code") ?? "").trim() || null,
      country: String(formData.get("country") ?? "").trim() || "US",
      geo_lat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
      geo_lng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
    })
    .eq("id", locationId)

  if (error) {
    redirect(`/locations?error=${encodeURIComponent(error.message)}`)
  }

  redirect("/locations")
}

export async function deleteLocationAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const locationId = String(formData.get("location_id") ?? "").trim()
  if (!locationId) {
    redirect("/locations?error=Missing%20location")
  }

  const { data: location } = await supabase
    .from("locations")
    .select("organization_id")
    .eq("id", locationId)
    .maybeSingle()

  if (!location) {
    redirect("/locations?error=Location%20not%20found")
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", location.organization_id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/locations?error=Unauthorized")
  }

  const { error } = await supabase.from("locations").delete().eq("id", locationId)

  if (error) {
    redirect(`/locations?error=${encodeURIComponent(error.message)}`)
  }

  redirect("/locations")
}
