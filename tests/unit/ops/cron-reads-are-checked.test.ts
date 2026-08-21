import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

// ── ALT-743 / ALT-714 / ALT-746 ─────────────────────────────────────────────────────────────
//
// Every cron in this app resolved its ENTITLEMENT ALLOWLIST with `const { data: orgs } = await
// ...` and never looked at `error`. On a failed read `orgs` is null, the allowlist comes out
// EMPTY, every location fails the membership test, and the route answers `ok: true` with zero
// work done. One transient failure on one read took the whole fleet dark and reported success,
// in build-brief, daily AND weekly-digest.
//
// The same shape, one loop deeper, silently dropped RECIPIENTS: weekly-digest's member lookup and
// trial-reminders' owner lookup. The trial-reminders one is the worst of the set, because the
// ledger row is written BEFORE it, so a failed read recorded the reminder as sent and no later
// run would ever retry it.
//
// WHY A SOURCE SCAN. These are route handlers: they need a Request, env, and a Supabase client,
// and vitest here only collects tests/unit/**/*.test.ts. Extracting each one to a pure function
// would be a bigger change than the fix. What actually failed was a HABIT, and the habit is
// visible in the source, so that is what this pins.
//
// The exception list is deliberately explicit. A blanket rule would be wrong: enriching a Notion
// sync with display names genuinely can fail soft, because a missing name is a cosmetic loss, not
// a silent product outage. Every allowed exception is named with its reason, so a NEW unchecked
// read fails this test and has to argue for itself, and nothing gets quietly grandfathered in.

const REPO_ROOT = resolve(__dirname, "..", "..", "..")
const CRON_DIR = join(REPO_ROOT, "app", "api", "cron")

/**
 * Unchecked reads that are genuinely safe to fail soft, each with the reason it is safe.
 * Keyed `<route>:<what it reads>`. Adding to this list is a decision, not a formality:
 * the question to answer is "if this read fails, can the route still report the truth?"
 */
const ALLOWED_UNCHECKED: Record<string, string> = {
  "access-requests/route.ts:orgRows":
    "display enrichment for the admin list; a failure loses org names, not a decision",
  "feedback-notion-sync/route.ts:data":
    "profile/org names used to label a Notion row; a missing name degrades the label only",
  "trial-reminders/route.ts:profile":
    "per-owner email lookup inside the send loop; a failure skips ONE recipient and the " +
    "surrounding loop still reports, rather than silently zeroing the whole run",
  "weekly-digest/route.ts:profiles":
    "guarded by userIds.length and only reached after the member read is checked, so a " +
    "failure here cannot be confused with an empty recipient set",
}

function routeFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    const st = statSync(p)
    if (st.isFile()) {
      if (p.endsWith("route.ts")) out.push(p)
      return
    }
    for (const e of readdirSync(p)) walk(join(p, e))
  }
  walk(dir)
  return out
}

/** Every `const { data... }` destructure that does NOT also take `error`, with its variable name. */
function uncheckedReads(src: string): string[] {
  const found: string[] = []
  for (const m of src.matchAll(/const\s*\{\s*data(?::\s*([A-Za-z0-9_]+))?\s*([^}]*)\}\s*=/g)) {
    const rest = m[2] ?? ""
    if (/\berror\b/.test(rest)) continue
    found.push(m[1] ?? "data")
  }
  return found
}

describe("cron routes check their reads (ALT-743, ALT-714, ALT-746)", () => {
  const files = routeFiles(CRON_DIR)

  it("finds the cron routes at all", () => {
    // Cheap guard against the scan silently covering nothing, which is how the June 2026 audit
    // "passed" with seven empty evidence files.
    expect(files.length).toBeGreaterThan(5)
  })

  it("no cron route reads a Supabase result without checking error, unless it is a named exception", () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.slice(CRON_DIR.length + 1)
      for (const name of uncheckedReads(readFileSync(file, "utf8"))) {
        const key = `${rel}:${name}`
        if (key in ALLOWED_UNCHECKED) continue
        offenders.push(key)
      }
    }
    expect(
      offenders,
      "An unchecked read in a cron route means a failed query is indistinguishable from an empty " +
        "result, which is how the fleet went dark while reporting ok:true. Either check `error`, " +
        "or add the read to ALLOWED_UNCHECKED with the reason it can safely fail soft.",
    ).toEqual([])
  })

  it("the three entitlement-allowlist reads all check their error and bail", () => {
    for (const route of ["build-brief", "daily", "weekly-digest"]) {
      const src = readFileSync(join(CRON_DIR, route, "route.ts"), "utf8")
      expect(src, `${route} must read organizations with an error binding`).toMatch(
        /const \{ data: orgs, error: orgErr \} = await/,
      )
      expect(src, `${route} must refuse to proceed on an allowlist read failure`).toMatch(
        /if \(orgErr \|\| !orgs\)/,
      )
    }
  })

  it("no exception in the allow-list is stale", () => {
    // A rule that outlives its subject rots into permission for something else.
    for (const key of Object.keys(ALLOWED_UNCHECKED)) {
      const [rel, name] = key.split(":")
      const src = readFileSync(join(CRON_DIR, rel), "utf8")
      expect(uncheckedReads(src), `${key} is allow-listed but no longer present`).toContain(name)
    }
  })

  it("every allow-listed exception states a reason", () => {
    for (const [key, why] of Object.entries(ALLOWED_UNCHECKED)) {
      expect(why.trim().length, `${key} needs a reason, not an empty string`).toBeGreaterThan(20)
    }
  })
})
