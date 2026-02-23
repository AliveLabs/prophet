"use client"

import { motion, AnimatePresence } from "framer-motion"
import type { JobStep } from "@/lib/jobs/types"

type Props = {
  steps: JobStep[]
  progress: number
  elapsed: number
  pendingLabel?: string
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function StepIcon({ status }: { status: JobStep["status"] }) {
  switch (status) {
    case "complete":
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )
    case "running":
      return (
        <div className="relative flex h-6 w-6 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-30" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-600" />
        </div>
      )
    case "failed":
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" />
          </svg>
        </div>
      )
    case "skipped":
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-white">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </div>
      )
    default:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-200 bg-white" />
      )
  }
}

function PreviewBadge({ preview }: { preview: Record<string, unknown> }) {
  const entries = Object.entries(preview).slice(0, 3)
  if (entries.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {entries.map(([key, val]) => (
        <span
          key={key}
          className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700"
        >
          {key}: {String(val)}
        </span>
      ))}
    </div>
  )
}

export default function JobPipelineView({
  steps,
  progress,
  elapsed,
  pendingLabel,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full"
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative flex h-5 w-5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-20" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-600" />
          </div>
          <span className="text-sm font-semibold text-slate-800">
            {pendingLabel ?? "Processing..."}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>{progress}%</span>
          <span className="tabular-nums">{formatElapsed(elapsed)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
          initial={{ width: "0%" }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Step list */}
      <div className="space-y-1">
        <AnimatePresence mode="sync">
          {steps.map((step, i) => (
            <motion.div
              key={step.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: i * 0.03 }}
              className={`flex items-start gap-3 rounded-lg px-3 py-2 transition-colors ${
                step.status === "running"
                  ? "bg-indigo-50/60"
                  : step.status === "failed"
                    ? "bg-amber-50/60"
                    : ""
              }`}
            >
              {/* Timeline connector */}
              <div className="flex flex-col items-center">
                <StepIcon status={step.status} />
                {i < steps.length - 1 && (
                  <div
                    className={`mt-1 h-4 w-px ${
                      step.status === "complete"
                        ? "bg-emerald-300"
                        : "bg-slate-200"
                    }`}
                  />
                )}
              </div>

              {/* Step content */}
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm leading-tight ${
                    step.status === "queued"
                      ? "text-slate-400"
                      : step.status === "running"
                        ? "font-medium text-indigo-700"
                        : step.status === "failed"
                          ? "text-amber-700"
                          : "text-slate-600"
                  }`}
                >
                  {step.label}
                </p>

                {step.status === "failed" && step.error && (
                  <p className="mt-0.5 text-[11px] text-amber-600">
                    {step.error}
                  </p>
                )}

                {step.status === "complete" && step.preview && (
                  <PreviewBadge preview={step.preview} />
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
