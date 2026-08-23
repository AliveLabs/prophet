// ALT-691 : every field in TIER_LIMITS must have an enforcement site.
//
// The ticket asked for a comment stating the rule. A comment is what we had: `tier-cost.ts` already
// carried a hand-maintained "DEAD FIELDS" list, and the list itself went stale, because keeping it
// current depends on someone re-running the grep. This runs the grep.
//
// WHY THE RULE EXISTS. A field that DESCRIBES the system without CONTROLLING it reads as
// authoritative to anyone scanning `tiers.ts`, and it will eventually be priced or gated from. That
// is not hypothetical: the first cost-to-serve estimate put the top tier at ~28x the mid tier's
// search volume, and that number came from `seoLabsCadence: "daily"`, a field with zero readers.
// The field the pipeline actually honours says `biweekly`.
//
// WHY THE COST MODEL DOES NOT COUNT. `lib/billing/tier-cost.ts` may only read fields the pipeline
// honours, which is precisely the constraint that got violated. So a field read solely by the cost
// model is still dead, and counting it would make this guard endorse the original mistake.
//
// AST rather than grep, for the reason the other guards in this repo give: a prose comment naming a
// dead field would otherwise count as a reader, and this file and `tier-cost.ts` both name several.

import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import ts from "typescript"
import { REPO_ROOT, sourceFiles } from "../support/source-literals"

const TIERS_FILE = join("lib", "billing", "tiers.ts")
const COST_FILE = join("lib", "billing", "tier-cost.ts")

/** The field names declared on the `TierLimits` type, read off the AST rather than hardcoded, so
 *  adding a field automatically brings it under this rule. */
function tierLimitsFields(): string[] {
  const abs = join(REPO_ROOT, TIERS_FILE)
  const sf = ts.createSourceFile(
    abs,
    readFileSync(abs, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === "TierLimits" &&
      ts.isTypeLiteralNode(node.type)
    ) {
      for (const m of node.type.members) {
        if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) out.push(m.name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Property names READ off any expression in one file: `x.foo`, `TIER_LIMITS[t].foo`, `{ foo }`
 *  destructuring. Never comments, never strings. */
function propertyReadsIn(abs: string): Set<string> {
  const sf = ts.createSourceFile(
    abs,
    readFileSync(abs, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(abs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const out = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      out.add(node.name.text)
    } else if (ts.isBindingElement(node)) {
      // `{ foo }` reads `foo`; `{ foo: local }` still reads `foo`, so prefer propertyName.
      const read = node.propertyName ?? node.name
      if (ts.isIdentifier(read)) out.add(read.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe("the extractors themselves", () => {
  // A guard whose extractor silently returns nothing passes on every file in the repo.

  it("finds the TierLimits fields", () => {
    const fields = tierLimitsFields()
    expect(fields.length).toBeGreaterThan(8)
    // Spot-check a few that are definitely enforced, so a rename does not empty this silently.
    expect(fields).toContain("includedLocations")
    expect(fields).toContain("runCadence")
    expect(fields).toContain("seoTrackedKeywords")
  })

  it("reads property accesses and not comments or strings", () => {
    const dir = mkdtempSync(join(tmpdir(), "tier-guard-"))
    const f = join(dir, "sample.ts")
    writeFileSync(
      f,
      [
        "// mentionedOnlyInAComment is not a reader",
        'const s = "mentionedOnlyInAString"',
        "const a = obj.realRead",
        "const { destructuredRead } = obj",
        "const { renamed: local } = obj",
      ].join("\n"),
    )
    const reads = propertyReadsIn(f)
    expect(reads.has("realRead")).toBe(true)
    expect(reads.has("destructuredRead")).toBe(true)
    expect(reads.has("renamed")).toBe(true)
    expect(reads.has("mentionedOnlyInAComment")).toBe(false)
    expect(reads.has("mentionedOnlyInAString")).toBe(false)
  })

  it("does not count tiers.ts or tier-cost.ts as readers", () => {
    // The whole point: declaring a field and pricing off it are not enforcement.
    const files = sourceFiles(["lib", "app"]).map((f) => relative(REPO_ROOT, f))
    expect(files).toContain(TIERS_FILE)
    expect(files).toContain(COST_FILE)
  })
})

describe("no field in TIER_LIMITS is dead", () => {
  it("every field is read somewhere that is not tiers.ts or the cost model", () => {
    const fields = tierLimitsFields()

    const readers = new Map<string, string[]>()
    for (const abs of sourceFiles(["lib", "app", "components", "scripts"])) {
      const rel = relative(REPO_ROOT, abs)
      if (rel === TIERS_FILE || rel === COST_FILE) continue
      const reads = propertyReadsIn(abs)
      for (const f of fields) {
        if (reads.has(f)) {
          const list = readers.get(f) ?? []
          list.push(rel)
          readers.set(f, list)
        }
      }
    }

    const dead = fields.filter((f) => !readers.has(f))

    expect(
      dead,
      dead.length === 0
        ? ""
        : `These TIER_LIMITS fields have no enforcement site: ${dead.join(", ")}.\n` +
            `A field that describes the system without controlling it will eventually be priced ` +
            `or gated from (ALT-691: the 28x top-tier estimate came from the dead seoLabsCadence). ` +
            `Either wire the field to the behaviour it claims, or delete it. Note the cost model ` +
            `does NOT count as a reader, because it may only read fields the pipeline honours.`,
    ).toEqual([])
  })

  it("the deleted fields stay deleted", () => {
    // Named individually because each one has a specific reason not to come back, recorded in
    // tiers.ts and tier-cost.ts. A field returning "to match the pricing brief" is the failure.
    const fields = tierLimitsFields()
    for (const gone of [
      "eventsKeywordSets",
      "seoLabsCadence",
      "seoSerpCadence",
      "briefingCadence",
      "contentRefreshCadence",
      "whiteLabelReports",
      "apiAccess",
      "photoAnalysisDepth",
      "retentionDays",
      "support",
    ]) {
      expect(fields, `${gone} came back without a reader`).not.toContain(gone)
    }
  })

  it("ensureTrackedKeywordLimit stays gone until it has a call site", () => {
    // It threw at a tracked-keyword cap and had zero callers, so nothing was gated. A guard nobody
    // calls is worse than a missing one, because it reads as enforcement.
    const src = readFileSync(join(REPO_ROOT, "lib", "billing", "limits.ts"), "utf8")
    const declared = /export function ensureTrackedKeywordLimit\b/.test(src)
    if (!declared) return
    const callers = sourceFiles(["lib", "app", "components", "scripts"]).filter((abs) => {
      const rel = relative(REPO_ROOT, abs)
      if (rel === join("lib", "billing", "limits.ts")) return false
      return /\bensureTrackedKeywordLimit\s*\(/.test(readFileSync(abs, "utf8"))
    })
    expect(callers, "re-added with no call site").not.toEqual([])
  })
})
