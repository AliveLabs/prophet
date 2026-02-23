// ---------------------------------------------------------------------------
// Generic Pipeline Runner
// Executes steps sequentially, reports progress via callbacks, isolates errors
// ---------------------------------------------------------------------------

import type { PipelineStepDef, JobStep, StepStatus } from "./types"
import { updateJobStep, completeJob, failJob } from "./manager"
import type { SSEController } from "./sse"

export type PipelineProgress = {
  stepIndex: number
  step: JobStep
  progress: number
}

export type PipelineResult = {
  warnings: string[]
  stepResults: (Record<string, unknown> | null)[]
}

type PipelineOptions<TCtx> = {
  jobId: string
  steps: PipelineStepDef<TCtx>[]
  ctx: TCtx
  sse?: SSEController
  redirectUrl: string
}

const isEphemeral = (id: string) => id.startsWith("ephemeral-")

async function safeDbUpdate(
  jobId: string,
  fn: () => Promise<void>
): Promise<void> {
  if (isEphemeral(jobId)) return
  try {
    await fn()
  } catch (e) {
    console.warn("[Pipeline] DB write failed (non-fatal):", e)
  }
}

export async function runPipeline<TCtx>(
  opts: PipelineOptions<TCtx>
): Promise<PipelineResult> {
  const { jobId, steps, ctx, sse, redirectUrl } = opts
  const warnings: string[] = []
  const stepResults: (Record<string, unknown> | null)[] = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const progress = Math.round((i / steps.length) * 100)

    const runningStep: JobStep = {
      name: step.name,
      label: step.label,
      status: "running",
      startedAt: new Date().toISOString(),
    }

    sse?.send("step", { jobId, stepIndex: i, step: runningStep, progress })
    await safeDbUpdate(jobId, () =>
      updateJobStep(jobId, i, "running" as StepStatus)
    )

    try {
      const preview = await step.run(ctx)
      stepResults.push(preview)

      const completeStep: JobStep = {
        name: step.name,
        label: step.label,
        status: "complete",
        preview: preview ?? undefined,
        startedAt: runningStep.startedAt,
        completedAt: new Date().toISOString(),
      }

      const newProgress = Math.round(((i + 1) / steps.length) * 100)
      sse?.send("step", {
        jobId,
        stepIndex: i,
        step: completeStep,
        progress: newProgress,
      })
      await safeDbUpdate(jobId, () =>
        updateJobStep(
          jobId,
          i,
          "complete" as StepStatus,
          preview ?? undefined
        )
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error"
      warnings.push(`${step.label}: ${errMsg}`)
      stepResults.push(null)

      const failedStep: JobStep = {
        name: step.name,
        label: step.label,
        status: "failed",
        error: errMsg,
        startedAt: runningStep.startedAt,
        completedAt: new Date().toISOString(),
      }

      const newProgress = Math.round(((i + 1) / steps.length) * 100)
      sse?.send("step", {
        jobId,
        stepIndex: i,
        step: failedStep,
        progress: newProgress,
      })
      await safeDbUpdate(jobId, () =>
        updateJobStep(jobId, i, "failed" as StepStatus, undefined, errMsg)
      )
    }
  }

  const resultPayload = { warnings, redirectUrl }

  if (warnings.length > steps.length / 2) {
    await safeDbUpdate(jobId, () =>
      failJob(jobId, `Too many failures (${warnings.length}/${steps.length})`)
    )
    sse?.send("done", {
      jobId,
      status: "failed",
      warnings,
      redirectUrl,
    })
  } else {
    await safeDbUpdate(jobId, () => completeJob(jobId, resultPayload))
    sse?.send("done", {
      jobId,
      status: "completed",
      warnings,
      redirectUrl,
    })
  }

  sse?.close()
  return { warnings, stepResults }
}
