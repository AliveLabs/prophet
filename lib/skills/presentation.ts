// ---------------------------------------------------------------------------
// presentation — compose the structured, evidence-forward block (insight-quality
// upgrade) onto each play from the dossier, deterministically + honesty-gated.
//
// The concepts (Bryan + Chris, 2026-06-26) read closer to target than prod NOT
// because the rationales are weak, but because the engine stopped at prose +
// machine refs and never COMPOSED the evidence-forward, comparative, quantified
// layer the dossier already holds. This module composes that layer:
//
//   confidenceBasis     — the "why we're confident" rolldown (grounded ref -> what we saw)
//   breakoutQuotes      — 1-3 verbatim, attributed review quotes behind a review play
//   sentimentByCategory — the food/wait/price/cleanliness % breakdown of own reviews
//   headToHead          — decodable you-vs-set / you-vs-competitor deltas
//   exemplarSocialPost  — the competitor's top post embedded on a social play
//   estimate            — a %-framed / range / count HONEST estimate (never $ / POS)
//   advantage           — press-the-advantage (you're winning) vs steal-the-cue
//
// EVERYTHING here is pure, deterministic, and fail-soft: a builder returns nothing
// when the dossier lacks the signal, so the block is simply absent (the card falls
// back to today's presentation). It runs in the presenter (lib/skills/presenter.ts)
// AFTER synthesis, so the served + persisted play carries it. HARD honesty rules:
//   - quotes byte-match a stored review example (no paraphrase),
//   - every cited source traces to a grounded ref (allowedRefs),
//   - sentiment/head-to-head numbers derive from real mention/rating/rule data,
//   - estimates are %-framed/ordinal and NEVER a $ / POS figure (margins, ticket
//     counts, $ lift). See docs/engine-rewrite/insight-quality-upgrade-plan.md.
// ---------------------------------------------------------------------------

import type { Dossier, EntitySignals } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { NormalizedSocialPost } from "@/lib/social/types"
import { humanizeRef } from "@/lib/skills/evidence-format"
import type {
  BreakoutQuote,
  ConfidenceBasisItem,
  EnrichedRecommendation,
  ExemplarSocialPost,
  HeadToHead,
  PlayEstimate,
  PlayPresentation,
  SentimentCategory,
} from "@/lib/skills/types"

// ── shared context (built once per brief) ────────────────────────────────────

/** Precomputed lookups the per-play builders read, assembled once per brief by the presenter. */
export type PresentationContext = {
  dossier: Dossier
  /** The grounded ref set (from buildRefIndex) — every cited source must be in here. */
  allowedRefs: Set<string>
  /** base insight_type -> the FIRST matching rule (for confidenceBasis / single-value reads). */
  ruleByType: Map<string, GeneratedInsight>
  /** base insight_type -> ALL matching rules (review.theme + per-competitor comparison rules). */
  rulesByType: Map<string, GeneratedInsight[]>
}

export function buildPresentationContext(dossier: Dossier, allowedRefs: Set<string>): PresentationContext {
  const ruleByType = new Map<string, GeneratedInsight>()
  const rulesByType = new Map<string, GeneratedInsight[]>()
  for (const insight of dossier.ruleOutputs ?? []) {
    if (!ruleByType.has(insight.insight_type)) ruleByType.set(insight.insight_type, insight)
    const list = rulesByType.get(insight.insight_type) ?? []
    list.push(insight)
    rulesByType.set(insight.insight_type, list)
  }
  return { dossier, allowedRefs, ruleByType, rulesByType }
}

// ── small typed readers (defensive — a missing/renamed key just skips) ────────

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}
function baseRef(ref: string): string {
  return ref.split(":")[0]
}
function isGrounded(ref: string, allowed: Set<string>): boolean {
  return allowed.has(ref) || allowed.has(baseRef(ref))
}
function slugifyTheme(theme: string): string {
  return theme.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/** Trim a grounded rule summary into one readable "what we saw" line (no truncation mid-word). */
function toWhatWeSaw(text: string | undefined | null): string | null {
  const s = (text ?? "").trim()
  if (!s) return null
  if (s.length <= 200) return s
  const cut = s.slice(0, 200)
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "))
  return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, "")) + (lastStop > 80 ? "" : "…")
}

// ── 1. confidenceBasis — the "why we're confident" rolldown ───────────────────

/** The specific rule a ref resolves to — for review.theme:<slug>, the rule whose theme matches. */
function ruleForRef(ref: string, ctx: PresentationContext) {
  const base = baseRef(ref)
  const rules = ctx.rulesByType.get(base) ?? []
  if (base === "review.theme" && ref.includes(":")) {
    const slug = ref.split(":")[1]
    const match = rules.find((r) => slugifyTheme(str(r.evidence?.theme) ?? "") === slug)
    if (match) return match
  }
  return rules[0]
}

/** A clean, operator-readable source label for a grounded ref (no API/internal jargon). P5: SEO/
 *  visibility refs read "Local search visibility", making them first-class source-attributed lines. */
function sourceLabel(ref: string, ctx: PresentationContext): string {
  const base = baseRef(ref)
  if (base === "review.theme") {
    const rule = ruleForRef(ref, ctx)
    const theme = str(rule?.evidence?.theme)
    return theme ? `Reviews — ${theme}` : "Reviews"
  }
  if (base.startsWith("review") || base.startsWith("rating")) return "Reviews"
  if (base.startsWith("social")) return "Competitor social"
  if (base.startsWith("seo")) return "Local search visibility"
  if (base.startsWith("events") || base.startsWith("cross_event")) return "Local events"
  if (base.startsWith("traffic")) return "Foot traffic"
  if (base.startsWith("menu")) return "Menu"
  if (base.startsWith("weather")) return "Weather"
  return humanizeRef(ref)
}

/**
 * One readable "what we saw" line per GROUNDED ref the play cites. Source is a clean domain label
 * (sourceLabel); the line is the cited rule's own grounded summary. This makes SEO/visibility (P5) a
 * source-attributed, drillable line alongside reviews/events/social — the "better representation"
 * Chris flagged.
 */
function buildConfidenceBasis(play: EnrichedRecommendation, ctx: PresentationContext): ConfidenceBasisItem[] {
  const out: ConfidenceBasisItem[] = []
  const seen = new Set<string>()
  for (const ref of play.evidenceRefs ?? []) {
    if (!isGrounded(ref, ctx.allowedRefs)) continue
    const source = sourceLabel(ref, ctx)
    if (seen.has(source)) continue
    const whatWeSaw = toWhatWeSaw(ruleForRef(ref, ctx)?.summary || ruleForRef(ref, ctx)?.title)
    if (!whatWeSaw) continue
    seen.add(source)
    out.push({ source, whatWeSaw })
    if (out.length >= 4) break
  }
  return out
}

// ── 2. breakoutQuotes — verbatim, attributed review quotes ────────────────────

/**
 * 1-3 verbatim review quotes behind a review-grounded play. Quotes come from the cited review.theme
 * rules' evidence.examples[] (already byte-exact + captured once at analysis time — never re-written),
 * attributed with the rating + date when the quote is found in the own location's recentReviews.
 * Own-location reviews only (competitor review samples are not exhaustive → a % would mislead).
 */
function buildBreakoutQuotes(play: EnrichedRecommendation, ctx: PresentationContext): BreakoutQuote[] {
  const reviewRefs = (play.evidenceRefs ?? []).filter((r) => baseRef(r) === "review.theme")
  if (!reviewRefs.length) return []
  const themeRules = ctx.rulesByType.get("review.theme") ?? []
  if (!themeRules.length) return []
  const reviews = ctx.dossier.location?.listing?.recentReviews ?? []
  const out: BreakoutQuote[] = []
  const seen = new Set<string>()
  for (const ref of reviewRefs) {
    if (!isGrounded(ref, ctx.allowedRefs)) continue
    const slug = ref.includes(":") ? ref.split(":")[1] : ""
    for (const rule of themeRules) {
      const theme = str(rule.evidence?.theme) ?? ""
      if (slug && slugifyTheme(theme) !== slug) continue
      const examples = Array.isArray(rule.evidence?.examples) ? rule.evidence!.examples : []
      for (const raw of examples) {
        const text = typeof raw === "string" ? raw.trim() : ""
        if (!text || seen.has(text)) continue
        seen.add(text)
        const match = reviews.find((rv) => typeof rv?.text === "string" && rv.text.trim() === text)
        const q: BreakoutQuote = { text, source: slug ? `review.theme:${slug}` : "review.theme" }
        if (match) {
          if (num(match.rating) != null) q.rating = match.rating
          if (str(match.date)) q.date = match.date
        }
        out.push(q)
        if (out.length >= 3) return out
      }
    }
  }
  return out
}

// ── 3. sentimentByCategory — own-review category breakdown ────────────────────

/** Map a freeform review theme label to a coarse category (themes carry no pre-binned category). */
function inferReviewCategory(theme: string): string {
  const t = theme.toLowerCase()
  if (/\b(slow|wait|waiting|line|lines|queue|speed|fast|quick|long)\b/.test(t)) return "wait"
  if (/\b(price|prices|pricey|expensive|cheap|value|cost|costly|overpriced|worth)\b/.test(t)) return "price"
  if (/\b(clean|dirty|filthy|hygiene|mess|messy|bathroom|restroom|sanitary|gross)\b/.test(t)) return "cleanliness"
  if (/\b(service|staff|friendly|rude|employee|employees|manager|attentive|cashier|crew|team)\b/.test(t)) return "service"
  if (/\b(ambiance|ambience|atmosphere|decor|music|seating|patio|vibe|noisy|noise|comfortable)\b/.test(t)) return "ambiance"
  if (/\b(food|dish|dishes|flavor|flavour|taste|tasty|menu|portion|portions|fresh|cook|cooked|meal|chicken|burger|fries|drink|drinks|sauce|bland|cold|hot|quality)\b/.test(t)) return "food"
  return "other"
}

/**
 * The food/wait/price/cleanliness/service/ambiance breakdown of the OWN location's review themes:
 * each category's share of categorized mentions (sums to ~100 across surfaced categories) and its
 * dominant sentiment. Derived from real mention counts — no fabricated customer counts. Surfaced on
 * review-grounded plays only.
 */
function buildSentimentByCategory(play: EnrichedRecommendation, ctx: PresentationContext): SentimentCategory[] {
  const citesReview = (play.evidenceRefs ?? []).some((r) => r.startsWith("review"))
  if (!citesReview) return []
  const themes = ctx.dossier.location?.reviews?.themes ?? []
  if (themes.length < 2) return []
  const byCat = new Map<string, { total: number; neg: number; pos: number }>()
  let grand = 0
  for (const th of themes) {
    const cat = inferReviewCategory(th.theme ?? "")
    if (cat === "other") continue
    const m = num(th.mentions) ?? 0
    if (m <= 0) continue
    grand += m
    const e = byCat.get(cat) ?? { total: 0, neg: 0, pos: 0 }
    e.total += m
    if (th.sentiment === "negative") e.neg += m
    else if (th.sentiment === "positive") e.pos += m
    byCat.set(cat, e)
  }
  if (grand <= 0 || byCat.size < 2) return []
  const out: SentimentCategory[] = []
  for (const [category, e] of byCat) {
    const pct = Math.round((e.total / grand) * 100)
    if (pct <= 0) continue
    const direction = e.neg > e.pos ? "negative" : e.pos > e.neg ? "positive" : "mixed"
    out.push({ category, pct, direction })
  }
  return out.sort((a, b) => b.pct - a.pct).slice(0, 5)
}

// ── 4. headToHead — decodable you-vs-set / you-vs-competitor deltas ────────────

/**
 * Decodable comparisons grounded in real dossier data: the Google rating vs the local set average
 * (for positioning/convergence/reputation plays), plus social engagement / posting-frequency deltas
 * read from the comparison rules a social play cites. Each carries a `lead` flag and a plain-language
 * `label`. Capped + deduped so the card stays scannable.
 */
function buildHeadToHead(play: EnrichedRecommendation, ctx: PresentationContext): HeadToHead[] {
  const out: HeadToHead[] = []
  const seenMetric = new Set<string>()
  const push = (h: HeadToHead) => {
    if (seenMetric.has(h.metric)) return
    seenMetric.add(h.metric)
    out.push(h)
  }

  // (a) Google rating vs the local set average — broadly grounded for comparative-domain plays.
  if (play.category === "positioning" || play.category === "convergence" || play.category === "reputation") {
    const you = num(ctx.dossier.location?.listing?.profile?.rating)
    const compRatings = (ctx.dossier.competitors ?? [])
      .map((c) => num(c.listing?.profile?.rating))
      .filter((n): n is number => n != null && n > 0)
    if (you != null && you > 0 && compRatings.length) {
      const avg = compRatings.reduce((a, b) => a + b, 0) / compRatings.length
      const lead = you - avg > 0.05 ? "you" : avg - you > 0.05 ? "them" : "even"
      push({
        metric: "Google rating",
        you: `${you.toFixed(1)} stars`,
        setOrCompetitor: `set averages ${avg.toFixed(1)}`,
        lead,
        label:
          lead === "you"
            ? "You out-rate the local set"
            : lead === "them"
              ? "The local set out-rates you"
              : "You and the set are even on rating",
      })
    }
  }

  // (b) social engagement / posting frequency, read from the comparison rules the play cites.
  for (const ref of play.evidenceRefs ?? []) {
    if (!isGrounded(ref, ctx.allowedRefs)) continue
    const base = baseRef(ref)
    const rule = ctx.ruleByType.get(base)
    const ev = rule?.evidence ?? {}
    if (base === "social.engagement_gap" || base === "social.engagement_outperform") {
      const you = num(ev.yourRate)
      const them = num(ev.competitorRate)
      const comp = str(ev.competitor)
      if (you != null && them != null && comp) {
        const lead = you > them ? "you" : them > you ? "them" : "even"
        push({
          metric: "Social engagement",
          you: `${you.toFixed(1)}% per post`,
          setOrCompetitor: `${comp} at ${them.toFixed(1)}%`,
          lead,
          label: lead === "you" ? `You out-engage ${comp} per post` : lead === "them" ? `${comp} out-engages you per post` : `Even with ${comp} on engagement`,
        })
      }
    }
    if (base === "social.posting_frequency_gap") {
      const you = num(ev.yourFrequency)
      const them = num(ev.competitorFrequency)
      const comp = str(ev.competitor)
      if (you != null && them != null && comp) {
        const lead = you > them ? "you" : them > you ? "them" : "even"
        push({
          metric: "Posting frequency",
          you: `${Math.round(you)} a week`,
          setOrCompetitor: `${comp} posts ${Math.round(them)} a week`,
          lead,
          label: lead === "them" ? `${comp} posts more often than you` : lead === "you" ? `You post more often than ${comp}` : `Even with ${comp} on cadence`,
        })
      }
    }
    if (base === "seo_keyword_opportunity_gap") {
      const gaps = Array.isArray(ev.gap_keywords) ? ev.gap_keywords.length : 0
      if (gaps > 0) {
        push({
          metric: "Local search visibility",
          you: "not ranking",
          setOrCompetitor: `competitors rank for ${gaps} keyword${gaps === 1 ? "" : "s"}`,
          lead: "them",
          label: "Competitors are winning local searches you don't appear for",
        })
      }
    }
    if (out.length >= 3) break
  }
  return out.slice(0, 3)
}

// ── 5. advantage — press-the-advantage vs steal-the-cue ───────────────────────

/** A grounded ref or a you-leading head-to-head ⇒ you're winning; a gap/falling ref ⇒ steal the cue. */
const WINNING_REFS = new Set([
  "review_velocity_rising",
  "seo_organic_visibility_up",
  "seo_keyword_win",
  "social.engagement_outperform",
])
const LOSING_REFS = new Set([
  "review_velocity_falling",
  "seo_organic_visibility_down",
  "seo_keyword_opportunity_gap",
  "social.engagement_gap",
  "social.posting_frequency_gap",
  "social.follower_growth_gap",
  "social.platform_presence_gap",
])

function detectAdvantage(play: EnrichedRecommendation, headToHead: HeadToHead[]): boolean | undefined {
  const refs = (play.evidenceRefs ?? []).map(baseRef)
  if (refs.some((r) => WINNING_REFS.has(r))) return true
  if (headToHead.some((h) => h.lead === "you")) return true
  if (refs.some((r) => LOSING_REFS.has(r))) return false
  if (headToHead.some((h) => h.lead === "them")) return false
  return undefined
}

// ── 6. exemplarSocialPost — embed the competitor's winning post ────────────────

function firstGroundedSocialRef(play: EnrichedRecommendation, ctx: PresentationContext): string | null {
  for (const ref of play.evidenceRefs ?? []) {
    if (baseRef(ref).startsWith("social") && isGrounded(ref, ctx.allowedRefs)) return ref
  }
  return null
}

/** The competitor name the play's cited social rule points at (evidence.competitor), if any. */
function citedCompetitorName(play: EnrichedRecommendation, ctx: PresentationContext): string | null {
  for (const ref of play.evidenceRefs ?? []) {
    const base = baseRef(ref)
    if (!base.startsWith("social")) continue
    for (const rule of ctx.rulesByType.get(base) ?? []) {
      const comp = str(rule.evidence?.competitor)
      if (comp) return comp
    }
  }
  return null
}

/**
 * The single best competitor social post to embed on a social play — the #1-praised concept feature.
 * Picks the highest engagement-RATE post (likes+comments+shares ÷ views|followers) from the cited
 * competitor (or, failing a named one, the best across the set), and ONLY when its image is hosted in
 * our own storage (mediaUrl includes "supabase") so it's safe + accessible to embed. Caption is the
 * verbatim post text (OCR'd on-image text as a fallback). Engagement % is omitted when there is no
 * audience denominator — never fabricated.
 */
function buildExemplarSocialPost(play: EnrichedRecommendation, ctx: PresentationContext): ExemplarSocialPost | undefined {
  if (play.category !== "social") return undefined
  const socialRef = firstGroundedSocialRef(play, ctx)
  if (!socialRef) return undefined
  const named = citedCompetitorName(play, ctx)
  const all = ctx.dossier.competitors ?? []
  const candidates = named ? all.filter((c) => c.name === named) : all
  const pool = candidates.length ? candidates : all

  let best: { comp: EntitySignals; post: NormalizedSocialPost; rate: number | null; eng: number } | null = null
  for (const c of pool) {
    const posts = c.social?.recentPosts ?? []
    const followers = num(c.social?.profile?.followerCount) ?? 0
    for (const p of posts) {
      if (!p.mediaUrl || !p.mediaUrl.includes("supabase")) continue // safe-to-embed gate
      const eng = (num(p.likesCount) ?? 0) + (num(p.commentsCount) ?? 0) + (num(p.sharesCount) ?? 0)
      // viewsCount === 0 (a real value, e.g. an image post or an API zero) is NOT a usable denominator
      // — fall back to followers, else there's no rate (?? alone wouldn't fall back on a literal 0).
      const views = num(p.viewsCount)
      const denom = views && views > 0 ? views : followers
      const rate = denom > 0 ? eng / denom : null
      const better =
        !best ||
        (rate ?? -1) > (best.rate ?? -1) ||
        (rate == null && best.rate == null && eng > best.eng)
      if (better) best = { comp: c, post: p, rate, eng }
    }
  }
  if (!best) return undefined
  const p = best.post
  // The caption is verbatim competitor copy. Drop it when it carries $ / POS / discount language so
  // the honesty contract ("no $ anywhere in the block") holds — the image + engagement still carry
  // the competitive signal. NEVER surface a "$5 deal" / "20% off" line as our copy.
  const rawCaption = (str(p.text) ?? str(p.visualAnalysis?.extractedText) ?? "").slice(0, 200)
  const caption = rawCaption && !looksLikeMoneyOrPos(rawCaption) ? rawCaption : ""
  const post: ExemplarSocialPost = {
    competitor: best.comp.name,
    platform: p.platform,
    mediaUrl: p.mediaUrl!,
    caption,
    likes: num(p.likesCount) ?? 0,
    comments: num(p.commentsCount) ?? 0,
    source: socialRef,
  }
  if (best.rate != null) post.engagementPct = Math.round(best.rate * 1000) / 10
  return post
}

// ── 7. estimate — honest, %-framed / range / count (never $ / POS) ────────────

/** Infer the estimate unit from an already-grounded reach string ("43%" → %, "10-15" → range). */
function inferUnit(reach: string): PlayEstimate["unit"] {
  if (/%/.test(reach)) return "%"
  if (/\d\s*(?:-|–|to)\s*\d/.test(reach)) return "range"
  return "count"
}

/** A $/POS guard: an estimate must never carry currency or POS-derived figures. */
function looksLikeMoneyOrPos(s: string): boolean {
  return /[$£€]|\bdollars?\b|\brevenue\b|\bmargin\b|\bprofit\b|\bsales\b|\btickets?\b|\bcovers?\b/i.test(s)
}

/**
 * A structured, honest estimate — surfaced ONLY from an ALREADY-GROUNDED leverage.reach (which has
 * passed the anti-fabrication number gate), framed as %/range/count. We deliberately do NOT invent
 * new reach figures here (no POS = no honest absolute), so this stays a faithful re-presentation of a
 * figure the producer already grounded. Dropped entirely if it smells like $ / POS.
 */
function buildEstimate(play: EnrichedRecommendation): PlayEstimate | undefined {
  const reach = str(play.leverage?.reach)
  if (!reach || looksLikeMoneyOrPos(reach)) return undefined
  return {
    value: reach,
    unit: inferUnit(reach),
    basis: "reach the cited signal supports",
    isEstimated: true,
  }
}

// ── assemble ──────────────────────────────────────────────────────────────────

/**
 * Compose the full presentation block for one play from the dossier context. Each sub-builder is
 * fail-soft (returns nothing when its signal is absent); the block is omitted entirely when empty.
 * Pure + deterministic + idempotent (recomputed from the dossier each present pass).
 */
export function buildPresentation(
  play: EnrichedRecommendation,
  ctx: PresentationContext,
): PlayPresentation | undefined {
  const p: PlayPresentation = {}

  const confidenceBasis = buildConfidenceBasis(play, ctx)
  if (confidenceBasis.length) p.confidenceBasis = confidenceBasis

  const breakoutQuotes = buildBreakoutQuotes(play, ctx)
  if (breakoutQuotes.length) p.breakoutQuotes = breakoutQuotes

  const sentimentByCategory = buildSentimentByCategory(play, ctx)
  if (sentimentByCategory.length) p.sentimentByCategory = sentimentByCategory

  const headToHead = buildHeadToHead(play, ctx)
  if (headToHead.length) p.headToHead = headToHead

  const exemplarSocialPost = buildExemplarSocialPost(play, ctx)
  if (exemplarSocialPost) p.exemplarSocialPost = exemplarSocialPost

  const estimate = buildEstimate(play)
  if (estimate) p.estimate = estimate

  const advantage = detectAdvantage(play, headToHead)
  if (advantage !== undefined) p.advantage = advantage

  return Object.keys(p).length ? p : undefined
}
