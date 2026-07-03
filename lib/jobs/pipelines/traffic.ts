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
    // T1: the previous run's busy-times snapshot per competitor, loaded BEFORE this
    // run's delete+insert wipes the prior rows. Null when no qualifying (>=5-day-old)
    // snapshot exists yet — first-capture behavior (traffic.baseline), unchanged.
    previousSnapshots: Map<string, BusyTimesSnapshot[]>
    insightsPayload: Array<Record<string, unknown>>
    warnings: string[]
  }
}

/** Minimum age (days) a persisted busy_times row must have to count as "previous" —
 *  the diff types compare week-over-week, so same-day/stale-refresh rows must never
 *  qualify (that would manufacture a diff off noise, not a real week-over-week move). */
const MIN_PREVIOUS_SNAPSHOT_AGE_DAYS = 5

type BusyTimesRow = {
  day_of_week: number
  hourly_scores: number[]
  peak_hour: number | null
  peak_score: number | null
  slow_hours: number[] | null
  typical_time_spent: string | null
  created_at: string
}

/**
 * T1 — load this competitor's most recently persisted busy_times snapshot that is at
 * least MIN_PREVIOUS_SNAPSHOT_AGE_DAYS old, and shape it into BusyTimesSnapshot[] the
 * same way the current-capture mapping in generate_traffic_insights does.
 *
 * MUST be called before the fetch step's delete+insert for this competitor — busy_times
 * is a delete-and-replace table (no history table exists), so once a run's insert lands,
 * the previous run's rows are gone. Calling this after that point can only ever see
 * same-run (zero-day-old) rows and would never qualify — silently keeping the family dormant.
 *
 * Returns null when no qualifying row exists (kept previous:null — first-capture behavior,
 * emits traffic.baseline, unchanged).
 */
export async function loadPreviousBusyTimesSnapshot(
  supabase: SupabaseClient,
  competitorId: string,
): Promise<BusyTimesSnapshot[] | null> {
  const cutoff = new Date(Date.now() - MIN_PREVIOUS_SNAPSHOT_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from("busy_times")
    .select("day_of_week, hourly_scores, peak_hour, peak_score, slow_hours, typical_time_spent, created_at")
    .eq("competitor_id", competitorId)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: false })

  if (error || !data || data.length === 0) return null

  const rows = data as unknown as BusyTimesRow[]

  // busy_times has one row per (competitor, day_of_week) as of the most recent capture
  // that predates the cutoff. Group by the newest qualifying generation: take the most
  // recent created_at present, then all rows within one minute of it. (The pipeline
  // batch-inserts all of a competitor's days in a single .insert() call, so a real prior
  // capture's rows land within the same statement's execution window — a same-day/close
  // window match is robust to sub-second timestamp drift across rows, while still
  // rejecting a distinct older generation, which is what the "must NOT be mixed in" case
  // guards against.)
  const GENERATION_WINDOW_MS = 60 * 1000
  const newestCreatedAtMs = new Date(rows[0].created_at).getTime()
  const sameGeneration = rows.filter(
    (r) => Math.abs(new Date(r.created_at).getTime() - newestCreatedAtMs) <= GENERATION_WINDOW_MS,
  )

  const snapshot: BusyTimesSnapshot[] = sameGeneration.map((r) => ({
    day_of_week: r.day_of_week,
    hourly_scores: r.hourly_scores,
    peak_hour: r.peak_hour ?? 0,
    peak_score: r.peak_score ?? 0,
    slow_hours: r.slow_hours ?? [],
    typical_time_spent: r.typical_time_spent,
  }))

  return snapshot.length > 0 ? snapshot : null
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
            // T1: load the previous snapshot BEFORE the delete+insert below wipes it —
            // busy_times is delete-and-replace with no history table, so this is the
            // only point in the run where a real prior capture is still readable.
            const previous = await loadPreviousBusyTimesSnapshot(ctx.supabase, comp.id)
            if (previous) ctx.state.previousSnapshots.set(comp.id, previous)

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

          // T1: wire the previous-week snapshot loaded in fetch_busy_times — this arms
          // traffic.surge/peak_shift/extended_busy/new_slow_period (previously dormant,
          // hardcoded previous:null). No qualifying prior snapshot -> null, unchanged
          // first-capture behavior (traffic.baseline).
          const previous = ctx.state.previousSnapshots.get(comp.id) ?? null

          const insights = generateTrafficInsights({
            competitorName: comp.name ?? "Competitor",
            competitorId: comp.id,
            current,
            previous,
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
      previousSnapshots: new Map(),
      insightsPayload: [],
      warnings: [],
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
