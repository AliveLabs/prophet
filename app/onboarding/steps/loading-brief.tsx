"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { completeOnboardingAction } from "../actions"
import type { OnboardingCandidate } from "../onboarding-wizard"

const LOADING_PHASES = [
  { label: "Creating your workspace", duration: 1200 },
  { label: "Approving competitor profiles", duration: 2000 },
  { label: "Configuring intelligence feeds", duration: 1500 },
  { label: "Starting background enrichment", duration: 1800 },
  { label: "Generating your first brief", duration: 2500 },
]

type LoadingBriefStepProps = {
  orgId: string
  locationId: string
  selectedCompetitorIds: string[]
  competitors: OnboardingCandidate[]
  monitoringPrefs: Record<string, boolean>
  businessName: string
  brandName?: string
}

export default function LoadingBriefStep({
  orgId,
  locationId,
  selectedCompetitorIds,
  competitors,
  monitoringPrefs,
  businessName,
  brandName = "Ticket",
}: LoadingBriefStepProps) {
  const router = useRouter()
  const [phase, setPhase] = useState(0)
  const [actionDone, setActionDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  // Run the server action once on mount
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function run() {
      const result = await completeOnboardingAction({
        orgId,
        locationId,
        competitorIds: selectedCompetitorIds,
        monitoringPrefs,
      })
      if (!result.ok) {
        setError(result.error)
      }
      setActionDone(true)
    }
    run()
  }, [orgId, locationId, selectedCompetitorIds, monitoringPrefs])

  // Progress through visual phases
  useEffect(() => {
    if (phase >= LOADING_PHASES.length) return
    const timer = setTimeout(() => {
      setPhase((p) => p + 1)
    }, LOADING_PHASES[phase].duration)
    return () => clearTimeout(timer)
  }, [phase])

  const allDone = actionDone && phase >= LOADING_PHASES.length

  const selectedNames = selectedCompetitorIds
    .map((id) => competitors.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .slice(0, 3)

  const enabledPrefs = Object.entries(monitoringPrefs)
    .filter(([, v]) => v)
    .map(([k]) =>
      k
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    )

  return (
    <section className="flex flex-col items-center pt-16 pb-8 max-[540px]:pt-12">
      {!allDone && !error && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-precision-teal mb-6">
            Setting Up
          </div>
          <h2 className="font-display text-[28px] font-medium leading-[1.15] text-foreground text-center mb-8 max-[540px]:text-[24px]">
            Preparing your
            <br />
            <em className="text-vatic-indigo-soft italic">intelligence hub</em>
          </h2>

          {/* Phase list */}
          <div className="flex flex-col gap-4 w-full max-w-[360px]">
            {LOADING_PHASES.map((p, i) => {
              const isDone = i < phase
              const isCurrent = i === phase
              return (
                <div key={p.label} className="flex items-center gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                    {isDone ? (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                        fill="none"
                      >
                        <circle
                          cx="9"
                          cy="9"
                          r="8"
                          fill="var(--vatic-indigo)"
                          opacity="0.15"
                        />
                        <path
                          d="M5.5 9.5L7.5 11.5L12.5 6.5"
                          stroke="var(--vatic-indigo)"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : isCurrent ? (
                      <div className="h-2 w-2 rounded-full bg-vatic-indigo ob-live-dot" />
                    ) : (
                      <div className="h-1.5 w-1.5 rounded-full bg-border" />
                    )}
                  </div>
                  <span
                    className={`text-sm transition-colors ${
                      isDone
                        ? "text-muted-foreground"
                        : isCurrent
                          ? "text-foreground font-medium"
                          : "text-muted-foreground/50"
                    }`}
                  >
                    {p.label}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Error state */}
      {error && (
        <div className="text-center max-w-[400px]">
          <h2 className="font-display text-2xl font-medium text-foreground mb-3">
            Something went wrong
          </h2>
          <p className="text-sm text-destructive mb-6">{error}</p>
          <button
            type="button"
            onClick={() => router.push("/home")}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
          >
            Go to Dashboard
          </button>
        </div>
      )}

      {/* Done state — mini brief */}
      {allDone && !error && (
        <div className="w-full text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-precision-teal mb-4">
            Ready
          </div>
          <h2 className="font-display text-[32px] font-medium leading-[1.15] text-foreground mb-3 max-[540px]:text-[27px]">
            Welcome to {brandName},
            <br />
            <em className="text-vatic-indigo-soft italic">{businessName || "Chef"}</em>
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-[380px] mx-auto">
            Your intelligence hub is ready. Here&apos;s a quick summary of
            what we&apos;re watching.
          </p>

          {/* Brief cards */}
          <div className="flex flex-col gap-3 mb-8 text-left">
            {selectedNames.length > 0 && (
              <div className="rounded-[10px] border border-border/60 bg-card/30 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Competitors
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedNames.map((name) => (
                    <span
                      key={name}
                      className="rounded-full bg-vatic-indigo/10 px-3 py-1.5 text-xs font-medium text-vatic-indigo-soft"
                    >
                      {name}
                    </span>
                  ))}
                  {selectedCompetitorIds.length > 3 && (
                    <span className="rounded-full bg-border/40 px-3 py-1.5 text-xs text-muted-foreground">
                      +{selectedCompetitorIds.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            )}
            {enabledPrefs.length > 0 && (
              <div className="rounded-[10px] border border-border/60 bg-card/30 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Monitoring
                </div>
                <div className="flex flex-wrap gap-2">
                  {enabledPrefs.map((p) => (
                    <span
                      key={p}
                      className="rounded-full bg-precision-teal/10 px-3 py-1.5 text-xs font-medium text-precision-teal"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => router.push("/home")}
            className="inline-flex items-center gap-2 rounded-[14px] bg-primary px-10 py-4 text-[15px] font-semibold text-primary-foreground shadow-sm transition-all hover:bg-deep-indigo hover:-translate-y-px hover:shadow-glow-indigo-sm"
          >
            Go to my Dashboard
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </section>
  )
}
