// D7 unsubscribe: the /unsubscribe state machine.
//
// The load-bearing property here is NON-ENUMERATION. An unauthenticated page
// that reacts to an email address is an address oracle unless every failure
// looks identical and unknown addresses are indistinguishable from known
// ones. Both directions are pinned below.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/marketing/suppression", () => ({
  setMarketingEmailOptOut: vi.fn(),
}))

import { processUnsubscribeRequest } from "@/lib/marketing/unsubscribe-flow"
import { setMarketingEmailOptOut } from "@/lib/marketing/suppression"
import { buildUnsubscribeParams } from "@/lib/marketing/unsubscribe-token"

const SECRET = "test-unsub-secret-value"
let originalSecret: string | undefined

beforeEach(() => {
  originalSecret = process.env.UNSUB_SECRET
  process.env.UNSUB_SECRET = SECRET
  vi.clearAllMocks()
  vi.mocked(setMarketingEmailOptOut).mockResolvedValue({ ok: true })
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.UNSUB_SECRET
  else process.env.UNSUB_SECRET = originalSecret
})

describe("processUnsubscribeRequest", () => {
  it("records the opt-out and offers a resubscribe link on a valid signature", async () => {
    const { e, s } = buildUnsubscribeParams("owner@example.com")
    const outcome = await processUnsubscribeRequest({ e, s })

    expect(setMarketingEmailOptOut).toHaveBeenCalledWith(
      "owner@example.com",
      true
    )
    expect(outcome.state).toBe("unsubscribed")
    if (outcome.state !== "unsubscribed") return
    expect(outcome.email).toBe("owner@example.com")
    // The resubscribe affordance reverses the flag through the SAME signed
    // params, so it needs no second secret and no session.
    expect(outcome.resubscribeHref).toContain("a=resubscribe")
    expect(outcome.resubscribeHref).toContain(encodeURIComponent(s))
  })

  it("clears the opt-out on a=resubscribe and offers the reverse link", async () => {
    const { e, s } = buildUnsubscribeParams("owner@example.com")
    const outcome = await processUnsubscribeRequest({ e, s, a: "resubscribe" })

    expect(setMarketingEmailOptOut).toHaveBeenCalledWith(
      "owner@example.com",
      false
    )
    expect(outcome.state).toBe("resubscribed")
    if (outcome.state !== "resubscribed") return
    expect(outcome.unsubscribeHref).not.toContain("a=resubscribe")
  })

  it("treats an unrecognised action as a plain unsubscribe", async () => {
    const { e, s } = buildUnsubscribeParams("owner@example.com")
    const outcome = await processUnsubscribeRequest({ e, s, a: "nonsense" })
    expect(setMarketingEmailOptOut).toHaveBeenCalledWith(
      "owner@example.com",
      true
    )
    expect(outcome.state).toBe("unsubscribed")
  })

  it("surfaces a neutral error state when the storage write fails", async () => {
    vi.mocked(setMarketingEmailOptOut).mockResolvedValue({
      ok: false,
      error: new Error("column does not exist"),
    })
    const { e, s } = buildUnsubscribeParams("owner@example.com")
    const outcome = await processUnsubscribeRequest({ e, s })
    // No email, no detail: the failure reason never reaches the page.
    expect(outcome).toEqual({ state: "error" })
  })
})

describe("non-enumeration", () => {
  it("returns the identical invalid outcome for every bad input shape", async () => {
    const { e, s } = buildUnsubscribeParams("owner@example.com")
    const bad = [
      {},
      { e },
      { s },
      { e, s: "forged-signature" },
      { e: Buffer.from("someone@else.com").toString("base64url"), s },
      { e: "%%%not-base64%%%", s },
    ]
    for (const params of bad) {
      expect(await processUnsubscribeRequest(params)).toEqual({
        state: "invalid",
      })
    }
    // An invalid link must never reach storage: no DB touch means no timing
    // or error-shape channel that could confirm an address.
    expect(setMarketingEmailOptOut).not.toHaveBeenCalled()
  })

  it("gives a signed address with no contact row the same success state as a known one", async () => {
    // The storage layer UPDATEs by email and reports ok for zero rows, so the
    // page cannot distinguish "opted out" from "never heard of you".
    vi.mocked(setMarketingEmailOptOut).mockResolvedValue({ ok: true })
    const known = await processUnsubscribeRequest(
      buildUnsubscribeParams("known@example.com")
    )
    const unknown = await processUnsubscribeRequest(
      buildUnsubscribeParams("stranger@example.com")
    )
    expect(known.state).toBe("unsubscribed")
    expect(unknown.state).toBe("unsubscribed")
  })

  it("shows the invalid state, not an error state, when the secret is missing", async () => {
    const { e, s } = buildUnsubscribeParams("owner@example.com")
    delete process.env.UNSUB_SECRET
    expect(await processUnsubscribeRequest({ e, s })).toEqual({
      state: "invalid",
    })
    expect(setMarketingEmailOptOut).not.toHaveBeenCalled()
  })
})
