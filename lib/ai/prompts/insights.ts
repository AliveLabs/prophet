type ReviewSnippet = {
  rating?: number
  text?: string
  date?: string
  author?: string
}

export type InsightNarrativeInput = {
  location: {
    name?: string
    rating?: number | null
    reviewCount?: number | null
    priceLevel?: string | null
    hours?: Record<string, string> | null
  }
  competitor: {
    name?: string
    rating?: number | null
    reviewCount?: number | null
    priceLevel?: string | null
    hours?: Record<string, string> | null
  }
  deltas: {
    ratingDelta?: number | null
    reviewCountDelta?: number | null
    hoursChanged?: boolean | null
  }
  reviewSnippets: ReviewSnippet[]
}

export function buildInsightNarrativePrompt(input: InsightNarrativeInput) {
  return [
    "You are Prophet, a competitive intelligence assistant for local businesses.",
    "Use ONLY the provided data. Do NOT infer causality.",
    "Be factual and specific. If a value is missing, say 'not available'.",
    "Return a JSON object with keys: summary, recommendations, reviewThemes.",
    "summary: 2-4 sentences. Must explicitly mention location rating/reviews and competitor rating/reviews if available.",
    "If price level or hours are provided, mention them in one sentence.",
    "recommendations: array of 2-4 objects {title, rationale}. Use data-backed rationales.",
    "reviewThemes: array of 2-4 objects {theme, sentiment, examples}.",
    "Use sentiment values: positive | negative | mixed.",
    "examples should be short quotes from reviewSnippets when available.",
    "Return JSON only. No markdown.",
    "",
    JSON.stringify(input),
  ].join("\n")
}
