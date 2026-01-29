"use server"

import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

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

  const { error: locationError } = await supabaseAdmin.from("locations").insert({
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
    settings: {
      category,
      types: placeTypes,
    },
    geo_lat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
    geo_lng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
  })

  if (locationError) {
    redirect(`/onboarding?error=${encodeURIComponent(locationError.message)}`)
  }

  redirect("/home")
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

  const geoLatValue = String(formData.get("geo_lat") ?? "").trim()
  const geoLngValue = String(formData.get("geo_lng") ?? "").trim()
  const geoLat = geoLatValue ? Number.parseFloat(geoLatValue) : null
  const geoLng = geoLngValue ? Number.parseFloat(geoLngValue) : null

  const { error: locationError } = await supabaseAdmin.from("locations").insert({
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
    geo_lat: Number.isFinite(geoLat ?? NaN) ? geoLat : null,
    geo_lng: Number.isFinite(geoLng ?? NaN) ? geoLng : null,
  })

  if (locationError) {
    redirect(`/onboarding?error=${encodeURIComponent(locationError.message)}`)
  }

  redirect("/home")
}
