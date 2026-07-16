// Differential builds option (b) (2026-07-16) — the stable/volatile hash split. The dangerous
// failure modes this guards: (1) a volatile-context change silently forcing a rebuild anyway
// (the 4.6%-reuse bug this ships to fix), (2) a REAL data change NOT forcing a rebuild (stale
// plays), (3) a stable slice that invents data selectInput never gave the prompt.
//
// The shared dossier fixtures deliberately carry no reviews/social/listing data, so this file
// injects its own (that data IS the churn under test), then simulates the daily churn that
// killed reuse: the sentiment LLM re-wording themes over IDENTICAL reviews, and engagement
// counts ticking up on OLD posts.

import { describe, it, expect } from "vitest"
import { skillInputHash } from "@/lib/skills/input-hash"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { runProducerSkill } from "@/lib/skills/run"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { SocialSnapshotData } from "@/lib/social/types"
import type { Transport } from "@/lib/ai/provider"
import type { EnrichedRecommendation } from "@/lib/skills/types"

const SPLIT_SKILLS = ["positioning", "marketing", "social-counter", "reputation"] as const
const FULL_HASH_SKILLS = ["local-demand", "food-pairing", "convergence"] as const

const skillById = (id: string) => PRODUCER_SKILLS.find((s) => s.id === id)!
const clone = (d: Dossier): Dossier => structuredClone(d)

function makeSocial(handle: string): SocialSnapshotData {
  return {
    version: "1.0",
    timestamp: "2026-07-15T00:00:00Z",
    profile: { platform: "instagram", username: handle, followerCount: 1200 },
    recentPosts: [
      {
        platformPostId: `${handle}-p1`,
        platform: "instagram",
        text: "weekend special",
        mediaUrl: null,
        mediaType: "image",
        likesCount: 40,
        commentsCount: 3,
        sharesCount: 1,
        viewsCount: null,
        hashtags: [],
        createdTime: "2026-07-10T00:00:00Z",
      },
    ],
    aggregateMetrics: {
      engagementRate: 3.4,
      postingFrequencyPerWeek: 2,
      postingWindowDays: 30,
      lastPostAt: "2026-07-10T00:00:00Z",
      topHashtags: ["#weekend"],
    },
  } as unknown as SocialSnapshotData
}

const themeFixture = () => [
  { theme: "great patio", sentiment: "positive" as const, mentions: 12, examples: ["loved the patio", "patio again"] },
  { theme: "slow service", sentiment: "negative" as const, mentions: 5, examples: ["waited 30 min"] },
]

/** The shared fixtures carry no reviews/social/listing — inject deterministic versions so the
 *  churn below has real material to mutate on every skill under test. */
function enrichedDossier(): Dossier {
  const d = clone(arenaWeekDossier)
  d.location.reviews = { themes: themeFixture(), source: "google_places", windowDays: 90 }
  d.location.social = makeSocial("own")
  const rival = d.competitors[0]
  expect(rival, "arena-week fixture must have at least one competitor").toBeTruthy()
  rival.reviews = { themes: themeFixture(), source: "google_places", windowDays: 90 }
  rival.social = makeSocial("rival")
  rival.listing = {
    version: "1.0",
    timestamp: "2026-07-15T00:00:00Z",
    profile: { title: rival.name, rating: 4.4, reviewCount: 210 },
  } as NonNullable<Dossier["competitors"][number]["listing"]>
  return d
}

/** Simulate the daily churn that killed reuse — NO new information, different bytes. */
function applyDailyChurn(d: Dossier): void {
  for (const t of d.location.reviews?.themes ?? []) {
    t.theme = `${t.theme} (reworded by today's sentiment run)`
    t.examples = t.examples.map((e) => `${e} — re-extracted`)
  }
  for (const p of d.location.social?.recentPosts ?? []) p.likesCount += 17
  for (const c of d.competitors) {
    for (const t of c.reviews?.themes ?? []) t.theme = `${t.theme} (reworded)`
    for (const p of c.social?.recentPosts ?? []) p.likesCount += 17
  }
}

describe("selectStableInput wiring", () => {
  it("exactly the four churn-affected skills declare selectStableInput; daily-substance skills must NOT", () => {
    for (const id of SPLIT_SKILLS) {
      expect(skillById(id).selectStableInput, `${id} should declare selectStableInput`).toBeTypeOf("function")
    }
    for (const id of FULL_HASH_SKILLS) {
      // weather/events ARE these skills' substance — a full-slice hash (daily rebuild) is correct.
      expect(skillById(id).selectStableInput, `${id} must hash its FULL slice`).toBeUndefined()
    }
  })

  it("the stable slice never invents keys selectInput doesn't give the prompt", () => {
    const d = enrichedDossier()
    for (const id of SPLIT_SKILLS) {
      const skill = skillById(id)
      const fullKeys = new Set(Object.keys(skill.selectInput!(d) as Record<string, unknown>))
      const stableKeys = Object.keys(skill.selectStableInput!(d) as Record<string, unknown>)
      for (const k of stableKeys) {
        expect(fullKeys.has(k), `${id} stable key "${k}" is not part of selectInput`).toBe(true)
      }
      // reputation rewrites competitorField in place (same key, stripped prose), so key COUNTS can
      // match there; every other split skill must drop at least one key outright.
      if (id !== "reputation") expect(stableKeys.length).toBeLessThan(fullKeys.size)
    }
  })
})

describe("stable hash vs daily churn", () => {
  it("daily churn (theme re-wording + engagement tick-ups) does NOT move the stable hash", () => {
    const base = enrichedDossier()
    const churned = enrichedDossier()
    applyDailyChurn(churned)
    for (const id of SPLIT_SKILLS) {
      const skill = skillById(id)
      const before = skillInputHash(skill.id, skill.selectStableInput!(base), "v")
      const after = skillInputHash(skill.id, skill.selectStableInput!(churned), "v")
      expect(after, `${id} stable hash moved on pure churn — reuse would never fire`).toBe(before)
    }
  })

  it("the OLD full-slice hash DOES move on the same churn (documents the bug being fixed)", () => {
    // Also guards the churn fixture itself: if applyDailyChurn ever stops exercising these
    // slices, the stable-hash assertions above would pass vacuously.
    const base = enrichedDossier()
    const churned = enrichedDossier()
    applyDailyChurn(churned)
    for (const id of SPLIT_SKILLS) {
      const skill = skillById(id)
      const before = skillInputHash(skill.id, skill.selectInput!(base), "v")
      const after = skillInputHash(skill.id, skill.selectInput!(churned), "v")
      expect(after, `${id} full hash did not move — churn fixture no longer exercises its slice`).not.toBe(before)
    }
  })

  it("a REAL data change still moves the stable hash (stale-play guard)", () => {
    const base = enrichedDossier()
    for (const id of SPLIT_SKILLS) {
      const skill = skillById(id)
      const changed = enrichedDossier()
      // Segment/tier rides in every split skill's stable core; a tier change must re-run.
      changed.tier.tier = changed.tier.tier === 2 ? 3 : 2
      const before = skillInputHash(skill.id, skill.selectStableInput!(base), "v")
      const after = skillInputHash(skill.id, skill.selectStableInput!(changed), "v")
      expect(after, `${id} stable hash ignored a real segment change`).not.toBe(before)
    }
  })

  it("reputation keeps competitor rating/reviewCount in the hash (drops only theme prose)", () => {
    const skill = skillById("reputation")
    const base = enrichedDossier()
    const changed = enrichedDossier()
    changed.competitors[0].listing!.profile!.rating = 2.1
    const before = skillInputHash(skill.id, skill.selectStableInput!(base), "v")
    const after = skillInputHash(skill.id, skill.selectStableInput!(changed), "v")
    expect(after).not.toBe(before)
  })
})

describe("end-to-end reuse through runProducerSkill", () => {
  it("churn-only day: the skill REUSES yesterday's plays instead of calling the model", async () => {
    const skill = skillById("marketing")
    let calls = 0
    const countingTransport: Transport = async () => {
      calls++
      return []
    }
    const carried = [{ title: "yesterday's play" }] as unknown as EnrichedRecommendation[]
    // Yesterday's hash — computed over the STABLE slice, as run.ts now records it.
    const yesterdayHash = skillInputHash(skill.id, skill.selectStableInput!(enrichedDossier()), skill.knowledgeVersion)
    const churned = enrichedDossier()
    applyDailyChurn(churned)
    const result = await runProducerSkill(skill, churned, {
      transport: countingTransport,
      knowledge: { global: [], scoped: [], globalVersion: "" },
      previous: { hashes: { [skill.id]: yesterdayHash }, outputs: { [skill.id]: carried } },
    })
    expect(result.reused).toBe(true)
    expect(result.plays).toEqual(carried)
    expect(calls).toBe(0) // the whole point: no model call, no spend
  })
})
