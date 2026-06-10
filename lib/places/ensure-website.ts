// Self-healing competitor websites. Root cause (Bush's Forney, 2026-06-10): approved
// competitors had website=null — never persisted at approval — which starved EVERY
// downstream pipeline (menu scrape, social handle discovery, SEO) into silent no-ops.
// All of them carry a Google place_id, so the website is one Places call away: recover
// it lazily on pipeline runs and PERSIST it so the heal happens once.

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchPlaceDetails } from "./google"

export async function ensureCompetitorWebsites<
  T extends { id: string; website: string | null; provider_entity_id?: string | null },
>(supabase: SupabaseClient, competitors: T[]): Promise<T[]> {
  const missing = competitors.filter((c) => !c.website && c.provider_entity_id)
  if (missing.length === 0) return competitors

  await Promise.all(
    missing.map(async (c) => {
      try {
        const details = await fetchPlaceDetails(c.provider_entity_id as string)
        const website = (details as { websiteUri?: string } | null)?.websiteUri ?? null
        if (website) {
          c.website = website
          await supabase.from("competitors").update({ website }).eq("id", c.id)
          console.log(`[ensureWebsite] healed ${c.id}: ${website}`)
        }
      } catch {
        /* leave null; the pipeline degrades honestly */
      }
    })
  )
  return competitors
}
