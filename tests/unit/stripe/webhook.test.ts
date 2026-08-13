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
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  getOrganizationBillingEmail,
  isMarketingContactsEnabled,
  upsertMarketingContact,
} from "@/lib/marketing/contacts"
import {
  isWebhookEventNew,
  markWebhookEventProcessed,
  applySubscriptionToOrg,
  resolveOrganizationId,
} from "@/lib/stripe/helpers"
import { logAdminAction } from "@/lib/admin/activity-log"

const constructEvent = vi.fn()
const retrieveSubscription = vi.fn()

const payloadSub = () => ({
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  metadata: { organization_id: "org_1" },
  items: { data: [{ price: { id: "price_x" } }] },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStripeClient).mockReturnValue({
    webhooks: { constructEvent },
    subscriptions: { retrieve: retrieveSubscription },
  } as unknown as ReturnType<typeof getStripeClient>)
  vi.mocked(headers).mockResolvedValue(
    new Map([["stripe-signature", "sig_ok"]]) as unknown as Awaited<ReturnType<typeof headers>>
  )
  vi.mocked(isWebhookEventNew).mockResolvedValue(true)
  vi.mocked(resolveOrganizationId).mockResolvedValue("org_1")
  vi.mocked(applySubscriptionToOrg).mockResolvedValue({
    tier: "mid",
    paymentState: "active",
    applied: true,
  })
  // Default: canonical re-fetch returns the same shape as the payload.
  retrieveSubscription.mockResolvedValue(payloadSub())
})

const req = (body = "{}") =>
  new Request("https://x/api/stripe/webhook", { method: "POST", body })

const subEvent = (type = "customer.subscription.updated", id = "evt_1") => ({
  id,
  type,
  created: 1_700_000_100,
  data: { object: payloadSub() },
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
      { deleted: false, eventCreated: 1_700_000_100 }
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
      { deleted: true, eventCreated: 1_700_000_100 }
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

describe("POST /api/stripe/webhook — out-of-order + concurrent delivery contract", () => {
  it("re-fetches canonical subscription state from Stripe and applies THAT, not the event payload", async () => {
    constructEvent.mockReturnValue(subEvent())
    // Canonical state has moved on since the event was emitted.
    retrieveSubscription.mockResolvedValue({ ...payloadSub(), status: "past_due", cancel_at_period_end: true })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_1")
    expect(applySubscriptionToOrg).toHaveBeenCalledWith(
      expect.anything(),
      "org_1",
      expect.objectContaining({ status: "past_due", cancel_at_period_end: true }),
      { deleted: false, eventCreated: 1_700_000_100 }
    )
  })

  it("falls back to the event payload when the canonical re-fetch fails (never drops the event)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    constructEvent.mockReturnValue(subEvent())
    retrieveSubscription.mockRejectedValue(new Error("stripe down"))
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(applySubscriptionToOrg).toHaveBeenCalledWith(
      expect.anything(),
      "org_1",
      expect.objectContaining({ status: "active" }),
      { deleted: false, eventCreated: 1_700_000_100 }
    )
    warn.mockRestore()
  })

  it("does NOT re-fetch on subscription.deleted (payload is final; retrieve could resurrect state)", async () => {
    constructEvent.mockReturnValue(subEvent("customer.subscription.deleted", "evt_del"))
    await POST(req())
    expect(retrieveSubscription).not.toHaveBeenCalled()
  })

  it("acks a stale event 200 (applied=false) but skips the audit log and marketing mirror", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    constructEvent.mockReturnValue(subEvent())
    vi.mocked(applySubscriptionToOrg).mockResolvedValue({
      tier: "mid",
      paymentState: "active",
      applied: false,
    })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(logAdminAction).not.toHaveBeenCalled()
    expect(markWebhookEventProcessed).toHaveBeenCalledWith(expect.anything(), "evt_1")
    warn.mockRestore()
  })
})

// ALT-591: the card-backed half of "trials enter the nurture flow". The
// card-less half lives in tests/unit/onboarding/cardless-trial-marketing-mirror.test.ts;
// both paths converge on upsertMarketingContact with status 'trial'.
describe("POST /api/stripe/webhook — marketing mirror (ALT-591)", () => {
  beforeEach(() => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { industry_type: "restaurant" }, error: null }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createAdminSupabaseClient>)
    vi.mocked(isMarketingContactsEnabled).mockReturnValue(true)
    vi.mocked(getOrganizationBillingEmail).mockResolvedValue("billing@rest.com")
    vi.mocked(upsertMarketingContact).mockResolvedValue({ ok: true })
  })

  it("mirrors a card-backed trial ('trialing' subscription) to status 'trial' with the vertical's source", async () => {
    constructEvent.mockReturnValue(subEvent())
    retrieveSubscription.mockResolvedValue({ ...payloadSub(), status: "trialing" })
    vi.mocked(applySubscriptionToOrg).mockResolvedValue({
      tier: "mid",
      paymentState: "trialing",
      applied: true,
    })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(upsertMarketingContact).toHaveBeenCalledExactlyOnceWith({
      email: "billing@rest.com",
      industryType: "restaurant",
      status: "trial",
      source: "getticket.ai",
      stripeCustomerId: "cus_1",
    })
  })

  it("mirrors an active paid subscription to 'paid'", async () => {
    constructEvent.mockReturnValue(subEvent())
    await POST(req())
    expect(upsertMarketingContact).toHaveBeenCalledWith(expect.objectContaining({ status: "paid" }))
  })

  it("no-ops entirely when MARKETING_CONTACTS_ENABLED is off", async () => {
    vi.mocked(isMarketingContactsEnabled).mockReturnValue(false)
    constructEvent.mockReturnValue(subEvent())
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(getOrganizationBillingEmail).not.toHaveBeenCalled()
    expect(upsertMarketingContact).not.toHaveBeenCalled()
  })

  it("still acks 200 when the mirror throws (billing already landed; Stripe must not retry)", async () => {
    vi.mocked(getOrganizationBillingEmail).mockRejectedValue(new Error("marketing down"))
    constructEvent.mockReturnValue(subEvent())
    const res = await POST(req())
    expect(res.status).toBe(200)
  })
})
