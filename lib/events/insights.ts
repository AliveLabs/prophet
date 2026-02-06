// ---------------------------------------------------------------------------
// Deterministic event insight rules
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

const WEEKEND_DENSITY_SPIKE_PCT = 0.3 // 30%
const WEEKEND_DENSITY_SPIKE_ABS = 5
const DENSE_DAY_THRESHOLD = 8
const CADENCE_UP_THRESHOLD = 2

const HIGH_SIGNAL_KEYWORDS = [
  "festival",
  "concert",
  "convention",
  "food",
  "wine",
  "beer",
  "taste",
  "chef",
  "sports",
  "game",
  "marathon",
  "parade",
  "expo",
  "fair",
  "market",
  "gala",
  "fundraiser",
  "block party",
  "music",
  "comedy",
  "pop-up",
]

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
}): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  // --- Location-level insights (competitor_id = null via caller) ----------

  // 1. Weekend density spike
  const weekendSpike = detectWeekendDensitySpike(input.current, input.previous)
  if (weekendSpike) insights.push(weekendSpike)

  // 2. Upcoming dense day
  const denseDays = detectDenseDays(input.current)
  insights.push(...denseDays)

  // 3. New high-signal events
  const highSignal = detectHighSignalEvents(input.current, input.previous)
  insights.push(...highSignal)

  // --- Competitor-level insights -----------------------------------------

  // 4. Competitor hosting event
  const hosting = detectCompetitorHosting(input.matches)
  insights.push(...hosting)

  // 5. Competitor event cadence up
  const cadenceUp = detectCadenceUp(input.matches, input.previousMatches)
  insights.push(...cadenceUp)

  return insights
}

// ---------------------------------------------------------------------------
// 1. events.weekend_density_spike
// ---------------------------------------------------------------------------

function detectWeekendDensitySpike(
  current: NormalizedEventsSnapshotV1,
  previous: NormalizedEventsSnapshotV1 | null
): GeneratedInsight | null {
  if (!previous) return null

  const currentWeekend = countWeekendEvents(current)
  const previousWeekend = countWeekendEvents(previous)

  if (previousWeekend === 0) return null

  const delta = currentWeekend - previousWeekend
  const pctChange = delta / previousWeekend

  if (pctChange >= WEEKEND_DENSITY_SPIKE_PCT && delta >= WEEKEND_DENSITY_SPIKE_ABS) {
    return {
      insight_type: "events.weekend_density_spike",
      title: "Weekend event activity is surging",
      summary: `Weekend events increased from ${previousWeekend} to ${currentWeekend} (+${Math.round(pctChange * 100)}%). Higher foot traffic in your area is likely.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        current_weekend_count: currentWeekend,
        previous_weekend_count: previousWeekend,
        delta,
        pct_change: Number((pctChange * 100).toFixed(1)),
        sample_events: current.events
          .filter((e) => isWeekendEvent(e))
          .slice(0, 5)
          .map(eventSummary),
      },
      recommendations: [
        {
          title: "Prepare for increased demand",
          rationale:
            "A spike in nearby weekend events typically correlates with higher area foot traffic. Consider adjusting staffing, inventory, or promotions.",
        },
        {
          title: "Promote awareness on social media",
          rationale:
            "Event-goers often search for nearby dining options. Posting on social media around event dates may capture their attention.",
        },
      ],
    }
  }

  return null
}

function countWeekendEvents(snapshot: NormalizedEventsSnapshotV1): number {
  return snapshot.events.filter(isWeekendEvent).length
}

function isWeekendEvent(ev: NormalizedEvent): boolean {
  if (!ev.startDatetime) {
    // fallback: check dateRange or displayedDates
    if (ev.dateRange === "weekend") return true
    if (ev.displayedDates) {
      const lower = ev.displayedDates.toLowerCase()
      return lower.includes("sat") || lower.includes("sun")
    }
    return false
  }
  try {
    const d = new Date(ev.startDatetime)
    const day = d.getUTCDay()
    return day === 0 || day === 6 // Sunday or Saturday
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 2. events.upcoming_dense_day
// ---------------------------------------------------------------------------

function detectDenseDays(
  current: NormalizedEventsSnapshotV1
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const byDate = current.summary.byDate

  for (const [dateStr, count] of Object.entries(byDate)) {
    if (count >= DENSE_DAY_THRESHOLD) {
      const eventsOnDay = current.events.filter((e) => {
        if (!e.startDatetime) return false
        return e.startDatetime.startsWith(dateStr)
      })

      insights.push({
        insight_type: "events.upcoming_dense_day",
        title: `${count} events scheduled on ${dateStr}`,
        summary: `An unusually high number of events (${count}) are happening on ${dateStr} near your location. This may drive increased foot traffic.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          date: dateStr,
          event_count: count,
          sample_events: eventsOnDay.slice(0, 5).map(eventSummary),
        },
        recommendations: [
          {
            title: "Plan for a busier day",
            rationale: `${count} local events on a single day suggests above-average area activity. Review staffing and supplies.`,
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// 3. events.new_high_signal_event
// ---------------------------------------------------------------------------

function detectHighSignalEvents(
  current: NormalizedEventsSnapshotV1,
  previous: NormalizedEventsSnapshotV1 | null
): GeneratedInsight[] {
  const previousUids = new Set(
    (previous?.events ?? []).map((e) => e.uid)
  )

  const insights: GeneratedInsight[] = []

  for (const ev of current.events) {
    // Must be new
    if (previousUids.has(ev.uid)) continue

    const titleLower = (ev.title ?? "").toLowerCase()
    const matchedKeywords = HIGH_SIGNAL_KEYWORDS.filter((kw) =>
      titleLower.includes(kw)
    )
    const hasMultipleTicketSources =
      (ev.ticketsAndInfo?.length ?? 0) >= 2

    if (matchedKeywords.length > 0 || hasMultipleTicketSources) {
      insights.push({
        insight_type: "events.new_high_signal_event",
        title: `New notable event: ${ev.title ?? "Untitled"}`,
        summary: `A new event "${ev.title ?? "Untitled"}" has appeared in your area${
          matchedKeywords.length
            ? ` (keywords: ${matchedKeywords.join(", ")})`
            : ""
        }${hasMultipleTicketSources ? " with multiple ticket sources" : ""}.`,
        confidence: matchedKeywords.length >= 2 ? "high" : "medium",
        severity: "info",
        evidence: {
          event: eventSummary(ev),
          matched_keywords: matchedKeywords,
          ticket_source_count: ev.ticketsAndInfo?.length ?? 0,
          is_new: true,
        },
        recommendations: [
          {
            title: "Review the event for relevance",
            rationale:
              "This event may attract your target demographic. Consider cross-promoting or adjusting offerings around the event date.",
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// 4. events.competitor_hosting_event
// ---------------------------------------------------------------------------

function detectCompetitorHosting(
  matches: EventMatchRecord[]
): GeneratedInsight[] {
  // Only high-confidence venue matches or domain matches
  const relevant = matches.filter(
    (m) =>
      m.confidence === "high" ||
      (m.confidence === "low" && m.match_type === "url_domain")
  )

  // Group by competitor
  const byCompetitor = new Map<string, EventMatchRecord[]>()
  for (const m of relevant) {
    if (!m.competitor_id) continue
    const existing = byCompetitor.get(m.competitor_id) ?? []
    existing.push(m)
    byCompetitor.set(m.competitor_id, existing)
  }

  const insights: GeneratedInsight[] = []
  for (const [competitorId, compMatches] of byCompetitor) {
    const compName = compMatches[0]?.evidence.competitor.name ?? "A competitor"
    const eventTitles = compMatches
      .map((m) => m.evidence.event.title)
      .filter(Boolean)
      .slice(0, 5)

    insights.push({
      insight_type: "events.competitor_hosting_event",
      title: `${compName} appears linked to upcoming event(s)`,
      summary: `${compName} may be hosting or participating in ${compMatches.length} upcoming event(s): ${eventTitles.join(", ") || "unnamed events"}.`,
      confidence: compMatches.some((m) => m.confidence === "high")
        ? "high"
        : "medium",
      severity: "info",
      evidence: {
        competitor_id: competitorId,
        competitor_name: compName,
        matched_events: compMatches.map((m) => ({
          event_uid: m.event_uid,
          event_title: m.evidence.event.title,
          match_type: m.match_type,
          confidence: m.confidence,
          score: m.evidence.score,
        })),
      },
      recommendations: [
        {
          title: "Monitor competitor event activity",
          rationale:
            "Competitors hosting or sponsoring events may gain visibility. Consider your own event partnerships or promotions to maintain competitive presence.",
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
  previousMatches: EventMatchRecord[] | null
): GeneratedInsight[] {
  if (!previousMatches) return []

  // Count matched events per competitor
  const currentCounts = countByCompetitor(currentMatches)
  const previousCounts = countByCompetitor(previousMatches)

  const insights: GeneratedInsight[] = []

  for (const [competitorId, currentCount] of currentCounts) {
    const previousCount = previousCounts.get(competitorId) ?? 0
    const delta = currentCount - previousCount

    if (delta >= CADENCE_UP_THRESHOLD) {
      const compName =
        currentMatches.find((m) => m.competitor_id === competitorId)?.evidence
          .competitor.name ?? "A competitor"

      insights.push({
        insight_type: "events.competitor_event_cadence_up",
        title: `${compName} is linked to more events than before`,
        summary: `${compName} is now associated with ${currentCount} events (up from ${previousCount}, +${delta}). Their local visibility may be increasing.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor_id: competitorId,
          competitor_name: compName,
          current_count: currentCount,
          previous_count: previousCount,
          delta,
        },
        recommendations: [
          {
            title: "Evaluate your event strategy",
            rationale:
              "An increase in competitor event associations suggests they may be investing more in community engagement. Consider how you can maintain or increase your local presence.",
          },
        ],
      })
    }
  }

  return insights
}

function countByCompetitor(
  matches: EventMatchRecord[]
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const m of matches) {
    if (!m.competitor_id) continue
    counts.set(m.competitor_id, (counts.get(m.competitor_id) ?? 0) + 1)
  }
  return counts
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
