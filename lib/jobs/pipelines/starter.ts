// ---------------------------------------------------------------------------
// Starter-insight pipeline (beta rescue Phase 3.1) — FIRST RUN ONLY.
//
// Builds the partial dossier and runs ONE producer over it, so a brand-new location has a real,
// grounded insight to read in minutes instead of waiting out the full brief. See
// lib/insights/starter-play.ts for why `reputation` is the skill and why every anti-fabrication
// guarantee is STRICTER here than on a full brief, not looser.
//
// FIRST-RUN ONLY, ENFORCED TWICE. enqueueFirstRun is the only enqueuer, and it fires once per
// location; on top of that the guard step below bails when the location already has a brief. A
// location that already has briefs therefore behaves exactly as it does today: no starter job, and
// no starter work even if one were somehow queued.
//
// SPEND. Exactly one extra producer call per new signup, at low effort, sharing the nightly
// reputation call's cached system prefix. Its tokens are recorded through recordSpendEvent
// (surface: first_run_starter) because there is no daily_briefs row to carry providerStats yet.
// The readiness gate means a dossier with no citable review signal costs NO model call at all.
// ---------------------------------------------------------------------------

import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { buildDossier } from "@/lib/insights/dossier/build"
import { hasAnyBrief } from "@/lib/insights/daily-brief"
import { runProducerSkill } from "@/lib/skills/run"
import {
  STARTER_SNAPSHOT_PROVIDER,
  pickStarterPlay,
  readStarterSignals,
  starterReadiness,
  starterSkill,
  type StoredStarterInsight,
} from "@/lib/insights/starter-play"
import { ANTHROPIC_MODEL } from "@/lib/ai/provider"
import { recordSpendEvent } from "@/lib/ai/spend-events"
import type { Dossier } from "@/lib/insights/dossier/types"

export type StarterPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  state: {
    /** Set by the guard step: this location is past its first run, so there is nothing to do. */
    skip: boolean
    dossier: Dossier | null
  }
}

export async function buildStarterContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string,
): Promise<StarterPipelineCtx> {
  return { supabase, locationId, organizationId, state: { skip: false, dossier: null } }
}

export function buildStarterSteps(): PipelineStepDef<StarterPipelineCtx>[] {
  return [
    {
      name: "guard_first_run",
      label: "Checking this is a first run",
      run: async (c) => {
        // A location with a brief has the real thing already; a starter would be strictly worse
        // AND would cost a producer call. Bail without touching anything.
        c.state.skip = await hasAnyBrief(c.locationId)
        return { skipped: c.state.skip }
      },
    },
    {
      name: "build_partial_dossier",
      label: "Reading what we have so far",
      run: async (c) => {
        if (c.state.skip) return { skipped: true }
        // The SAME buildDossier the brief uses. On a first run most fields are legitimately empty
        // (no competitor snapshots, no menu, no events yet); the dossier is built to report that
        // honestly, and buildRefIndex closes the citable set to whatever actually landed.
        c.state.dossier = await buildDossier(c.locationId)
        const read = readStarterSignals(c.state.dossier)
        return {
          ruleOutputs: read.ruleOutputTypes.length,
          ownReviewThemes: read.ownReviewThemeCount,
          hasOwnListing: read.hasOwnListing,
        }
      },
    },
    {
      name: "write_starter_insight",
      label: "Writing your first insight",
      run: async (c) => {
        if (c.state.skip || !c.state.dossier) return { skipped: true }
        const dossier = c.state.dossier

        // READINESS, NOT A TIMER. No citable signal for the starter skill means its parse gate
        // would drop every play anyway, so the call is not made at all.
        const readiness = starterReadiness(readStarterSignals(dossier))
        if (!readiness.ready) {
          console.log(`[starter:${c.locationId}] not ready (${readiness.reason}) — no model call made`)
          return { ready: false, reason: readiness.reason, modelCalls: 0 }
        }

        const result = await runProducerSkill(starterSkill, dossier, {
          organizationId: c.organizationId,
          // No `previous`: differential reuse compares against a PREVIOUS BUILD, and by
          // definition there is none. The skill still computes its inputHash.
        })

        // Spend telemetry. Awaited (a background job, not a user-facing request path) so the
        // write lands before the invocation can suspend. recordSpendEvent never throws.
        if (result.tokens) {
          await recordSpendEvent({
            surface: "first_run_starter",
            provider: "anthropic",
            model: ANTHROPIC_MODEL,
            inputTokens: result.tokens.inputTokens,
            outputTokens: result.tokens.outputTokens,
            cacheReadTokens: result.tokens.cacheReadTokens,
            cacheWriteTokens: result.tokens.cacheWriteTokens,
            locationId: c.locationId,
            metadata: {
              skillId: result.skillId,
              effort: starterSkill.effort,
              usedFallback: !!result.usedFallback,
              ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
            },
          })
        }

        if (result.status === "failed") {
          // Isolated failure, same contract as the brief's fan-out: nothing is written and the
          // job records it. The full brief is unaffected.
          throw new Error(`starter producer failed: ${result.error ?? "unknown"}`)
        }

        const play = pickStarterPlay(result.plays)
        if (!play) {
          // The producer ran and grounded nothing that survived the filter. That is an honest
          // outcome, not an error: the surface says nothing rather than inventing something.
          console.log(`[starter:${c.locationId}] producer returned no grounded play (usedFallback=${!!result.usedFallback})`)
          return { ready: true, plays: 0, usedFallback: !!result.usedFallback, modelCalls: 1 }
        }

        const payload: StoredStarterInsight = {
          version: "1.0",
          generatedAt: new Date().toISOString(),
          skillId: result.skillId,
          knowledgeVersion: play.knowledgeVersion,
          usedFallback: !!result.usedFallback,
          ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
          play,
        }

        // location_snapshots with a free-text provider key, the convention this codebase already
        // uses for derived per-location artifacts (review_sentiment, google_places_profile,
        // google_hours). Deliberately NOT the `insights` table: buildDossier reads that table as
        // its rule-output layer, so writing a PLAY there would turn a recommendation into citable
        // evidence for the next build. And deliberately not `daily_briefs`: a row there would make
        // hasAnyBrief true and suppress the real first brief and its email.
        const { error } = await c.supabase.from("location_snapshots").upsert(
          {
            location_id: c.locationId,
            provider: STARTER_SNAPSHOT_PROVIDER,
            date_key: dossier.dateKey,
            captured_at: payload.generatedAt,
            raw_data: payload as unknown as Record<string, unknown>,
            diff_hash: createHash("sha256").update(`${play.skillId}|${play.title}`).digest("hex"),
          },
          { onConflict: "location_id,provider,date_key" },
        )
        if (error) throw new Error(`starter insight save failed: ${error.message}`)

        return {
          ready: true,
          plays: result.plays.length,
          usedFallback: !!result.usedFallback,
          elapsedMs: result.elapsedMs ?? null,
          modelCalls: 1,
        }
      },
      // The insight IS this job's artifact: a save failure must fail the job so it retries,
      // exactly as the brief pipeline's build step does.
      critical: true,
    },
  ]
}
