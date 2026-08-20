import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { createFeedbackTicket, isNotionConfigured } from "@/lib/feedback/notion"

export const maxDuration = 60

// Sweeper: every beta_feedback row with no Notion ticket gets one.
//
// This exists because the inline attempt in submitBetaFeedback is best-effort by design —
// a Notion outage must not fail the operator's submission. Without a sweeper, "best
// effort" means "silently dropped", which is exactly how seven walkthrough reports on
// 2026-08-17 produced one email and zero tickets.
//
// Two properties make it safe to run on a schedule:
//
//   IDEMPOTENT. It only selects rows where notion_page_id IS NULL, and it stamps the id
//   immediately on success. A row can never be ticketed twice, so re-running is free.
//
//   FAILS FORWARD, NOT CLOSED. One row's Notion error is recorded on that row and the
//   loop continues. A single malformed report cannot block the queue behind it.
//
// It is also the BACKFILL path: turn the token on and the next run files everything that
// accumulated while it was off. Nothing has to be replayed by hand.
//
// Serial, not parallel, and capped per run: Notion rate-limits at roughly 3 requests a
// second, and feedback volume is single digits a day. A batch that cannot finish simply
// finishes next run.
const BATCH = 25

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  // Same polarity as every other cron here: a missing secret FAILS CLOSED.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isNotionConfigured()) {
    // Not an error. The integration ships before the token does, and saying so plainly
    // beats a 500 that looks like a broken endpoint.
    return NextResponse.json({ ok: true, skipped: "notion not configured", created: 0 })
  }

  const admin = createAdminSupabaseClient()

  const { data: rows, error } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        is: (c: string, v: null) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => Promise<{
              data: Array<{
                id: string
                created_at: string
                message: string
                category: string | null
                page_path: string | null
                user_id: string | null
                organization_id: string | null
                email: string | null
                business_name: string | null
              }> | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
  })
    .from("beta_feedback")
    .select("id, created_at, message, category, page_path, user_id, organization_id, email, business_name")
    .is("notion_page_id", null)
    .order("created_at", { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error("[feedback-notion-sync] query failed:", error.message)
    return NextResponse.json({ error: "Query failed" }, { status: 500 })
  }
  if (!rows?.length) return NextResponse.json({ ok: true, created: 0, failed: 0 })

  // Resolve reporter and org names in two queries rather than two per row.
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => Boolean(v)))]
  const orgIds = [...new Set(rows.map((r) => r.organization_id).filter((v): v is string => Boolean(v)))]

  const emailById = new Map<string, string>()
  if (userIds.length) {
    const { data } = await admin.from("profiles").select("id, email").in("id", userIds)
    for (const p of data ?? []) if (p.email) emailById.set(p.id, p.email)
  }
  const orgById = new Map<string, string>()
  if (orgIds.length) {
    const { data } = await admin.from("organizations").select("id, name").in("id", orgIds)
    for (const o of data ?? []) if (o.name) orgById.set(o.id, o.name)
  }

  const stamp = (values: Record<string, unknown>, id: string) =>
    (admin as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> }
      }
    })
      .from("beta_feedback")
      .update(values)
      .eq("id", id)

  let created = 0
  let failed = 0

  for (const row of rows) {
    const result = await createFeedbackTicket({
      feedbackId: row.id,
      message: row.message,
      category: row.category,
      pagePath: row.page_path,
      // ALT-695 — an ANONYMOUS row (logged-out support form) has no user_id or organization_id,
      // so fall back to what the person typed. Without this a retried anonymous request becomes a
      // Notion ticket with no reporter and no business name, which is exactly the two fields that
      // make it actionable: there is no other way to reply to them or find their account.
      userEmail: (row.user_id ? emailById.get(row.user_id) ?? null : null) ?? row.email ?? null,
      orgName:
        (row.organization_id ? orgById.get(row.organization_id) ?? null : null) ??
        row.business_name ??
        null,
      createdAt: row.created_at,
    })

    if (result.ok) {
      await stamp(
        { notion_page_id: result.pageId, notion_synced_at: new Date().toISOString(), notion_error: null },
        row.id
      )
      created++
    } else if (!result.skipped) {
      // Leave notion_page_id NULL so the next run tries again, but record why so a row
      // that keeps failing is visible instead of retried forever in silence.
      console.error(`[feedback-notion-sync] row ${row.id} failed:`, result.error)
      await stamp({ notion_error: result.error.slice(0, 500) }, row.id)
      failed++
    }
  }

  console.log(`[feedback-notion-sync] created=${created} failed=${failed} scanned=${rows.length}`)
  return NextResponse.json({ ok: true, created, failed, scanned: rows.length })
}
