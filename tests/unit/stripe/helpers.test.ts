// TEST-2 (code-health audit): the Stripe billing helpers were the single most dangerous untested
// path — org resolution, webhook idempotency, and the subscription.status -> organization state
// mapping that decides who can access the product. A regression here silently corrupts billing.
// These exercise the real helpers against a tiny chainable Supabase mock.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type Stripe from "stripe"
import {
  resolveOrganizationId,
  isWebhookEventNew,
  markWebhookEventProcessed,
  normalizePaymentState,
  readSubscriptionPeriodEnd,
  applySubscriptionToOrg,
  requireOrgOwnerOrAdmin,
} from "@/lib/stripe/helpers"

// A configurable chainable mock covering every chain the helpers use:
//   .from().insert().select()                 -> insertResult   (isWebhookEventNew)
//   .from().select().eq()[.eq()].maybeSingle() -> selectResult   (resolve / role / unknown-price)
//   .from().update().eq()                      -> captured via onUpdate, resolves { error: null }
type Term = { data?: unknown; error?: unknown }
function makeClient(opts: {
  selectResult?: Term
  insertResult?: Term
  onUpdate?: (table: string, vals: Record<string, unknown>) => void
} = {}): SupabaseClient {
  const eqChain: Record<string, unknown> = {
    eq: () => eqChain,
    maybeSingle: () => Promise.resolve(opts.selectResult ?? { data: null }),
  }
  const client = {
    from: (table: string) => ({
      select: () => eqChain,
      insert: () => ({
        select: () =>
          Promise.resolve(opts.insertResult ?? { data: [{ event_id: "e" }], error: null }),
      }),
      update: (vals: Record<string, unknown>) => ({
        eq: () => {
          opts.onUpdate?.(table, vals)
          return Promise.resolve({ error: null })
        },
      }),
    }),
  }
  return client as unknown as SupabaseClient
}

describe("resolveOrganizationId", () => {
  it("short-circuits on client_reference_id without touching the DB", async () => {
    // A null client would throw if the function tried to query — proves the short-circuit.
    const id = await resolveOrganizationId(null as unknown as SupabaseClient, {
      clientReferenceId: "org_direct",
      stripeCustomerId: "cus_1",
    })
    expect(id).toBe("org_direct")
  })

  it("falls back to a stripe_customer_id lookup", async () => {
    const admin = makeClient({ selectResult: { data: { id: "org_by_customer" } } })
    const id = await resolveOrganizationId(admin, { stripeCustomerId: "cus_1" })
    expect(id).toBe("org_by_customer")
  })

  it("returns null when nothing resolves", async () => {
    const admin = makeClient({ selectResult: { data: null } })
    const id = await resolveOrganizationId(admin, {
      stripeCustomerId: "cus_unknown",
      stripeSubscriptionId: "sub_unknown",
    })
    expect(id).toBeNull()
  })
})

describe("isWebhookEventNew — idempotency ledger", () => {
  it("returns true on a fresh insert", async () => {
    const admin = makeClient({ insertResult: { data: [{ event_id: "evt_1" }], error: null } })
    expect(await isWebhookEventNew(admin, "evt_1", "x")).toBe(true)
  })

  it("returns false on a unique-violation (duplicate delivery)", async () => {
    const admin = makeClient({ insertResult: { data: null, error: { code: "23505" } } })
    expect(await isWebhookEventNew(admin, "evt_dup", "x")).toBe(false)
  })

  it("THROWS on any other DB error so Stripe retries (never silently drops)", async () => {
    const admin = makeClient({ insertResult: { data: null, error: { code: "08006", message: "conn" } } })
    await expect(isWebhookEventNew(admin, "evt_err", "x")).rejects.toBeTruthy()
  })
})

describe("markWebhookEventProcessed", () => {
  it("stamps processed_at and clears error on success", async () => {
    let captured: Record<string, unknown> | undefined
    const admin = makeClient({ onUpdate: (_t, v) => (captured = v) })
    await markWebhookEventProcessed(admin, "evt_1")
    expect(captured?.processed_at).toBeTruthy()
    expect(captured?.error).toBeNull()
  })

  it("records the error string when a handler failed", async () => {
    let captured: Record<string, unknown> | undefined
    const admin = makeClient({ onUpdate: (_t, v) => (captured = v) })
    await markWebhookEventProcessed(admin, "evt_1", "boom")
    expect(captured?.error).toBe("boom")
  })
})

describe("normalizePaymentState — Stripe status mirror", () => {
  it("passes through every state the DB CHECK accepts", () => {
    for (const s of ["trialing", "active", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"]) {
      expect(normalizePaymentState(s)).toBe(s)
    }
  })
  it("maps unknown / empty status to null (don't blow up the CHECK)", () => {
    expect(normalizePaymentState("some_new_stripe_state")).toBeNull()
    expect(normalizePaymentState(null)).toBeNull()
    expect(normalizePaymentState(undefined)).toBeNull()
  })
})

describe("readSubscriptionPeriodEnd — Stripe API version drift", () => {
  it("reads the top-level field (older API shape)", () => {
    const sub = { current_period_end: 1_700_000_000, items: { data: [{}] } } as unknown as Stripe.Subscription
    expect(readSubscriptionPeriodEnd(sub)).toBe(1_700_000_000)
  })
  it("falls back to the item-level field (newer API shape)", () => {
    const sub = { items: { data: [{ current_period_end: 1_711_111_111 }] } } as unknown as Stripe.Subscription
    expect(readSubscriptionPeriodEnd(sub)).toBe(1_711_111_111)
  })
  it("returns null when neither is present", () => {
    const sub = { items: { data: [{}] } } as unknown as Stripe.Subscription
    expect(readSubscriptionPeriodEnd(sub)).toBeNull()
  })
})

describe("applySubscriptionToOrg — subscription -> org state (the access-gating write)", () => {
  const ENV = process.env
  beforeEach(() => {
    process.env = { ...ENV, STRIPE_PRICE_ID_TICKET_MID_MONTHLY: "price_mid" }
  })
  afterEach(() => {
    process.env = ENV
  })

  const sub = (over: Partial<Stripe.Subscription> = {}) =>
    ({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      items: { data: [{ price: { id: "price_mid" } }] },
      ...over,
    }) as unknown as Stripe.Subscription

  it("derives the tier from the subscription's price and writes it", async () => {
    let vals: Record<string, unknown> | undefined
    const admin = makeClient({ onUpdate: (_t, v) => (vals = v) })
    const { tier, paymentState } = await applySubscriptionToOrg(admin, "org_1", sub())
    expect(tier).toBe("mid")
    expect(paymentState).toBe("active")
    expect(vals?.subscription_tier).toBe("mid")
    expect(vals?.stripe_subscription_id).toBe("sub_1")
  })

  it("on a deleted subscription parks tier='entry' + payment_state='canceled'", async () => {
    let vals: Record<string, unknown> | undefined
    const admin = makeClient({ onUpdate: (_t, v) => (vals = v) })
    const { tier, paymentState } = await applySubscriptionToOrg(admin, "org_1", sub(), { deleted: true })
    expect(tier).toBe("entry")
    expect(paymentState).toBe("canceled")
    expect(vals?.payment_state).toBe("canceled")
  })

  it("on an UNKNOWN price preserves the org's existing tier (never stomps a paying customer)", async () => {
    let vals: Record<string, unknown> | undefined
    const admin = makeClient({
      selectResult: { data: { subscription_tier: "top" } },
      onUpdate: (_t, v) => (vals = v),
    })
    const { tier } = await applySubscriptionToOrg(admin, "org_1", sub({ items: { data: [{ price: { id: "price_unknown" } }] } } as Partial<Stripe.Subscription>))
    expect(tier).toBe("top")
    expect(vals?.subscription_tier).toBe("top")
  })

  it("converts a unix trial_end into an ISO trial_ends_at", async () => {
    let vals: Record<string, unknown> | undefined
    const admin = makeClient({ onUpdate: (_t, v) => (vals = v) })
    await applySubscriptionToOrg(admin, "org_1", sub({ trial_end: 1_700_000_000 } as Partial<Stripe.Subscription>))
    expect(vals?.trial_ends_at).toBe(new Date(1_700_000_000 * 1000).toISOString())
  })
})

describe("requireOrgOwnerOrAdmin — billing RBAC gate", () => {
  it("allows owners and admins", async () => {
    for (const role of ["owner", "admin"]) {
      const sb = makeClient({ selectResult: { data: { role } } })
      expect(await requireOrgOwnerOrAdmin(sb, "u1", "org1")).toBe(role)
    }
  })
  it("rejects a plain member", async () => {
    const sb = makeClient({ selectResult: { data: { role: "member" } } })
    await expect(requireOrgOwnerOrAdmin(sb, "u1", "org1")).rejects.toThrow(/owners or admins/)
  })
  it("rejects a non-member", async () => {
    const sb = makeClient({ selectResult: { data: null } })
    await expect(requireOrgOwnerOrAdmin(sb, "u1", "org1")).rejects.toThrow(/Not a member/)
  })
})
