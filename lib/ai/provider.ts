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
  /** STABLE system prefix, byte-identical across calls (skill playbook + rules +
   *  schema). Sent as the first system block with cache_control so sequential brief
   *  builds reuse it (~0.1x input price on hits). Volatile per-location context goes
   *  in `system`, AFTER the cache breakpoint. Below ~1024 tokens it silently won't
   *  cache (harmless). Kill-switch: ANTHROPIC_PROMPT_CACHE=0. */
  systemCached?: string
  prompt: string
  maxOutputTokens?: number
  temperature?: number
  /** Deep pass (P5): override the model + enable adaptive thinking for the convergence +
   *  synthesis passes. On Opus 4.8 thinking is ADAPTIVE (no budget_tokens) and temperature
   *  MUST be omitted, so when `thinking` is set we drop temperature and add output_config.effort.
   *  Producers leave these unset (Sonnet + temperature, as before). */
  model?: string
  thinking?: boolean
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
  /** Observability only (e.g. the skill id). Named in the truncation/fallback logs so a degraded
   *  call points at the culprit skill. NEVER sent to the API. */
  label?: string
}

/** A transport returns already-parsed JSON (or null on parse failure). Injectable for tests. */
export type Transport = (req: GenerateRequest) => Promise<unknown>

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"
/** Deep reasoning model for the convergence + synthesis pass (P5): Opus + adaptive thinking. */
export const DEEP_MODEL = process.env.ANTHROPIC_DEEP_MODEL ?? "claude-opus-4-8"
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

// The deep pass is NON-streaming with a 32k max_tokens; a hung Opus call must abort and
// degrade to the deterministic fallback rather than stall the whole brief. Generous because
// adaptive thinking is genuinely slow. Normal (Sonnet) calls get a tighter ceiling.
const DEEP_TIMEOUT_MS = Number(process.env.ANTHROPIC_DEEP_TIMEOUT_MS) || 120_000
const REQUEST_TIMEOUT_MS = Number(process.env.ANTHROPIC_REQUEST_TIMEOUT_MS) || 60_000

export function extractJson(text: string): unknown {
  // strip markdown code fences, then try whole-string parse
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
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

/** Build the `system` payload. With a systemCached prefix (and caching enabled) it
 *  becomes a block array: [stable block + cache_control(1h), volatile block]. The 1h
 *  TTL matters: sequential brief builds put 1-6 min between same-skill calls, which
 *  straddles the default 5-minute cache window. */
function buildSystemPayload(req: GenerateRequest): string | Array<Record<string, unknown>> | undefined {
  const cachingEnabled = process.env.ANTHROPIC_PROMPT_CACHE !== "0"
  if (req.systemCached && cachingEnabled) {
    return [
      { type: "text", text: req.systemCached, cache_control: { type: "ephemeral", ttl: "1h" } },
      ...(req.system ? [{ type: "text", text: req.system }] : []),
    ]
  }
  // Disabled or no cached prefix: same content as a plain string.
  const joined = [req.systemCached, req.system].filter(Boolean).join("\n")
  return joined || undefined
}

/** Claude raw text via the stable Messages REST API. Needs ANTHROPIC_API_KEY.
 *  Retries transient errors (429/5xx/529 overloaded) with backoff so a momentary
 *  provider hiccup never silently degrades a brief to the deterministic fallback. */
export async function claudeRaw(req: GenerateRequest, opts: { retries?: number } = {}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured")
  // synthesis runs right after a parallel skill burst; retry to survive rate limits. Only the
  // EXPENSIVE Opus deep call retries fewer times (each retry is a costly Opus+thinking call) —
  // Sonnet producers now also think but stay cheap, so keep their full retry budget.
  const isDeepOpus = req.thinking === true && (req.model ?? "").includes("opus")
  const maxAttempts = (opts.retries ?? (isDeepOpus ? 1 : 4)) + 1
  // Thinking calls are non-streaming with big headroom; give them a generous abort ceiling so a
  // hang degrades to the fallback instead of stalling the brief. Non-thinking calls get a tighter one.
  const timeoutMs = req.thinking ? DEEP_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  let lastErr: unknown
  const system = buildSystemPayload(req)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Fresh controller per attempt: abort a HUNG request so it can't stall the whole brief.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: req.model ?? ANTHROPIC_MODEL,
          // Thinking tokens count toward output, so the deep pass needs much more headroom.
          max_tokens: req.maxOutputTokens ?? (req.thinking ? 32000 : 8192),
          // Opus 4.8 + adaptive thinking REJECTS temperature (400); producers (Sonnet) keep it.
          ...(req.thinking
            ? { thinking: { type: "adaptive" }, output_config: { effort: req.effort ?? "high" } }
            : { temperature: req.temperature ?? 0.4 }),
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: req.prompt }],
        }),
        signal: controller.signal,
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
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>
        stop_reason?: string | null
        usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
      }
      // Cache observability: read>0 means the stable prefix hit; creation>0 means it
      // was (re)written this call. Zero on both across repeats = silent invalidator.
      const u = data.usage
      if (u) {
        console.log(
          `[claudeRaw] usage in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0}`
        )
      }
      // TRUNCATION GUARD (2026-07-03): adaptive-thinking tokens count toward max_tokens, so a real
      // (large) prompt can hit the ceiling mid-thinking and emit little/no JSON. That used to slip
      // through as empty text → null parse → SILENT deterministic fallback — hiding a fleet-wide
      // producer regression for ~2 weeks. Fail LOUD: name the skill + out_tokens and THROW so the
      // call degrades visibly (and the fallback log/health signal can classify it as "truncated").
      if (data.stop_reason === "max_tokens") {
        const cap = req.maxOutputTokens ?? (req.thinking ? 32000 : 8192)
        console.error(
          `[claudeRaw] ${req.label ? `${req.label} ` : ""}output TRUNCATED at max_tokens ` +
            `(model=${req.model ?? ANTHROPIC_MODEL}, out=${u?.output_tokens ?? "?"}, cap=${cap}) — raise maxOutputTokens`,
        )
        const truncErr = new Error(`Anthropic output truncated at max_tokens (out=${u?.output_tokens ?? "?"}, cap=${cap})`)
        truncErr.name = "TruncationError"
        throw truncErr
      }
      return (data.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("")
    } catch (err) {
      // A timeout abort means the call HUNG — retrying just hangs again (and on the deep path
      // burns another expensive Opus call). Bail straight to the fallback instead of retrying.
      if ((err as { name?: string })?.name === "AbortError") {
        console.warn(`[claudeRaw] aborted after ${timeoutMs}ms (no response); degrading to fallback`)
        throw new Error(`Anthropic request timed out after ${timeoutMs}ms`)
      }
      // Truncation is DETERMINISTIC — retrying the same prompt at the same cap just truncates again
      // (and burns another call). Bail straight to the fallback, like the abort path.
      if ((err as { name?: string })?.name === "TruncationError") throw err
      // network/transport error — retry too
      lastErr = err
      if (attempt < maxAttempts) {
        await sleep(1000 * 2 ** (attempt - 1))
        continue
      }
      throw err
    } finally {
      clearTimeout(timer)
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
  const system = [req.systemCached, req.system].filter(Boolean).join("\n")
  const prompt = system ? `${system}\n\n${req.prompt}` : req.prompt
  return generateGeminiJson(prompt, { maxOutputTokens: req.maxOutputTokens, temperature: req.temperature })
}

export function defaultTransport(req: GenerateRequest): Promise<unknown> {
  return req.tier === "reasoning" ? claudeTransport(req) : geminiTransport(req)
}

// PROD ROUTING: in production these adapters should sit behind the Vercel AI Gateway
// (OIDC auth, provider routing, failover, cost telemetry). Because the transport is
// swappable, a `gatewayTransport` drops in here later WITHOUT changing generateStructured
// or any skill. Kept as direct REST for now to stay dependency-free and headless-testable.

/** Why a call degraded to its deterministic fallback — carried into the log line and the
 *  per-skill health signal so a fleet-wide degrade names its cause instead of hiding. */
export type FallbackReason = "truncated" | "timeout" | "rate_limited" | "transport_error" | "unparseable"

/** Classify a transport throw for the fallback log + health signal. */
function classifyTransportError(err: unknown): FallbackReason {
  const msg = err instanceof Error ? err.message : String(err)
  if (/truncated at max_tokens/i.test(msg)) return "truncated"
  if (/timed out/i.test(msg)) return "timeout"
  if (/\b429\b|rate.?limit/i.test(msg)) return "rate_limited"
  return "transport_error"
}

export type StructuredOptions<T> = {
  transport?: Transport
  /** Coerce/validate the parsed JSON into T. Return null to signal invalid -> fallback/throw. */
  validate?: (raw: unknown) => T | null
  /** Deterministic fallback when the model fails or returns invalid output. */
  fallback?: () => T
  /** Fires when the deterministic fallback is served, with WHY + elapsed. Lets the caller
   *  (runProducerSkill) mark the result so the brief records per-skill health and the pipeline
   *  watchdog can alert on fleet-wide fallback-serving (the 2026-06 truncation bug hid because a
   *  fallback was indistinguishable from a real generation at every layer above this one). */
  onFallback?: (info: { reason: FallbackReason; elapsedMs: number }) => void
}

/**
 * The one call skills/synthesis/voice use. Returns validated T, or the fallback,
 * or throws if neither validates and no fallback is given.
 */
export async function generateStructured<T>(req: GenerateRequest, opts: StructuredOptions<T> = {}): Promise<T> {
  const transport = opts.transport ?? defaultTransport
  const label = req.label ? `${req.label} ` : ""
  const startedAt = Date.now()
  let raw: unknown = null
  try {
    raw = await transport(req)
  } catch (err) {
    // Surface the degrade-to-floor transition — a fleet-wide model outage/truncation otherwise
    // drops every brief to its deterministic fallback with no signal at this layer.
    if (opts.fallback) {
      const reason = classifyTransportError(err)
      const elapsedMs = Date.now() - startedAt
      console.warn(`[generateStructured] ${label}model call failed (reason=${reason}, ${elapsedMs}ms); serving deterministic fallback:`, err)
      opts.onFallback?.({ reason, elapsedMs })
      return opts.fallback()
    }
    throw err
  }
  const validated = opts.validate ? opts.validate(raw) : (raw as T | null)
  if (validated != null) return validated
  if (opts.fallback) {
    const elapsedMs = Date.now() - startedAt
    console.warn(`[generateStructured] ${label}model output failed validation (reason=unparseable, ${elapsedMs}ms); serving deterministic fallback`)
    opts.onFallback?.({ reason: "unparseable", elapsedMs })
    return opts.fallback()
  }
  throw new Error("generateStructured: model returned invalid output and no fallback was provided")
}
