// ---------------------------------------------------------------------------
// Deterministic event insight rules (context-aware)
// ---------------------------------------------------------------------------

import type {
  NormalizedEventsSnapshotV1,
  NormalizedEvent,
  EventMatchRecord,
} from "./types"
import type { GeneratedInsight } from "@/lib/insights/types"
import {
  scoreEventImpact,
  attendancePrior,
  type DensityTier,
  type ImpactResult,
} from "./impact"

// ---------------------------------------------------------------------------
// Config thresholds
// ---------------------------------------------------------------------------

const WEEKEND_DENSITY_SPIKE_PCT = 0.3
const WEEKEND_DENSITY_SPIKE_ABS = 5
const DENSE_DAY_THRESHOLD = 8
const CADENCE_UP_THRESHOLD = 2

const HIGH_SIGNAL_KEYWORDS = [
  "festival", "concert", "convention", "food", "wine", "beer", "taste",
  "chef", "sports", "game", "marathon", "parade", "expo", "fair",
  "market", "gala", "fundraiser", "block party", "music", "comedy", "pop-up",
  // Major sporting events were invisible to the high-signal layer — a fetched World
  // Cup / playoff match wouldn't flag without these (the secondary half of the miss).
  "soccer", "world cup", "fifa", "fútbol", "futbol", "playoff", "championship",
  "super bowl", "grand prix", "nfl", "nba", "mlb", "nhl", "mls", "ncaa", "rodeo",
]

const KEYWORD_AUDIENCE: Record<string, string> = {
  festival: "large crowds looking for food and entertainment",
  concert: "music fans who often dine before or after shows",
  convention: "out-of-town visitors seeking local dining",
  food: "food enthusiasts actively exploring local restaurants",
  wine: "upscale diners interested in curated experiences",
  beer: "casual diners looking for relaxed atmospheres",
  sports: "fans gathering for pre-game and post-game meals",
  game: "fans gathering for pre-game and post-game meals",
  marathon: "health-conscious visitors and their supporters",
  parade: "families and community members spending the day out",
  expo: "professionals looking for convenient nearby dining",
  fair: "families and visitors exploring the neighborhood",
  market: "shoppers interested in local and artisan offerings",
  comedy: "evening entertainment seekers looking for dinner options",
  "pop-up": "trend-conscious diners exploring new experiences",
}

// ---------------------------------------------------------------------------
// Context type – location + competitor profiles for richer recommendations
// ---------------------------------------------------------------------------

export type InsightContext = {
  locationName: string
  locationRating: number | null
  locationReviewCount: number | null
  competitors: Array<{
    id: string
    name: string | null
    rating: number | null
    reviewCount: number | null
  }>
  // ── P2 impact-model inputs (all optional → the major-event rule degrades gracefully) ──
  /** e.g. "quick service / drive-thru + dine-in", "bar + dine-in", "dine-in". */
  serviceModel?: string | null
  seats?: number | null
  /** Local market density — calibrates the surface bars (rural surfaces small events). */
  densityTier?: DensityTier
  /** The restaurant's own popular-times curve per day-of-week (0..6 → hourly_scores 0..100). */
  baselineCurveByDow?: Array<number[] | null> | null
  /** Dayparts the restaurant serves (Google serves* flags) — gates by event time. */
  hours?: {
    servesBreakfast?: boolean
    servesLunch?: boolean
    servesDinner?: boolean
    servesBrunch?: boolean
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function generateEventInsights(input: {
  current: NormalizedEventsSnapshotV1
  previous: NormalizedEventsSnapshotV1 | null
  matches: EventMatchRecord[]
  previousMatches: EventMatchRecord[] | null
  locationId: string
  dateKey: string
  context: InsightContext
  /** Full geo-annotated event list (all roles). The impact rule reads this; legacy
   *  count/keyword rules keep using `current` (the local snapshot) to avoid regressions. */
  allEvents?: NormalizedEvent[]
}): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const ctx = input.context

  // 0. Major nearby / route events — the impact model. A single mega-event near a
  //    restaurant won't trip the count/keyword rules, so this scores each local/route
  //    event against the restaurant's own baseline and emits channel-split insights.
  insights.push(...detectImpactfulEvents(input.allEvents ?? input.current.events, ctx))

  // 1. Weekend density spike
  const weekendSpike = detectWeekendDensitySpike(input.current, input.previous, ctx)
  if (weekendSpike) insights.push(weekendSpike)

  // 2. Upcoming dense day
  insights.push(...detectDenseDays(input.current, input.matches, ctx))

  // 3. New high-signal events
  insights.push(...detectHighSignalEvents(input.current, input.previous, ctx))

  // 4. Competitor hosting event
  insights.push(...detectCompetitorHosting(input.matches, ctx))

  // 5. Competitor event cadence up
  insights.push(...detectCadenceUp(input.matches, input.previousMatches, ctx))

  return insights
}

// ---------------------------------------------------------------------------
// 0. events.major_lobby_surge / events.access_suppression — the impact model
// ---------------------------------------------------------------------------

const IMPACT_ROLES = new Set(["local_foot", "local_traffic", "route_corridor"])

/** Score every local/route event against the restaurant's own baseline; surface the
 *  single biggest demand-surge and the single biggest access-disruption (top-K=1 per
 *  channel — also respects the (loc,comp,date,type) upsert key). Channel-split so a
 *  stadium a block away can drive lobby UP *and* drive-thru DOWN at once. */
function detectImpactfulEvents(events: NormalizedEvent[], ctx: InsightContext): GeneratedInsight[] {
  type Scored = { event: NormalizedEvent; result: ImpactResult }
  let bestSurge: Scored | null = null
  let bestDisruption: Scored | null = null

  for (const e of events) {
    if (!e.role || !IMPACT_ROLES.has(e.role)) continue

    const overlap = daypartOverlap(eventLocalHour(e), ctx.hours)
    if (overlap <= 0) continue // hard daypart gate

    const magnitude = e.magnitude ?? "minor"
    const capLow = e.capacityLow ?? attendancePrior(magnitude)
    const capHigh = e.capacityHigh ?? capLow
    const dow = dowOf(e.startDatetime)
    const baselineCurve = dow != null ? ctx.baselineCurveByDow?.[dow] ?? null : null

    const result = scoreEventImpact({
      capacityLow: capLow,
      capacityHigh: capHigh,
      role: e.role as Parameters<typeof scoreEventImpact>[0]["role"],
      isRoute: e.isRouteEvent ?? false,
      ticketSourceCount: e.ticketsAndInfo?.length ?? 0,
      daypartOverlap: overlap,
      serviceModel: ctx.serviceModel ?? null,
      seats: ctx.seats ?? null,
      baselineCurve,
      eventHour: eventLocalHour(e),
      densityTier: ctx.densityTier ?? "suburban",
    })
    if (!result.surface) continue

    const up = result.channels.find((c) => c.direction === "up")
    const down = result.channels.find((c) => c.channel === "drive_thru" && c.direction === "down")
    if (up && (!bestSurge || result.score > bestSurge.result.score)) bestSurge = { event: e, result }
    if (down && (!bestDisruption || result.accessDisruption > bestDisruption.result.accessDisruption)) {
      bestDisruption = { event: e, result }
    }
  }

  const out: GeneratedInsight[] = []
  if (bestSurge) out.push(buildSurgeInsight(bestSurge.event, bestSurge.result, ctx))
  if (bestDisruption) out.push(buildSuppressionInsight(bestDisruption.event, bestDisruption.result, ctx))
  return out
}

function buildSurgeInsight(e: NormalizedEvent, r: ImpactResult, ctx: InsightContext): GeneratedInsight {
  const channel = r.channels.find((c) => c.direction === "up")
  const isLobby = channel?.channel === "lobby"
  // VALIDATED FIELDS ONLY — the canonical venue + authoritative start, never the scraped title.
  // (This is the World Cup mis-location/mis-dating fix: free-text title interpolation is removed.)
  const venue = validatedVenue(e)
  const when = validatedWhen(e)
  const eventLabel = validatedEventLabel(e)
  const crowd = describeCrowd(e, r)
  const dist = e.distanceMiles != null ? `${e.distanceMiles}mi from` : "near"
  const surfaceLabel = isLobby ? "walk-in/lobby" : "dining-room"
  // Confidence reflects BOTH capacity grounding AND the R3 baseline gate: if we couldn't
  // relativize to this restaurant's own curve (baseline missing), cap at the model's lower read
  // instead of asserting a confident absolute-only surge.
  const capConfidence: GeneratedInsight["confidence"] = e.capacityConfidence === "measured" ? "high" : "medium"
  const confidence = lowerConfidence(capConfidence, mapSurfaceConfidence(r.surfaceConfidence))
  const severity: GeneratedInsight["severity"] =
    (channel?.intensity ?? 0) >= 0.9 ? "critical" : "warning"

  return {
    insight_type: "events.major_lobby_surge",
    title: `Major event nearby: ${eventLabel}`,
    summary: `${eventLabel} at ${venue} (${when}) draws ${crowd} ${dist} ${ctx.locationName}. Expect a ${surfaceLabel} surge${e.isRouteEvent ? "" : " around the start and let-out"} — well above your typical volume for that window.`,
    confidence,
    severity,
    evidence: {
      stable_key: stableKeyFor(e, isLobby ? "lobby" : "dine_in"),
      channel: isLobby ? "lobby" : "dine_in",
      direction: "up",
      role: e.role,
      attendance_estimate: r.attendance,
      capacity_confidence: e.capacityConfidence ?? "prior",
      distance_miles: e.distanceMiles ?? null,
      pct_lift: r.pctLift != null ? Math.round(r.pctLift) : null,
      absolute_incremental: r.absoluteIncremental,
      impact_score: r.score,
      doors: r.doors,
      // P13 R3 + R1 provenance (internal; NOT customer copy).
      surface_confidence: r.surfaceConfidence,
      baseline_missing: r.baselineMissing,
      venue_confidence: e.venueConfidence ?? null,
      validated_venue: e.validatedVenueName ?? null,
      authoritative_local_start: e.authoritativeLocalStart ?? null,
      fixture_ref: e.fixtureRef ?? null,
      league_validated: e.leagueValidated ?? false,
      event: eventSummary(e),
      location_name: ctx.locationName,
    },
    recommendations: [
      {
        title: isLobby ? `Staff the counter for a lobby rush` : `Add covers/turn capacity`,
        rationale: `${venue} brings ${crowd} near ${ctx.locationName} around ${when}. Schedule extra hands and pre-stage high-volume items so the ${surfaceLabel} surge doesn't overwhelm service.`,
      },
      {
        title: `Capture the crowd before it arrives`,
        rationale: `Post your proximity and an event-day offer ahead of ${when}; attendees searching nearby convert fast when you're the closest option.`,
      },
    ],
  }
}

function buildSuppressionInsight(e: NormalizedEvent, r: ImpactResult, ctx: InsightContext): GeneratedInsight {
  // VALIDATED FIELDS ONLY (see buildSurgeInsight): canonical venue + authoritative start.
  const venue = validatedVenue(e)
  const when = validatedWhen(e)
  const eventLabel = validatedEventLabel(e)
  const cause = e.isRouteEvent ? "Road closures for" : "Traffic and parking gridlock around"

  return {
    insight_type: "events.access_suppression",
    title: `Drive-thru/lot access at risk: ${venue}`,
    summary: `${cause} ${eventLabel} at ${venue} (${when}) is likely to choke streets and parking near ${ctx.locationName} during the event window — your drive-thru and lot will back up even as walk-in demand climbs.`,
    confidence: e.isRouteEvent ? "medium" : "high",
    severity: "warning",
    evidence: {
      stable_key: stableKeyFor(e, "drive_thru"),
      channel: "drive_thru",
      direction: "down",
      role: e.role,
      access_disruption: Math.round(r.accessDisruption * 100) / 100,
      is_route_event: e.isRouteEvent ?? false,
      distance_miles: e.distanceMiles ?? null,
      event: eventSummary(e),
      location_name: ctx.locationName,
    },
    recommendations: [
      {
        title: `Shift the drive-thru plan during the event`,
        rationale: `As access degrades around ${when}, steer demand to walk-up and order-ahead, add a runner, and post signage so cars don't strand in a backed-up lane.`,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Validated-field templating (P13 R1) — copy is built STRICTLY from validated fields.
// The raw scraped `e.title` / `e.venue.name` are NEVER interpolated into customer copy.
// ---------------------------------------------------------------------------

/** Canonical venue for copy: the validated/catalog name, never the scraped venue string. */
function validatedVenue(e: NormalizedEvent): string {
  return e.validatedVenueName ?? e.catalogVenueName ?? "a nearby venue"
}

/** When for copy: the AUTHORITATIVE local start (fixture cross-check) when present, else the
 *  event's own start date. Never a scraped free-text date string from the title.
 *  Renders the LOCAL date component without any UTC roll — the authoritative date is already
 *  the local calendar date at the venue, so we must not let a parse-as-UTC reinterpret it. */
function validatedWhen(e: NormalizedEvent): string {
  const src = e.authoritativeLocalStart ?? e.startDatetime
  if (!src) return "soon"
  const m = src.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return fmtLocalDateParts(Number(m[1]), Number(m[2]), Number(m[3]))
  return fmtDate(src)
}

/** Format a local Y/M/D with no timezone reinterpretation (anchored to UTC noon so it can't roll). */
function fmtLocalDateParts(year: number, month: number, day: number): string {
  try {
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
    })
  } catch {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }
}

/** A safe event LABEL templated only from validated fields. For a cross-checked league fixture
 *  we name the COMPETITION (from fixtureRef) + venue — never the scraped match pairing/title.
 *  For a resolved non-league event we describe it generically by its canonical venue. */
function validatedEventLabel(e: NormalizedEvent): string {
  if (e.leagueValidated && e.fixtureRef) {
    const competition = competitionDisplayFromRef(e.fixtureRef)
    return competition ? `A ${competition} match` : "A scheduled match"
  }
  return "A major event"
}

const COMPETITION_DISPLAY: Record<string, string> = {
  "fifa-world-cup-2026": "FIFA World Cup",
}

/** Map a fixtureRef ("competition:venue:date") → a human competition name (validated provenance). */
function competitionDisplayFromRef(ref: string): string | null {
  const compId = ref.split(":")[0] ?? ""
  return COMPETITION_DISPLAY[compId] ?? null
}

/** ImpactResult.surfaceConfidence → the insight confidence enum (P13 R3). */
function mapSurfaceConfidence(c: ImpactResult["surfaceConfidence"]): GeneratedInsight["confidence"] {
  return c === "high" ? "high" : c === "medium" ? "medium" : "low"
}

const CONFIDENCE_RANK: Record<GeneratedInsight["confidence"], number> = { low: 0, medium: 1, high: 2 }

/** The MORE conservative of two confidences (never over-claims). */
function lowerConfidence(
  a: GeneratedInsight["confidence"],
  b: GeneratedInsight["confidence"],
): GeneratedInsight["confidence"] {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b
}

function describeCrowd(e: NormalizedEvent, r: ImpactResult): string {
  if (e.capacityConfidence === "measured" && (e.capacityHigh ?? 0) >= 1000) {
    const k = Math.round((e.capacityHigh as number) / 1000)
    return `up to ~${k}k attendees`
  }
  const cap = e.capacityHigh ?? r.attendance
  if (cap >= 20000) return "a stadium-scale crowd"
  if (cap >= 5000) return "a large crowd"
  return "a sizable crowd"
}

function stableKeyFor(e: NormalizedEvent, channel: string): string {
  const anchor = e.catalogVenueName ?? e.venue?.name ?? e.uid
  return `events.impact:${anchor.toLowerCase().replace(/\s+/g, "_")}:${channel}`
}

/** Map an event's local hour → does it overlap a daypart the restaurant serves? Returns
 *  0..1. Unknown hours or unset serves* flags = 1 (conservative; no restriction). */
function daypartOverlap(hour: number | null, hours: InsightContext["hours"]): number {
  if (hour == null || !hours) return 1
  let daypart: keyof NonNullable<InsightContext["hours"]> | null = null
  if (hour >= 6 && hour < 11) daypart = "servesBreakfast"
  else if (hour >= 11 && hour < 15) daypart = "servesLunch"
  else if (hour >= 17 && hour < 23) daypart = "servesDinner"
  if (!daypart) return 1 // odd hour — don't gate
  const serves = hours[daypart]
  if (serves === undefined) return 1 // unknown → conservative
  return serves ? 1 : 0
}

/** Local hour the event lets out / peaks, for the curve lookup + daypart gate. P13 R3: prefer
 *  the AUTHORITATIVE kickoff from the fixture cross-check (the validated field) over the
 *  scraped/guessed start, so the impact model never daypart-gates on a wrong time. */
function eventLocalHour(e: NormalizedEvent): number | null {
  // authoritativeLocalStart is "YYYY-MM-DD HH:MM" (fixtures) or ISO (resolved non-league).
  if (e.authoritativeLocalStart) {
    const m = e.authoritativeLocalStart.match(/[ T](\d{2}):/)
    if (m) return parseInt(m[1], 10)
  }
  const m = (e.startDatetime ?? "").match(/T(\d{2}):/)
  if (m) return parseInt(m[1], 10)
  return null
}

function dowOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t).getUTCDay()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    })
  } catch {
    return iso
  }
}

function fmtRating(r: number | null): string {
  return r !== null ? `${r.toFixed(1)}-star` : ""
}

/**
 * P13 (§5): titles in the density insights are RAW scraped text. They are illustrative flavor for a
 * COUNT (not a venue/date impact claim — that path goes through validate.ts), but raw titles still
 * leak emoji, promo/ticket noise, and wrong-location strings into customer copy. Sanitize before any
 * title reaches copy: strip pictographs, drop promo/ticket tails + hype punctuation, collapse
 * whitespace, length-cap. An emptied title is dropped (→ "multiple events" fallback).
 */
export function sanitizeEventTitle(title: string): string {
  return (title ?? "")
    .replace(/\p{Extended_Pictographic}/gu, "") // emoji / pictographs
    .replace(/\s*[-–—|:]\s*(tickets?|buy now|on sale|get tickets|rsvp|limited).*$/i, "") // promo/ticket tail
    .replace(/!{2,}/g, "") // hype punctuation
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim()
}

function topEventNames(events: NormalizedEvent[], n = 3): string {
  return events
    .map((e) => sanitizeEventTitle(e.title ?? ""))
    .filter(Boolean)
    .slice(0, n)
    .map((t) => `"${t}"`)
    .join(", ") || "multiple events"
}

function findCompetitor(ctx: InsightContext, id: string) {
  return ctx.competitors.find((c) => c.id === id)
}

function ratingEdge(ctx: InsightContext): string {
  if (!ctx.locationRating) return ""
  const compRatings = ctx.competitors
    .map((c) => c.rating)
    .filter((r): r is number => r !== null)
  if (!compRatings.length) return ""
  const avg = compRatings.reduce((a, b) => a + b, 0) / compRatings.length
  if (ctx.locationRating > avg + 0.2)
    return `Your ${fmtRating(ctx.locationRating)} rating is above the competitor average (${avg.toFixed(1)}), giving you a reputation advantage.`
  if (ctx.locationRating < avg - 0.2)
    return `Competitors average ${avg.toFixed(1)} stars vs your ${ctx.locationRating.toFixed(1)} -- focus on service quality to close the gap.`
  return `Your rating (${ctx.locationRating.toFixed(1)}) is competitive with nearby businesses.`
}

function eventSummary(ev: NormalizedEvent) {
  return {
    uid: ev.uid,
    title: ev.title ?? null,
    startDatetime: ev.startDatetime ?? null,
    displayedDates: ev.displayedDates ?? null,
    venue_name: ev.venue?.name ?? null,
    venue_address: ev.venue?.address ?? null,
    url: ev.url ?? null,
  }
}

// ---------------------------------------------------------------------------
// 1. events.weekend_density_spike
// ---------------------------------------------------------------------------

function detectWeekendDensitySpike(
  current: NormalizedEventsSnapshotV1,
  previous: NormalizedEventsSnapshotV1 | null,
  ctx: InsightContext
): GeneratedInsight | null {
  if (!previous) return null

  const currentWeekend = current.events.filter(isWeekendEvent).length
  const previousWeekend = previous.events.filter(isWeekendEvent).length
  if (previousWeekend === 0) return null

  const delta = currentWeekend - previousWeekend
  const pctChange = delta / previousWeekend

  if (pctChange >= WEEKEND_DENSITY_SPIKE_PCT && delta >= WEEKEND_DENSITY_SPIKE_ABS) {
    const topEvents = current.events.filter(isWeekendEvent).slice(0, 3)
    const eventNames = topEventNames(topEvents)
    const pctStr = Math.round(pctChange * 100)
    const edge = ratingEdge(ctx)

    return {
      insight_type: "events.weekend_density_spike",
      title: `${currentWeekend} weekend events near ${ctx.locationName}`,
      summary: `Weekend events jumped from ${previousWeekend} to ${currentWeekend} (+${pctStr}%), including ${eventNames}. This surge typically brings increased foot traffic to your area.`,
      confidence: "medium",
      severity: pctChange >= 0.5 ? "warning" : "info",
      evidence: {
        current_weekend_count: currentWeekend,
        previous_weekend_count: previousWeekend,
        delta,
        pct_change: Number((pctChange * 100).toFixed(1)),
        location_name: ctx.locationName,
        location_rating: ctx.locationRating,
        sample_events: topEvents.map(eventSummary),
      },
      recommendations: [
        {
          title: `Run a weekend special at ${ctx.locationName}`,
          rationale: `With ${currentWeekend} events drawing visitors to your area this weekend, a limited-time offer could convert foot traffic into new customers. ${edge}`,
        },
        {
          title: "Post on social media before the weekend",
          rationale: `Event-goers for ${eventNames} will be searching for nearby spots. A timely post highlighting your location and proximity can capture their attention.`,
        },
      ],
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// 2. events.upcoming_dense_day
// ---------------------------------------------------------------------------

function detectDenseDays(
  current: NormalizedEventsSnapshotV1,
  matches: EventMatchRecord[],
  ctx: InsightContext
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (const [dateStr, count] of Object.entries(current.summary.byDate)) {
    if (count < DENSE_DAY_THRESHOLD) continue

    const eventsOnDay = current.events.filter(
      (e) => e.startDatetime?.startsWith(dateStr)
    )

    // Demoted: a raw pile of small events is not a story (this is what fired the
    // low-value Latin-music insight). Require at least one major or high-signal event
    // on the day before flagging density — the impact rule (0) carries the big ones.
    const hasSignal = eventsOnDay.some(
      (e) =>
        e.magnitude === "major" ||
        HIGH_SIGNAL_KEYWORDS.some((kw) => (e.title ?? "").toLowerCase().includes(kw))
    )
    if (!hasSignal) continue

    const topNames = topEventNames(eventsOnDay)
    const dateLabel = fmtDate(dateStr)

    // Check if any competitor is hosting on this day
    const matchedOnDay = matches.filter((m) => {
      const ev = current.events.find((e) => e.uid === m.event_uid)
      return ev?.startDatetime?.startsWith(dateStr)
    })
    const hostingComp = matchedOnDay.length > 0
      ? findCompetitor(ctx, matchedOnDay[0].competitor_id ?? "")
      : null

    const hostingNote = hostingComp?.name
      ? ` Your competitor ${hostingComp.name}${hostingComp.rating ? ` (${fmtRating(hostingComp.rating)})` : ""} is linked to one of these events.`
      : ""

    insights.push({
      insight_type: "events.upcoming_dense_day",
      title: `${count} events on ${dateLabel}`,
      summary: `${dateLabel} has ${count} events near ${ctx.locationName}, including ${topNames}.${hostingNote} Expect above-average area activity.`,
      confidence: "medium",
      severity: count >= 12 ? "warning" : "info",
      evidence: {
        date: dateStr,
        event_count: count,
        location_name: ctx.locationName,
        competitor_hosting: hostingComp?.name ?? null,
        sample_events: eventsOnDay.slice(0, 5).map(eventSummary),
      },
      recommendations: [
        {
          title: `Adjust staffing for ${dateLabel}`,
          rationale: `${count} events on a single day means significantly more visitors in your area. Review scheduling to ensure ${ctx.locationName} is prepared for higher demand.`,
        },
        ...(hostingComp?.name
          ? [
              {
                title: `Counter ${hostingComp.name}'s event presence`,
                rationale: `${hostingComp.name} is linked to an event on ${dateLabel}. Consider offering your own promotion to attract attendees looking for alternatives.`,
              },
            ]
          : []),
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// 3. events.new_high_signal_event
// ---------------------------------------------------------------------------

function detectHighSignalEvents(
  current: NormalizedEventsSnapshotV1,
  previous: NormalizedEventsSnapshotV1 | null,
  ctx: InsightContext
): GeneratedInsight[] {
  const previousUids = new Set((previous?.events ?? []).map((e) => e.uid))
  const insights: GeneratedInsight[] = []

  for (const ev of current.events) {
    if (previousUids.has(ev.uid)) continue

    const titleLower = (ev.title ?? "").toLowerCase()
    const matchedKeywords = HIGH_SIGNAL_KEYWORDS.filter((kw) => titleLower.includes(kw))
    const hasMultipleTicketSources = (ev.ticketsAndInfo?.length ?? 0) >= 2

    if (matchedKeywords.length === 0 && !hasMultipleTicketSources) continue

    // VALIDATED FIELDS ONLY (P13 §3.3 R1) — copy is templated strictly from validated fields
    // (canonical venue + authoritative local start + competition label), NEVER the raw scraped
    // `ev.title`/`ev.venue.name`/`ev.displayedDates`. This is the World Cup leak fix: a scraped
    // title like "🔥 ENGLAND vs CROATIA — Tickets!! (WRONGtown)" must not reach customer copy.
    // The audience descriptor stays keyword-based (derived, not interpolated free text).
    const eventLabel = validatedEventLabel(ev)
    const venueName = validatedVenue(ev)
    const when = validatedWhen(ev)
    const audience = matchedKeywords
      .map((kw) => KEYWORD_AUDIENCE[kw])
      .filter(Boolean)[0] ?? "visitors exploring the area"

    insights.push({
      insight_type: "events.new_high_signal_event",
      title: `New notable event nearby: ${eventLabel}`,
      summary: `${eventLabel} at ${venueName} (${when}) could draw ${audience}. ${hasMultipleTicketSources ? "Multiple ticket sources suggest strong attendance." : ""}`.trim(),
      confidence: matchedKeywords.length >= 2 ? "high" : "medium",
      severity: "info",
      evidence: {
        event: eventSummary(ev),
        matched_keywords: matchedKeywords,
        ticket_source_count: ev.ticketsAndInfo?.length ?? 0,
        is_new: true,
        // P13 R1 provenance (internal; NOT customer copy).
        validated_venue: ev.validatedVenueName ?? null,
        authoritative_local_start: ev.authoritativeLocalStart ?? null,
        fixture_ref: ev.fixtureRef ?? null,
        league_validated: ev.leagueValidated ?? false,
        location_name: ctx.locationName,
      },
      recommendations: [
        {
          title: `Target ${eventLabel} attendees`,
          rationale: `This event attracts ${audience}. Consider a themed promotion at ${ctx.locationName} around ${when} to capture this audience.${ctx.locationRating ? ` Your ${fmtRating(ctx.locationRating)} rating makes you a strong choice for visitors.` : ""}`,
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// 4. events.competitor_hosting_event
// ---------------------------------------------------------------------------

function detectCompetitorHosting(
  matches: EventMatchRecord[],
  ctx: InsightContext
): GeneratedInsight[] {
  const relevant = matches.filter(
    (m) => m.confidence === "high" || (m.confidence === "low" && m.match_type === "url_domain")
  )

  const byCompetitor = new Map<string, EventMatchRecord[]>()
  for (const m of relevant) {
    if (!m.competitor_id) continue
    const arr = byCompetitor.get(m.competitor_id) ?? []
    arr.push(m)
    byCompetitor.set(m.competitor_id, arr)
  }

  const insights: GeneratedInsight[] = []
  for (const [competitorId, compMatches] of byCompetitor) {
    const compInfo = findCompetitor(ctx, competitorId)
    const compName = compInfo?.name ?? compMatches[0]?.evidence.competitor.name ?? "A competitor"
    const compRating = compInfo?.rating

    const eventTitles = compMatches
      .map((m) => m.evidence.event.title)
      .filter(Boolean)
      .slice(0, 3)
    const eventNames = eventTitles.map((t) => `"${t}"`).join(", ") || "an upcoming event"
    const firstDate = compMatches[0]?.evidence.event.start
    const dateNote = firstDate ? ` on ${fmtDate(firstDate)}` : ""

    // Build competitive comparison
    let comparison = ""
    if (compRating && ctx.locationRating) {
      if (ctx.locationRating > compRating) {
        comparison = ` With your ${fmtRating(ctx.locationRating)} rating vs their ${fmtRating(compRating)}, you have a reputation edge with event attendees.`
      } else if (ctx.locationRating < compRating) {
        comparison = ` They have a ${fmtRating(compRating)} rating vs your ${fmtRating(ctx.locationRating)}, so competing on experience and promotions is key.`
      }
    }

    insights.push({
      insight_type: "events.competitor_hosting_event",
      title: `${compName} is hosting ${eventNames}`,
      summary: `${compName} appears to be the venue for ${eventNames}${dateNote}. This gives them direct exposure to event attendees.${comparison}`,
      confidence: compMatches.some((m) => m.confidence === "high") ? "high" : "medium",
      severity: "warning",
      evidence: {
        competitor_id: competitorId,
        competitor_name: compName,
        competitor_rating: compRating,
        location_name: ctx.locationName,
        location_rating: ctx.locationRating,
        matched_events: compMatches.map((m) => ({
          event_uid: m.event_uid,
          event_title: m.evidence.event.title,
          event_date: m.evidence.event.start,
          match_type: m.match_type,
          confidence: m.confidence,
        })),
      },
      recommendations: [
        {
          title: `Run a counter-promotion at ${ctx.locationName}`,
          rationale: `${compName} will attract attendees of ${eventNames}. Offer a "pre-event" or "post-event" deal at ${ctx.locationName} to capture overflow traffic.`,
        },
        {
          title: `Promote ${ctx.locationName} as an alternative`,
          rationale: `Post on social media and local listings highlighting your proximity to the event area${ctx.locationRating ? ` and your ${fmtRating(ctx.locationRating)} rating` : ""}. Event-goers often look for nearby alternatives.`,
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// 5. events.competitor_event_cadence_up
// ---------------------------------------------------------------------------

function detectCadenceUp(
  currentMatches: EventMatchRecord[],
  previousMatches: EventMatchRecord[] | null,
  ctx: InsightContext
): GeneratedInsight[] {
  if (!previousMatches) return []

  const currentCounts = countByCompetitor(currentMatches)
  const previousCounts = countByCompetitor(previousMatches)
  const insights: GeneratedInsight[] = []

  for (const [competitorId, currentCount] of currentCounts) {
    const previousCount = previousCounts.get(competitorId) ?? 0
    const delta = currentCount - previousCount
    if (delta < CADENCE_UP_THRESHOLD) continue

    const compInfo = findCompetitor(ctx, competitorId)
    const compName = compInfo?.name ??
      currentMatches.find((m) => m.competitor_id === competitorId)?.evidence.competitor.name ??
      "A competitor"

    const eventTitles = currentMatches
      .filter((m) => m.competitor_id === competitorId)
      .map((m) => m.evidence.event.title)
      .filter(Boolean)
      .slice(0, 3)

    insights.push({
      insight_type: "events.competitor_event_cadence_up",
      title: `${compName} is ramping up event activity`,
      summary: `${compName} went from ${previousCount} to ${currentCount} event associations (+${delta}), including ${eventTitles.map((t) => `"${t}"`).join(", ") || "various events"}. They may be investing in local visibility.`,
      confidence: "medium",
      severity: delta >= 4 ? "warning" : "info",
      evidence: {
        competitor_id: competitorId,
        competitor_name: compName,
        competitor_rating: compInfo?.rating ?? null,
        current_count: currentCount,
        previous_count: previousCount,
        delta,
        location_name: ctx.locationName,
      },
      recommendations: [
        {
          title: `Explore event partnerships for ${ctx.locationName}`,
          rationale: `${compName} is building community presence through ${currentCount} event connections. Consider sponsoring or partnering with local events to maintain competitive visibility for ${ctx.locationName}.`,
        },
        {
          title: "Engage your existing customer base",
          rationale: `While ${compName} grows through events, leverage your ${ctx.locationReviewCount ? `${ctx.locationReviewCount} reviews` : "customer base"} by encouraging loyal customers to spread the word and leave reviews.`,
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function isWeekendEvent(ev: NormalizedEvent): boolean {
  if (!ev.startDatetime) {
    if (ev.dateRange === "weekend") return true
    if (ev.displayedDates) {
      const lower = ev.displayedDates.toLowerCase()
      return lower.includes("sat") || lower.includes("sun")
    }
    return false
  }
  try {
    const day = new Date(ev.startDatetime).getUTCDay()
    return day === 0 || day === 6
  } catch {
    return false
  }
}

function countByCompetitor(matches: EventMatchRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const m of matches) {
    if (!m.competitor_id) continue
    counts.set(m.competitor_id, (counts.get(m.competitor_id) ?? 0) + 1)
  }
  return counts
}
