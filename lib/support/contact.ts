// The customer-facing contact addresses, in one place.
//
// Decided 2026-08-20 (Bryan): every SUPPORT touchpoint in the product is support@getticket.ai.
// The only address that may be info@ is general contact in a marketing footer, which lives in the
// ticket-marketing repo, not here. Before this, three addresses across two domains were reachable
// from the product (support@alivelabs.co in the Stripe portal route, the held-account panel and the
// checkout error copy; support@getticket.ai in the error-report fallback), which splits inbound
// across inboxes and makes a response-time commitment impossible to hold.
//
// Keep these as the ONLY literals. A hardcoded address in a component is how the drift happened.

/** Everything a customer would call support about: billing, errors, account, data questions. */
export const SUPPORT_EMAIL = "support@getticket.ai"

/** General, non-support contact. Marketing-surface only; nothing in the app should need it. */
export const GENERAL_CONTACT_EMAIL = "info@getticket.ai"

/** `mailto:` href for the support address, with an optional prefilled subject. */
export function supportMailto(subject?: string): string {
  if (!subject) return `mailto:${SUPPORT_EMAIL}`
  // encodeURIComponent leaves spaces as %20 (URLSearchParams would emit "+", which mail
  // clients render literally in a subject line).
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
}
