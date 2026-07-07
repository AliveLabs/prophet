// Differential builds Phase 0 — the hash must be a pure function of VALUE (not key order), change
// when the slice changes, and be exposed by every producer (selectInput) so Phase 1 can reuse.

import { describe, it, expect } from "vitest"
import { stableStringify, skillInputHash } from "@/lib/skills/input-hash"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { runProducerSkill } from "@/lib/skills/run"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import type { Transport } from "@/lib/ai/provider"

describe("stableStringify", () => {
  it("is key-order independent at every depth", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe(
      stableStringify({ a: { c: [{ y: 2, z: 1 }], d: 2 }, b: 1 }),
    )
  })
  it("distinguishes different values and array order", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }))
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })
  it("drops undefined object values (matching JSON semantics)", () => {
    expect(stableStringify({ a: 1, gone: undefined })).toBe(stableStringify({ a: 1 }))
  })
})

describe("skillInputHash", () => {
  it("same slice + version → same hash; any change → different hash", () => {
    const slice = { reviews: [{ rating: 4.2 }], hours: { fri: "9-5" } }
    expect(skillInputHash("reputation", slice, "v2")).toBe(skillInputHash("reputation", { hours: { fri: "9-5" }, reviews: [{ rating: 4.2 }] }, "v2"))
    expect(skillInputHash("reputation", slice, "v2")).not.toBe(skillInputHash("reputation", slice, "v3"))
    expect(skillInputHash("reputation", slice, "v2")).not.toBe(skillInputHash("positioning", slice, "v2"))
    expect(skillInputHash("reputation", { ...slice, hours: { fri: "9-6" } }, "v2")).not.toBe(skillInputHash("reputation", slice, "v2"))
  })
})

describe("differential wiring", () => {
  it("EVERY producer exposes selectInput (a skill without it can never be reused — silent cost leak)", () => {
    for (const s of PRODUCER_SKILLS) {
      expect(s.selectInput, `${s.id} is missing selectInput`).toBeTypeOf("function")
    }
  })
  it("runProducerSkill stamps a stable inputHash on the result", async () => {
    const mock: Transport = async () => []
    const skill = PRODUCER_SKILLS.find((s) => s.id === "reputation")!
    const a = await runProducerSkill(skill, arenaWeekDossier, { transport: mock })
    const b = await runProducerSkill(skill, arenaWeekDossier, { transport: mock })
    expect(a.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(a.inputHash).toBe(b.inputHash) // same dossier → same hash (the reuse precondition)
  })
})
