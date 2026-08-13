// ---------------------------------------------------------------------------
// Progressive first-run signals (beta rescue Phase 3.1).
//
// The build screen used to be a list of pipeline names with a status word beside each. Nothing
// on it was VALUE: the operator learned that "Local events" was "In progress", never what we
// found. This turns each landed first-run signal into one honest line the moment it lands.
//
// PURE ON PURPOSE. The route does the reads and hands the shapes in; every decision about what
// may be SAID lives here, where it is unit-testable. `vitest` only collects
// `tests/unit/**/*.test.ts`, so logic left inside a component cannot be tested at all.
//
// THE HONESTY RULES, each of which is a decision not to guess:
//   · Four states, and the difference between the last three is load-bearing.
//       ready       we read it and there is something to say.
//       working     the pull has not finished. Say what is still running, never a percentage
//                   and never a guess at what it will find.
//       empty       we read it and the honest answer is "nothing". Only ever from a REAL read
//                   (a snapshot that exists and is empty), never from an absent snapshot.
//       unavailable we could not read it. Absence of data is NOT absence of the thing.
//   · No signal claims a number it did not count.
//   · "still learning" style filler is banned. When a signal is working, the line names the
//     work; when it is unavailable, the line says so plainly.
//
// COPY: plain operator language. No vendor is ever named customer-side, no em dashes, and the
// product noun stays "insight".
// ---------------------------------------------------------------------------

export type FirstRunSignalKey = "competitors" | "events" | "visibility"

export type FirstRunSignalState = "ready" | "working" | "empty" | "unavailable"

export type FirstRunSignal = {
  key: FirstRunSignalKey
  /** Section label. Stable across states so the row does not jump as it lands. */
  label: string
  state: FirstRunSignalState
  /** One honest line. Never a promise, never a percentage. */
  headline: string
  /** Up to three concrete facts behind the headline (names, event titles, search terms). */
  items?: string[]
}

export type FirstRunSignalInput = {
  /** signal_jobs status by pipeline for the CURRENT first-run batch. A pipeline with no row
   *  is treated as not started. */
  jobStatus: Readonly<Record<string, string>>
  /** Approved competitors already on the location (chosen during onboarding, so these exist
   *  before any pipeline runs — this is the sub-minute first value). */
  competitors: readonly { name: string; distanceMi: number | null }[]
  city: string | null
  /** Upcoming LOCAL events inside the window, or null when no events snapshot exists yet.
   *  An empty ARRAY and null mean different things and must not be collapsed. */
  events: readonly { title: string; startDate: string | null }[] | null
  /** Local-search read, or null when no ranked-keyword snapshot exists yet. */
  localSearch: { rankedKeywordCount: number; topKeywords: readonly string[] } | null
  /** Whether the listing carries a website. Without one there is nothing to look up. */
  hasWebsite: boolean
}

/** How far ahead "this week" reaches for the events signal. */
export const EVENTS_WINDOW_DAYS = 7

const DONE_STATUSES = new Set(["done", "failed"])

/** True once a pipeline has stopped (either outcome), so an absent read is final, not pending. */
export function pipelineSettled(jobStatus: Readonly<Record<string, string>>, pipeline: string): boolean {
  const status = jobStatus[pipeline]
  return status !== undefined && DONE_STATUSES.has(status)
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function competitorSignal(input: FirstRunSignalInput): FirstRunSignal {
  const names = input.competitors.map((c) => c.name).filter(Boolean)
  if (names.length === 0) {
    return {
      key: "competitors",
      label: "Who we watch near you",
      state: "empty",
      headline: "No competitors are on your list yet.",
    }
  }
  const near = input.city ? ` near ${input.city}` : ""
  return {
    key: "competitors",
    label: "Who we watch near you",
    state: "ready",
    headline: `We are watching ${names.length} ${plural(names.length, "business", "businesses")}${near}.`,
    items: input.competitors.slice(0, 3).map((c) =>
      c.distanceMi !== null ? `${c.name}, ${c.distanceMi.toFixed(1)} mi away` : c.name,
    ),
  }
}

function eventsSignal(input: FirstRunSignalInput): FirstRunSignal {
  const label = "What is on near you"
  if (input.events === null) {
    if (!pipelineSettled(input.jobStatus, "events")) {
      return {
        key: "events",
        label,
        state: "working",
        headline: "Still checking what is happening near you.",
      }
    }
    return {
      key: "events",
      label,
      state: "unavailable",
      headline: "We could not read local events this time. We try again on the next run.",
    }
  }
  if (input.events.length === 0) {
    return {
      key: "events",
      label,
      state: "empty",
      headline: `Nothing near you in the next ${EVENTS_WINDOW_DAYS} days that would move your traffic.`,
    }
  }
  const count = input.events.length
  return {
    key: "events",
    label,
    state: "ready",
    headline: `${count} ${plural(count, "event", "events")} near you in the next ${EVENTS_WINDOW_DAYS} days.`,
    items: input.events.slice(0, 3).map((e) => (e.startDate ? `${e.title}, ${e.startDate}` : e.title)),
  }
}

function visibilitySignal(input: FirstRunSignalInput): FirstRunSignal {
  const label = "Whether you show up in local search"
  if (!input.hasWebsite) {
    return {
      key: "visibility",
      label,
      state: "unavailable",
      headline: "Your listing has no website on it, so there is no site for us to check in search.",
    }
  }
  if (input.localSearch === null) {
    if (!pipelineSettled(input.jobStatus, "visibility")) {
      return {
        key: "visibility",
        label,
        state: "working",
        headline: "Still checking which searches you show up for.",
      }
    }
    return {
      key: "visibility",
      label,
      state: "unavailable",
      headline: "We could not read your search visibility this time. We try again on the next run.",
    }
  }
  const { rankedKeywordCount, topKeywords } = input.localSearch
  if (rankedKeywordCount === 0) {
    return {
      key: "visibility",
      label,
      state: "empty",
      headline: "Your site is not showing up for any searches we can see yet.",
    }
  }
  return {
    key: "visibility",
    label,
    state: "ready",
    headline: `Your site shows up for ${rankedKeywordCount} ${plural(rankedKeywordCount, "search", "searches")}.`,
    items: topKeywords.slice(0, 3).map((k) => `“${k}”`),
  }
}

/** The three first-run signals, in the order the build screen shows them. */
export function summarizeFirstRunSignals(input: FirstRunSignalInput): FirstRunSignal[] {
  return [competitorSignal(input), eventsSignal(input), visibilitySignal(input)]
}

// ── Event window filter (pure) ─────────────────────────────────────────────────────────
// buildDossier's geography guard is the doctrine: the events search is metro-wide, so
// "returned" is not "nearby". Only LOCAL roles may be presented as something near you, and
// only while they are still upcoming. Anything else (metro hooks, out-of-area, ungeocoded)
// is excluded here for the same anti-fabrication reason it is excluded from the dossier.

const LOCAL_EVENT_ROLES = new Set(["local_foot", "local_traffic", "route_corridor"])

export type RawEventRead = {
  title?: string
  startDatetime?: string | null
  endDatetime?: string | null
  role?: string
}

/**
 * Upcoming LOCAL events inside the window, soonest first.
 * `todayKey` is passed in so this stays pure and the caller owns "now".
 */
export function upcomingLocalEvents(
  events: readonly RawEventRead[],
  todayKey: string,
  windowDays = EVENTS_WINDOW_DAYS,
): Array<{ title: string; startDate: string | null }> {
  const today = Date.parse(`${todayKey.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(today)) return []
  const horizon = today + windowDays * 86_400_000
  return events
    .filter((e) => e.role !== undefined && LOCAL_EVENT_ROLES.has(e.role))
    .filter((e) => typeof e.title === "string" && e.title.trim().length > 0)
    .map((e) => {
      const startKey = (e.startDatetime ?? "").slice(0, 10)
      const endKey = (e.endDatetime ?? "").slice(0, 10)
      const start = startKey ? Date.parse(`${startKey}T00:00:00Z`) : NaN
      const end = endKey ? Date.parse(`${endKey}T00:00:00Z`) : NaN
      return { title: (e.title as string).trim(), startKey, start, end }
    })
    // Still upcoming: an event that has not started, or is running now. An undated event is
    // excluded rather than assumed current.
    .filter((e) => {
      if (Number.isNaN(e.start)) return false
      const finished = !Number.isNaN(e.end) ? e.end < today : e.start < today
      return !finished && e.start <= horizon
    })
    .sort((a, b) => a.start - b.start)
    .map((e) => ({ title: e.title, startDate: e.startKey || null }))
}
