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
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-precision-teal text-white">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )
    case "running":
      return (
        <div className="relative flex h-6 w-6 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-30" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
        </div>
      )
    case "failed":
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-signal-gold text-white">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" />
          </svg>
        </div>
      )
    case "skipped":
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted-foreground text-white">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </div>
      )
    default:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-border bg-card" />
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
          className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
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
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-20" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground">
            {pendingLabel ?? "Processing..."}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{progress}%</span>
          <span className="tabular-nums">{formatElapsed(elapsed)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-precision-teal"
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
                  ? "bg-primary/10"
                  : step.status === "failed"
                    ? "bg-signal-gold/10"
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
                        ? "bg-precision-teal"
                        : "bg-border"
                    }`}
                  />
                )}
              </div>

              {/* Step content */}
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm leading-tight ${
                    step.status === "queued"
                      ? "text-muted-foreground"
                      : step.status === "running"
                        ? "font-medium text-primary"
                        : step.status === "failed"
                          ? "text-signal-gold"
                          : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </p>

                {step.status === "failed" && step.error && (
                  <p className="mt-0.5 text-[11px] text-signal-gold">
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
