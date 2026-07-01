// TICKET ADMIN — Source Quality review queue (ALT-172 consumption half).
//
// Surfaces the "this looks wrong" signals operators leave on the product, so we can go
// CHECK THE SOURCE DATA (a wrong Google listing, stale hours, a mislabeled place):
//   • brief plays dismissed with reason='looks_wrong' (carrying the operator's note), and
//   • insights flagged status='inaccurate'.
// Both are routed NEUTRAL to the recommendation model on purpose — they're complaints about
// bad THIRD-PARTY source data, not model errors. This page is the data-quality consumer.
//
// HARD CONSTRAINT (ALT-172): DATA-QUALITY loop ONLY. Read-only — it writes nothing, and never
// feeds lib/skills/feedback-rollup.ts or the band weights. The model-negative loop stays owned
// by thumbs-down + dismissed:not_relevant. Enforced by tests/unit/source-quality.test.ts.
//
// FAIL-SOFT: every read is wrapped so a missing column (pre-migration) or read error yields an
// empty queue rather than crashing — mirrors the knowledge-review admin queue.

import { connection } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdminContext } from "@/lib/auth/platform-admin"
import type { Database } from "@/types/database.types"
import type { Brief } from "@/lib/skills/types"
import {
  resolvePlayFlag,
  insightFlag,
  aggregateBySource,
  sortFlagsNewestFirst,
  type SourceQualityFlag,
  type LooksWrongRow,
  type InaccurateInsightRow,
  type LocationInfo,
} from "@/lib/skills/source-quality"
import { SourceQualityQueue } from "./components/source-quality-queue"
import "@/components/ticket/pass.css"
import "./source-quality.css"

const WINDOW_DAYS = 30

type AdminClient = SupabaseClient<Database>

export default async function SourceQualityPage() {
  await connection()
  const { role } = await requirePlatformAdminContext() // redirect non-admins
  // Triage (mark-resolved/reopen) needs source_quality.manage (= admin+); read_only sees the
  // queue but not the action buttons. The server action enforces this independently — this
  // just keeps the UI honest (mirrors knowledge-review's canManage gate).
  const canManage = role !== "read_only"

  const supabase = createAdminSupabaseClient()

  const flags = sortFlagsNewestFirst(await loadFlags(supabase))
  const aggregates = aggregateBySource(flags)

  return <SourceQualityQueue flags={flags} aggregates={aggregates} windowDays={WINDOW_DAYS} canManage={canManage} />
}

// ── data layer ─────────────────────────────────────────────────────────────────────────────

async function loadFlags(supabase: AdminClient): Promise<SourceQualityFlag[]> {
  // Computed here (a plain data-fetch fn), not in the component render body, to stay pure.
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  const [looksWrong, inaccurate] = await Promise.all([
    loadLooksWrongRows(supabase, sinceIso),
    loadInaccurateInsightRows(supabase, sinceIso),
  ])

  // Resolve every referenced location (+ its org name) up front, in one pass.
  const locIds = unique([...looksWrong.map((r) => r.location_id), ...inaccurate.map((r) => r.location_id)])
  const locInfo = await loadLocationInfo(supabase, locIds)
  const fallbackLoc = (id: string): LocationInfo => locInfo.get(id) ?? { id, name: "Unknown location" }

  // Brief flags need the persisted brief to resolve the play behind each play_key.
  const briefMap = await loadBriefs(supabase, looksWrong)
  const briefFlags = looksWrong.map((row) =>
    resolvePlayFlag(row, briefMap.get(`${row.location_id}|${row.date_key}`) ?? null, fallbackLoc(row.location_id)),
  )

  const insightFlags = inaccurate.map((row) => insightFlag(row, fallbackLoc(row.location_id)))

  return [...briefFlags, ...insightFlags]
}

/** play_actions.reason/.note/.reviewed_status aren't in the generated DB types yet — use a loose
 *  surface (same posture as brief-actions.ts). Pre-migration the missing column errors the query →
 *  empty (caught below). */
type LooseQuery = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        gte: (c: string, v: string) => {
          order: (
            c: string,
            o: { ascending: boolean },
          ) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
        }
      }
    }
  }
}

/** Same posture as LooseQuery, for the insights read (no `.gte()` — windowing happens client-side
 *  against feedback_at/created_at, same as before this migration). insights.reviewed_status isn't
 *  in the generated types yet either. */
type LooseInsightsQuery = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        order: (
          c: string,
          o: { ascending: boolean },
        ) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
      }
    }
  }
}

async function loadLooksWrongRows(supabase: AdminClient, sinceIso: string): Promise<LooksWrongRow[]> {
  try {
    const { data } = await (supabase as unknown as LooseQuery)
      .from("play_actions")
      .select("location_id, date_key, play_key, note, updated_at, reviewed_status")
      .eq("reason", "looks_wrong")
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
    return (data ?? []).map((r) => ({
      location_id: String(r.location_id ?? ""),
      date_key: String(r.date_key ?? ""),
      play_key: String(r.play_key ?? ""),
      note: typeof r.note === "string" ? r.note : null,
      updated_at: String(r.updated_at ?? ""),
      reviewed_status: typeof r.reviewed_status === "string" ? r.reviewed_status : null,
    }))
  } catch {
    return []
  }
}

async function loadInaccurateInsightRows(supabase: AdminClient, sinceIso: string): Promise<InaccurateInsightRow[]> {
  try {
    const { data } = await (supabase as unknown as LooseInsightsQuery)
      .from("insights")
      .select("id, location_id, insight_type, title, summary, created_at, feedback_at, reviewed_status")
      .eq("status", "inaccurate")
      .order("feedback_at", { ascending: false })
    // Window by when it was flagged (feedback_at), falling back to created_at when unset.
    return (data ?? [])
      .filter((r) => String(r.feedback_at ?? r.created_at ?? "") >= sinceIso)
      .map((r) => ({
        id: String(r.id ?? ""),
        location_id: String(r.location_id ?? ""),
        insight_type: String(r.insight_type ?? ""),
        title: typeof r.title === "string" ? r.title : null,
        summary: typeof r.summary === "string" ? r.summary : null,
        created_at: String(r.created_at ?? ""),
        feedback_at: typeof r.feedback_at === "string" ? r.feedback_at : null,
        reviewed_status: typeof r.reviewed_status === "string" ? r.reviewed_status : null,
      }))
  } catch {
    return []
  }
}

async function loadLocationInfo(supabase: AdminClient, locIds: string[]): Promise<Map<string, LocationInfo>> {
  const map = new Map<string, LocationInfo>()
  if (locIds.length === 0) return map
  try {
    const { data: locs } = await supabase.from("locations").select("id, name, organization_id").in("id", locIds)
    const orgIds = unique((locs ?? []).map((l) => l.organization_id).filter((x): x is string => !!x))
    const orgNames = new Map<string, string>()
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds)
      for (const o of orgs ?? []) orgNames.set(o.id, String(o.name ?? ""))
    }
    for (const l of locs ?? []) {
      map.set(l.id, {
        id: l.id,
        name: String(l.name ?? "Unknown location"),
        orgName: l.organization_id ? orgNames.get(l.organization_id) || undefined : undefined,
      })
    }
  } catch {
    /* read error → callers fall back to a bare location stub */
  }
  return map
}

async function loadBriefs(supabase: AdminClient, rows: LooksWrongRow[]): Promise<Map<string, Brief>> {
  const map = new Map<string, Brief>()
  if (rows.length === 0) return map
  const locIds = unique(rows.map((r) => r.location_id))
  const dateKeys = unique(rows.map((r) => r.date_key))
  try {
    const { data } = await supabase
      .from("daily_briefs")
      .select("location_id, date_key, brief")
      .in("location_id", locIds)
      .in("date_key", dateKeys)
    for (const r of data ?? []) {
      map.set(`${r.location_id}|${r.date_key}`, r.brief as unknown as Brief)
    }
  } catch {
    /* read error → brief flags surface with note + location but no resolved sources */
  }
  return map
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}
