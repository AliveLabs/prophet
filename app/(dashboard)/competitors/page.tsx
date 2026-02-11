import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import {
  approveCompetitorAction,
  discoverCompetitorsAction,
  ignoreCompetitorAction,
} from "./actions"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import DiscoverForm from "@/components/competitors/discover-form"
import MiniMap from "@/components/places/mini-map"
import LocationFilter from "@/components/ui/location-filter"
import { fetchCurrentConditions, type WeatherSnapshot } from "@/lib/weather/google"

const IconMapPin = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <path
      d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"
      strokeWidth="1.5"
    />
    <circle cx="12" cy="10" r="2.5" strokeWidth="1.5" />
  </svg>
)

const IconStar = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <path
      d="m12 3 2.6 5.3 5.9.9-4.3 4.2 1 6-5.2-2.7-5.2 2.7 1-6-4.3-4.2 5.9-.9L12 3Z"
      strokeWidth="1.5"
    />
  </svg>
)

const IconChat = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <path d="M8 12h8M8 8h8" strokeWidth="1.5" />
    <path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4V6Z" strokeWidth="1.5" />
  </svg>
)

const IconRoute = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
    <path d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" strokeWidth="1.5" />
    <path d="M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" strokeWidth="1.5" />
    <path d="M8 17c0-5 3-8 8-8" strokeWidth="1.5" />
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

const formatPriceLevel = (value: string | null | undefined) => {
  if (!value) return null
  if (/^\d+$/.test(value)) {
    const count = Number(value)
    return count > 0 ? "$".repeat(Math.min(count, 4)) : null
  }
  const normalized = value.replace("PRICE_LEVEL_", "").toLowerCase()
  if (!normalized) return null
  if (normalized === "free") return "Free"
  const word = normalized.replace(/_/g, " ")
  return word.charAt(0).toUpperCase() + word.slice(1)
}

const formatType = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())

const formatTemperature = (weather: WeatherSnapshot | null) => {
  if (!weather || typeof weather.temperature !== "number") return "—"
  const unit = weather.tempUnit === "FAHRENHEIT" ? "°F" : weather.tempUnit === "CELSIUS" ? "°C" : ""
  return `${Math.round(weather.temperature)}${unit}`
}

const renderWeatherSummary = (weather: WeatherSnapshot | null) => {
  if (!weather) {
    return <span className="text-slate-400">—</span>
  }
  return (
    <div className="flex items-center gap-2">
      {weather.iconUrl ? (
        <img src={weather.iconUrl} alt={weather.condition ?? "Weather"} className="h-8 w-8" />
      ) : null}
      <div className="text-xs text-slate-600">
        <p className="text-sm font-semibold text-slate-800">
          {formatTemperature(weather)}
        </p>
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

const renderPlaceDetails = (placeDetails: Record<string, unknown>) => {
  const businessStatus = placeDetails.businessStatus as string | null | undefined
  const priceLevel = formatPriceLevel(placeDetails.priceLevel as string | null | undefined)
  const mapsUri = placeDetails.mapsUri as string | null | undefined
  const editorialSummary = placeDetails.editorialSummary as string | null | undefined
  const primaryType = placeDetails.primaryType as string | null | undefined
  const types =
    (placeDetails.types as string[] | null | undefined)?.filter(Boolean).slice(0, 4) ?? []
  const currentOpeningHours = placeDetails.currentOpeningHours as
    | { openNow?: boolean | null; weekdayDescriptions?: string[] | null }
    | null
    | undefined
  const regularOpeningHours = placeDetails.regularOpeningHours as
    | { weekdayDescriptions?: string[] | null }
    | null
    | undefined
  const reviews = (placeDetails.reviews as Array<{
    rating?: number
    relativePublishTimeDescription?: string
    text?: { text?: string }
    authorAttribution?: { displayName?: string }
  }> | null | undefined)?.slice(0, 2)

  return (
    <div className="mt-2 space-y-3 text-xs text-slate-600">
      <div className="flex flex-wrap gap-2">
        {businessStatus ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5">
            {formatType(businessStatus)}
          </span>
        ) : null}
        {priceLevel ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
            {priceLevel}
          </span>
        ) : null}
        {primaryType ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5">
            {formatType(primaryType)}
          </span>
        ) : null}
        {types.map((type) => (
          <span key={type} className="rounded-full bg-slate-100 px-2 py-0.5">
            {formatType(type)}
          </span>
        ))}
      </div>

      {editorialSummary ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
          {editorialSummary}
        </p>
      ) : null}

      {currentOpeningHours?.weekdayDescriptions?.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Opening Hours
          </p>
          <ul className="mt-1 space-y-1 text-slate-600">
            {currentOpeningHours.weekdayDescriptions.slice(0, 3).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : regularOpeningHours?.weekdayDescriptions?.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Opening Hours
          </p>
          <ul className="mt-1 space-y-1 text-slate-600">
            {regularOpeningHours.weekdayDescriptions.slice(0, 3).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviews?.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Recent Reviews
          </p>
          <div className="mt-1 space-y-2">
            {reviews.map((review, index) => (
              <div key={`${review.relativePublishTimeDescription ?? "review"}-${index}`}>
                <p className="text-slate-700">
                  {review.text?.text ? `"${review.text.text}"` : "Review available on Maps."}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {review.authorAttribution?.displayName ?? "Google user"} •{" "}
                  {review.relativePublishTimeDescription ?? "Recently"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mapsUri ? (
        <a
          href={mapsUri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600"
        >
          <IconGlobe /> Open in Google Maps
        </a>
      ) : null}
    </div>
  )
}

type CompetitorsPageProps = {
  searchParams?: Promise<{
    error?: string
    debug?: string
    location_id?: string
  }>
}

export default async function CompetitorsPage({ searchParams }: CompetitorsPageProps) {
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
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const selectedLocationId = resolvedSearchParams?.location_id ?? locations?.[0]?.id ?? null
  const error = resolvedSearchParams?.error
  const debugParam = resolvedSearchParams?.debug

  const { data: competitors } =
    selectedLocationId
      ? await supabase
          .from("competitors")
          .select(
            "id, name, category, relevance_score, is_active, metadata, location_id, address, phone, website"
          )
          .eq("location_id", selectedLocationId)
          .order("created_at", { ascending: false })
      : { data: [] }
  let debugData: Record<string, unknown> | null = null
  if (debugParam) {
    try {
      debugData = JSON.parse(decodeURIComponent(debugParam)) as Record<string, unknown>
    } catch {
      debugData = { error: "Unable to parse debug payload." }
    }
  }

  const searchEntryPointHtml =
    competitors
      ?.map((competitor) => (competitor.metadata as { searchEntryPointHtml?: string } | null))
      .find((metadata) => metadata?.searchEntryPointHtml)?.searchEntryPointHtml ?? null

  const resolvedCompetitors = competitors ?? []
  const getStatus = (competitor: {
    is_active: boolean | null
    metadata: unknown
  }) => {
    const metadata = competitor.metadata as Record<string, unknown> | null
    const status = metadata?.status
    if (status === "approved" || status === "ignored" || status === "pending") {
      return status
    }
    return competitor.is_active ? "approved" : "pending"
  }

  const approvedCompetitors = resolvedCompetitors.filter(
    (competitor) => getStatus(competitor) === "approved"
  )
  const candidateCompetitors = resolvedCompetitors.filter(
    (competitor) => getStatus(competitor) === "pending"
  )

  const approvedWeatherEntries = await Promise.all(
    approvedCompetitors.map(async (competitor) => {
      const metadata = competitor.metadata as Record<string, unknown> | null
      const lat = metadata?.latitude
      const lng = metadata?.longitude
      if (typeof lat !== "number" || typeof lng !== "number") {
        return [competitor.id, null] as const
      }
      const weather = await fetchCurrentConditions({ lat, lng })
      return [competitor.id, weather] as const
    })
  )
  const approvedWeatherMap = new Map<string, WeatherSnapshot | null>(approvedWeatherEntries)

  function buildCompetitorQuickFacts(approved: typeof approvedCompetitors): string[] {
    const facts: string[] = []
    if (approved.length > 0) {
      facts.push(`You are tracking ${approved.length} approved competitor${approved.length !== 1 ? "s" : ""}.`)
    }
    const ratings = approved.map((c) => {
      const meta = c.metadata as Record<string, unknown> | null
      return (meta?.rating as number | null) ?? null
    }).filter((r): r is number => typeof r === "number")
    if (ratings.length > 0) {
      const avg = (ratings.reduce((s, v) => s + v, 0) / ratings.length).toFixed(1)
      facts.push(`Avg competitor rating: ${avg} stars.`)
    }
    const distances = approved.map((c) => {
      const meta = c.metadata as Record<string, unknown> | null
      return (meta?.distanceMeters as number | null) ?? null
    }).filter((d): d is number => typeof d === "number")
    if (distances.length > 0) {
      const closest = Math.min(...distances)
      facts.push(`Closest competitor is ${(closest / 1000).toFixed(1)} km away.`)
    }
    const topRated = [...approved].sort((a, b) => {
      const ra = ((a.metadata as Record<string, unknown> | null)?.rating as number) ?? 0
      const rb = ((b.metadata as Record<string, unknown> | null)?.rating as number) ?? 0
      return rb - ra
    })[0]
    if (topRated) {
      const tr = ((topRated.metadata as Record<string, unknown> | null)?.rating as number | null) ?? null
      if (tr) facts.push(`Top-rated competitor: ${topRated.name} (${tr} stars).`)
    }
    return facts
  }

  return (
    <section className="space-y-6">
      <Card className="bg-white text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Competitors</h1>
            <p className="mt-2 text-sm text-slate-600">
              Discover nearby competitors and approve who should be monitored.
            </p>
          </div>
          {locations && locations.length > 1 && (
            <LocationFilter
              locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
              selectedLocationId={selectedLocationId ?? ""}
            />
          )}
        </div>
        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {decodeURIComponent(error)}
          </p>
        ) : null}
        {debugData ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <p className="text-sm font-semibold">Debug context</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs">
              {JSON.stringify(debugData, null, 2)}
            </pre>
          </div>
        ) : null}
        {searchEntryPointHtml ? (
          <div
            className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-3"
            dangerouslySetInnerHTML={{ __html: searchEntryPointHtml }}
          />
        ) : null}
        {locations ? (
          <DiscoverForm
            locations={locations}
            action={discoverCompetitorsAction}
            selectedLocationId={selectedLocationId ?? undefined}
            quickFacts={buildCompetitorQuickFacts(approvedCompetitors)}
          />
        ) : null}
      </Card>

      <Card className="bg-white text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Approved competitors</h2>
            <p className="mt-1 text-sm text-slate-500">
              Track the most relevant competitors and key metrics at a glance.
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {approvedCompetitors.length} approved
          </span>
        </div>
        {approvedCompetitors.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Competitor</th>
                  <th className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <IconStar /> Rating
                    </span>
                  </th>
                  <th className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <IconChat /> Reviews
                    </span>
                  </th>
                  <th className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <IconRoute /> Distance
                    </span>
                  </th>
                  <th className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <IconMapPin /> Address
                    </span>
                  </th>
                  <th className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <IconPhone /> Phone
                    </span>
                  </th>
                  <th className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <IconGlobe /> Website
                    </span>
                  </th>
                  <th className="px-4 py-3">Map</th>
                  <th className="px-4 py-3">Weather</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {approvedCompetitors.map((competitor) => {
                  const metadata = competitor.metadata as Record<string, unknown> | null
                  const placeDetails =
                    (metadata?.placeDetails as Record<string, unknown> | null) ?? null
                  const hasPlaceDetails = placeDetails && Object.keys(placeDetails).length > 0
                  const placeDetailsError =
                    (metadata?.placeDetailsError as string | null | undefined) ?? null
                  const mapsUri = placeDetails?.mapsUri as string | null | undefined
                  const placeId = placeDetails?.placeId as string | null | undefined
                  const latitude = metadata?.latitude as number | null | undefined
                  const longitude = metadata?.longitude as number | null | undefined
                  const rating = metadata?.rating as number | null | undefined
                  const reviewCount = metadata?.reviewCount as number | null | undefined
                  const distanceMeters = metadata?.distanceMeters as number | null | undefined
                  const address =
                    (metadata?.address as string | null | undefined) ?? competitor.address ?? null
                  const phone =
                    (metadata?.phone as string | null | undefined) ?? competitor.phone ?? null
                  const website =
                    (metadata?.website as string | null | undefined) ?? competitor.website ?? null
                  const businessStatus = placeDetails?.businessStatus as string | null | undefined
                  const priceLevel = formatPriceLevel(
                    placeDetails?.priceLevel as string | null | undefined
                  )
                  const types =
                    (placeDetails?.types as string[] | null | undefined)?.filter(Boolean) ?? []
                  const openNow = placeDetails?.currentOpeningHours
                    ? (placeDetails.currentOpeningHours as { openNow?: boolean | null })
                        ?.openNow ?? null
                    : null
                  return (
                    <tr key={competitor.id} className="text-slate-700 even:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div className="space-y-1">
                          <p>{competitor.name ?? "Unknown"}</p>
                          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                            {businessStatus ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5">
                                {formatType(businessStatus)}
                              </span>
                            ) : null}
                            {priceLevel ? (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                                {priceLevel}
                              </span>
                            ) : null}
                            {typeof openNow === "boolean" ? (
                              <span
                                className={`rounded-full px-2 py-0.5 ${
                                  openNow
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-rose-50 text-rose-700"
                                }`}
                              >
                                {openNow ? "Open now" : "Closed"}
                              </span>
                            ) : null}
                            {types.slice(0, 2).map((type) => (
                              <span key={type} className="rounded-full bg-slate-100 px-2 py-0.5">
                                {formatType(type)}
                              </span>
                            ))}
                          </div>
                          {hasPlaceDetails ? (
                            <details className="text-xs text-slate-600">
                              <summary className="cursor-pointer text-slate-500">
                                Google Places highlights
                              </summary>
                              {renderPlaceDetails(placeDetails)}
                            </details>
                          ) : (
                            <p className="text-xs text-slate-400">
                              {placeDetailsError
                                ? placeDetailsError
                                : "Google Places details unavailable."}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {typeof rating === "number" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                            <IconStar /> {rating}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {typeof reviewCount === "number" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                            <IconChat /> {reviewCount}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {typeof distanceMeters === "number" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            <IconRoute /> {(distanceMeters / 1000).toFixed(1)} km
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {address ? (
                          <span className="inline-flex items-start gap-1 text-sm text-slate-600">
                            <IconMapPin /> {address}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {phone ? (
                          <a
                            href={`tel:${phone}`}
                            className="inline-flex items-center gap-1 text-sm font-medium text-violet-600"
                          >
                            <IconPhone /> {phone}
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {website ? (
                          <a
                            href={website}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600"
                          >
                            <IconGlobe /> Visit
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <MiniMap
                          lat={latitude ?? null}
                          lng={longitude ?? null}
                          title={competitor.name ?? "Map"}
                          className="w-44"
                          mapsUri={mapsUri ?? null}
                          placeId={placeId ?? null}
                          address={address ?? null}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {renderWeatherSummary(approvedWeatherMap.get(competitor.id) ?? null)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <form action={ignoreCompetitorAction}>
                          <input type="hidden" name="competitor_id" value={competitor.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Remove
                          </Button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            Approve competitors from the candidates list to see them here.
          </p>
        )}
      </Card>

      <Card className="bg-white text-slate-900">
        <h2 className="text-lg font-semibold">Candidates</h2>
        <div className="mt-4 space-y-4">
          {candidateCompetitors.length > 0 ? (
            candidateCompetitors.map((competitor) => {
              const metadata = competitor.metadata as Record<string, unknown> | null
              const status = getStatus(competitor)
              const placeDetails =
                (metadata?.placeDetails as Record<string, unknown> | null) ?? null
              const hasPlaceDetails = placeDetails && Object.keys(placeDetails).length > 0
              const placeDetailsError =
                (metadata?.placeDetailsError as string | null | undefined) ?? null
              const mapsUri = placeDetails?.mapsUri as string | null | undefined
              const placeId = placeDetails?.placeId as string | null | undefined
              const latitude = metadata?.latitude as number | null | undefined
              const longitude = metadata?.longitude as number | null | undefined
              const distanceMeters = metadata?.distanceMeters as number | null | undefined
              const rating = metadata?.rating as number | null | undefined
              const reviewCount = metadata?.reviewCount as number | null | undefined
              const address =
                (metadata?.address as string | null | undefined) ?? competitor.address ?? null
              const phone =
                (metadata?.phone as string | null | undefined) ?? competitor.phone ?? null
              const website =
                (metadata?.website as string | null | undefined) ?? competitor.website ?? null
              const businessStatus = placeDetails?.businessStatus as string | null | undefined
              const priceLevel = formatPriceLevel(
                placeDetails?.priceLevel as string | null | undefined
              )
              const types =
                (placeDetails?.types as string[] | null | undefined)?.filter(Boolean) ?? []
              const openNow = placeDetails?.currentOpeningHours
                ? (placeDetails.currentOpeningHours as { openNow?: boolean | null }).openNow ?? null
                : null
              const sources = (metadata?.sources as Array<{
                type?: string
                title?: string
                url?: string
              }>) ?? []
              return (
                <div
                  key={competitor.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-white px-5 py-4 shadow-sm"
                >
                  <div>
                    <p className="text-lg font-semibold text-slate-900">
                      {competitor.name ?? "Unknown"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {competitor.category ?? "Other"} • Score{" "}
                      {competitor.relevance_score ?? "n/a"} •{" "}
                      {status === "approved" ? "approved" : "pending approval"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      {businessStatus ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          {formatType(businessStatus)}
                        </span>
                      ) : null}
                      {priceLevel ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                          {priceLevel}
                        </span>
                      ) : null}
                      {typeof openNow === "boolean" ? (
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            openNow
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {openNow ? "Open now" : "Closed"}
                        </span>
                      ) : null}
                      {types.slice(0, 3).map((type) => (
                        <span key={type} className="rounded-full bg-slate-100 px-2 py-0.5">
                          {formatType(type)}
                        </span>
                      ))}
                    </div>
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
                      {typeof distanceMeters === "number" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                          <IconRoute /> {(distanceMeters / 1000).toFixed(1)} km
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                          <IconRoute /> Distance unknown
                        </span>
                      )}
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
                    {address ? (
                      <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                        <IconMapPin /> {address}
                      </p>
                    ) : null}
                    {hasPlaceDetails ? (
                      <details className="mt-3 text-xs text-slate-600">
                        <summary className="cursor-pointer text-slate-500">
                          Google Places highlights
                        </summary>
                        {renderPlaceDetails(placeDetails)}
                      </details>
                    ) : (
                      <p className="mt-3 text-xs text-slate-400">
                        {placeDetailsError
                          ? placeDetailsError
                          : "Google Places details unavailable."}
                      </p>
                    )}
                    {sources.length > 0 ? (
                      <div className="mt-2 text-xs text-slate-500">
                        <span className="mr-2 font-medium">Sources</span>
                        {sources
                          .filter((source) => source?.url)
                          .reduce<Array<{ title?: string; url?: string; type?: string }>>(
                            (unique, source) => {
                              if (!source?.url || unique.some((item) => item.url === source.url)) {
                                return unique
                              }
                              return [...unique, source]
                            },
                            []
                          )
                          .slice(0, 3)
                          .map((source) =>
                            source?.url ? (
                              <a
                                key={`${source.url}-${source.title ?? "source"}`}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mr-2 underline"
                              >
                                {source.title ?? "Source"}
                              </a>
                            ) : null
                          )}
                        {sources.some((source) => source?.type === "maps") ? (
                          <span className="ml-1" translate="no">
                            Google Maps
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex w-full flex-col items-start gap-3 sm:w-auto">
                    <MiniMap
                      lat={latitude ?? null}
                      lng={longitude ?? null}
                      title={competitor.name ?? "Map"}
                      className="w-full sm:w-44"
                      mapsUri={mapsUri ?? null}
                      placeId={placeId ?? null}
                      address={address ?? null}
                    />
                    <div className="flex gap-2">
                      <form action={approveCompetitorAction}>
                        <input type="hidden" name="competitor_id" value={competitor.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          Approve
                        </Button>
                      </form>
                      <form action={ignoreCompetitorAction}>
                        <input type="hidden" name="competitor_id" value={competitor.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Ignore
                        </Button>
                      </form>
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="text-sm text-slate-600">
              No competitors discovered yet. Run discovery to pull nearby options.
            </p>
          )}
        </div>
      </Card>
    </section>
  )
}
