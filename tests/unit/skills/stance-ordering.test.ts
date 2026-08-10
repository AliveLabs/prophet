// STANCE ORDERING (Bryan 2026-08-10): an OPTIMIZATION play must never outrank an INCREMENTAL one.
//
// The problem: ranking compared plays across channels with numbers never calibrated against each
// other (`impact` is a producer-declared label, `severity` is a per-author label, category priors
// are near-flat by design). The only thing separating "80,000 people arrive Saturday" from "push
// lemonade, it's 102 degrees" was a sentence in the selector prompt naming preferred categories.
//
// Those are not the same quantity at different sizes. One optimizes demand you already have; the
// other is demand that otherwise does not exist. So order the KINDS and compare magnitude only
// within a kind, where the units are commensurable.

import { describe, it, expect } from "vitest"
import { applyStanceOrdering } from "@/lib/skills/synthesis"
import type { EnrichedRecommendation } from "@/lib/skills/types"

const play = (title: string, stance?: string): EnrichedRecommendation =>
  ({ title, stance }) as unknown as EnrichedRecommendation

const titles = (ps: EnrichedRecommendation[]) => ps.map((p) => p.title)

describe("applyStanceOrdering", () => {
  it("THE CASE: a lemonade push never outranks an arriving stadium crowd", () => {
    const out = applyStanceOrdering([
      play("Push lemonade, it's 102 degrees", "maintain"),
      play("80,000 people arrive Saturday 0.6mi away", "capture"),
    ])
    expect(titles(out)).toEqual([
      "80,000 people arrive Saturday 0.6mi away",
      "Push lemonade, it's 102 degrees",
    ])
  })

  it("preserves the selector's order WITHIN a band (stable)", () => {
    const out = applyStanceOrdering([
      play("capture A", "capture"),
      play("capture B", "capture"),
      play("fix C", "fix"),
    ])
    expect(titles(out)).toEqual(["capture A", "capture B", "fix C"])
  })

  it("lets fix and capture compete on merit — no policy baked in", () => {
    // Whether a repair should outrank an opportunity is an open product question.
    const a = applyStanceOrdering([play("fix first", "fix"), play("capture second", "capture")])
    expect(titles(a)).toEqual(["fix first", "capture second"])
    const b = applyStanceOrdering([play("capture first", "capture"), play("fix second", "fix")])
    expect(titles(b)).toEqual(["capture first", "fix second"])
  })

  it("never demotes a play for missing stance metadata", () => {
    const out = applyStanceOrdering([play("unknown", undefined), play("maintain", "maintain")])
    expect(titles(out)).toEqual(["unknown", "maintain"])
  })

  it("moves every maintain below every act play, keeping both groups' order", () => {
    const out = applyStanceOrdering([
      play("m1", "maintain"),
      play("c1", "capture"),
      play("m2", "maintain"),
      play("f1", "fix"),
    ])
    expect(titles(out)).toEqual(["c1", "f1", "m1", "m2"])
  })

  it("is a no-op when everything shares a band", () => {
    const ps = [play("a", "maintain"), play("b", "maintain")]
    expect(titles(applyStanceOrdering(ps))).toEqual(["a", "b"])
  })
})
