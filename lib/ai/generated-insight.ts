// ALT-230 Action 1 — input hardening + prompt for on-demand "Generate insight"
// from a data-viz card. The caller-supplied viz context is concatenated into a
// Gemini prompt, so we coerce + length-cap every field (cost + prompt-injection
// surface), mirroring lib/ai/quick-tip.ts. Pure + unit-tested; the route also
// requires an authenticated session and rate-limits.
//
// Plain language only — NO restaurant/kitchen lingo in the prompt or output
// (CHEF_LINGO deny-list / lintVoice CI gate).

export const GENERATED_INSIGHT_TYPE_PREFIX = "user_viz"

const VIZ_DOMAINS = [
  "weather",
  "traffic",
  "social",
  "competitors",
  "events",
  "content",
  "visibility",
  "menu",
  "overview",
] as const
export type VizDomain = (typeof VIZ_DOMAINS)[number]

export type ParsedViz = {
  domain: VizDomain
  metric: string
  value?: string
  unit?: string
  entityName?: string
  timeframe?: string
  source?: string
  locationId?: string
}

const FIELD_MAX = 160

function str(raw: unknown, max = FIELD_MAX): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s) return undefined
  return s.length > max ? s.slice(0, max) : s
}

/**
 * Coerce + validate the caller-supplied viz context. Accepts either a JSON string
 * (as it arrives from the `?generate=` param) or an already-parsed object. Returns
 * null for anything we can't make a valid `domain` + `metric` out of.
 */
export function parseVizContext(raw: unknown): ParsedViz | null {
  let obj: Record<string, unknown> | null = null
  if (typeof raw === "string") {
    // Normal path: Next decodes searchParams once, so `raw` is already valid JSON.
    // Fallback: if it somehow arrives still URL-encoded (double-encoding / tampering),
    // decode then parse. We try the plain parse FIRST so a value containing a literal
    // "%" (e.g. "80%") never trips decodeURIComponent (which would throw on "%" + non-hex).
    const tryParse = (s: string): Record<string, unknown> | null => {
      try {
        const p: unknown = JSON.parse(s)
        return p && typeof p === "object" ? (p as Record<string, unknown>) : null
      } catch {
        return null
      }
    }
    obj = tryParse(raw)
    if (!obj) {
      try {
        obj = tryParse(decodeURIComponent(raw))
      } catch {
        obj = null
      }
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>
  }
  if (!obj) return null

  const domain = String(obj.domain ?? "") as VizDomain
  if (!VIZ_DOMAINS.includes(domain)) return null

  const metric = str(obj.metric)
  if (!metric) return null

  // locationId is a uuid/text — keep it short and free of prompt content (it's used
  // for the DB lookup, never put in the prompt).
  const locationId = typeof obj.locationId === "string" ? obj.locationId.slice(0, 64) : undefined

  return {
    domain,
    metric,
    value: str(obj.value, 80),
    unit: str(obj.unit, 12),
    entityName: str(obj.entityName, 80),
    timeframe: str(obj.timeframe, 80),
    source: str(obj.source, 80),
    locationId,
  }
}

/** `user_viz.<domain>.<shortid>` — the `user_viz` prefix is load-bearing (home-hero
 *  guard); the `<domain>` segment routes the source category (scoring.ts); the
 *  `<shortid>` keeps every generation a distinct row (no unique-constraint clash). */
export function generatedInsightType(domain: VizDomain, shortId: string): string {
  return `${GENERATED_INSIGHT_TYPE_PREFIX}.${domain}.${shortId}`
}

/** Plain-language, strict-JSON prompt grounded in THIS single data point. */
export function buildGeneratedInsightPrompt(viz: ParsedViz): string {
  const facts = [
    `Data point: ${viz.metric}${viz.value ? ` = ${viz.value}${viz.unit ?? ""}` : ""}`,
    viz.entityName ? `About: ${viz.entityName}` : null,
    `Area of the product: ${viz.domain}`,
    viz.timeframe ? `Timeframe: ${viz.timeframe}` : null,
    viz.source ? `Source: ${viz.source}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  return [
    "You are a competitive-intelligence analyst for an independent restaurant operator.",
    "The operator clicked one data point in their dashboard and wants a short, honest read of what it means and what to do about it.",
    "",
    "Rules:",
    "- Ground everything in the single data point below. Do NOT invent numbers, competitors, or facts you weren't given.",
    "- Plain, everyday language. No industry jargon. Never use the words \"covers\", \"floor\", or \"kickoff\".",
    "- Be honest about uncertainty: one data point is limited, so confidence is \"medium\" or \"low\", never \"high\".",
    "- Recommendations must be concrete and doable this week.",
    "",
    facts,
    "",
    "Return ONLY a JSON object, no markdown, with exactly this shape:",
    "{",
    '  "title": "a specific, plain-language headline, max 80 chars",',
    '  "summary": "1-2 sentences on what this means for the operator, max 250 chars",',
    '  "confidence": "medium" | "low",',
    '  "severity": "info" | "warning",',
    '  "recommendations": [ { "title": "a concrete action", "rationale": "one sentence why" } ]',
    "}",
    "Keep recommendations to at most 3.",
  ].join("\n")
}
