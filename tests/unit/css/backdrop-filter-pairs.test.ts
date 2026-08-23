// ALT-600 shipped the fix. This is the guard it did not get.
//
// THE MECHANISM. Where a rule declares the redundant pair
//
//   backdrop-filter: blur(18px);
//   -webkit-backdrop-filter: blur(18px);
//
// Lightning CSS resolves it by emitting the PREFIXED form ALONE and dropping the standard
// property. Current Chromium does not accept the -webkit- alias (in the real page,
// `CSS.supports('-webkit-backdrop-filter', 'blur(10px)')` reports false), so the rule computes
// `backdrop-filter: none` and the frost silently dies. Declaring ONLY the standard property is
// correct: Lightning CSS adds the prefix itself and keeps both forms.
//
// Writing the companion is the intuitive thing to do, which is why it happened 26 times. Nothing
// caught it, because a dead blur is not a build error and not a test failure: it is a surface that
// looks slightly flatter than the designer intended. It was found by eye, months later.
//
// So this asserts the shape rather than the appearance. It is deliberately a unit test and not a
// `lint:` script, because `test:unit` already runs inside the required "typecheck + unit tests"
// check and needs no workflow change to be enforced.

import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { REPO_ROOT } from "../support/source-literals"

// The surfaces that actually ship CSS. `app/docs/` is excluded: it holds archived design
// prototypes as standalone .html, which are never served and do contain the old pair.
const SCOPE = ["app", "components"]
const EXCLUDE = [join("app", "docs")]

const STANDARD = /(?<!-)\bbackdrop-filter\s*:/
const PREFIXED = /-webkit-backdrop-filter\s*:/

function cssFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (EXCLUDE.some((e) => full.includes(e))) continue
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue
      cssFilesUnder(full, out)
    } else if (entry.endsWith(".css")) {
      out.push(full)
    }
  }
  return out
}

type Offender = { file: string; block: string; kind: "pair" | "prefixed-only" }

/** Innermost `{...}` blocks are the declaration blocks: this skips at-rule wrappers (media,
 *  supports, keyframes) without needing a real parser, because those contain nested braces. */
function declarationBlocks(src: string): string[] {
  return src.match(/\{[^{}]*\}/g) ?? []
}

function offendersIn(file: string, src: string): Offender[] {
  const out: Offender[] = []
  for (const block of declarationBlocks(src)) {
    const hasStandard = STANDARD.test(block)
    const hasPrefixed = PREFIXED.test(block)
    if (hasPrefixed && hasStandard) out.push({ file, block, kind: "pair" })
    // Prefixed-only is the same bug arrived at from the other side: the standard property that
    // Chromium needs never ships at all.
    else if (hasPrefixed) out.push({ file, block, kind: "prefixed-only" })
  }
  return out
}

describe("the detector itself", () => {
  // Without these, a detector that quietly stopped matching would report a clean sweep across
  // every file in the repo. That exact failure has already happened once in this repo's guards:
  // a comment-stripping regex ate live code and the scan reported no offenders for a file whose
  // offending lines it had deleted.

  it("flags the redundant pair", () => {
    const hits = offendersIn(
      "a.css",
      ".x { backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }",
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]!.kind).toBe("pair")
  })

  it("flags the pair in either order", () => {
    const hits = offendersIn(
      "a.css",
      ".x { -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }",
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]!.kind).toBe("pair")
  })

  it("flags a prefixed-only declaration", () => {
    const hits = offendersIn("a.css", ".x { -webkit-backdrop-filter: blur(9px); }")
    expect(hits).toHaveLength(1)
    expect(hits[0]!.kind).toBe("prefixed-only")
  })

  it("does NOT flag the correct form: the standard property alone", () => {
    expect(offendersIn("a.css", ".x { backdrop-filter: blur(18px) saturate(1.2); }")).toEqual([])
  })

  it("does not let the standard matcher match the prefixed name", () => {
    // The lookbehind is what stops `-webkit-backdrop-filter` from also counting as the standard
    // property, which would turn every prefixed-only rule into a false "pair".
    expect(STANDARD.test("-webkit-backdrop-filter: blur(1px);")).toBe(false)
    expect(STANDARD.test("backdrop-filter: blur(1px);")).toBe(true)
  })

  it("scopes to the declaration block, not the file", () => {
    // Two separate rules, one of each property, is not a pair. Nothing is broken there.
    const src = ".a { backdrop-filter: blur(2px); }\n.b { color: red; }"
    expect(offendersIn("a.css", src)).toEqual([])
  })

  it("sees inside a media query", () => {
    const src = "@media (min-width: 40em) { .x { backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); } }"
    expect(offendersIn("a.css", src)).toHaveLength(1)
  })

  it("finds real CSS files to scan", () => {
    // A path or scope change that silently found nothing would make the sweep below vacuous.
    const files = SCOPE.flatMap((s) => cssFilesUnder(join(REPO_ROOT, s)))
    expect(files.length).toBeGreaterThan(5)
  })
})

describe("no shipped CSS hand-writes a -webkit-backdrop-filter companion", () => {
  it("is clean across app/ and components/", () => {
    const offenders = SCOPE.flatMap((s) =>
      cssFilesUnder(join(REPO_ROOT, s)).flatMap((f) =>
        offendersIn(relative(REPO_ROOT, f), readFileSync(f, "utf8")),
      ),
    )

    const report = offenders
      .map((o) => `  ${o.file} [${o.kind}]\n    ${o.block.replace(/\s+/g, " ").slice(0, 140)}`)
      .join("\n")

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `Remove the hand-written -webkit-backdrop-filter and keep ONLY the standard property. ` +
            `Lightning CSS adds the prefix itself; declaring the pair makes it emit the prefixed ` +
            `form alone, which Chromium ignores, so the blur silently dies (ALT-600).\n${report}`,
    ).toEqual([])
  })

  it("still finds the surfaces that legitimately use a backdrop filter", () => {
    // Guards against the opposite regression: someone deleting the frost entirely to get green.
    const total = SCOPE.flatMap((s) => cssFilesUnder(join(REPO_ROOT, s)))
      .map((f) => readFileSync(f, "utf8"))
      .reduce((n, src) => n + (src.match(/(?<!-)\bbackdrop-filter\s*:/g) ?? []).length, 0)
    expect(total).toBeGreaterThan(20)
  })
})
