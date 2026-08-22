import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..", "..")
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8")

// ── ALT-708 ─────────────────────────────────────────────────────────────────────────────────
// `seedDomain` is `locationDomain ?? compDomains[0]?.domain`, so for a location with no website of
// its own it IS the first competitor's domain. That fallback is correct for its real job, seeding
// competitor DISCOVERY with "find domains like this one".
//
// It was also used for the RANKED KEYWORDS fetch and passed downstream as `locationDomain`, so a
// website-less restaurant had a rival's search performance stored and rendered as its own, under
// "Keywords you win". Own domain or nothing: with no website there is nothing true to say about
// their search visibility, and saying nothing is the correct output.
//
// A source scan because both sites are inside a pipeline step and a server action that need a
// Supabase client and a paid vendor; the defect is a one-token fallback, visible in the source.

const SITES: Array<[string, string]> = [
  ["lib/jobs/pipelines/visibility.ts", "the nightly pipeline"],
  ["app/(dashboard)/visibility/actions.ts", "the on-demand refresh"],
]

describe("ranked keywords use the operator's OWN domain (ALT-708)", () => {
  for (const [file, what] of SITES) {
    it(`${what} does not fall back to the competitor seed for ranked keywords`, () => {
      const src = read(file)
      expect(src).not.toMatch(/rkDomain = c?\.?locationDomain \?\? c?\.?seedDomain/)
    })

    it(`${what} does not pass the competitor seed as locationDomain`, () => {
      const src = read(file)
      expect(src).not.toMatch(/locationDomain: c?\.?locationDomain \?\? c?\.?seedDomain/)
    })
  }

  it("seedDomain is still used for competitor discovery, which is its real job", () => {
    // The fix must not delete the seed: fetchCompetitorsDomain legitimately needs a domain to say
    // "find ones like this", and a competitor's domain is a fine seed for that.
    expect(read("app/(dashboard)/visibility/actions.ts")).toMatch(
      /fetchCompetitorsDomain\(\{ target: seedDomain/,
    )
  })

  it("the pipeline reports the skip rather than silently returning zero", () => {
    expect(read("lib/jobs/pipelines/visibility.ts")).toMatch(/location has no website of its own/)
  })
})
