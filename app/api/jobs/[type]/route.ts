// ---------------------------------------------------------------------------
// GET /api/jobs/[type]?location_id=xxx
// Starts a pipeline job and streams SSE progress events
// ---------------------------------------------------------------------------

import { getJobAuthContext } from "@/lib/jobs/auth"
import { createJob } from "@/lib/jobs/manager"
import { createSSEStream, sseResponse } from "@/lib/jobs/sse"
import { runPipeline } from "@/lib/jobs/pipeline"
import type { JobType, PipelineStepDef } from "@/lib/jobs/types"

import {
  buildContentContext,
  buildContentSteps,
} from "@/lib/jobs/pipelines/content"
import {
  buildVisibilityContext,
  buildVisibilitySteps,
} from "@/lib/jobs/pipelines/visibility"
import {
  buildEventsContext,
  buildEventsSteps,
} from "@/lib/jobs/pipelines/events"
import {
  buildInsightsContext,
  buildInsightsSteps,
} from "@/lib/jobs/pipelines/insights"
import {
  buildPhotosContext,
  buildPhotosSteps,
} from "@/lib/jobs/pipelines/photos"
import {
  buildTrafficContext,
  buildTrafficSteps,
} from "@/lib/jobs/pipelines/traffic"
import {
  buildWeatherContext,
  buildWeatherSteps,
} from "@/lib/jobs/pipelines/weather"
import {
  buildRefreshAllContext,
  buildRefreshAllSteps,
} from "@/lib/jobs/pipelines/refresh-all"

export const maxDuration = 300

const VALID_TYPES = new Set(["content", "visibility", "events", "insights", "photos", "busy_times", "weather", "refresh_all"])

const REDIRECT_MAP: Record<string, string> = {
  content: "/content",
  visibility: "/visibility",
  events: "/events",
  insights: "/insights",
  photos: "/photos",
  busy_times: "/traffic",
  weather: "/weather",
  refresh_all: "/home",
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params
  if (!VALID_TYPES.has(type)) {
    return Response.json({ error: "Invalid job type" }, { status: 400 })
  }

  const url = new URL(req.url)
  const locationId = url.searchParams.get("location_id")
  if (!locationId) {
    return Response.json(
      { error: "location_id is required" },
      { status: 400 }
    )
  }

  const auth = await getJobAuthContext()
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { stream, controller } = createSSEStream()

  ;(async () => {
    try {
      const jobType = type as JobType
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let steps: PipelineStepDef<any>[]
      let ctx: any
      /* eslint-enable @typescript-eslint/no-explicit-any */

      switch (jobType) {
        case "content": {
          ctx = await buildContentContext(
            auth.supabase,
            locationId,
            auth.organizationId
          )
          steps = buildContentSteps(ctx)
          break
        }
        case "visibility": {
          ctx = await buildVisibilityContext(
            auth.supabase,
            locationId,
            auth.organizationId
          )
          steps = buildVisibilitySteps()
          break
        }
        case "events": {
          ctx = await buildEventsContext(
            auth.supabase,
            locationId,
            auth.organizationId
          )
          steps = buildEventsSteps()
          break
        }
        case "insights": {
          ctx = await buildInsightsContext(
            auth.supabase,
            locationId,
            auth.organizationId
          )
          steps = buildInsightsSteps()
          break
        }
        case "photos": {
          ctx = await buildPhotosContext(
            auth.supabase,
            locationId,
            auth.organizationId
          )
          steps = buildPhotosSteps()
          break
        }
        case "busy_times": {
          ctx = await buildTrafficContext(
            auth.supabase,
            locationId,
            auth.organizationId
          )
          steps = buildTrafficSteps()
          break
        }
        case "weather": {
          ctx = await buildWeatherContext(
            auth.supabase,
            locationId,
            auth.organizationId
          )
          steps = buildWeatherSteps()
          break
        }
        case "refresh_all": {
          ctx = await buildRefreshAllContext(
            auth.supabase,
            locationId,
            auth.organizationId
          )
          steps = buildRefreshAllSteps()
          break
        }
        default:
          controller.send("error", { error: "Unknown job type" })
          controller.close()
          return
      }

      const stepDefs = steps.map((s) => ({ name: s.name, label: s.label }))

      // Try to persist job to DB; fall back to an ephemeral ID if the
      // refresh_jobs table doesn't exist yet (migration not applied).
      let jobId: string
      try {
        jobId = await createJob(
          auth.organizationId,
          locationId,
          jobType,
          stepDefs
        )
      } catch (dbErr) {
        console.warn(
          "[Jobs] Could not persist job to DB (migration may not be applied):",
          dbErr instanceof Error ? dbErr.message : dbErr
        )
        jobId = `ephemeral-${crypto.randomUUID()}`
      }

      controller.send("init", {
        jobId,
        steps: stepDefs.map((s) => ({
          name: s.name,
          label: s.label,
          status: "queued",
        })),
      })

      const redirectUrl = `${REDIRECT_MAP[type]}?location_id=${locationId}`

      await runPipeline({
        jobId,
        steps,
        ctx,
        sse: controller,
        redirectUrl,
      })
    } catch (err) {
      console.error("[Jobs] Pipeline error:", err)
      const msg = err instanceof Error ? err.message : "Pipeline setup failed"
      controller.send("error", { error: msg })
      controller.close()
    }
  })()

  return sseResponse(stream)
}
