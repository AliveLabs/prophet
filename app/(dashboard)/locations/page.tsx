import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import LocationAddForm from "@/components/places/location-add-form"
import { createLocationFromPlaceAction, deleteLocationAction, updateLocationAction } from "./actions"
import { fetchPlaceDetails } from "@/lib/places/google"

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
    .select("id, name, city, region, country, address_line1, primary_place_id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const placeProfiles = await Promise.all(
    (locations ?? []).map(async (location) => {
      if (!location.primary_place_id) {
        return { locationId: location.id, details: null }
      }
      try {
        const details = await fetchPlaceDetails(location.primary_place_id)
        return { locationId: location.id, details }
      } catch {
        return { locationId: location.id, details: null }
      }
    })
  )
  const placeProfileMap = new Map(
    placeProfiles.map((profile) => [profile.locationId, profile.details])
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
              const rating = placeDetails?.rating
              const reviewCount = placeDetails?.userRatingCount
              const phone =
                placeDetails?.internationalPhoneNumber ??
                placeDetails?.nationalPhoneNumber
              const website = placeDetails?.websiteUri
              const address =
                placeDetails?.formattedAddress ?? location.address_line1 ?? null
              const hours = placeDetails?.regularOpeningHours?.weekdayDescriptions ?? []
              const reviews = placeDetails?.reviews ?? []

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
                    </div>
                    <form action={deleteLocationAction}>
                      <input type="hidden" name="location_id" value={location.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Remove
                      </Button>
                    </form>
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
