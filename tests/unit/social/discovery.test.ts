import { describe, it, expect } from "vitest"
import { selectDiscoveryTargets } from "@/lib/social/enrich"

describe("selectDiscoveryTargets", () => {
  const entities = [
    { id: "loc", website: "https://wagyu.com" },
    { id: "comp-verified", website: "https://gyukaku.com" },
    { id: "comp-unverified", website: "https://terilli.com" },
    { id: "comp-no-site", website: null },
  ]

  it("re-discovers entities that have a website but no verified handle", () => {
    const verified = new Set(["comp-verified"])
    const targets = selectDiscoveryTargets(entities, verified).map((e) => e.id)
    expect(targets).toEqual(["loc", "comp-unverified"])
  })

  it("excludes entities with a verified handle and entities with no website", () => {
    const verified = new Set(["comp-verified"])
    const targets = selectDiscoveryTargets(entities, verified)
    expect(targets.find((e) => e.id === "comp-verified")).toBeUndefined()
    expect(targets.find((e) => e.id === "comp-no-site")).toBeUndefined()
  })

  it("targets everything with a website when nothing is verified yet (fresh onboarding)", () => {
    const targets = selectDiscoveryTargets(entities, new Set())
    expect(targets.map((e) => e.id)).toEqual(["loc", "comp-verified", "comp-unverified"])
  })
})
