// Shared loader for the PREVIEW area (no-auth, reads the branch via the admin client).
// Real data where we have it; honest empty states where a pipeline/feature isn't wired.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getBrief } from "@/lib/insights/daily-brief"
import type { Brief } from "@/lib/skills/types"

export const WAGYU_LOCATION_ID = "d06eec94-baf7-4f80-920a-0886a35fad90"

/** Map DB subscription_tier values (entry/mid/top + tier_n legacy) to display labels. */
export function tierLabel(t: string): string {
  const m: Record<string, string> = {
    entry: "Tier 1", mid: "Tier 2", top: "Tier 3",
    tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3", free: "Free",
  }
  return m[t] ?? t
}

export type PreviewCompetitor = {
  id: string
  name: string
  rating: number | null
  reviewCount: number | null
  signalCount: number
  topSignals: string[]
}

export type PreviewContext = {
  locationId: string
  locationName: string
  city: string | null
  tier: string
  brandTolerance: number
  voiceTone: string | null
  brief: Brief | null
  competitors: PreviewCompetitor[]
}

type LooseClient = {
  from: (t: string) => {
    select: (c: string, opts?: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => unknown
      ilike?: (col: string, val: string) => unknown
      in?: (col: string, vals: unknown[]) => unknown
      maybeSingle?: () => Promise<{ data: Record<string, unknown> | null }>
    }
  }
}

export type AccountLocation = { id: string; name: string; city: string | null; current: boolean }

/** All locations this login can switch between (one login → many locations), for the
 *  account flyout's profile switcher. Resolves: current location's org → a member →
 *  that user's orgs → their locations. Defensive; returns at least the current one. */
export async function loadAccountLocations(currentId: string): Promise<AccountLocation[]> {
  const sb = createAdminSupabaseClient()
  try {
    const { data: cur } = await sb.from("locations").select("organization_id").eq("id", currentId).maybeSingle()
    const orgId = cur?.organization_id as string | undefined
    if (!orgId) return []
    const { data: members } = await sb.from("organization_members").select("user_id").eq("organization_id", orgId).limit(1)
    const userId = members?.[0]?.user_id as string | undefined
    let orgIds = [orgId]
    if (userId) {
      const { data: memberships } = await sb.from("organization_members").select("organization_id").eq("user_id", userId)
      orgIds = Array.from(new Set((memberships ?? []).map((m) => m.organization_id as string)))
    }
    const { data: locs } = await sb.from("locations").select("id, name, city").in("organization_id", orgIds.length ? orgIds : [orgId])
    return (locs ?? [])
      .map((l) => ({ id: l.id as string, name: (l.name as string) ?? "Location", city: (l.city as string) ?? null, current: l.id === currentId }))
      .sort((a, b) => (a.current ? -1 : b.current ? 1 : a.name.localeCompare(b.name)))
  } catch {
    return []
  }
}

export async function loadPreviewContext(): Promise<PreviewContext> {
  const sb = createAdminSupabaseClient()
  // loose-typed reads (brand_tolerance/voice_tone land with the engine migration, not in gen types)
  const loose = sb as unknown as LooseClient

  const { data: loc } = (await (loose
    .from("locations")
    .select("id, name, city, organization_id, brand_tolerance, voice_tone")
    .eq("id", WAGYU_LOCATION_ID) as { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> })
    .maybeSingle())

  const locationId = (loc?.id as string) ?? WAGYU_LOCATION_ID
  const orgId = loc?.organization_id as string | undefined

  let tier = "tier_2"
  if (orgId) {
    const { data: org } = await sb.from("organizations").select("subscription_tier").eq("id", orgId).maybeSingle()
    tier = (org?.subscription_tier as string) ?? "tier_2"
  }

  const brief = await getBrief(locationId)

  // competitors (approved + active) + light signal summary from recent insights
  const { data: comps } = await sb
    .from("competitors")
    .select("id, name, metadata")
    .eq("location_id", locationId)
    .eq("is_active", true)
  const approved = (comps ?? []).filter((c) => (c.metadata as Record<string, unknown> | null)?.status === "approved")

  const { data: recent } = await sb
    .from("insights")
    .select("competitor_id, title")
    .eq("location_id", locationId)
    .not("competitor_id", "is", null)
    .order("date_key", { ascending: false })
    .limit(200)
  const byComp = new Map<string, { count: number; titles: string[] }>()
  for (const r of recent ?? []) {
    const cid = r.competitor_id as string
    const e = byComp.get(cid) ?? { count: 0, titles: [] }
    e.count++
    if (e.titles.length < 2 && r.title) e.titles.push(r.title as string)
    byComp.set(cid, e)
  }

  const competitors: PreviewCompetitor[] = approved.map((c) => {
    const meta = c.metadata as Record<string, unknown> | null
    const pd = (meta?.placeDetails as Record<string, unknown> | null) ?? null
    const agg = byComp.get(c.id as string)
    return {
      id: c.id as string,
      name: (c.name as string) ?? "Competitor",
      rating: (pd?.rating as number | null) ?? null,
      reviewCount: (pd?.reviewCount as number | null) ?? null,
      signalCount: agg?.count ?? 0,
      topSignals: agg?.titles ?? [],
    }
  })

  return {
    locationId,
    locationName: (loc?.name as string) ?? "Wagyu House Atlanta",
    city: (loc?.city as string) ?? null,
    tier,
    brandTolerance: (loc?.brand_tolerance as number) ?? 50,
    voiceTone: (loc?.voice_tone as string) ?? null,
    brief,
    competitors,
  }
}

export type CompetitorInsight = { type: string; title: string; summary: string | null; dateKey: string }
export type CompetitorDetail = {
  id: string
  name: string
  rating: number | null
  reviewCount: number | null
  priceLevel: string | null
  cuisine: string | null
  address: string | null
  insights: CompetitorInsight[]
}

/** One watched competitor + its recent signals, for the per-competitor detail page. */
export async function loadCompetitorDetail(id: string): Promise<CompetitorDetail | null> {
  const sb = createAdminSupabaseClient()
  const { data: c } = await sb.from("competitors").select("id, name, metadata").eq("id", id).maybeSingle()
  if (!c) return null
  const meta = (c.metadata as Record<string, unknown> | null) ?? null
  const pd = (meta?.placeDetails as Record<string, unknown> | null) ?? null

  const { data: rows } = await sb
    .from("insights")
    .select("insight_type, title, summary, date_key")
    .eq("competitor_id", id)
    .order("date_key", { ascending: false })
    .limit(8)

  return {
    id: c.id as string,
    name: (c.name as string) ?? "Competitor",
    rating: (pd?.rating as number | null) ?? null,
    reviewCount: (pd?.reviewCount as number | null) ?? null,
    priceLevel: (pd?.priceLevel as string | null) ?? null,
    cuisine: (pd?.cuisine as string | null) ?? ((pd?.types as string[] | undefined)?.[0] ?? null),
    address: (pd?.formattedAddress as string | null) ?? (pd?.address as string | null) ?? null,
    insights: (rows ?? []).map((r) => ({
      type: r.insight_type as string,
      title: (r.title as string) ?? "",
      summary: (r.summary as string | null) ?? null,
      dateKey: (r.date_key as string) ?? "",
    })),
  }
}
