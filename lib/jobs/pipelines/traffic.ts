// ---------------------------------------------------------------------------
// Traffic Pipeline – fetch busy times from Outscraper for all competitors
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { fetchBusyTimes, type BusyTimesResult } from "@/lib/providers/outscraper"
import {
  generateTrafficInsights,
  generateCompetitiveOpportunityInsights,
  type BusyTimesSnapshot,
} from "@/lib/insights/traffic-insights"

export type TrafficPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  dateKey: string
  competitors: Array<{
    id: string
    name: string | null
    provider_entity_id: string | null
  }>
  state: {
    results: Map<string, BusyTimesResult>
    insightsPayload: Array<Record<string, unknown>>
    warnings: string[]
  }
}

export function buildTrafficSteps(): PipelineStepDef<TrafficPipelineCtx>[] {
  return [
    {
      name: "load_competitors",
      label: "Loading competitors",
      run: async (ctx) => {
        return {
          competitor_count: ctx.competitors.length,
          names: ctx.competitors.map((c) => c.name).filter(Boolean),
        }
      },
    },
    {
      name: "fetch_busy_times",
      label: "Fetching busy times from Outscraper",
      run: async (ctx) => {
        let fetched = 0
        let totalDays = 0
        for (const comp of ctx.competitors) {
          if (!comp.provider_entity_id) {
            // A competitor with no place id can never get busy data — say so instead
            // of skipping silently (this gap is invisible in the UI otherwise).
            ctx.state.warnings.push(`Busy times for ${comp.name}: no provider place id — skipped`)
            continue
          }
          try {
            const result = await fetchBusyTimes(comp.provider_entity_id, comp.id)
            // An empty result is a real outcome, not an error — but it must not be
            // silent: a spot stuck at zero busy_times rows renders a curveless track
            // forever (the McDonald's gap, 2026-07-01) and nobody can tell why.
            if (!result || result.days.length === 0) {
              ctx.state.warnings.push(
                `Busy times for ${comp.name}: provider returned no popular-times data — kept previous rows (if any)`,
              )
            }
            if (result && result.days.length > 0) {
              ctx.state.results.set(comp.id, result)
              fetched++
              totalDays += result.days.length

              // Clear old data for this competitor and insert fresh
              await ctx.supabase
                .from("busy_times")
                .delete()
                .eq("competitor_id", comp.id)

              // ENG-M6: batch all days into ONE insert (was N sequential inserts) — fewer round-trips
              // and atomic per competitor (no partial-day state if a write fails mid-loop).
              await ctx.supabase.from("busy_times").insert(
                result.days.map((day) => ({
                  competitor_id: comp.id,
                  day_of_week: day.day_of_week,
                  hourly_scores: day.hourly_scores,
                  peak_hour: day.peak_hour,
                  peak_score: day.peak_score,
                  slow_hours: day.slow_hours,
                  typical_time_spent: result.typical_time_spent,
                  current_popularity: result.current_popularity,
                })),
              )

              // ALT-264 — the same pull carries the place's posted hours; cache them on
              // the competitor so "Who's open when" renders a real window without a paid
              // Places call. Read-modify-write on the jsonb (the worker loop is
              // sequential, so last-writer-wins is acceptable here).
              if (result.working_hours_lines) {
                const { data: compRow } = await ctx.supabase
                  .from("competitors")
                  .select("metadata")
                  .eq("id", comp.id)
                  .maybeSingle()
                const meta = (compRow?.metadata as Record<string, unknown> | null) ?? {}
                await ctx.supabase
                  .from("competitors")
                  .update({
                    metadata: {
                      ...meta,
                      outscraperHours: {
                        weekdayDescriptions: result.working_hours_lines,
                        updated_at: ctx.dateKey,
                      },
                    },
                  })
                  .eq("id", comp.id)
              }
            }
            await sleep(500)
          } catch (err) {
            ctx.state.warnings.push(`Busy times for ${comp.name}: ${err instanceof Error ? err.message : "failed"}`)
          }
        }
        return { competitors_fetched: fetched, total_day_records: totalDays }
      },
    },
    {
      name: "generate_traffic_insights",
      label: "Generating traffic insights",
      run: async (ctx) => {
        const allTraffic: Array<{ name: string; id: string; days: BusyTimesSnapshot[] }> = []

        for (const comp of ctx.competitors) {
          const result = ctx.state.results.get(comp.id)
          if (!result) continue

          const current: BusyTimesSnapshot[] = result.days.map((d) => ({
            day_of_week: d.day_of_week,
            hourly_scores: d.hourly_scores,
            peak_hour: d.peak_hour,
            peak_score: d.peak_score,
            slow_hours: d.slow_hours,
            typical_time_spent: result.typical_time_spent,
          }))

          allTraffic.push({ name: comp.name ?? "Competitor", id: comp.id, days: current })

          const insights = generateTrafficInsights({
            competitorName: comp.name ?? "Competitor",
            competitorId: comp.id,
            current,
            previous: null,
          })

          for (const ins of insights) {
            ctx.state.insightsPayload.push({
              location_id: ctx.locationId,
              competitor_id: comp.id,
              date_key: ctx.dateKey,
              ...ins,
              status: "new",
            })
          }
        }

        const opportunityInsights = generateCompetitiveOpportunityInsights(allTraffic)
        for (const ins of opportunityInsights) {
          ctx.state.insightsPayload.push({
            location_id: ctx.locationId,
            competitor_id: null,
            date_key: ctx.dateKey,
            ...ins,
            status: "new",
          })
        }

        if (ctx.state.insightsPayload.length > 0) {
          await ctx.supabase.from("insights").upsert(ctx.state.insightsPayload, {
            onConflict: "location_id,competitor_id,date_key,insight_type",
          })
        }

        return {
          insights_generated: ctx.state.insightsPayload.length,
          warnings: ctx.state.warnings,
        }
      },
    },
  ]
}

export async function buildTrafficContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<TrafficPipelineCtx> {
  const { data: location } = await supabase
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!location) throw new Error("Location not found")

  const { data: comps } = await supabase
    .from("competitors")
    .select("id, name, provider_entity_id")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const competitors = (comps ?? [])
    .filter((c) => c.provider_entity_id && !c.provider_entity_id.startsWith("unknown:"))
    .map((c) => ({
      id: c.id,
      name: c.name,
      provider_entity_id: c.provider_entity_id,
    }))

  return {
    supabase,
    locationId,
    organizationId,
    dateKey: new Date().toISOString().slice(0, 10),
    competitors,
    state: {
      results: new Map(),
      insightsPayload: [],
      warnings: [],
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
