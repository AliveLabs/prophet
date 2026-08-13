// ALT-551: never trust a stored stripe_customer_id blindly.
//
// organizations.stripe_customer_id is a foreign key into a system we do not control.
// It goes stale in ways no webhook can repair: a customer deleted straight from the
// Stripe dashboard before the customer.deleted handler existed, a test-mode id left
// behind after the environment moved to live keys, or a cross-brand write from the
// shared-DB era stamping an id from the other Stripe account. Passing a stale id to
// checkout.sessions.create / billingPortal.sessions.create throws "No such customer",
// the route 500s, and (before this fix) the billing page swallowed it: every button
// looked dead.
//
// verifyReusableCustomer() answers one question: is this stored id still a live
// customer under the CURRENT Stripe key? If not, the caller mints a fresh customer
// (checkout) or says honestly that there is no billing profile (portal).

import type Stripe from "stripe"

/** The one Stripe surface this module needs, kept minimal so unit tests can fake it. */
export type CustomerRetriever = {
  customers: {
    retrieve: (id: string) => Promise<Stripe.Customer | Stripe.DeletedCustomer>
  }
}

/** Stripe reports an id unknown to the current account/mode as an invalid-request
 *  error with code "resource_missing". Anything else (auth, network, rate limit) is
 *  a real failure and must propagate. */
export function isMissingResourceError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  return (err as { code?: unknown }).code === "resource_missing"
}

/**
 * Returns the stored customer id when it still resolves to a live (non-deleted)
 * customer under the current Stripe key; null when there is nothing reusable
 * (no id stored, customer deleted, or id unknown to this account/mode). Errors
 * other than resource_missing are rethrown so a Stripe outage does not get
 * misread as "customer gone" and trigger a duplicate customer.
 */
export async function verifyReusableCustomer(
  stripe: CustomerRetriever,
  storedId: string | null | undefined,
): Promise<string | null> {
  if (!storedId) return null
  try {
    const customer = await stripe.customers.retrieve(storedId)
    if ((customer as Stripe.DeletedCustomer).deleted) return null
    return storedId
  } catch (err) {
    if (isMissingResourceError(err)) return null
    throw err
  }
}
