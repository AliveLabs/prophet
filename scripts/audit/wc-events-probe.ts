// One-off diagnostic: does DataForSEO Google Events return the World Cup at
// AT&T Stadium (Arlington, TX) for the queries our pipeline actually runs?
// Run: npx tsx scripts/audit/wc-events-probe.ts
import { config } from "dotenv"
config({ path: ".env.local" })

const BASE = "https://api.dataforseo.com"
const login = process.env.DATAFORSEO_LOGIN!
const password = process.env.DATAFORSEO_PASSWORD!
const auth = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`

const NEEDLES = /world cup|fifa|argentina|austria|soccer|f[uú]tbol|football match|at&t stadium|att stadium|matchday|group stage/i

type Item = {
  type?: string
  title?: string
  event_dates?: { start_datetime?: string; displayed_dates?: string }
  location_info?: { name?: string; address?: string }
}

async function probe(keyword: string, locationName: string, dateRange?: string, depth = 20) {
  const task: Record<string, unknown> = {
    keyword,
    location_name: locationName,
    language_code: "en",
    device: "desktop",
    os: "windows",
    depth,
    ...(dateRange ? { date_range: dateRange } : {}),
  }
  const res = await fetch(`${BASE}/v3/serp/google/events/live/advanced`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([task]),
  })
  const json: any = await res.json()
  const t = json.tasks?.[0]
  const items: Item[] = t?.result?.[0]?.items ?? []
  const events = items.filter((i) => !i.type || i.type === "event_item")
  const hits = events.filter(
    (e) =>
      NEEDLES.test(e.title ?? "") ||
      NEEDLES.test(e.location_info?.name ?? "") ||
      NEEDLES.test(e.location_info?.address ?? "")
  )
  const label = `kw="${keyword}" loc="${locationName}" range=${dateRange ?? "all"}`
  console.log(`\n=== ${label} ===`)
  console.log(`HTTP ${res.status} | task status_code=${t?.status_code} ${t?.status_message ?? ""} | events=${events.length} | cost=$${json.cost ?? "?"}`)
  console.log("All event titles:")
  events.forEach((e, i) =>
    console.log(`  ${i + 1}. ${e.title ?? "(no title)"} @ ${e.location_info?.name ?? "(no venue)"} | ${e.event_dates?.displayed_dates ?? e.event_dates?.start_datetime ?? "(no date)"}`)
  )
  console.log(hits.length ? `>>> WORLD-CUP/SOCCER HITS: ${hits.length}` : `>>> NO World Cup / soccer / stadium hits`)
  hits.forEach((h) => console.log(`    HIT: ${h.title} @ ${h.location_info?.name} | ${h.event_dates?.displayed_dates}`))
  return { label, events: events.length, hits: hits.length, status: t?.status_code }
}

async function main() {
  const summary: any[] = []
  // What prod ACTUALLY runs (Arlington):
  summary.push(await probe("events", "Arlington,Texas,United States", "week"))
  summary.push(await probe("events", "Arlington,Texas,United States", "weekend"))
  // What prod does NOT run — longer horizon + sport/venue keywords:
  summary.push(await probe("events", "Arlington,Texas,United States", "month"))
  summary.push(await probe("world cup", "Arlington,Texas,United States", "month"))
  summary.push(await probe("AT&T Stadium", "Arlington,Texas,United States", "month"))
  summary.push(await probe("soccer", "Arlington,Texas,United States", "month"))
  // Metro fallbacks (in case the Cane's row uses Dallas/Fort Worth):
  summary.push(await probe("events", "Dallas,Texas,United States", "month"))

  console.log("\n\n================ SUMMARY ================")
  for (const s of summary) console.log(`${s.label} -> events=${s.events} hits=${s.hits} status=${s.status}`)
}

main().catch((e) => {
  console.error("PROBE FAILED:", e)
  process.exit(1)
})
