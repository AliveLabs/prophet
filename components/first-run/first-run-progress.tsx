"use client"

// The first-run PROGRESS panel: pipeline rows, the elapsed clock, and the permission to leave.
//
// ALT-654 / ALT-660. This existed twice: once in app/onboarding/onboarding-wizard-pass.tsx and once
// in app/(dashboard)/home/first-run-panel.tsx, whose own comment admitted the duplication ("labels
// and order mirror the onboarding Build step; kept local so /home doesn't import the onboarding
// wizard"). Two copies of the same list is how two screens end up telling a new operator different
// stories, so the copy lives here once and both surfaces render it.
//
// FirstRunSignals (the "who we watch near you" value rows) was already shared. This is the other
// half, which was not.
//
// What Bryan asked for on 2026-08-18, and why each piece is here:
//   - The busy indicator and the elapsed clock go at the TOP. Both used to sit under the list, so
//     the one fact an operator wants (are you still working, and for how long) was below the fold.
//   - The "still working" line appears at the top AND the bottom, because you had to scroll to
//     learn we were still going.
//   - The elapsed clock is TOTAL run time, passed in from the server, never time-since-mount.
//   - No insight renders here in any state. Bryan's reason is the one that settles it: it is the
//     first impression, and we do not get it back. A partial, out-of-context insight is the most
//     expensive possible use of that moment.

import { useEffect, useState } from "react"
import "./first-run-progress.css"

/** Display order of the first-run pipelines. Single source: both surfaces render this. */
export const PIPELINE_ORDER = [
  "starter",
  "content",
  "visibility",
  "events",
  "weather",
  "busy_times",
  "social",
  "photos",
  "insights",
  "brief",
] as const

/** Operator-facing names. Never the internal pipeline id. */
export const PIPELINE_LABELS: Record<string, string> = {
  starter: "Your first insight",
  content: "Menus & websites",
  visibility: "Local search",
  events: "Local events",
  weather: "Weather",
  busy_times: "Foot traffic",
  social: "Social media",
  photos: "Photos",
  insights: "First signals",
  brief: "Your full brief",
}

export type FirstRunJob = { pipeline: string; status: string }

/** Elapsed as m:ss, or h:mm:ss once a run passes an hour (they do, when something is wedged). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`
}

/**
 * Total elapsed time for a run, ticking every second.
 *
 * ALT-660: pass the server's `runStartedAt` and the clock is continuous across the onboarding
 * screen and /home. Falls back to mount time only when the run start is not known yet (the first
 * poll has not returned), which is the honest degradation: a slightly short number beats a wrong
 * one, and it corrects itself on the next tick.
 */
export function useRunElapsed(runStartedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now())
  const [mountedAt] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const startMs = runStartedAt ? new Date(runStartedAt).getTime() : mountedAt
  return Math.max(0, now - (Number.isFinite(startMs) ? startMs : mountedAt))
}

/** Row state derived from the job status, plus the word shown beside it. */
function rowState(status: string | undefined, jobsKnown: boolean) {
  if (status === "done") return { cls: "is-ready", word: "Ready" }
  if (status === "running") return { cls: "is-doing", word: "In progress" }
  if (status === "failed") return { cls: "is-failed", word: "Hit a snag" }
  // ALT-655: never render a whole list of "Queued" with nothing shown as working. Before the first
  // poll returns we genuinely do not know, so say "Starting" rather than implying a stalled queue.
  return { cls: "is-queued", word: jobsKnown ? "Queued" : "Starting" }
}

export default function FirstRunProgress({
  jobs,
  runStartedAt,
  emailPromise = true,
}: {
  /** null until the first poll returns. */
  jobs: FirstRunJob[] | null
  /** ISO timestamp of the earliest job in this run, from GET /api/onboarding/progress. */
  runStartedAt: string | null
  /** Whether to promise the ready-email. True on both live surfaces; here so a preview can drop it. */
  emailPromise?: boolean
}) {
  const elapsedMs = useRunElapsed(runStartedAt)
  const statusByPipeline = new Map((jobs ?? []).map((j) => [j.pipeline, j.status]))
  const jobsKnown = jobs !== null && jobs.length > 0
  const allDone = jobsKnown && jobs.every((j) => j.status === "done")

  const stillWorking = allDone
    ? "Everything has landed."
    : emailPromise
      ? "Still working. You can close this tab, and we'll email you the moment your brief is ready."
      : "Still working."

  return (
    <div className="frp">
      {/* ── TOP: the busy signal and the clock, the two things worth seeing first ── */}
      <div className="frp-top">
        {!allDone ? (
          // Three dots, each riding its own phase of a slow travelling wave. Three real elements,
          // not two pseudo-elements plus a box-shadow: a shadow moves with its owner, which defeats
          // the independent phase that makes this read as a wave instead of a blink.
          <span className="frp-glyph" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : null}
        <span className="frp-elapsed">
          Elapsed <span className="tk-mono">{formatElapsed(elapsedMs)}</span>
        </span>
      </div>
      <p className="frp-still frp-still--top" aria-live="polite">
        {stillWorking}
      </p>

      <ul className="frp-list" aria-label="First brief progress">
        {PIPELINE_ORDER.map((pipeline) => {
          const { cls, word } = rowState(statusByPipeline.get(pipeline), jobsKnown)
          return (
            <li className={`frp-row ${cls}`} key={pipeline}>
              <span className="frp-mark" aria-hidden="true" />
              <span className="frp-label">{PIPELINE_LABELS[pipeline]}</span>
              <span className="frp-when">{word}</span>
            </li>
          )
        })}
      </ul>

      {/* ── BOTTOM: repeated on purpose. You had to scroll to learn we were still going. ── */}
      <p className="frp-still frp-still--bottom">{stillWorking}</p>
    </div>
  )
}
