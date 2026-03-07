import { unstable_cache } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedSocialResult = {
  insights: Array<{
    id: string
    title: string
    summary: string
    confidence: string
    severity: string
    status: string
    user_feedback: unknown
    evidence: unknown
    recommendations: unknown
    date_key: string
    competitor_id: string | null
    insight_type: string
  }>
  preferences: Array<{
    insight_type: string
    weight: number
    useful_count: number
    dismissed_count: number
  }>
}

async function fetchSocialPageDataRaw(
  organizationId: string,
  locationId: string,
): Promise<CachedSocialResult> {
  const supabase = createAdminSupabaseClient()

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)
  const startDateStr = startDate.toISOString().slice(0, 10)

  const [{ data: insightsRaw }, { data: prefsRaw }] = await Promise.all([
    supabase
      .from("insights")
      .select(
        "id, title, summary, confidence, severity, status, user_feedback, evidence, recommendations, date_key, competitor_id, insight_type"
      )
      .eq("location_id", locationId)
      .gte("date_key", startDateStr)
      .like("insight_type", "social.%")
      .not("status", "in", '("dismissed","snoozed")')
      .order("date_key", { ascending: false })
      .limit(20),
    supabase
      .from("insight_preferences")
      .select("insight_type, weight, useful_count, dismissed_count")
      .eq("organization_id", organizationId),
  ])

  return {
    insights: (insightsRaw ?? []) as CachedSocialResult["insights"],
    preferences: (prefsRaw ?? []).map((p) => ({
      insight_type: p.insight_type,
      weight: Number(p.weight),
      useful_count: p.useful_count,
      dismissed_count: p.dismissed_count,
    })),
  }
}

export const fetchSocialPageData = unstable_cache(
  fetchSocialPageDataRaw,
  ["social-page-data"],
  { revalidate: 604800, tags: ["social-data"] }
)
