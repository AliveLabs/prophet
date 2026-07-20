// Cloudflare Turnstile server-side verification.
//
// House anti-spam standard for public, unauthenticated form endpoints
// (see docs/RUNBOOKS.md "Contact/waitlist spam standard"). Pairs with a
// Turnstile widget rendered on the marketing form; the form sends the token
// in its POST body and this verifies it here.
//
// ENV-GATED, FAIL-CLOSED-ONCE-ON. If TURNSTILE_SECRET_KEY is unset the check
// is SKIPPED (turnstileConfigured() === false) so local dev and pre-config
// environments keep working unchanged. Once the secret IS set, a missing or
// invalid token is REJECTED — that is what closes the "POST straight at the
// endpoint with no token" spam vector. Contrast with only-verify-if-a-token-
// -was-sent, which a bot bypasses by simply omitting the field.

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"

/** True when a Turnstile secret is configured for this environment. */
export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

/**
 * Verify a Turnstile token against Cloudflare.
 *
 * Returns:
 *   - true  when Turnstile is not configured (skip — rely on other layers)
 *   - true  when the token is present and Cloudflare confirms it
 *   - false when configured but the token is missing / invalid / verify errored
 *
 * A slow Cloudflare must never hang the visitor's submission, so the request
 * is bounded by a short timeout and a timeout counts as failure.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true // not configured: skip
  if (!token) return false // configured but no token: this is the spam path
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      signal: AbortSignal.timeout(5_000),
    })
    const json = (await res.json()) as { success?: boolean }
    return Boolean(json.success)
  } catch (err) {
    console.error("[turnstile] verify failed", err)
    return false
  }
}
