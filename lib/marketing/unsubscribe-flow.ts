import { verifyUnsubscribeParams } from "@/lib/marketing/unsubscribe-token"
import { setMarketingEmailOptOut } from "@/lib/marketing/suppression"

// D7 unsubscribe: the decision logic behind /unsubscribe, extracted from the
// page so the state machine is unit-testable (vitest collects .ts only).
//
// States:
//   invalid      -- missing/bad signature. MUST be indistinguishable for
//                   "email not in our list" vs "email exists": verification
//                   is pure crypto and the DB is never touched on this path.
//   unsubscribed -- signature valid, opt-out recorded. Carries a resubscribe
//                   href built from the SAME signed params.
//   resubscribed -- signature valid, a=resubscribe, opt-out cleared.
//   error        -- signature valid but the storage write failed (e.g. the
//                   marketing schema migration is not applied yet). Neutral
//                   retry copy; reveals nothing about the contact.

export const RESUBSCRIBE_ACTION = "resubscribe"

export type UnsubscribeOutcome =
  | { state: "invalid" }
  | { state: "unsubscribed"; email: string; resubscribeHref: string }
  | { state: "resubscribed"; email: string; unsubscribeHref: string }
  | { state: "error" }

export interface UnsubscribeRequestParams {
  e?: string
  s?: string
  a?: string
}

function selfHref(e: string, s: string, action?: string): string {
  const qs = new URLSearchParams({ e, s })
  if (action) qs.set("a", action)
  return `/unsubscribe?${qs.toString()}`
}

export async function processUnsubscribeRequest(
  params: UnsubscribeRequestParams
): Promise<UnsubscribeOutcome> {
  const { e, s, a } = params

  const email = verifyUnsubscribeParams(e, s)
  if (!email || !e || !s) return { state: "invalid" }

  const resubscribe = a === RESUBSCRIBE_ACTION
  const result = await setMarketingEmailOptOut(email, !resubscribe)
  if (!result.ok) return { state: "error" }

  return resubscribe
    ? { state: "resubscribed", email, unsubscribeHref: selfHref(e, s) }
    : {
        state: "unsubscribed",
        email,
        resubscribeHref: selfHref(e, s, RESUBSCRIBE_ACTION),
      }
}
