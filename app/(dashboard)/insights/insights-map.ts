// The Pass — honest mapping from a stored Insight (FeedInsight) onto the kit's
// visual vocabulary. Pure functions only (no JSX) so this stays server-safe and
// importable from both the server page and the client feed islands.
//
// The insights feed is built from the SAME serialized FeedInsight the prior
// shared <InsightFeed/> consumed — we only change how it is PRESENTED. No POS /
// $ / covers are invented; everything is %/estimated/"you vs competitor" framing
// already present in the engine evidence.

import type { TkFamily, TkConfidenceLevel } from "@/components/ticket"
import {
  getSourceCategory,
  SOURCE_LABELS,
  type SourceCategory,
} from "@/lib/insights/scoring"
import type { FeedInsight } from "./insights-feed-kit"

/* ── Source category → the 5 visual families the kit tints ──────────────── */
// The kit chips/icons theme 5 families. We map the engine's source categories
// honestly: social/photos→social-family hues are too loud, so we collapse to the
// closest semantic family the kit already styles. (Photos/visual = "menu" reads
// as content; traffic/events/seo = "competitive" — the compete-with-the-set lane;
// reviews/GBP = "reputation".)
const CATEGORY_FAMILY: Record<SourceCategory, TkFamily> = {
  competitors: "reputation", // GBP / reviews / ratings
  events: "competitive",
  seo: "competitive",
  social: "social",
  content: "menu", // website & menu
  photos: "menu", // visual intelligence reads as menu/content
  traffic: "competitive",
}

export function insightFamily(i: Pick<FeedInsight, "insightType" | "competitorId">): TkFamily {
  return CATEGORY_FAMILY[getSourceCategory(i.insightType, i.competitorId)]
}

export function insightCategory(
  i: Pick<FeedInsight, "insightType" | "competitorId">
): SourceCategory {
  return getSourceCategory(i.insightType, i.competitorId)
}

/* ── The chip text: the operator-facing source label ────────────────────── */
export function insightChipLabel(
  i: Pick<FeedInsight, "insightType" | "competitorId">
): string {
  return SOURCE_LABELS[getSourceCategory(i.insightType, i.competitorId)]
}

/* ── Confidence → the kit's ONE encoding (3-pip segmented) ──────────────── */
// Stored insights use high / medium / low (and occasionally directional). We
// fold low→directional honestly: a low-confidence signal shows a single dashed
// pip + the "Directional" label, never an over-stated "high".
export function insightConfLevel(confidence: string): TkConfidenceLevel {
  if (confidence === "high") return "high"
  if (confidence === "medium") return "medium"
  return "directional"
}

const CONF_LABEL: Record<TkConfidenceLevel, string> = {
  high: "High",
  medium: "Medium",
  directional: "Directional",
}
export function insightConfLabel(confidence: string): string {
  return CONF_LABEL[insightConfLevel(confidence)]
}

/* ── Urgency → the small priority tag shown on a card ───────────────────── */
export const URGENCY_LABEL: Record<FeedInsight["urgencyLevel"], string> = {
  critical: "High priority",
  warning: "This week",
  info: "Plan ahead",
}

/* ── Verbatim review quotes for the TkQuote evidence block ──────────────── */
export type MappedQuote = { text: string; who?: string; stars?: number; when?: string }

type SampleReview = { rating?: number; text?: string; author?: string; date?: string }
type Theme = { theme?: string; sentiment?: string; examples?: string[] }

function fmtWhen(date?: string): string | undefined {
  if (!date) return undefined
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// Pull byte-verbatim review text out of review_themes / review_velocity evidence —
// never paraphrased. Falls back to theme example snippets when no full sample
// reviews are present.
export function insightQuotes(i: FeedInsight, max = 2): MappedQuote[] {
  const ev = i.evidence ?? {}
  const out: MappedQuote[] = []

  const samples = ev.sampleReviews as SampleReview[] | undefined
  if (samples?.length) {
    for (const r of samples) {
      if (!r.text) continue
      out.push({ text: r.text, who: r.author, stars: r.rating, when: fmtWhen(r.date) })
      if (out.length >= max) return out
    }
  }

  if (out.length < max) {
    const themes = ev.themes as Theme[] | undefined
    if (themes?.length) {
      for (const t of themes) {
        const ex = t.examples?.[0]
        if (!ex) continue
        out.push({ text: ex, who: t.theme ? `On “${t.theme}”` : undefined })
        if (out.length >= max) return out
      }
    }
  }

  return out
}

/* ── Sentiment split (positive / negative / mixed counts) from review evidence ─ */
export type SentimentSplit = { positive: number; negative: number; mixed: number } | null

export function insightSentiment(i: FeedInsight): SentimentSplit {
  const counts = (i.evidence ?? {}).sentimentCounts as
    | { positive?: number; negative?: number; mixed?: number }
    | undefined
  if (!counts) return null
  const split = {
    positive: counts.positive ?? 0,
    negative: counts.negative ?? 0,
    mixed: counts.mixed ?? 0,
  }
  if (split.positive + split.negative + split.mixed === 0) return null
  return split
}

/* ── "Why we're confident" rolldown points ─────────────────────────────── */
// Built from the real metric/evidence fields already present on the insight —
// you-vs-competitor ratings, counts, deltas, matched keywords/events. Never
// fabricated; if nothing structured is present we name the source stream.
export function insightWhyPoints(i: FeedInsight): string[] {
  const ev = i.evidence ?? {}
  const points: string[] = []

  if (typeof ev.location_rating === "number" && typeof ev.competitor_rating === "number") {
    const you = (ev.location_rating as number).toFixed(1)
    const them = (ev.competitor_rating as number).toFixed(1)
    points.push(`You ${you}★ vs competitor ${them}★ on Google.`)
  } else if (typeof ev.location_rating === "number") {
    points.push(`Your current Google rating: ${(ev.location_rating as number).toFixed(1)}★.`)
  }

  if (typeof ev.review_count === "number") points.push(`${ev.review_count} reviews in the set we read.`)
  if (typeof ev.current_weekend_count === "number")
    points.push(`${ev.current_weekend_count} events this weekend within your trade area.`)
  if (typeof ev.event_count === "number") points.push(`${ev.event_count} events landing on the day.`)
  if (typeof ev.pct_change === "number")
    points.push(`${(ev.pct_change as number) > 0 ? "+" : ""}${ev.pct_change}% vs the prior period.`)
  if (typeof ev.traffic_growth_pct === "number")
    points.push(`+${ev.traffic_growth_pct}% estimated foot-traffic change.`)
  if (typeof ev.keyword_gain === "number") points.push(`+${ev.keyword_gain} keywords gained in search.`)
  if (typeof ev.current_keywords === "number") points.push(`${ev.current_keywords} keywords tracked in total.`)
  if (typeof ev.peak_hour === "number")
    points.push(`Peak hour estimated at ${ev.peak_hour}:00 from foot-traffic curves.`)

  const field = ev.field as string | undefined
  if (field && typeof ev.delta === "number") {
    const d = ev.delta as number
    const sign = d > 0 ? "+" : ""
    if (field === "rating") points.push(`Rating moved ${sign}${d} since we started watching.`)
    else if (field === "reviewCount") points.push(`${sign}${d} reviews since our baseline.`)
  }

  const kws = ev.matched_keywords as string[] | undefined
  if (kws?.length) points.push(`Matched on: ${kws.slice(0, 3).join(", ")}.`)

  if (points.length) return points

  return [
    `Read from your ${SOURCE_LABELS[getSourceCategory(i.insightType, i.competitorId)]} signal, refreshed in the latest sweep.`,
  ]
}

export function insightWhyLabel(i: FeedInsight): string {
  return insightConfLevel(i.confidence) === "directional"
    ? "Why this is directional"
    : "Why we're confident"
}

export function insightWhySource(i: FeedInsight): string {
  return `Source: ${SOURCE_LABELS[getSourceCategory(i.insightType, i.competitorId)]}. Refreshed in the latest sweep.`
}

/* ── Compact metric chips (honest, %/count framing) ─────────────────────── */
export function insightMetrics(i: FeedInsight): string[] {
  const ev = i.evidence ?? {}
  const pills: string[] = []

  if (typeof ev.location_rating === "number") pills.push(`You ${(ev.location_rating as number).toFixed(1)}★`)
  if (typeof ev.competitor_rating === "number") pills.push(`Them ${(ev.competitor_rating as number).toFixed(1)}★`)
  if (typeof ev.current_weekend_count === "number") pills.push(`${ev.current_weekend_count} weekend events`)
  if (typeof ev.event_count === "number") pills.push(`${ev.event_count} events`)
  if (typeof ev.pct_change === "number") pills.push(`${(ev.pct_change as number) > 0 ? "+" : ""}${ev.pct_change}%`)
  if (typeof ev.keyword_gain === "number") pills.push(`+${ev.keyword_gain} keywords`)

  const field = ev.field as string | undefined
  if (field && typeof ev.delta === "number") {
    const d = ev.delta as number
    const sign = d > 0 ? "+" : ""
    if (field === "rating") pills.push(`${sign}${d} rating`)
    if (field === "reviewCount") pills.push(`${sign}${d} reviews`)
  }

  return pills.slice(0, 3)
}

/* ── Recommendations attached to an insight (the suggested play) ────────── */
export type MappedRec = { title: string; rationale?: string }

export function insightRecs(i: FeedInsight, max = 2): MappedRec[] {
  const out: MappedRec[] = []
  for (const r of i.recommendations ?? []) {
    const title = String((r as Record<string, unknown>)?.title ?? "")
    if (!title) continue
    const rationale = String((r as Record<string, unknown>)?.rationale ?? "")
    out.push({ title, rationale: rationale || undefined })
    if (out.length >= max) break
  }
  return out
}
