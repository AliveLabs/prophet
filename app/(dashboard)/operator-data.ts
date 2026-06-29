// Authed data loader for the reworked operator experience (Stage A port of
// app/preview/preview-data.ts). Same query shapes, but resolved from the LOGGED-IN
// user via the user-scoped server client — RLS enforces org membership on every read.

import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { getAdminContext } from "@/lib/auth/platform-admin"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getBrief } from "@/lib/insights/daily-brief"
import type { Brief } from "@/lib/skills/types"
import { typeToCuisine } from "@/lib/places/format"

/** Map DB subscription_tier values (entry/mid/top + legacy) to display labels.
 *  'free' is a legacy pre-migration value — those orgs are trials (of Tier 2). */
export function tierLabel(t: string): string {
  const m: Record<string, string> = {
    entry: "Tier 1", mid: "Tier 2", top: "Tier 3",
    tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3", free: "Trial",
  }
  return m[t] ?? t
}

export type Operator = {
  userId: string
  userName: string
  organizationId: string
  locationId: string
  locationName: string
  city: string | null
}

/** Logged-in user → current org → its primary location. Redirects to onboarding when
 *  the account has no org/location yet (same behavior as the dashboard shell). */
export async function resolveOperator(): Promise<Operator> {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()
  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/onboarding")

  const { data: loc } = await supabase
    .from("locations")
    .select("id, name, city")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!loc) redirect("/onboarding")

  return {
    userId: user.id,
    userName: (user.user_metadata?.full_name as string) ?? user.email?.split("@")[0] ?? "Operator",
    organizationId,
    locationId: loc.id,
    locationName: loc.name ?? "Your location",
    city: loc.city ?? null,
  }
}

export type OperatorCompetitor = {
  id: string
  name: string
  rating: number | null
  reviewCount: number | null
  signalCount: number
  topSignals: string[]
}

export type OperatorContext = {
  locationId: string
  locationName: string
  city: string | null
  tier: string
  brandTolerance: number
  voiceTone: string | null
  userName: string
  brief: Brief | null
  competitors: OperatorCompetitor[]
}

export async function loadOperatorContext(): Promise<OperatorContext> {
  const op = await resolveOperator()
  const sb = await createServerSupabaseClient()

  const { data: loc } = await sb
    .from("locations")
    .select("brand_tolerance, voice_tone")
    .eq("id", op.locationId)
    .maybeSingle()

  const { data: org } = await sb
    .from("organizations")
    .select("subscription_tier")
    .eq("id", op.organizationId)
    .maybeSingle()

  const brief = await getBrief(op.locationId)

  const { data: comps } = await sb
    .from("competitors")
    .select("id, name, metadata")
    .eq("location_id", op.locationId)
    .eq("is_active", true)
  const approved = (comps ?? []).filter(
    (c) => (c.metadata as Record<string, unknown> | null)?.status === "approved"
  )

  const { data: recent } = await sb
    .from("insights")
    .select("competitor_id, title")
    .eq("location_id", op.locationId)
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

  const competitors: OperatorCompetitor[] = approved.map((c) => {
    const meta = c.metadata as Record<string, unknown> | null
    const pd = (meta?.placeDetails as Record<string, unknown> | null) ?? null
    const agg = byComp.get(c.id)
    return {
      id: c.id,
      name: c.name ?? "Competitor",
      rating: (pd?.rating as number | null) ?? null,
      reviewCount: (pd?.reviewCount as number | null) ?? null,
      signalCount: agg?.count ?? 0,
      topSignals: agg?.titles ?? [],
    }
  })

  return {
    locationId: op.locationId,
    locationName: op.locationName,
    city: op.city,
    tier: org?.subscription_tier ?? "entry",
    brandTolerance: loc?.brand_tolerance ?? 50,
    voiceTone: loc?.voice_tone ?? null,
    userName: op.userName,
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

/** One watched competitor + recent signals — scoped to the operator's location, so a
 *  foreign id 404s rather than leaking another org's competitor.
 *  Profile facts (rating, reviews, price, address) resolve from the latest persisted
 *  snapshot first (the freshest source — same precedence as the insights page), then
 *  fall back to the stored Places metadata. priceLevel stays the RAW Google enum here
 *  (e.g. PRICE_LEVEL_EXPENSIVE) — the detail page renders it as $/$$/$$$ (ALT-188).
 *  cuisine is humanized via typeToCuisine so no raw enum (e.g. fast_food_restaurant)
 *  ever leaks to the UI (ALT-188). */
export async function loadOperatorCompetitorDetail(id: string): Promise<CompetitorDetail | null> {
  const op = await resolveOperator()
  const sb = await createServerSupabaseClient()
  const { data: c } = await sb
    .from("competitors")
    .select("id, name, metadata")
    .eq("id", id)
    .eq("location_id", op.locationId)
    .maybeSingle()
  if (!c) return null
  const meta = (c.metadata as Record<string, unknown> | null) ?? null
  const pd = (meta?.placeDetails as Record<string, unknown> | null) ?? null

  // Latest snapshot for this competitor — freshest profile facts when present.
  const { data: snapRow } = await sb
    .from("snapshots")
    .select("raw_data")
    .eq("competitor_id", id)
    .order("date_key", { ascending: false })
    .limit(1)
    .maybeSingle()
  const snap = (snapRow?.raw_data as { profile?: Record<string, unknown> } | null) ?? null
  const sp = snap?.profile ?? null

  const { data: rows } = await sb
    .from("insights")
    .select("insight_type, title, summary, date_key")
    .eq("competitor_id", id)
    .order("date_key", { ascending: false })
    .limit(8)

  // Cuisine from the place's primary type / types — always humanized.
  const primaryType = (pd?.primaryType as string | null) ?? null
  const types = (pd?.types as string[] | undefined) ?? []
  const cuisine =
    primaryType || types.length ? typeToCuisine(primaryType, types) : null

  return {
    id: c.id,
    name: c.name ?? "Competitor",
    rating: (sp?.rating as number | null) ?? (pd?.rating as number | null) ?? (meta?.rating as number | null) ?? null,
    reviewCount: (sp?.reviewCount as number | null) ?? (pd?.reviewCount as number | null) ?? (meta?.reviewCount as number | null) ?? null,
    priceLevel: (sp?.priceLevel as string | null) ?? (pd?.priceLevel as string | null) ?? null,
    cuisine,
    address:
      (sp?.address as string | null) ??
      (pd?.shortFormattedAddress as string | null) ??
      (pd?.formattedAddress as string | null) ??
      (meta?.shortFormattedAddress as string | null) ??
      (meta?.address as string | null) ??
      null,
    insights: (rows ?? []).map((r) => ({
      type: r.insight_type,
      title: r.title ?? "",
      summary: r.summary ?? null,
      dateKey: r.date_key ?? "",
    })),
  }
}

export type AccountLocation = {
  id: string
  name: string
  city: string | null
  current: boolean
  organizationId: string
}

/** Humanize a stored organization_members.role value (owner / admin / member / …) into a
 *  display label. Never leaks a raw enum key (CLAUDE conventions). */
export function memberRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null
  const m: Record<string, string> = {
    owner: "Owner",
    admin: "Admin",
    manager: "Manager",
    member: "Member",
    viewer: "Viewer",
  }
  return m[role] ?? role.charAt(0).toUpperCase() + role.slice(1)
}

export type OperatorAccount = {
  userName: string
  /** The signed-in user's role on the CURRENT org (humanized), e.g. "Owner". */
  currentRole: string | null
  /** Platform-admin (super-admin) — gates the admin-panel link in the switcher. Never true
   *  during an impersonation session (getAdminContext excludes it). */
  isPlatformAdmin: boolean
  locations: AccountLocation[]
}

/** The locations this login can switch between — the primary location of each org the
 *  user belongs to (switching = switchOrganizationAction; the shell resolves each org's
 *  primary location). Also surfaces the user's role on the current org + whether they're a
 *  platform admin, so the shell switcher can lead with the business + role and (for admins)
 *  link to the admin panel. */
export async function loadOperatorAccount(): Promise<OperatorAccount> {
  const op = await resolveOperator()
  const sb = await createServerSupabaseClient()
  const { data: memberships } = await sb
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", op.userId)
  const orgIds = Array.from(new Set((memberships ?? []).map((m) => m.organization_id)))
  const currentRole = memberRoleLabel(
    (memberships ?? []).find((m) => m.organization_id === op.organizationId)?.role
  )

  const locations: AccountLocation[] = []
  if (orgIds.length) {
    const { data: locs } = await sb
      .from("locations")
      .select("id, name, city, organization_id, created_at")
      .in("organization_id", orgIds)
      .order("created_at", { ascending: true })
    const seenOrg = new Set<string>()
    for (const l of locs ?? []) {
      if (seenOrg.has(l.organization_id)) continue // primary (oldest) location per org
      seenOrg.add(l.organization_id)
      locations.push({
        id: l.id,
        name: l.name ?? "Location",
        city: l.city ?? null,
        current: l.id === op.locationId,
        organizationId: l.organization_id,
      })
    }
  }
  // STABLE alphabetical order — the current location is MARKED, not floated to the top
  // (ALT-162c: a list that reorders under the cursor is disorienting).
  locations.sort((a, b) => a.name.localeCompare(b.name))

  // Admin link gate (ALT-163). getAdminContext() already returns null during impersonation,
  // so an impersonator never sees the link.
  const adminCtx = await getAdminContext()

  return { userName: op.userName, currentRole, isPlatformAdmin: !!adminCtx, locations }
}
