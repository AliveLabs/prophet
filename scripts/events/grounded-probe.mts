// Grounded-events probe (Events source migration · Phase 1 shadow-compare helper).
//
// Runs the Gemini-grounded events adapter against a real location — TWICE — so you can eyeball
// the two make-or-break questions before flipping EVENTS_SOURCE anywhere:
//   1. ACCURACY: are the dates/venues right? (This migration exists because DataForSEO put
//      Fuerza Regida on the wrong day and missed the Rangers game.)
//   2. uid STABILITY: do two runs of the same event hash to the SAME uid? (Churn here would
//      defeat differential-build reuse — the top-priority reason grounded uses computeStableEventUid.)
//
// Only needs GOOGLE_AI_API_KEY (from .env.local or the environment). No DB, no writes.
//
//   npx tsx scripts/events/grounded-probe.mts "Arlington, TX" 32.7473 -97.0945
//   npx tsx scripts/events/grounded-probe.mts "Forney, TX"
//
// This is a manual Phase-1 tool — it is NOT wired into the pipeline (which stays DataForSEO-default
// until EVENTS_SOURCE is flipped). See lib/jobs/pipelines/events.ts resolveEventsSource.

import { config } from "dotenv"
config({ path: ".env.local" })

import { fetchGroundedEvents } from "../../lib/providers/gemini/google-events"
import { normalizeGroundedEvents } from "../../lib/events/normalize-grounded"

async function main() {
  const [locationName, latRaw, lngRaw] = process.argv.slice(2)
  if (!locationName) {
    console.error('Usage: npx tsx scripts/events/grounded-probe.mts "City, State" [lat] [lng]')
    process.exit(1)
  }
  const lat = latRaw ? Number(latRaw) : undefined
  const lng = lngRaw ? Number(lngRaw) : undefined

  console.log(`\n=== Grounded events probe: ${locationName} ===\n`)

  const run = async (label: string) => {
    const raw = await fetchGroundedEvents({ locationName, lat, lng, maxEvents: 25 })
    const snap = normalizeGroundedEvents(raw, { queries: [], horizon: "month" })
    const dropped = raw.length - snap.events.length
    console.log(`[${label}] adapter returned ${raw.length} events; ${snap.events.length} kept after date-normalize (${dropped} dropped for ambiguous dates)`)
    return snap.events
  }

  const run1 = await run("run 1")
  console.log("")
  for (const e of run1) {
    console.log(
      `  • ${e.startDatetime}  ${e.type?.padEnd(10) ?? "?"}  ${e.title}` +
        `\n      venue: ${e.venue?.name ?? "?"}  ticketed: ${e.ticketsAndInfo?.length ? "yes" : "no"}  uid: ${e.uid}`,
    )
  }

  console.log("\n--- uid stability (a second run of the same query) ---")
  const run2 = await run("run 2")
  const set1 = new Set(run1.map((e) => e.uid))
  const set2 = new Set(run2.map((e) => e.uid))
  const shared = [...set1].filter((u) => set2.has(u)).length
  const union = new Set([...set1, ...set2]).size
  const pct = union ? Math.round((shared / union) * 100) : 100
  console.log(`uid overlap across two runs: ${shared}/${union} (${pct}%). Higher = better reuse stability.`)
  if (pct < 80) {
    console.log("⚠ Low uid overlap — inspect title/venue/date drift before trusting differential-build reuse.")
  }
}

main().catch((err) => {
  console.error("Grounded probe failed:", err)
  process.exit(1)
})
