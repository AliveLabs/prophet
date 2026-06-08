import { describe, it, expect } from "vitest"
import { humanizeRef, humanizeLabel, domainLabel, distinctDomains, dedupeRefs } from "@/lib/skills/evidence-format"

describe("evidence-format — de-jargon evidence refs", () => {
  it("humanizes dotted refs into 'Domain · detail'", () => {
    expect(humanizeRef("events.new_high_signal_event:event")).toBe("Events · new high signal event")
    expect(humanizeRef("reviews.sentiment_shift")).toBe("Reviews · sentiment shift")
  })

  it("humanizes screaming-snake refs and drops the trailing field", () => {
    expect(humanizeRef("SEO_COMPETITOR_GROWTH_TREND:PCT_CHANGE")).toBe("SEO · competitor growth trend")
    expect(humanizeRef("SEO_COMPETITOR_KEYWORD_PORTFOLIO:TOP_GAPS")).toBe("SEO · competitor keyword portfolio")
  })

  it("preserves known acronyms instead of title-casing them", () => {
    expect(domainLabel("SEO_COMPETITOR_GROWTH_TREND:PCT_CHANGE")).toBe("SEO")
    expect(domainLabel("events.new_high_signal_event")).toBe("Events")
  })

  it("collapses a mixed ref set to distinct human categories (no internal keys leak)", () => {
    const refs = [
      "SEO_COMPETITOR_GROWTH_TREND:PCT_CHANGE",
      "SEO_COMPETITOR_KEYWORD_PORTFOLIO:TOTAL_VOLUME",
      "events.new_high_signal_event:event",
    ]
    expect(distinctDomains(refs)).toEqual(["SEO", "Events"])
    // nothing screaming-snake survives to the UI
    expect(distinctDomains(refs).join(" ")).not.toMatch(/_|:/)
  })

  it("dedupes refs by base, dropping the field suffix", () => {
    expect(dedupeRefs(["A_B:X", "A_B:Y", "c.d"])).toEqual(["A_B", "c.d"])
  })

  it("humanizes snake/UPPER channel labels but leaves human strings alone", () => {
    expect(humanizeLabel("GOOGLE_BUSINESS_PROFILE")).toBe("Google Business Profile")
    expect(humanizeLabel("WEBSITE")).toBe("Website")
    expect(humanizeLabel("Meta geo-ads")).toBe("Meta geo-ads") // already human → untouched
  })
})
