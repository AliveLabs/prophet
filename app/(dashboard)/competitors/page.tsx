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

type CompetitorsPageProps = {
  searchParams?: Promise<{
    error?: string
    debug?: string
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

  const locationIds = locations?.map((location) => location.id) ?? []
  const { data: competitors } =
    locationIds.length > 0
      ? await supabase
          .from("competitors")
          .select("id, name, category, relevance_score, is_active, metadata, location_id")
          .in("location_id", locationIds)
          .order("created_at", { ascending: false })
      : { data: [] }

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const error = resolvedSearchParams?.error
  const debugParam = resolvedSearchParams?.debug
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

  return (
    <section className="space-y-6">
      <Card className="bg-white text-slate-900">
        <h1 className="text-2xl font-semibold">Competitors</h1>
        <p className="mt-2 text-sm text-slate-600">
          Discover nearby competitors and approve who should be monitored.
        </p>
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
          <DiscoverForm locations={locations} action={discoverCompetitorsAction} />
        ) : null}
      </Card>

      <Card className="bg-white text-slate-900">
        <h2 className="text-lg font-semibold">Candidates</h2>
        <div className="mt-4 space-y-4">
          {competitors && competitors.length > 0 ? (
            competitors.map((competitor) => {
              const metadata = competitor.metadata as Record<string, unknown> | null
              const status = metadata?.status ?? (competitor.is_active ? "approved" : "pending")
              const distanceMeters = metadata?.distanceMeters as number | null | undefined
              const rating = metadata?.rating as number | null | undefined
              const reviewCount = metadata?.reviewCount as number | null | undefined
              const address = metadata?.address as string | null | undefined
              const phone = metadata?.phone as string | null | undefined
              const website = metadata?.website as string | null | undefined
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
