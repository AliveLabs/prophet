// ALT-551: organizations.stripe_customer_id is a foreign key into a system we do not
// control, and a stale one makes checkout/portal throw "No such customer" (a 500 the
// billing page used to swallow into a dead button). These pin the reuse guard: a live
// customer is reused, a gone customer is not, and a Stripe outage never gets misread as
// "customer gone" (which would silently mint duplicate customers for a paying org).

import { describe, it, expect, vi } from "vitest"
import type Stripe from "stripe"
import {
  verifyReusableCustomer,
  isMissingResourceError,
  type CustomerRetriever,
} from "@/lib/stripe/customer-reuse"

function retriever(impl: (id: string) => Promise<unknown>): CustomerRetriever {
  return { customers: { retrieve: impl as CustomerRetriever["customers"]["retrieve"] } }
}

/** The shape Stripe throws for an id unknown to the current account or mode. */
function missingResourceError(): Error & { code: string } {
  return Object.assign(new Error("No such customer: cus_gone"), {
    code: "resource_missing",
  })
}

describe("verifyReusableCustomer", () => {
  it("reuses a live customer", async () => {
    const stripe = retriever(async (id) => ({ id, deleted: undefined }) as Stripe.Customer)
    expect(await verifyReusableCustomer(stripe, "cus_live")).toBe("cus_live")
  })

  it("returns null when nothing is stored, without calling Stripe", async () => {
    const retrieve = vi.fn()
    const stripe = retriever(retrieve)
    expect(await verifyReusableCustomer(stripe, null)).toBeNull()
    expect(await verifyReusableCustomer(stripe, undefined)).toBeNull()
    expect(await verifyReusableCustomer(stripe, "")).toBeNull()
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("returns null for a customer deleted in the Stripe dashboard", async () => {
    const stripe = retriever(async (id) => ({ id, deleted: true }) as Stripe.DeletedCustomer)
    expect(await verifyReusableCustomer(stripe, "cus_deleted")).toBeNull()
  })

  it("returns null for an id unknown to this account or mode (the stale-id case)", async () => {
    const stripe = retriever(async () => {
      throw missingResourceError()
    })
    expect(await verifyReusableCustomer(stripe, "cus_gone")).toBeNull()
  })

  it("RETHROWS a non-missing error so an outage never mints a duplicate customer", async () => {
    const rateLimited = Object.assign(new Error("Too many requests"), { code: "rate_limit" })
    const stripe = retriever(async () => {
      throw rateLimited
    })
    await expect(verifyReusableCustomer(stripe, "cus_live")).rejects.toThrow("Too many requests")
  })

  it("rethrows an error with no code at all rather than assuming the customer is gone", async () => {
    const stripe = retriever(async () => {
      throw new Error("socket hang up")
    })
    await expect(verifyReusableCustomer(stripe, "cus_live")).rejects.toThrow("socket hang up")
  })
})

describe("isMissingResourceError", () => {
  it("recognises Stripe's resource_missing code", () => {
    expect(isMissingResourceError(missingResourceError())).toBe(true)
  })

  it("rejects everything else", () => {
    expect(isMissingResourceError(new Error("boom"))).toBe(false)
    expect(isMissingResourceError({ code: "rate_limit" })).toBe(false)
    expect(isMissingResourceError(null)).toBe(false)
    expect(isMissingResourceError("resource_missing")).toBe(false)
  })
})
