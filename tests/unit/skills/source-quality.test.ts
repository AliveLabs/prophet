import { describe, test, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  sourceFamilyOf,
  resolvePlayFlag,
  insightFlag,
  aggregateBySource,
  sortFlagsNewestFirst,
  filterByReviewStatus,
  type SourceQualityFlag,
  type LooksWrongRow,
  type InaccurateInsightRow,
  type LocationInfo,
} from "@/lib/skills/source-quality"
import { playKey } from "@/lib/skills/preferences"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"

const loc: LocationInfo = { id: "loc1", name: "Joe's Diner", orgName: "Joe's Group" }

function makePlay(over: Partial<EnrichedRecommendation>): EnrichedRecommendation {
  return { skillId: "reviews-expert", title: "Fix slow Friday service", evidenceRefs: [], ...over } as unknown as EnrichedRecommendation
}
function briefWith(plays: EnrichedRecommendation[]): Brief {
  return { plays } as unknown as Brief
}

describe("sourceFamilyOf", () => {
  test("coarse family from a dotted ref", () => {
    expect(sourceFamilyOf("review.theme:slow-service")).toBe("Review")
    expect(sourceFamilyOf("event:123")).toBe("Event")
    expect(sourceFamilyOf("places.hours")).toBe("Places")
  })
  test("keeps acronyms uppercase", () => {
    expect(sourceFamilyOf("seo_competitor_growth_trend:pct")).toBe("SEO")
  })
  test("works on an insight_type", () => {
    expect(sourceFamilyOf("review_sentiment")).toBe("Review")
    expect(sourceFamilyOf("competitor_social")).toBe("Competitor")
  })
  test("empty / nullish → Unknown source", () => {
    expect(sourceFamilyOf("")).toBe("Unknown source")
    expect(sourceFamilyOf("   ")).toBe("Unknown source")
    expect(sourceFamilyOf(null)).toBe("Unknown source")
    expect(sourceFamilyOf(undefined)).toBe("Unknown source")
  })
})

describe("resolvePlayFlag", () => {
  test("resolves the play behind a play_key and de-jargons its sources", () => {
    const play = makePlay({
      title: "Fix slow Friday service",
      evidenceRefs: ["review.theme:slow-service", "review_velocity:pct"],
    })
    const row: LooksWrongRow = {
      location_id: "loc1",
      date_key: "2026-06-28",
      play_key: playKey(play),
      note: "This place closed in 2019 — bad listing.",
      updated_at: "2026-06-28T12:00:00Z",
    }
    const flag = resolvePlayFlag(row, briefWith([play]), loc)
    expect(flag.id).toBe(`brief:loc1:2026-06-28:${playKey(play)}`)
    expect(flag.kind).toBe("brief_play")
    expect(flag.title).toBe("Fix slow Friday service")
    expect(flag.sourceFamily).toBe("Review")
    expect(flag.sources).toEqual(["Review · theme", "Review activity"])
    expect(flag.note).toBe("This place closed in 2019 — bad listing.")
    expect(flag.locationName).toBe("Joe's Diner")
    expect(flag.orgName).toBe("Joe's Group")
    expect(flag.flaggedAt).toBe("2026-06-28T12:00:00Z")
  })

  test("a play no longer in the brief still surfaces (note + location), with no sources", () => {
    const row: LooksWrongRow = {
      location_id: "loc1",
      date_key: "2026-06-28",
      play_key: "gone:not-here",
      note: "Wrong hours",
      updated_at: "2026-06-28T12:00:00Z",
    }
    const flag = resolvePlayFlag(row, briefWith([makePlay({ title: "Other play", skillId: "x" })]), loc)
    expect(flag.title).toBe("Play no longer in this brief")
    expect(flag.sources).toEqual([])
    expect(flag.sourceFamily).toBe("Unknown source")
    expect(flag.note).toBe("Wrong hours")
  })

  test("null brief → unresolved but non-crashing", () => {
    const row: LooksWrongRow = {
      location_id: "loc1",
      date_key: "2026-06-28",
      play_key: "any:key",
      note: null,
      updated_at: "2026-06-28T12:00:00Z",
    }
    const flag = resolvePlayFlag(row, null, loc)
    expect(flag.title).toBe("Play no longer in this brief")
    expect(flag.note).toBeUndefined()
  })

  test("blank note is dropped", () => {
    const play = makePlay({ evidenceRefs: ["event:1"] })
    const row: LooksWrongRow = {
      location_id: "loc1",
      date_key: "2026-06-28",
      play_key: playKey(play),
      note: "   ",
      updated_at: "2026-06-28T12:00:00Z",
    }
    expect(resolvePlayFlag(row, briefWith([play]), loc).note).toBeUndefined()
  })

  test("reviewed_status defaults to open, and passes through when resolved (ALT-246)", () => {
    const play = makePlay({ evidenceRefs: ["event:1"] })
    const baseRow: LooksWrongRow = {
      location_id: "loc1",
      date_key: "2026-06-28",
      play_key: playKey(play),
      note: null,
      updated_at: "2026-06-28T12:00:00Z",
    }
    expect(resolvePlayFlag(baseRow, briefWith([play]), loc).reviewedStatus).toBe("open")
    expect(
      resolvePlayFlag({ ...baseRow, reviewed_status: "resolved" }, briefWith([play]), loc).reviewedStatus,
    ).toBe("resolved")
  })
})

describe("insightFlag", () => {
  const base: InaccurateInsightRow = {
    id: "i1",
    location_id: "loc1",
    insight_type: "competitor_social",
    title: "Rival posting 5x/week",
    summary: "Their cadence jumped recently.",
    created_at: "2026-06-20T00:00:00Z",
    feedback_at: "2026-06-28T00:00:00Z",
  }
  test("normalizes an inaccurate insight, keyed on insight_type", () => {
    const flag = insightFlag(base, loc)
    expect(flag.id).toBe("insight:i1")
    expect(flag.kind).toBe("insight")
    expect(flag.title).toBe("Rival posting 5x/week")
    expect(flag.summary).toBe("Their cadence jumped recently.")
    expect(flag.sourceFamily).toBe("Competitor")
    expect(flag.sources).toEqual(["Competitor · social"])
    expect(flag.note).toBeUndefined()
    expect(flag.flaggedAt).toBe("2026-06-28T00:00:00Z")
  })
  test("falls back to created_at when feedback_at is null", () => {
    expect(insightFlag({ ...base, feedback_at: null }, loc).flaggedAt).toBe("2026-06-20T00:00:00Z")
  })

  test("reviewed_status defaults to open, and passes through when resolved (ALT-246)", () => {
    expect(insightFlag(base, loc).reviewedStatus).toBe("open")
    expect(insightFlag({ ...base, reviewed_status: "resolved" }, loc).reviewedStatus).toBe("resolved")
  })
})

describe("filterByReviewStatus", () => {
  const flagged = (id: string, reviewedStatus: "open" | "resolved"): SourceQualityFlag => ({
    id,
    kind: "insight",
    flaggedAt: "2026-06-28T00:00:00Z",
    locationId: "l",
    locationName: "L",
    title: "t",
    sources: [],
    sourceFamily: "X",
    reviewedStatus,
  })

  test("'open' keeps only open flags (the default view)", () => {
    const flags = [flagged("a", "open"), flagged("b", "resolved")]
    expect(filterByReviewStatus(flags, "open").map((f) => f.id)).toEqual(["a"])
  })
  test("'resolved' keeps only resolved flags", () => {
    const flags = [flagged("a", "open"), flagged("b", "resolved")]
    expect(filterByReviewStatus(flags, "resolved").map((f) => f.id)).toEqual(["b"])
  })
  test("'all' keeps everything, unfiltered", () => {
    const flags = [flagged("a", "open"), flagged("b", "resolved")]
    expect(filterByReviewStatus(flags, "all").map((f) => f.id)).toEqual(["a", "b"])
  })
})

describe("aggregateBySource", () => {
  const mk = (
    family: string,
    kind: SourceQualityFlag["kind"],
    flaggedAt: string,
    note?: string,
  ): SourceQualityFlag => ({
    id: `${kind}:${family}:${flaggedAt}`,
    kind,
    flaggedAt,
    locationId: "l",
    locationName: "L",
    title: "t",
    note,
    sources: [],
    sourceFamily: family,
    reviewedStatus: "open",
  })

  test("groups by family, sorts by count desc then family asc, splits kinds", () => {
    const flags = [
      mk("Review", "brief_play", "2026-06-28T00:00:00Z", "note A"),
      mk("Review", "brief_play", "2026-06-27T00:00:00Z", "note B"),
      mk("Review", "insight", "2026-06-26T00:00:00Z"),
      mk("Social", "brief_play", "2026-06-25T00:00:00Z", "s1"),
      mk("Event", "brief_play", "2026-06-24T00:00:00Z", "e1"),
    ]
    const agg = aggregateBySource(flags)
    expect(agg.map((a) => a.family)).toEqual(["Review", "Event", "Social"]) // 3, then 1/1 tie → asc
    expect(agg[0]).toMatchObject({ family: "Review", count: 3, briefCount: 2, insightCount: 1 })
    expect(agg[0].recentNotes).toEqual(["note A", "note B"]) // newest first, notes only
  })

  test("caps recent notes at 3", () => {
    const flags = Array.from({ length: 5 }, (_, i) =>
      mk("Places", "brief_play", `2026-06-${20 + i}T00:00:00Z`, `n${i}`),
    )
    expect(aggregateBySource(flags)[0].recentNotes).toHaveLength(3)
  })
})

describe("sortFlagsNewestFirst", () => {
  test("returns a new array sorted newest-first without mutating input", () => {
    const input: SourceQualityFlag[] = [
      { id: "a", kind: "insight", flaggedAt: "2026-06-20T00:00:00Z", locationId: "l", locationName: "L", title: "old", sources: [], sourceFamily: "X", reviewedStatus: "open" },
      { id: "b", kind: "brief_play", flaggedAt: "2026-06-28T00:00:00Z", locationId: "l", locationName: "L", title: "new", sources: [], sourceFamily: "X", reviewedStatus: "open" },
    ]
    const out = sortFlagsNewestFirst(input)
    expect(out.map((f) => f.title)).toEqual(["new", "old"])
    expect(input.map((f) => f.title)).toEqual(["old", "new"]) // input untouched
  })
})

// ── HARD CONSTRAINT (ALT-172): this is a DATA-QUALITY loop ONLY. ────────────────────────────
// The consumer must never wire "looks_wrong" / "inaccurate" back into the recommendation model.
// These guards fail the build if a future edit imports the model-feedback modules into the queue,
// or makes the read-only page write. (Import-scoped + write-call-scoped so merely *mentioning*
// the constraint in a comment doesn't trip them.)
describe("data-quality isolation guard", () => {
  function importedModules(rel: string): string[] {
    const src = readFileSync(path.join(process.cwd(), rel), "utf8")
    return [...src.matchAll(/import[\s\S]*?from\s*["']([^"']+)["']/g)].map((m) => m[1])
  }
  const FORBIDDEN = ["feedback-rollup", "feedback-signals"]
  const hasWrite = (src: string) => /\.(insert|update|upsert|delete)\s*\(/.test(src)

  test("the core module imports neither the rollup nor the band", () => {
    const mods = importedModules("lib/skills/source-quality.ts")
    for (const f of FORBIDDEN) expect(mods.some((mod) => mod.includes(f))).toBe(false)
  })

  test("the page imports neither, and performs no writes", () => {
    const rel = "app/admin/source-quality/page.tsx"
    const mods = importedModules(rel)
    for (const f of FORBIDDEN) expect(mods.some((mod) => mod.includes(f))).toBe(false)
    expect(hasWrite(readFileSync(path.join(process.cwd(), rel), "utf8"))).toBe(false)
  })

  test("the presentation component imports neither, and performs no writes", () => {
    const rel = "app/admin/source-quality/components/source-quality-queue.tsx"
    const mods = importedModules(rel)
    for (const f of FORBIDDEN) expect(mods.some((mod) => mod.includes(f))).toBe(false)
    expect(hasWrite(readFileSync(path.join(process.cwd(), rel), "utf8"))).toBe(false)
  })
})
