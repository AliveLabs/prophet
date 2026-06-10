// Evidence-layer loaders (complete-picture · Batch 1) — the proof behind the brief:
// rivals' actual posts (persisted images + engagement + vision analysis), their Places
// photos, and the true per-source pipeline_runs health. System tables are read with the
// admin client AFTER resolving the operator through RLS (same pattern as getBrief);
// every query is scoped to entities owned by the operator's location.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { classifyNow, isUsable } from "@/lib/freshness/contract"
import { socialContentAsOf } from "@/lib/freshness/extract"
import type { SocialSnapshotData, NormalizedSocialPost, SocialPostAnalysis } from "@/lib/social/types"
import type { PhotoAnalysis } from "@/lib/providers/photos"
import { resolveOperator } from "./operator-data"

export type ProofPost = {
  id: string
  entityId: string
  entityName: string
  platform: string
  handle: string
  imageUrl: string | null
  text: string | null
  createdTime: string | null
  likes: number
  comments: number
  shares: number
  views: number | null
  category: string | null
  why: string | null
}

export type CompetitorPhoto = {
  id: string
  imageUrl: string
  category: string | null
  detail: string | null
  promotional: string | null
  lastSeenAt: string | null
}

/** One readable line on why a post landed, from the Gemini vision analysis. */
function whyItWorked(a: SocialPostAnalysis | undefined): string | null {
  if (!a) return null
  const bits: string[] = []
  if (a.foodPresentation?.platingQuality === "high") bits.push("strong plating")
  if (a.foodPresentation?.colorVibrancy === "vibrant") bits.push("vibrant color")
  if (a.visualQuality?.lighting === "professional" || a.visualQuality?.composition === "professional")
    bits.push("professional shot")
  else if (a.visualQuality?.lighting === "natural_good") bits.push("good natural light")
  if (a.atmosphereSignals?.crowdLevel === "packed" || a.atmosphereSignals?.crowdLevel === "busy")
    bits.push("visibly busy room")
  if (a.brandSignals?.visualStyleConsistency === "on_brand") bits.push("on-brand look")
  if (a.promotionalContent && a.promotionalDetails) bits.push(`promo: ${a.promotionalDetails}`)
  if (bits.length === 0) return null
  return bits.join(" · ")
}

function categoryLabel(a: SocialPostAnalysis | undefined): string | null {
  if (!a) return null
  return a.subcategory || a.contentCategory.replace(/_/g, " ")
}

function engagement(p: NormalizedSocialPost): number {
  return (p.likesCount ?? 0) + (p.commentsCount ?? 0) * 2 + (p.sharesCount ?? 0) * 3
}

/** Latest USABLE social snapshot per verified profile for the given entities, flattened
 *  to posts and ranked by engagement. Dormant/empty accounts contribute nothing — the
 *  same read-side freshness gate the dossier applies. */
async function loadProofForEntities(
  entities: Array<{ id: string; name: string }>,
  opts: { limit: number; perEntity: number }
): Promise<ProofPost[]> {
  if (entities.length === 0) return []
  const admin = createAdminSupabaseClient()
  const nameById = new Map(entities.map((e) => [e.id, e.name]))

  const { data: profiles } = await admin
    .from("social_profiles")
    .select("id, entity_id, platform, handle")
    .in("entity_id", entities.map((e) => e.id))
    .eq("is_verified", true)
  if (!profiles || profiles.length === 0) return []

  const { data: snaps } = await admin
    .from("social_snapshots")
    .select("social_profile_id, raw_data, captured_at, content_as_of, date_key")
    .in("social_profile_id", profiles.map((p) => p.id))
    .order("date_key", { ascending: false })

  const latest = new Map<string, { raw: SocialSnapshotData; capturedAt: string; contentAsOf: string | null }>()
  for (const s of snaps ?? []) {
    if (!latest.has(s.social_profile_id)) {
      latest.set(s.social_profile_id, {
        raw: s.raw_data as unknown as SocialSnapshotData,
        capturedAt: s.captured_at,
        contentAsOf: s.content_as_of,
      })
    }
  }

  const all: ProofPost[] = []
  for (const profile of profiles) {
    const snap = latest.get(profile.id)
    if (!snap?.raw?.recentPosts?.length) continue

    // Freshness gate — self-computes content recency pre-backfill, like the dossier.
    const extracted = socialContentAsOf(snap.raw as unknown as Record<string, unknown>)
    const status = classifyNow({
      contentAsOf: snap.contentAsOf ?? extracted.contentAsOf,
      capturedAt: snap.capturedAt,
      isEmpty: extracted.isEmpty,
      kind: "social",
    })
    if (!isUsable(status)) continue

    const entityName = nameById.get(profile.entity_id) ?? "Competitor"
    const posts = [...snap.raw.recentPosts]
      .sort((a, b) => engagement(b) - engagement(a))
      .slice(0, opts.perEntity)
    for (const p of posts) {
      all.push({
        id: `${profile.id}:${p.platformPostId}`,
        entityId: profile.entity_id,
        entityName,
        platform: profile.platform,
        handle: profile.handle,
        imageUrl: p.mediaUrl?.includes("supabase") ? p.mediaUrl : null,
        text: p.text,
        createdTime: p.createdTime ?? null,
        likes: p.likesCount ?? 0,
        comments: p.commentsCount ?? 0,
        shares: p.sharesCount ?? 0,
        views: p.viewsCount ?? null,
        category: categoryLabel(p.visualAnalysis),
        why: whyItWorked(p.visualAnalysis),
      })
    }
  }

  // Image-backed proof first, then engagement.
  const score = (p: ProofPost) => p.likes + p.comments * 2 + p.shares * 3
  return all
    .sort((a, b) => (a.imageUrl ? 0 : 1) - (b.imageUrl ? 0 : 1) || score(b) - score(a))
    .slice(0, opts.limit)
}

/** Proof grid for the brief detail pages: the watched rivals' strongest recent posts. */
export async function loadMarketProof(limit = 6): Promise<ProofPost[]> {
  const op = await resolveOperator()
  const admin = createAdminSupabaseClient()
  const { data: comps } = await admin
    .from("competitors")
    .select("id, name, metadata")
    .eq("location_id", op.locationId)
    .eq("is_active", true)
  const approved = (comps ?? []).filter(
    (c) => (c.metadata as Record<string, unknown> | null)?.status === "approved"
  )
  return loadProofForEntities(
    approved.map((c) => ({ id: c.id, name: c.name ?? "Competitor" })),
    { limit, perEntity: 3 }
  )
}

/** Posts + photos proof for ONE watched competitor (scoped to the operator's location —
 *  a foreign id returns empty, mirroring loadOperatorCompetitorDetail's 404 behavior). */
export async function loadCompetitorProof(
  competitorId: string
): Promise<{ posts: ProofPost[]; photos: CompetitorPhoto[] }> {
  const op = await resolveOperator()
  const admin = createAdminSupabaseClient()
  const { data: comp } = await admin
    .from("competitors")
    .select("id, name")
    .eq("id", competitorId)
    .eq("location_id", op.locationId)
    .maybeSingle()
  if (!comp) return { posts: [], photos: [] }

  const [posts, photosRes] = await Promise.all([
    loadProofForEntities([{ id: comp.id, name: comp.name ?? "Competitor" }], { limit: 9, perEntity: 9 }),
    admin
      .from("competitor_photos")
      .select("id, image_url, analysis_result, last_seen_at")
      .eq("competitor_id", competitorId)
      .not("image_url", "is", null)
      .order("last_seen_at", { ascending: false })
      .limit(8),
  ])

  const photos: CompetitorPhoto[] = (photosRes.data ?? []).map((row) => {
    const a = row.analysis_result as PhotoAnalysis | null
    return {
      id: row.id,
      imageUrl: row.image_url as string,
      category: a ? (a.subcategory || a.category?.replace(/_/g, " ") || null) : null,
      detail: a?.notable_changes || a?.tags?.slice(0, 3).join(" · ") || null,
      promotional: a?.promotional_content ? a.promotional_details || "Promotional content" : null,
      lastSeenAt: row.last_seen_at,
    }
  })

  return { posts, photos }
}

// ---------------------------------------------------------------------------
// "What we checked" — true per-source run outcomes from pipeline_runs.
// ---------------------------------------------------------------------------

const PIPELINE_LABELS: Record<string, string> = {
  content: "Menus & websites",
  visibility: "Search visibility",
  events: "Local events",
  photos: "Competitor photos",
  busy_times: "Foot traffic",
  weather: "Weather",
  social: "Social media",
  insights: "Signal synthesis",
}

export type PipelineCheck = {
  pipeline: string
  label: string
  outcome: string
  reason: string | null
  at: string
}

/** Latest run per pipeline for the operator's location — last tried / what happened. */
export async function loadPipelineChecks(): Promise<PipelineCheck[]> {
  const op = await resolveOperator()
  const admin = createAdminSupabaseClient()
  const { data: runs } = await admin
    .from("pipeline_runs")
    .select("pipeline, outcome, reason, started_at, finished_at")
    .eq("location_id", op.locationId)
    .order("started_at", { ascending: false })
    .limit(80)

  const latest = new Map<string, PipelineCheck>()
  for (const r of runs ?? []) {
    const pipeline = r.pipeline as string
    if (latest.has(pipeline)) continue
    latest.set(pipeline, {
      pipeline,
      label: PIPELINE_LABELS[pipeline] ?? pipeline.replace(/_/g, " "),
      outcome: r.outcome as string,
      reason: (r.reason as string | null) ?? null,
      at: (r.finished_at as string | null) ?? (r.started_at as string),
    })
  }
  // Stable order: the daily pipeline order, then anything else.
  const order = Object.keys(PIPELINE_LABELS)
  return [...latest.values()].sort(
    (a, b) =>
      (order.indexOf(a.pipeline) + 1 || order.length + 1) -
      (order.indexOf(b.pipeline) + 1 || order.length + 1)
  )
}
