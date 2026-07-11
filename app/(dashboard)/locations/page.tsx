// Locations — REBUILT to "The Pass" (Concept A).
//
// STRUCTURE rebuild, not a reskin: the old vertical stack of bordered rows is
// re-authored into a lead HERO (first location) + a grid of location CARDS, with
// each location's full Google profile / hours / reviews / weather / content
// status + the edit form living in a kit DRAWER. Composed from components/ticket.
//
// This server component keeps ALL the original data fetching, the Google Places
// / weather / content-snapshot reads, and the server actions UNCHANGED — it only
// shapes the rows into an honest view model (no fabricated metrics) and hands it
// to the <LocationsBoard/> client island for presentation.

import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createLocationFromPlaceAction, deleteLocationAction, updateLocationAction, updateLocationAddressFromPlaceAction } from "./actions"
import { fetchPlaceDetails } from "@/lib/places/google"
import { fetchCurrentConditions, type WeatherSnapshot } from "@/lib/weather/google"
import { getScreenshotUrl } from "@/lib/content/storage"
import { fetchOwnPhotos } from "@/lib/cache/photos"
import { pickCoverPhotoWithFocal, type PickedPhoto } from "@/lib/places/listing-audit"
import { humanizeLabel } from "@/lib/skills/evidence-format"
import type { MenuSnapshot, SiteContentSnapshot } from "@/lib/content/types"
import { LocationsBoard, type LocationCard } from "./locations-board"
import "./locations.css"
import { TkRule } from "@/components/ticket"

const formatTemperature = (weather: WeatherSnapshot | null): string => {
  if (!weather || typeof weather.temperature !== "number") return "—"
  const unit = weather.tempUnit === "FAHRENHEIT" ? "°F" : weather.tempUnit === "CELSIUS" ? "°C" : "°"
  return `${Math.round(weather.temperature)}${unit}`
}

const weatherView = (weather: WeatherSnapshot | null): LocationCard["weather"] => {
  if (!weather) return null
  const windText =
    typeof weather.windSpeed === "number" && weather.windUnit
      ? `Wind ${Math.round(weather.windSpeed)} ${weather.windUnit}`
      : null
  return {
    temp: formatTemperature(weather),
    condition: weather.condition,
    humidity: typeof weather.humidity === "number" ? weather.humidity : null,
    windText,
    iconUrl: weather.iconUrl,
  }
}

type LocationsPageProps = {
  searchParams?: Promise<{
    error?: string
  }>
}

export default async function LocationsPage({ searchParams }: LocationsPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) {
    return null
  }

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, city, region, country, address_line1, primary_place_id, geo_lat, geo_lng, website")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const placeProfiles = await Promise.all(
    (locations ?? []).map(async (location) => {
      if (!location.primary_place_id) {
        const lat = location.geo_lat
        const lng = location.geo_lng
        const weather =
          typeof lat === "number" && typeof lng === "number"
            ? await fetchCurrentConditions({ lat, lng })
            : null
        return { locationId: location.id, details: null, weather }
      }
      try {
        const details = await fetchPlaceDetails(location.primary_place_id)
        const lat = details.location?.latitude ?? location.geo_lat ?? null
        const lng = details.location?.longitude ?? location.geo_lng ?? null
        const weather =
          typeof lat === "number" && typeof lng === "number"
            ? await fetchCurrentConditions({ lat, lng })
            : null
        return { locationId: location.id, details, weather }
      } catch {
        const lat = location.geo_lat
        const lng = location.geo_lng
        const weather =
          typeof lat === "number" && typeof lng === "number"
            ? await fetchCurrentConditions({ lat, lng })
            : null
        return { locationId: location.id, details: null, weather }
      }
    })
  )
  const placeProfileMap = new Map(
    placeProfiles.map((profile) => [profile.locationId, profile.details])
  )
  const weatherMap = new Map(placeProfiles.map((profile) => [profile.locationId, profile.weather]))

  // Fetch content snapshots for each location (screenshot + menu status)
  type ContentInfo = {
    screenshotUrl: string | null
    menuItemCount: number
    menuConfidence: string | null
    lastScrapedAt: string | null
  }
  const contentInfoMap = new Map<string, ContentInfo>()
  await Promise.all(
    (locations ?? []).map(async (location) => {
      try {
        const { data: siteSnap } = await supabase
          .from("location_snapshots")
          .select("raw_data, date_key")
          .eq("location_id", location.id)
          .eq("provider", "firecrawl_site_content")
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()

        const { data: menuSnapRow } = await supabase
          .from("location_snapshots")
          .select("raw_data, date_key")
          .eq("location_id", location.id)
          .eq("provider", "firecrawl_menu")
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()

        let scrUrl: string | null = null
        if (siteSnap) {
          const sc = siteSnap.raw_data as SiteContentSnapshot
          if (sc?.screenshot?.storagePath) {
            scrUrl = await getScreenshotUrl(sc.screenshot.storagePath)
          }
        }

        const menuData = menuSnapRow?.raw_data as MenuSnapshot | null
        contentInfoMap.set(location.id, {
          screenshotUrl: scrUrl,
          menuItemCount: menuData?.parseMeta?.itemsTotal ?? 0,
          menuConfidence: menuData?.parseMeta?.confidence ?? null,
          lastScrapedAt: siteSnap?.date_key ?? menuSnapRow?.date_key ?? null,
        })
      } catch {
        contentInfoMap.set(location.id, {
          screenshotUrl: null,
          menuItemCount: 0,
          menuConfidence: null,
          lastScrapedAt: null,
        })
      }
    })
  )

  // Hero imagery: each location's own-listing Google cover (+ its focal point for crop
  // anchoring), so the lead hero shows a real, on-subject photo instead of the gradient
  // default. Pure rank over the cached location_photos rows — no new Places calls.
  const coverMap = new Map<string, PickedPhoto | null>()
  await Promise.all(
    (locations ?? []).map(async (location) => {
      const rows = await fetchOwnPhotos(location.id)
      coverMap.set(location.id, pickCoverPhotoWithFocal(rows.map((p) => ({ analysis_result: p.analysis_result, image_url: p.image_url }))))
    })
  )

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const error = resolvedSearchParams?.error

  // ── shape the honest view model (no fabricated metrics) ──
  const cards: LocationCard[] = (locations ?? []).map((location) => {
    const placeDetails = placeProfileMap.get(location.id)
    const weather = weatherMap.get(location.id) ?? null
    const contentInfo = contentInfoMap.get(location.id)

    const latitude = placeDetails?.location?.latitude ?? location.geo_lat ?? null
    const longitude = placeDetails?.location?.longitude ?? location.geo_lng ?? null
    const address = placeDetails?.formattedAddress ?? location.address_line1 ?? null
    const website = placeDetails?.websiteUri ?? null
    // ALT-225 — the operator's chosen name wins over Google's listing name everywhere,
    // including this management view + the edit-form default (editName below).
    const displayName = location.name?.trim() || placeDetails?.displayName?.text || "Location"
    const cityLine = [location.city, location.region].filter(Boolean).join(", ") || "Location"

    const reviews = (placeDetails?.reviews ?? []).slice(0, 2).map((review) => ({
      text: review?.text?.text ?? "Review text unavailable.",
      who: review?.authorAttribution?.displayName ?? "Google user",
      when: review?.relativePublishTimeDescription ?? "recent",
      rating: typeof review?.rating === "number" ? review.rating : null,
    }))

    return {
      id: location.id,
      name: displayName,
      primaryType: placeDetails?.primaryType ? humanizeLabel(placeDetails.primaryType) : null,
      cityLine,
      address,
      rating: typeof placeDetails?.rating === "number" ? placeDetails.rating : null,
      reviewCount: typeof placeDetails?.userRatingCount === "number" ? placeDetails.userRatingCount : null,
      phone: placeDetails?.internationalPhoneNumber ?? placeDetails?.nationalPhoneNumber ?? null,
      website,
      mapsUri: placeDetails?.googleMapsUri ?? null,
      placeId: placeDetails?.id ?? null,
      lat: latitude,
      lng: longitude,
      hours: placeDetails?.regularOpeningHours?.weekdayDescriptions ?? [],
      reviews,
      coverUrl: coverMap.get(location.id)?.url ?? null,
      coverFocal: coverMap.get(location.id)?.focal ?? null,
      screenshotUrl: contentInfo?.screenshotUrl ?? null,
      menuItemCount: contentInfo?.menuItemCount ?? 0,
      menuConfidence: contentInfo?.menuConfidence ?? null,
      lastScrapedAt: contentInfo?.lastScrapedAt ?? null,
      editName: displayName,
      editAddress: address ?? "",
      editWebsite: location.website ?? website ?? "",
      detectedWebsite: website,
      weather: weatherView(weather),
    }
  })

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Your account</span>
        <h1 className="pv-h1">Locations.</h1>
        <p className="pv-sub">
          Every location runs its own competitor set, signals, and morning brief. Add one and the
          first data pull starts immediately.
        </p>
      </div>
      <TkRule />

      <div style={{ marginTop: 22 }}>
        <LocationsBoard
          locations={cards}
          organizationId={organizationId}
          error={error}
          createAction={createLocationFromPlaceAction}
          updateAction={updateLocationAction}
          updateAddressAction={updateLocationAddressFromPlaceAction}
          deleteAction={deleteLocationAction}
        />
      </div>
    </div>
  )
}
