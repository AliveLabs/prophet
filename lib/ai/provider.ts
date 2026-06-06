// ---------------------------------------------------------------------------
// Provider abstraction (Phase 2) — one tiered interface for structured LLM output.
//
// generateStructured<T>({ tier, system, prompt }) returns validated JSON.
//   - tier "reasoning" -> Claude (the skill/synthesis brains)
//   - tier "cheap"     -> Gemini Flash via the existing wrapper (voice, tagging, vision-adjacent)
//
// Deliberately hand-rolled REST (matches the repo's existing gemini.ts style) to
// avoid a new-SDK version surface. Model ids come from env so they never go stale.
// The transport is injectable, so skills are unit-tested with a deterministic mock
// (no live calls, no spend) and wired to the real models when keys are present.
// ---------------------------------------------------------------------------

import { generateGeminiJson } from "@/lib/ai/gemini"

export type ModelTier = "reasoning" | "cheap"

export type GenerateRequest = {
  tier: ModelTier
  system?: string
  prompt: string
  maxOutputTokens?: number
  temperature?: number
}

/** A transport returns already-parsed JSON (or null on parse failure). Injectable for tests. */
export type Transport = (req: GenerateRequest) => Promise<unknown>

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5"
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

export function extractJson(text: string): unknown {
  // strip markdown code fences, then try whole-string parse
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  try {
    return JSON.parse(t)
  } catch {
    /* fall through to bracket extraction */
  }
  // extract the outermost JSON value — array OR object, whichever opens first
  const firstObj = t.indexOf("{")
  const firstArr = t.indexOf("[")
  let start = -1
  let close = "}"
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr
    close = "]"
  } else if (firstObj !== -1) {
    start = firstObj
    close = "}"
  }
  if (start === -1) return null
  const end = t.lastIndexOf(close)
  if (end <= start) return null
  try {
    return JSON.parse(t.slice(start, end + 1))
  } catch {
    return null
  }
}

// Anthropic returns these on transient load/rate issues; they are safe to retry.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 529])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Claude raw text via the stable Messages REST API. Needs ANTHROPIC_API_KEY.
 *  Retries transient errors (429/5xx/529 overloaded) with backoff so a momentary
 *  provider hiccup never silently degrades a brief to the deterministic fallback. */
export async function claudeRaw(req: GenerateRequest, opts: { retries?: number } = {}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured")
  const maxAttempts = (opts.retries ?? 4) + 1 // synthesis runs right after a parallel skill burst; survive rate limits
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: req.maxOutputTokens ?? 8192,
          temperature: req.temperature ?? 0.4,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: "user", content: req.prompt }],
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        const err = new Error(`Anthropic error ${res.status}: ${body}`)
        if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
          lastErr = err
          // Honor Retry-After (seconds) when present, else exponential backoff (1s,2s,4s,8s).
          const retryAfter = Number(res.headers.get("retry-after"))
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1)
          console.warn(`[claudeRaw] ${res.status} (attempt ${attempt}/${maxAttempts}); retrying in ${waitMs}ms`)
          await sleep(waitMs)
          continue
        }
        throw err
      }
      const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
      return (data.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("")
    } catch (err) {
      // network/transport error — retry too
      lastErr = err
      if (attempt < maxAttempts) {
        await sleep(1000 * 2 ** (attempt - 1))
        continue
      }
      throw err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Anthropic request failed")
}

/** Reasoning tier — Claude returning parsed JSON. */
export async function claudeTransport(req: GenerateRequest): Promise<unknown> {
  return extractJson(await claudeRaw(req))
}

/** Cheap tier — Gemini via the existing wrapper (folds system into the prompt). */
export async function geminiTransport(req: GenerateRequest): Promise<unknown> {
  const prompt = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt
  return generateGeminiJson(prompt, { maxOutputTokens: req.maxOutputTokens, temperature: req.temperature })
}

export function defaultTransport(req: GenerateRequest): Promise<unknown> {
  return req.tier === "reasoning" ? claudeTransport(req) : geminiTransport(req)
}

// PROD ROUTING: in production these adapters should sit behind the Vercel AI Gateway
// (OIDC auth, provider routing, failover, cost telemetry). Because the transport is
// swappable, a `gatewayTransport` drops in here later WITHOUT changing generateStructured
// or any skill. Kept as direct REST for now to stay dependency-free and headless-testable.

export type StructuredOptions<T> = {
  transport?: Transport
  /** Coerce/validate the parsed JSON into T. Return null to signal invalid -> fallback/throw. */
  validate?: (raw: unknown) => T | null
  /** Deterministic fallback when the model fails or returns invalid output. */
  fallback?: () => T
}

/**
 * The one call skills/synthesis/voice use. Returns validated T, or the fallback,
 * or throws if neither validates and no fallback is given.
 */
export async function generateStructured<T>(req: GenerateRequest, opts: StructuredOptions<T> = {}): Promise<T> {
  const transport = opts.transport ?? defaultTransport
  let raw: unknown = null
  try {
    raw = await transport(req)
  } catch (err) {
    if (opts.fallback) return opts.fallback()
    throw err
  }
  const validated = opts.validate ? opts.validate(raw) : (raw as T | null)
  if (validated != null) return validated
  if (opts.fallback) return opts.fallback()
  throw new Error("generateStructured: model returned invalid output and no fallback was provided")
}
