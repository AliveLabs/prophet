import { describe, it, expect } from "vitest"
import { normalizeWebsiteUrl } from "@/lib/events/geo"

describe("normalizeWebsiteUrl — never fabricate, only accept real http(s) URLs", () => {
  it("accepts an https URL", () => {
    expect(normalizeWebsiteUrl("https://attstadium.com")).toBe("https://attstadium.com")
  })

  it("accepts an http URL", () => {
    expect(normalizeWebsiteUrl("http://venue.example/events")).toBe("http://venue.example/events")
  })

  it("trims surrounding whitespace", () => {
    expect(normalizeWebsiteUrl("  https://attstadium.com  ")).toBe("https://attstadium.com")
  })

  it("rejects empty / null / undefined", () => {
    expect(normalizeWebsiteUrl("")).toBeNull()
    expect(normalizeWebsiteUrl("   ")).toBeNull()
    expect(normalizeWebsiteUrl(null)).toBeNull()
    expect(normalizeWebsiteUrl(undefined)).toBeNull()
  })

  it("rejects non-http(s) schemes", () => {
    expect(normalizeWebsiteUrl("ftp://files.example.com")).toBeNull()
    expect(normalizeWebsiteUrl("mailto:hi@example.com")).toBeNull()
    expect(normalizeWebsiteUrl("javascript:alert(1)")).toBeNull()
  })

  it("rejects a string that is not a parseable URL", () => {
    expect(normalizeWebsiteUrl("not a url")).toBeNull()
    expect(normalizeWebsiteUrl("attstadium.com")).toBeNull() // no scheme
  })
})
