// The Pass — Local Events Intelligence, REBUILT to Concept A's structure.
//
// STRUCTURE rebuild (not a reskin): a page header → a kit toolbar (filters +
// refresh) → weighted "at a glance" widgets → a HERO for the lead event (with an
// honest "open window" demand timeline) → a "what these events mean for you"
// insight card grid → a date-grouped grid of event PLAY CARDS (proximity meter,
// matched-competitor chips, links). Honest mapping only: distance is geocoded,
// draw is a heuristic magnitude, the demand window is labeled "estimated" — no
// fabricated covers/$/POS.
//
// Server component: all data fetching / vendor-health / filtering stays EXACTLY
// as before. The only interactive bits remain the existing shared client
// components (EventsFilters, JobRefreshButton) and the kit's own viz islands
// (RevealOnView / TkRangeBar / TkWindowViz), which are safe to render here.

import type { CSSProperties, ReactNode } from "react"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import EventsFilters from "@/components/events/events-filters"
import { fetchEventsPageData } from "@/lib/cache/events"
import { loadCoverageHealth, EMPTY_COVERAGE } from "@/lib/jobs/vendor-health"
import { VendorUnavailableBanner } from "@/components/ui/vendor-unavailable-banner"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
  TkCard,
  TkPlayCard,
  TkHero,
  TkChip,
  TkConfidence,
  TkWidgetGrid,
  TkWidget,
  TkRangeBar,
  TkWindowViz,
  TkStillLearning,
  TkEmptyState,
} from "@/components/ticket"
import type { NormalizedEventsSnapshotV1, NormalizedEvent } from "@/lib/events/types"
import {
  eventFamily,
  eventChipLabel,
  eventConfidence,
  proximityFill,
  distanceLabel,
  pickLeadEvent,
  severityToConfidence,
} from "./events-map"

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
// Helpers (formatting only — unchanged behavior)
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

// ── small server-safe glyphs (kit cards take an <svg/> icon) ──
const CAL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
)
const PIN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
)
// Inline pin glyph reused in chips/labels (sized small).
const PIN_ICON_INLINE = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
    style={{ display: "inline-block", flex: "none" }}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
)
const LINK_ICON = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
)
const TIX_ICON = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
  </svg>
)

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
  const requestedLocationId = params.location_id ?? null
  const selectedLocationId = (requestedLocationId && locationList.some((l: { id: string }) => l.id === requestedLocationId))
    ? requestedLocationId
    : locationList[0]?.id ?? null

  const selectedLocation = locationList.find((l: { id: string }) => l.id === selectedLocationId) ?? null
  const locationName = selectedLocation?.name ?? "your location"

  const activeTab = params.tab === "week" ? "week" : "weekend"
  const venueFilter = params.venue?.toLowerCase() ?? ""
  const matchedOnly = params.matched === "true"

  const cached = selectedLocationId
    ? await fetchEventsPageData(selectedLocationId)
    : { snapshot: null, matchRows: [], insights: [] }

  // Read live (uncached) so a vendor outage surfaces honestly — the page data above is served
  // from a 7-day cache that an outage never busts (no successful refresh during a 402).
  const coverageHealth = selectedLocationId
    ? await loadCoverageHealth(supabase, selectedLocationId)
    : EMPTY_COVERAGE

  let snapshot: NormalizedEventsSnapshotV1 | null = null
  let snapshotDate: string | null = null

  if (cached.snapshot) {
    snapshot = cached.snapshot.raw_data as unknown as NormalizedEventsSnapshotV1
    snapshotDate = cached.snapshot.date_key
  }

  const matchedUids = new Set<string>()
  const matchedCompetitorNames = new Map<string, string[]>()

  for (const m of cached.matchRows) {
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

  // ── lead event for the hero (nearest / highest-draw / resolved) ──
  const lead = pickLeadEvent(events)
  const leadUid = lead?.uid ?? null
  const feedEvents = leadUid ? events.filter((e) => e.uid !== leadUid) : events
  const groupedEvents = groupEventsByDate(feedEvents)

  // Event-only insights (events.* types), most-recent per type — the "what these events MEAN for
  // your restaurant" layer. Computed by the events pipeline.
  const eventInsights = (() => {
    const byType = new Map<string, (typeof cached.insights)[number]>()
    for (const ins of cached.insights ?? []) {
      if (!byType.has(ins.insight_type)) byType.set(ins.insight_type, ins) // first = most recent (ordered desc)
    }
    return [...byType.values()].slice(0, 6)
  })()

  const tabLabel = activeTab === "weekend" ? "this weekend" : "this week"

  // ── HERO viz: an honest "demand window" derived from the lead event's start
  // time. We don't claim covers/$ — we frame a watch-window (event kickoff →
  // your likely surge → wind-down) and label it "estimated". Segments are
  // positioned across a fixed 4pm→midnight evening axis when we have a start
  // time; otherwise the hero just shows context without the timeline.          */
  const leadWindow = (() => {
    if (!lead?.startDatetime) return null
    const start = new Date(lead.startDatetime)
    if (Number.isNaN(start.getTime())) return null
    const hour = start.getHours() + start.getMinutes() / 60
    // axis: 4pm (16) → midnight (24), 8h wide
    const AX_MIN = 16
    const AX_MAX = 24
    const span = AX_MAX - AX_MIN
    const pct = (h: number) => Math.max(0, Math.min(100, ((h - AX_MIN) / span) * 100))
    // surge band: ~45min pre-event through event start (people fueling up before)
    const preStart = pct(hour - 0.75)
    const eventStart = pct(hour)
    // your open-window: from now through ~1h after the event lets out (we don't
    // know the end, so model a 2.5h event then a 1h tail)
    const tail = pct(hour + 2.5 + 1)
    return {
      startLabel: formatTime(lead.startDatetime),
      surgeLeft: `${preStart}%`,
      surgeWidth: `${Math.max(4, eventStart - preStart)}%`,
      youLeft: `${eventStart}%`,
      youWidth: `${Math.max(6, tail - eventStart)}%`,
    }
  })()

  const leadMatched = leadUid ? matchedUids.has(leadUid) : false
  const leadFamily = lead ? eventFamily(lead, leadMatched) : "social"

  return (
    <div className="pv-page tk-kit">
      {/* ── PAGE HEADER (on-system chrome) ── */}
      <div className="pv-page-head">
        <span className="pv-kicker">In your area</span>
        <h1 className="pv-h1">Events</h1>
        <p className="pv-sub">
          What&rsquo;s drawing a crowd near {locationName} {tabLabel}, ranked by how close it is and how
          big it draws — so you can prep for the surge and spot anything your competitors are tied to.
        </p>
      </div>
      <hr className="pv-rule" />

      <div className="space-y-5" style={{ marginTop: 22 }}>
        {/* ── TOOLBAR: filters + refresh (existing client components, kit-framed) ── */}
        <TkSoftPanel className="flex flex-wrap items-center gap-3">
          <EventsFilters
            locations={locationList.map((l) => ({ id: l.id, name: l.name }))}
            selectedLocationId={selectedLocationId}
            activeTab={activeTab}
            venueFilter={venueFilter}
            matchedOnly={matchedOnly}
          />
          {selectedLocationId && (
            <JobRefreshButton
              type="events"
              locationId={selectedLocationId}
              label="Fetch Events"
              pendingLabel="Fetching local events"
            />
          )}
          {snapshotDate && (
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--ink-3)]">
              <span className="live-dot" />
              Last fetched {snapshotDate}
            </span>
          )}
        </TkSoftPanel>

        {/* ── BANNERS (unchanged logic) ── */}
        {coverageHealth.events.unavailable && (
          <VendorUnavailableBanner source="Local event data" asOf={snapshotDate} />
        )}
        {params.error && (
          <TkSoftPanel
            role="alert"
            style={{ borderColor: "var(--alert)", background: "var(--alert-wash)", color: "var(--alert-deep)" }}
          >
            <p className="text-sm font-medium">{decodeURIComponent(params.error)}</p>
          </TkSoftPanel>
        )}
        {params.success && (
          <TkSoftPanel
            role="status"
            style={{ borderColor: "var(--teal)", background: "var(--teal-tint)", color: "var(--teal-deep)" }}
          >
            <p className="text-sm font-medium">{decodeURIComponent(params.success)}</p>
          </TkSoftPanel>
        )}

        {/* ── AT A GLANCE — weighted widgets (honest counts) ── */}
        {snapshot && (
          <RevealOnView>
            <TkSectionHead title="At a glance" sub={`Local events ${tabLabel}`} />
            <TkWidgetGrid>
              <TkWidget
                tone="rust"
                size="wide"
                label="Events nearby"
                value={String(totalEvents)}
                sub={`tracked around ${locationName} ${tabLabel}`}
                data-tip="Distinct local events found in this sweep"
                data-tipv={`${totalEvents} events`}
                spark={
                  <svg viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true">
                    <path
                      d="M0 50 L26 44 L50 46 L74 22 L96 14 L120 26"
                      fill="none"
                      stroke="rgba(255,255,255,.7)"
                      strokeWidth="3"
                    />
                  </svg>
                }
              />
              <TkWidget
                tone="teal"
                label="Competitor tie-ins"
                value={totalMatched > 0 ? String(totalMatched) : "—"}
                sub={totalMatched > 0 ? "events a rival is attached to" : "none matched yet"}
                data-tip="Events matched to a venue/handle in your competitor set"
                data-tipv={`${totalMatched} matched`}
              />
              <TkWidget
                tone="gold"
                label="Unique venues"
                value={String(uniqueVenues)}
                sub="hosting events near you"
                data-tip="Distinct venues hosting events in this sweep"
                data-tipv={`${uniqueVenues} venues`}
              />
              <TkWidget
                tone="slate"
                label="Active days"
                value={String(activeDays)}
                sub={`days with events ${tabLabel}`}
                data-tip="Days in the window that have at least one event"
                data-tipv={`${activeDays} days`}
              />
            </TkWidgetGrid>
          </RevealOnView>
        )}

        {/* ── HOT VENUES ── */}
        {topVenues.length > 0 && (
          <RevealOnView>
            <TkCard className="flex flex-wrap items-center gap-2">
              <span className="mr-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                Hot venues
              </span>
              {topVenues.map(([name, count]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--paper-2)] px-3 py-1 text-xs font-medium text-[var(--ink)] ring-1 ring-[var(--line)]"
                >
                  <span className="text-[var(--rust-deep)]">{PIN_ICON_INLINE}</span>
                  {name}
                  <span className="rounded-full bg-[var(--rust-tint)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--rust-deep)]">
                    {count}
                  </span>
                </span>
              ))}
            </TkCard>
          </RevealOnView>
        )}

        {/* ── HERO — the lead event (nearest / highest-draw) ── */}
        {lead && (
          <RevealOnView>
            <TkHero
              titleId="events-lead"
              title={lead.title ?? "A draw worth prepping for"}
              chips={
                <>
                  <TkChip family={leadFamily}>{eventChipLabel(lead, leadMatched)}</TkChip>
                  <TkConfidence level={eventConfidence(lead)} />
                </>
              }
              lede={
                <>
                  {lead.venue?.name ? <b>{lead.venue.name}</b> : "Nearby"}
                  {" · "}
                  {distanceLabel(lead.distanceMiles)}
                  {lead.startDatetime ? <> · {formatDate(lead.startDatetime)}</> : null}
                  {leadMatched ? " · a competitor is tied to this one" : ""}
                  {". "}
                  This is the closest, biggest draw in your window — expect knock-on foot traffic around it.
                </>
              }
              photo={
                <div
                  className="tk-photo"
                  data-label={lead.venue?.name ?? locationName}
                  style={
                    lead.imageUrl
                      ? ({ backgroundImage: `url("${lead.imageUrl}")` } as CSSProperties)
                      : undefined
                  }
                >
                  <div className="tk-veil" />
                </div>
              }
              venueChip={
                lead.startDatetime ? (
                  <>
                    {PIN_ICON_INLINE}
                    {formatTime(lead.startDatetime)}
                  </>
                ) : undefined
              }
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  {lead.url && (
                    <a href={lead.url} target="_blank" rel="noopener noreferrer" className="tk-btn tk-btn-act">
                      {LINK_ICON} Event details
                    </a>
                  )}
                  {lead.venue?.mapsUrl && (
                    <a href={lead.venue.mapsUrl} target="_blank" rel="noopener noreferrer" className="tk-btn tk-btn-keep">
                      {PIN_ICON_INLINE} Map it
                    </a>
                  )}
                </div>
              }
            >
              {/* honest proximity meter */}
              <TkRangeBar
                value={proximityFill(lead.distanceMiles)}
                scale={["Across town", "Few blocks", "Next door"]}
                caption="How close it is to you"
                captionRight={distanceLabel(lead.distanceMiles)}
                tip="Straight-line distance from your location to the geocoded venue"
                tipValue={distanceLabel(lead.distanceMiles)}
              />

              {/* honest demand-window timeline (estimated) */}
              {leadWindow && (
                <TkWindowViz
                  headLabel="Your watch window — estimated"
                  headValue={`Kickoff ${leadWindow.startLabel}`}
                  axisLabels={["4 PM", "7 PM", "9 PM", "Midnight"]}
                  segments={[
                    {
                      kind: "surge",
                      left: leadWindow.surgeLeft,
                      width: leadWindow.surgeWidth,
                      tip: "Pre-event window — people fuel up before heading over",
                      tipValue: "Before kickoff",
                    },
                    {
                      kind: "you-open",
                      left: leadWindow.youLeft,
                      width: leadWindow.youWidth,
                      tip: "Estimated knock-on traffic during and just after the event",
                      tipValue: "During & after",
                    },
                  ]}
                  legend={
                    <>
                      <span><i style={{ background: "var(--rust)" }} /> Pre-event rush</span>
                      <span><i style={{ background: "var(--teal)" }} /> Your knock-on window</span>
                      <span className="tk-muted">Estimated from kickoff time — not measured covers.</span>
                    </>
                  }
                />
              )}
            </TkHero>
          </RevealOnView>
        )}

        {/* ── WHAT THESE EVENTS MEAN FOR YOU (event-only insights) ── */}
        {eventInsights.length > 0 && (
          <div>
            <TkSectionHead title="What these events mean for you" sub="Read from the events above" />
            <RevealOnView className="tk-grid" stagger>
              {eventInsights.map((ins, i) => {
                const recs = (Array.isArray(ins.recommendations) ? ins.recommendations : []) as Array<{
                  title?: string
                  rationale?: string
                }>
                const rec = recs[0]
                return (
                  <div key={ins.id} style={{ "--tk-i": i } as CSSProperties}>
                    <TkCard>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <TkChip family="competitive">Events insight</TkChip>
                        <TkConfidence level={severityToConfidence(ins.severity)} showLabel={false} />
                      </div>
                      <h4 className="font-display text-[15px] font-bold leading-snug tracking-[-0.01em] text-[var(--ink)]">
                        {ins.title}
                      </h4>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink-2)]">{ins.summary}</p>
                      {rec?.title && (
                        <div className="mt-3 rounded-[var(--r-md)] bg-[var(--paper-2)] px-3 py-2.5">
                          <p className="text-[12px] font-semibold text-[var(--ink)]">{rec.title}</p>
                          {rec.rationale && (
                            <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-2)]">{rec.rationale}</p>
                          )}
                        </div>
                      )}
                    </TkCard>
                  </div>
                )
              })}
            </RevealOnView>
          </div>
        )}

        {/* ── EMPTY / FIRST-RUN STATES ── */}
        {!snapshot && selectedLocationId && (
          <RevealOnView>
            <TkStillLearning
              days={1}
              target={7}
              title="Scanning your area for events"
              description="Tap Fetch Events to pull what's happening near your location. Once a sweep lands, the closest, highest-draw event leads here with a watch-window read."
            />
          </RevealOnView>
        )}

        {snapshot && !lead && feedEvents.length === 0 && (
          <TkEmptyState
            icon={CAL_ICON}
            title="No events match your filters"
            description={`Nothing for ${tabLabel} with these filters. Try the other window, clear the venue search, or turn off "Matched only".`}
          />
        )}

        {/* ── EVENT FEED — date-grouped grid of play cards ── */}
        {feedEvents.length > 0 && (
          <div className="space-y-8">
            {Array.from(groupedEvents.entries()).map(([dateLabel, dayEvents]) => (
              <RevealOnView key={dateLabel}>
                {/* date separator */}
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold text-[var(--ink)]">{dateLabel}</span>
                    {dayEvents[0]?.startDatetime && getRelativeDay(dayEvents[0].startDatetime) && (
                      <span className="rounded-full bg-[var(--rust-tint)] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[var(--rust-deep)]">
                        {getRelativeDay(dayEvents[0].startDatetime)}
                      </span>
                    )}
                  </div>
                  <div className="h-px flex-1 bg-gradient-to-r from-[var(--line-2)] to-transparent" />
                  <span className="font-mono text-[11px] text-[var(--ink-3)]">
                    {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* event cards */}
                <RevealOnView className="tk-grid" stagger>
                  {dayEvents.map((ev, i) => {
                    const isMatched = matchedUids.has(ev.uid)
                    const matchedNames = matchedCompetitorNames.get(ev.uid) ?? []
                    const domain = extractDomain(ev.url)
                    const time = formatTime(ev.startDatetime)
                    const family = eventFamily(ev, isMatched)
                    const links: ReactNode[] = []
                    if (ev.url) {
                      links.push(
                        <a
                          key="ev"
                          href={ev.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-[var(--rust-tint)] px-2 py-1 text-[10px] font-medium text-[var(--rust-deep)] transition hover:opacity-80"
                        >
                          {LINK_ICON} {domain ?? "Event"}
                        </a>
                      )
                    }
                    ev.ticketsAndInfo?.slice(0, 1).forEach((t, ti) => {
                      links.push(
                        <a
                          key={`t${ti}`}
                          href={t.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-[var(--gold-tint)] px-2 py-1 text-[10px] font-medium text-[var(--gold-deep)] transition hover:opacity-80"
                        >
                          {TIX_ICON} {t.title ?? t.domain ?? "Tickets"}
                        </a>
                      )
                    })
                    if (ev.venue?.mapsUrl) {
                      links.push(
                        <a
                          key="map"
                          href={ev.venue.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-[var(--rust-deep)] transition hover:opacity-80"
                        >
                          {PIN_ICON_INLINE} Map
                        </a>
                      )
                    }

                    return (
                      <div key={ev.uid} style={{ "--tk-i": i } as CSSProperties}>
                        <TkPlayCard
                          family={family}
                          icon={CAL_ICON}
                          title={ev.title ?? "Untitled event"}
                          confidence={<TkConfidence level={eventConfidence(ev)} showLabel={false} />}
                          chips={
                            <>
                              <TkChip family={family}>{eventChipLabel(ev, isMatched)}</TkChip>
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--paper-2)] px-2 py-0.5 font-mono text-[10px] font-medium text-[var(--ink-2)] ring-1 ring-[var(--line)]">
                                {PIN_ICON_INLINE}
                                {distanceLabel(ev.distanceMiles)}
                              </span>
                            </>
                          }
                          summary={
                            <>
                              {ev.venue?.name ? <b>{ev.venue.name}</b> : null}
                              {ev.venue?.name && (time || ev.startDatetime) ? " · " : null}
                              {time || (ev.startDatetime ? formatDate(ev.startDatetime) : ev.displayedDates ?? "Date TBD")}
                              {ev.description ? <> — {ev.description}</> : null}
                            </>
                          }
                        >
                          {/* proximity / draw meter */}
                          <TkRangeBar
                            value={proximityFill(ev.distanceMiles)}
                            scale={["Across town", "Few blocks", "Next door"]}
                            caption="Proximity"
                            captionRight={distanceLabel(ev.distanceMiles)}
                            tip="Straight-line distance to the geocoded venue"
                            tipValue={distanceLabel(ev.distanceMiles)}
                          />

                          {/* matched competitors */}
                          {matchedNames.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {matchedNames.map((name) => (
                                <span
                                  key={name}
                                  className="inline-flex items-center gap-1 rounded-md bg-[var(--teal-tint)] px-2 py-0.5 text-[10px] font-medium text-[var(--teal-deep)] ring-1 ring-[color:var(--teal)]"
                                >
                                  <span className="h-1 w-1 rounded-full bg-[var(--teal)]" />
                                  {name}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* links footer */}
                          {links.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2.5">
                              {links}
                            </div>
                          )}
                        </TkPlayCard>
                      </div>
                    )
                  })}
                </RevealOnView>
              </RevealOnView>
            ))}
          </div>
        )}

        {/* ── NO LOCATION ── */}
        {!selectedLocationId && (
          <TkEmptyState
            icon={PIN_ICON}
            title="No location added"
            description="Add a location first and we'll start watching for events that draw a crowd near you."
          />
        )}
      </div>
    </div>
  )
}
