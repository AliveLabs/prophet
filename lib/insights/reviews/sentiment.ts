// ---------------------------------------------------------------------------
// Review sentiment — funded data. Turns raw review text into structured themes,
// AND into citable GeneratedInsights so the Reputation skill can ground on them.
// LLM-assisted signal processing (part of GATHER, not skill reasoning). Injectable
// transport for tests; deterministic empty fallback so it never blocks a dossier.
// ---------------------------------------------------------------------------

import { generateStructured, type Transport } from "@/lib/ai/provider"
import type { ReviewSentiment } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"

export type RawReview = { text?: string; rating?: number; date?: string }

export async function analyzeReviews(
  reviews: RawReview[],
  opts: { transport?: Transport; source?: ReviewSentiment["source"]; windowDays?: number } = {},
): Promise<ReviewSentiment> {
  const source = opts.source ?? "google_places"
  const windowDays = opts.windowDays ?? 90
  const texts = reviews.map((r) => r.text).filter((t): t is string => !!t && t.trim().length > 0)
  if (texts.length === 0) return { themes: [], source, windowDays }

  const system = [
    "You analyze restaurant reviews. Extract 2-5 recurring THEMES (food, service, value, ambiance, wait, etc.).",
    "For each: a short theme label, sentiment (positive|negative|mixed), how many of the reviews mention it, and 1-2 short example quotes taken VERBATIM from the reviews.",
    "Use ONLY the provided reviews. Do not invent quotes or themes.",
    'Return ONLY JSON: { "themes": [{ "theme": string, "sentiment": "positive"|"negative"|"mixed", "mentions": number, "examples": string[] }] }',
  ].join("\n")
  const prompt = JSON.stringify({ reviews: texts.slice(0, 40) }, null, 2)

  return generateStructured<ReviewSentiment>(
    { tier: "reasoning", system, prompt, temperature: 0.2 },
    {
      transport: opts.transport,
      validate: (raw) => {
        const r = raw as { themes?: unknown }
        if (!Array.isArray(r?.themes)) return null
        const themes = r.themes
          .map((t) => {
            const o = (t ?? {}) as Record<string, unknown>
            const sentiment = ["positive", "negative", "mixed"].includes(String(o.sentiment)) ? (o.sentiment as ReviewSentiment["themes"][number]["sentiment"]) : "mixed"
            return {
              theme: typeof o.theme === "string" ? o.theme : "",
              sentiment,
              mentions: typeof o.mentions === "number" ? o.mentions : 0,
              examples: Array.isArray(o.examples) ? (o.examples as unknown[]).map(String).slice(0, 2) : [],
            }
          })
          .filter((t) => t.theme)
        return { themes, source, windowDays }
      },
      fallback: () => ({ themes: [], source, windowDays }),
    },
  )
}

/** Turn review themes into citable GeneratedInsights (so Reputation can ground on them). */
export function reviewInsightsFromSentiment(sentiment: ReviewSentiment): GeneratedInsight[] {
  return sentiment.themes.map((t) => ({
    insight_type: "review.theme",
    title: `Review theme: ${t.theme} (${t.sentiment})`,
    summary:
      t.sentiment === "negative"
        ? `Customers are raising "${t.theme}" as a problem.`
        : `Customers consistently praise "${t.theme}".`,
    confidence: "medium",
    severity: t.sentiment === "negative" ? "warning" : "info",
    evidence: { theme: t.theme, sentiment: t.sentiment, mentions: t.mentions, examples: t.examples, windowDays: sentiment.windowDays },
    recommendations: [],
  }))
}
