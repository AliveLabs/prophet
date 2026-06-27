// Input hardening for the /api/ai/quick-tip endpoint (SEC-H2). The `context` is caller-supplied and
// concatenated into a Gemini prompt, so cap its length to bound cost + shrink the prompt-injection
// surface. Pure + unit-tested; the route also requires an authenticated session.

/** Max characters of caller-supplied context fed into the quick-tip prompt. */
export const QUICK_TIP_CONTEXT_MAX = 4000

/** Coerce + trim + length-cap the caller-supplied quick-tip context. Returns "" for non-strings. */
export function clampQuickTipContext(raw: unknown, max = QUICK_TIP_CONTEXT_MAX): string {
  if (typeof raw !== "string") return ""
  const trimmed = raw.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}
