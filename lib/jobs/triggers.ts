// ---------------------------------------------------------------------------
// Location lifecycle trigger — now QUEUE-BASED (Spine rewrite · Phase 7).
//
// Previously this fired an unbounded fire-and-forget content scrape + weather fetch
// inline in the request (only 2 of the signals; died when the request ended). It now
// enqueues a first-run through the durable signal_jobs queue, which the worker drains
// one bounded pipeline at a time with honest pipeline_runs outcomes — the SAME path the
// daily cron and ad-hoc refreshes use. Consistent, observable, complete, no timeouts.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { enqueueFirstRun } from "./queue"

function admin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } }
  )
}

/**
 * Kick off initial data collection for a new or newly-added location via the queue.
 * Quick (just enqueues rows); the worker does the work. Never throws — callers treat it
 * as fire-and-forget. `opts` is retained for call-site compatibility but unused now
 * (each pipeline fetches what it needs).
 */
export async function triggerInitialLocationData(
  locationId: string,
  organizationId: string,
  _opts?: { website?: string | null; geoLat?: number | null; geoLng?: number | null }
): Promise<void> {
  try {
    await enqueueFirstRun(admin(), { organizationId, locationId })
  } catch (err) {
    console.warn("[Trigger] enqueueFirstRun failed:", err)
  }
}
