"use client"

// ALT-301: the /home FIRST-RUN state. A freshly-onboarded (or freshly-set-up demo) org lands
// here while the first pipeline run is still building the first brief. Instead of a bare
// "getting your market read" shimmer, show honest, live per-pipeline progress (the same feed
// the onboarding Build step polls), lead with what's ALREADY real (the competitor set we're
// watching), and auto-swap into the real brief the moment it lands — no manual reload.
//
// Labels/order mirror the onboarding Build step (onboarding-wizard-pass.tsx); kept local so
// /home doesn't import the onboarding wizard. Progress feed: GET /api/onboarding/progress.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

const PIPELINE_ORDER = [
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

const PIPELINE_LABELS: Record<string, string> = {
  content: "Menus & websites",
  visibility: "Search visibility",
  events: "Local events",
  weather: "Weather",
  busy_times: "Foot traffic",
  social: "Social media",
  photos: "Photos",
  insights: "First signals",
  brief: "Your first brief",
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

type Job = { pipeline: string; status: string }

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
  const [elapsedMs, setElapsedMs] = useState(0)
  const refreshedRef = useRef(false)

  // Elapsed clock — honest expectations beat a spinner on a loop.
  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => clearInterval(t)
  }, [])

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

  const statusByPipeline = new Map((jobs ?? []).map((j) => [j.pipeline, j.status]))
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

        <ul className="fr-status" aria-label="First brief progress">
          {PIPELINE_ORDER.map((pipeline) => {
            const status = statusByPipeline.get(pipeline) ?? "queued"
            const cls =
              status === "done"
                ? "is-ready"
                : status === "running"
                  ? "is-doing"
                  : status === "failed"
                    ? "is-failed"
                    : "is-queued"
            const when =
              status === "done"
                ? "Ready"
                : status === "running"
                  ? "In progress"
                  : status === "failed"
                    ? "Hit a snag"
                    : jobs === null || jobs.length === 0
                      ? "Starting"
                      : "Queued"
            return (
              <li className={`fr-row ${cls}`} key={pipeline}>
                <span className="fr-mark" aria-hidden="true" />
                <span className="fr-label">{PIPELINE_LABELS[pipeline]}</span>
                <span className="fr-when">{when}</span>
              </li>
            )
          })}
        </ul>

        {!allDone ? <div className="fr-sweep" aria-hidden="true" /> : null}

        <p className="fr-hint" aria-live="polite">
          Your first brief usually lands within ten minutes. You can close this tab, and
          we&apos;ll email you the moment it&apos;s ready.
        </p>
        <p className="fr-elapsed">
          Elapsed <span className="tk-mono">{formatElapsed(elapsedMs)}</span>
        </p>
      </div>
    </div>
  )
}
