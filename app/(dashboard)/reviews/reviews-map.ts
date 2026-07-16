// ---------------------------------------------------------------------------
// Review Intelligence (ALT-353) — presentational mapping for /reviews.
// EVERY operator-facing string on the triage surface lives in REVIEWS_COPY so
// wording is a one-file change (same convention as pass-map/insights-map).
//
// Voice rules (CI-gated via lintVoice): plain language, no kitchen lingo, no
// em dashes, and NEVER a raw 0-100 score — the operator only ever sees bands
// ("Mild" / "Serious") and plain words ("Reads genuine").
//
// GUARDRAIL (Bryan, 2026-07-16): authenticity/severity prioritize and improve
// RESPONSES. Nothing here suggests removing a review or gaming removal.
// ---------------------------------------------------------------------------

import type {
  GenuinenessBand,
  LocationReviewRow,
  MakeGoodRecommendation,
  MakeGoodTier,
  SentimentBand,
} from "@/lib/reviews/types"
import { sentimentBandFor, sentimentValueFor } from "@/lib/reviews/make-good"

/* ── all operator-facing copy, one object ──────────────────────────── */
export const REVIEWS_COPY = {
  head: {
    kicker: "Reviews",
    h1: "What customers are saying",
  },
  sections: {
    attention: {
      title: "Needs a look",
      sub: "Most serious first.",
    },
    secondLook: {
      title: "Worth a second look",
      sub: "Something about these reads off. Use your own judgment, no rush.",
    },
    handled: {
      title: "Handled",
      sub: "Marked handled or dismissed.",
    },
  },
  // The two spectrum bars (ALT-359/360). Fixed gradient tracks with a position
  // marker; the words below are the accessible reading of the marker position
  // (never a number).
  spectrum: {
    sentiment: {
      label: "Sentiment",
      left: "Upset",
      right: "Delighted",
      bands: {
        negative: "Running negative",
        neutral: "Mixed to neutral",
        positive: "Positive",
      } satisfies Record<SentimentBand, string>,
    },
    genuine: {
      label: "Genuine",
      left: "Risky",
      right: "Confident",
      bands: {
        genuine: "Reads genuine",
        caution: "Worth a closer look",
        suspect: "Doesn't add up",
      } satisfies Record<GenuinenessBand, string>,
    },
  },
  // Recommended action tiers → tag words. Recommendation only, the operator acts.
  tiers: {
    respond: "Reply with care",
    discount: "Consider a discount",
    comp: "Make it right, comp or refund",
  } satisfies Record<MakeGoodTier, string>,
  ownerFlag: "Needs you personally",
  whyLabel: "Why this suggestion",
  whySource: "Ticket's read of this review, plus patterns in your own review history.",
  stillReading: "Ticket is still reading this one",
  noText: "No written review, just the star rating.",
  anonymousAuthor: "A customer",
  actions: {
    draftReply: "Draft a reply",
    drafting: "Drafting...",
    markHandled: "Mark handled",
    dismiss: "Dismiss",
    reopen: "Reopen",
    openInGoogle: "Open in Google",
    // ALT-361 — the operator's per-draft switch for the concrete make-good.
    includeOffer: "Include the make-good offer",
  },
  // The suggested-reply block (ALT-354). The draft is a starting point the
  // operator posts THEMSELVES on Google. Ticket never posts anywhere.
  draft: {
    label: "Suggested reply",
    copy: "Copy",
    copied: "Copied",
    again: "Draft again",
    hint: "Read it over, tweak anything, then paste it into your reply on Google.",
  },
  // ALT-362: the "Is this genuine?" card control is retired (the bars carry the
  // read now). The backend verdict capture is kept for a smarter affordance later.
  states: {
    responded: "Handled",
    dismissed: "Dismissed",
  },
  toasts: {
    handled: "Marked handled.",
    dismissed: "Dismissed.",
    reopened: "Back in the open list.",
    error: "That didn't save. Try again.",
    copied: "Copied. Paste it into your reply on Google.",
    draftError: "Could not draft this one, try again or write your own.",
  },
  empty: {
    title: "No reviews yet",
    description:
      "As reviews come in, Ticket reads each one, flags what needs you, and suggests how to make it right.",
  },
} as const

/** The page-head sub line: honest counts, no drama. */
export function reviewsSubLine(openCount: number, handledThisMonth: number): string {
  const noun = openCount === 1 ? "review" : "reviews"
  if (openCount > 0 && handledThisMonth > 0) {
    return `${openCount} ${noun} worth a look, ${handledThisMonth} handled this month.`
  }
  if (openCount > 0) return `${openCount} ${noun} worth a look.`
  if (handledThisMonth > 0) return `All caught up. ${handledThisMonth} handled this month.`
  return "Ticket reads each review as it comes in and flags what needs you."
}

/* ── spectrum geometry (ALT-359/360) ───────────────────────────────── */
// The bars are FIXED gradient tracks; only the MARKER moves. Sentiment maps
// -100..100 onto 0..100% (neutral = dead center); genuine plots the
// authenticity read directly (50 = "can't determine" middle).
export const sentimentMarkerPct = (value: number): number =>
  Math.min(100, Math.max(0, (value + 100) / 2))
export const genuineMarkerPct = (value: number): number => Math.min(100, Math.max(0, value))

/* ── the serializable card view (server builds it, client renders it) ── */
export type ReviewCardView = {
  id: string
  authorFirst: string
  stars: number | null
  /** verbatim review text; null ⇒ render REVIEWS_COPY.noText */
  text: string | null
  /** "3 weeks ago" (provider relative) or a formatted absolute date */
  when: string | null
  googleMapsUri: string | null
  triageStatus: "open" | "responded" | "dismissed"
  operatorVerdict: "genuine" | "not_genuine" | null
  /** false ⇒ the row renders neutrally (no genuine bar, no recommendation) */
  scored: boolean
  /** Sentiment marker (-100..100): the model's read when scored, else the star
   *  anchor — the sentiment bar always plots SOMETHING honest. */
  sentimentValue: number
  sentimentBand: SentimentBand
  /** Genuine marker (0..100); null until scored ⇒ the bar shows "still reading". */
  genuineValue: number | null
  genuineness: GenuinenessBand | null
  tier: MakeGoodTier | null
  ownerAttention: boolean
  /** Why-rolldown bullets: recommendation rationale + the scoring rationales, present ones only */
  whyPoints: string[]
  /** Persisted response draft (ALT-354); null until the operator generates one */
  draftText: string | null
  /** Publish time in epoch ms (0 when unknown) — the within-band recency sort key. */
  sortTs: number
}

/** Reviewer display name → first name only (privacy-light, reads warmer). */
export function authorFirstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0]?.replace(/[.,]+$/, "")
  return first && first.length > 0 ? first : REVIEWS_COPY.anonymousAuthor
}

/** Display time: the provider's relative wording wins; else a formatted absolute date. */
export function reviewWhen(row: Pick<LocationReviewRow, "relative_published" | "published_at">): string | null {
  if (row.relative_published) return row.relative_published
  if (row.published_at && Number.isFinite(Date.parse(row.published_at))) {
    return new Date(row.published_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }
  return null
}

/** Build the serializable card view. `scored` carries the bands/recommendation the
 *  server computed via lib/reviews/make-good; null ⇒ the row is unscored and the
 *  card renders neutrally (fail-soft: we never fabricate a band). */
export function buildReviewCardView(
  row: LocationReviewRow,
  scored: {
    genuineness: GenuinenessBand
    recommendation: MakeGoodRecommendation
  } | null,
): ReviewCardView {
  const whyPoints = scored
    ? [scored.recommendation.rationale, row.authenticity_rationale, row.severity_rationale].filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      )
    : []
  const sortTs = row.published_at ? Date.parse(row.published_at) : NaN
  return {
    id: row.id,
    authorFirst: authorFirstName(row.author_name),
    stars: typeof row.rating === "number" ? row.rating : null,
    text: row.review_text?.trim() ? row.review_text : null,
    when: reviewWhen(row),
    googleMapsUri: row.google_maps_uri,
    triageStatus: row.triage_status,
    operatorVerdict: row.operator_verdict,
    scored: scored != null,
    sentimentValue: sentimentValueFor(row),
    sentimentBand: sentimentBandFor(row),
    genuineValue: scored != null && typeof row.authenticity_score === "number" ? row.authenticity_score : null,
    genuineness: scored?.genuineness ?? null,
    tier: scored?.recommendation.tier ?? null,
    ownerAttention: scored?.recommendation.ownerAttention ?? false,
    whyPoints,
    draftText: row.draft_text?.trim() ? row.draft_text : null,
    sortTs: Number.isFinite(sortTs) ? sortTs : 0,
  }
}

/* ── grouping + sort (the triage order the page renders) ───────────── */
export type ReviewGroups = {
  /** open, credible — the main list, most serious first */
  attention: ReviewCardView[]
  /** open but the genuineness read is "suspect" — the quieter bottom section */
  secondLook: ReviewCardView[]
  /** responded / dismissed — the calm historical tail */
  handled: ReviewCardView[]
}

// ALT-358 (Bryan 2026-07-17): BAND first, DATE second — a year-old review must
// never outrank a fresher one of similar seriousness. Rank: owner-attention
// (crisis/red-flag) first, then negative, neutral, positive sentiment bands;
// within a band, newest first. Raw scores no longer drive fine ordering.
const SENTIMENT_RANK: Record<SentimentBand, number> = { negative: 1, neutral: 2, positive: 3 }

export function groupReviewViews(views: ReviewCardView[]): ReviewGroups {
  const attention: ReviewCardView[] = []
  const secondLook: ReviewCardView[] = []
  const handled: ReviewCardView[] = []
  for (const v of views) {
    if (v.triageStatus !== "open") handled.push(v)
    else if (v.genuineness === "suspect") secondLook.push(v)
    else attention.push(v)
  }
  const rank = (v: ReviewCardView) => (v.ownerAttention ? 0 : SENTIMENT_RANK[v.sentimentBand])
  const byBandThenDate = (list: ReviewCardView[]) =>
    list
      .map((v, i) => ({ v, i }))
      .sort((a, b) => rank(a.v) - rank(b.v) || b.v.sortTs - a.v.sortTs || a.i - b.i)
      .map(({ v }) => v)
  return {
    attention: byBandThenDate(attention),
    secondLook: byBandThenDate(secondLook),
    handled: byBandThenDate(handled),
  }
}
