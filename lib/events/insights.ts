// ---------------------------------------------------------------------------
// Deterministic event insight rules (context-aware)
// ---------------------------------------------------------------------------

import type {
  NormalizedEventsSnapshotV1,
  NormalizedEvent,
  EventMatchRecord,
} from "./types"
import type { GeneratedInsight } from "@/lib/insights/types"

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
}): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const ctx = input.context

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

function topEventNames(events: NormalizedEvent[], n = 3): string {
  return events
    .map((e) => e.title)
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

    const dateLabel = ev.startDatetime ? fmtDate(ev.startDatetime) : ev.displayedDates ?? "upcoming"
    const venueName = ev.venue?.name ?? "a nearby venue"
    const audience = matchedKeywords
      .map((kw) => KEYWORD_AUDIENCE[kw])
      .filter(Boolean)[0] ?? "visitors exploring the area"

    insights.push({
      insight_type: "events.new_high_signal_event",
      title: ev.title ?? "New notable event nearby",
      summary: `"${ev.title ?? "Untitled"}" at ${venueName} on ${dateLabel} could draw ${audience}. ${hasMultipleTicketSources ? "Multiple ticket sources suggest strong attendance." : ""}`,
      confidence: matchedKeywords.length >= 2 ? "high" : "medium",
      severity: "info",
      evidence: {
        event: eventSummary(ev),
        matched_keywords: matchedKeywords,
        ticket_source_count: ev.ticketsAndInfo?.length ?? 0,
        is_new: true,
        location_name: ctx.locationName,
      },
      recommendations: [
        {
          title: `Target ${ev.title ?? "event"} attendees`,
          rationale: `This event attracts ${audience}. Consider a themed promotion at ${ctx.locationName} around ${dateLabel} to capture this audience.${ctx.locationRating ? ` Your ${fmtRating(ctx.locationRating)} rating makes you a strong choice for visitors.` : ""}`,
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
