// ---------------------------------------------------------------------------
// Review Intelligence (ALT-347) — persistence for individual customer reviews.
// Called from the own-location GATHER paths (insights pipeline + dossier build)
// with whatever the Places feed returned this run; rows ACCUMULATE via upsert on
// the stable (location_id, source, source_review_id) key.
//
// LOUD, NOT SILENT: every write surfaces its errors on the result (the spine
// upsert lesson — a silent no-op in a fail-soft system is the worst failure
// mode). Callers stay best-effort (a persistence miss never blocks a build) but
// must log the returned errors.
//
// The upsert payload deliberately contains ONLY capture columns — scoring,
// triage, verdict, and draft columns are never in the payload, so an upsert on
// an existing row can't clobber them. first_seen_at is likewise omitted (set by
// the DB default on insert, untouched on update).
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CapturedReview, LocationReviewRow, ReviewerSignals } from "@/lib/reviews/types"
import type { NormalizedSnapshot } from "@/lib/providers/types"

// location_reviews post-dates the generated Database types (regen pending
// repo-wide) — same loose-client convention as insight_pool_entries.
type Store = SupabaseClient

export type ReviewWriteResult = { written: number; errors: string[] }

/** Reviewer identity fallback when the provider gives no author uri. */
export function normalizeAuthorKey(name: string | null | undefined): string | null {
  const n = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  return n.length > 0 ? `name:${n}` : null
}

/** Map a NormalizedSnapshot's recentReviews to captured reviews (rows without a
 *  stable provider id are skipped — we never synthesize an upsert key). */
export function capturedFromSnapshot(snapshot: NormalizedSnapshot | null): CapturedReview[] {
  const rows = snapshot?.recentReviews ?? []
  return rows
    .filter((r) => typeof r.sourceReviewId === "string" && r.sourceReviewId.length > 0)
    .map((r) => ({
      sourceReviewId: r.sourceReviewId as string,
      authorName: r.authorName ?? null,
      authorKey: r.authorUri ? `uri:${r.authorUri}` : normalizeAuthorKey(r.authorName),
      rating: typeof r.rating === "number" && r.rating >= 1 && r.rating <= 5 ? Math.round(r.rating) : null,
      text: r.text || null,
      publishedAt: r.publishedAt ?? null,
      relativePublished: r.date || null,
      googleMapsUri: r.googleMapsUri ?? null,
    }))
}

/** Upsert this run's captured reviews for an own location. Loud on errors. */
export async function upsertLocationReviews(
  supabase: Store,
  locationId: string,
  reviews: CapturedReview[],
  opts: { source?: string } = {},
): Promise<ReviewWriteResult> {
  const source = opts.source ?? "google_places"
  if (reviews.length === 0) return { written: 0, errors: [] }
  const now = new Date().toISOString()
  const payload = reviews.map((r) => ({
    location_id: locationId,
    source,
    source_review_id: r.sourceReviewId,
    author_name: r.authorName ?? null,
    author_key: r.authorKey ?? null,
    rating: r.rating ?? null,
    review_text: r.text ?? null,
    published_at: r.publishedAt ?? null,
    relative_published: r.relativePublished ?? null,
    google_maps_uri: r.googleMapsUri ?? null,
    last_seen_at: now,
    updated_at: now,
  }))
  const { error, count } = await supabase
    .from("location_reviews")
    .upsert(payload, { onConflict: "location_id,source,source_review_id", count: "exact" })
  if (error) return { written: 0, errors: [`location_reviews upsert: ${error.code ?? ""} ${error.message}`.trim()] }
  return { written: count ?? payload.length, errors: [] }
}

/** Triage-surface read: open first (caller filters), most severe first, fresh first. */
export async function listLocationReviews(
  supabase: Store,
  locationId: string,
  opts: { limit?: number } = {},
): Promise<LocationReviewRow[]> {
  const { data, error } = await supabase
    .from("location_reviews")
    .select("*")
    .eq("location_id", locationId)
    .order("severity_score", { ascending: false, nullsFirst: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 200)
  if (error) return [] // read path stays fail-soft (pre-migration → empty surface)
  return (data ?? []) as LocationReviewRow[]
}

/** Rows the scoring pass still owes (never scored, or scored by an older pass). */
export async function listUnscoredReviews(
  supabase: Store,
  locationId: string,
  scoreVersion: string,
  opts: { limit?: number } = {},
): Promise<LocationReviewRow[]> {
  const { data, error } = await supabase
    .from("location_reviews")
    .select("*")
    .eq("location_id", locationId)
    .or(`scored_at.is.null,score_version.neq.${scoreVersion}`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 60)
  if (error) return []
  return (data ?? []) as LocationReviewRow[]
}

/** Persist scoring results. Per-row update keyed by the stable review id; loud. */
export async function applyReviewScores(
  supabase: Store,
  locationId: string,
  scores: Array<{
    sourceReviewId: string
    authenticity_score: number
    authenticity_confidence: "low" | "medium" | "high"
    authenticity_rationale: string
    severity_score: number
    severity_rationale: string
    red_flags: string[]
  }>,
  scoreVersion: string,
  opts: { source?: string } = {},
): Promise<ReviewWriteResult> {
  const source = opts.source ?? "google_places"
  const now = new Date().toISOString()
  let written = 0
  const errors: string[] = []
  for (const s of scores) {
    const { error } = await supabase
      .from("location_reviews")
      .update({
        authenticity_score: s.authenticity_score,
        authenticity_confidence: s.authenticity_confidence,
        authenticity_rationale: s.authenticity_rationale,
        severity_score: s.severity_score,
        severity_rationale: s.severity_rationale,
        red_flags: s.red_flags,
        scored_at: now,
        score_version: scoreVersion,
        updated_at: now,
      })
      .eq("location_id", locationId)
      .eq("source", source)
      .eq("source_review_id", s.sourceReviewId)
    if (error) errors.push(`score update ${s.sourceReviewId}: ${error.code ?? ""} ${error.message}`.trim())
    else written += 1
  }
  return { written, errors }
}

/** Within-our-data reviewer aggregates (ALT-349). Pure TS over the local corpus —
 *  no LLM, no cross-platform lookups. Burst = 2+ reviews within 7 days. */
export function aggregateReviewerSignals(rows: LocationReviewRow[]): Map<string, ReviewerSignals> {
  const byAuthor = new Map<string, LocationReviewRow[]>()
  for (const row of rows) {
    if (!row.author_key) continue
    const list = byAuthor.get(row.author_key) ?? []
    list.push(row)
    byAuthor.set(row.author_key, list)
  }
  const out = new Map<string, ReviewerSignals>()
  for (const [key, list] of byAuthor) {
    const negatives = list.filter((r) => typeof r.rating === "number" && r.rating <= 2).length
    const times = list
      .map((r) => (r.published_at ? Date.parse(r.published_at) : NaN))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)
    let bursty = false
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] <= 7 * 24 * 60 * 60 * 1000) {
        bursty = true
        break
      }
    }
    out.set(key, {
      reviewCount: list.length,
      negativeShare: list.length > 0 ? negatives / list.length : 0,
      bursty,
    })
  }
  return out
}
