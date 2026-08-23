// TEST-2 (code-health audit): the Stripe billing helpers were the single most dangerous untested
// path — org resolution, webhook idempotency, and the subscription.status -> organization state
// mapping that decides who can access the product. A regression here silently corrupts billing.
// These exercise the real helpers against a tiny chainable Supabase mock.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type Stripe from "stripe"
import {
  resolveOrganizationId,
  admitWebhookEvent,
  claimWebhookEvent,
  markWebhookEventProcessed,
  normalizePaymentState,
  readSubscriptionPeriodEnd,
  applySubscriptionToOrg,
  requireOrgOwnerOrAdmin,
  BillingAuthError,
  isBillingAuthError,
} from "@/lib/stripe/helpers"

// A configurable chainable mock covering every chain the helpers use:
//   .from().insert().select()                 -> insertResult   (claimWebhookEvent)
//   .from().select().eq()[.eq()].maybeSingle() -> selectResult   (resolve / role / unknown-price)
//   .from().update().eq()                      -> captured via onUpdate, resolves { error: null }
//   .from().update().eq().or().select()        -> guarded write; filter captured via onUpdateFilter,
//                                                 resolves updateSelectResult (rows actually updated)
type Term = { data?: unknown; error?: unknown }
function makeClient(opts: {
  selectResult?: Term
  insertResult?: Term
  updateSelectResult?: Term
  onUpdate?: (table: string, vals: Record<string, unknown>) => void
  onUpdateFilter?: (filter: string) => void
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
          const done = Promise.resolve({ error: null })
          return {
            then: done.then.bind(done),
            or: (filter: string) => {
              opts.onUpdateFilter?.(filter)
              return {
                select: () =>
                  Promise.resolve(
                    opts.updateSelectResult ?? { data: [{ id: "org_1" }], error: null }
                  ),
              }
            },
          }
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

// ── ALT-738 ─────────────────────────────────────────────────────────────────────────────────
// The ledger check used to answer "have we SEEN this", and that discarded every retry of a
// FAILED event: the row was inserted before dispatch, the handler threw, the route returned 500
// to ask Stripe to retry, and the retry hit 23505 and got "ok (duplicate)". The event was gone
// and the org's billing state stayed diverged from Stripe. The question has to be "did we FINISH
// this", which is a different question.
describe("admitWebhookEvent (pure)", () => {
  it("processes a delivery with no ledger row", () => {
    expect(admitWebhookEvent(null)).toBe("process")
  })

  it("skips a delivery that completed cleanly", () => {
    expect(admitWebhookEvent({ processed_at: "2026-08-21T00:00:00Z", error: null })).toBe("skip_duplicate")
  })

  it("RETRIES a delivery whose handler recorded an error", () => {
    expect(admitWebhookEvent({ processed_at: "2026-08-21T00:00:00Z", error: "boom" })).toBe("retry_failed")
  })

  it("RETRIES a delivery that never finished (attempt died mid-flight)", () => {
    expect(admitWebhookEvent({ processed_at: null, error: null })).toBe("retry_failed")
  })

  it("never returns skip_duplicate for anything that did not succeed", () => {
    for (const row of [
      { processed_at: null, error: null },
      { processed_at: null, error: "boom" },
      { processed_at: "2026-08-21T00:00:00Z", error: "boom" },
    ]) {
      expect(admitWebhookEvent(row)).not.toBe("skip_duplicate")
    }
  })
})

describe("claimWebhookEvent: idempotency ledger", () => {
  it("processes on a fresh insert", async () => {
    const admin = makeClient({ insertResult: { data: [{ event_id: "evt_1" }], error: null } })
    expect(await claimWebhookEvent(admin, "evt_1", "x")).toBe("process")
  })

  it("THROWS on a non-unique DB error so Stripe retries (never silently drops)", async () => {
    const admin = makeClient({ insertResult: { data: null, error: { code: "08006", message: "conn" } } })
    await expect(claimWebhookEvent(admin, "evt_err", "x")).rejects.toBeTruthy()
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

  it("alerts on a price/industry mismatch but still accepts the tier (SEC-Low L3)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    // price_mid is a TICKET (restaurant) price; the org is a liquor_store -> mismatch.
    const admin = makeClient({ selectResult: { data: { industry_type: "liquor_store" } } })
    const { tier } = await applySubscriptionToOrg(admin, "org_1", sub())
    expect(tier).toBe("mid") // accepted, never black-holed
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("MISMATCH"))
    spy.mockRestore()
  })

  // ── ALT-753 half B ────────────────────────────────────────────────────────────────────────
  //
  // An add-on supplements a plan and can never BE the plan. A subscription whose only items are
  // add-ons is how the portal-allow-list bug cashes out: the base price is gone, so
  // `resolvePriceInfo` returns null, the unknown-price branch preserves the tier, and the customer
  // holds full Standard for $18/mo. The script that could build that allow-list is fixed, but the
  // live portal config cannot be read back with a restricted key, so this is the detector.
  describe("an add-on with no base plan is detected", () => {
    const ADDON = "price_addon_competitor"

    it("alerts, and still preserves the tier rather than cutting the account off", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      process.env.STRIPE_PRICE_ID_TICKET_ADDON_COMPETITOR_MONTHLY = ADDON
      let vals: Record<string, unknown> | undefined
      const admin = makeClient({
        selectResult: { data: { subscription_tier: "mid" } },
        onUpdate: (_t, v) => (vals = v),
      })
      const { tier } = await applySubscriptionToOrg(
        admin,
        "org_1",
        sub({ items: { data: [{ price: { id: ADDON }, quantity: 1 }] } } as Partial<Stripe.Subscription>),
      )
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("ADD-ON WITHOUT A BASE PLAN"),
      )
      // Preserved, not corrected: the alternative causes (drifted base-price env vars) are
      // indistinguishable from here, and both corrections would harm a customer who did nothing.
      expect(tier).toBe("mid")
      expect(vals?.subscription_tier).toBe("mid")
      expect(vals?.competitors_purchased).toBe(1)
      spy.mockRestore()
    })

    it("stays quiet on the ordinary shape: a base plan WITH add-ons", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      process.env.STRIPE_PRICE_ID_TICKET_ADDON_COMPETITOR_MONTHLY = ADDON
      const admin = makeClient({})
      await applySubscriptionToOrg(
        admin,
        "org_1",
        sub({
          items: { data: [{ price: { id: "price_mid" } }, { price: { id: ADDON }, quantity: 2 }] },
        } as Partial<Stripe.Subscription>),
      )
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it("stays quiet on an unknown price with NO add-ons, which is the env-drift case", async () => {
      // The pre-existing unknown-price path must not start alarming. It fires only when add-on
      // quantities are present, because that is what makes the shape impossible rather than stale.
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      const admin = makeClient({ selectResult: { data: { subscription_tier: "top" } } })
      await applySubscriptionToOrg(
        admin,
        "org_1",
        sub({ items: { data: [{ price: { id: "price_unknown" } }] } } as Partial<Stripe.Subscription>),
      )
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it("stays quiet on a deleted subscription, where both quantities park at 0 anyway", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      process.env.STRIPE_PRICE_ID_TICKET_ADDON_COMPETITOR_MONTHLY = ADDON
      let vals: Record<string, unknown> | undefined
      const admin = makeClient({ onUpdate: (_t, v) => (vals = v) })
      await applySubscriptionToOrg(
        admin,
        "org_1",
        sub({ items: { data: [{ price: { id: ADDON }, quantity: 3 }] } } as Partial<Stripe.Subscription>),
        { deleted: true },
      )
      expect(spy).not.toHaveBeenCalled()
      expect(vals?.competitors_purchased).toBe(0)
      spy.mockRestore()
    })
  })
})

describe("applySubscriptionToOrg — event-ordering guard (out-of-order / concurrent webhooks)", () => {
  const ENV = process.env
  beforeEach(() => {
    process.env = { ...ENV, STRIPE_PRICE_ID_TICKET_MID_MONTHLY: "price_mid" }
  })
  afterEach(() => {
    process.env = ENV
  })

  const sub = () =>
    ({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      items: { data: [{ price: { id: "price_mid" } }] },
    }) as unknown as Stripe.Subscription

  it("stamps stripe_event_created and guards the UPDATE on event.created when eventCreated is given", async () => {
    let vals: Record<string, unknown> | undefined
    let filter: string | undefined
    const admin = makeClient({
      onUpdate: (_t, v) => (vals = v),
      onUpdateFilter: (f) => (filter = f),
    })
    const { applied } = await applySubscriptionToOrg(admin, "org_1", sub(), {
      eventCreated: 1_700_000_100,
    })
    expect(applied).toBe(true)
    expect(vals?.stripe_event_created).toBe(1_700_000_100)
    expect(filter).toContain("stripe_event_created.is.null")
    expect(filter).toContain("stripe_event_created.lte.1700000100")
  })

  it("returns applied=false when a newer event already landed (stale write matches 0 rows)", async () => {
    const admin = makeClient({ updateSelectResult: { data: [], error: null } })
    const { applied } = await applySubscriptionToOrg(admin, "org_1", sub(), {
      eventCreated: 1_700_000_050,
    })
    expect(applied).toBe(false)
  })

  it("THROWS when the guarded UPDATE errors so Stripe retries (never silently drops)", async () => {
    const admin = makeClient({
      updateSelectResult: { data: null, error: { message: "conn reset" } },
    })
    await expect(
      applySubscriptionToOrg(admin, "org_1", sub(), { eventCreated: 1_700_000_100 })
    ).rejects.toThrow(/conn reset/)
  })

  it("callers without eventCreated keep the unguarded write and never touch stripe_event_created", async () => {
    let vals: Record<string, unknown> | undefined
    let filter: string | undefined
    const admin = makeClient({
      onUpdate: (_t, v) => (vals = v),
      onUpdateFilter: (f) => (filter = f),
    })
    const { applied } = await applySubscriptionToOrg(admin, "org_1", sub())
    expect(applied).toBe(true)
    expect(vals).toBeDefined()
    expect(vals && "stripe_event_created" in vals).toBe(false)
    expect(filter).toBeUndefined()
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

// ── ALT-578, billing half ───────────────────────────────────────────────────────────────────
//
// `resolveOrgActorWith` (lib/auth/actor.ts) closed the soft-delete gap for /api/ask and
// /api/ai/*, but the five Stripe routes resolve the org themselves and never went through it.
// `requireOrgOwnerOrAdmin` checked membership and role and NOT `organizations.deleted_at`, so
// every billing route was reachable by an owner or admin of a deleted org.
//
// The split matters more than the guard. Soft-delete is an admin action, it is explicitly
// RECOVERABLE, and it does NOT touch Stripe, so a deleted org can still be BILLING. Blocking
// cancel and portal would leave a real customer paying with no way to stop because an admin hid
// their org, which is worse than the thing the guard prevents. So: block anything that starts or
// grows paid capacity, leave the exits open.
describe("requireOrgOwnerOrAdmin — the soft-delete gate", () => {
  const ADMIN = { role: "admin" }

  // The membership read and the org read are two different .from() calls that both end in
  // .maybeSingle(). This mock answers them in order.
  function twoStep(first: unknown, second: unknown): SupabaseClient {
    let call = 0
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: call++ === 0 ? first : second, error: null }),
    }
    return { from: () => chain } as unknown as SupabaseClient
  }

  it("refuses when the org is soft-deleted", async () => {
    const sb = twoStep(ADMIN, { deleted_at: "2026-08-20T00:00:00Z" })
    await expect(requireOrgOwnerOrAdmin(sb, "u1", "org1")).rejects.toThrow(/has been deleted/i)
  })

  it("allows when deleted_at is null", async () => {
    const sb = twoStep(ADMIN, { deleted_at: null })
    await expect(requireOrgOwnerOrAdmin(sb, "u1", "org1")).resolves.toBe("admin")
  })

  it("DEFAULTS to checking, so a route added later is safe without anyone remembering", async () => {
    // The polarity is the whole design. Opting out has to be written down.
    const sb = twoStep(ADMIN, { deleted_at: "2026-08-20T00:00:00Z" })
    await expect(requireOrgOwnerOrAdmin(sb, "u1", "org1", {})).rejects.toThrow(/has been deleted/i)
  })

  it("lets cancel and portal through with requireActive:false, so nobody is trapped paying", async () => {
    const sb = twoStep(ADMIN, { deleted_at: "2026-08-20T00:00:00Z" })
    await expect(
      requireOrgOwnerOrAdmin(sb, "u1", "org1", { requireActive: false }),
    ).resolves.toBe("admin")
  })

  it("fails CLOSED when the org read errors, because this gate stands in front of taking money", async () => {
    // Deliberately the opposite polarity to the cost guards, which fail open: halting the product
    // beats overspending, but "should we charge this account" must not proceed on an unknown.
    let call = 0
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve(
          call++ === 0 ? { data: ADMIN, error: null } : { data: null, error: { message: "boom" } },
        ),
    }
    const sb = { from: () => chain } as unknown as SupabaseClient
    await expect(requireOrgOwnerOrAdmin(sb, "u1", "org1")).rejects.toThrow(/boom/)
  })

  it("still refuses a non-member and a plain member before it ever reads the org", async () => {
    await expect(requireOrgOwnerOrAdmin(twoStep(null, null), "u1", "org1")).rejects.toThrow(/member/i)
    await expect(
      requireOrgOwnerOrAdmin(twoStep({ role: "member" }, null), "u1", "org1"),
    ).rejects.toThrow(/owners or admins/i)
  })
})

describe("isBillingAuthError — a refusal is 403, a failure is 500", () => {
  it("recognises the typed refusal", () => {
    expect(isBillingAuthError(new BillingAuthError("anything at all"))).toBe(true)
  })

  it("recognises the deleted-org refusal, which the old regex would have MISSED", () => {
    // This is the bug the type fixes: the wording contains no "owner", "admin" or "member" as a
    // standalone word match the old check relied on, so it would have surfaced as a 500
    // "Failed to ..." and read like our bug rather than a decision about their account.
    const err = new BillingAuthError("This organization has been deleted, so nobody can subscribe.")
    expect(isBillingAuthError(err)).toBe(true)
    expect(/owner|admin|member/i.test(err.message)).toBe(false)
  })

  it("keeps the regex as a backstop, so pre-existing 403s do not become 500s", () => {
    expect(isBillingAuthError(new Error("Only owners or admins can manage billing"))).toBe(true)
    expect(isBillingAuthError(new Error("Not a member of this organization"))).toBe(true)
  })

  it("does not dress a real failure up as a refusal", () => {
    expect(isBillingAuthError(new Error("Stripe timed out"))).toBe(false)
    expect(isBillingAuthError(new Error("ECONNRESET"))).toBe(false)
    expect(isBillingAuthError("a bare string")).toBe(false)
  })
})
