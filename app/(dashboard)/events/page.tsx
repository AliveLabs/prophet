import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import RefreshOverlay from "@/components/ui/refresh-overlay"
import { fetchEventsAction } from "./actions"
import type { NormalizedEventsSnapshotV1, NormalizedEvent } from "@/lib/events/types"

// ---------------------------------------------------------------------------
// Page props
// ---------------------------------------------------------------------------

type EventsPageProps = {
  searchParams: Promise<{
    location_id?: string
    tab?: string
    venue?: string
    matched?: string
    error?: string
    success?: string
  }>
}

// ---------------------------------------------------------------------------
// Icons (inline SVG for zero-dependency icons)
// ---------------------------------------------------------------------------

function IconCalendar() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function IconMapPin() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  )
}

function IconTicket() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
    </svg>
  )
}

function IconLink() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.9-3.554a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.838" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  )
}

function IconSparkles() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "TBD"
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function extractDomain(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const params = await searchParams
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  // Profile -> org
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/onboarding")

  // Locations
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, city, region, country")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })

  const locationList = locations ?? []
  const selectedLocationId = params.location_id ?? locationList[0]?.id ?? null
  const selectedLocation = locationList.find((l) => l.id === selectedLocationId)

  // Active tab
  const activeTab = params.tab === "week" ? "week" : "weekend"
  const venueFilter = params.venue?.toLowerCase() ?? ""
  const matchedOnly = params.matched === "true"

  // Fetch latest snapshot
  let snapshot: NormalizedEventsSnapshotV1 | null = null
  let snapshotDate: string | null = null

  if (selectedLocationId) {
    const { data: snapRow } = await supabase
      .from("location_snapshots")
      .select("raw_data, date_key")
      .eq("location_id", selectedLocationId)
      .eq("provider", "dataforseo_google_events")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (snapRow) {
      snapshot = snapRow.raw_data as unknown as NormalizedEventsSnapshotV1
      snapshotDate = snapRow.date_key
    }
  }

  // Fetch matches for the snapshot date
  let matchedUids = new Set<string>()
  let matchedCompetitorNames = new Map<string, string[]>()

  if (selectedLocationId && snapshotDate) {
    const { data: matchRows } = await supabase
      .from("event_matches")
      .select("event_uid, competitor_id, evidence")
      .eq("location_id", selectedLocationId)
      .eq("date_key", snapshotDate)

    if (matchRows) {
      for (const m of matchRows) {
        matchedUids.add(m.event_uid)
        const evidence = m.evidence as Record<string, unknown> | null
        const compName =
          (evidence?.competitor as Record<string, unknown>)?.name as string ??
          m.competitor_id ??
          "Unknown"
        const existing = matchedCompetitorNames.get(m.event_uid) ?? []
        existing.push(compName)
        matchedCompetitorNames.set(m.event_uid, existing)
      }
    }
  }

  // Filter events
  let events: NormalizedEvent[] = snapshot?.events ?? []

  // Tab filter
  events = events.filter((e) => {
    if (activeTab === "weekend") {
      return e.dateRange === "weekend" || e.dateRange === "all"
    }
    return e.dateRange === "week" || e.dateRange === "all"
  })

  // Venue filter
  if (venueFilter) {
    events = events.filter((e) =>
      (e.venue?.name ?? "").toLowerCase().includes(venueFilter)
    )
  }

  // Matched-only filter
  if (matchedOnly) {
    events = events.filter((e) => matchedUids.has(e.uid))
  }

  // Summary stats
  const totalEvents = snapshot?.summary.totalEvents ?? 0
  const totalMatched = matchedUids.size
  const topVenues = Object.entries(snapshot?.summary.byVenueName ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  return (
    <section className="space-y-6">
      {/* Page header */}
      <Card className="bg-gradient-to-br from-violet-50 to-fuchsia-50 text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <IconSparkles />
              Local Events Intelligence
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Discover upcoming events near your location and see which competitors are involved.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {snapshotDate && (
              <span className="text-xs text-slate-400">
                Last fetched: {snapshotDate}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Error / Success banners */}
      {params.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {decodeURIComponent(params.error)}
        </div>
      )}
      {params.success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {decodeURIComponent(params.success)}
        </div>
      )}

      {/* Controls row */}
      <Card className="bg-white text-slate-900">
        <div className="flex flex-wrap items-end gap-4">
          {/* Location selector */}
          <form method="GET" action="/events" className="flex items-end gap-3">
            <div>
              <label htmlFor="location_id" className="mb-1 block text-xs font-medium text-slate-500">
                Location
              </label>
              <select
                id="location_id"
                name="location_id"
                defaultValue={selectedLocationId ?? ""}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                {locationList.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="tab" className="mb-1 block text-xs font-medium text-slate-500">
                Period
              </label>
              <select
                id="tab"
                name="tab"
                defaultValue={activeTab}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="weekend">Weekend</option>
                <option value="week">This Week</option>
              </select>
            </div>

            <div>
              <label htmlFor="venue" className="mb-1 block text-xs font-medium text-slate-500">
                Venue
              </label>
              <input
                id="venue"
                name="venue"
                type="text"
                defaultValue={venueFilter}
                placeholder="Filter by venue..."
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                name="matched"
                value="true"
                defaultChecked={matchedOnly}
                className="rounded border-slate-300"
              />
              Matched only
            </label>

            <Button type="submit" variant="secondary" size="sm">
              Apply Filters
            </Button>
          </form>

          {/* Fetch Events button */}
          {selectedLocationId && (
            <form action={fetchEventsAction} className="ml-auto">
              <input type="hidden" name="location_id" value={selectedLocationId} />
              <RefreshOverlay
                label="Fetch Events"
                pendingLabel="Fetching local events"
                quickFacts={(() => {
                  const facts: string[] = []
                  if (totalEvents > 0) facts.push(`${totalEvents} events discovered so far.`)
                  if (totalMatched > 0) facts.push(`${totalMatched} events matched to your competitors.`)
                  const uniqueVenues = Object.keys(snapshot?.summary.byVenueName ?? {}).length
                  if (uniqueVenues > 0) facts.push(`Events span ${uniqueVenues} unique venues.`)
                  if (topVenues.length > 0) facts.push(`Top venue: ${topVenues[0][0]} (${topVenues[0][1]} events).`)
                  if (selectedLocation?.city) facts.push(`Scanning events near ${selectedLocation.city}.`)
                  return facts
                })()}
                geminiContext={`Local events for ${selectedLocation?.name ?? "your location"} in ${selectedLocation?.city ?? "the area"}. ${totalEvents} events found, ${totalMatched} matched to competitors.`}
                steps={[
                  "Searching local events...",
                  "Parsing event details...",
                  "Matching to competitors...",
                  "Organizing by venue...",
                  "Generating event insights...",
                ]}
              />
            </form>
          )}
        </div>
      </Card>

      {/* Summary KPIs */}
      {snapshot && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="bg-white text-center">
            <p className="text-2xl font-bold text-violet-600">{totalEvents}</p>
            <p className="text-xs text-slate-500">Total Events</p>
          </Card>
          <Card className="bg-white text-center">
            <p className="text-2xl font-bold text-emerald-600">{totalMatched}</p>
            <p className="text-xs text-slate-500">Competitor Matches</p>
          </Card>
          <Card className="bg-white text-center">
            <p className="text-2xl font-bold text-amber-600">
              {Object.keys(snapshot.summary.byVenueName).length}
            </p>
            <p className="text-xs text-slate-500">Unique Venues</p>
          </Card>
          <Card className="bg-white text-center">
            <p className="text-2xl font-bold text-sky-600">
              {Object.keys(snapshot.summary.byDate).length}
            </p>
            <p className="text-xs text-slate-500">Active Days</p>
          </Card>
        </div>
      )}

      {/* Top venues */}
      {topVenues.length > 0 && (
        <Card className="bg-white text-slate-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <IconMapPin /> Top Venues
          </h2>
          <div className="flex flex-wrap gap-2">
            {topVenues.map(([name, count]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
              >
                {name}
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                  {count}
                </span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Events list */}
      {!snapshot && selectedLocationId && (
        <Card className="bg-white text-slate-900">
          <div className="py-8 text-center text-slate-400">
            <IconCalendar />
            <p className="mt-2 text-sm">
              No events data yet. Click <strong>Fetch Events</strong> to discover what&rsquo;s happening nearby.
            </p>
          </div>
        </Card>
      )}

      {snapshot && events.length === 0 && (
        <Card className="bg-white text-slate-900">
          <p className="py-8 text-center text-sm text-slate-400">
            No events match your current filters.
          </p>
        </Card>
      )}

      {events.length > 0 && (
        <div className="space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <IconCalendar />
            {events.length} Event{events.length !== 1 ? "s" : ""}
            {activeTab === "weekend" ? " This Weekend" : " This Week"}
          </h2>

          {events.map((ev) => {
            const isMatched = matchedUids.has(ev.uid)
            const matchedNames = matchedCompetitorNames.get(ev.uid) ?? []
            const domain = extractDomain(ev.url)

            return (
              <Card
                key={ev.uid}
                className={`bg-white text-slate-900 ${
                  isMatched
                    ? "border-l-4 border-l-emerald-500"
                    : ""
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  {/* Left: Event info */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">
                        {ev.title ?? "Untitled Event"}
                      </h3>
                      {isMatched && (
                        <Badge variant="success">
                          <IconUsers />
                          <span className="ml-1">Competitor Match</span>
                        </Badge>
                      )}
                    </div>

                    {/* Date/time */}
                    <div className="flex items-center gap-1.5 text-sm text-slate-500">
                      <IconCalendar />
                      <span>
                        {ev.startDatetime
                          ? formatDate(ev.startDatetime)
                          : ev.displayedDates ?? "Date TBD"}
                      </span>
                      {ev.endDatetime && (
                        <span className="text-slate-300">
                          {" "}
                          &rarr; {formatDate(ev.endDatetime)}
                        </span>
                      )}
                    </div>

                    {/* Venue */}
                    {ev.venue?.name && (
                      <div className="flex items-center gap-1.5 text-sm text-slate-500">
                        <IconMapPin />
                        <span className="font-medium text-slate-700">
                          {ev.venue.name}
                        </span>
                        {ev.venue.address && (
                          <span className="text-slate-400">
                            &mdash; {ev.venue.address}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Description */}
                    {ev.description && (
                      <p className="text-sm text-slate-500 line-clamp-2">
                        {ev.description}
                      </p>
                    )}

                    {/* Matched competitors */}
                    {matchedNames.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-medium text-emerald-700">Linked to:</span>
                        {matchedNames.map((name) => (
                          <span
                            key={name}
                            className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right: Image + links */}
                  <div className="flex flex-col items-end gap-2">
                    {ev.imageUrl && (
                      <img
                        src={ev.imageUrl}
                        alt={ev.title ?? "Event"}
                        className="h-20 w-32 rounded-lg object-cover"
                      />
                    )}

                    {/* Ticket / info links */}
                    <div className="flex flex-wrap gap-2">
                      {ev.url && (
                        <a
                          href={ev.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-100"
                        >
                          <IconLink />
                          {domain ?? "Event Page"}
                        </a>
                      )}
                      {ev.ticketsAndInfo?.map((t, i) => (
                        <a
                          key={i}
                          href={t.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
                        >
                          <IconTicket />
                          {t.title ?? t.domain ?? "Tickets"}
                        </a>
                      ))}
                    </div>

                    {/* Google Maps link */}
                    {ev.venue?.mapsUrl && (
                      <a
                        href={ev.venue.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline"
                      >
                        <IconMapPin />
                        Open in Maps
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* No location selected */}
      {!selectedLocationId && (
        <Card className="bg-white text-slate-900">
          <p className="py-8 text-center text-sm text-slate-400">
            Add a location first to discover nearby events.
          </p>
        </Card>
      )}
    </section>
  )
}
