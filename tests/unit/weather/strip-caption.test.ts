import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..", "..")

// ── ALT-718 / ALT-720 / ALT-721 ─────────────────────────────────────────────────────────────
// Three surfaces labelled data as something it was not. Source scans because the subjects are a
// server component, a client roster and a pipeline step, and vitest here collects only
// tests/unit/**/*.test.ts. What failed in each case was the LABEL against the data behind it.

describe("the weather strip does not call history a forecast (ALT-718)", () => {
  const src = readFileSync(join(REPO_ROOT, "app/(dashboard)/weather/page.tsx"), "utf8")

  it("the caption is derived, not a literal", () => {
    // On a fetchForecast throw, forecastDays is [] and the strip fills with the seven most recent
    // PAST days. The caption said "Next 7" regardless, so an operator planned against last week.
    expect(src).toMatch(/caption=\{stripCaption\}/)
    expect(src).not.toMatch(/caption="Next 7/)
  })

  it("counts forecast days off the isForecast flag rather than re-deriving from dates", () => {
    expect(src).toMatch(/stripDays\.filter\(\(d\) => d\.isForecast\)\.length/)
  })

  it("has a no-forecast branch that says so", () => {
    expect(src).toMatch(/forecast unavailable/i)
  })
})

describe("the competitor signal count matches its label (ALT-720)", () => {
  it("the query is windowed", () => {
    const src = readFileSync(join(REPO_ROOT, "app/(dashboard)/operator-data.ts"), "utf8")
    // Was the newest 200 competitor insights EVER, rendered as "N signals this month".
    expect(src).toMatch(/signalWindowStart/)
    expect(src).toMatch(/\.gte\("date_key", signalWindowStart\)/)
  })

  it("neither surface still says 'this month'", () => {
    for (const f of [
      "app/(dashboard)/competitors/competitor-roster.tsx",
      "app/(dashboard)/competitors/competitor-list.tsx",
    ]) {
      // Deliberately the bare phrase. My first attempt matched /signals? this month/ and a JSX
      // expression sits between "signal" and "this month", so the regex never fired and the probe
      // reported a useless guard. Neither file should mention the phrase at all now.
      expect(readFileSync(join(REPO_ROOT, f), "utf8"), f).not.toMatch(/this month/i)
    }
  })
})

describe("competitor ad creatives exclude the operator's own domain (ALT-721)", () => {
  const src = readFileSync(join(REPO_ROOT, "lib/jobs/pipelines/visibility.ts"), "utf8")

  it("filters the own domain out before the ads fetch", () => {
    // /visibility renders these as "live ad copy your rivals are running", and allDomains includes
    // the operator's own domain, so they were shown their own ads as a rival's.
    expect(src).toMatch(/const competitorDomains = c\.allDomains\.filter\(\(d\) => d !== c\.locationDomain\)/)
  })

  it("no longer iterates allDomains directly for the ads fetch", () => {
    expect(src).not.toMatch(/for \(const domain of c\.allDomains\.slice\(0, 5\)\)/)
  })
})
