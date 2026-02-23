"use client"

import { useRouter } from "next/navigation"
import { useEffect, useCallback, useRef } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import { useJobRunner } from "@/lib/jobs/use-job-runner"
import type { JobType, AmbientCard } from "@/lib/jobs/types"
import JobPipelineView from "./job-pipeline-view"
import AmbientInsightFeed from "./ambient-insight-feed"

type Props = {
  type: JobType
  locationId: string
  label: string
  pendingLabel?: string
  quickFacts?: AmbientCard[]
  className?: string
  disabled?: boolean
}

const TYPE_LABELS: Record<string, string> = {
  content: "Content refresh",
  visibility: "SEO refresh",
  events: "Events refresh",
  insights: "Insights generation",
}

export default function JobRefreshButton({
  type,
  locationId,
  label,
  pendingLabel,
  quickFacts = [],
  className,
  disabled,
}: Props) {
  const router = useRouter()
  const job = useJobRunner(type)
  const reconnectRef = useRef(job.reconnect)
  useEffect(() => { reconnectRef.current = job.reconnect }, [job.reconnect])
  const setCheckingRef = useRef(job.setChecking)
  useEffect(() => { setCheckingRef.current = job.setChecking }, [job.setChecking])
  const resetRef = useRef(job.reset)
  useEffect(() => { resetRef.current = job.reset }, [job.reset])
  const checkedKeyRef = useRef<string | null>(null)
  const prevStatusRef = useRef(job.status)

  // Check for running or recently-completed jobs when type or locationId changes.
  useEffect(() => {
    const key = `${type}::${locationId}`
    if (checkedKeyRef.current === key) return
    checkedKeyRef.current = key
    setCheckingRef.current()

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/jobs/active?include_recent=true", {
          cache: "no-store",
        })
        if (!res.ok || cancelled) {
          if (!cancelled) resetRef.current()
          return
        }
        const data = await res.json()
        if (cancelled) return
        const jobs = (Array.isArray(data) ? data : []) as Array<{
          id: string
          job_type: string
          location_id: string
          status: string
          result?: { redirectUrl?: string; warnings?: string[] } | null
          steps?: Array<{ name: string; label: string; status: string }>
        }>

        const match = jobs.find(
          (j) => j.job_type === type && j.location_id === locationId
        )

        if (!match) {
          resetRef.current()
          return
        }

        if (match.status === "running") {
          reconnectRef.current(match.id, locationId)
        } else if (match.status === "completed") {
          toast.success(`${TYPE_LABELS[type] ?? "Job"} completed`, {
            description: "Your data has been refreshed.",
          })
          router.refresh()
          resetRef.current()
        } else if (match.status === "failed") {
          toast.error(`${TYPE_LABELS[type] ?? "Job"} failed`, {
            description: "Some steps encountered errors.",
          })
          resetRef.current()
        }
      } catch {
        resetRef.current()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [type, locationId, router])

  // Toast on status transitions (same-page completion)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = job.status

    if (prev === "running" && job.status === "complete") {
      toast.success(`${TYPE_LABELS[type] ?? "Job"} completed`, {
        description:
          job.warnings.length > 0
            ? `Done with ${job.warnings.length} warning(s).`
            : "Your data has been refreshed.",
      })
    } else if (prev === "running" && job.status === "failed") {
      toast.error(`${TYPE_LABELS[type] ?? "Job"} failed`, {
        description: job.errorMessage ?? "Some steps encountered errors.",
      })
    }
  }, [job.status, job.warnings, job.errorMessage, type])

  const handleClick = useCallback(() => {
    if (job.status === "running") return
    job.start({ location_id: locationId })
  }, [job, locationId])

  // Auto-refresh page when job completes via SSE
  useEffect(() => {
    if (job.status === "complete" && job.redirectUrl) {
      const timer = setTimeout(() => {
        router.push(job.redirectUrl!)
        job.reset()
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [job.status, job.redirectUrl, router, job])

  const allCards = [...quickFacts, ...job.ambientCards]

  if (job.status === "idle" || job.status === "checking") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed ${className ?? ""}`}
      >
        {label}
      </button>
    )
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="pipeline"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.35 }}
        className="w-full rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/80 p-5 shadow-lg"
      >
        {/* Completion banner */}
        {job.status === "complete" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">
              Done! Refreshing page...
              {job.warnings.length > 0 && (
                <span className="ml-1 font-normal text-emerald-600">
                  ({job.warnings.length} warning{job.warnings.length !== 1 && "s"})
                </span>
              )}
            </span>
          </motion.div>
        )}

        {/* Failure banner */}
        {job.status === "failed" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-4 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">
                {job.errorMessage ?? "Something went wrong."}
                {!job.errorMessage && job.warnings.length > 0 &&
                  ` ${job.warnings.length} issue(s) encountered.`}
              </span>
            </div>
            <button
              onClick={() => job.reset()}
              className="rounded-lg bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
            >
              Dismiss
            </button>
          </motion.div>
        )}

        {/* Main layout: Pipeline + Ambient Feed */}
        {job.status === "running" && (
          <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
            <div className="min-w-0 flex-1">
              <JobPipelineView
                steps={job.steps}
                progress={job.progress}
                elapsed={job.elapsed}
                pendingLabel={pendingLabel}
              />
            </div>

            {allCards.length > 0 && (
              <div className="w-full lg:w-[280px]">
                <AmbientInsightFeed cards={allCards} />
              </div>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
