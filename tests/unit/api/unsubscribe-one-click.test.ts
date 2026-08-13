// D7 unsubscribe: RFC 8058 one-click endpoint (/api/unsubscribe).
//
// Mail providers POST to the List-Unsubscribe URI with the body
// `List-Unsubscribe=One-Click` and expect a 2xx and no rendered page. This
// pins that behaviour plus the same non-enumeration rule the page follows.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/marketing/suppression", () => ({
  setMarketingEmailOptOut: vi.fn(),
}))

import { GET, POST } from "@/app/api/unsubscribe/route"
import { setMarketingEmailOptOut } from "@/lib/marketing/suppression"
import { buildUnsubscribeParams } from "@/lib/marketing/unsubscribe-token"

const SECRET = "test-unsub-secret-value"
let originalSecret: string | undefined

function oneClickRequest(query: string) {
  return new Request(`https://app.getticket.ai/api/unsubscribe?${query}`, {
    method: "POST",
    body: "List-Unsubscribe=One-Click",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  })
}

function signedQuery(email: string, extra?: Record<string, string>) {
  const { e, s } = buildUnsubscribeParams(email)
  return new URLSearchParams({ e, s, ...(extra ?? {}) }).toString()
}

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

describe("POST /api/unsubscribe (one-click)", () => {
  it("records the opt-out and returns an empty 200", async () => {
    const res = await POST(oneClickRequest(signedQuery("owner@example.com")))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("")
    expect(setMarketingEmailOptOut).toHaveBeenCalledWith(
      "owner@example.com",
      true
    )
  })

  it("ignores a=resubscribe: one-click only ever opts out", async () => {
    const res = await POST(
      oneClickRequest(signedQuery("owner@example.com", { a: "resubscribe" }))
    )
    expect(res.status).toBe(200)
    expect(setMarketingEmailOptOut).toHaveBeenCalledWith(
      "owner@example.com",
      true
    )
  })

  it("400s on a forged or missing signature without touching storage", async () => {
    const { e } = buildUnsubscribeParams("owner@example.com")
    const forged = await POST(oneClickRequest(`e=${e}&s=not-a-signature`))
    const missing = await POST(oneClickRequest(""))
    expect(forged.status).toBe(400)
    expect(missing.status).toBe(400)
    expect(setMarketingEmailOptOut).not.toHaveBeenCalled()
  })

  it("returns the same 200 for a signed address with no contact row", async () => {
    // The storage layer reports ok on a zero-row UPDATE, so status codes stay
    // identical for known and unknown addresses.
    const res = await POST(oneClickRequest(signedQuery("stranger@example.com")))
    expect(res.status).toBe(200)
  })

  it("500s when the storage write fails so the provider can retry", async () => {
    vi.mocked(setMarketingEmailOptOut).mockResolvedValue({
      ok: false,
      error: new Error("column does not exist"),
    })
    const res = await POST(oneClickRequest(signedQuery("owner@example.com")))
    expect(res.status).toBe(500)
  })
})

describe("GET /api/unsubscribe", () => {
  it("hands a browser off to the page with the signed params intact", async () => {
    const query = signedQuery("owner@example.com")
    const res = await GET(
      new Request(`https://app.getticket.ai/api/unsubscribe?${query}`)
    )
    expect(res.status).toBe(303)
    const location = new URL(res.headers.get("location") ?? "")
    expect(location.pathname).toBe("/unsubscribe")
    expect(location.searchParams.get("s")).toBe(
      new URLSearchParams(query).get("s")
    )
    expect(setMarketingEmailOptOut).not.toHaveBeenCalled()
  })
})
