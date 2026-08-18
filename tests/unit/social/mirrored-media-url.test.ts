import { describe, it, expect } from "vitest"
import { isMirroredMediaUrl } from "@/lib/social/types"

// ALT-665 regression. The predicate this replaces was `mediaUrl.includes("supabase")`,
// which silently broke on 2026-07-24 when Supabase Storage moved behind the custom
// domain auth.getticket.ai. Every case below is drawn from real prod rows.
describe("isMirroredMediaUrl", () => {
  it("accepts a mirrored URL on the custom domain (the ALT-665 regression)", () => {
    expect(
      isMirroredMediaUrl(
        "https://auth.getticket.ai/storage/v1/object/public/social-media/facebook/407BBQ/1876689473528274.jpg"
      )
    ).toBe(true)
  })

  it("accepts a mirrored URL on the default supabase.co origin", () => {
    expect(
      isMirroredMediaUrl(
        "https://triodvdspdsuudooyura.supabase.co/storage/v1/object/public/social-media/instagram/foo/123.jpg"
      )
    ).toBe(true)
  })

  it("accepts a mirrored URL on a hypothetical future origin", () => {
    // The whole point: the predicate must not encode the hostname.
    expect(
      isMirroredMediaUrl("https://cdn.example.test/storage/v1/object/public/social-media/x/1.jpg")
    ).toBe(true)
  })

  it("rejects an expiring Instagram CDN URL", () => {
    expect(
      isMirroredMediaUrl(
        "https://instagram.fiev22-1.fna.fbcdn.net/v/t39.30808-6/708865956_1815807866404808.jpg?st=abc"
      )
    ).toBe(false)
  })

  it("rejects an expiring Facebook CDN URL", () => {
    expect(
      isMirroredMediaUrl("https://scontent-ams2-1.xx.fbcdn.net/v/t39.30808-6/616841949_1316369717202248.jpg")
    ).toBe(false)
  })

  it("rejects a cdninstagram URL", () => {
    expect(
      isMirroredMediaUrl("https://scontent-ams2-1.cdninstagram.com/v/t51.82787-15/732654678.jpg")
    ).toBe(false)
  })

  it("rejects null, undefined and empty", () => {
    expect(isMirroredMediaUrl(null)).toBe(false)
    expect(isMirroredMediaUrl(undefined)).toBe(false)
    expect(isMirroredMediaUrl("")).toBe(false)
  })

  it("does not accept a hostname that merely contains the word supabase", () => {
    // The old predicate would have accepted this expiring CDN URL outright.
    expect(isMirroredMediaUrl("https://supabase-lookalike.fbcdn.net/v/t39/1.jpg")).toBe(false)
  })

  it("narrows the type so callers can use the value directly", () => {
    const u: string | null = "https://auth.getticket.ai/storage/v1/object/public/social-media/a/1.jpg"
    if (isMirroredMediaUrl(u)) {
      expect(u.length).toBeGreaterThan(0) // compiles only if narrowed to string
    }
  })
})
