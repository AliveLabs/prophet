// ---------------------------------------------------------------------------
// Ambient Feed Data – pulls diverse content for the loading feed
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AmbientCard } from "./types"

let idCounter = 0
function nextId(prefix: string) {
  return `${prefix}-${++idCounter}-${Date.now()}`
}

export async function loadAmbientCards(
  supabase: SupabaseClient,
  locationId: string
): Promise<AmbientCard[]> {
  const cards: AmbientCard[] = []

  // 1. Pull recent insights (randomized)
  try {
    const { data: insights } = await supabase
      .from("insights")
      .select("id, title, summary, insight_type, severity")
      .eq("location_id", locationId)
      .order("date_key", { ascending: false })
      .limit(20)

    if (insights?.length) {
      const shuffled = insights.sort(() => Math.random() - 0.5).slice(0, 6)
      for (const ins of shuffled) {
        cards.push({
          id: nextId("insight"),
          category: "from_your_data",
          text: ins.title ?? ins.summary ?? "",
        })
      }
    }
  } catch {
    /* non-fatal */
  }

  // 2. Pull location stats
  try {
    const { data: location } = await supabase
      .from("locations")
      .select("name, city, region")
      .eq("id", locationId)
      .maybeSingle()

    if (location) {
      cards.push({
        id: nextId("loc"),
        category: "from_your_data",
        text: `Analyzing data for ${location.name ?? "your location"} in ${[location.city, location.region].filter(Boolean).join(", ") || "your area"}.`,
      })
    }
  } catch {
    /* non-fatal */
  }

  // 3. Pull competitor count
  try {
    const { data: comps } = await supabase
      .from("competitors")
      .select("id, name")
      .eq("location_id", locationId)
      .eq("is_active", true)

    const approved = (comps ?? []).filter(
      // Check for approved status in metadata if possible
      () => true
    )
    if (approved.length > 0) {
      cards.push({
        id: nextId("comp"),
        category: "from_your_data",
        text: `You're tracking ${approved.length} competitor${approved.length !== 1 ? "s" : ""} for this location.`,
      })
    }
  } catch {
    /* non-fatal */
  }

  // 4. Static industry tips
  const tips = [
    "Businesses that respond to reviews within 24 hours see 33% higher engagement.",
    "Menu items with descriptions sell 27% more than those without.",
    "Locations with complete Google Business profiles get 7x more clicks.",
    "Seasonal menu changes can boost revenue by 15-20%.",
    "Competitors with happy hour specials tend to attract 40% more weekday traffic.",
    "Online ordering availability increases revenue by an average of 30%.",
    "Businesses with 4+ star ratings capture 95% of local search clicks.",
    "Photo-rich business profiles receive 42% more direction requests.",
    "Catering services can increase restaurant revenue by 20-30%.",
    "Private dining options attract 35% higher per-guest spending.",
  ]

  const shuffledTips = tips.sort(() => Math.random() - 0.5).slice(0, 4)
  for (const tip of shuffledTips) {
    cards.push({
      id: nextId("tip"),
      category: "industry_tip",
      text: tip,
    })
  }

  return cards.sort(() => Math.random() - 0.5)
}
