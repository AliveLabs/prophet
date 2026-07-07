// Differential builds Phase 1 — reuse rules. The dangerous failure modes: reusing a FALLBACK (locks a
// customer onto the floor), reusing STALE output, or reusing when the input actually changed.

import { describe, it, expect } from "vitest"
import { extractPreviousBuild, MAX_REUSE_AGE_DAYS } from "@/lib/skills/differential"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { runProducerSkill } from "@/lib/skills/run"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"
import type { Transport } from "@/lib/ai/provider"

const play = { title: "carried play" } as unknown as EnrichedRecommendation
const baseBrief = (over: Partial<Brief> = {}): Brief =>
  ({
    locationId: "l",
    dateKey: "2026-07-06",
    headline: "h",
    deck: "d",
    plays: [],
    asOf: "x",
    skillHealth: [
      { skillId: "reputation", status: "ok", usedFallback: false, inputHash: "abc" },
      { skillId: "marketing", status: "ok", usedFallback: true, reason: "timeout", inputHash: "def" },
      { skillId: "operations", status: "ok", usedFallback: false }, // no hash (pre-Phase-0 row)
    ],
    skillOutputs: { reputation: [play], marketing: [play], operations: [play] },
    ...over,
  }) as Brief

describe("extractPreviousBuild", () => {
  it("keeps only REAL runs that have a hash + outputs (fallbacks and hashless rows excluded)", () => {
    const prev = extractPreviousBuild(baseBrief(), "2026-07-07")
    expect(prev?.hashes).toEqual({ reputation: "abc" }) // marketing = fallback, operations = no hash
    expect(prev?.outputs.reputation).toEqual([play])
  })
  it("rejects a too-old brief (past the reuse age bound)", () => {
    expect(extractPreviousBuild(baseBrief({ dateKey: "2026-06-29" }), "2026-07-07")).toBeUndefined() // 8d > bound
    expect(MAX_REUSE_AGE_DAYS).toBe(6)
  })
  it("returns undefined for missing/legacy briefs (no skillHealth or skillOutputs)", () => {
    expect(extractPreviousBuild(null, "2026-07-07")).toBeUndefined()
    expect(extractPreviousBuild(baseBrief({ skillOutputs: undefined }), "2026-07-07")).toBeUndefined()
  })
})

describe("runProducerSkill reuse path", () => {
  const skill = PRODUCER_SKILLS.find((s) => s.id === "reputation")!

  it("skips the model call entirely when the fresh hash matches the previous one", async () => {
    // First run captures the real hash for this dossier.
    const first = await runProducerSkill(skill, arenaWeekDossier, { transport: async () => [] })
    const explode: Transport = async () => {
      throw new Error("model was called — reuse failed")
    }
    const r = await runProducerSkill(skill, arenaWeekDossier, {
      transport: explode,
      previous: { hashes: { reputation: first.inputHash! }, outputs: { reputation: [play] } },
    })
    expect(r.reused).toBe(true)
    expect(r.plays).toEqual([play])
    expect(r.usedFallback).toBeUndefined() // reuse is NOT a fallback (health signals unaffected)
    expect(r.elapsedMs).toBeUndefined() // no phantom 0ms diluting the p95 signal
  })

  it("runs the model when the previous hash differs (input changed)", async () => {
    let called = 0
    const counting: Transport = async () => {
      called++
      return []
    }
    await runProducerSkill(skill, arenaWeekDossier, {
      transport: counting,
      previous: { hashes: { reputation: "stale-different-hash" }, outputs: { reputation: [play] } },
    })
    expect(called).toBe(1)
  })
})
