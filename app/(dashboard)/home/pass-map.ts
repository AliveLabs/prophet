// The Pass — honest mapping from the real engine Brief onto Concept A's kit.
// Pure functions only (no JSX) so this stays server-safe and importable from both
// the server BriefView and the client play-card island.

import type {
  EnrichedRecommendation,
  Category,
  Confidence,
  BreakoutQuote,
  SentimentCategory,
  ConfidenceBasisItem,
} from "@/lib/skills/types"
import type { TkFamily } from "@/components/ticket"
import type { TkConfidenceLevel, TkSentimentTone } from "@/components/ticket"
import { distinctDomains, humanizeRef } from "@/lib/skills/evidence-format"

/* ── Confidence: the engine's union IS the kit's union ─────────────────── */
export function confLevel(c: Confidence): TkConfidenceLevel {
  return c // "high" | "medium" | "directional" — identical unions
}

const CONF_LABEL: Record<Confidence, string> = {
  high: "High",
  medium: "Medium",
  directional: "Directional",
}
export function confLabel(c: Confidence): string {
  return CONF_LABEL[c]
}

/* ── Category / kind → the 5 visual families the kit themes ────────────── */
// The kit chips/icons only tint 5 families. We collapse the engine's richer
// Category set honestly: social/menu/grassroots/reputation map straight through;
// every "compete with the set" domain (demand, marketing, positioning, ops,
// convergence) reads as `competitive`.
const CATEGORY_FAMILY: Record<Category, TkFamily> = {
  social: "social",
  menu: "menu",
  grassroots: "grassroots",
  reputation: "reputation",
  demand: "competitive",
  marketing: "competitive",
  positioning: "competitive",
  operations: "competitive",
  convergence: "competitive",
}

// Fallback when a (legacy) play never got a stamped category — derive from kind.
const KIND_FAMILY: Record<EnrichedRecommendation["kind"], TkFamily> = {
  reputation: "reputation",
  positioning: "competitive",
  prepare: "competitive",
  capitalize: "competitive",
  ops: "competitive",
}

export function playFamily(play: EnrichedRecommendation): TkFamily {
  if (play.category) return CATEGORY_FAMILY[play.category]
  return KIND_FAMILY[play.kind]
}

const FAMILY_LABEL: Record<TkFamily, string> = {
  competitive: "Competitive",
  reputation: "Reputation",
  social: "Social",
  menu: "Menu",
  grassroots: "Grassroots",
}

const CATEGORY_LABEL: Record<Category, string> = {
  demand: "Demand",
  marketing: "Marketing",
  social: "Social",
  menu: "Menu",
  grassroots: "Grassroots",
  positioning: "Positioning",
  reputation: "Reputation",
  operations: "Operations",
  convergence: "Cross-domain",
}

// The chip text: prefer the precise operator-facing category, else the family.
export function playChipLabel(play: EnrichedRecommendation): string {
  if (play.category) return CATEGORY_LABEL[play.category]
  return FAMILY_LABEL[playFamily(play)]
}

/* ── "You're winning" framing — only when the presenter flagged advantage ─ */
export function isAdvantage(play: EnrichedRecommendation): boolean {
  return play.presentation?.advantage === true
}

/* ── Verbatim review quotes for the TkQuote block ──────────────────────── */
export type MappedQuote = {
  text: string
  who?: string
  stars?: number
  when?: string
  /** Sentiment of the originating review — colors the quote's left-edge marker (ALT-178).
   *  Only set when we have an honest basis (the star rating); otherwise left undefined so the
   *  kit falls back to neutral rather than inventing a polarity. */
  sentiment?: "positive" | "neutral" | "negative"
}

function fmtQuoteWhen(date?: string): string | undefined {
  if (!date) return undefined
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// Sentiment from the review's star rating — the only per-quote signal we have (BreakoutQuote /
// Evidence carry no explicit sentiment). 4-5★ positive · 3★ neutral · 1-2★ negative; no rating
// ⇒ undefined so the marker reads neutral and we never invent a polarity (ALT-178).
function quoteSentiment(stars?: number): MappedQuote["sentiment"] {
  if (stars == null || Number.isNaN(stars)) return undefined
  if (stars >= 4) return "positive"
  if (stars <= 2) return "negative"
  return "neutral"
}

// Prefer the presenter's curated breakout quotes; fall back to the P11 inline
// evidence quotes. Both are byte-verbatim review text — never paraphrased.
export function playQuotes(play: EnrichedRecommendation, max = 3): MappedQuote[] {
  const breakout: BreakoutQuote[] = play.presentation?.breakoutQuotes ?? []
  if (breakout.length) {
    return breakout.slice(0, max).map((q) => ({
      text: q.text,
      who: q.competitor ?? "Your reviews",
      stars: q.rating,
      when: fmtQuoteWhen(q.date),
      sentiment: quoteSentiment(q.rating),
    }))
  }
  const quotes: MappedQuote[] = []
  for (const e of play.evidence ?? []) {
    if (e.quote) {
      quotes.push({ text: e.quote, who: humanizeRef(e.source), when: fmtQuoteWhen(e.asOf) })
    }
    if (quotes.length >= max) break
  }
  return quotes
}

/* ── Negative-sentiment-by-category → TkSentimentRows ──────────────────── */
export type MappedSentimentRow = {
  label: string
  width: number
  value: string
  tone: TkSentimentTone
  tip?: string
  tipValue?: string
}

function sentimentTone(pct: number): TkSentimentTone {
  if (pct >= 30) return "bad"
  if (pct >= 18) return "warn"
  return "ok"
}

export function playSentiment(play: EnrichedRecommendation): MappedSentimentRow[] | null {
  const cats: SentimentCategory[] | undefined = play.presentation?.sentimentByCategory
  if (!cats?.length) return null
  return cats.slice(0, 4).map((c) => {
    const pct = Math.max(0, Math.min(100, Math.round(c.pct)))
    return {
      label: c.category.charAt(0).toUpperCase() + c.category.slice(1),
      // Width amplifies the share so a 38% category reads as a near-full bar
      // (matches Concept A, where 38% paints ~78% of the track). Capped at 100.
      width: Math.min(100, Math.round(pct * 2)),
      value: `${pct}%`,
      tone: sentimentTone(pct),
      tip: `${c.category} mentions`,
      tipValue: `${pct}% of negatives`,
    }
  })
}

/* ── "Why we're confident" rolldown points ─────────────────────────────── */
// Prefer the presenter's structured confidence basis (source · what we saw);
// fall back to the play's relational stats / cited evidence so every card has a
// real "why", never an empty rolldown.
export function playWhyPoints(play: EnrichedRecommendation): string[] {
  const basis: ConfidenceBasisItem[] | undefined = play.presentation?.confidenceBasis
  if (basis?.length) {
    return basis.map((b) => `${b.source}: ${b.whatWeSaw}`)
  }
  const points: string[] = []
  for (const e of play.evidence ?? []) {
    if (e.relativeStat) {
      points.push(e.soWhat ? `${e.relativeStat} — ${e.soWhat}` : e.relativeStat)
    } else if (e.rate) {
      points.push(`${e.rate.numerator} of ${e.rate.denominator} (${e.rate.pct}%) — ${humanizeRef(e.source)}`)
    }
  }
  if (points.length) return points
  // Last resort: name the distinct sources the play is grounded in.
  const domains = distinctDomains(play.evidenceRefs)
  if (domains.length) {
    return [`Grounded in ${domains.join(", ")} — refreshed in last night's sweep.`]
  }
  return ["Built from your live market signals, refreshed overnight."]
}

export function playWhySource(play: EnrichedRecommendation): string | undefined {
  const domains = distinctDomains(play.evidenceRefs)
  if (!domains.length) return undefined
  return `Sources: ${domains.join(" · ")}. Refreshed overnight.`
}

/* ── Confidence rationale for the directional/maintain framing label ──── */
export function whyLabel(play: EnrichedRecommendation): string {
  return play.confidence === "directional" ? "Why this is directional" : "Why we're confident"
}
