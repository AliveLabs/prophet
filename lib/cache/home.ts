import { unstable_cache } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedHomeResult = {
  locationCount: number
  competitorCount: number
  insightCount: number
  locations: Array<{ id: string; name: string }>
  recentInsights: Array<{
    id: string
    insight_type: string
    title: string
    summary: string
    severity: string
    confidence: string
    created_at: string
    competitor_id: string | null
    evidence: unknown
    recommendations: unknown
    date_key: string | null
  }>
  allInsights: Array<{
    id: string
    insight_type: string
    severity: string
    confidence: string
    status: string
    created_at: string
    date_key: string | null
  }>
  recentJobs: Array<{
    id: string
    job_type: string
    status: string
    created_at: string
    updated_at: string
    location_id: string | null
  }>
}

async function fetchHomePageDataRaw(
  organizationId: string,
): Promise<CachedHomeResult> {
  const supabase = createAdminSupabaseClient()

  const [
    { count: locationCount },
    { count: competitorCount },
    { count: insightCount },
    { data: locations },
    { data: recentInsights },
    { data: allInsights },
    { data: recentJobs },
  ] = await Promise.all([
    supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("competitors")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("insights")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("locations")
      .select("id, name")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("insights")
      .select("id, insight_type, title, summary, severity, confidence, created_at, competitor_id, evidence, recommendations, date_key")
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("insights")
      .select("id, insight_type, severity, confidence, status, created_at, date_key")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("refresh_jobs")
      .select("id, job_type, status, created_at, updated_at, location_id")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(20),
  ])

  return {
    locationCount: locationCount ?? 0,
    competitorCount: competitorCount ?? 0,
    insightCount: insightCount ?? 0,
    locations: (locations ?? []) as CachedHomeResult["locations"],
    recentInsights: (recentInsights ?? []) as CachedHomeResult["recentInsights"],
    allInsights: (allInsights ?? []) as CachedHomeResult["allInsights"],
    recentJobs: (recentJobs ?? []) as CachedHomeResult["recentJobs"],
  }
}

export const fetchHomePageData = unstable_cache(
  fetchHomePageDataRaw,
  ["home-page-data"],
  { revalidate: 604800, tags: ["home-data"] }
)
