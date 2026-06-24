// ---------------------------------------------------------------------------
// GET /api/cron/ingest-knowledge-feeds (Sun 21:00 UTC) — PIPELINE 1: EXTERNAL knowledge ingestion
// for the Learning Spine (P14). Per ENABLED skill_source_registry row: fetch by fetch_strategy →
// adversarially distill each item → trust-tier + corroboration gate → write skill_knowledge rows as
// candidate/shadow/active (NOTHING reaches a prompt until `active`). The whole pipeline lives in
// lib/skills/ingest-knowledge.ts (pure + unit-tested); this route is the thin Vercel-cron wrapper.
//
// SAFE BY CONSTRUCTION: one dead source never breaks the run (per-source try/catch → failure_count++);
// a missing skill_source_registry table → no-op run (floor = today). `?dryRun=1` does everything
// EXCEPT write skill_knowledge, so the run is observable without mutating priors. Auth: Bearer
// CRON_SECRET (mirrors weekly-digest).
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runIngestion, type IngestStore, type HttpFetch } from "@/lib/skills/ingest-knowledge"

export const maxDuration = 300

// Real HTTP transport with a per-request abort so a hung source can't stall the weekly run.
const httpFetch: HttpFetch = async (url, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(url, { headers: init?.headers, signal: controller.signal, redirect: "follow" })
    return { ok: res.ok, status: res.status, text: () => res.text() }
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1"
  const store = createAdminSupabaseClient() as unknown as IngestStore

  try {
    const result = await runIngestion({ store, http: httpFetch, dryRun })
    console.log(
      `[ingest-knowledge] sources ${result.sourcesOk}/${result.sourcesTried} ok, items ${result.itemsFetched}, kept ${result.distilledKept}, rows ${result.rowsWritten}${dryRun ? " (dry-run)" : ""}`,
    )
    return Response.json(result)
  } catch (err) {
    // A learning-system outage must never page as a brief-breaking error — log + 200 so the cron
    // surface stays green and the brief path (which never touches this) is unaffected.
    console.warn("[ingest-knowledge] run failed:", err instanceof Error ? err.message : err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "ingestion failed" })
  }
}
