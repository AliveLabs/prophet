// ALT-551: the billing page's buttons must never fail silently.
//
// Every billing island (pricing tiles, plan change, cancel, update card) POSTs to a
// /api/stripe/* route and then did the same thing on failure: `if (data.url) redirect
// else setLoading(false)`. The route's own `{ error }` payload was dropped on the floor
// and the catch block was empty, so a 403 (impersonation read-only, or a member-role
// seat), a 500 (missing price env var, stale Stripe customer), or an HTML error page
// all rendered identically: the button flickers and nothing happens. That is the
// reported bug, "you can click any of the subscription levels or the manage billing
// button and none of them do anything."
//
// This module holds the pure half so it can be unit tested: given what came back from
// the route, what does the operator get told? The islands own only the fetch and the
// state.

/** A parsed billing-route response. `url` present = go there; otherwise show `error`. */
export type BillingRouteOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string }

/** Shown when the route failed but gave us nothing usable to display (HTML error page,
 *  empty body, network drop). Deliberately actionable rather than "something broke". */
export const GENERIC_BILLING_ERROR =
  "We could not reach billing just now. Try again, and if it keeps happening contact support@alivelabs.co."

/** Stripe/Supabase messages we never want to put in front of an operator verbatim.
 *  Anything matching falls back to the generic line. */
function isInternalMessage(message: string): boolean {
  return (
    /Missing env var/i.test(message) ||
    /No such customer/i.test(message) ||
    /stripe_customer_id/i.test(message) ||
    /^Unknown industry_type/i.test(message)
  )
}

/**
 * Classify a billing-route response into what the island should do.
 *
 * `ok` is the HTTP ok flag, `payload` is the parsed JSON body (or null when the body
 * was not JSON at all). A 200 carrying a `url` is the only success: some routes answer
 * 200 with `{ ok: false, error }`, and treating that as success is what made a failed
 * plan change look like it worked.
 */
export function classifyBillingResponse(
  ok: boolean,
  payload: unknown,
): BillingRouteOutcome {
  const body = (payload && typeof payload === "object" ? payload : {}) as {
    url?: unknown
    error?: unknown
    ok?: unknown
  }

  if (ok && typeof body.url === "string" && body.url.length > 0) {
    return { kind: "redirect", url: body.url }
  }

  const message = typeof body.error === "string" ? body.error.trim() : ""
  if (!message || isInternalMessage(message)) {
    return { kind: "error", message: GENERIC_BILLING_ERROR }
  }
  return { kind: "error", message }
}

/**
 * Same classification for the routes that answer `{ ok: true }` with no URL and expect
 * the caller to refresh in place (change-plan, cancel).
 */
export function classifyBillingMutation(
  ok: boolean,
  payload: unknown,
): { kind: "done" } | { kind: "error"; message: string } {
  const body = (payload && typeof payload === "object" ? payload : {}) as {
    error?: unknown
    ok?: unknown
  }

  if (ok && body.ok === true) return { kind: "done" }

  const message = typeof body.error === "string" ? body.error.trim() : ""
  if (!message || isInternalMessage(message)) {
    return { kind: "error", message: GENERIC_BILLING_ERROR }
  }
  return { kind: "error", message }
}
