import { config } from "dotenv"
config({ path: ".env.local" })

import { createClient } from "@supabase/supabase-js"
import { fetchBusyTimes } from "../lib/providers/outscraper"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function main() {
  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, provider_entity_id, location_id")
    .eq("is_active", true)
    .limit(8)

  if (!competitors?.length) {
    console.log("No competitors")
    return
  }

  // Clear old data
  await supabase.from("busy_times").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  console.log("Cleared old busy_times data\n")

  for (const comp of competitors) {
    console.log(`--- ${comp.name} (${comp.provider_entity_id}) ---`)

    try {
      const result = await fetchBusyTimes(comp.provider_entity_id, comp.id)

      if (!result || result.days.length === 0) {
        console.log("  No busy times data\n")
        continue
      }

      console.log(`  Got ${result.days.length} days, current_popularity: ${result.current_popularity}`)

      for (const day of result.days) {
        const { error } = await supabase.from("busy_times").insert({
          competitor_id: comp.id,
          day_of_week: day.day_of_week,
          hourly_scores: day.hourly_scores,
          peak_hour: day.peak_hour,
          peak_score: day.peak_score,
          slow_hours: day.slow_hours,
          typical_time_spent: result.typical_time_spent,
          current_popularity: result.current_popularity,
        })

        if (error) {
          console.log(`  [error] ${day.day_name}: ${error.message}`)
        } else {
          console.log(`  [ok] ${day.day_name}: peak=${day.peak_score}% at ${day.peak_hour}:00`)
        }
      }
      console.log()
    } catch (err) {
      console.error(`  Error:`, err)
      console.log()
    }

    await new Promise(r => setTimeout(r, 500))
  }

  const { count } = await supabase.from("busy_times").select("*", { count: "exact", head: true })
  console.log(`\nTotal busy_times records: ${count}`)
}

main().catch(console.error)
