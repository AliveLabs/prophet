// T6 BACKSTOP — voice-rules catches the internal-taxonomy leaks the 2026-07-03 voice audit found, in
// case a future prompt edit ever slips one past the AUDIENCE_FRAME. This is the safety net, NOT the
// fix (the fix is audience-aware writing at the source — see prompt-kit AUDIENCE_FRAME +
// guerrilla describePartnerForPrompt). Mirrors the existing lintVoice test in checks.test.ts.

import { describe, it, expect } from "vitest"
import { lintVoice } from "@/lib/eval/voice-rules"
import { scrubTicket } from "@/lib/skills/voice"

describe("voice-rules T6 backstop — internal-taxonomy leaks", () => {
  it("flags the exact ALC Dance Studios leak phrasing", () => {
    const bad =
      "ALC Dance Studios is 0.2 miles away, carries a medium enrollment band (40 to 60 families), and is typed as a school/PTA anchor, so the spirit night vocabulary and mechanics apply directly."
    const hits = lintVoice(bad)
    const details = hits.map((h) => h.detail).join(" | ")
    expect(hits.some((h) => h.kind === "chef_lingo")).toBe(true)
    expect(details).toMatch(/enrollment band/)
    expect(details).toMatch(/typed as/)
  })

  it("flags each size-band leak individually", () => {
    expect(lintVoice("a medium enrollment band").some((h) => h.kind === "chef_lingo")).toBe(true)
    expect(lintVoice("a large membership band").some((h) => h.kind === "chef_lingo")).toBe(true)
    expect(lintVoice("a mid-size congregation band").some((h) => h.kind === "chef_lingo")).toBe(true)
    expect(lintVoice("its size band is medium").some((h) => h.kind === "chef_lingo")).toBe(true)
  })

  it("does NOT flag a literal musical band (the band rule)", () => {
    expect(lintVoice("the high school band will march at the festival")).toEqual([])
    expect(lintVoice("book a local band for the patio on Friday")).toEqual([])
  })

  it("leaves clean owner copy untouched", () => {
    expect(lintVoice("ALC Dance Studios is a five-minute drive away and has roughly 40-60 dance families.")).toEqual([])
  })

  it("the deterministic voice-pass scrub rewrites the leaks into plain language (safety net)", () => {
    // The shipping voice-pass scrub (scrubTicket) applies the CHEF_LINGO regexes with a global flag,
    // so a slipped-through phrase can never reach the customer verbatim.
    const out = scrubTicket("carries a medium enrollment band and is typed as a school/PTA anchor")
    expect(out).not.toMatch(/enrollment band/)
    expect(out).not.toMatch(/typed as .* anchor/)
  })
})
