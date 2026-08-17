// ---------------------------------------------------------------------------
// Surface readiness (ALT-629).
//
// /home already refuses to render a brief that does not exist. Every OTHER operator surface
// rendered whatever it could read, whenever it was asked, which during a first run means a page
// half-populated by pulls that have not finished. The operator cannot tell the difference between
// "we looked and there is nothing" and "we have not looked yet", so a partial page reads as a
// finished answer that happens to be wrong. Chris's walkthrough on 2026-08-17 produced seven
// reports; the call put roughly nine in ten of them in exactly this bucket.
//
// Decided on that call: hide an in-progress section, do not fill it with a placeholder. A
// placeholder is still a claim about the shape of an answer we do not have.
//
// PURE ON PURPOSE, like lib/onboarding/first-run-signals.ts next door: the loader does the read
// and hands the rows in, so every rule about what may be SHOWN is unit-testable. `vitest` only
// collects `tests/unit/**/*.test.ts`, so a rule left in a component cannot be tested at all.
//
// TWO RULES DO THE WORK:
//
//   1. A pipeline that has reached a terminal state is TRUSTED, whatever it found. Its surface
//      renders normally: the page's own empty state is honest at that point, because a real read
//      happened and came back with nothing. This is the same distinction first-run-signals draws
//      between `empty` and `unavailable`.
//
//   2. A pipeline that has never reached a terminal state and is still in flight GATES its
//      surface. Not "some sections hidden": the whole surface, because a page showing three of
//      its five sections is still telling the operator that those three are the answer.
//
// AND ONE SAFETY RULE: this gate FAILS OPEN. Given no job rows at all, no readable status, or a
// pipeline nobody recognises, it returns `ready`. A gate that can permanently hide a working page
// is a worse outage than the partial render it was built to prevent, and job rows are prunable.
// ---------------------------------------------------------------------------

/** The operator surfaces that can be gated. Named for the route, not the pipeline. */
export type SurfaceKey =
  | "competitors"
  | "social"
  | "weather"
  | "traffic"
  | "events"
  | "visibility"
  | "photos"
  | "reviews"
  | "content"
  | "insights"

export type SurfaceReadinessState = "ready" | "working"

export type SurfaceReadiness = {
  state: SurfaceReadinessState
  /** Operator-facing names of the pulls this surface is still waiting on. Empty when ready. */
  pending: string[]
  /** One honest line. Empty when ready. */
  headline: string
  /** What is still running and what happens next. Empty when ready. */
  detail: string
}

export type SurfaceJobRead = { pipeline: string; status: string }

/**
 * Which pipelines a surface's content actually comes from.
 *
 * Kept deliberately tight. A surface lists only the pulls whose ABSENCE would make the page lie;
 * adding a loosely-related pipeline here would gate a page on work it does not display, which
 * trades one wrong render for a page that is needlessly unavailable.
 */
export const SURFACE_PIPELINES: Record<SurfaceKey, readonly string[]> = {
  // Competitor names, hours, and place details all land with the content pull.
  competitors: ["content"],
  social: ["social"],
  weather: ["weather"],
  traffic: ["busy_times"],
  events: ["events"],
  visibility: ["visibility"],
  photos: ["photos"],
  // Reviews arrive inside the place-details read the content pull performs.
  reviews: ["content"],
  content: ["content"],
  // Insights are generated FROM the other pulls, so the insights job settling is the one signal
  // that everything upstream of it has already settled.
  insights: ["insights"],
}

/** Operator-facing pull names. Never a vendor, never an internal pipeline id. */
export const PIPELINE_LABELS: Record<string, string> = {
  content: "what your competitors are showing",
  visibility: "where you show up in local search",
  events: "what is happening near you",
  weather: "the weather ahead",
  busy_times: "when your market is busy",
  social: "what your competitors are posting",
  photos: "the photos on your listings",
  insights: "your insights",
  starter: "your first insight",
  brief: "your morning brief",
}

/** A job that has stopped. Either outcome counts: we asked, and we got an answer or we did not. */
const TERMINAL_STATUSES = new Set(["done", "failed", "skipped"])
/** A job still on its way to an answer. */
const ACTIVE_STATUSES = new Set(["queued", "running", "deferred"])

const READY: SurfaceReadiness = { state: "ready", pending: [], headline: "", detail: "" }

function listPhrase(items: readonly string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`
}

/**
 * Whether this surface may render, given every signal_jobs row on the location.
 *
 * `jobs` is EVERY row for the location, not a filtered set: the fail-open rule needs to know
 * whether the location has any work in flight at all before it decides that a pipeline with no
 * rows of its own is pending rather than pruned.
 */
export function surfaceReadiness(
  surface: SurfaceKey,
  jobs: readonly SurfaceJobRead[],
): SurfaceReadiness {
  const dependencies = SURFACE_PIPELINES[surface]
  // An unrecognised surface must not be able to hide a page.
  if (!dependencies || dependencies.length === 0) return READY
  // No rows at all: this location's history was pruned, or it predates the queue. Render.
  if (jobs.length === 0) return READY

  const statusesByPipeline = new Map<string, Set<string>>()
  for (const job of jobs) {
    if (typeof job?.pipeline !== "string" || typeof job?.status !== "string") continue
    const set = statusesByPipeline.get(job.pipeline) ?? new Set<string>()
    set.add(job.status)
    statusesByPipeline.set(job.pipeline, set)
  }

  // Does this location have ANY work in flight? Used only to judge a dependency with no rows of
  // its own: mid-first-run that pipeline is genuinely still coming, but on a settled location it
  // means the row was pruned and gating on it would hide the page forever.
  const locationIsWorking = [...statusesByPipeline.values()].some((statuses) =>
    [...statuses].some((s) => ACTIVE_STATUSES.has(s)),
  )

  const pending: string[] = []
  for (const pipeline of dependencies) {
    const statuses = statusesByPipeline.get(pipeline)
    if (statuses && [...statuses].some((s) => TERMINAL_STATUSES.has(s))) continue // rule 1: trusted
    const inFlight = statuses
      ? [...statuses].some((s) => ACTIVE_STATUSES.has(s))
      : locationIsWorking
    if (inFlight) pending.push(PIPELINE_LABELS[pipeline] ?? pipeline)
  }

  if (pending.length === 0) return READY

  return {
    state: "working",
    pending,
    headline: "We are still putting this together.",
    detail: `We are working out ${listPhrase(pending)}. This page opens once that is finished, so what you read here is never half of an answer.`,
  }
}

/**
 * The readiness of several surfaces from ONE set of job rows.
 * Lets a page that spans surfaces (or a nav that wants to mark them) pay for a single read.
 */
export function surfaceReadinessMap(
  surfaces: readonly SurfaceKey[],
  jobs: readonly SurfaceJobRead[],
): Record<string, SurfaceReadiness> {
  const out: Record<string, SurfaceReadiness> = {}
  for (const surface of surfaces) out[surface] = surfaceReadiness(surface, jobs)
  return out
}
