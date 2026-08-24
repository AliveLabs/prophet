// ---------------------------------------------------------------------------
// An event insight expires when its EVENT does, not when its row goes stale.
//
// THE BUG. On Sunday 2026-08-23, Raising Cane's home page carried two plays about Saturday's Zach
// Bryan concert, one of them for a 10pm-to-midnight window that had already closed. The events
// themselves were filtered correctly: the dossier's demand calendar drops anything whose date is
// before today (`upcoming` in dossier/build.ts), and the raw snapshot's Zach Bryan row
// (startDatetime 2026-08-22T19:00, endDatetime null) failed that gate as it should.
//
// It came in through the OTHER door. `build.ts` also reads stored `insights` rows, keeping the
// freshest of each type within RETENTION_DAYS (30). That window exists for a good reason, stated
// there: a signal whose pipeline did not run today is served last-good rather than silently
// vanishing, which is the provider-down failure mode. Applied to an event, "last-good" means an
// event that already happened. The `events.major_lobby_surge` row for Zach Bryan was first written
// on 2026-08-13 and would have kept feeding briefs until roughly 2026-09-12.
//
// So the row's FRESHNESS and the event's RELEVANCE are two different questions, and one was
// answering for the other. Same family as the rule that a metric must not share a predicate with
// the behaviour it measures: `date_key` records when we OBSERVED the event, and the only field that
// says when the event HAPPENS lives inside `evidence`.
//
// WHY THIS IS A READ-TIME GATE AND NOT A WRITE-TIME ONE. ALT-765 put the voice scrub at the write
// boundary, and that was right there. It would not work here: the event WAS in the future when the
// row was written, so nothing was wrong with it at write time. Its validity changes with the passage
// of time rather than with its content, and only a reader knows what day it is.
//
// SCOPE: `events.*` types only. Everything else (review_themes, seo_*, social.*) is a trend or a
// state rather than a dated occurrence, and must keep the full retention window.
// ---------------------------------------------------------------------------

/** Rows this gate applies to. A non-events insight is never expired by this rule. */
export function isEventInsightType(insightType: string): boolean {
  return insightType.startsWith("events.")
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  // Accepts "2026-08-22" and "2026-08-22T19:00" alike: the leading 10 characters are the date in
  // both, which is the same comparison the demand-calendar gate in dossier/build.ts already makes.
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null
}

/**
 * The last day an event insight is still about something ahead of the operator, or null when the
 * row carries no date we can read.
 *
 * Takes the LATEST date the row refers to. That matters for the multi-event types: an
 * `events.competitor_hosting_event` row listing three fixtures is still live while any one of them
 * is upcoming, so expiring it on the earliest would drop a real signal.
 */
export function eventInsightLastDay(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object") return null
  const e = evidence as Record<string, unknown>
  const candidates: (string | null)[] = []

  // Most reliable first, though all of these are compared date-only so the order only decides
  // which one we read, not the answer.
  candidates.push(dateOnly(e.authoritative_local_start))
  // `evidence.date` on events.upcoming_dense_day.
  candidates.push(dateOnly(e.date))

  // `evidence.event` (eventSummary) on major_lobby_surge / access_suppression /
  // new_high_signal_event. Note eventSummary carries no endDatetime, so start is all there is.
  const ev = e.event
  if (ev && typeof ev === "object") {
    const eo = ev as Record<string, unknown>
    candidates.push(dateOnly(eo.endDatetime))
    candidates.push(dateOnly(eo.startDatetime))
  }

  // `evidence.events[]` on competitor_hosting_event, each with an `event_date`.
  const list = e.events
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && typeof item === "object") {
        const io = item as Record<string, unknown>
        candidates.push(dateOnly(io.event_date))
        candidates.push(dateOnly(io.date))
      }
    }
  }

  const found = candidates.filter((c): c is string => c !== null)
  if (found.length === 0) return null
  return found.reduce((latest, d) => (d > latest ? d : latest))
}

/**
 * Has this insight's event already happened?
 *
 * FAILS OPEN on an unreadable date: no date means "keep the row". That is deliberately the same
 * polarity as the demand-calendar gate next door (`!when || when >= dateKey`), so the two cannot
 * disagree about the same event. A row with no date is usually a trend rather than an occurrence,
 * and silently dropping real signal is the worse of the two mistakes here.
 *
 * `todayKey` is the build's own date key, so this stays on one clock with the rest of the dossier
 * and never re-derives "today" from a timezone of its own.
 */
export function eventInsightHasPassed(
  insightType: string,
  evidence: unknown,
  todayKey: string,
): boolean {
  if (!isEventInsightType(insightType)) return false
  const lastDay = eventInsightLastDay(evidence)
  if (!lastDay) return false
  return lastDay < todayKey.slice(0, 10)
}
