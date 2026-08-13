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
// Labels/order mirror the onboarding Build step (onboarding-wizard-pass.tsx); kept local so
// /home doesn't import the onboarding wizard.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import FirstRunSignals from "@/components/first-run/first-run-signals"
import StarterInsightCard from "./starter-insight-card"
import type { FirstRunSignal } from "@/lib/onboarding/first-run-signals"
import type { EnrichedRecommendation } from "@/lib/skills/types"

const PIPELINE_ORDER = [
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

const PIPELINE_LABELS: Record<string, string> = {
  starter: "Your first insight",
  content: "Menus & websites",
  visibility: "Search visibility",
  events: "Local events",
  weather: "Weather",
  busy_times: "Foot traffic",
  social: "Social media",
  photos: "Photos",
  insights: "First signals",
  brief: "Your full brief",
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

type Job = { pipeline: string; status: string }
type Starter = { play: EnrichedRecommendation; generatedAt: string }

/** Bound on fast-path invocations from one mounted panel. Each call runs to its own wall-clock
 *  budget, so this is a stop, not a schedule: a location that still is not done after this many
 *  is a case for the cron worker and the alerting, not for a browser tab hammering the route. */
const MAX_KICKS = 8

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
  const [starter, setStarter] = useState<Starter | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const refreshedRef = useRef(false)

  // Elapsed clock — honest expectations beat a spinner on a loop.
  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => clearInterval(t)
  }, [])

  // Kick the first-run fast path. Idempotent and first-run-only server side (it refuses a
  // location that already has a brief), and each call claims jobs atomically, so a second tab
  // doing the same thing cannot double-run anything.
  useEffect(() => {
    let cancelled = false
    async function kick() {
      for (let i = 0; i < MAX_KICKS && !cancelled; i++) {
        try {
          const res = await fetch("/api/onboarding/first-run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ location_id: locationId }),
          })
          const data = await res.json()
          if (cancelled || !data?.ok || data.moreWork !== true) return
        } catch {
          return // the cron worker still drains this location; don't retry-storm
        }
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
        if (data.starter) setStarter(data.starter as Starter)
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

        {signals.length > 0 ? <FirstRunSignals signals={signals} /> : null}

        {starter ? (
          <div className="fr-starter">
            <StarterInsightCard play={starter.play} todayKey={starter.generatedAt.slice(0, 10)} />
          </div>
        ) : null}

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

        {/* No wall-clock promise. The old copy said "within ten minutes", which the queue could
            not keep on a busy market, and a missed promise costs more than a vague one. */}
        <p className="fr-hint" aria-live="polite">
          Your first insight lands in a few minutes. The full brief takes longer, and you can close
          this tab: we&apos;ll email you the moment it&apos;s ready.
        </p>
        <p className="fr-elapsed">
          Elapsed <span className="tk-mono">{formatElapsed(elapsedMs)}</span>
        </p>
      </div>
    </div>
  )
}
