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

// ---------------------------------------------------------------------------
// T5(c) — conservative deterministic red-flag check.
//
// reputation@v2's `red_flag_triage` archetype today relies entirely on the model
// reading verbatim examples to notice illness/safety/discrimination language — the
// analyzer never upgrades severity past "warning" and never flags anything itself.
// This adds a SMALL, EXACT-PHRASE deny-list check: when a NEGATIVE theme's examples
// contain an illness / food-safety / discrimination phrase verbatim, the row is
// upgraded to `severity: "critical"` and gets an added `red_flag: true` evidence key.
// reputation@v2's floor and stance backstop already honor "critical" generically
// (see isOwnThemeSignal + the floor check in lib/skills/reputation/skill.ts) — no
// skill change needed.
//
// FALSE-POSITIVE POSTURE (per spec): prefer missing a red flag over crying wolf.
// - EXACT PHRASE matches only, case-insensitive, no fuzzy/stemmed matching.
// - Only applies to themes already classified NEGATIVE by the model — a positive or
//   mixed theme mentioning "health department" (e.g. "health department gave us an A")
//   is not run through this list.
// - The list is intentionally small and specific; it is documented here so it stays
//   the single source of truth (mirrors the CHEF_LINGO deny-list convention in
//   lib/eval/voice-rules.ts).
const RED_FLAG_PHRASES: readonly string[] = [
  // Illness / food-safety
  "food poisoning",
  "got sick",
  "we got sick",
  "made me sick",
  "made us sick",
  "threw up",
  "vomit",
  "health department",
  "health inspector",
  "food safety",
  "undercooked",
  "cross contamination",
  "cross-contamination",
  "found a bug",
  "found a roach",
  "found a mouse",
  "hair in my food",
  "hair in the food",
  // Discrimination
  "racist",
  "racism",
  "discriminated",
  "discrimination",
  "refused to serve",
  "refused service",
  "slur",
]

/** True iff `examples` contains an EXACT (case-insensitive) red-flag phrase. */
function hasRedFlagPhrase(examples: string[]): boolean {
  return examples.some((example) => {
    const lower = example.toLowerCase()
    return RED_FLAG_PHRASES.some((phrase) => lower.includes(phrase))
  })
}

/** Turn review themes into citable GeneratedInsights (so Reputation can ground on them). */
export function reviewInsightsFromSentiment(sentiment: ReviewSentiment): GeneratedInsight[] {
  return sentiment.themes.map((t) => {
    const isRedFlag = t.sentiment === "negative" && hasRedFlagPhrase(t.examples)
    return {
      insight_type: "review.theme",
      title: `Review theme: ${t.theme} (${t.sentiment})`,
      summary:
        t.sentiment === "negative"
          ? `Customers are raising "${t.theme}" as a problem.`
          : `Customers consistently praise "${t.theme}".`,
      confidence: "medium",
      severity: isRedFlag ? "critical" : t.sentiment === "negative" ? "warning" : "info",
      evidence: {
        theme: t.theme,
        sentiment: t.sentiment,
        mentions: t.mentions,
        examples: t.examples,
        windowDays: sentiment.windowDays,
        ...(isRedFlag ? { red_flag: true } : {}),
      },
      recommendations: [],
    }
  })
}
