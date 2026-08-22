import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..", "..")

// ALT-740 / ALT-363 ---────────────────────────────────────────────────────────────────────
// ALT-363 replaced "read the single latest raw menu scrape" with a UNION of the recent window,
// because on a day a scrape returned 3 items the consumer treated a 110-item menu as 3 items. That
// fix landed in the pipelines and the dossier and MISSED the /content page, which was a fifth copy
// of the same query. Same symptom, different surface, and the page and the brief could disagree
// about the same menu on the same day.
//
// The rule this pins: the raw provider/snapshot_type strings for menus belong to
// lib/content/menu-history.ts, which is the one place that unions. A new caller reaching for them
// directly is how a sixth copy appears.

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const skip = new Set(["node_modules", ".next", ".git", "worktrees", "archive"])
  const walk = (p: string) => {
    const st = statSync(p)
    if (st.isFile()) {
      if (/\.(ts|tsx)$/.test(p)) out.push(p)
      return
    }
    for (const e of readdirSync(p)) {
      if (skip.has(e)) continue
      walk(join(p, e))
    }
  }
  walk(join(REPO_ROOT, dir))
  return out
}

/** Files allowed to name the raw menu sources, each with the reason it must.
 *
 *  Adding to this list is a decision. The question to answer is "does this WRITE the source, or
 *  does it need the raw capture for a stated reason", not "does it currently fail the test". */
const ALLOWED = new Set([
  // The one place that unions. Everything else must go through it.
  "lib/content/menu-history.ts",
  // WRITERS: they have to name what they write.
  "lib/jobs/pipelines/content.ts",
  "lib/content/menu-parse.ts",
  "lib/content/menu-markdown.ts",
  "lib/content/enrich.ts",
  "app/(dashboard)/content/actions.ts",
  // A type/doc comment only, no query.
  "lib/content/types.ts",
  // A comment describing the read this ticket REPLACED, kept as the record of the old shape.
  "lib/insights/dossier/build.ts",
  // Reads the own menu raw ON PURPOSE and says why: the sustained-change detector's thin-read and
  // one-run-blip guards are meaningless against a smoothed union, so it needs the newest capture
  // plus the raw history. Its COMPETITOR read was single-latest with no such reason and now goes
  // through loadCompetitorMenu (ALT-740).
  "lib/jobs/pipelines/insights.ts",
])

describe("menu reads go through the union (ALT-740)", () => {
  it("the /content page does not read a single latest raw menu snapshot", () => {
    const src = readFileSync(join(REPO_ROOT, "lib/cache/content.ts"), "utf8")
    expect(src).toMatch(/loadLocationMenu\(/)
    expect(src).toMatch(/loadCompetitorMenu\(/)
    // The single-latest shape that shipped: filter by the menu provider then limit(1).
    expect(src).not.toMatch(/"firecrawl_menu"/)
    expect(src).not.toMatch(/"web_menu_weekly"/)
  })

  it("finds files to scan at all", () => {
    expect(sourceFiles("lib").length).toBeGreaterThan(50)
  })

  it("no NEW caller names the raw menu sources directly", () => {
    const offenders = ["lib", "app"]
      .flatMap(sourceFiles)
      .filter((f) => /"firecrawl_menu"|"web_menu_weekly"/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(REPO_ROOT.length + 1))
      .filter((rel) => !ALLOWED.has(rel))
    expect(
      offenders,
      "These name a raw menu source directly instead of going through lib/content/menu-history, " +
        "which is how ALT-363 grew a fifth copy. Use loadLocationMenu / loadCompetitorMenu, or add " +
        "the file to ALLOWED with the reason it must name the source itself.",
    ).toEqual([])
  })
})
