"use server"

// Review Intelligence (ALT-353/354/355): server actions for the /reviews
// triage surface. All write through the USER-scoped Supabase client so the
// location_reviews org-member UPDATE policy IS the membership check (same
// pattern as setGenerosityThreshold): a non-member's update matches zero rows.
// COLUMN DISCIPLINE lives here (the migration's comment): the triage/verdict
// payloads touch triage_status/operator_verdict state ONLY, and the draft
// action touches draft_text/draft_generated_at ONLY. Scoring and capture
// columns are never written from an action.
//
// GUARDRAIL: triage/verdict state is workflow + provisional-signal capture
// only. It never feeds feedback-rollup or the band weights (ALT-246 rule).
//
// `location_reviews` isn't in the generated DB types until types regen — same
// loose-client cast convention as brief-actions.ts / settings/actions.ts.

import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { signalForReviewAction, type ReviewTriageAction } from "@/lib/reviews/review-signals"
import { listLocationReviews, aggregateReviewerSignals } from "@/lib/reviews/store"
import { recommendMakeGood, GENEROSITY_DEFAULT } from "@/lib/reviews/make-good"
import { generateReviewResponseDraft } from "@/lib/reviews/draft"
import type { LocationReviewRow } from "@/lib/reviews/types"
import { REVIEWS_COPY } from "./reviews-map"

// Provisional-signal capture (ALT-355): CONSOLE-LEVEL ONLY, no rollup writes —
// nothing consumes these yet (review-signals D5). Logging through the band's
// accessor keeps the action→signal mapping in ONE retunable place.
function captureReviewSignal(action: ReviewTriageAction, reviewId: string) {
  const signal = signalForReviewAction(action)
  console.info(`[review-signals] ${action} review=${reviewId}`, signal)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type TriageStatus = "open" | "responded" | "dismissed"
type OperatorVerdict = "genuine" | "not_genuine"
const VALID_TRIAGE = new Set<TriageStatus>(["open", "responded", "dismissed"])
const VALID_VERDICT = new Set<OperatorVerdict>(["genuine", "not_genuine"])

// update → eq → select so the RLS-scoped write reports whether it matched a row:
// zero rows back = not this user's review (or a stale id) — loud, never silent.
type ReviewUpdater = {
  from: (t: string) => {
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => {
        select: (cols: string) => Promise<{
          data: Array<{ id: string }> | null
          error: { message: string } | null
        }>
      }
    }
  }
}

/** Set a review's triage status (open = reopen, responded = handled, dismissed). */
export async function setReviewTriage(input: {
  reviewId: string
  status: TriageStatus
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser()
  if (!UUID_RE.test(input.reviewId)) return { ok: false, error: "Invalid review id" }
  if (!VALID_TRIAGE.has(input.status)) return { ok: false, error: "Unknown status" }
  const supabase = await createServerSupabaseClient()
  const now = new Date().toISOString()
  const { data, error } = await (supabase as unknown as ReviewUpdater)
    .from("location_reviews")
    .update({
      triage_status: input.status,
      triage_updated_at: now,
      triage_updated_by: user.id,
      updated_at: now,
    })
    .eq("id", input.reviewId)
    .select("id")
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: "Review not found" }
  // Reopen is pure state repair, not a learning-shaped action — no signal for it.
  if (input.status === "responded") captureReviewSignal("marked_responded", input.reviewId)
  if (input.status === "dismissed") captureReviewSignal("dismissed", input.reviewId)
  revalidatePath("/reviews")
  return { ok: true }
}

/** Record the operator's genuineness call. Display adjusts on the next render
 *  (make-good treats the verdict as the operator overriding the model's band);
 *  as a LEARNING input it stays provisional (ticket-feedback-signals rule). */
export async function setReviewVerdict(input: {
  reviewId: string
  verdict: OperatorVerdict
}): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  if (!UUID_RE.test(input.reviewId)) return { ok: false, error: "Invalid review id" }
  if (!VALID_VERDICT.has(input.verdict)) return { ok: false, error: "Unknown verdict" }
  const supabase = await createServerSupabaseClient()
  const now = new Date().toISOString()
  const { data, error } = await (supabase as unknown as ReviewUpdater)
    .from("location_reviews")
    .update({
      operator_verdict: input.verdict,
      operator_verdict_at: now,
      updated_at: now,
    })
    .eq("id", input.reviewId)
    .select("id")
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: "Review not found" }
  captureReviewSignal(
    input.verdict === "genuine" ? "verdict_genuine" : "verdict_not_genuine",
    input.reviewId,
  )
  revalidatePath("/reviews")
  return { ok: true }
}

/** ALT-354: generate (and persist) a response draft for one review.
 *  The row loads through the USER-scoped client, so RLS is the membership
 *  check: a non-member reads nothing and the action stops at "Review not
 *  found". The recommendation is recomputed SERVER-side from the same inputs
 *  the /reviews page uses (make-good + generosity slider + reviewer signals);
 *  nothing recommendation-shaped is ever trusted from the client. */
export async function generateDraftAction(
  reviewId: string,
  opts: { includeOffer?: boolean } = {},
): Promise<{ ok: boolean; draft?: string; error?: string }> {
  await requireUser()
  if (!UUID_RE.test(reviewId)) return { ok: false, error: "Invalid review id" }
  const supabase = await createServerSupabaseClient()
  // Loose-cast reads: location_reviews (and locations.voice_tone /
  // generosity_threshold) post-date the generated types, same convention as
  // the /reviews page and lib/reviews/store.ts.
  const db = supabase as unknown as SupabaseClient

  const { data: rowData, error: rowError } = await db
    .from("location_reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle()
  if (rowError) return { ok: false, error: rowError.message }
  if (!rowData) return { ok: false, error: "Review not found" }
  const row = rowData as LocationReviewRow

  const { data: locData } = await db
    .from("locations")
    .select("name, voice_tone, generosity_threshold")
    .eq("id", row.location_id)
    .maybeSingle()
  const loc = (locData ?? null) as {
    name: string | null
    voice_tone: string | null
    generosity_threshold: number | null
  } | null

  // Same recommendation inputs as the page render: the local corpus feeds the
  // reviewer signals; the location's slider (or the shared default) the posture.
  const corpus = await listLocationReviews(db, row.location_id)
  const signals = row.author_key ? aggregateReviewerSignals(corpus).get(row.author_key) : undefined
  const recommendation = recommendMakeGood(row, {
    threshold: loc?.generosity_threshold ?? GENEROSITY_DEFAULT,
    signals,
  })
  // ALT-361 — the operator's per-draft switch: unchecking "Include the
  // make-good offer" suppresses the concrete offer (posture falls back to a
  // plain reply) without touching the recommendation shown on the card.
  const effective =
    opts.includeOffer === false
      ? { ...recommendation, remediation: "none" as const, tier: "respond" as const }
      : recommendation

  const draft = await generateReviewResponseDraft({
    row,
    recommendation: effective,
    voiceTone: loc?.voice_tone ?? null,
    locationName: loc?.name?.trim() ? loc.name : "our restaurant",
  })
  // No draft is a REAL outcome (model down, over-length, deny-list hit): tell
  // the operator to write their own. Nothing is persisted, nothing fabricated.
  if (draft == null) return { ok: false, error: REVIEWS_COPY.toasts.draftError }

  const now = new Date().toISOString()
  const { data, error } = await (supabase as unknown as ReviewUpdater)
    .from("location_reviews")
    .update({
      draft_text: draft,
      draft_generated_at: now,
      updated_at: now,
    })
    .eq("id", reviewId)
    .select("id")
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: "Review not found" }
  revalidatePath("/reviews")
  return { ok: true, draft }
}
