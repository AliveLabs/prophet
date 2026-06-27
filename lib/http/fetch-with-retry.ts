// ---------------------------------------------------------------------------
// Shared HTTP resilience for external provider clients (ENG-H1/H2).
//
// Every provider fetch() except the Anthropic client (lib/ai/provider.ts) used to lack a request
// TIMEOUT and retry-on-transient, so a hung connection burned the whole 800s worker budget on one
// location and a transient 5xx silently became "no data" for the day. This lifts the exemplary
// pattern from provider.ts (per-attempt AbortController + Retry-After-aware backoff, abort≠retry)
// into one reusable helper the data providers route through.
//
// Policy:
//   - Per-attempt TIMEOUT via AbortController — bounds a hang (the headline fix).
//   - A TIMEOUT (AbortError) does NOT retry by default: re-issuing a hung request just hangs again
//     and burns more budget. It surfaces a clear timeout error → the caller's existing handling runs.
//   - A NETWORK error or a RETRYABLE status retries with exponential backoff (Retry-After honored).
//   - Callers pass `retries: 0` for non-idempotent POSTs (timeout-only), or a custom
//     `shouldRetryResponse` (e.g. DataForSEO: retry 503, never 402).
// ---------------------------------------------------------------------------

/** Transient HTTP statuses that are safe to retry for an idempotent request. */
export const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type FetchWithRetryOptions = {
  /** Per-attempt abort ceiling in ms. Default 30000 — generous enough not to abort a slow-but-live
   *  call (LLM generation, search); slow data providers pass an explicit higher value. */
  timeoutMs?: number
  /** Retry attempts on a transient failure (network error / retryable status). Default 2 (⇒ 3 attempts).
   *  Set 0 for non-idempotent requests (timeout-only). A TIMEOUT never retries regardless. */
  retries?: number
  /** Override which non-OK responses retry (default: status ∈ RETRYABLE_STATUS). */
  shouldRetryResponse?: (res: Response) => boolean
  /** Base for the exponential backoff (ms): wait = base · 2^(attempt-1). Default 1000. */
  baseBackoffMs?: number
  /** Label for logs (e.g. "dataforseo", "places"). */
  label?: string
}

/** Thrown when a request exceeds its per-attempt timeout (a hang). `code === "ETIMEDOUT"`. */
export class FetchTimeoutError extends Error {
  readonly code = "ETIMEDOUT"
  constructor(label: string, timeoutMs: number) {
    super(`[${label}] request timed out after ${timeoutMs}ms`)
    this.name = "FetchTimeoutError"
  }
}

/**
 * fetch() with a per-attempt timeout + retry-on-transient backoff. Returns the Response (the caller
 * still inspects res.ok / parses the body as before) — non-OK responses that are NOT retryable are
 * returned, not thrown, preserving each client's own error handling (e.g. DataForSEOError on 402).
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit = {},
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const maxAttempts = Math.max(1, (opts.retries ?? 2) + 1)
  const base = opts.baseBackoffMs ?? 1000
  const label = opts.label ?? "fetch"
  const shouldRetry = opts.shouldRetryResponse ?? ((res: Response) => RETRYABLE_STATUS.has(res.status))
  let lastErr: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      if (!res.ok && attempt < maxAttempts && shouldRetry(res)) {
        const retryAfter = Number(res.headers.get("retry-after"))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** (attempt - 1)
        console.warn(`[${label}] ${res.status} (attempt ${attempt}/${maxAttempts}); retrying in ${waitMs}ms`)
        await res.body?.cancel().catch(() => {}) // free the connection before retrying
        await sleep(waitMs)
        continue
      }
      return res
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        // Hung connection — don't retry (it would just hang again + burn budget). Surface a timeout.
        console.warn(`[${label}] aborted after ${timeoutMs}ms (no response)`)
        throw new FetchTimeoutError(label, timeoutMs)
      }
      lastErr = err
      if (attempt < maxAttempts) {
        const waitMs = base * 2 ** (attempt - 1)
        console.warn(`[${label}] network error (attempt ${attempt}/${maxAttempts}): ${err instanceof Error ? err.message : String(err)}; retrying in ${waitMs}ms`)
        await sleep(waitMs)
        continue
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`[${label}] request failed`)
}
