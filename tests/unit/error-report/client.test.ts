// ALT-243: pure client-side helpers used by app/error.tsx + app/global-error.tsx — payload
// construction, the mailto: fallback link, and the submit-with-fallback contract.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  buildErrorReportPayload,
  buildMailtoHref,
  submitErrorReport,
  ERROR_REPORT_FALLBACK_EMAIL,
} from "@/lib/error-report/client"

describe("buildErrorReportPayload", () => {
  it("captures digest, url, timestamp, and message from the error boundary", () => {
    const now = new Date("2026-06-30T12:00:00.000Z")
    const payload = buildErrorReportPayload(
      { digest: "abc123", message: "TypeError: x is not a function" },
      "https://app.getticket.ai/home",
      now
    )
    expect(payload).toEqual({
      digest: "abc123",
      url: "https://app.getticket.ai/home",
      timestamp: "2026-06-30T12:00:00.000Z",
      message: "TypeError: x is not a function",
    })
  })

  it("omits message when the error has none", () => {
    const payload = buildErrorReportPayload({}, "https://app.getticket.ai/home", new Date())
    expect(payload.message).toBeUndefined()
  })
})

describe("buildMailtoHref", () => {
  it("builds a mailto link with subject 'Error ref {digest}' and a body containing reference, URL, and timestamp", () => {
    const href = buildMailtoHref({
      digest: "abc123",
      url: "https://app.getticket.ai/home",
      timestamp: "2026-06-30T12:00:00.000Z",
    })
    expect(href).toMatch(new RegExp(`^mailto:${ERROR_REPORT_FALLBACK_EMAIL}\\?`))
    expect(href).toContain("subject=Error%20ref%20abc123")
    const decodedBody = decodeURIComponent(href.split("body=")[1].replace(/%20/g, " "))
    expect(decodedBody).toContain("Reference: abc123")
    expect(decodedBody).toContain("URL: https://app.getticket.ai/home")
    expect(decodedBody).toContain("Time: 2026-06-30T12:00:00.000Z")
  })

  it("falls back to a generic subject when there is no digest", () => {
    const href = buildMailtoHref({ url: "https://app.getticket.ai/home", timestamp: "2026-06-30T12:00:00.000Z" })
    expect(href).toContain("subject=Error%20report")
  })
})

describe("submitErrorReport", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("returns 'sent' when the POST responds ok:true", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response)

    const outcome = await submitErrorReport({
      url: "https://app.getticket.ai/home",
      timestamp: "2026-06-30T12:00:00.000Z",
    })
    expect(outcome).toBe("sent")
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/error-report",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("returns 'failed' when the POST responds ok:false", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "Resend not configured" }),
    } as Response)

    const outcome = await submitErrorReport({
      url: "https://app.getticket.ai/home",
      timestamp: "2026-06-30T12:00:00.000Z",
    })
    expect(outcome).toBe("failed")
  })

  it("returns 'failed' (never throws) when fetch rejects, e.g. offline", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("network down"))

    const outcome = await submitErrorReport({
      url: "https://app.getticket.ai/home",
      timestamp: "2026-06-30T12:00:00.000Z",
    })
    expect(outcome).toBe("failed")
  })

  it("returns 'failed' when the HTTP status itself is an error", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response)

    const outcome = await submitErrorReport({
      url: "https://app.getticket.ai/home",
      timestamp: "2026-06-30T12:00:00.000Z",
    })
    expect(outcome).toBe("failed")
  })
})
