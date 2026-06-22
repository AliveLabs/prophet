// ---------------------------------------------------------------------------
// GET /api/health/pipeline — read-only pipeline freshness/health probe.
//
// Polled by the EXTERNAL watchdog (.github/workflows/pipeline-watchdog.yml), which
// lives outside Vercel so it can catch "all Vercel crons went dark" — the failure
// that silently stalled the pipeline for ~2 weeks in 2026-06. This endpoint only
// READS (no enqueue, no alert side-effects): the external watchdog decides + alerts,
// because an in-Vercel alerter is dark alongside everything else when crons stop.
//
// Auth: a dedicated HEALTH_CHECK_TOKEN (preferred — scope the GH secret narrowly) OR
// the existing CRON_SECRET. Token via `Authorization: Bearer` or `?token=`.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { detectPipelineHealth } from "@/lib/ops/pipeline-health"

export const maxDuration = 30

// No `export const dynamic` — this project runs Next.js cacheComponents, which forbids it.
// The handler reads the request (auth header + ?token), so it's inherently dynamic/uncached anyway.
export async function GET(req: Request) {
  // Bearer-only (no ?token= — query strings leak into logs/Referer, and HEALTH_CHECK_TOKEN
  // commonly equals CRON_SECRET). Strict: never open when no token is configured.
  const expected = process.env.HEALTH_CHECK_TOKEN || process.env.CRON_SECRET
  const auth = req.headers.get("authorization") ?? ""
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : ""
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const verdict = await detectPipelineHealth(createAdminSupabaseClient())
    // 200 with the verdict in the body — the watchdog inspects `.status`. A clean 200+body keeps
    // any other uptime monitor from misreading a 'degraded' app as a 'server error'.
    return NextResponse.json(verdict)
  } catch (err) {
    // A detector/DB failure is itself a health problem the watchdog must hear about. Log the
    // detail server-side; return a GENERIC reason (don't leak DB internals to a token holder).
    console.error("[health/pipeline] probe failed:", err)
    return NextResponse.json(
      { status: "down", reasons: ["health probe failed (see server logs)"], checkedAt: new Date().toISOString() },
      { status: 500 },
    )
  }
}
