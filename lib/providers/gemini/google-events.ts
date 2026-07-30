// ---------------------------------------------------------------------------
// Gemini + Google Search grounding — GROUNDED events adapter
// (Events source migration · P0 step 1)
//
// WHY THIS EXISTS: DataForSEO's scraped Google-Events SERP is the weak link — it put
// Fuerza Regida on 7/10 (real: 7/31) and missed the 7/10 Rangers game entirely, while a
// live Gemini `google_search`-grounded probe got both right (2026-07-09). This adapter
// asks Gemini Flash, grounded on live Google Search, for the marquee/notable events near a
// location and returns them as a typed list for downstream normalization.
//
// CONTRACT (the anti-silent-zeroing rule — risk #3 of the migration):
//   • THROWS a typed GroundedEventsError on: HTTP !ok, empty content (finishReason
//     MAX_TOKENS — thinking ate the budget), or unparseable output. A throw is a SIGNAL,
//     never a stand-in for "no events" — the pipeline catches it and FALLS BACK to
//     DataForSEO so a Gemini blip can never zero out the demand rail.
//   • Returns [] ONLY on a well-formed `{ "events": [] }` — a genuine "nothing on".
//
// Modeled on fetchGoogleMenuData (lib/ai/gemini.ts): same Flash-grounding shape, the
// ALT-294 thinkingBudget cap + finishReason logging, and brace-extraction parsing
// (google_search grounding is INCOMPATIBLE with responseSchema/responseMimeType, so a
// strict schema can't be enforced server-side — we validate the shape ourselves).
// ---------------------------------------------------------------------------

import { fetchWithRetry } from "@/lib/http/fetch-with-retry"
import { EVENT_TYPES, type EventType } from "@/lib/events/types"

const GEMINI_FLASH_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

/** A single event as returned by the grounded model, pre-normalization. */
export type GroundedEvent = {
  title: string
  type: EventType
  venue: { name?: string; address?: string; city?: string }
  /** As written by the model — messy; normalize via lib/events/date-normalize. */
  startDatetime: string
  endDatetime?: string | null
  ticketed: boolean
  ticketUrl?: string | null
  officialUrl?: string | null
}

export type FetchGroundedEventsInput = {
  /** "City, State" or "City, State, United States". */
  locationName: string
  lat?: number | null
  lng?: number | null
  /** Forward window the model should cover, in days. Default 21. */
  horizonDays?: number
  /** Cap on returned events (guards the ALT-294 truncation class). Default 20. */
  maxEvents?: number
  /** Optional model override (tests / future tuning). Defaults to gemini-2.5-flash. */
  modelUrl?: string
}

/** Why a grounded fetch failed — lets the pipeline log a distinct 429/quota vs transient vs
 *  parse signal, and lets telemetry separate "Gemini is down" from "no events today". */
export type GroundedEventsErrorCode =
  | "http_error"
  | "quota"
  | "empty_content"
  | "parse_error"
  | "no_key"

export class GroundedEventsError extends Error {
  code: GroundedEventsErrorCode
  status?: number
  finishReason?: string
  constructor(message: string, code: GroundedEventsErrorCode, extra?: { status?: number; finishReason?: string }) {
    super(message)
    this.name = "GroundedEventsError"
    this.code = code
    this.status = extra?.status
    this.finishReason = extra?.finishReason
  }
}

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> }
  finishReason?: string
}
type GeminiResponse = { candidates?: GeminiCandidate[] }

function getGeminiKey(): string {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) throw new GroundedEventsError("GOOGLE_AI_API_KEY is not configured", "no_key")
  return key
}

/** Lenient JSON extraction — grounded output can't use responseSchema, so it may carry prose
 *  or a ```json fence. Try strict parse, then the first {...} span. Returns null on failure. */
function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/,"").trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function buildPrompt(input: FetchGroundedEventsInput): string {
  const horizon = input.horizonDays ?? 21
  const maxEvents = input.maxEvents ?? 20
  const where = input.lat != null && input.lng != null
    ? `${input.locationName} (near ${input.lat}, ${input.lng})`
    : input.locationName
  return [
    `You are a local-events research assistant. Use Google Search to find real, scheduled events happening in or near ${where} within the next ${horizon} days.`,
    `Prioritize events that draw a crowd and would affect nearby restaurant demand: professional and college sports games, concerts and tours, festivals, marathons/parades/races, large conferences and expos, and major community or family events.`,
    `Return AT MOST ${maxEvents} events, most significant first.`,
    ``,
    `For EACH event return:`,
    `- title: the specific event name (e.g. "Texas Rangers vs Houston Astros", not "baseball game")`,
    `- type: one of ${EVENT_TYPES.join(" | ")}`,
    `- venue: { name, address, city }`,
    `- startDatetime: the local start in ISO 8601 with the local time, e.g. "2026-07-31T19:30". Include the correct YEAR. If you cannot verify the exact date, OMIT the event entirely — do not guess.`,
    `- endDatetime: local end in ISO 8601 if known, else null`,
    `- ticketed: true if tickets are sold for it, else false`,
    `- ticketUrl: a real ticket URL if known, else null`,
    `- officialUrl: the event or venue official page if known, else null`,
    ``,
    `Rules: Only include events you can verify from search results. Do NOT invent events, dates, or venues. Accuracy of the DATE and VENUE matters more than quantity.`,
    `Return ONLY a JSON object, no markdown, in exactly this shape:`,
    `{ "events": [ { "title": "...", "type": "sports", "venue": { "name": "...", "address": "...", "city": "..." }, "startDatetime": "2026-07-31T19:30", "endDatetime": null, "ticketed": true, "ticketUrl": null, "officialUrl": null } ] }`,
    `If there are genuinely no such events, return { "events": [] }.`,
  ].join("\n")
}

function coerceType(raw: unknown): EventType {
  const t = typeof raw === "string" ? raw.toLowerCase().trim() : ""
  return (EVENT_TYPES as readonly string[]).includes(t) ? (t as EventType) : "other"
}

function coerceEvents(parsed: unknown, maxEvents: number): GroundedEvent[] {
  const events = (parsed as { events?: unknown } | null)?.events
  if (!Array.isArray(events)) {
    // A well-formed object MUST carry an `events` array (even if empty). Anything else is a
    // parse failure, not an empty result → throw so the pipeline falls back (never silent-zero).
    throw new GroundedEventsError("Grounded response missing an `events` array", "parse_error")
  }
  const out: GroundedEvent[] = []
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue
    const e = raw as Record<string, unknown>
    const title = typeof e.title === "string" ? e.title.trim() : ""
    const startDatetime = typeof e.startDatetime === "string" ? e.startDatetime.trim() : ""
    if (!title || !startDatetime) continue // a nameless or dateless event is unusable
    const venueRaw = (e.venue && typeof e.venue === "object" ? (e.venue as Record<string, unknown>) : {})
    out.push({
      title,
      type: coerceType(e.type),
      venue: {
        name: typeof venueRaw.name === "string" ? venueRaw.name.trim() : undefined,
        address: typeof venueRaw.address === "string" ? venueRaw.address.trim() : undefined,
        city: typeof venueRaw.city === "string" ? venueRaw.city.trim() : undefined,
      },
      startDatetime,
      endDatetime: typeof e.endDatetime === "string" ? e.endDatetime.trim() : null,
      ticketed: e.ticketed === true,
      ticketUrl: typeof e.ticketUrl === "string" ? e.ticketUrl.trim() : null,
      officialUrl: typeof e.officialUrl === "string" ? e.officialUrl.trim() : null,
    })
    if (out.length >= maxEvents) break
  }
  return out
}

/**
 * Fetch grounded events for a location. THROWS GroundedEventsError on any failure that must
 * fall back to DataForSEO; returns [] only on a genuine well-formed empty result.
 */
export async function fetchGroundedEvents(input: FetchGroundedEventsInput): Promise<GroundedEvent[]> {
  const maxEvents = input.maxEvents ?? 20
  const key = getGeminiKey()
  const url = `${input.modelUrl ?? GEMINI_FLASH_URL}?key=${key}`

  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8192,
          // Flash bills thinking against the output budget too; cap it so reasoning can't eat the
          // whole budget and return empty content (the ALT-294 class). Grounding still runs.
          thinkingConfig: { thinkingBudget: 2048 },
        },
      }),
    },
    {
      timeoutMs: 120_000, // grounded generation routinely passes the 30s default (see gemini-discovery)
      label: "gemini-events",
      // Retry only genuinely transient 5xx. A 429 is quota exhaustion — retrying wastes the worker
      // budget and hides a real signal; fail fast so the pipeline falls back to DataForSEO.
      shouldRetryResponse: (res) => res.status >= 500 && res.status <= 599,
    },
  )

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const code: GroundedEventsErrorCode = response.status === 429 ? "quota" : "http_error"
    throw new GroundedEventsError(
      `Grounded events HTTP ${response.status}: ${body.slice(0, 200)}`,
      code,
      { status: response.status },
    )
  }

  const data = (await response.json()) as GeminiResponse
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
  if (!text) {
    // 200 with empty parts ⇒ finishReason MAX_TOKENS almost always (thinking consumed the budget).
    // This is a FAILURE, not "no events" — throw so the pipeline falls back (never silent-zero).
    throw new GroundedEventsError(
      `Grounded events returned empty content (finishReason=${candidate?.finishReason ?? "unknown"})`,
      "empty_content",
      { finishReason: candidate?.finishReason },
    )
  }

  const parsed = parseJson(text)
  if (parsed === null) {
    throw new GroundedEventsError("Grounded events output was not parseable JSON", "parse_error")
  }
  return coerceEvents(parsed, maxEvents)
}
