"use server"

import { redirect } from "next/navigation"
import { updateTag } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { generateGeminiJson } from "@/lib/ai/gemini"
import { updateWeight } from "@/lib/insights/scoring"
import {
  buildPriorityBriefingPrompt,
  buildDeterministicBriefing,
  type PriorityItem,
  type InsightForBriefing,
  type BusinessContext,
} from "@/lib/ai/prompts/priority-briefing"
import type { InsightPreference } from "@/lib/insights/scoring"
import { getCachedBriefing, setCachedBriefing } from "@/lib/insights/briefing-cache"

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

  const { data: insight } = await supabase
    .from("insights")
    .select("insight_type, location_id")
    .eq("id", insightId)
    .maybeSingle()

  if (!insight) return

  if (insight.location_id) {
    const { data: loc } = await supabase
      .from("locations")
      .select("organization_id")
      .eq("id", insight.location_id)
      .maybeSingle()

    if (loc?.organization_id) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", loc.organization_id)
        .eq("user_id", user.id)
        .maybeSingle()

      if (!membership) return
    }
  }

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
      feedback_at: new Date().toISOString(),
      feedback_by: user.id,
    })
    .eq("id", insightId)

  if (insight && userFeedback) {
    const feedback = userFeedback === "useful" ? "useful" : "not_useful"
    await updateOrgPreference(supabase, user.id, insight.insight_type, feedback)
  }

  updateTag("insights-data")
  updateTag("social-data")
}

// ---------------------------------------------------------------------------
// Legacy actions (kept for backward compat, delegate to unified action)
// ---------------------------------------------------------------------------

export async function saveInsightAction(formData: FormData) {
  formData.set("new_status", "read")
  formData.set("current_path", "/insights")
  await updateInsightStatusAction(formData)
  redirect("/insights")
}

export async function dismissInsightAction(formData: FormData) {
  formData.set("new_status", "dismissed")
  formData.set("current_path", "/insights")
  await updateInsightStatusAction(formData)
  redirect("/insights")
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

// ---------------------------------------------------------------------------
// Legacy actions kept for backward compatibility (redirect to new ones)
// ---------------------------------------------------------------------------

export async function markInsightReadAction(formData: FormData) {
  return saveInsightAction(formData)
}

// ---------------------------------------------------------------------------
// Priority Briefing generation (called during page render)
// ---------------------------------------------------------------------------

export async function generatePriorityBriefing(
  insights: InsightForBriefing[],
  preferences: InsightPreference[],
  locationName: string,
  cacheKey?: string | null,
  context?: BusinessContext | null
): Promise<PriorityItem[]> {
  if (insights.length === 0) return []

  if (cacheKey) {
    const cached = getCachedBriefing(cacheKey)
    if (cached) return cached
  }

  let result_items: PriorityItem[]

  try {
    const prompt = buildPriorityBriefingPrompt(insights, preferences, locationName, context)
    const result = await generateGeminiJson(prompt, { temperature: 0.3, maxOutputTokens: 4096 })

    if (result?.priorities && Array.isArray(result.priorities)) {
      const validSources = ["competitors", "events", "seo", "content", "photos", "traffic"]
      result_items = (result.priorities as PriorityItem[]).slice(0, 5).map((p) => ({
        title: String(p.title ?? ""),
        why: String(p.why ?? ""),
        urgency: (["critical", "warning", "info"].includes(p.urgency) ? p.urgency : "info") as PriorityItem["urgency"],
        action: String(p.action ?? ""),
        source: (validSources.includes(p.source) ? p.source : "competitors") as PriorityItem["source"],
        relatedInsightTypes: Array.isArray(p.relatedInsightTypes)
          ? p.relatedInsightTypes.map(String)
          : [],
      }))
    } else {
      result_items = buildDeterministicBriefing(insights)
    }
  } catch (err) {
    console.warn("[PriorityBriefing] Gemini call failed, using deterministic fallback:", err)
    result_items = buildDeterministicBriefing(insights)
  }

  if (cacheKey && result_items.length > 0) {
    setCachedBriefing(cacheKey, result_items)
  }

  return result_items
}
