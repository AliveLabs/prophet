// Assemble the bounded context for an Ask query from the location's OWN persisted data
// (name, watched competitors, recent insights, latest brief). Read-only; admin client.
// Kept separate from answer.ts so the answer logic stays unit-testable without Supabase.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getBrief } from "@/lib/insights/daily-brief"
import type { AskContext } from "./answer"

export async function gatherAskContext(locationId: string): Promise<AskContext> {
  const sb = createAdminSupabaseClient()

  const { data: loc } = await sb.from("locations").select("name").eq("id", locationId).maybeSingle()
  const restaurantName = (loc?.name as string) ?? "your restaurant"

  const { data: comps } = await sb
    .from("competitors")
    .select("name, metadata")
    .eq("location_id", locationId)
    .eq("is_active", true)
  const competitors = (comps ?? [])
    .filter((c) => (c.metadata as Record<string, unknown> | null)?.status === "approved")
    .map((c) => (c.name as string) ?? "Competitor")

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

  return { restaurantName, competitors, insights, brief: briefCtx }
}
