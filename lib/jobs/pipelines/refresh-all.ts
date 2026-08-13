// ---------------------------------------------------------------------------
// Refresh All Pipeline – orchestrates every signal pipeline for a location
// Runs: content -> visibility -> events -> photos -> busy_times -> weather -> insights
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"

import { buildContentContext, buildContentSteps } from "./content"
import { buildVisibilityContext, buildVisibilitySteps } from "./visibility"
import { buildEventsContext, buildEventsSteps } from "./events"
import { buildPhotosContext, buildPhotosSteps } from "./photos"
import { buildTrafficContext, buildTrafficSteps } from "./traffic"
import { buildWeatherContext, buildWeatherSteps } from "./weather"
import { buildSocialContext, buildSocialSteps } from "./social"
import { buildInsightsContext, buildInsightsSteps } from "./insights"
import { buildBriefContext, buildBriefSteps } from "./brief"
import { buildStarterContext, buildStarterSteps } from "./starter"

export type RefreshAllCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
}

export type SubPipeline = {
  name: string
  label: string
  buildCtx: (
    supabase: SupabaseClient,
    locationId: string,
    organizationId: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildSteps: (...args: any[]) => PipelineStepDef<any>[]
  ctxArg?: boolean
}

// Exported so the durable worker (lib/jobs/worker.ts) dispatches one pipeline per job
// by name — same definitions the legacy inline refresh_all uses.
export const SUB_PIPELINES: SubPipeline[] = [
  {
    name: "content",
    label: "Content & Menus",
    buildCtx: buildContentContext,
    buildSteps: (ctx: unknown) => buildContentSteps(ctx as Parameters<typeof buildContentSteps>[0]),
    ctxArg: true,
  },
  {
    name: "visibility",
    label: "SEO & Visibility",
    buildCtx: buildVisibilityContext,
    buildSteps: () => buildVisibilitySteps(),
  },
  {
    name: "events",
    label: "Local Events",
    buildCtx: buildEventsContext,
    buildSteps: () => buildEventsSteps(),
  },
  {
    name: "photos",
    label: "Photo Analysis",
    buildCtx: buildPhotosContext,
    buildSteps: () => buildPhotosSteps(),
  },
  {
    name: "busy_times",
    label: "Busy Times",
    buildCtx: buildTrafficContext,
    buildSteps: () => buildTrafficSteps(),
  },
  {
    name: "weather",
    label: "Weather",
    buildCtx: buildWeatherContext,
    buildSteps: () => buildWeatherSteps(),
  },
  {
    name: "social",
    label: "Social",
    buildCtx: buildSocialContext,
    buildSteps: () => buildSocialSteps(),
  },
  {
    name: "insights",
    label: "Insight Generation",
    buildCtx: buildInsightsContext,
    buildSteps: () => buildInsightsSteps(),
  },
  {
    // Not part of the scheduled daily set (the 8:00 UTC build-brief cron owns
    // that); enqueued by the worker after a first_run insights job completes
    // so onboarding's first brief doesn't wait for the next morning.
    name: "brief",
    label: "Daily Brief",
    buildCtx: buildBriefContext,
    buildSteps: () => buildBriefSteps(),
  },
]

// FIRST-RUN ONLY pipelines. The worker dispatches these by name; `buildRefreshAllSteps` below
// deliberately does NOT include them, so the manual "refresh everything" route keeps exactly the
// step list it has today. The starter insight costs a producer call and is meaningless for a
// location that already has briefs, so a manual refresh must never trigger one.
const WORKER_ONLY_PIPELINES: SubPipeline[] = [
  {
    name: "starter",
    label: "First insight",
    buildCtx: buildStarterContext,
    buildSteps: () => buildStarterSteps(),
  },
]

/** Every pipeline the durable worker can dispatch: the scheduled set plus the first-run-only ones. */
export const WORKER_PIPELINES: SubPipeline[] = [...SUB_PIPELINES, ...WORKER_ONLY_PIPELINES]

export async function buildRefreshAllContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<RefreshAllCtx> {
  return { supabase, locationId, organizationId }
}

export function buildRefreshAllSteps(): PipelineStepDef<RefreshAllCtx>[] {
  const steps: PipelineStepDef<RefreshAllCtx>[] = []

  for (const sub of SUB_PIPELINES) {
    steps.push({
      name: `${sub.name}_pipeline`,
      label: `${sub.label}`,
      run: async (parentCtx) => {
        try {
          const ctx = await sub.buildCtx(
            parentCtx.supabase,
            parentCtx.locationId,
            parentCtx.organizationId
          )
          const subSteps = sub.ctxArg ? sub.buildSteps(ctx) : sub.buildSteps()

          let completed = 0
          let failed = 0
          const warnings: string[] = []

          for (const step of subSteps) {
            try {
              await step.run(ctx)
              completed++
            } catch (err) {
              failed++
              warnings.push(
                `${step.label}: ${err instanceof Error ? err.message : "Failed"}`
              )
            }
          }

          return {
            pipeline: sub.name,
            totalSteps: subSteps.length,
            completed,
            failed,
            ...(warnings.length > 0 && { warnings }),
          }
        } catch (err) {
          return {
            pipeline: sub.name,
            skipped: true,
            reason: err instanceof Error ? err.message : "Context build failed",
          }
        }
      },
    })
  }

  return steps
}
