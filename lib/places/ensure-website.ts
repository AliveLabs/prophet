// Self-healing competitor websites. Root cause (Bush's Forney, 2026-06-10): approved
// competitors had website=null — never persisted at approval — which starved EVERY
// downstream pipeline (menu scrape, social handle discovery, SEO) into silent no-ops.
//
// Round 2 (same day, found on the forced full pull): the stored Google place_ids had
// ROTATED — Place Details returns 404 "no longer valid, refresh cached Place IDs",
// which the first heal swallowed. So the heal now refreshes identity too: when the
// stored id is dead (or carries no website), re-resolve by text search (name + the
// address we captured at discovery), guard the match by name, and persist BOTH the
// fresh place_id and the website. The refreshed id also un-breaks photos/SEO, which
// 404 silently on rotten ids.

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchPlaceDetails } from "./google"

type HealableCompetitor = {
  id: string
  name?: string | null
  website: string | null
  provider_entity_id?: string | null
  metadata?: Record<string, unknown> | null
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/** Conservative identity guard: one normalized name must contain the other. */
function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  return na.includes(nb) || nb.includes(na)
}

type ResolvedPlace = { id: string; name: string | null; website: string | null }

/** Re-resolve a rotated/dead place id by text search (same API the events geocoder uses). */
async function resolveByText(query: string): Promise<ResolvedPlace | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey || !query.trim()) return null
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri",
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      places?: Array<{ id?: string; displayName?: { text?: string }; websiteUri?: string }>
    }
    const p = data.places?.[0]
    if (!p?.id) return null
    return { id: p.id, name: p.displayName?.text ?? null, website: p.websiteUri ?? null }
  } catch {
    return null
  }
}

export async function ensureCompetitorWebsites<T extends HealableCompetitor>(
  supabase: SupabaseClient,
  competitors: T[]
): Promise<T[]> {
  const missing = competitors.filter((c) => !c.website && c.provider_entity_id)
  if (missing.length === 0) return competitors

  await Promise.all(
    missing.map(async (c) => {
      // 1) The stored id, if it still resolves.
      let website: string | null = null
      try {
        const details = await fetchPlaceDetails(c.provider_entity_id as string)
        website = (details as { websiteUri?: string } | null)?.websiteUri ?? null
      } catch {
        /* dead/rotated id — fall through to re-resolution */
      }
      if (website) {
        c.website = website
        const { error } = await supabase.from("competitors").update({ website }).eq("id", c.id)
        if (error) console.error(`[ensureWebsite] update failed for ${c.id}: ${error.message}`)
        else console.log(`[ensureWebsite] healed ${c.id}: ${website}`)
        return
      }

      // 2) Re-resolve identity by name + captured locality, then persist id + website.
      const meta = (c.metadata ?? {}) as Record<string, unknown>
      const locality = [meta.address, meta.city, meta.region]
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .slice(0, 2)
        .join(", ")
      const query = [c.name, locality].filter(Boolean).join(", ")
      const resolved = await resolveByText(query)
      if (!resolved || !namesMatch(c.name, resolved.name)) {
        console.warn(`[ensureWebsite] could not re-resolve ${c.id} (${c.name ?? "?"}) — leaving as-is`)
        return
      }

      const update: Record<string, unknown> = { provider_entity_id: resolved.id }
      if (resolved.website) {
        update.website = resolved.website
        c.website = resolved.website
      }
      const { error } = await supabase.from("competitors").update(update).eq("id", c.id)
      if (error) console.error(`[ensureWebsite] re-resolve update failed for ${c.id}: ${error.message}`)
      else console.log(
        `[ensureWebsite] re-resolved ${c.id} (${c.name ?? "?"}): id ${c.provider_entity_id} -> ${resolved.id}${resolved.website ? `, website ${resolved.website}` : " (no website on file with Google)"}`
      )
      c.provider_entity_id = resolved.id
    })
  )
  return competitors
}
