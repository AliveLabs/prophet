import { describe, it, expect } from "vitest"
import {
  describeAuthLinkError,
  readAuthLinkErrorFromSearch,
  EXPIRED_LINK_MESSAGE,
  INVALID_LINK_MESSAGE,
} from "@/lib/auth/link-errors"

describe("describeAuthLinkError", () => {
  it("returns null when there is no error (the success path)", () => {
    expect(describeAuthLinkError({})).toBeNull()
    expect(
      describeAuthLinkError({ error: null, errorCode: null, errorDescription: null })
    ).toBeNull()
  })

  it("maps otp_expired to the expired-link copy", () => {
    // The exact shape Supabase sends for a stale or already-consumed magic link.
    expect(
      describeAuthLinkError({
        error: "access_denied",
        errorCode: "otp_expired",
        errorDescription: "Email link is invalid or has expired",
      })
    ).toBe(EXPIRED_LINK_MESSAGE)
  })

  it("falls back to the description when the code is missing", () => {
    expect(
      describeAuthLinkError({ errorDescription: "Token has expired or is invalid" })
    ).toBe(EXPIRED_LINK_MESSAGE)
  })

  it("is case-insensitive on the code", () => {
    expect(describeAuthLinkError({ errorCode: "OTP_EXPIRED" })).toBe(EXPIRED_LINK_MESSAGE)
  })

  it("gives generic copy for an unrecognised failure, never null", () => {
    // Anything the auth server rejects still has to route the operator to the fix.
    expect(describeAuthLinkError({ error: "server_error" })).toBe(INVALID_LINK_MESSAGE)
    expect(describeAuthLinkError({ errorCode: "validation_failed" })).toBe(
      INVALID_LINK_MESSAGE
    )
  })
})

describe("readAuthLinkErrorFromSearch", () => {
  it("reads the params Supabase puts on the callback URL", () => {
    const params = new URLSearchParams(
      "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
    )
    expect(readAuthLinkErrorFromSearch(params)).toBe(EXPIRED_LINK_MESSAGE)
  })

  it("returns null for a normal PKCE callback carrying a code", () => {
    expect(readAuthLinkErrorFromSearch(new URLSearchParams("code=abc123"))).toBeNull()
  })
})
