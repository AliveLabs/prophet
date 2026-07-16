// ---------------------------------------------------------------------------
// Review Intelligence (ALT-354): the response draft generator.
// One reasoning-tier structured call (no thinking) turns a review plus its
// make-good recommendation into a SHORT public reply the operator can paste
// into Google. Operator-initiated, operator-sent: Ticket never posts anywhere.
//
// FAIL-SOFT, NEVER FAKED: any model failure, empty/over-length output, or
// deny-list hit returns null. The operator writes their own reply and the UI
// copes. A bad draft that ships is worse than no draft at all.
//
// GUARDRAIL (Bryan, 2026-07-16): drafts exist to improve RESPONSES. The system
// prompt forbids removal/flagging territory outright, and a local deny-list
// check re-verifies the OUTPUT: a draft that so much as mentions getting the
// review taken down is discarded, never shown.
// ---------------------------------------------------------------------------

import { generateStructured, type Transport } from "@/lib/ai/provider"
import { genuinenessBand } from "@/lib/reviews/make-good"
import type { LocationReviewRow, MakeGoodRecommendation, Remediation } from "@/lib/reviews/types"

/** Hard ceiling on a draft. Google replies should stay short; past this we
 *  assume the model rambled and the operator is better off writing their own. */
export const DRAFT_MAX_CHARS = 700

/** Output phrases that void a draft outright (case-insensitive substring
 *  match). The system prompt already forbids this territory; this list is the
 *  seatbelt for the day the model drifts anyway. */
const DRAFT_DENY_PHRASES = [
  "remove this review",
  "flag this review",
  "take this down",
  "report this review",
] as const

/** Per-remediation drafting instruction (ALT-361): the generosity slider's
 *  output becomes a CONCRETE offer in the reply. Refund language is ONLY ever
 *  issued for refund_and_replace; everything stays unpriced. */
const REMEDIATION_GUIDANCE: Record<Remediation, string> = {
  none:
    "Reply with empathy and a specific acknowledgment of what went wrong. Do NOT offer compensation, discounts, free items, or any make-good of any kind.",
  replace_side:
    "Include one concrete offer: next time they come in, the team will replace the specific item or side that missed the mark. Keep it that narrow. Never name a dollar amount.",
  treat:
    "Include one concrete offer: a dessert or appetizer on the house on their next visit. Do not offer to replace the meal and never name a dollar amount.",
  replace_meal:
    "Include one concrete offer: come back in and their meal is replaced, made right this time. Do not offer a refund and never name a dollar amount.",
  refund_and_replace:
    "Make the full make-it-right offer: refund the order AND invite them back so the team can replace the meal properly, and ask them to contact the owner directly so it is handled personally. Never name a dollar amount beyond the refund itself.",
}

/**
 * The posture line for the system prompt. Precedence mirrors recommendMakeGood:
 *   1. ownerAttention (crisis / red flag): measured, zero admissions of fault,
 *      route to a direct conversation. Nothing offered in public.
 *   2. Doubtful genuineness (suspect OR caution): brief, professional,
 *      non-escalating, no make-good of any kind.
 *   3. Otherwise the recommended tier's guidance.
 * Both early postures are defense in depth: the caller's recommendation already
 * caps those cases at "respond", so even a mismatched input can't leak an offer.
 */
function postureGuidance(recommendation: MakeGoodRecommendation, doubtful: boolean): string {
  if (recommendation.ownerAttention) {
    return "This review needs careful handling: keep the reply measured and caring, make no admission of fault, and invite the reviewer to contact the owner directly so it can be handled personally. Offer nothing in public."
  }
  if (doubtful) {
    return "This review may not reflect a real visit: keep the reply brief, professional, and non-escalating. No offer, no make-good of any kind. Invite them to reach out with details if they'd like."
  }
  return REMEDIATION_GUIDANCE[recommendation.remediation]
}

/** Build the system prompt: identity, tone, the posture line, and the hard
 *  never-list (removal talk, blame, em dashes, invented details). */
function buildDraftSystem(input: {
  locationName: string
  voiceTone: string | null
  guidance: string
}): string {
  return [
    `You write a SHORT public reply (2 to 5 sentences) from the owner of ${input.locationName} to one customer review on Google.`,
    "Tone: warm, specific, accountable. Reference the actual specifics the customer described, never a generic template apology.",
    ...(input.voiceTone ? [`The owner's preferred voice: ${input.voiceTone}. Match it.`] : []),
    input.guidance,
    "If the review has no written text, acknowledge the star rating honestly and invite them to share more. Never invent details that are not in the review.",
    "NEVER promise the review will be removed, never mention flagging or reporting it, and never blame the customer.",
    "Plain language. No em dashes. No corporate boilerplate. Do not sign the reply with a name.",
    `Keep the reply under ${DRAFT_MAX_CHARS} characters.`,
    'Return ONLY JSON: { "draft": string }',
  ].join("\n")
}

/** Strict output gate: a real, short, deny-clean string or null (=> no draft).
 *  Em dashes are sanitized deterministically (a comma reads fine in a reply)
 *  rather than voiding an otherwise good draft. */
function validateDraftOutput(raw: unknown): string | null {
  const o = (raw ?? {}) as Record<string, unknown>
  if (typeof o.draft !== "string") return null
  // Canon bans em AND en dashes (EM_DASH = /[—–]/ in the voice rules).
  const draft = o.draft.trim().replace(/\s*[—–]\s*/g, ", ")
  if (draft.length === 0) return null
  if (draft.length > DRAFT_MAX_CHARS) return null
  const lower = draft.toLowerCase()
  if (DRAFT_DENY_PHRASES.some((phrase) => lower.includes(phrase))) return null
  return draft
}

/**
 * Generate a response draft for one review. Returns the draft text, or null
 * when no trustworthy draft could be produced (the caller surfaces "write your
 * own" and persists NOTHING). The transport is injectable for tests.
 */
export async function generateReviewResponseDraft(input: {
  row: LocationReviewRow
  recommendation: MakeGoodRecommendation
  voiceTone: string | null
  locationName: string
  transport?: Transport
}): Promise<string | null> {
  const { row, recommendation } = input

  // Doubtful genuineness pulls the brief/non-escalating posture. Verdict and
  // score bands are enough here: reviewer-signal degrades are already folded
  // into the recommendation's tier cap by the caller (recommendMakeGood).
  const doubtful = genuinenessBand(row) !== "genuine"
  const system = buildDraftSystem({
    locationName: input.locationName,
    voiceTone: input.voiceTone,
    guidance: postureGuidance(recommendation, doubtful),
  })

  // The data payload: the review verbatim plus the recommendation's operator
  // rationale, so the reply can mirror the posture the operator was shown.
  const prompt = JSON.stringify(
    {
      locationName: input.locationName,
      review: {
        author: row.author_name,
        rating: row.rating,
        text: row.review_text ?? "",
        publishedAt: row.published_at,
      },
      recommendedPosture: recommendation.rationale,
    },
    null,
    2,
  )

  return generateStructured<string | null>(
    { tier: "reasoning", system, prompt, temperature: 0.4, label: "review-draft" },
    {
      transport: input.transport,
      validate: validateDraftOutput,
      // Fallback = NO draft. We never ship a reply we didn't verify (the same
      // never-fabricate posture as the scoring pass).
      fallback: () => null,
      onFallback: ({ reason, elapsedMs }) => {
        console.warn(`[review-draft] no draft served (reason=${reason}, ${elapsedMs}ms) review=${row.id}`)
      },
    },
  )
}
