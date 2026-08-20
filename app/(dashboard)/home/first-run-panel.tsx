"use client"

// ALT-301: the /home FIRST-RUN state. A freshly-onboarded (or freshly-set-up demo) org lands
// here while the first pipeline run is still building the first brief. Instead of a bare
// "getting your market read" shimmer, show honest, live per-pipeline progress (the same feed
// the onboarding Build step polls), lead with what's ALREADY real (the competitor set we're
// watching), and auto-swap into the real brief the moment it lands — no manual reload.
//
// Beta rescue 3.1: the panel now shows VALUE as it lands, not just row statuses. The progressive
// signals (who we watch near you, what is on near you, whether you show up in local search) and
// the starter insight both come from the same GET /api/onboarding/progress poll the onboarding
// Build step uses, so the two screens cannot tell different stories. It also KICKS the first-run
// fast path, so a location that landed here without one (an interrupted signup, a demo set up by
// an admin) is drained now rather than on the next */5 cron tick.
//
// ALT-660: the pipeline rows, the elapsed clock and the "still working" line now come from the
// SHARED components/first-run/first-run-progress.tsx. They used to be duplicated here, with a
// comment admitting it ("labels/order mirror the onboarding Build step; kept local so /home doesn't
// import the onboarding wizard"), and the two copies had already drifted. The shared component is
// not the onboarding wizard, so the reason for the duplication is gone.
//
// Three behaviour changes in the same ticket:
//   - The clock is TOTAL run time from the server (`runStartedAt`), not time since this component
//     mounted. Continuing from onboarding to /home used to reset it to 0:00 and tell an operator who
//     had waited ten minutes that they had waited none.
//   - The starter insight no longer renders. Bryan, 2026-08-18: it is out of context, the first
//     insight is not necessarily a strong one, "and it IS the first impression that we don't get
//     back". Held until the full brief can carry it.
//   - The CTA carries the clock while incomplete and becomes "Read your brief" when it is not. The
//     panel still auto-swaps on its own; the button is for the operator who is watching.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import FirstRunSignals from "@/components/first-run/first-run-signals"
import FirstRunProgress, {
  formatElapsed,
  useRunElapsed,
  type FirstRunJob,
} from "@/components/first-run/first-run-progress"
import type { FirstRunSignal } from "@/lib/onboarding/first-run-signals"

type Job = FirstRunJob

/** How long one mounted panel keeps re-invoking the fast path. A stop, not a schedule: a location
 *  still unfinished after this is a case for the cron worker and the alerting, not a browser tab.
 *
 *  ALT-655 / ALT-661: this was `MAX_KICKS = 8`, a cap on the NUMBER of calls, and the loop had no
 *  delay between them. A drain call returns as soon as nothing is runnable, which happens routinely
 *  and cheaply: the first-run insights job defers while its data pulls are still going, so the call
 *  claims it, defers it, finds nothing else, and returns `moreWork: true` in a few hundred
 *  milliseconds. With no delay, eight such no-op calls burned the entire budget in a couple of
 *  seconds, after which the panel never invoked again and the rest of the run fell back to the
 *  five-minute worker cron. A wall-clock bound with a real gap between attempts cannot be spent
 *  that way. */
const KICK_WINDOW_MS = 25 * 60 * 1000

/** Wait between fast-path invocations. Long enough that a no-op call cannot spin, far shorter than
 *  the five-minute cron it exists to beat. */
const KICK_INTERVAL_MS = 6_000

export default function FirstRunPanel({
  locationId,
  city,
  competitorCount,
}: {
  locationId: string
  city: string | null
  competitorCount: number
}) {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [signals, setSignals] = useState<FirstRunSignal[]>([])
  // ALT-660: run start comes from the server so the clock is continuous across onboarding and here.
  const [runStartedAt, setRunStartedAt] = useState<string | null>(null)
  const refreshedRef = useRef(false)
  const elapsedMs = useRunElapsed(runStartedAt)

  // Kick the first-run fast path. Idempotent and first-run-only server side (it refuses a
  // location that already has a brief), and each call claims jobs atomically, so a second tab
  // doing the same thing cannot double-run anything.
  //
  // ALT-655 / ALT-661: keep invoking for a WALL-CLOCK window with a real gap between attempts,
  // rather than counting calls. Two jobs in a first run can only start as the FIRST job of an
  // invocation, so they structurally require a fresh call rather than more time in the current one:
  //   - `insights` (estimate 350s) may not start more than 6 minutes into a call, and the data
  //     pulls it waits for routinely finish later than that.
  //   - `brief` (estimate 780s) can never start mid-call at all: 800s budget minus a 90s margin
  //     leaves less than its estimate from the very first second.
  // So after each of those, SOMETHING has to invoke again. When this loop gave up early, that
  // something was the `*/5` cron, which is where Jersey Mike's 2.9 and 1.4 minute idle gaps came
  // from: 4.3 of a 21.2 minute first run spent waiting rather than working.
  useEffect(() => {
    let cancelled = false
    const until = Date.now() + KICK_WINDOW_MS
    async function kick() {
      while (!cancelled && Date.now() < until) {
        try {
          const res = await fetch("/api/onboarding/first-run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ location_id: locationId }),
          })
          const data = await res.json()
          if (cancelled) return
          // moreWork false means done (or already briefed, or the fleet cap halted it) — stop.
          if (!data?.ok || data.moreWork !== true) return
        } catch {
          return // the cron worker still drains this location; don't retry-storm
        }
        // Always pause, even after a productive call: a drain call is expensive and the point is to
        // beat a 5-minute cron, not to hold a request open continuously.
        await new Promise((r) => setTimeout(r, KICK_INTERVAL_MS))
      }
    }
    void kick()
    return () => {
      cancelled = true
    }
  }, [locationId])

  // Poll real job statuses every ~4s. When the brief pipeline finishes, the daily_briefs row
  // now exists, so refresh the server component once — it re-renders as the real BriefView and
  // this panel unmounts. Stops after 2h so an abandoned tab never polls forever.
  useEffect(() => {
    let cancelled = false
    const pollUntil = Date.now() + 2 * 60 * 60 * 1000
    // eslint-disable-next-line prefer-const -- timer is referenced in poll() before assignment; const would cause a TDZ/use-before-define error
    let timer: ReturnType<typeof setInterval> | undefined
    async function poll() {
      if (Date.now() > pollUntil) {
        if (timer) clearInterval(timer)
        return
      }
      try {
        const res = await fetch(`/api/onboarding/progress?location_id=${encodeURIComponent(locationId)}`)
        const data = await res.json()
        if (cancelled || !data.ok || !Array.isArray(data.jobs)) return
        setJobs(data.jobs as Job[])
        if (Array.isArray(data.signals)) setSignals(data.signals as FirstRunSignal[])
        if (typeof data.runStartedAt === "string") setRunStartedAt(data.runStartedAt)
        const brief = (data.jobs as Job[]).find((j) => j.pipeline === "brief")
        if (brief?.status === "done" && !refreshedRef.current) {
          refreshedRef.current = true
          if (timer) clearInterval(timer)
          router.refresh()
        }
      } catch {
        // transient — next tick retries
      }
    }
    void poll()
    timer = setInterval(poll, 4000)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [locationId, router])

  const allDone = jobs !== null && jobs.length > 0 && jobs.every((j) => j.status === "done")

  // Plain JS string rendered via {readyFact} below — React escapes it, so a normal apostrophe
  // is correct here (no JSX-text entity, and nothing dangerouslySet).
  const readyFact =
    competitorCount > 0
      ? `We're already watching ${competitorCount} competitor${competitorCount === 1 ? "" : "s"}${city ? ` near ${city}` : ""} while your first brief builds.`
      : "We're pulling your market together for the first time."

  return (
    <div className="ticket-brief">
      <div className="fr-panel">
        <span className="fr-kicker">Your Brief</span>
        <h1 className="fr-head">Building your first read.</h1>
        <p className="fr-sub">{readyFact}</p>
        {/* ALT-661 — SET THE EXPECTATION, do not promise a duration.
            No number here on purpose. We do not have a measured first-run time on the current
            system: every figure we had (21.2, 22.3, 23.6 min) predates the #242 deferral fix, and
            the older ones predate the token and read reductions too. A specific promise we cannot
            stand behind is worse than none.
            But saying nothing is also wrong: a silent several-minute wait reads as a hang, and the
            operator closes the tab. So this says it will take a while and points at the two things
            that prove it is alive, the elapsed clock and the per-pipeline rows below. */}
        <p className="fr-sub">
          This takes a while the first time. We read your whole market before we say anything, and
          you can watch each part land below. Leave it open and this page turns into your brief on
          its own.
        </p>

        {signals.length > 0 ? <FirstRunSignals signals={signals} /> : null}

        {/* ALT-660: no insight renders here in ANY state. Bryan, 2026-08-18: out of context, the
            first insight is not necessarily a strong one, "and it IS the first impression that we
            don't get back". It waits for the full brief. */}

        <FirstRunProgress jobs={jobs} runStartedAt={runStartedAt} />

        {/* The panel auto-swaps into the real brief when the poll sees the brief job done, so this
            button is for the operator who is sitting here watching. Disabled state carries the
            clock; enabled state is the only way in, and it only exists once there IS a brief. */}
        {allDone ? (
          <button type="button" className="fr-cta" onClick={() => router.refresh()}>
            Read your brief
          </button>
        ) : (
          <button type="button" className="fr-cta" disabled aria-live="polite">
            Building your brief
            <span className="tk-mono fr-cta-clock">{formatElapsed(elapsedMs)}</span>
          </button>
        )}
      </div>
    </div>
  )
}
