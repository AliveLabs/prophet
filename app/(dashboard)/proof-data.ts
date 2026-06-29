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
  /** ALT-174: permalink to the original post, when derivable. Null ⇒ hide the "open original" link. */
  postUrl: string | null
  /** ALT-175: true when the post is a video/reel — drives the "Video" badge on the card. */
  isVideo: boolean
}

export type CompetitorPhoto = {
  id: string
  imageUrl: string
  category: string | null
  detail: string | null
  promotional: string | null
  lastSeenAt: string | null
}

// ALT-173: a post's vision analysis must clear this confidence floor before we surface
// any AESTHETIC claim about the image ("good natural light", "strong plating", …). Below
// it — or when the analysis is the deterministic fallback (confidence 0.3, emitted when the
// image couldn't be read) — the claims aren't actually tied to the post, so we suppress them
// rather than credit a poorly-lit photo with "good natural light". 0.55 sits above the parsed
// default (0.5) and the fallback (0.3), so only a genuinely confident read produces a "why".
const WHY_CONFIDENCE_FLOOR = 0.55

/** One readable line on why a post landed, from the Gemini vision analysis. Returns null when
 *  there's no analysis OR when the analysis is too low-confidence to make verifiable claims —
 *  the caller surfaces an honest "no read yet" line instead of fabricating aesthetics (ALT-173). */
function whyItWorked(a: SocialPostAnalysis | undefined): string | null {
  if (!a) return null
  // Promotional detail is OCR'd on-image text, not an aesthetic judgement — keep it even at
  // lower confidence (it's quoted from the post, so it's verifiable).
  const promo = a.promotionalContent && a.promotionalDetails ? `promo: ${a.promotionalDetails}` : null

  // Aesthetic/visual claims are only honest above the confidence floor.
  const confident = typeof a.confidence === "number" && a.confidence >= WHY_CONFIDENCE_FLOOR
  const bits: string[] = []
  if (confident) {
    if (a.foodPresentation?.platingQuality === "high") bits.push("strong plating")
    if (a.foodPresentation?.colorVibrancy === "vibrant") bits.push("vibrant color")
    if (a.visualQuality?.lighting === "professional" || a.visualQuality?.composition === "professional")
      bits.push("professional shot")
    else if (a.visualQuality?.lighting === "natural_good") bits.push("good natural light")
    if (a.atmosphereSignals?.crowdLevel === "packed" || a.atmosphereSignals?.crowdLevel === "busy")
      bits.push("visibly busy room")
    if (a.brandSignals?.visualStyleConsistency === "on_brand") bits.push("on-brand look")
  }
  if (promo) bits.push(promo)
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
      const why = whyItWorked(p.visualAnalysis)
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
        why,
        postUrl: p.postUrl ?? null,
        isVideo: p.mediaType === "video" || p.mediaType === "reel",
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

/** This competitor's social handles (for the operator-facing manage-handles section on the
 *  competitor detail page). Scoped to the operator's location — a foreign id returns []
 *  (mirrors loadCompetitorProof). Shape matches <HandleManager />. */
export type ManagedHandle = {
  id: string
  platform: "instagram" | "facebook" | "tiktok"
  handle: string
  profileUrl: string | null
  discoveryMethod: "auto_scrape" | "data365_search" | "manual"
  isVerified: boolean
}

export async function loadCompetitorHandles(competitorId: string): Promise<ManagedHandle[]> {
  const op = await resolveOperator()
  const admin = createAdminSupabaseClient()
  const { data: comp } = await admin
    .from("competitors")
    .select("id")
    .eq("id", competitorId)
    .eq("location_id", op.locationId)
    .maybeSingle()
  if (!comp) return []

  const { data: rows } = await admin
    .from("social_profiles")
    .select("id, platform, handle, profile_url, discovery_method, is_verified")
    .eq("entity_type", "competitor")
    .eq("entity_id", competitorId)
    .order("platform", { ascending: true })

  return (rows ?? []).map((r) => ({
    id: r.id as string,
    platform: r.platform as ManagedHandle["platform"],
    handle: r.handle as string,
    profileUrl: (r.profile_url as string | null) ?? null,
    discoveryMethod: r.discovery_method as ManagedHandle["discoveryMethod"],
    isVerified: !!r.is_verified,
  }))
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
