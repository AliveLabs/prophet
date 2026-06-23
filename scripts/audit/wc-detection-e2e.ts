// End-to-end verification of the NEW detection chain against live APIs:
//   L0 venue radar → L1 query plan → DataForSEO fetch → geo + catalog magnitude upgrade.
// Simulates a Raising Cane's one block from AT&T Stadium (Arlington, TX).
// Run: npx tsx scripts/audit/wc-detection-e2e.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { buildVenueCatalog, matchEventToCatalog } from "../../lib/events/venue-catalog"
import { buildEventQueryPlan } from "../../lib/events/keywords"
import { fetchGoogleEvents } from "../../lib/providers/dataforseo/google-events"
import { geocodeVenue, haversineMiles } from "../../lib/events/geo"
import { classifyEventMagnitude } from "../../lib/events/relevance"
import { isMajorCapacity } from "../../lib/events/venue-catalog"

const NEEDLE = /world cup|fifa|argentina|austria|jordan|match 78|2e vs 2i/i

// Cane's ~one block NE of AT&T Stadium (≈32.7473,-97.0945).
const CANES_LAT = 32.749
const CANES_LNG = -97.092

async function main() {
  console.log("=== L0: venue radar around the Cane's ===")
  const catalog = await buildVenueCatalog(CANES_LAT, CANES_LNG)
  console.log(`Found ${catalog.length} venues. Top by capacity:`)
  catalog
    .slice()
    .sort((a, b) => (b.capacityHigh ?? 0) - (a.capacityHigh ?? 0))
    .slice(0, 8)
    .forEach((v) =>
      console.log(
        `  - ${v.name} [${v.primaryType}] ${v.distanceMi}mi cap=${v.capacityLow}-${v.capacityHigh} (${v.capacityConfidence})${v.aliases.length ? ` aliases=${JSON.stringify(v.aliases)}` : ""}`,
      ),
    )
  const stadium = catalog.find((v) => /stadium/i.test(v.name) && isMajorCapacity(v.capacityHigh))
  console.log(stadium ? `>>> Stadium-class venue detected: ${stadium.name}` : ">>> NO stadium-class venue found ❌")

  console.log("\n=== L1: query plan (mid tier, 2 queries) ===")
  const plan = buildEventQueryPlan({ catalog, maxQueries: 2, dateKey: "2026-06-22" })
  console.log(JSON.stringify(plan))

  console.log("\n=== L1→fetch: run the plan against DataForSEO ===")
  const locationName = "Arlington,Texas,United States"
  let wcHits = 0
  for (const q of plan) {
    const res = await fetchGoogleEvents({ keyword: q.keyword, locationName, dateRange: q.dateRange, depth: 10 })
    const events = res.items.filter((i) => !i.type || i.type === "event_item")
    const hits = events.filter((e) => NEEDLE.test(e.title ?? "") || NEEDLE.test(e.location_info?.name ?? ""))
    wcHits += hits.length
    console.log(`  probe kw="${q.keyword}" range=${q.dateRange}: ${events.length} events, ${hits.length} WC hits`)
    hits.slice(0, 4).forEach((h) => console.log(`     • ${h.title} @ ${h.location_info?.name}`))

    // L2: geocode + catalog magnitude upgrade for the first WC hit at a stadium.
    for (const h of hits.slice(0, 3)) {
      const pos = await geocodeVenue(h.location_info?.name, h.location_info?.address)
      if (!pos) continue
      const dist = haversineMiles(CANES_LAT, CANES_LNG, pos.lat, pos.lng)
      const match = matchEventToCatalog(pos.lat, pos.lng, catalog)
      const baseMag = classifyEventMagnitude({ title: h.title, venue: { name: h.location_info?.name }, ticketsAndInfo: [] })
      const finalMag = match && isMajorCapacity(match.capacityHigh) ? "major (catalog upgrade)" : baseMag
      const role = dist <= 0.5 ? "local_foot" : dist <= 3 ? "local_traffic" : "metro_hook"
      console.log(
        `       ↳ "${h.title}" venue="${h.location_info?.name}" dist=${dist}mi → ${role}; magnitude=${finalMag}${match ? ` [matched catalog: ${match.name} cap≤${match.capacityHigh}]` : ""}`,
      )
    }
  }

  console.log("\n================ VERDICT ================")
  console.log(stadium ? "✓ L0 found the stadium" : "✗ L0 missed the stadium")
  console.log(plan.some((q) => /stadium/i.test(q.keyword)) ? "✓ L1 probes the stadium by name" : "✗ L1 did not probe the stadium")
  console.log(wcHits > 0 ? `✓ World Cup matches now fetched (${wcHits} hits)` : "✗ No World Cup matches fetched")
}

main().catch((e) => {
  console.error("E2E FAILED:", e)
  process.exit(1)
})
