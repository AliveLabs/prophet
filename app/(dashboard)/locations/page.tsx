import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import LocationAddForm from "@/components/places/location-add-form"
import { createLocationFromPlaceAction, deleteLocationAction, updateLocationAction } from "./actions"
import { fetchPlaceDetails } from "@/lib/places/google"
import MiniMap from "@/components/places/mini-map"
import { fetchCurrentConditions, type WeatherSnapshot } from "@/lib/weather/google"
import { getScreenshotUrl } from "@/lib/content/storage"
import type { MenuSnapshot, SiteContentSnapshot } from "@/lib/content/types"

const IconStar = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <path
      d="m12 3 2.6 5.3 5.9.9-4.3 4.2 1 6-5.2-2.7-5.2 2.7 1-6-4.3-4.2 5.9-.9L12 3Z"
      strokeWidth="1.5"
    />
  </svg>
)

const IconMapPin = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <path
      d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"
      strokeWidth="1.5"
    />
    <circle cx="12" cy="10" r="2.5" strokeWidth="1.5" />
  </svg>
)

const IconClock = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <circle cx="12" cy="12" r="9" strokeWidth="1.5" />
    <path d="M12 7v5l3 3" strokeWidth="1.5" />
  </svg>
)

const IconPhone = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <path
      d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5 12.8 12.8 0 0 0 2.8.7A2 2 0 0 1 22 16.9Z"
      strokeWidth="1.5"
    />
  </svg>
)

const IconGlobe = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <circle cx="12" cy="12" r="9" strokeWidth="1.5" />
    <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" strokeWidth="1.5" />
  </svg>
)

const IconChat = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <path d="M8 12h8M8 8h8" strokeWidth="1.5" />
    <path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4V6Z" strokeWidth="1.5" />
  </svg>
)

const formatTemperature = (weather: WeatherSnapshot | null) => {
  if (!weather || typeof weather.temperature !== "number") return "—"
  const unit = weather.tempUnit === "FAHRENHEIT" ? "°F" : weather.tempUnit === "CELSIUS" ? "°C" : ""
  return `${Math.round(weather.temperature)}${unit}`
}

const renderWeatherSummary = (weather: WeatherSnapshot | null) => {
  if (!weather) {
    return <span className="text-slate-400">Weather unavailable</span>
  }
  return (
    <div className="flex items-center gap-3">
      {weather.iconUrl ? (
        <img src={weather.iconUrl} alt={weather.condition ?? "Weather"} className="h-8 w-8" />
      ) : null}
      <div className="text-xs text-slate-600">
        <p className="text-sm font-semibold text-slate-800">{formatTemperature(weather)}</p>
        <p>{weather.condition ?? "Conditions unavailable"}</p>
        <p className="text-[11px] text-slate-500">
          {typeof weather.humidity === "number" ? `Humidity ${weather.humidity}%` : "Humidity —"}
          {typeof weather.windSpeed === "number" && weather.windUnit
            ? ` • Wind ${Math.round(weather.windSpeed)} ${weather.windUnit}`
            : ""}
        </p>
      </div>
    </div>
  )
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
    .select("id, name, city, region, country, address_line1, primary_place_id, geo_lat, geo_lng")
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

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const error = resolvedSearchParams?.error

  return (
    <section className="space-y-6">
      <Card className="bg-white text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Locations</h1>
            <p className="mt-2 text-sm text-slate-600">
              Add a new location and keep details up to date.
            </p>
          </div>
        </div>
        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {decodeURIComponent(error)}
          </p>
        ) : null}
        <div className="mt-6">
          <LocationAddForm
            organizationId={organizationId}
            action={createLocationFromPlaceAction}
            buttonLabel="Add location"
          />
        </div>
      </Card>

      <Card className="bg-white text-slate-900">
        <h2 className="text-lg font-semibold">Current locations</h2>
        <div className="mt-4 space-y-3 text-sm text-slate-600">
          {locations && locations.length > 0 ? (
            locations.map((location) => {
              const placeDetails = placeProfileMap.get(location.id)
              const weather = weatherMap.get(location.id) ?? null
              const latitude = placeDetails?.location?.latitude ?? location.geo_lat ?? null
              const longitude = placeDetails?.location?.longitude ?? location.geo_lng ?? null
              const mapsUri = placeDetails?.googleMapsUri ?? null
              const address =
                placeDetails?.formattedAddress ?? location.address_line1 ?? null
              const rating = placeDetails?.rating
              const reviewCount = placeDetails?.userRatingCount
              const phone =
                placeDetails?.internationalPhoneNumber ??
                placeDetails?.nationalPhoneNumber
              const website = placeDetails?.websiteUri
              const hours = placeDetails?.regularOpeningHours?.weekdayDescriptions ?? []
              const reviews = placeDetails?.reviews ?? []
              const contentInfo = contentInfoMap.get(location.id)

              return (
                <div
                  key={location.id}
                  className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-white px-5 py-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">
                        {placeDetails?.displayName?.text ?? location.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {placeDetails?.primaryType ?? "Location"} •{" "}
                        {location.city ?? "—"}, {location.region ?? "—"}{" "}
                        {location.country ?? ""}
                      </p>
                      {address ? (
                        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                          <IconMapPin /> {address}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {typeof rating === "number" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                            <IconStar /> {rating}
                          </span>
                        ) : null}
                        {typeof reviewCount === "number" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-sky-700">
                            <IconChat /> {reviewCount} reviews
                          </span>
                        ) : null}
                        {phone ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
                            <IconPhone /> {phone}
                          </span>
                        ) : null}
                        {website ? (
                          <a
                            href={website}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700"
                          >
                            <IconGlobe /> Website
                          </a>
                        ) : null}
                      </div>
                      {/* Content & Menu badges */}
                      {contentInfo && (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {contentInfo.menuConfidence ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
                                contentInfo.menuItemCount > 0
                                  ? "bg-green-50 text-green-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {contentInfo.menuItemCount > 0 ? (
                                <>
                                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                  </svg>
                                  Menu scraped · {contentInfo.menuItemCount} items
                                </>
                              ) : (
                                "No menu found"
                              )}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-600">
                              Needs content refresh
                            </span>
                          )}
                          {contentInfo.lastScrapedAt && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-slate-500">
                              Scraped {contentInfo.lastScrapedAt}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                        <p className="mb-2 text-sm font-semibold text-slate-700">
                          Local weather
                        </p>
                        {renderWeatherSummary(weather)}
                      </div>
                    </div>
                    <div className="flex w-full flex-col items-start gap-3 sm:w-auto">
                      {contentInfo?.screenshotUrl && (
                        <div className="overflow-hidden rounded-xl border border-slate-200 w-full sm:w-48">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={contentInfo.screenshotUrl}
                            alt={`${location.name} website`}
                            className="h-28 w-full object-cover object-top"
                          />
                        </div>
                      )}
                      <MiniMap
                        lat={latitude ?? null}
                        lng={longitude ?? null}
                        title={placeDetails?.displayName?.text ?? location.name ?? "Location map"}
                        className="w-full sm:w-48"
                        mapsUri={mapsUri}
                        placeId={placeDetails?.id ?? null}
                        address={address}
                      />
                      <form action={deleteLocationAction}>
                        <input type="hidden" name="location_id" value={location.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </form>
                    </div>
                  </div>
                  {hours.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <IconClock /> Operating hours
                      </p>
                      <div className="grid gap-1">
                        {hours.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {reviews.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                      <p className="mb-2 text-sm font-semibold text-slate-700">
                        Recent reviews
                      </p>
                      <div className="space-y-2">
                        {reviews.slice(0, 2).map((review, index) => (
                          <div key={`${location.id}-review-${index}`}>
                            <p className="text-slate-700">
                              {review?.text?.text ?? "Review text unavailable."}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {review?.authorAttribution?.displayName ?? "Google user"} •{" "}
                              {review?.relativePublishTimeDescription ?? "recent"} •{" "}
                              {review?.rating ? `Rating ${review.rating}` : "Rating n/a"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                    Edit details
                  </summary>
                  <form action={updateLocationAction} className="mt-3 grid gap-3">
                    <input type="hidden" name="location_id" value={location.id} />
                    <div className="grid gap-2">
                      <label className="text-xs font-semibold text-slate-500">Name</label>
                      <input
                        name="name"
                        defaultValue={placeDetails?.displayName?.text ?? location.name ?? ""}
                        className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-xs font-semibold text-slate-500">
                        Address line 1
                      </label>
                      <input
                        name="address_line1"
                        defaultValue={address ?? ""}
                        className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
                      />
                    </div>
                    <Button type="submit" size="sm">
                      Save changes
                    </Button>
                  </form>
                </details>
              </div>
              )
            })
          ) : (
            <p>No locations yet. Add your first location above.</p>
          )}
        </div>
      </Card>
    </section>
  )
}
