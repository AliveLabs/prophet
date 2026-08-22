import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..", "..")
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8")

/** Strip comment-only lines. The fixes document the removed claims by name, so a raw scan would
 *  flag its own explanation. Line-based: a multiline block regex can swallow live code. */
function code(file: string): string {
  const out: string[] = []
  let inBlock = false
  for (const line of read(file).split("\n")) {
    const t = line.trim()
    if (inBlock) {
      if (t.includes("*/") || t.includes("*/}")) inBlock = false
      continue
    }
    if (t.startsWith("//") || t.startsWith("*")) continue
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!(t.includes("*/") || t.includes("*/}"))) inBlock = true
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

// ── ALT-730 / ALT-711 / ALT-712 ─────────────────────────────────────────────────────────────
// Four claims in the emails and the support form that the product does not deliver. These are
// source scans because the subjects are React email templates and a .tsx form, and vitest here
// collects only tests/unit/**/*.test.ts. What failed was WORDING, which is visible in the source.

describe("the welcome email promises only what happens (ALT-730, ALT-729)", () => {
  const src = () => code("lib/email/templates/welcome.tsx")

  it("does not promise a weekly intelligence briefing", () => {
    // WEEKLY_DIGEST_EMAILS_ENABLED is not set in production, so no digest has ever been sent.
    // This was the FIRST email a customer received.
    expect(src()).not.toMatch(/weekly intelligence briefing/i)
  })

  it("does not promise a specific 5-item shape nothing produces", () => {
    expect(src()).not.toMatch(/5 most important|five most important/i)
  })

  it("reports the ACTIVATED competitor count, not the submitted one", () => {
    const onboarding = code("app/onboarding/actions.ts")
    expect(onboarding).toMatch(/competitorCount: activatedCompetitorCount/)
    // The submitted list shrinks at the tier cap, and the code already logs that mismatch.
    expect(onboarding).not.toMatch(/competitorCount: input\.competitorIds\.length/)
  })
})

describe("the first-brief email does not overstate the pass (ALT-711)", () => {
  const src = () => code("lib/email/templates/first-brief-ready.tsx")

  it("does not tell every recipient their brief is daily", () => {
    // runCadence is "weekly" on Starter, so "daily" and "each morning" were false for those orgs.
    expect(src()).not.toMatch(/refreshes your signals daily/i)
    expect(src()).not.toMatch(/waiting each morning/i)
  })

  it("describes what we looked at rather than asserting six families landed", () => {
    expect(src()).toMatch(/We looked\s*\n?\s*across competitors/i)
  })
})

describe("the support form does not claim an email it never sends (ALT-712)", () => {
  it("does not tell the submitter we emailed them a copy", () => {
    const src = code("app/support/support-form.tsx")
    expect(src).not.toMatch(/emailed a/i)
    expect(src).not.toMatch(/we have emailed/i)
  })

  it("still gives them the reference to follow up with", () => {
    expect(code("app/support/support-form.tsx")).toMatch(/\{reference\}/)
  })
})
