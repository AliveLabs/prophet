import { describe, it, expect } from "vitest"
import { createHash } from "crypto"
import { tokensMatch } from "@/lib/billing/email-verification"

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex")

describe("tokensMatch (ALT-227 — billing email verification)", () => {
  it("matches the correct raw token against its stored hash", () => {
    const raw = "correct-token-value"
    expect(tokensMatch(hash(raw), raw)).toBe(true)
  })

  it("rejects a wrong token", () => {
    expect(tokensMatch(hash("correct-token-value"), "wrong-token-value")).toBe(false)
  })

  it("rejects a token of different length without throwing", () => {
    expect(tokensMatch(hash("correct-token-value"), "short")).toBe(false)
  })

  it("rejects an empty candidate token", () => {
    expect(tokensMatch(hash("correct-token-value"), "")).toBe(false)
  })
})
