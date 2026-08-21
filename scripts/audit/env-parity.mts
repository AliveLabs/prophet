// Bug-class audit, class 5: CODE vs ENV PARITY.
//
//   npx tsx scripts/audit/env-parity.mts                 # compare code refs against Vercel production
//   npx tsx scripts/audit/env-parity.mts --env preview
//   npx tsx scripts/audit/env-parity.mts --offline       # code + .env.example only, no network
//
// WHY THIS EXISTS. A feature gated on an env var that was never set in an environment is silently
// OFF. Nothing throws, nothing logs, and the code reads perfectly. Real instances on this project:
//
//   · `EVENTS_SOURCE` sat unconfirmed in prod while being the switch between two events providers,
//     and the suspected reason Gemini cost $5.36 per location.
//   · 12 Stripe price-ID vars had to be hand-checked on 2026-08-20 against what `envKey()` and
//     `addOnEnvKey()` construct, because a NAME mismatch would have broken checkout silently. That
//     hand-check is exactly what this automates.
//
// NAMES ARE READABLE EVEN WHEN VALUES ARE NOT. `vercel env ls` lists names for every variable
// including ones marked Sensitive, whose VALUES are unrecoverable by anyone (`vercel env pull`
// returns them empty). So this checker deliberately compares NAMES ONLY. It can prove a variable is
// absent; it can never prove a value is correct.
//
// DYNAMICALLY BUILT NAMES ARE THE HARD PART and are reported separately rather than silently
// dropped. `lib/stripe/pricing.ts` builds names by template:
//   `STRIPE_PRICE_ID_${brand}_${tier}_${cadence}`
// A regex cannot see those, so the checker lists every `process.env[...]` computed access it finds
// and tells you to verify that family by hand. Pretending they do not exist is how the Stripe
// near-miss would have slipped through.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const TARGET_ENV = arg("--env") ?? "production"
const OFFLINE = process.argv.includes("--offline")

/** Provided by the platform or the toolchain, never something we set ourselves. */
const PLATFORM_PROVIDED = new Set([
  "NODE_ENV", "CI", "PORT", "TZ", "PATH", "HOME", "VERCEL", "npm_lifecycle_event",
])
const PLATFORM_PREFIXES = ["VERCEL_", "npm_", "AWS_", "TURBO_", "NEXT_RUNTIME", "__NEXT"]

function isPlatform(name: string): boolean {
  return PLATFORM_PROVIDED.has(name) || PLATFORM_PREFIXES.some((p) => name.startsWith(p))
}

const SCAN_DIRS = ["app", "lib", "components", "scripts", "proxy.ts", "middleware.ts"]
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "worktrees", ".claude"])

function walk(p: string, out: string[] = []): string[] {
  if (!existsSync(p)) return out
  const st = statSync(p)
  if (st.isFile()) {
    if (/\.(ts|tsx|mts|mjs|js)$/.test(p)) out.push(p)
    return out
  }
  for (const e of readdirSync(p)) {
    if (SKIP_DIRS.has(e)) continue
    walk(join(p, e), out)
  }
  return out
}

// Exclude this file. It contains `process.env[...]` patterns as its own subject matter, and
// scanning itself reports NAME / someExpression / ${expr} as if they were real config.
const SELF = join(REPO_ROOT, "scripts", "audit", "env-parity.mts")
const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d))).filter((f) => f !== SELF)

const staticRefs = new Map<string, Set<string>>() // name -> files
const computedRefs = new Map<string, Set<string>>() // expression -> files

for (const f of files) {
  const src = readFileSync(f, "utf8")
  const rel = f.slice(REPO_ROOT.length + 1)
  // process.env.NAME  and  process.env["NAME"]
  for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    if (isPlatform(m[1])) continue
    if (!staticRefs.has(m[1])) staticRefs.set(m[1], new Set())
    staticRefs.get(m[1])!.add(rel)
  }
  for (const m of src.matchAll(/process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g)) {
    if (isPlatform(m[1])) continue
    if (!staticRefs.has(m[1])) staticRefs.set(m[1], new Set())
    staticRefs.get(m[1])!.add(rel)
  }
  // process.env[someExpression] -- a computed name a regex cannot resolve
  for (const m of src.matchAll(/process\.env\[\s*(?!["'`])([^\]]{1,80})\]/g)) {
    const expr = m[1].trim()
    if (!computedRefs.has(expr)) computedRefs.set(expr, new Set())
    computedRefs.get(expr)!.add(rel)
  }
}

/** Names documented in .env.example, which is our own contract for what a deploy needs. */
function exampleNames(): Set<string> {
  const p = join(REPO_ROOT, ".env.example")
  if (!existsSync(p)) return new Set()
  return new Set(
    readFileSync(p, "utf8")
      .split("\n")
      .map((l) => l.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((n): n is string => !!n),
  )
}

/** Names present in a Vercel environment. NAMES ONLY: Sensitive values are unreadable by design. */
function vercelNames(env: string): Set<string> | null {
  try {
    const out = execFileSync("npx", ["vercel", "env", "ls", env], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 90_000,
    })
    const names = out
      .split("\n")
      .map((l) => l.trim().match(/^([A-Z][A-Z0-9_]*)\s/)?.[1])
      .filter((n): n is string => !!n)
    return names.length ? new Set(names) : null
  } catch {
    return null
  }
}

const inCode = [...staticRefs.keys()].sort()
const inExample = exampleNames()
const inVercel = OFFLINE ? null : vercelNames(TARGET_ENV)

console.log(`\n=== class 5: code vs env parity ===`)
console.log(`  ${files.length} source files scanned`)
console.log(`  ${inCode.length} distinct env names referenced statically in code`)
console.log(`  ${inExample.size} documented in .env.example`)
console.log(`  ${inVercel ? `${inVercel.size} present in Vercel ${TARGET_ENV}` : `Vercel ${TARGET_ENV}: NOT CHECKED`}\n`)

let problems = 0

if (inVercel) {
  const missing = inCode.filter((n) => !inVercel.has(n) && !n.startsWith("NEXT_PUBLIC_"))
  const missingPublic = inCode.filter((n) => !inVercel.has(n) && n.startsWith("NEXT_PUBLIC_"))
  if (missing.length) {
    console.log(`--- READ IN CODE, ABSENT FROM VERCEL ${TARGET_ENV.toUpperCase()} (feature may be silently off) ---`)
    for (const n of missing) {
      console.log(`  ${n}`)
      console.log(`      ${[...staticRefs.get(n)!].slice(0, 4).join(", ")}`)
      problems++
    }
    console.log("")
  }
  if (missingPublic.length) {
    console.log(`--- NEXT_PUBLIC_* absent from ${TARGET_ENV} (inlined at build; often set elsewhere) ---`)
    console.log(`  ${missingPublic.join(", ")}\n`)
  }
  const unused = [...inVercel].filter((n) => !staticRefs.has(n) && !isPlatform(n)).sort()
  if (unused.length) {
    console.log(`--- PRESENT IN VERCEL ${TARGET_ENV.toUpperCase()}, NOT READ STATICALLY ANYWHERE ---`)
    console.log(`  Either dead config to delete, or built dynamically (check the computed list below).`)
    console.log(`  ${unused.join(", ")}\n`)
  }
}

const undocumented = inCode.filter((n) => !inExample.has(n) && !n.startsWith("NEXT_PUBLIC_"))
if (undocumented.length) {
  console.log(`--- READ IN CODE, NOT DOCUMENTED IN .env.example ---`)
  console.log(`  A new deploy has no way to know these are needed.`)
  console.log(`  ${undocumented.join(", ")}\n`)
}

if (computedRefs.size) {
  console.log(`--- COMPUTED NAMES: verify these families BY HAND, a regex cannot resolve them ---`)
  for (const [expr, where] of [...computedRefs.entries()].sort()) {
    console.log(`  process.env[${expr}]`)
    console.log(`      ${[...where].join(", ")}`)
  }
  console.log("")
}

console.log(problems === 0 ? "No missing statically-referenced vars.\n" : `${problems} missing var(s).\n`)
