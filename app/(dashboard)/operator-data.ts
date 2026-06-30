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

// ─────────────────────────────────────────────────────────────────────────────
// ALT-235 — head-to-head + busy-times comparison for the Competitors overview.
//
// Reuses the busy-times the Traffic page already ingests (Google Maps popular
// times via Outscraper). Competitor curves live in `busy_times` (keyed by
// competitor_id); the operator's OWN curve lives in `location_busy_times` (keyed
// by location_id). Both tables carry org-member SELECT policies, so this loads
// through the USER-SCOPED server client — RLS enforces org membership, the
// competitor query is additionally narrowed to this location's competitor ids,
// and a foreign location can never leak. NO new pipeline and NO paid Places call:
// we render whatever is already cached, and the page flags an empty state when a
// side has not been pulled yet.
// ─────────────────────────────────────────────────────────────────────────────

/** One entity (own location or a competitor) shaped for the kit busy-times viz.
 *  Matches app/(dashboard)/traffic/traffic-types.ts so the Traffic heatmap island
 *  renders it unchanged. `isYou` marks the operator's own row for labeling. */
export type ComparisonEntity = {
  competitor_id: string
  competitor_name: string
  isYou: boolean
  days: Array<{
    day_of_week: number
    hourly_scores: number[]
    peak_hour: number
    peak_score: number
    typical_time_spent: string | null
  }>
}

/** A single you-vs-them row for the kit TkH2HBars (serializable — no fns). */
export type ComparisonH2HRow = {
  metric: string
  side: "you" | "them"
  width: number
  verdict: string
  tip: string
  tipValue: string
}

export type CompetitorComparison = {
  /** Own location + each competitor that has busy-times data, own row first. */
  entities: ComparisonEntity[]
  /** You-vs-each-competitor on crowd pull (busy-times peak). Empty when the
   *  operator's own curve has not been pulled yet (we never fake a "you" value). */
  h2h: ComparisonH2HRow[]
  /** True when at least one competitor has busy-times data (heatmap is worth showing). */
  hasCompetitorData: boolean
  /** True when the operator's own busy-times curve is available (enables the H2H). */
  hasOwnData: boolean
}

type BusyRow = {
  day_of_week: number
  hourly_scores: number[] | null
  peak_hour: number | null
  peak_score: number | null
  typical_time_spent: string | null
}

function rowsToDays(rows: BusyRow[]): ComparisonEntity["days"] {
  return rows
    .filter((r) => Array.isArray(r.hourly_scores) && r.hourly_scores.length > 0)
    .map((r) => ({
      day_of_week: r.day_of_week,
      hourly_scores: r.hourly_scores as number[],
      peak_hour: r.peak_hour ?? 0,
      peak_score: r.peak_score ?? 0,
      typical_time_spent: r.typical_time_spent ?? null,
    }))
}

function avgPeak(days: ComparisonEntity["days"]): number {
  if (days.length === 0) return 0
  return Math.round(days.reduce((s, d) => s + d.peak_score, 0) / days.length)
}

/** Busy-times + head-to-head for the operator's competitor set. Own curve from
 *  `location_busy_times`, competitor curves from `busy_times` (scoped to THIS
 *  location's competitors). User-scoped client → RLS enforced. */
export async function loadCompetitorComparison(): Promise<CompetitorComparison> {
  const op = await resolveOperator()
  const sb = await createServerSupabaseClient()

  // Approved + active competitors for this location (same gate as the roster), so
  // the busy_times query is narrowed to ids this operator is allowed to read.
  const { data: comps } = await sb
    .from("competitors")
    .select("id, name, metadata")
    .eq("location_id", op.locationId)
    .eq("is_active", true)
  const approved = (comps ?? []).filter(
    (c) => (c.metadata as Record<string, unknown> | null)?.status === "approved"
  )
  const nameById = new Map(approved.map((c) => [c.id, c.name ?? "Competitor"]))
  const competitorIds = approved.map((c) => c.id)

  // Competitor curves (RLS: org members read their own competitors' rows). Newest
  // first so the first row per (competitor, day) wins when several pulls are stored.
  const { data: busyRaw } = competitorIds.length
    ? await sb
        .from("busy_times")
        .select("competitor_id, day_of_week, hourly_scores, peak_hour, peak_score, typical_time_spent, created_at")
        .in("competitor_id", competitorIds)
        .order("created_at", { ascending: false })
    : { data: [] }

  // Own location curve (RLS: org members read their location's rows).
  const { data: ownRaw } = await sb
    .from("location_busy_times")
    .select("day_of_week, hourly_scores, peak_hour, peak_score")
    .eq("location_id", op.locationId)

  // Group competitor rows, keeping ONE row per (competitor, day) — the newest.
  const byComp = new Map<string, Map<number, BusyRow>>()
  for (const r of (busyRaw ?? []) as Array<BusyRow & { competitor_id: string }>) {
    const days = byComp.get(r.competitor_id) ?? new Map<number, BusyRow>()
    if (!days.has(r.day_of_week)) days.set(r.day_of_week, r)
    byComp.set(r.competitor_id, days)
  }

  const competitorEntities: ComparisonEntity[] = [...byComp.entries()]
    .map(([cid, days]) => ({
      competitor_id: cid,
      competitor_name: nameById.get(cid) ?? "Competitor",
      isYou: false,
      days: rowsToDays([...days.values()]),
    }))
    .filter((e) => e.days.length > 0)

  const ownDays = rowsToDays(
    ((ownRaw ?? []) as BusyRow[]).map((r) => ({ ...r, typical_time_spent: null })),
  )
  const ownEntity: ComparisonEntity = {
    competitor_id: "__you__",
    competitor_name: op.locationName,
    isYou: true,
    days: ownDays,
  }

  const hasOwnData = ownDays.length > 0
  const hasCompetitorData = competitorEntities.length > 0

  // Own row leads the heatmap selector when we have it.
  const entities = hasOwnData ? [ownEntity, ...competitorEntities] : competitorEntities

  // ── Head-to-head on crowd pull (busy-times peak). Only when we have BOTH a real
  //    own curve and at least one competitor curve — otherwise no honest "you" value
  //    exists and we leave h2h empty (the page renders the gap, never a fake bar).
  //    Magnitude mirrors VisibilityH2H: a bigger gap → a longer bar (20–100). ──
  let h2h: ComparisonH2HRow[] = []
  if (hasOwnData && hasCompetitorData) {
    const ownAvg = avgPeak(ownDays)
    h2h = competitorEntities
      .map((c) => ({ name: c.competitor_name, peak: avgPeak(c.days) }))
      .sort((a, b) => b.peak - a.peak)
      .slice(0, 6)
      .map(({ name, peak }) => {
        const youAhead = ownAvg >= peak
        const hi = Math.max(ownAvg, peak, 1)
        const lo = Math.min(ownAvg, peak)
        const ratio = Math.min(1, lo / Math.max(hi, 0.0001))
        const width = Math.round((1 - ratio) * 80) + 20
        return {
          metric: name,
          side: (youAhead ? "you" : "them") as "you" | "them",
          width,
          verdict: youAhead ? "You draw more" : "They draw more",
          tip: youAhead
            ? `Your block runs busier at peak (${ownAvg}% vs ${peak}% of own typical peak)`
            : `${name} runs busier at peak (${peak}% vs your ${ownAvg}% of own typical peak)`,
          tipValue: `You ${ownAvg}% · them ${peak}%`,
        }
      })
  }

  return { entities, h2h, hasCompetitorData, hasOwnData }
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
