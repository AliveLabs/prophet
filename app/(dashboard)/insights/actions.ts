"use server"

import { updateTag } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { requireOrgMembership } from "@/lib/auth/org-access"
import { updateWeight } from "@/lib/insights/scoring"

// ---------------------------------------------------------------------------
// Unified insight status update action
// Updates status, optionally adjusts org preference, revalidates current page
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(["new", "read", "todo", "actioned", "snoozed", "dismissed", "inaccurate"])
const POSITIVE_STATUSES = new Set(["read", "todo", "actioned"])
// Statuses that mean "stop showing me this": dismissed = accurate but not
// useful; inaccurate = the DATA is wrong (review 2026-06-11). Both down-weight
// the insight type; inaccurate additionally flags the source for ops.
const NEGATIVE_STATUSES = new Set(["dismissed", "inaccurate"])

export async function updateInsightStatusAction(formData: FormData) {
  const user = await requireUser()
  const insightId = String(formData.get("insight_id") ?? "")
  const newStatus = String(formData.get("new_status") ?? "")

  if (!insightId || !VALID_STATUSES.has(newStatus)) return

  const supabase = await createServerSupabaseClient()

  const insight = await loadAuthorizedInsight(supabase, user.id, insightId)
  if (!insight) return

  const userFeedback = NEGATIVE_STATUSES.has(newStatus)
    ? "not_useful"
    : POSITIVE_STATUSES.has(newStatus)
      ? "useful"
      : null

  await supabase
    .from("insights")
    .update({
      status: newStatus,
      ...(userFeedback ? { user_feedback: userFeedback } : {}),
      // Undo (back to "new") clears the row's feedback rather than leaving a stale
      // useful/not_useful verdict behind an untouched-looking card.
      ...(newStatus === "new" ? { user_feedback: null } : {}),
      feedback_at: new Date().toISOString(),
      feedback_by: user.id,
    })
    .eq("id", insightId)

  if (userFeedback) {
    await updateOrgPreference(supabase, user.id, insight.insight_type, userFeedback)
  }

  updateTag("insights-data")
  updateTag("social-data")
}

// ---------------------------------------------------------------------------
// Per-insight thumbs feedback (the unified card's Helpful? vote)
//
// The insight-level equivalent of the brief's brief_feedback thumbs, using the
// storage that ALREADY exists for this surface: insights.user_feedback (+ the
// insight_preferences weight loop). Deliberately NOT a status change — the old
// card's ALT-184f note flagged that conflating a rating with a lifecycle write
// pollutes the learning signal, so this action touches feedback fields only.
// ---------------------------------------------------------------------------

export async function submitInsightFeedback(input: {
  insightId: string
  verdict: "good" | "bad"
}): Promise<{ ok: boolean }> {
  const user = await requireUser()
  if (!input.insightId || (input.verdict !== "good" && input.verdict !== "bad")) {
    return { ok: false }
  }

  const supabase = await createServerSupabaseClient()

  const insight = await loadAuthorizedInsight(supabase, user.id, input.insightId)
  if (!insight) return { ok: false }

  const userFeedback = input.verdict === "good" ? "useful" : "not_useful"

  const { error } = await supabase
    .from("insights")
    .update({
      user_feedback: userFeedback,
      feedback_at: new Date().toISOString(),
      feedback_by: user.id,
    })
    .eq("id", input.insightId)
  if (error) return { ok: false }

  await updateOrgPreference(supabase, user.id, insight.insight_type, userFeedback)

  updateTag("insights-data")
  updateTag("social-data")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Shared: load an insight and verify the caller may act on it
// ---------------------------------------------------------------------------

async function loadAuthorizedInsight(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  insightId: string
): Promise<{ insight_type: string; location_id: string | null } | null> {
  const { data: insight } = await supabase
    .from("insights")
    .select("insight_type, location_id")
    .eq("id", insightId)
    .maybeSingle()

  if (!insight) return null

  // ALT-577: these actions are keyed on the INSIGHT's org (via its location), not the
  // caller's current org, so they cannot use resolveOrgActor. requireOrgMembership carries
  // the same guarantees (member AND the org is not soft-deleted) for an explicit orgId.
  if (insight.location_id) {
    const { data: loc } = await supabase
      .from("locations")
      .select("organization_id")
      .eq("id", insight.location_id)
      .maybeSingle()

    if (loc?.organization_id) {
      try {
        await requireOrgMembership(supabase, userId, loc.organization_id)
      } catch {
        return null
      }
    }
  }

  return insight
}

// ---------------------------------------------------------------------------
// Update org preference weight
// ---------------------------------------------------------------------------

async function updateOrgPreference(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  insightType: string,
  feedback: "useful" | "not_useful"
) {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", userId)
      .maybeSingle()

    const orgId = profile?.current_organization_id
    if (!orgId) return

    const { data: existing } = await supabase
      .from("insight_preferences")
      .select("weight, useful_count, dismissed_count")
      .eq("organization_id", orgId)
      .eq("insight_type", insightType)
      .maybeSingle()

    const currentWeight = existing?.weight ?? 1.0
    const newWeight = updateWeight(Number(currentWeight), feedback)

    await supabase.from("insight_preferences").upsert(
      {
        organization_id: orgId,
        insight_type: insightType,
        weight: newWeight,
        useful_count: (existing?.useful_count ?? 0) + (feedback === "useful" ? 1 : 0),
        dismissed_count: (existing?.dismissed_count ?? 0) + (feedback === "not_useful" ? 1 : 0),
        last_feedback_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,insight_type" }
    )
  } catch (err) {
    console.error("Failed to update org preference:", err)
  }
}
