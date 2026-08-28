import { describe, it, expect } from "vitest"
import {
  normalizeEmailCode,
  EMAIL_CODE_MIN_LENGTH,
  EMAIL_CODE_MAX_LENGTH,
} from "@/lib/auth/email-code"

// The length RANGE is the point of these tests: Supabase owns the code length
// (this project issues 8 digits today, the GoTrue default is 6, and it is a
// dashboard setting). A validator pinned to one exact length rejected every
// real code when first verified live, so any change here must keep both
// common lengths passing.

describe("normalizeEmailCode", () => {
  it("accepts the code length this project actually issues (8 digits)", () => {
    expect(normalizeEmailCode("12345678")).toBe("12345678")
  })

  it("accepts the GoTrue default length (6 digits)", () => {
    expect(normalizeEmailCode("123456")).toBe("123456")
  })

  it("tolerates the ways people transcribe codes", () => {
    expect(normalizeEmailCode(" 12345678 ")).toBe("12345678")
    expect(normalizeEmailCode("1234 5678")).toBe("12345678")
    expect(normalizeEmailCode("1234-5678")).toBe("12345678")
  })

  it("keeps leading zeros (codes are strings, not numbers)", () => {
    expect(normalizeEmailCode("01234567")).toBe("01234567")
  })

  it("rejects implausible lengths, letters, and empty input", () => {
    expect(normalizeEmailCode("12345")).toBeNull()
    expect(normalizeEmailCode("12345678901")).toBeNull()
    expect(normalizeEmailCode("1234567a")).toBeNull()
    expect(normalizeEmailCode("")).toBeNull()
  })

  it("the exported bounds match what the validator enforces", () => {
    expect(normalizeEmailCode("9".repeat(EMAIL_CODE_MIN_LENGTH))).not.toBeNull()
    expect(normalizeEmailCode("9".repeat(EMAIL_CODE_MAX_LENGTH))).not.toBeNull()
    expect(normalizeEmailCode("9".repeat(EMAIL_CODE_MIN_LENGTH - 1))).toBeNull()
    expect(normalizeEmailCode("9".repeat(EMAIL_CODE_MAX_LENGTH + 1))).toBeNull()
  })
})
