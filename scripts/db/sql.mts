// Apply a migration file or run a query against the LINKED Supabase project via the
// Management API. Auth = SUPABASE_ACCESS_TOKEN (from env or .env.local); project ref from
// supabase/.temp/linked-project.json. This is the single auditable chokepoint that lets the
// agent run + verify migrations directly instead of hand-pasting SQL into the dashboard.
//
//   npx tsx scripts/db/sql.mts --file supabase/migrations/XXXX.sql      # apply a migration
//   npx tsx scripts/db/sql.mts --query "select 1"                       # read / verify
//   npx tsx scripts/db/sql.mts --file drop.sql --allow-destructive      # opt in to DROP/TRUNCATE
//
// Catastrophic statements (DROP TABLE/SCHEMA/DATABASE, TRUNCATE) are refused unless
// --allow-destructive is passed, so an additive migration can never accidentally nuke data.

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

function fromEnvLocal(key: string): string | undefined {
  try {
    const env = readFileSync(resolve(REPO_ROOT, ".env.local"), "utf8")
    const m = env.match(new RegExp(`^${key}=(.*)$`, "m"))
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined
  } catch {
    return undefined
  }
}

function loadToken(): string {
  const token = process.env.SUPABASE_ACCESS_TOKEN || fromEnvLocal("SUPABASE_ACCESS_TOKEN")
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN not found (env or .env.local)")
  return token
}

function loadRef(): string {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF
  const linked = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "supabase/.temp/linked-project.json"), "utf8")
  )
  if (!linked.ref) throw new Error("No project ref in supabase/.temp/linked-project.json")
  return linked.ref as string
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const DESTRUCTIVE = /\b(drop\s+(table|schema|database)|truncate\b)/i

async function main() {
  const file = arg("--file")
  const query = arg("--query")
  const allowDestructive = process.argv.includes("--allow-destructive")

  const sql = file ? readFileSync(resolve(REPO_ROOT, file), "utf8") : query
  if (!sql) {
    console.error('Usage: tsx scripts/db/sql.mts --file <path.sql> | --query "<sql>"')
    process.exit(1)
  }

  if (DESTRUCTIVE.test(sql) && !allowDestructive) {
    console.error(
      "✗ Refused: SQL contains DROP TABLE/SCHEMA/DATABASE or TRUNCATE. Re-run with --allow-destructive if intended."
    )
    process.exit(1)
  }

  const ref = loadRef()
  const token = loadToken()
  console.error(`→ ${ref}${file ? ` · ${file}` : ""}`)

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  })

  const text = await res.text()
  if (!res.ok) {
    console.error(`✗ ${res.status} ${res.statusText}`)
    console.error(text)
    process.exit(1)
  }
  console.log(text)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
