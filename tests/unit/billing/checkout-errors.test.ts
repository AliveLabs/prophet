// ALT-551 regression net. The reported symptom was "you can click any of the
// subscription levels or the manage billing button and none of them do anything."
// The cause was that every billing island dropped the route's `{ error }` payload and
// ended at `setLoading(null)`, so a 403 and a 500 both rendered as a dead button.
// These pin the classifier that decides what the operator now gets told.

import { describe, it, expect } from "vitest"
import {
  classifyBillingResponse,
  classifyBillingMutation,
  GENERIC_BILLING_ERROR,
} from "@/lib/billing/checkout-errors"

describe("classifyBillingResponse", () => {
  it("redirects on a 200 carrying a checkout URL", () => {
    expect(classifyBillingResponse(true, { url: "https://checkout.stripe.com/s/1" })).toEqual({
      kind: "redirect",
      url: "https://checkout.stripe.com/s/1",
    })
  })

  it("surfaces a 403 RBAC message instead of failing silently (the ALT-551 bug)", () => {
    const outcome = classifyBillingResponse(false, {
      error: "Only owners or admins can manage billing",
    })
    expect(outcome).toEqual({
      kind: "error",
      message: "Only owners or admins can manage billing",
    })
  })

  it("surfaces the impersonation read-only block", () => {
    const outcome = classifyBillingResponse(false, {
      error: "Read-only while viewing as a user. Exit impersonation to make changes.",
    })
    expect(outcome.kind).toBe("error")
    expect(outcome).toMatchObject({ message: /impersonation/i })
  })

  it("never shows a raw env-var message to an operator", () => {
    const outcome = classifyBillingResponse(false, {
      error: "Missing env var STRIPE_PRICE_ID_TICKET_MID_MONTHLY; run scripts/stripe/setup.ts",
    })
    expect(outcome).toEqual({ kind: "error", message: GENERIC_BILLING_ERROR })
  })

  it("never leaks a raw Stripe 'No such customer' message", () => {
    const outcome = classifyBillingResponse(false, {
      error: "No such customer: cus_UgeYus56hmxKTN",
    })
    expect(outcome).toEqual({ kind: "error", message: GENERIC_BILLING_ERROR })
  })

  it("falls back to the generic line when the body was not JSON (HTML 500 page)", () => {
    expect(classifyBillingResponse(false, null)).toEqual({
      kind: "error",
      message: GENERIC_BILLING_ERROR,
    })
  })

  it("treats a 200 with no URL as an error, not a success", () => {
    // This is the exact shape that produced a dead button: ok response, nothing to go to.
    expect(classifyBillingResponse(true, {}).kind).toBe("error")
    expect(classifyBillingResponse(true, { url: "" }).kind).toBe("error")
  })

  it("never returns a redirect for a failed response even if a URL is present", () => {
    expect(classifyBillingResponse(false, { url: "https://evil.example" }).kind).toBe("error")
  })
})

describe("classifyBillingMutation", () => {
  it("reports done only on ok:true", () => {
    expect(classifyBillingMutation(true, { ok: true })).toEqual({ kind: "done" })
  })

  it("treats a 200 with ok:false as a failure and shows the reason", () => {
    expect(classifyBillingMutation(true, { ok: false, error: "Subscription is past due" })).toEqual({
      kind: "error",
      message: "Subscription is past due",
    })
  })

  it("falls back to the generic line on an unparseable body", () => {
    expect(classifyBillingMutation(false, null)).toEqual({
      kind: "error",
      message: GENERIC_BILLING_ERROR,
    })
  })

  it("does not report done on a failed status even when ok:true is echoed", () => {
    expect(classifyBillingMutation(false, { ok: true }).kind).toBe("error")
  })
})
