import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { scrubInsightRows } from "@/lib/jobs/scrub-insight-rows"

// ── ALT-765 ─────────────────────────────────────────────────────────────────────────────────
//
// The nightly insights pipelines never called the voice scrub, while the on-demand route always
// has. Same content type, same customer, two paths, one guarded. And the scrub does two things,
// so the gap was wider than punctuation: it also de-jargons, meaning the unguarded path could ship
// "covers" and "front of house" to an operator.

const ROOT = resolve(__dirname, "..", "..", "..")

describe("narrative fields are scrubbed", () => {
  it("drops dashes from title and summary", () => {
    const [row] = scrubInsightRows([
      { title: "Rating slipped — act now", summary: "Two rivals moved — you did not." },
    ])
    expect(row!.title).not.toMatch(/[—–]/)
    expect(row!.summary).not.toMatch(/[—–]/)
  })

  it("de-jargons, which is the half that is not about punctuation", () => {
    // CHEF_LINGO is the reason this matters more than dashes: roughly 80% of operators do not use
    // the lingo, and it reads as not speaking their language.
    //
    // Note the phrasing: "covers" is deliberately lookbehind-scoped to guest-count contexts
    // ("weekend covers"), so the plain verb ("your plan covers three competitors") is never
    // mangled. My first version of this test asserted the bare word and failed against the real
    // contract, which is the deny-list being careful rather than the scrub being broken.
    const [row] = scrubInsightRows([
      { title: "Weekend covers are down", summary: "Check the front of house." },
    ])
    expect(row!.title).toMatch(/guests/i)
    expect(row!.title).not.toMatch(/covers/i)
    expect(row!.summary).not.toMatch(/front of house/i)
  })

  it("leaves the plain verb 'covers' alone, which is why the lookbehind exists", () => {
    const [row] = scrubInsightRows([{ summary: "Your plan covers three competitors." }])
    expect(row!.summary).toMatch(/plan covers three/i)
  })

  it("scrubs recommendation title and rationale", () => {
    const [row] = scrubInsightRows([
      {
        title: "ok",
        recommendations: [
          {
            title: "Lift weekend covers — fast",
            rationale: "Your front of house is thin — staff up.",
          },
        ],
      },
    ])
    const rec = (row!.recommendations as Array<Record<string, string>>)[0]!
    expect(rec.title).not.toMatch(/[—–]/)
    expect(rec.title).toMatch(/guests/i)
    expect(rec.rationale).not.toMatch(/[—–]/)
    expect(rec.rationale).not.toMatch(/front of house/i)
  })
})

describe("evidence is NEVER scrubbed, and this is the exception that matters", () => {
  it("leaves verbatim review examples byte-identical", () => {
    // reviewThemes[].examples are snippets of what real customers wrote, and the brief cites them
    // as proof. Editing them is both a trust problem and an accuracy one.
    const verbatim = "The covers were slow — front of house was slammed"
    const [row] = scrubInsightRows([
      {
        title: "What reviewers say",
        evidence: { themes: [{ theme: "service", examples: [verbatim] }] },
      },
    ])
    const themes = (row!.evidence as { themes: Array<{ examples: string[] }> }).themes
    expect(themes[0]!.examples[0]).toBe(verbatim)
  })

  it("leaves raw numbers and provider fields in evidence untouched", () => {
    const evidence = { field: "snapshot", traffic_growth_pct: 42, date_key: "2026-08-22" }
    const [row] = scrubInsightRows([{ title: "t", evidence }])
    expect(row!.evidence).toEqual(evidence)
  })

  it("leaves the whole of evidence alone, including labels we wrote ourselves", () => {
    // Worth being precise about, because the two halves have different owners: the theme LABEL is
    // ours and the examples are the customer's words. The scrub reaches neither, because it only
    // touches declared narrative keys and `evidence` is not one.
    //
    // That is the deliberate trade: an unscrubbed label we wrote is a copy nit, while a wrongly
    // scrubbed example is edited customer data. If theme labels ever need cleaning, scrub them where
    // they are BUILT, not on the way past a field that also holds quotes.
    const [row] = scrubInsightRows([
      { title: "t", evidence: { themes: [{ theme: "covers — slow", examples: ["covers — slow"] }] } },
    ])
    const themes = (row!.evidence as { themes: Array<{ theme: string; examples: string[] }> }).themes
    expect(themes[0]!.examples[0]).toBe("covers — slow")
  })
})

describe("the operative guard: the scrub does not recurse", () => {
  // Found by an adversarial probe. Emptying NEVER_SCRUB and adding "evidence" to the narrative keys
  // changed NOTHING, because the scrub only touches strings and evidence is an object. So the real
  // protection for verbatim review text is the absence of recursion, and making the scrub
  // "thorough" is the single most dangerous edit available in that file. It compiles cleanly.

  it("leaves nested strings alone at every depth", () => {
    const deep = {
      title: "Rating slipped — act now",
      evidence: {
        themes: [{ theme: "service — slow", examples: ["front of house was slammed — brutal"] }],
        nested: { deeper: { quote: "weekend covers were down — badly" } },
      },
    }
    const [row] = scrubInsightRows([deep])
    // The declared narrative field IS scrubbed.
    expect(row!.title).not.toMatch(/[—–]/)
    // Everything inside evidence is byte-identical, at any depth.
    expect(row!.evidence).toEqual(deep.evidence)
  })

  it("does not reach strings inside a non-recommendation array", () => {
    const tags = ["service — slow", "weekend covers — down"]
    const [row] = scrubInsightRows([{ title: "t", tags }])
    expect(row!.tags).toEqual(tags)
  })
})

describe("it does not damage the row", () => {
  it("passes unknown keys through untouched", () => {
    const [row] = scrubInsightRows([
      { title: "t", location_id: "loc_1", competitor_id: "c_1", confidence: "medium", status: "new" },
    ])
    expect(row!.location_id).toBe("loc_1")
    expect(row!.competitor_id).toBe("c_1")
    expect(row!.confidence).toBe("medium")
    expect(row!.status).toBe("new")
  })

  it("does not mutate the input", () => {
    const input = [{ title: "Rating slipped — act now" }]
    const before = input[0]!.title
    scrubInsightRows(input)
    expect(input[0]!.title).toBe(before)
  })

  it("survives missing, null and non-string narrative fields", () => {
    expect(() => scrubInsightRows([{}])).not.toThrow()
    expect(() => scrubInsightRows([{ title: null, summary: undefined }])).not.toThrow()
    expect(() => scrubInsightRows([{ title: 42 }])).not.toThrow()
    const [row] = scrubInsightRows([{ title: 42 }])
    expect(row!.title).toBe(42)
  })

  it("survives a recommendations field that is not an array of objects", () => {
    expect(() => scrubInsightRows([{ recommendations: "nope" }])).not.toThrow()
    expect(() => scrubInsightRows([{ recommendations: [null, 7, "x"] }])).not.toThrow()
  })

  it("handles an empty batch", () => {
    expect(scrubInsightRows([])).toEqual([])
  })
})

describe("both nightly write boundaries are guarded", () => {
  // The whole point of scrubbing at the upsert rather than per producer: there are a dozen push
  // sites and the next one must be covered without anyone remembering.
  for (const file of ["lib/jobs/pipelines/insights.ts", "lib/jobs/pipelines/photos.ts"]) {
    it(`${file} scrubs before it upserts`, () => {
      const src = readFileSync(join(ROOT, file), "utf8")
      expect(src).toMatch(/upsert\(scrubInsightRows\(/)
    })
  }

  it("the on-demand route still scrubs too, so the two paths stay in step", () => {
    // This asymmetry is exactly what ALT-765 was. If the on-demand scrub is ever removed, the paths
    // diverge again in the other direction.
    const src = readFileSync(join(ROOT, "app/api/ai/insights/generate/route.ts"), "utf8")
    expect(src).toMatch(/scrubTicket\(/)
  })
})
