"use client"

// ---------------------------------------------------------------------------
// useJobRunner – React hook for managing SSE job connections
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef, useEffect } from "react"
import type { JobStep, JobType, AmbientCard } from "./types"

export type JobRunnerStatus =
  | "idle"
  | "checking"
  | "running"
  | "complete"
  | "failed"

export type JobRunnerState = {
  status: JobRunnerStatus
  jobId: string | null
  steps: JobStep[]
  progress: number
  warnings: string[]
  errorMessage: string | null
  redirectUrl: string | null
  elapsed: number
  ambientCards: AmbientCard[]
}

type UseJobRunnerReturn = JobRunnerState & {
  start: (params: Record<string, string>) => void
  reconnect: (jobId: string, locationId?: string) => void
  setChecking: () => void
  reset: () => void
}

const INITIAL_STATE: JobRunnerState = {
  status: "idle",
  jobId: null,
  steps: [],
  progress: 0,
  warnings: [],
  errorMessage: null,
  redirectUrl: null,
  elapsed: 0,
  ambientCards: [],
}

export function useJobRunner(type: JobType): UseJobRunnerReturn {
  const [state, setState] = useState<JobRunnerState>(INITIAL_STATE)
  const esRef = useRef<EventSource | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const ambientEsRef = useRef<EventSource | null>(null)

  const cleanup = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    ambientEsRef.current?.close()
    ambientEsRef.current = null
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => cleanup, [cleanup])

  const startElapsedTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setState((s) => ({
        ...s,
        elapsed: Math.round((Date.now() - startTimeRef.current) / 1000),
      }))
    }, 1000)
  }, [])

  const connectAmbientFeed = useCallback((locationId: string) => {
    try {
      const url = `/api/jobs/ambient-feed?location_id=${locationId}`
      const es = new EventSource(url)
      ambientEsRef.current = es

      es.addEventListener("card", (e) => {
        try {
          const card = JSON.parse(e.data) as AmbientCard
          setState((s) => {
            const exists = s.ambientCards.some((c) => c.id === card.id)
            if (exists) return s
            return { ...s, ambientCards: [...s.ambientCards, card] }
          })
        } catch { /* ignore parse errors */ }
      })

      es.addEventListener("done", () => {
        es.close()
      })

      es.onerror = () => {
        es.close()
      }
    } catch { /* non-fatal */ }
  }, [])

  const connectSSE = useCallback(
    (url: string, locationId?: string) => {
      cleanup()
      startElapsedTimer()

      const es = new EventSource(url)
      esRef.current = es

      es.addEventListener("init", (e) => {
        try {
          const data = JSON.parse(e.data) as {
            jobId: string
            steps: JobStep[]
          }
          setState((s) => ({
            ...s,
            status: "running",
            jobId: data.jobId,
            steps: data.steps,
            progress: 0,
          }))
          if (locationId) connectAmbientFeed(locationId)
        } catch { /* ignore */ }
      })

      es.addEventListener("step", (e) => {
        try {
          const data = JSON.parse(e.data) as {
            jobId: string
            stepIndex: number
            step: JobStep
            progress: number
          }
          setState((s) => {
            const steps = [...s.steps]
            steps[data.stepIndex] = data.step
            return {
              ...s,
              jobId: data.jobId,
              steps,
              progress: data.progress,
            }
          })

          if (
            data.step.status === "complete" &&
            data.step.preview
          ) {
            const previewText = Object.entries(data.step.preview)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")
            if (previewText) {
              setState((s) => ({
                ...s,
                ambientCards: [
                  ...s.ambientCards,
                  {
                    id: `step-${data.stepIndex}`,
                    category: "step_result" as const,
                    text: `${data.step.label} — ${previewText}`,
                  },
                ],
              }))
            }
          }
        } catch { /* ignore */ }
      })

      es.addEventListener("done", (e) => {
        try {
          const data = JSON.parse(e.data) as {
            jobId: string
            status: "completed" | "failed"
            warnings: string[]
            redirectUrl: string
          }
          setState((s) => ({
            ...s,
            status: data.status === "completed" ? "complete" : "failed",
            progress: 100,
            warnings: data.warnings,
            redirectUrl: data.redirectUrl,
          }))
        } catch { /* ignore */ }
        cleanup()
      })

      es.addEventListener("error", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as {
            error: string
          }
          setState((s) => ({
            ...s,
            status: "failed",
            errorMessage: data.error,
          }))
        } catch {
          setState((s) => ({
            ...s,
            status: "failed",
            errorMessage: "Connection lost",
          }))
        }
        cleanup()
      })

      es.onerror = () => {
        if (esRef.current?.readyState === EventSource.CLOSED) {
          setState((prev) => {
            if (prev.status === "running" && prev.steps.length === 0) {
              return {
                ...prev,
                status: "failed",
                errorMessage: "Failed to connect to the server",
              }
            }
            return prev
          })
          cleanup()
        }
      }
    },
    [cleanup, startElapsedTimer, connectAmbientFeed]
  )

  const start = useCallback(
    (params: Record<string, string>) => {
      setState({
        ...INITIAL_STATE,
        status: "running",
      })

      const query = new URLSearchParams(params).toString()
      const url = `/api/jobs/${type}?${query}`
      connectSSE(url, params.location_id)
    },
    [type, connectSSE]
  )

  const reconnect = useCallback(
    (jobId: string, locationId?: string) => {
      setState({
        ...INITIAL_STATE,
        status: "running",
        jobId,
      })
      connectSSE(`/api/jobs/stream/${jobId}`, locationId)
    },
    [connectSSE]
  )

  const setChecking = useCallback(() => {
    setState((s) => (s.status === "idle" ? { ...s, status: "checking" } : s))
  }, [])

  const reset = useCallback(() => {
    cleanup()
    setState(INITIAL_STATE)
  }, [cleanup])

  return {
    ...state,
    start,
    reconnect,
    setChecking,
    reset,
  }
}
