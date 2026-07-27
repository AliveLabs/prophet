// Data providers must NEVER appear on a customer surface. Naming them hands competitors
// our supply chain, and raw vendor errors leak worse things: the live "How we read this"
// panel was rendering `Fetching local events from DataForSEO: DataForSEO error: 402 {json}`
// and `saveBrief failed: Empty or invalid json` straight out of pipeline_runs.reason.
// A 402 in particular tells a customer our vendor bill is unpaid.
//
// Two layers are tested here:
//   1. operatorSafeReason / safePipelineLabel — the runtime, fail-closed sanitizers.
//   2. A static scan of customer-facing source files, so a new hardcoded vendor name
//      fails CI instead of shipping.

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  operatorSafeReason,
  safePipelineLabel,
  namesProvider,
  FORBIDDEN_PROVIDER_TERMS,
} from "@/lib/ops/provenance-copy"
import { weatherIconKind } from "@/lib/weather/icon-kind"

describe("namesProvider", () => {
  it("catches every provider spelling we've seen in live data", () => {
    for (const s of [
      "DataForSEO error: 402",
      "data for seo timeout",
      "[dataforseo] request timed out after 60000ms",
      "using Firecrawl data only",
      "OpenWeatherMap",
      "Open Weather Map",
      "Outscraper hours fallback",
      "Gemini call failed",
    ]) {
      expect(namesProvider(s), s).toBe(true)
    }
  })

  it("does NOT ban Google — an operator's own Business Profile must stay nameable", () => {
    expect(namesProvider("Update your Google Business Profile")).toBe(false)
    expect(namesProvider("your Google listing photos")).toBe(false)
  })

  it("leaves ordinary operator copy alone", () => {
    expect(namesProvider("4 active accounts")).toBe(false)
    expect(namesProvider("Traffic data was fresh this morning")).toBe(false)
  })
})

describe("operatorSafeReason — fail closed", () => {
  it("strips the exact vendor strings found in production", () => {
    const live = [
      'Fetching local events from DataForSEO: DataForSEO error: 402 {\n "version": "0.1.2"',
      "Fetching domain rank overview: DataForSEO error: 402 {json}",
      "Fetching local events from DataForSEO: DataForSEO events error: 40102 No Search Results.",
      "Fetching local events from DataForSEO: DataForSEO events error: 40501 Invalid Field: 'location_name'",
      "Analyzing ranked keywords: [dataforseo] request timed out after 60000ms",
      "Synthesizing the brief: saveBrief failed: Empty or invalid json",
    ]
    for (const raw of live) {
      const out = operatorSafeReason("partial", raw)
      expect(out, raw).not.toBeNull()
      expect(namesProvider(out!), `leaked provider: ${out}`).toBe(false)
      // No status codes, JSON, or internal function names either.
      expect(out).not.toMatch(/\b\d{3,5}\b/)
      expect(out).not.toMatch(/[{}]|saveBrief/)
    }
  })

  it("never reveals that a failure was a billing problem", () => {
    const out = operatorSafeReason("partial", "DataForSEO error: 402 payment required")
    expect(out).toBe("the data was temporarily unavailable")
    expect(out).not.toMatch(/payment|402|unauthor/i)
  })

  it("keeps vetted, useful reasons verbatim", () => {
    expect(operatorSafeReason("fresh", "4 active accounts")).toBe("4 active accounts")
    expect(operatorSafeReason("fresh", "1 active account")).toBe("1 active account")
  })

  it("classifies recognizable failures in plain language", () => {
    expect(operatorSafeReason("partial", "request timed out after 60000ms")).toBe(
      "the request timed out"
    )
    expect(operatorSafeReason("partial", "429 rate limit exceeded")).toBe(
      "we hit a temporary limit"
    )
    expect(operatorSafeReason("partial", "no search results")).toBe(
      "there was nothing new to read"
    )
  })

  it("returns null for unrecognized text on a SUCCESSFUL run (default deny)", () => {
    // The fail-closed property: novel upstream text must not ride along just because
    // the run succeeded.
    expect(operatorSafeReason("fresh", "some brand new upstream message v9")).toBeNull()
  })

  it("gives a generic line for unrecognized text on a FAILED run", () => {
    expect(operatorSafeReason("failed", "totally novel explosion")).toBe(
      "we couldn't read it this time"
    )
  })

  it("handles empty input", () => {
    expect(operatorSafeReason("fresh", null)).toBeNull()
    expect(operatorSafeReason("fresh", "   ")).toBeNull()
  })
})

describe("safePipelineLabel", () => {
  const curated = { content: "Menus & websites", weather: "Weather" }

  it("prefers the curated label", () => {
    expect(safePipelineLabel("content", curated)).toBe("Menus & websites")
  })

  it("humanizes an unknown but safe key", () => {
    expect(safePipelineLabel("busy_times", curated)).toBe("busy times")
  })

  it("refuses to humanize a provider-named pipeline key", () => {
    expect(safePipelineLabel("dataforseo_events", curated)).toBe("Additional checks")
    expect(safePipelineLabel("firecrawl_menu", curated)).toBe("Additional checks")
  })
})

describe("weatherIconKind — local glyphs instead of the provider's icon CDN", () => {
  it("maps the stored code families to our four glyphs", () => {
    expect(weatherIconKind("01d")).toBe("sun")
    expect(weatherIconKind("01n")).toBe("sun")
    for (const c of ["02d", "03n", "04d"]) expect(weatherIconKind(c)).toBe("cloud")
    for (const c of ["09d", "10n"]) expect(weatherIconKind(c)).toBe("rain")
    expect(weatherIconKind("11d")).toBe("storm")
  })

  it("uses the neutral glyph for snow/mist rather than implying clear skies", () => {
    expect(weatherIconKind("13d")).toBe("cloud")
    expect(weatherIconKind("50n")).toBe("cloud")
  })

  it("never throws on missing or junk codes", () => {
    expect(weatherIconKind(null)).toBe("cloud")
    expect(weatherIconKind(undefined)).toBe("cloud")
    expect(weatherIconKind("")).toBe("cloud")
    expect(weatherIconKind("zz")).toBe("cloud")
  })
})

// ---------------------------------------------------------------------------
// Static scan: no hardcoded vendor names in customer-facing source.
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "../../..")

// Customer-facing only. /admin is internal tooling where naming a vendor is CORRECT
// (the health page must say which vendor is down), and lib/providers/* is the
// integration layer itself.
const SCAN_DIRS = ["app/(dashboard)", "components"]

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** Strip comments and import lines: a vendor name in a code comment isn't user-visible. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l) && !/^\s*import\b/.test(l))
    .join("\n")
}

/**
 * DB provider enum values are legitimate: `provider: "firecrawl_menu"` is a stored key we
 * query on, not display copy. Allow those exact shapes and nothing looser.
 */
const ALLOWED_CODE_PATTERNS: readonly RegExp[] = [
  /provider:\s*"(?:firecrawl|gemini)[a-z_]*"/g,
  /\.eq\("provider",\s*"[a-z_]+"\)/g,
  /sources\.push\("(?:firecrawl|gemini)[a-z_]*"\)/g,
  /"(?:firecrawl|gemini_google_search)[a-z_]*"\s*(?:,|\)|\])/g,
  // Stored-enum values in TYPE unions and equality checks are logic, not copy. e.g.
  // `type MenuSource = "firecrawl" | "gemini_google_search"` and `source === "firecrawl"`
  // in menu-viewer, which renders the label "Website" — the enum never reaches the screen.
  /type\s+\w+\s*=\s*(?:"[a-z_]+"\s*\|?\s*)+/g,
  /[=!]==\s*"[a-z_]+"/g,
  // Server logs aren't a customer surface.
  /console\.(?:warn|error|log)\([^)]*\)/g,
]

describe("no data-provider names in customer-facing source", () => {
  it("scans the dashboard and shared components", () => {
    const offenders: string[] = []

    for (const rel of SCAN_DIRS) {
      for (const file of walk(join(ROOT, rel))) {
        let code = codeOnly(readFileSync(file, "utf8"))
        for (const allowed of ALLOWED_CODE_PATTERNS) code = code.replace(allowed, "")
        for (const re of FORBIDDEN_PROVIDER_TERMS) {
          const m = code.match(new RegExp(re.source, "gi"))
          if (m) offenders.push(`${file.replace(ROOT + "/", "")}: ${[...new Set(m)].join(", ")}`)
        }
      }
    }

    expect(
      offenders,
      `Data provider names must not appear in customer-facing code. Describe the DATA ` +
        `("weather data", "traffic data"), never the vendor. See lib/ops/provenance-copy.ts.\n` +
        offenders.join("\n")
    ).toEqual([])
  })
})
