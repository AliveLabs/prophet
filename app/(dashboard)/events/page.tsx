import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import EventsFilters from "@/components/events/events-filters"
import type { NormalizedEventsSnapshotV1, NormalizedEvent } from "@/lib/events/types"

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
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "TBD"
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return ""
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

function getRelativeDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const eventDate = new Date(iso)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const eventDay = new Date(eventDate)
    eventDay.setHours(0, 0, 0, 0)

    if (eventDay.getTime() === today.getTime()) return "Today"
    if (eventDay.getTime() === tomorrow.getTime()) return "Tomorrow"
    return null
  } catch {
    return null
  }
}

function groupEventsByDate(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
  const groups = new Map<string, NormalizedEvent[]>()
  for (const ev of events) {
    const key = ev.startDatetime
      ? new Date(ev.startDatetime).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
      : "Date TBD"
    const arr = groups.get(key) ?? []
    arr.push(ev)
    groups.set(key, arr)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const params = await searchParams
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/onboarding")

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, city, region, country")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })

  const locationList = locations ?? []
  const selectedLocationId = params.location_id ?? locationList[0]?.id ?? null
  const selectedLocation = locationList.find((l) => l.id === selectedLocationId)

  const activeTab = params.tab === "week" ? "week" : "weekend"
  const venueFilter = params.venue?.toLowerCase() ?? ""
  const matchedOnly = params.matched === "true"

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

  const matchedUids = new Set<string>()
  const matchedCompetitorNames = new Map<string, string[]>()

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

  let events: NormalizedEvent[] = snapshot?.events ?? []

  events = events.filter((e) => {
    if (activeTab === "weekend") {
      return e.dateRange === "weekend" || e.dateRange === "all"
    }
    return e.dateRange === "week" || e.dateRange === "all"
  })

  if (venueFilter) {
    events = events.filter((e) =>
      (e.venue?.name ?? "").toLowerCase().includes(venueFilter)
    )
  }

  if (matchedOnly) {
    events = events.filter((e) => matchedUids.has(e.uid))
  }

  const totalEvents = snapshot?.summary.totalEvents ?? 0
  const totalMatched = matchedUids.size
  const uniqueVenues = Object.keys(snapshot?.summary.byVenueName ?? {}).length
  const activeDays = Object.keys(snapshot?.summary.byDate ?? {}).length
  const topVenues = Object.entries(snapshot?.summary.byVenueName ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  const groupedEvents = groupEventsByDate(events)

  return (
    <section className="space-y-6">
      {/* ----------------------------------------------------------------- */}
      {/* Hero Header                                                       */}
      {/* ----------------------------------------------------------------- */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 p-6 text-white shadow-xl shadow-violet-200/50">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/5" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Local Events</h1>
            </div>
            <p className="max-w-md text-sm text-white/70">
              Discover what&rsquo;s happening near{" "}
              <span className="font-medium text-white/90">
                {selectedLocation?.name ?? "your locations"}
              </span>{" "}
              and track competitor involvement.
            </p>
          </div>

          {selectedLocationId && (
            <JobRefreshButton
              type="events"
              locationId={selectedLocationId}
              label="Fetch Events"
              pendingLabel="Fetching local events"
              className="!bg-white/15 !text-white backdrop-blur-sm hover:!bg-white/25"
            />
          )}
        </div>

        {/* Filters row */}
        <div className="relative mt-5">
          <EventsFilters
            locations={locationList.map((l) => ({ id: l.id, name: l.name }))}
            selectedLocationId={selectedLocationId}
            activeTab={activeTab}
            venueFilter={venueFilter}
            matchedOnly={matchedOnly}
          />
        </div>

        {snapshotDate && (
          <p className="relative mt-3 text-[11px] text-white/40">
            Last fetched: {snapshotDate}
          </p>
        )}
      </div>

      {/* Banners */}
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

      {/* ----------------------------------------------------------------- */}
      {/* KPI Stats                                                         */}
      {/* ----------------------------------------------------------------- */}
      {snapshot && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-200 hover:shadow-md">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 transition group-hover:bg-violet-100">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12V12z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{totalEvents}</p>
                <p className="text-[11px] font-medium text-slate-500">Total Events</p>
              </div>
            </div>
          </div>

          <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-100">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{totalMatched}</p>
                <p className="text-[11px] font-medium text-slate-500">Competitor Matches</p>
              </div>
            </div>
          </div>

          <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-amber-200 hover:shadow-md">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition group-hover:bg-amber-100">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{uniqueVenues}</p>
                <p className="text-[11px] font-medium text-slate-500">Unique Venues</p>
              </div>
            </div>
          </div>

          <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-200 hover:shadow-md">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 transition group-hover:bg-sky-100">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{activeDays}</p>
                <p className="text-[11px] font-medium text-slate-500">Active Days</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Top Venues Bar                                                    */}
      {/* ----------------------------------------------------------------- */}
      {topVenues.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Hot Venues
          </span>
          {topVenues.map(([name, count]) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200/60"
            >
              <svg className="h-3 w-3 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              {name}
              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                {count}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Empty States                                                      */}
      {/* ----------------------------------------------------------------- */}
      {!snapshot && selectedLocationId && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50">
            <svg className="h-8 w-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-900">No events data yet</h3>
          <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
            Click <strong>Fetch Events</strong> to discover what&rsquo;s happening near your location.
          </p>
        </div>
      )}

      {snapshot && events.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <p className="text-sm text-slate-500">No events match your current filters.</p>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Events Feed (grouped by date)                                     */}
      {/* ----------------------------------------------------------------- */}
      {events.length > 0 && (
        <div className="space-y-8">
          {Array.from(groupedEvents.entries()).map(([dateLabel, dayEvents]) => (
            <div key={dateLabel}>
              {/* Date separator */}
              <div className="mb-4 flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{dateLabel}</span>
                  {dayEvents[0]?.startDatetime && getRelativeDay(dayEvents[0].startDatetime) && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                      {getRelativeDay(dayEvents[0].startDatetime)}
                    </span>
                  )}
                </div>
                <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
                <span className="text-[11px] font-medium text-slate-400">
                  {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Event cards */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {dayEvents.map((ev) => {
                  const isMatched = matchedUids.has(ev.uid)
                  const matchedNames = matchedCompetitorNames.get(ev.uid) ?? []
                  const domain = extractDomain(ev.url)
                  const time = formatTime(ev.startDatetime)

                  return (
                    <div
                      key={ev.uid}
                      className={`group relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                        isMatched
                          ? "border-emerald-200 ring-1 ring-emerald-100"
                          : "border-slate-200"
                      }`}
                    >
                      {/* Image */}
                      {ev.imageUrl ? (
                        <div className="relative h-40 overflow-hidden bg-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={ev.imageUrl}
                            alt={ev.title ?? "Event"}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                          {time && (
                            <div className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-lg bg-black/50 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {time}
                            </div>
                          )}
                          {isMatched && (
                            <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                              </svg>
                              Match
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                          <svg className="h-10 w-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                          </svg>
                          {time && (
                            <div className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {time}
                            </div>
                          )}
                          {isMatched && (
                            <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg">
                              Match
                            </div>
                          )}
                        </div>
                      )}

                      {/* Content */}
                      <div className="space-y-3 p-4">
                        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
                          {ev.title ?? "Untitled Event"}
                        </h3>

                        {/* Date */}
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                          </svg>
                          <span>
                            {ev.startDatetime
                              ? formatDate(ev.startDatetime)
                              : ev.displayedDates ?? "Date TBD"}
                          </span>
                        </div>

                        {/* Venue */}
                        {ev.venue?.name && (
                          <div className="flex items-start gap-1.5 text-xs">
                            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                            </svg>
                            <div>
                              <span className="font-medium text-slate-700">{ev.venue.name}</span>
                              {ev.venue.address && (
                                <span className="block text-slate-400">{ev.venue.address}</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Description */}
                        {ev.description && (
                          <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">
                            {ev.description}
                          </p>
                        )}

                        {/* Matched competitors */}
                        {matchedNames.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {matchedNames.map((name) => (
                              <span
                                key={name}
                                className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200/50"
                              >
                                <span className="h-1 w-1 rounded-full bg-emerald-400" />
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Footer links */}
                      <div className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2.5">
                        {ev.url && (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700 transition hover:bg-violet-100"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                            {domain ?? "Event"}
                          </a>
                        )}
                        {ev.ticketsAndInfo?.slice(0, 2).map((t, i) => (
                          <a
                            key={i}
                            href={t.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 transition hover:bg-amber-100"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
                            </svg>
                            {t.title ?? t.domain ?? "Tickets"}
                          </a>
                        ))}
                        {ev.venue?.mapsUrl && (
                          <a
                            href={ev.venue.mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-sky-600 transition hover:text-sky-700"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                            </svg>
                            Map
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No location selected */}
      {!selectedLocationId && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
            <svg className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-900">No location added</h3>
          <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
            Add a location first to discover nearby events.
          </p>
        </div>
      )}
    </section>
  )
}
