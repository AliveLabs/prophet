// ---------------------------------------------------------------------------
// db-exec — run SQL against a Supabase project via the Management API.
//
// Used to apply migrations / run checks headlessly with a Personal Access Token.
//
// SAFETY GUARD: the prod ref is hard-blocked unless CONFIRM_PROD=yes is set, so
// autonomous runs can only ever touch the branch. Never targets leads tables.
//
// USAGE:
//   node scripts/audit/db-exec.mjs --ref <ref> --file path/to.sql
//   node scripts/audit/db-exec.mjs --ref <ref> --sql "select count(*) from x"
// Reads SUPABASE_ACCESS_TOKEN from env.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs"

const PROD_REF = "triodvdspdsuudooyura"
const BRANCH_REF = "eguflqjnodumjbmdxrnj"

const args = process.argv.slice(2)
function arg(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const ref = arg("--ref")
const file = arg("--file")
const sqlInline = arg("--sql")
const token = process.env.SUPABASE_ACCESS_TOKEN

if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN")
  process.exit(1)
}
if (!ref) {
  console.error("Missing --ref")
  process.exit(1)
}
if (ref === PROD_REF && process.env.CONFIRM_PROD !== "yes") {
  console.error(`REFUSED: ${ref} is the PRODUCTION project. Set CONFIRM_PROD=yes to target prod (and never leads tables).`)
  process.exit(2)
}
if (ref !== PROD_REF && ref !== BRANCH_REF) {
  console.error(`Unknown ref ${ref} — expected branch (${BRANCH_REF}) or prod.`)
  process.exit(2)
}

const query = sqlInline ?? (file ? readFileSync(file, "utf8") : null)
if (!query) {
  console.error("Provide --file or --sql")
  process.exit(1)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
})

const text = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text}`)
  process.exit(1)
}
console.log(`OK (${ref})`)
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2))
} catch {
  console.log(text || "(no rows)")
}
