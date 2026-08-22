import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { EM_DASH } from "@/lib/eval/voice-rules"
import { REPO_ROOT, literalsIn, literalsUnder } from "../support/source-literals"

// ── House style: no em dash (U+2014) or en dash (U+2013) in anything a person reads ──────────
//
// Brand canon already enforced this for MODEL output: lib/eval/voice-rules.ts exports
// EM_DASH and lib/skills/voice.ts scrubs both characters out of generated copy before it
// ships. Nothing enforced it for the copy WE hardcode, so 350 dashes had accumulated across
// 114 files: marketing headlines, billing explanations, onboarding, error toasts, aria-labels.
//
// This guard closes that gap. It reads the TypeScript AST and looks only INSIDE string and
// JSX-text literals, which matters for two reasons:
//
//   1. Comments are not output. This repo comments heavily in prose and those comments use
//      dashes freely, including the ones explaining this very rule. A text-level grep would
//      flag its own explanation and force the comments to be mangled to stay green.
//   2. Regex literals are not output either, and two of them MUST keep their dashes: the
//      EM_DASH matcher in lib/eval/voice-rules.ts and the scrub in lib/skills/voice.ts. A
//      grep-based guard would demand deleting the very code that strips dashes from model
//      output. An AST walk never sees them.
//
// SCOPE is app/, components/ and lib/email/: the surfaces a person reads. Deliberately NOT
// all of lib/: lib/skills/*.ts holds PROMPT text, which is model input rather than customer
// output, and editing a prompt changes pipeline behaviour. Several of those prompts do
// currently contain an em dash while instructing the model not to use one. That is worth
// fixing on purpose, with an eval, not as a side effect of a copy sweep.

const SCOPE = ["app", "components", "lib/email"]

// The characters themselves come from EM_DASH, the engine's existing constant, so there is one
// definition of "which characters are banned" rather than two that can drift apart. The pinning
// test at the bottom is what makes that reuse safe: narrowing EM_DASH would otherwise weaken this
// scan silently.
//
// The escapes need their own pattern because EM_DASH matches characters and JSX can spell the same
// glyph as an entity. That is not hypothetical: this guard's first run found eight `&mdash;` in
// email templates and one `&ndash;` that a character-only sweep had walked straight past.
const DASH_ESCAPE = /&mdash;|&ndash;|&#8212;|&#8211;|&#x201[34];/i

function hasDash(text: string): boolean {
  return EM_DASH.test(text) || DASH_ESCAPE.test(text)
}

type Hit = { line: number; text: string }

/** Every dash that sits inside a readable literal of `src`. Comments and regex literals are not
 *  literals, so neither the comments explaining this rule nor the EM_DASH matcher can trip it. */
function dashesInLiterals(fileName: string, src: string): Hit[] {
  return literalsIn(fileName, src)
    .filter((l) => hasDash(l.text))
    .map((l) => ({ line: l.line, text: l.text.slice(0, 120) }))
}

describe("the dash detector itself", () => {
  // Without these, a detector that silently stopped working would make the real test below
  // pass on every file in the repo and report a clean sweep. That failure mode has already
  // bitten once here: a comment-stripping regex ate live code and the scan reported "no
  // offenders" for a file whose offending lines it had deleted.

  it("flags a dash in a double-quoted string", () => {
    const hits = dashesInLiterals("a.ts", 'const s = "Past due — update payment"\n')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.text).toContain("Past due")
  })

  it("flags a dash in a template literal and in JSX text", () => {
    expect(dashesInLiterals("a.ts", "const s = `${n} left — renew now`\n")).toHaveLength(1)
    expect(dashesInLiterals("a.tsx", "const el = <p>Saved — all done</p>\n")).toHaveLength(1)
  })

  it("flags an en dash and an &mdash; escape", () => {
    expect(dashesInLiterals("a.ts", 'const s = "9 – 11 AM"\n')).toHaveLength(1)
    expect(dashesInLiterals("a.tsx", "const el = <p>a &mdash; b</p>\n")).toHaveLength(1)
  })

  it("does NOT flag a line comment, a block comment, or a JSX comment", () => {
    expect(dashesInLiterals("a.ts", "// a comment — with a dash\nconst n = 1\n")).toEqual([])
    expect(dashesInLiterals("a.ts", "/* block — dash */\nconst n = 1\n")).toEqual([])
    expect(dashesInLiterals("a.tsx", "const el = <p>{/* note — dash */}ok</p>\n")).toEqual([])
  })

  it("does NOT flag a regex literal, so the model-output scrub stays legal", () => {
    const src = 'const s = "x".replace(/[—–]/g, ", ")\n'
    expect(dashesInLiterals("a.ts", src)).toEqual([])
  })
})

describe("no dashes in customer-facing copy", () => {
  it("every string and JSX text in app/, components/ and lib/email/ is dash-free", () => {
    const offenders = literalsUnder(SCOPE)
      .filter((l) => hasDash(l.text))
      .map((l) => `${l.file}:${l.line}  ${l.text.slice(0, 120)}`)
    expect(
      offenders,
      `Use a colon, paired commas, parentheses, or a new sentence instead of a dash:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})

describe("the model-output dash scrub is still in place", () => {
  // The sweep above removed dashes from copy we wrote. Generated copy is a separate problem
  // solved separately, and these two files are the solution. Pin them so a future dash
  // cleanup cannot "tidy" away the code whose whole job is to hold the same line.

  it("lib/eval/voice-rules.ts still matches both dash characters", () => {
    const src = readFileSync(join(REPO_ROOT, "lib/eval/voice-rules.ts"), "utf8")
    const m = src.match(/export const EM_DASH = \/\[(.+?)\]\//)
    expect(m, "EM_DASH must still be exported as a character-class regex").toBeTruthy()
    expect(m![1]).toContain("—")
    expect(m![1]).toContain("–")
  })

  it("lib/skills/voice.ts still strips dashes from generated text", () => {
    const src = readFileSync(join(REPO_ROOT, "lib/skills/voice.ts"), "utf8")
    expect(src).toMatch(/replace\(\/\[—–\]\/g/)
  })
})
