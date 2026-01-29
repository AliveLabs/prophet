"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"

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

  const geoLatValue = String(formData.get("geo_lat") ?? "").trim()
  const geoLngValue = String(formData.get("geo_lng") ?? "").trim()
  const geoLat = geoLatValue ? Number.parseFloat(geoLatValue) : null
  const geoLng = geoLngValue ? Number.parseFloat(geoLngValue) : null

  const { error } = await supabase.from("locations").insert({
    organization_id: organizationId,
    name: locationName,
    address_line1: String(formData.get("address_line1") ?? "").trim() || null,
    city: String(formData.get("city") ?? "").trim() || null,
    region: String(formData.get("region") ?? "").trim() || null,
    postal_code: String(formData.get("postal_code") ?? "").trim() || null,
    country: String(formData.get("country") ?? "").trim() || "US",
    timezone: String(formData.get("timezone") ?? "").trim() || "America/New_York",
    primary_place_id: primaryPlaceId,
    settings: {
      category,
      types: placeTypes,
    },
    geo_lat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
    geo_lng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
  })

  if (error) {
    redirect(`/locations?error=${encodeURIComponent(error.message)}`)
  }

  redirect("/locations")
}

export async function updateLocationAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const locationId = String(formData.get("location_id") ?? "").trim()
  const name = String(formData.get("name") ?? "").trim()
  const addressLine1 = String(formData.get("address_line1") ?? "").trim()

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
    .update({
      name,
      address_line1: addressLine1 || null,
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
