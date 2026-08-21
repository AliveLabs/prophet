// Dedupe gate for the bug-class audit (ALT-702).
//
//   npm run audit:findings                    # validate the index and summarise it
//   npm run audit:findings -- --list          # fingerprints only, for pasting into an agent prompt
//   npm run audit:findings -- --check "<fp>"  # is this finding already filed?
//   npm run audit:findings -- --sql           # the Notion query that regenerates the index
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
// Run 1 of the audit produced 26 findings across 4 agents for 672k subagent tokens, and then very
// nearly threw 18 of them away, because the plan capped what we WROTE DOWN at 10 instead of capping
// what we FIXED at 10. Those are different things:
//
//   capping FIXES in flight   = sensible, stops thrash
//   capping FINDINGS recorded = discards work already paid for, AND guarantees the next sweep
//                               rediscovers the same bugs at full price with no way to notice
//
// So: never cap findings. Cap fixes. And make "have we already found this?" a mechanical check
// rather than something a session has to remember.
//
// ── THE FINGERPRINT ───────────────────────────────────────────────────────────────────────
//
//     class|repo-relative-file|slug
//
// Deliberately NO LINE NUMBERS. Line numbers drift on every edit, so including them would make the
// same defect look new on the next pass, which is exactly the failure this file prevents. The slug
// names the DEFECT, not the wording of the claim, for the same reason: copy gets reworded and the
// bug stays.
//
// ── SOURCE OF TRUTH ───────────────────────────────────────────────────────────────────────
// Notion is authoritative; every audit ticket carries `AUDIT-FP: <fingerprint> | ...` as the first
// thing in its Notes. This JSON is a cached copy, because a Notion token is not available locally
// (NOTION_API_KEY lives in Vercel prod only), so the sync is a documented manual step rather than
// an automated one. `--sql` prints the query. Run it through the Notion MCP and update the JSON.
//
// ── notFindings MATTERS AS MUCH AS findings ───────────────────────────────────────────────
// The index also records things investigated and ruled OUT, with the reason. Four class-5
// candidates and four deliberate designs are in there. Without that list every sweep re-raises the
// fleet-cap fail-open, and re-litigating settled decisions is how a finding list loses its
// credibility.

import { readFileSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const INDEX = join(REPO_ROOT, "docs", "audit", "findings-index.json")

type Finding = {
  fp: string
  ticket: string
  severity: "Critical" | "High" | "Medium" | "Low"
  confidence: "verified" | "agent"
  latent?: boolean
}
type NotFinding = { fp: string; why: string }
type Index = { generatedAt: string; findings: Finding[]; notFindings: NotFinding[] }

const idx = JSON.parse(readFileSync(INDEX, "utf8")) as Index

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const NOTION_SQL = `SELECT "Ticket ID" AS id, "Priority" AS sev, substr("Notes", 12, 78) AS fp
FROM "collection://ce2adb11-6f4d-44ff-b9c9-1b42bc765a80"
WHERE "Notes" LIKE 'AUDIT-FP:%'
ORDER BY id`

if (process.argv.includes("--sql")) {
  console.log(NOTION_SQL)
  process.exit(0)
}

// ── validate ────────────────────────────────────────────────────────────────
const problems: string[] = []
const seen = new Map<string, string>()
const FP_SHAPE = /^class[0-9]+\|[^|]+\|[a-z0-9-]+$/

for (const f of idx.findings) {
  if (!FP_SHAPE.test(f.fp)) problems.push(`malformed fingerprint: ${f.fp}`)
  if (/:\d+/.test(f.fp)) problems.push(`fingerprint contains a line number, which will drift: ${f.fp}`)
  const prior = seen.get(f.fp)
  if (prior) problems.push(`duplicate fingerprint ${f.fp} on ${prior} and ${f.ticket}`)
  seen.set(f.fp, f.ticket)
}
for (const n of idx.notFindings) {
  if (seen.has(n.fp)) problems.push(`${n.fp} is in BOTH findings and notFindings`)
  if (!n.why?.trim()) problems.push(`notFinding ${n.fp} has no reason, so it will be re-raised`)
}

if (process.argv.includes("--list")) {
  for (const f of idx.findings) console.log(f.fp)
  for (const n of idx.notFindings) console.log(`${n.fp}    [RULED OUT: ${n.why}]`)
  process.exit(problems.length ? 1 : 0)
}

const check = arg("--check")
if (check) {
  const hit = idx.findings.find((f) => f.fp === check)
  const out = idx.notFindings.find((n) => n.fp === check)
  if (hit) {
    console.log(`ALREADY FILED as ${hit.ticket} (${hit.severity}, ${hit.confidence}${hit.latent ? ", latent" : ""})`)
    console.log(`Do NOT file a duplicate. Add evidence to the existing ticket instead.`)
    process.exit(0)
  }
  if (out) {
    console.log(`RULED OUT previously: ${out.why}`)
    console.log(`Do NOT re-raise without new evidence that contradicts that reason.`)
    process.exit(0)
  }
  // Same file, different slug: likely related, worth a human look before filing.
  const file = check.split("|")[1]
  const neighbours = idx.findings.filter((f) => f.fp.split("|")[1] === file)
  console.log(`NEW: not in the index.`)
  if (neighbours.length) {
    console.log(`\nBut ${neighbours.length} existing finding(s) touch the same file:`)
    for (const n of neighbours) console.log(`  ${n.ticket}  ${n.fp}`)
    console.log(`Check whether this is genuinely distinct or the same defect reworded.`)
  }
  process.exit(0)
}

// ── default: summary ────────────────────────────────────────────────────────
const bySeverity = (s: string) => idx.findings.filter((f) => f.severity === s).length
const verified = idx.findings.filter((f) => f.confidence === "verified").length
const latent = idx.findings.filter((f) => f.latent).length

console.log(`\n=== audit findings index (generated ${idx.generatedAt}) ===`)
console.log(`  ${idx.findings.length} open findings, ${idx.notFindings.length} ruled out`)
console.log(`  Critical ${bySeverity("Critical")} · High ${bySeverity("High")} · Medium ${bySeverity("Medium")} · Low ${bySeverity("Low")}`)
console.log(`  ${verified} verified by the main loop, ${idx.findings.length - verified} agent-reported only`)
console.log(`  ${latent} latent (real code path, zero rows affected in prod at the time of checking)\n`)

const byFile = new Map<string, number>()
for (const f of idx.findings) {
  const file = f.fp.split("|")[1]
  byFile.set(file, (byFile.get(file) ?? 0) + 1)
}
const hotspots = [...byFile.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
if (hotspots.length) {
  console.log(`--- files with more than one finding (fix together) ---`)
  for (const [file, n] of hotspots) console.log(`  ${n}  ${file}`)
  console.log("")
}

if (problems.length) {
  console.error(`--- INDEX PROBLEMS ---`)
  for (const p of problems) console.error(`  ${p}`)
  console.error("")
  process.exit(1)
}
console.log(`Index is well-formed.\n`)
console.log(`Before a sweep: npm run audit:findings -- --list, and pass that into every agent prompt.\n`)
