// Trigger (and read the result of) a PROD cron endpoint with auth handled INTERNALLY. The twin of
// scripts/db/sql.mts: a single auditable chokepoint so the agent can run + verify crons without
// hand-handling the secret on the command line (which trips secret-exploration guards) and without
// fighting Deployment Protection on the *.vercel.app aliases.
//
//   npx tsx scripts/db/cron.mts ingest-knowledge-feeds --dry-run     # observe, no writes
//   npx tsx scripts/db/cron.mts ingest-knowledge-feeds               # real run
//   npx tsx scripts/db/cron.mts rollup-feedback --param mode=weekly  # extra query params
//   npx tsx scripts/db/cron.mts ask-mining --base https://app.getticket.ai
//
// Auth: Bearer CRON_SECRET, read from .env.ops.local (preferred) | .env.local | process.env. Optional
// VERCEL_PROTECTION_BYPASS (same files) is sent as x-vercel-protection-bypass if the target ever sits
// behind Deployment Protection. Hits the PUBLIC prod domain (app.getticket.ai) by default — NOT a
// prophet-*.vercel.app alias (those redirect to an auth wall). See [[ticket-prod-domain]].

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DEFAULT_BASE = "https://app.getticket.ai"

function fromEnvFile(file: string, key: string): string | undefined {
  try {
    const env = readFileSync(resolve(REPO_ROOT, file), "utf8")
    const m = env.match(new RegExp(`^${key}=(.*)$`, "m"))
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined
  } catch {
    return undefined
  }
}

/** Read an ops value from process.env, then .env.ops.local, then .env.local. */
function opsValue(key: string): string | undefined {
  return process.env[key] || fromEnvFile(".env.ops.local", key) || fromEnvFile(".env.local", key)
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const name = process.argv[2]
  if (!name || name.startsWith("-")) {
    console.error("Usage: tsx scripts/db/cron.mts <cron-name> [--dry-run] [--param k=v ...] [--base URL]")
    console.error("  e.g. tsx scripts/db/cron.mts ingest-knowledge-feeds --dry-run")
    process.exit(1)
  }

  const secret = opsValue("CRON_SECRET")
  if (!secret) {
    console.error("✗ CRON_SECRET not found. Add it to GetTicket/.env.ops.local (gitignored) — see .env.ops.local.example.")
    process.exit(1)
  }
  const bypass = opsValue("VERCEL_PROTECTION_BYPASS")
  const base = arg("--base") || process.env.TICKET_PROD_BASE || DEFAULT_BASE

  // Query params: --dry-run → ?dryRun=1, plus repeatable --param k=v.
  const params = new URLSearchParams()
  if (process.argv.includes("--dry-run")) params.set("dryRun", "1")
  process.argv.forEach((a, i) => {
    if (a === "--param" && process.argv[i + 1]) {
      const [k, ...v] = process.argv[i + 1].split("=")
      if (k) params.set(k, v.join("="))
    }
  })
  const qs = params.toString()
  const url = `${base}/api/cron/${name}${qs ? `?${qs}` : ""}`

  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` }
  if (bypass) headers["x-vercel-protection-bypass"] = bypass

  console.error(`→ GET ${url}`)
  const started = Date.now()
  const res = await fetch(url, { headers, redirect: "follow" })
  const text = await res.text()
  console.error(`← ${res.status} ${res.statusText} · ${((Date.now() - started) / 1000).toFixed(1)}s`)
  // Pretty-print JSON when possible; else raw (e.g. an auth-wall HTML page → you'll see it's not JSON).
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text.slice(0, 2000))
  }
  if (!res.ok) process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
