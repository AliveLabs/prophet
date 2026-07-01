// Authed data loader for the reworked operator experience (Stage A port of
// app/preview/preview-data.ts). Same query shapes, but resolved from the LOGGED-IN
// user via the user-scoped server client — RLS enforces org membership on every read.

import { redirect } from "next/navigation"
import { cacheTag, cacheLife } from "next/cache"
import { requireUser } from "@/lib/auth/server"
import { getAdminContext } from "@/lib/auth/platform-admin"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getBrief } from "@/lib/insights/daily-brief"
import type { Brief } from "@/lib/skills/types"
import { typeToCuisine } from "@/lib/places/format"
import { parseWeekdayDescriptions } from "@/lib/competitors/open-hours"
import type { HoursEntity, HoursDay } from "./competitors/competitor-hours-grid"
import type { ScorecardMetric, ScorecardPoint } from "./competitors/competitor-scorecard"
import { fetchPlaceDetails } from "@/lib/places/google"
import { fetchPhotosPageData } from "@/lib/cache/photos"
import { fetchVisibilityPageData } from "@/lib/cache/visibility"
import { buildEntityPhotoProfile, type PhotoRow } from "@/lib/places/listing-audit"
import type {
  DomainRankSnapshot,
  NormalizedRankedKeyword,
  NormalizedOrganicCompetitor,
} from "@/lib/seo/types"

/** Map DB subscription_tier values (entry/mid/top + legacy) to display labels.
 *  'free' is a legacy pre-migration value — those orgs are trials (of Tier 2). */
export function tierLabel(t: string): string {
  const m: Record<string, string> = {
    entry: "Tier 1", mid: "Tier 2", top: "Tier 3",
    tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3", free: "Trial",
  }
  return m[t] ?? t
}

/** Resolve the name to SHOW for an entity carrying an optional operator-set display label
 *  over a canonical source name (ALT-225). The raw source `name` stays the source of truth
 *  for matching / de-dup; this is display-only and never leaks an empty string. */
export function resolveDisplayName(
  label: string | null | undefined,
  name: string | null | undefined,
  fallback: string,
): string {
  const l = label?.trim()
  if (l) return l
  const n = name?.trim()
  return n || fallback
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
    .select("id, name, display_label, metadata")
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

  // ALT-186 — freshest rating per competitor from the latest persisted snapshot
  // (same precedence the detail page uses). The overview previously read ONLY
  // metadata.placeDetails.rating, which the discover→approve flow never populates
  // (it stores the rating at metadata.rating + drops it from placeDetails), so most
  // competitors showed "pending" forever even with the rating present. We read the
  // newest snapshot profile here, then fall back through placeDetails → metadata.
  const competitorIds = approved.map((c) => c.id)
  const ratingByComp = new Map<string, { rating: number | null; reviewCount: number | null }>()
  if (competitorIds.length) {
    const { data: snapRows } = await sb
      .from("snapshots")
      .select("competitor_id, raw_data, date_key")
      .in("competitor_id", competitorIds)
      .order("date_key", { ascending: false })
    for (const row of snapRows ?? []) {
      const cid = row.competitor_id as string
      if (ratingByComp.has(cid)) continue // newest wins (rows are date-desc)
      const profile = (row.raw_data as { profile?: Record<string, unknown> } | null)?.profile ?? null
      ratingByComp.set(cid, {
        rating: (profile?.rating as number | null) ?? null,
        reviewCount: (profile?.reviewCount as number | null) ?? null,
      })
    }
  }

  const competitors: OperatorCompetitor[] = approved.map((c) => {
    const meta = c.metadata as Record<string, unknown> | null
    const pd = (meta?.placeDetails as Record<string, unknown> | null) ?? null
    const snap = ratingByComp.get(c.id)
    const agg = byComp.get(c.id)
    return {
      id: c.id,
      // ALT-225 — operator's display label wins over the canonical Google name (display-only).
      name: resolveDisplayName(c.display_label as string | null, c.name, "Competitor"),
      // Snapshot (freshest) → placeDetails → top-level metadata. The metadata fallback
      // is what unblocks discover→approve competitors whose rating lives at metadata.rating.
      rating:
        (snap?.rating ?? null) ??
        (pd?.rating as number | null) ??
        (meta?.rating as number | null) ??
        null,
      reviewCount:
        (snap?.reviewCount ?? null) ??
        (pd?.reviewCount as number | null) ??
        (meta?.reviewCount as number | null) ??
        null,
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
// ALT-195 — competitor swap cooldown (1 swap / 30 days), derived from existing
// competitor timestamps (no migration). A "swap" begins when the operator REMOVES
// a competitor, so the clock is keyed off the most recent removal: a deactivated
// (status: "ignored") competitor's updated_at. Adds are never blocked — the operator
// can always re-fill the slot they just freed; only a SECOND removal inside the
// window is the locked action. computeSwapCooldown turns that moment into lock state.
//
// CAVEAT (flagged in the report): updated_at is touched by any write to the row, not
// only the removal. In practice an ignored competitor isn't written again, so its
// updated_at is the removal time; a dedicated removed_at column (a migration) would
// make this exact. Good enough for the cooldown without a schema change.
// ─────────────────────────────────────────────────────────────────────────────
export async function loadCompetitorSwapState(): Promise<{ lastRemovalAt: string | null }> {
  const op = await resolveOperator()
  const sb = await createServerSupabaseClient()
  const { data: rows } = await sb
    .from("competitors")
    .select("updated_at, metadata")
    .eq("location_id", op.locationId)
    .eq("is_active", false)

  let lastRemovalAt: string | null = null
  for (const r of rows ?? []) {
    const status = (r.metadata as Record<string, unknown> | null)?.status
    if (status !== "ignored") continue
    const ts = r.updated_at as string | null
    if (ts && (!lastRemovalAt || ts > lastRemovalAt)) lastRemovalAt = ts
  }
  return { lastRemovalAt }
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

export type CompetitorComparison = {
  /** "Who's busy when" — open hours + busy rhythm by day. Own row first (its hours
   *  read as unavailable until cached — we never make a paid Places call here), then
   *  each approved competitor. Hours come from the cached Google profile with the
   *  Outscraper working-hours fallback (ALT-264); busy from busy_times.
   *  (The crowd-pull h2h and the weekly heatmap were retired — ALT-262/263: the
   *  %-of-own-peak score can't honestly compare magnitude across venues.) */
  hoursEntities: HoursEntity[]
  /** Day-of-week (0=Sun) to open the day selector on — the operator's "today". */
  todayDow: number
}

const UNKNOWN_DAY = { known: false, open: false, is24h: false, intervals: [] } as const

/** Pull the cached Google opening-hours lines off a competitor's stored metadata
 *  (regular hours first, current hours as fallback). No paid call — render what's
 *  cached, else null ⇒ the row shows an honest "hours unavailable". */
function cachedWeekdayDescriptions(meta: Record<string, unknown> | null): string[] | null {
  const pd = (meta?.placeDetails as Record<string, unknown> | null) ?? null
  const reg = (pd?.regularOpeningHours as { weekdayDescriptions?: string[] } | null) ?? null
  const cur = (pd?.currentOpeningHours as { weekdayDescriptions?: string[] } | null) ?? null
  // ALT-264 — the busy-times pull caches the same place's posted hours under
  // metadata.outscraperHours (traffic pipeline); use it when the Places profile
  // never landed. Most of the watched set only has the Outscraper read.
  const osh = (meta?.outscraperHours as { weekdayDescriptions?: string[] } | null) ?? null
  const wd = reg?.weekdayDescriptions ?? cur?.weekdayDescriptions ?? osh?.weekdayDescriptions
  return Array.isArray(wd) && wd.length > 0 ? wd : null
}

/** Merge parsed open hours (by day-of-week) with the busy curve (by day-of-week)
 *  into the serializable per-entity shape the open-hours bar renders. A day is kept
 *  when it has EITHER readable hours or a busy curve; days with neither are dropped. */
function buildHoursEntity(
  id: string,
  name: string,
  isYou: boolean,
  weekdayDescriptions: string[] | null,
  busyDays: Map<number, BusyRow> | undefined,
): HoursEntity {
  const byDay = parseWeekdayDescriptions(weekdayDescriptions)
  const hoursKnown = Object.values(byDay).some((d) => d.known)
  const days: HoursDay[] = []
  for (let d = 0; d < 7; d++) {
    const h = byDay[d]
    const busy = busyDays?.get(d)
    const scores =
      busy && Array.isArray(busy.hourly_scores) && busy.hourly_scores.length > 0
        ? (busy.hourly_scores as number[])
        : null
    if (!h && !scores) continue
    days.push({ day_of_week: d, hours: h ?? UNKNOWN_DAY, hourly_scores: scores })
  }
  return { competitor_id: id, name, isYou, days, hoursKnown }
}

type BusyRow = {
  day_of_week: number
  hourly_scores: number[] | null
  peak_hour: number | null
  peak_score: number | null
  typical_time_spent: string | null
}

/** Open-hours + busy rhythm for the operator's competitor set. Own curve from
 *  `location_busy_times`, competitor curves from `busy_times` (scoped to THIS
 *  location's competitors). User-scoped client → RLS enforced. */
export async function loadCompetitorComparison(): Promise<CompetitorComparison> {
  const op = await resolveOperator()
  const sb = await createServerSupabaseClient()

  // Approved + active competitors for this location (same gate as the roster), so
  // the busy_times query is narrowed to ids this operator is allowed to read.
  const { data: comps } = await sb
    .from("competitors")
    .select("id, name, display_label, metadata")
    .eq("location_id", op.locationId)
    .eq("is_active", true)
  const approved = (comps ?? []).filter(
    (c) => (c.metadata as Record<string, unknown> | null)?.status === "approved"
  )
  // ALT-225 — show the operator's display label (falls back to the canonical name).
  const nameById = new Map(
    approved.map((c) => [c.id, resolveDisplayName(c.display_label as string | null, c.name, "Competitor")]),
  )
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

  // ── "Who's busy when": open hours (cached Google profile) + busy by day.
  //    Own row leads (its hours read as unavailable until a cached source exists —
  //    we never make a paid Places call here), then each approved competitor whose
  //    cached metadata carries opening hours and/or has a busy curve. ──
  const ownBusyByDay = new Map<number, BusyRow>()
  for (const r of (ownRaw ?? []) as BusyRow[]) {
    if (!ownBusyByDay.has(r.day_of_week)) ownBusyByDay.set(r.day_of_week, { ...r, typical_time_spent: null })
  }
  // Own open hours from the cached snapshot the insights pipeline persists (provider
  // "google_hours") — no paid Places call here. Absent ⇒ the own row reads "unavailable".
  const { data: ownHoursSnap } = await sb
    .from("location_snapshots")
    .select("raw_data")
    .eq("location_id", op.locationId)
    .eq("provider", "google_hours")
    .order("date_key", { ascending: false })
    .limit(1)
    .maybeSingle()
  const ownWeekdayDescriptions =
    (ownHoursSnap?.raw_data as { weekdayDescriptions?: string[] } | null)?.weekdayDescriptions ?? null

  const hoursEntities: HoursEntity[] = []
  const ownHours = buildHoursEntity("__you__", op.locationName, true, ownWeekdayDescriptions, ownBusyByDay)
  if (ownHours.days.length > 0) hoursEntities.push(ownHours)
  for (const c of approved) {
    const he = buildHoursEntity(
      c.id,
      nameById.get(c.id) ?? "Competitor",
      false,
      cachedWeekdayDescriptions((c.metadata as Record<string, unknown> | null) ?? null),
      byComp.get(c.id),
    )
    if (he.days.length > 0) hoursEntities.push(he)
  }
  const todayDow = new Date().getDay()

  return { hoursEntities, todayDow }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALT-262 — "Where you stand": the head-to-head scorecard. Every metric is
// ABSOLUTE and comparable across venues (stars, counts, shares) — the retired
// crowd-pull %-of-own-peak read never appears here. Each metric fails soft:
// a side with no data drops the row (or the point), never a fabricated value.
// ─────────────────────────────────────────────────────────────────────────────

/** Own listing profile (rating + review count) via one Places call, cached a day —
 *  keyed by placeId, so every operator page view doesn't re-bill the API. */
async function fetchOwnPlaceProfile(
  placeId: string,
): Promise<{ rating: number | null; reviewCount: number | null }> {
  "use cache"
  cacheTag(`own-place-profile:${placeId}`) // place-scoped tag (params already key the cache; the tag matches for targeted invalidation)
  cacheLife({ revalidate: 86400 })
  try {
    const d = (await fetchPlaceDetails(placeId)) as {
      rating?: unknown
      userRatingCount?: unknown
    } | null
    return {
      rating: typeof d?.rating === "number" ? d.rating : null,
      reviewCount: typeof d?.userRatingCount === "number" ? d.userRatingCount : null,
    }
  } catch {
    return { rating: null, reviewCount: null }
  }
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase()
  } catch {
    return null
  }
}

/** Assemble one scorecard row from a you-value + competitor points. Returns null
 *  when either side is missing (no honest comparison exists). `closeRel` is the
 *  relative gap under which the row reads "Close" instead of a win/loss call. */
function finalizeMetric(input: {
  key: string
  label: string
  you: ScorecardPoint | null
  points: ScorecardPoint[]
  closeRel: number
  confidence: ScorecardMetric["confidence"]
  evidence: (leader: ScorecardPoint, you: ScorecardPoint) => string[]
  source: string
  href: string | null
}): (ScorecardMetric & { gap: number }) | null {
  const { you, points } = input
  if (!you || points.length === 0) return null
  const leader = points.reduce((best, p) => (p.value > best.value ? p : best), points[0])
  const youLeads = you.value >= leader.value
  const rel =
    Math.abs(leader.value) < 1e-9
      ? 0
      : Math.abs(leader.value - you.value) / Math.abs(leader.value)
  const status: ScorecardMetric["status"] = youLeads
    ? "lead"
    : rel <= input.closeRel
      ? "close"
      : "behind"
  const verdict = youLeads
    ? `You lead · ${you.display} vs ${leader.name}'s ${leader.display}`
    : `${leader.name} leads · ${leader.display} vs your ${you.display}`
  return {
    key: input.key,
    label: input.label,
    you,
    points,
    status,
    verdict,
    confidence: input.confidence,
    evidence: status === "lead" ? [] : input.evidence(leader, you),
    source: input.source,
    href: input.href,
    gap: youLeads ? -1 : rel,
  }
}

export type CompetitorScorecardData = { metrics: ScorecardMetric[] }

/** Load every honestly-comparable metric for the scorecard. Reuses the cached
 *  page-data loaders (photos / visibility — admin client behind "use cache",
 *  scoped by the ids WE resolved from the authed operator) plus user-scoped
 *  queries for social. Everything degrades row-by-row.
 *  `competitorRatings` comes from loadOperatorContext (ALT-186 snapshot-first
 *  precedence) so we don't re-run that resolution here. */
export async function loadCompetitorScorecard(
  competitorRatings: Array<{ id: string; rating: number | null; reviewCount: number | null }>,
): Promise<CompetitorScorecardData> {
  const op = await resolveOperator()
  const sb = await createServerSupabaseClient()

  // Approved, active competitors (same gate as the roster) + display names.
  const { data: comps } = await sb
    .from("competitors")
    .select("id, name, display_label, website, metadata")
    .eq("location_id", op.locationId)
    .eq("is_active", true)
  const approved = (comps ?? []).filter(
    (c) => (c.metadata as Record<string, unknown> | null)?.status === "approved",
  )
  const nameById = new Map(
    approved.map((c) => [
      c.id,
      resolveDisplayName(c.display_label as string | null, c.name, "Competitor"),
    ]),
  )
  const competitorIds = approved.map((c) => c.id)
  if (competitorIds.length === 0) return { metrics: [] }

  // Own place id (rating/review source) — no row means those two rows drop.
  const { data: loc } = await sb
    .from("locations")
    .select("primary_place_id")
    .eq("id", op.locationId)
    .maybeSingle()
  const ownPlaceId = (loc?.primary_place_id as string | null) ?? null

  const [ownProfile, photosData, visData, socialProfiles] = await Promise.all([
    ownPlaceId
      ? fetchOwnPlaceProfile(ownPlaceId)
      : Promise.resolve({ rating: null, reviewCount: null }),
    fetchPhotosPageData(op.locationId, competitorIds).catch(() => null),
    fetchVisibilityPageData(op.locationId).catch(() => null),
    // Social: profiles for own location + competitors (user-scoped, RLS enforced).
    (async () => {
      const [locP, compP] = await Promise.all([
        sb
          .from("social_profiles")
          .select("id, entity_type, entity_id, platform")
          .eq("entity_type", "location")
          .eq("entity_id", op.locationId),
        sb
          .from("social_profiles")
          .select("id, entity_type, entity_id, platform")
          .eq("entity_type", "competitor")
          .in("entity_id", competitorIds),
      ])
      return [...(locP.data ?? []), ...(compP.data ?? [])]
    })().catch(() => []),
  ])

  const rows: Array<(ScorecardMetric & { gap: number }) | null> = []

  // ── Rating + review count (Google) — competitors from the roster snapshots,
  //    own from the cached Places profile. ──
  const compRatings = competitorRatings.filter((c) => competitorIds.includes(c.id))
  rows.push(
    finalizeMetric({
      key: "rating",
      label: "Rating",
      you:
        ownProfile.rating != null
          ? { id: null, name: op.locationName, value: ownProfile.rating, display: `${ownProfile.rating.toFixed(1)}★` }
          : null,
      points: compRatings
        .filter((c) => c.rating != null)
        .map((c) => ({
          id: c.id,
          name: nameById.get(c.id) ?? "Competitor",
          value: c.rating as number,
          display: `${(c.rating as number).toFixed(1)}★`,
        })),
      closeRel: 0.03, // ≈0.15★ at 4.5+
      confidence: "high",
      evidence: (leader, you) => [
        `${leader.name} holds ${leader.display} — you hold ${you.display}. Star gaps this size move which listing gets the tap in local results.`,
        `Ratings shift slowly: steady review flow and replies are the honest lever, not a sprint.`,
      ],
      source: "Google listing profiles",
      href: null,
    }),
  )
  rows.push(
    finalizeMetric({
      key: "reviews",
      label: "Review base",
      you:
        ownProfile.reviewCount != null
          ? {
              id: null,
              name: op.locationName,
              value: ownProfile.reviewCount,
              display: ownProfile.reviewCount.toLocaleString(),
            }
          : null,
      points: compRatings
        .filter((c) => c.reviewCount != null)
        .map((c) => ({
          id: c.id,
          name: nameById.get(c.id) ?? "Competitor",
          value: c.reviewCount as number,
          display: (c.reviewCount as number).toLocaleString(),
        })),
      closeRel: 0.1,
      confidence: "high",
      evidence: (leader, you) => [
        `${leader.name} has ${leader.display} reviews to your ${you.display} — roughly ${Math.max(1, Math.round(leader.value / Math.max(1, you.value)))}× your base. Review volume compounds local visibility.`,
        `A review ask at the register or on receipts is the cheapest way to close a base gap.`,
      ],
      source: "Google listing profiles",
      href: null,
    }),
  )

  // ── Listing photo coverage — % of essential photo types present. ──
  if (photosData) {
    const ownP = buildEntityPhotoProfile(photosData.ownPhotos as unknown as PhotoRow[])
    const byComp = new Map<string, PhotoRow[]>()
    for (const p of photosData.photos) {
      const list = byComp.get(p.competitor_id) ?? []
      list.push(p as unknown as PhotoRow)
      byComp.set(p.competitor_id, list)
    }
    const coveragePct = (p: ReturnType<typeof buildEntityPhotoProfile>): number =>
      p.essentialTotal > 0 ? Math.round((p.essentialCovered / p.essentialTotal) * 100) : 0
    const points: ScorecardPoint[] = []
    const profiles = new Map<string, ReturnType<typeof buildEntityPhotoProfile>>()
    for (const [cid, list] of byComp) {
      const prof = buildEntityPhotoProfile(list)
      if (prof.total === 0) continue
      profiles.set(cid, prof)
      points.push({
        id: cid,
        name: nameById.get(cid) ?? "Competitor",
        value: coveragePct(prof),
        display: `${prof.essentialCovered}/${prof.essentialTotal} covered`,
      })
    }
    rows.push(
      finalizeMetric({
        key: "photos",
        label: "Listing photos",
        you:
          ownP.total > 0
            ? {
                id: null,
                name: op.locationName,
                value: coveragePct(ownP),
                display: `${ownP.essentialCovered}/${ownP.essentialTotal} covered`,
              }
            : null,
        points,
        closeRel: 0.05,
        confidence: "medium",
        evidence: (leader) => {
          const lp = leader.id ? profiles.get(leader.id) : null
          const bits = [
            `${leader.name} covers ${leader.display.replace(" covered", "")} of the photo types diners check first — you cover ${ownP.essentialCovered}/${ownP.essentialTotal}.`,
          ]
          if (lp && lp.professionalShare > ownP.professionalShare) {
            bits.push(
              `${Math.round(lp.professionalShare * 100)}% of their listing photos read as professionally shot, vs ${Math.round(ownP.professionalShare * 100)}% of yours.`,
            )
          }
          return bits
        },
        source: "Google listing photos, vision-analyzed",
        href: "/photos",
      }),
    )
  }

  // ── Local search visibility — estimated monthly search traffic (ETV), matched
  //    to watched competitors by website domain. ──
  if (visData) {
    const rankData = (visData.snapshots["seo_domain_rank_overview"]?.raw_data ?? null) as DomainRankSnapshot | null
    const rankedKeywords = (((visData.snapshots["seo_ranked_keywords"]?.raw_data as Record<string, unknown>)?.keywords ??
      []) as NormalizedRankedKeyword[])
    let ownEtv = 0
    const rankHasData =
      rankData && ((rankData.organic?.etv ?? 0) > 0 || (rankData.organic?.rankedKeywords ?? 0) > 0)
    if (rankHasData) {
      ownEtv = Math.round(rankData?.organic?.etv ?? 0)
    } else if (rankedKeywords.length > 0) {
      // Same CTR model the Visibility page uses when the domain overview is empty.
      ownEtv = rankedKeywords.reduce((sum, kw) => {
        const vol = kw.searchVolume ?? 0
        const rank = kw.rank
        const ctr =
          rank === 1 ? 0.3 : rank === 2 ? 0.15 : rank === 3 ? 0.1 : rank <= 5 ? 0.06 : rank <= 10 ? 0.03 : rank <= 20 ? 0.01 : 0.005
        return sum + Math.round(vol * ctr)
      }, 0)
    }
    const cdSnap = visData.snapshots["seo_competitors_domain"]
    const organicCompetitors = (((cdSnap?.raw_data as Record<string, unknown>)?.competitors ??
      []) as NormalizedOrganicCompetitor[])
    const hostToWatched = new Map<string, { id: string; name: string }>()
    for (const c of approved) {
      const h = hostOf(c.website as string | null)
      if (h) hostToWatched.set(h, { id: c.id, name: nameById.get(c.id) ?? c.name })
    }
    const points: ScorecardPoint[] = []
    for (const oc of organicCompetitors) {
      const watched = hostToWatched.get((oc.domain ?? "").replace(/^www\./, "").toLowerCase())
      if (!watched) continue
      points.push({
        id: watched.id,
        name: watched.name,
        value: Math.round(oc.organicEtv ?? 0),
        display: `~${Math.round(oc.organicEtv ?? 0).toLocaleString()}/mo`,
      })
    }
    rows.push(
      finalizeMetric({
        key: "visibility",
        label: "Search visibility",
        you:
          ownEtv > 0
            ? { id: null, name: op.locationName, value: ownEtv, display: `~${ownEtv.toLocaleString()}/mo` }
            : null,
        points,
        closeRel: 0.1,
        confidence: "medium",
        evidence: (leader, you) => [
          `${leader.name}'s site draws an estimated ${leader.display.replace("~", "")} visits from search — yours draws ${you.display.replace("~", "")}.`,
          `The Visibility page shows which searches they rank for that you don't.`,
        ],
        source: "Search ranking data (estimated traffic)",
        href: "/visibility",
      }),
    )
  }

  // ── Social engagement — best-platform engagement rate per entity. ──
  if (socialProfiles.length > 0) {
    const profileIds = socialProfiles.map((p) => p.id as string)
    const { data: snaps } = await sb
      .from("social_snapshots")
      .select("social_profile_id, raw_data, date_key")
      .in("social_profile_id", profileIds)
      .order("date_key", { ascending: false })
    const latest = new Map<string, Record<string, unknown>>()
    for (const s of snaps ?? []) {
      if (!latest.has(s.social_profile_id as string)) {
        latest.set(s.social_profile_id as string, (s.raw_data ?? {}) as Record<string, unknown>)
      }
    }
    type SocialBest = { rate: number; cadence: number; platform: string }
    const bestByEntity = new Map<string, SocialBest>()
    for (const p of socialProfiles) {
      const snap = latest.get(p.id as string)
      const agg = (snap?.aggregateMetrics ?? null) as {
        engagementRate?: number
        postingFrequencyPerWeek?: number
      } | null
      if (!agg || typeof agg.engagementRate !== "number") continue
      const entityKey = `${p.entity_type}:${p.entity_id}`
      const cur = bestByEntity.get(entityKey)
      if (!cur || agg.engagementRate > cur.rate) {
        bestByEntity.set(entityKey, {
          rate: agg.engagementRate,
          cadence: agg.postingFrequencyPerWeek ?? 0,
          platform: p.platform as string,
        })
      }
    }
    const ownBest = bestByEntity.get(`location:${op.locationId}`) ?? null
    const points: ScorecardPoint[] = []
    for (const c of approved) {
      const b = bestByEntity.get(`competitor:${c.id}`)
      if (!b) continue
      points.push({
        id: c.id,
        name: nameById.get(c.id) ?? c.name,
        value: b.rate,
        display: `${b.rate.toFixed(1)}%`,
      })
    }
    const cadenceOf = (id: string | null): SocialBest | null =>
      id ? (bestByEntity.get(`competitor:${id}`) ?? null) : ownBest
    rows.push(
      finalizeMetric({
        key: "social",
        label: "Social engagement",
        you: ownBest
          ? { id: null, name: op.locationName, value: ownBest.rate, display: `${ownBest.rate.toFixed(1)}%` }
          : null,
        points,
        closeRel: 0.1,
        confidence: "medium",
        evidence: (leader, you) => {
          const lb = cadenceOf(leader.id)
          const bits = [
            `${leader.name} averages ${leader.display} engagement per post — you average ${you.display}.`,
          ]
          if (lb && lb.cadence > 0) {
            bits.push(
              `They post about ${lb.cadence.toFixed(1)}×/week on ${lb.platform} — consistent cadence is usually what earns that rate.`,
            )
          }
          return bits
        },
        source: "Social profiles, latest pull",
        href: "/social",
      }),
    )
  }

  // Worst gap first (a prioritized worklist), then close calls, then wins.
  const metrics = rows
    .filter((m): m is ScorecardMetric & { gap: number } => m != null)
    .sort((a, b) => b.gap - a.gap)
    .map((m) => {
      const { gap, ...rest } = m
      void gap // sort key only — not part of the serializable metric
      return rest
    })

  return { metrics }
}

export type CompetitorInsight = { type: string; title: string; summary: string | null; dateKey: string }
export type CompetitorDetail = {
  id: string
  /** Name to SHOW — the operator's display label when set, else the canonical name (ALT-225). */
  name: string
  /** The raw operator-set label (null when none) — for prefilling the label editor. */
  displayLabel: string | null
  /** The canonical Google Places name — shown as the editor placeholder/reference (ALT-225). */
  sourceName: string
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
    .select("id, name, display_label, metadata")
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
    name: resolveDisplayName(c.display_label as string | null, c.name, "Competitor"),
    displayLabel: (c.display_label as string | null) ?? null,
    sourceName: c.name ?? "Competitor",
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
