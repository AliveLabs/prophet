import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { isTrialActive } from "@/lib/billing/trial"

const REPO_ROOT = resolve(__dirname, "..", "..", "..")

// ── ALT-749 ─────────────────────────────────────────────────────────────────────────────────
// The blocked list was canceled | incomplete_expired | unpaid, so a `paused` subscription fell
// through to `return !blocked` and got FULL access. `paused` is a value normalizePaymentState
// explicitly accepts, so the system has a slot for it, and a paused subscription is by definition
// one Stripe is not billing.
describe("isTrialActive: a paused subscription is not paid access (ALT-749)", () => {
  const org = (payment_state: string | null) => ({
    trial_ends_at: null,
    subscription_tier: "mid",
    payment_state,
  })

  it("blocks paused", () => {
    expect(isTrialActive(org("paused"))).toBe(false)
  })

  it("still blocks the states it always did", () => {
    for (const s of ["canceled", "incomplete_expired", "unpaid"]) {
      expect(isTrialActive(org(s))).toBe(false)
    }
  })

  it("still allows the states that mean the customer is good", () => {
    for (const s of ["trialing", "active", "past_due", "incomplete"]) {
      expect(isTrialActive(org(s))).toBe(true)
    }
  })

  it("suspended still overrides everything", () => {
    expect(isTrialActive({ trial_ends_at: null, subscription_tier: "suspended", payment_state: "active" })).toBe(false)
  })
})

// ── ALT-717 / ALT-751 ───────────────────────────────────────────────────────────────────────
// Three places read enum values their own CHECK constraint forbids, so the branch could never run.
// Verified against prod 2026-08-21:
//   job_runs.status    CHECK queued | running | succeeded | failed
//   insights.severity  CHECK info | warning | critical
//   pipeline_runs.outcome CHECK fresh | served_stale | dormant | no_data | partial | failed | skipped
//
// A source scan because these are a page component and two small mappers; what failed was reading
// a vocabulary that does not exist, and that is visible in the source.
describe("no code reads an enum value its CHECK constraint forbids", () => {
  const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8")

  it("the admin job-success tile filters on statuses job_runs can actually hold (ALT-717)", () => {
    const src = read("app/admin/page.tsx")
    expect(src).toMatch(/j\.status === "succeeded"/)
    // "completed" and "success" are not in the CHECK, so the tile was structurally 0%.
    expect(src).not.toMatch(/j\.status === "(completed|success)"/)
    expect(src).not.toMatch(/j\.status === "error"/)
  })

  it("the events severity mapper does not read a 'notice' severity (ALT-751)", () => {
    expect(read("app/(dashboard)/events/events-map.ts")).not.toMatch(/severity === "notice"/)
  })

  it("the provenance copy does not read a 'not_reached' outcome (ALT-751)", () => {
    expect(read("lib/ops/provenance-copy.ts")).not.toMatch(/outcome === "not_reached"/)
  })
})
