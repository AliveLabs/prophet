import { describe, it, expect } from "vitest"
import { normalizeEmailCode, EMAIL_CODE_LENGTH } from "@/lib/auth/email-code"

describe("normalizeEmailCode", () => {
  it("accepts a clean 6-digit code", () => {
    expect(normalizeEmailCode("123456")).toBe("123456")
  })

  it("tolerates the ways people transcribe codes", () => {
    expect(normalizeEmailCode(" 123456 ")).toBe("123456")
    expect(normalizeEmailCode("123 456")).toBe("123456")
    expect(normalizeEmailCode("123-456")).toBe("123456")
  })

  it("keeps leading zeros (codes are strings, not numbers)", () => {
    expect(normalizeEmailCode("012345")).toBe("012345")
  })

  it("rejects wrong lengths, letters, and empty input", () => {
    expect(normalizeEmailCode("12345")).toBeNull()
    expect(normalizeEmailCode("1234567")).toBeNull()
    expect(normalizeEmailCode("12345a")).toBeNull()
    expect(normalizeEmailCode("")).toBeNull()
  })

  it("EMAIL_CODE_LENGTH matches what the validator enforces", () => {
    expect(normalizeEmailCode("9".repeat(EMAIL_CODE_LENGTH))).not.toBeNull()
    expect(normalizeEmailCode("9".repeat(EMAIL_CODE_LENGTH + 1))).toBeNull()
  })
})
