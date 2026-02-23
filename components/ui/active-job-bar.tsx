"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import type { JobRecord } from "@/lib/jobs/types"

const JOB_TYPE_LABELS: Record<string, { label: string; path: string }> = {
  content: { label: "Content refresh", path: "/content" },
  visibility: { label: "SEO refresh", path: "/visibility" },
  events: { label: "Events refresh", path: "/events" },
  insights: { label: "Insights generation", path: "/insights" },
}

const ACTIVE_POLL_MS = 3000
const IDLE_POLL_MS = 30000

export default function ActiveJobBar() {
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const pathname = usePathname()
  const router = useRouter()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const knownRunningRef = useRef<Set<string>>(new Set())
  const jobMetaMapRef = useRef<Map<string, { jobType: string; locationId: string }>>(new Map())
  const pathnameRef = useRef(pathname)
  useEffect(() => { pathnameRef.current = pathname }, [pathname])
  const routerRef = useRef(router)
  useEffect(() => { routerRef.current = router }, [router])

  const findJobMeta = useCallback((jobId: string) => {
    const info = jobMetaMapRef.current.get(jobId)
    if (!info) return null
    const labels = JOB_TYPE_LABELS[info.jobType]
    if (!labels) return null
    return { ...labels, locationId: info.locationId }
  }, [])

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch("/api/jobs/active", { cache: "no-store" })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as JobRecord[] | { jobs?: JobRecord[] }
        if (cancelled) return
        const list = Array.isArray(data) ? data : (data.jobs ?? [])

        const currentIds = new Set(list.map((j) => j.id))
        for (const prevId of knownRunningRef.current) {
          if (!currentIds.has(prevId)) {
            const meta = findJobMeta(prevId)
            if (meta) {
              // Only fire toast if user is NOT on the job's page
              // (the page's JobRefreshButton handles its own toast)
              if (pathnameRef.current !== meta.path) {
                const url = `${meta.path}?location_id=${meta.locationId}`
                toast.success(`${meta.label} completed`, {
                  description: "Your data has been refreshed.",
                  action: {
                    label: "View",
                    onClick: () => routerRef.current.push(url),
                  },
                })
              }
            }
          }
        }

        knownRunningRef.current = new Set(list.map((j) => j.id))
        for (const j of list) {
          jobMetaMapRef.current.set(j.id, {
            jobType: j.job_type,
            locationId: j.location_id,
          })
        }

        setJobs(list)
        reschedule(list.length > 0)
      } catch { /* ignore */ }
    }

    const reschedule = (hasJobs: boolean) => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(poll, hasJobs ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    }

    poll()
    reschedule(false)

    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [findJobMeta])

  const activeJob = jobs[0]

  if (activeJob) {
    const meta = JOB_TYPE_LABELS[activeJob.job_type]
    if (meta && pathname === meta.path) return null
  }

  if (!activeJob) return null

  const currentStep =
    activeJob.steps?.find((s) => s.status === "running") ??
    activeJob.steps?.filter((s) => s.status === "complete").pop()

  const progress = Math.round(
    (activeJob.current_step / Math.max(activeJob.total_steps, 1)) * 100
  )

  const meta = JOB_TYPE_LABELS[activeJob.job_type]

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -48, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed inset-x-0 top-0 z-50 flex items-center justify-center"
      >
        <div
          className="mx-auto mt-3 flex max-w-xl items-center gap-3 rounded-full border border-indigo-200/60 bg-white/90 px-4 py-2 shadow-lg backdrop-blur-md cursor-pointer"
          onClick={() => {
            if (meta?.path) {
              router.push(`${meta.path}?location_id=${activeJob.location_id}`)
            }
          }}
        >
          <div className="relative flex h-4 w-4 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-30" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-600" />
          </div>

          <span className="text-xs font-medium text-slate-700">
            {meta?.label ?? "Processing..."}
          </span>

          {currentStep && (
            <span className="text-xs text-slate-500">
              {currentStep.label}
            </span>
          )}

          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
            <motion.div
              className="h-full rounded-full bg-indigo-500"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>

          <span className="text-[10px] font-medium text-indigo-600">
            View &rarr;
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
