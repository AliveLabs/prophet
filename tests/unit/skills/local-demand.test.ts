import { describe, it, expect } from "vitest"
import { runProducerSkill } from "@/lib/skills/run"
import { localDemandSkill } from "@/lib/skills/local-demand/skill"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { evaluateBrief } from "@/lib/eval/checks"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import type { Transport } from "@/lib/ai/provider"

const index = buildRefIndex(arenaWeekDossier)

// A well-formed, grounded, number-free play citing a real dossier ref.
const goodPlay = {
  title: "Run a pre-show seating push",
  rationale: "A high-signal event lands Friday within your blocks; get an offer in front of ticketholders.",
  kind: "capitalize",
  ownerRole: "marketing",
  confidence: "high",
  recipe: [
    {
      channel: "Instagram + Google Business",
      platforms: ["Instagram"],
      audience: "ticketholders near the venue before the show",
      window: { note: "Friday early evening, pre-show" },
      copy: "Right by the show tonight. Come in before doors.",
      creativeDirection: "a warm shot of the dining room, no text overlay",
    },
  ],
  evidenceRefs: ["events.new_high_signal_event"],
}

describe("runProducerSkill: local-demand", () => {
  it("happy path: a grounded model play survives and passes the eval checks", async () => {
    const transport: Transport = async () => [goodPlay]
    const res = await runProducerSkill(localDemandSkill, arenaWeekDossier, { transport })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBe(1)
    expect(res.plays[0].skillId).toBe("local-demand")
    expect(res.plays[0].knowledgeVersion).toBe("local-demand@v1")
    expect(evaluateBrief({ plays: res.plays }, index).ok).toBe(true)
  })

  it("grounding enforcement: a play citing a bogus ref is dropped", async () => {
    const transport: Transport = async () => [{ ...goodPlay, evidenceRefs: ["totally.made.up.ref"] }]
    const res = await runProducerSkill(localDemandSkill, arenaWeekDossier, { transport })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBe(0) // dropped — never leaks an ungrounded play
  })

  it("fallback path: a model failure yields deterministic, grounded, eval-clean plays", async () => {
    const transport: Transport = async () => {
      throw new Error("model 500")
    }
    const res = await runProducerSkill(localDemandSkill, arenaWeekDossier, { transport })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBeGreaterThan(0)
    for (const p of res.plays) {
      expect(index.allowedRefs.has(p.evidenceRefs[0])).toBe(true)
    }
    expect(evaluateBrief({ plays: res.plays }, index).ok).toBe(true)
  })

  it("junk output (not an array) falls back rather than throwing", async () => {
    const transport: Transport = async () => ({ unexpected: "shape" })
    const res = await runProducerSkill(localDemandSkill, arenaWeekDossier, { transport })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBeGreaterThan(0)
  })
})
