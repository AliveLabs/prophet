// Assemble the bounded context for an Ask query from the location's OWN persisted data
// (name, watched competitors, recent insights, latest brief). Read-only; admin client.
// Kept separate from answer.ts so the answer logic stays unit-testable without Supabase.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getBrief } from "@/lib/insights/daily-brief"
import { busiestProfile, type AskBusyProfile, type AskContext } from "./answer"

type BusyRow = { day_of_week: number; peak_hour: number | null; peak_score: number | null }

export async function gatherAskContext(locationId: string): Promise<AskContext> {
  const sb = createAdminSupabaseClient()

  const { data: loc } = await sb.from("locations").select("name").eq("id", locationId).maybeSingle()
  const restaurantName = (loc?.name as string) ?? "your restaurant"

  const { data: comps } = await sb
    .from("competitors")
    .select("id, name, metadata")
    .eq("location_id", locationId)
    .eq("is_active", true)
  const approved = (comps ?? []).filter(
    (c) => (c.metadata as Record<string, unknown> | null)?.status === "approved",
  )
  const competitors = approved.map((c) => (c.name as string) ?? "Competitor")

  // "Who's busy when" carried into the answer context so Ask can speak to it off-screen
  // (ALT-368). Own curve from location_busy_times, competitor curves from busy_times.
  const { data: ownBusyRows } = await sb
    .from("location_busy_times")
    .select("day_of_week, peak_hour, peak_score")
    .eq("location_id", locationId)
  const you: AskBusyProfile | null =
    ownBusyRows && ownBusyRows.length
      ? busiestProfile(restaurantName, ownBusyRows as BusyRow[])
      : null

  const competitorIds = approved.map((c) => c.id as string)
  const { data: compBusyRows } = competitorIds.length
    ? await sb
        .from("busy_times")
        .select("competitor_id, day_of_week, peak_hour, peak_score")
        .in("competitor_id", competitorIds)
    : { data: [] as Array<BusyRow & { competitor_id: string }> }
  const byCompetitor = new Map<string, BusyRow[]>()
  for (const r of (compBusyRows ?? []) as Array<BusyRow & { competitor_id: string }>) {
    const rows = byCompetitor.get(r.competitor_id) ?? []
    rows.push(r)
    byCompetitor.set(r.competitor_id, rows)
  }
  const competitorBusy: AskBusyProfile[] = approved
    .filter((c) => byCompetitor.has(c.id as string))
    .map((c) =>
      busiestProfile((c.name as string) ?? "Competitor", byCompetitor.get(c.id as string) ?? []),
    )
    .filter((p) => p.busiestDay != null)

  const { data: rows } = await sb
    .from("insights")
    .select("insight_type, title, summary, date_key")
    .eq("location_id", locationId)
    .order("date_key", { ascending: false })
    .limit(40)
  const insights = (rows ?? []).map((r) => ({
    type: (r.insight_type as string) ?? "",
    title: (r.title as string) ?? "",
    summary: (r.summary as string) ?? "",
    dateKey: (r.date_key as string) ?? "",
  }))

  const brief = await getBrief(locationId)
  const briefCtx = brief
    ? { headline: brief.headline, deck: brief.deck, plays: brief.plays.map((p) => p.title) }
    : null

  return {
    restaurantName,
    competitors,
    insights,
    brief: briefCtx,
    busy: { you, competitors: competitorBusy },
  }
}
