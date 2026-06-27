// TEST-2 (code-health audit): the Stripe webhook dispatcher — "the single most dangerous untested
// code" per the audit. This pins its security/idempotency contract: reject unsigned/forged events,
// never re-process a duplicate, dispatch to the right handler, and on a handler failure record the
// error + return 500 so Stripe retries (never a silent 200). Handlers/helpers are mocked — this is
// the routing + error contract, not the DB writes (those are covered in helpers.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next/headers", () => ({ headers: vi.fn() }))
vi.mock("@/lib/stripe/client", () => ({ getStripeClient: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn(() => ({})) }))
vi.mock("@/lib/stripe/helpers", () => ({
  isWebhookEventNew: vi.fn(),
  markWebhookEventProcessed: vi.fn(),
  resolveOrganizationId: vi.fn(),
  applySubscriptionToOrg: vi.fn(),
}))
vi.mock("@/lib/admin/activity-log", () => ({ logAdminAction: vi.fn(), SYSTEM_ACTOR_ID: "system" }))
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn(), FROM_ADDRESS_TICKET: "t@x", FROM_ADDRESS_NEAT: "n@x" }))
vi.mock("@/lib/email/templates/payment-failed", () => ({ PaymentFailed: vi.fn(() => null) }))
vi.mock("@/lib/marketing/contacts", () => ({
  isMarketingContactsEnabled: vi.fn(() => false),
  getOrganizationBillingEmail: vi.fn(),
  upsertMarketingContact: vi.fn(),
}))

import { POST } from "@/app/api/stripe/webhook/route"
import { headers } from "next/headers"
import { getStripeClient } from "@/lib/stripe/client"
import {
  isWebhookEventNew,
  markWebhookEventProcessed,
  applySubscriptionToOrg,
  resolveOrganizationId,
} from "@/lib/stripe/helpers"

const constructEvent = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStripeClient).mockReturnValue({
    webhooks: { constructEvent },
  } as unknown as ReturnType<typeof getStripeClient>)
  vi.mocked(headers).mockResolvedValue(
    new Map([["stripe-signature", "sig_ok"]]) as unknown as Awaited<ReturnType<typeof headers>>
  )
  vi.mocked(isWebhookEventNew).mockResolvedValue(true)
  vi.mocked(resolveOrganizationId).mockResolvedValue("org_1")
  vi.mocked(applySubscriptionToOrg).mockResolvedValue({ tier: "mid", paymentState: "active" })
})

const req = (body = "{}") =>
  new Request("https://x/api/stripe/webhook", { method: "POST", body })

const subEvent = (type = "customer.subscription.updated", id = "evt_1") => ({
  id,
  type,
  data: {
    object: {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      metadata: { organization_id: "org_1" },
      items: { data: [{ price: { id: "price_x" } }] },
    },
  },
})

describe("POST /api/stripe/webhook — security + idempotency contract", () => {
  it("rejects a request with no Stripe signature (400), never verifying", async () => {
    vi.mocked(headers).mockResolvedValue(new Map() as unknown as Awaited<ReturnType<typeof headers>>)
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(constructEvent).not.toHaveBeenCalled()
  })

  it("rejects a forged/invalid signature (400) before any DB work", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature")
    })
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(isWebhookEventNew).not.toHaveBeenCalled()
  })

  it("short-circuits a duplicate delivery (200) without dispatching or re-marking", async () => {
    constructEvent.mockReturnValue(subEvent())
    vi.mocked(isWebhookEventNew).mockResolvedValue(false)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.text()).toMatch(/duplicate/)
    expect(applySubscriptionToOrg).not.toHaveBeenCalled()
    expect(markWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it("dispatches a subscription event to the handler and marks it processed (200)", async () => {
    constructEvent.mockReturnValue(subEvent())
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(applySubscriptionToOrg).toHaveBeenCalledWith(
      expect.anything(),
      "org_1",
      expect.objectContaining({ id: "sub_1" }),
      { deleted: false }
    )
    expect(markWebhookEventProcessed).toHaveBeenCalledWith(expect.anything(), "evt_1")
  })

  it("propagates deleted=true on a subscription.deleted event", async () => {
    constructEvent.mockReturnValue(subEvent("customer.subscription.deleted", "evt_del"))
    await POST(req())
    expect(applySubscriptionToOrg).toHaveBeenCalledWith(
      expect.anything(),
      "org_1",
      expect.anything(),
      { deleted: true }
    )
  })

  it("on a handler failure returns 500 (Stripe retries) and records the error", async () => {
    constructEvent.mockReturnValue(subEvent())
    vi.mocked(applySubscriptionToOrg).mockRejectedValue(new Error("kaboom"))
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(markWebhookEventProcessed).toHaveBeenCalledWith(expect.anything(), "evt_1", "kaboom")
  })

  it("marks an unhandled event type processed (clean ledger) without dispatching", async () => {
    constructEvent.mockReturnValue({ id: "evt_x", type: "customer.created", data: { object: {} } })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(applySubscriptionToOrg).not.toHaveBeenCalled()
    expect(markWebhookEventProcessed).toHaveBeenCalledWith(expect.anything(), "evt_x")
  })
})
