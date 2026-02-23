// ---------------------------------------------------------------------------
// GET /api/jobs/stream/[jobId] – reconnectable SSE stream for an existing job
// Reads current state from DB, then polls until complete
// ---------------------------------------------------------------------------

import { getJobAuthContext } from "@/lib/jobs/auth"
import { getJob } from "@/lib/jobs/manager"
import { createSSEStream, sseResponse } from "@/lib/jobs/sse"

export const maxDuration = 300

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  const auth = await getJobAuthContext()
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const job = await getJob(jobId)
  if (!job || job.organization_id !== auth.organizationId) {
    return Response.json({ error: "Job not found" }, { status: 404 })
  }

  const { stream, controller } = createSSEStream()

  ;(async () => {
    try {
      // Send current state
      controller.send("init", {
        jobId: job.id,
        steps: job.steps,
      })

      // Send current progress for each completed step
      for (let i = 0; i < job.steps.length; i++) {
        const step = job.steps[i]
        if (step.status !== "queued") {
          controller.send("step", {
            jobId: job.id,
            stepIndex: i,
            step,
            progress: Math.round(
              ((i + (step.status === "running" ? 0 : 1)) / job.total_steps) *
                100
            ),
          })
        }
      }

      // If already complete, send done immediately
      if (job.status === "completed" || job.status === "failed") {
        const result = job.result ?? {}
        controller.send("done", {
          jobId: job.id,
          status: job.status,
          warnings: (result as Record<string, unknown>).warnings ?? [],
          redirectUrl:
            (result as Record<string, unknown>).redirectUrl ?? "",
        })
        controller.close()
        return
      }

      // Poll for updates every 2 seconds
      let lastStep = job.current_step
      const maxPolls = 300 // 10 min max
      for (let poll = 0; poll < maxPolls; poll++) {
        await new Promise((r) => setTimeout(r, 2000))

        const updated = await getJob(jobId)
        if (!updated) break

        // Send any new step updates
        if (updated.current_step > lastStep) {
          for (let i = lastStep; i < updated.steps.length; i++) {
            const step = updated.steps[i]
            if (step.status !== "queued") {
              controller.send("step", {
                jobId: updated.id,
                stepIndex: i,
                step,
                progress: Math.round(
                  ((i + (step.status === "running" ? 0 : 1)) /
                    updated.total_steps) *
                    100
                ),
              })
            }
          }
          lastStep = updated.current_step
        }

        if (
          updated.status === "completed" ||
          updated.status === "failed"
        ) {
          const result = updated.result ?? {}
          controller.send("done", {
            jobId: updated.id,
            status: updated.status,
            warnings:
              (result as Record<string, unknown>).warnings ?? [],
            redirectUrl:
              (result as Record<string, unknown>).redirectUrl ?? "",
          })
          break
        }
      }
    } catch {
      // Connection closed by client
    }

    controller.close()
  })()

  return sseResponse(stream)
}
