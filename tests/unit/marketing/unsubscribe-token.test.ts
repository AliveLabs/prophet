// D7 unsubscribe: pins the HMAC contract that Chris's n8n templates sign
// against (docs/UNSUBSCRIBE-CONTRACT.md). If a test here changes, the
// contract doc and his templates have to change with it -- a silent tweak to
// the message construction invalidates every link already sitting in an
// inbox.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createHmac } from "node:crypto"
import {
  buildUnsubscribeParams,
  normalizeUnsubscribeEmail,
  signUnsubscribeEmail,
  verifyUnsubscribeParams,
} from "@/lib/marketing/unsubscribe-token"

const SECRET = "test-unsub-secret-value"
const OTHER_SECRET = "a-different-secret"

let originalSecret: string | undefined

beforeEach(() => {
  originalSecret = process.env.UNSUB_SECRET
  process.env.UNSUB_SECRET = SECRET
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.UNSUB_SECRET
  else process.env.UNSUB_SECRET = originalSecret
})

describe("unsubscribe token construction", () => {
  it("signs base64url(HMAC-SHA256(secret, 'unsub.v1.' + normalized email))", () => {
    // Independently recomputed so the wire format is pinned, not just
    // round-tripped through our own signer.
    const expected = createHmac("sha256", SECRET)
      .update("unsub.v1.owner@example.com", "utf8")
      .digest("base64url")
    expect(signUnsubscribeEmail("owner@example.com")).toBe(expected)
  })

  it("normalizes case and surrounding whitespace before signing", () => {
    expect(normalizeUnsubscribeEmail("  Owner@Example.COM ")).toBe(
      "owner@example.com"
    )
    expect(signUnsubscribeEmail("  Owner@Example.COM ")).toBe(
      signUnsubscribeEmail("owner@example.com")
    )
  })

  it("encodes the email param as base64url and verifies its own output", () => {
    const { e, s } = buildUnsubscribeParams("Owner@Example.com")
    expect(Buffer.from(e, "base64url").toString("utf8")).toBe(
      "owner@example.com"
    )
    expect(verifyUnsubscribeParams(e, s)).toBe("owner@example.com")
  })

  it("accepts a link whose email param is not normalized but whose signature is", () => {
    const s = signUnsubscribeEmail("owner@example.com")
    const e = Buffer.from("Owner@Example.COM", "utf8").toString("base64url")
    expect(verifyUnsubscribeParams(e, s)).toBe("owner@example.com")
  })

  it("produces different signatures for different addresses", () => {
    expect(signUnsubscribeEmail("a@example.com")).not.toBe(
      signUnsubscribeEmail("b@example.com")
    )
  })
})

describe("unsubscribe token verification", () => {
  it("rejects a signature minted for a different address", () => {
    const { e } = buildUnsubscribeParams("owner@example.com")
    const s = signUnsubscribeEmail("someone-else@example.com")
    expect(verifyUnsubscribeParams(e, s)).toBeNull()
  })

  it("rejects a signature minted with a different secret", () => {
    const e = Buffer.from("owner@example.com", "utf8").toString("base64url")
    const forged = createHmac("sha256", OTHER_SECRET)
      .update("unsub.v1.owner@example.com", "utf8")
      .digest("base64url")
    expect(verifyUnsubscribeParams(e, forged)).toBeNull()
  })

  it("rejects a tampered email param that keeps the original signature", () => {
    const { s } = buildUnsubscribeParams("owner@example.com")
    const swapped = Buffer.from("victim@example.com", "utf8").toString(
      "base64url"
    )
    expect(verifyUnsubscribeParams(swapped, s)).toBeNull()
  })

  it("rejects missing, empty, truncated, and oversized params", () => {
    const { e, s } = buildUnsubscribeParams("owner@example.com")
    expect(verifyUnsubscribeParams(null, s)).toBeNull()
    expect(verifyUnsubscribeParams(e, null)).toBeNull()
    expect(verifyUnsubscribeParams(undefined, undefined)).toBeNull()
    expect(verifyUnsubscribeParams("", "")).toBeNull()
    expect(verifyUnsubscribeParams(e, s.slice(0, -2))).toBeNull()
    expect(verifyUnsubscribeParams("x".repeat(600), s)).toBeNull()
    expect(verifyUnsubscribeParams(e, "x".repeat(600))).toBeNull()
  })

  it("rejects a decoded value that is not an email", () => {
    const e = Buffer.from("not-an-email", "utf8").toString("base64url")
    const s = createHmac("sha256", SECRET)
      .update("unsub.v1.not-an-email", "utf8")
      .digest("base64url")
    expect(verifyUnsubscribeParams(e, s)).toBeNull()
  })

  it("fails CLOSED when UNSUB_SECRET is unset: nothing verifies, signing throws", () => {
    const { e, s } = buildUnsubscribeParams("owner@example.com")
    delete process.env.UNSUB_SECRET
    expect(verifyUnsubscribeParams(e, s)).toBeNull()
    expect(() => signUnsubscribeEmail("owner@example.com")).toThrow()
  })
})
