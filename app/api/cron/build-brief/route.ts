// ---------------------------------------------------------------------------
// GET /api/cron/build-brief
// Precompute the synthesized brief: dossier -> runBrief (skills + review + synthesis
// + voice) -> persist to daily_briefs. The home then reads a precomputed brief (no
// LLM at render time). Build one location with ?location_id=..., or all active by default.
// Auth: Bearer CRON_SECRET (mirrors /api/cron/daily). maxDuration extended for the LLM work.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { buildDossier } from "@/lib/insights/dossier/build"
import { runBrief } from "@/lib/skills/pipeline"
import { saveBrief } from "@/lib/insights/daily-brief"
import { runStandingQuestion } from "@/lib/ask/history"

export const maxDuration = 800 // Fluid Compute; the multi-skill + synthesis work exceeds 300s at scale

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const single = url.searchParams.get("location_id")

  const sb = createAdminSupabaseClient()
  let locationIds: string[]
  if (single) {
    locationIds = [single]
  } else {
    const { data, error } = await sb.from("locations").select("id")
    if (error) return Response.json({ error: "Failed to list locations", details: error.message }, { status: 500 })
    locationIds = (data ?? []).map((l) => l.id as string)
  }

  const results: Array<Record<string, unknown>> = []
  for (const locationId of locationIds) {
    try {
      const dossier = await buildDossier(locationId)
      const { brief, dropped } = await runBrief(dossier)
      await saveBrief(brief)
      // Pinned standing question re-runs on the fresh signals, right after the brief.
      const standing = await runStandingQuestion(locationId)
      results.push({ locationId, ok: true, headline: brief.headline, plays: brief.plays.length, dropped: dropped.length, standing })
    } catch (err) {
      results.push({ locationId, ok: false, error: err instanceof Error ? err.message : "failed" })
    }
  }

  return Response.json({ built: results.length, results })
}
