"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { fetchPlaceDetails } from "@/lib/places/google"
import { diffSnapshots, buildInsights, buildWeeklyInsights } from "@/lib/insights"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import { generateGeminiJson } from "@/lib/ai/gemini"
import { buildInsightNarrativePrompt } from "@/lib/ai/prompts/insights"
import { generateContentInsights } from "@/lib/content/insights"
import type { MenuSnapshot, SiteContentSnapshot } from "@/lib/content/types"
import { generateSeoInsights, type SeoInsightContext } from "@/lib/seo/insights"
import { SEO_SNAPSHOT_TYPES } from "@/lib/seo/types"
import type {
  DomainRankSnapshot,
  NormalizedRankedKeyword,
  NormalizedRelevantPage,
  HistoricalTrafficPoint,
  NormalizedIntersectionRow,
  NormalizedAdCreative,
  SerpRankEntry,
} from "@/lib/seo/types"
import { updateWeight } from "@/lib/insights/scoring"
import {
  buildPriorityBriefingPrompt,
  buildDeterministicBriefing,
  type PriorityItem,
  type InsightForBriefing,
} from "@/lib/ai/prompts/priority-briefing"
import type { InsightPreference } from "@/lib/insights/scoring"
import { getCachedBriefing, setCachedBriefing } from "@/lib/insights/briefing-cache"

// ---------------------------------------------------------------------------
// Helper: rebuild redirect URL preserving all search params
// ---------------------------------------------------------------------------

function buildRedirectUrl(formData: FormData): string {
  const params = new URLSearchParams()
  const preserve = ["location_id", "range", "confidence", "severity", "source", "status"]
  for (const key of preserve) {
    const val = formData.get(`_param_${key}`)
    if (val && typeof val === "string") params.set(key, val)
  }
  const qs = params.toString()
  return `/insights${qs ? `?${qs}` : ""}`
}

// ---------------------------------------------------------------------------
// Save (useful) action
// ---------------------------------------------------------------------------

export async function saveInsightAction(formData: FormData) {
  const user = await requireUser()
  const insightId = String(formData.get("insight_id") ?? "")
  if (!insightId) {
    redirect("/insights?error=Missing%20insight")
  }

  const supabase = await createServerSupabaseClient()

  const { data: insight } = await supabase
    .from("insights")
    .select("insight_type, location_id")
    .eq("id", insightId)
    .maybeSingle()

  const { error } = await supabase
    .from("insights")
    .update({
      status: "read",
      user_feedback: "useful",
      feedback_at: new Date().toISOString(),
      feedback_by: user.id,
    })
    .eq("id", insightId)

  if (error) {
    redirect(`/insights?error=${encodeURIComponent(error.message)}`)
  }

  if (insight) {
    await updateOrgPreference(supabase, user.id, insight.insight_type, "useful")
  }

  redirect(buildRedirectUrl(formData))
}

// ---------------------------------------------------------------------------
// Dismiss (not useful) action
// ---------------------------------------------------------------------------

export async function dismissInsightAction(formData: FormData) {
  const user = await requireUser()
  const insightId = String(formData.get("insight_id") ?? "")
  if (!insightId) {
    redirect("/insights?error=Missing%20insight")
  }

  const supabase = await createServerSupabaseClient()

  const { data: insight } = await supabase
    .from("insights")
    .select("insight_type, location_id")
    .eq("id", insightId)
    .maybeSingle()

  const { error } = await supabase
    .from("insights")
    .update({
      status: "dismissed",
      user_feedback: "not_useful",
      feedback_at: new Date().toISOString(),
      feedback_by: user.id,
    })
    .eq("id", insightId)

  if (error) {
    redirect(`/insights?error=${encodeURIComponent(error.message)}`)
  }

  if (insight) {
    await updateOrgPreference(supabase, user.id, insight.insight_type, "not_useful")
  }

  redirect(buildRedirectUrl(formData))
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
  cacheKey?: string | null
): Promise<PriorityItem[]> {
  if (insights.length === 0) return []

  if (cacheKey) {
    const cached = getCachedBriefing(cacheKey)
    if (cached) return cached
  }

  let result_items: PriorityItem[]

  try {
    const prompt = buildPriorityBriefingPrompt(insights, preferences, locationName)
    const result = await generateGeminiJson(prompt, { temperature: 0.3, maxOutputTokens: 2048 })

    if (result?.priorities && Array.isArray(result.priorities)) {
      const validSources = ["competitors", "events", "seo", "content"]
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

function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function getPreviousDateKey(baseKey: string, days: number) {
  const base = new Date(baseKey)
  base.setDate(base.getDate() - days)
  return getDateKey(base)
}

function buildSnapshotFromPlaceDetails(details: Awaited<ReturnType<typeof fetchPlaceDetails>> | null) {
  if (!details) {
    return null
  }
  const phone = details.internationalPhoneNumber ?? details.nationalPhoneNumber ?? undefined
  const hours =
    details.regularOpeningHours?.weekdayDescriptions?.reduce<Record<string, string>>(
      (acc, line) => {
        const [day, rest] = line.split(":")
        if (day && rest) {
          acc[day.trim()] = rest.trim()
        }
        return acc
      },
      {}
    ) ?? undefined

  const recentReviews =
    details.reviews?.map((review, index) => ({
      id: `${details.id ?? "place"}-${index}`,
      rating: review.rating ?? 0,
      text: review.text?.text ?? "",
      date: review.relativePublishTimeDescription ?? "",
    })) ?? []

  const snapshot: NormalizedSnapshot = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    profile: {
      title: details.displayName?.text ?? undefined,
      rating: details.rating ?? undefined,
      reviewCount: details.userRatingCount ?? undefined,
      priceLevel: details.priceLevel ?? undefined,
      address: details.formattedAddress ?? undefined,
      website: details.websiteUri ?? undefined,
      phone,
    },
    hours,
    recentReviews,
  }

  return snapshot
}

function clampReviews(reviews: Array<Record<string, unknown>> | null | undefined) {
  if (!reviews) return []
  return reviews
    .map((review) => ({
      rating: typeof review.rating === "number" ? review.rating : undefined,
      text: (() => {
        const textObj = review.text as { text?: unknown } | undefined
        return typeof textObj?.text === "string" ? textObj.text : undefined
      })(),
      date:
        typeof review.relativePublishTimeDescription === "string"
          ? review.relativePublishTimeDescription
          : undefined,
      author:
        (() => {
          const authorObj = review.authorAttribution as { displayName?: unknown } | undefined
          return typeof authorObj?.displayName === "string" ? authorObj.displayName : undefined
        })(),
    }))
    .filter((review) => review.text)
    .slice(0, 6)
}

function getNumber(value: unknown) {
  return typeof value === "number" ? value : null
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null
}

function getHoursRecord(value: unknown) {
  if (!value || typeof value !== "object") return null
  const entries = Object.entries(value as Record<string, unknown>)
  const record: Record<string, string> = {}
  for (const [key, val] of entries) {
    if (typeof val === "string") {
      record[key] = val
    }
  }
  return Object.keys(record).length ? record : null
}

function formatPriceLevel(value: string | null | undefined) {
  if (!value) return "not available"
  if (/^\d+$/.test(value)) {
    const count = Number(value)
    return count > 0 ? "$".repeat(Math.min(count, 4)) : "not available"
  }
  return value.replace("PRICE_LEVEL_", "").toLowerCase()
}

function summarizeHours(hours: Record<string, string> | null | undefined) {
  if (!hours) return "hours not available"
  const days = Object.keys(hours).length
  return days > 0 ? `hours listed (${days} days)` : "hours not available"
}

function buildDeterministicSummary(input: {
  location: {
    name?: string
    rating?: number | null
    reviewCount?: number | null
    priceLevel?: string | null
    hours?: Record<string, string> | null
  }
  competitor: {
    name?: string
    rating?: number | null
    reviewCount?: number | null
    priceLevel?: string | null
    hours?: Record<string, string> | null
  }
}) {
  const locationName = input.location.name ?? "Location"
  const competitorName = input.competitor.name ?? "Competitor"
  const locationRating = input.location.rating ?? "not available"
  const locationReviews = input.location.reviewCount ?? "not available"
  const competitorRating = input.competitor.rating ?? "not available"
  const competitorReviews = input.competitor.reviewCount ?? "not available"
  const locationPrice = formatPriceLevel(input.location.priceLevel)
  const competitorPrice = formatPriceLevel(input.competitor.priceLevel)
  const locationHours = summarizeHours(input.location.hours)
  const competitorHours = summarizeHours(input.competitor.hours)

  return `${locationName} has rating ${locationRating} with ${locationReviews} reviews. ${competitorName} has rating ${competitorRating} with ${competitorReviews} reviews. Price level: ${locationPrice} vs ${competitorPrice}. Hours: ${locationHours} vs ${competitorHours}.`
}

function buildDeterministicRecommendations(input: {
  location: { rating?: number | null; reviewCount?: number | null; priceLevel?: string | null }
  competitor: { rating?: number | null; reviewCount?: number | null; priceLevel?: string | null }
}) {
  const recommendations: Array<{ title: string; rationale: string }> = []
  const locationRating = input.location.rating ?? null
  const competitorRating = input.competitor.rating ?? null
  const locationReviews = input.location.reviewCount ?? null
  const competitorReviews = input.competitor.reviewCount ?? null

  if (typeof locationRating === "number" && typeof competitorRating === "number") {
    if (competitorRating - locationRating >= 0.2) {
      recommendations.push({
        title: "Close the rating gap",
        rationale: "Competitor rating is higher; focus on service quality and review responses.",
      })
    }
  }

  if (typeof locationReviews === "number" && typeof competitorReviews === "number") {
    if (competitorReviews - locationReviews >= 50) {
      recommendations.push({
        title: "Increase review volume",
        rationale: "Competitor has more reviews; run a review acquisition campaign.",
      })
    }
  }

  if (!recommendations.length) {
    recommendations.push({
      title: "Maintain consistency",
      rationale: "No major gaps detected; keep monitoring and encourage recent reviews.",
    })
  }

  return recommendations
}

export async function generateInsightsAction(formData: FormData) {
  const user = await requireUser()
  const locationId = String(formData.get("location_id") ?? "")
  if (!locationId) {
    redirect("/insights?error=Missing%20location")
  }

  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) {
    redirect("/insights?error=Organization%20not%20found")
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/insights?error=Only%20admins%20can%20generate%20insights")
  }

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, primary_place_id")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (!location) {
    redirect("/insights?error=Location%20not%20found")
  }

  let locationSnapshot: NormalizedSnapshot | null = null
  try {
    if (location.primary_place_id) {
      const details = await fetchPlaceDetails(location.primary_place_id)
      locationSnapshot = buildSnapshotFromPlaceDetails(details)
    }
  } catch {
    locationSnapshot = null
  }

  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, metadata, is_active")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const approvedCompetitors = competitors ?? []
  if (approvedCompetitors.length === 0) {
    redirect(`/insights?location_id=${locationId}&error=No%20approved%20competitors`)
  }

  const insightsPayload: Array<Record<string, unknown>> = []
  const todayKey = getDateKey()

  for (const competitor of approvedCompetitors) {
    const { data: currentSnapshot } = await supabase
      .from("snapshots")
      .select("raw_data, date_key")
      .eq("competitor_id", competitor.id)
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()

    const metadata = competitor.metadata as Record<string, unknown> | null
    const placeDetails = metadata?.placeDetails as Record<string, unknown> | null
    const reviewSnippets = clampReviews(
      (placeDetails?.reviews as Array<Record<string, unknown>> | null | undefined) ?? []
    )

    if (!currentSnapshot) {
      insightsPayload.push({
        location_id: locationId,
        competitor_id: competitor.id,
        date_key: todayKey,
        insight_type: "baseline_snapshot",
        title: `Baseline snapshot captured for ${competitor.name ?? "competitor"}`,
        summary:
          "This is the first snapshot for this competitor. Future runs will compare against this baseline.",
        confidence: "low",
        severity: "info",
        evidence: {
          field: "baseline",
          date_key: todayKey,
          competitor: {
            name: competitor.name ?? null,
            rating: placeDetails?.rating ?? null,
            reviewCount: placeDetails?.reviewCount ?? null,
          },
        },
        recommendations: [],
        status: "new",
      })

      if (locationSnapshot || reviewSnippets.length) {
        try {
          const promptInput = {
            location: {
              name: location.name ?? undefined,
              rating: locationSnapshot?.profile?.rating ?? null,
              reviewCount: locationSnapshot?.profile?.reviewCount ?? null,
              priceLevel: locationSnapshot?.profile?.priceLevel ?? null,
              hours: locationSnapshot?.hours ?? null,
            },
            competitor: {
              name: competitor.name ?? undefined,
              rating: getNumber(placeDetails?.rating),
              reviewCount: getNumber(placeDetails?.reviewCount),
              priceLevel: getString(placeDetails?.priceLevel),
              hours: getHoursRecord(placeDetails?.regularOpeningHours),
            },
            deltas: {
              ratingDelta: null,
              reviewCountDelta: null,
              hoursChanged: null,
            },
            reviewSnippets,
          }
          const prompt = buildInsightNarrativePrompt(promptInput)

          const llmResponse = (await generateGeminiJson(prompt)) as
            | {
                summary?: string
                recommendations?: Array<{ title?: string; rationale?: string }>
                reviewThemes?: Array<{
                  theme?: string
                  sentiment?: string
                  examples?: string[]
                }>
              }
            | null

          const fallbackSummary = buildDeterministicSummary(promptInput)
          const fallbackRecommendations = buildDeterministicRecommendations(promptInput)
          const summaryText =
            llmResponse?.summary && llmResponse.summary.length > 40
              ? llmResponse.summary
              : fallbackSummary
          const recommendations =
            llmResponse?.recommendations?.length
              ? llmResponse.recommendations
              : fallbackRecommendations

          if (summaryText) {
            insightsPayload.push({
              location_id: locationId,
              competitor_id: competitor.id,
              date_key: todayKey,
              insight_type: "competitive_summary",
              title: `Competitive summary: ${competitor.name ?? "Competitor"}`,
              summary: summaryText,
              confidence: "medium",
              severity: "info",
              evidence: {
                field: "summary",
                location: locationSnapshot?.profile ?? null,
                competitor: placeDetails ?? null,
                llm_model: "gemini-3-pro-preview",
                llm_prompt: prompt,
                llm_input: promptInput,
              },
              recommendations: recommendations.map((rec) => ({
                title: rec.title ?? "Action",
                rationale: rec.rationale ?? "",
              })),
              status: "new",
            })
          }

          if (llmResponse?.reviewThemes?.length) {
            const sentimentCounts = llmResponse.reviewThemes.reduce(
              (acc, theme) => {
                const sentiment = theme.sentiment ?? "mixed"
                if (sentiment === "positive") acc.positive += 1
                else if (sentiment === "negative") acc.negative += 1
                else acc.mixed += 1
                return acc
              },
              { positive: 0, negative: 0, mixed: 0 }
            )
            insightsPayload.push({
              location_id: locationId,
              competitor_id: competitor.id,
              date_key: todayKey,
              insight_type: "review_themes",
              title: `Review themes: ${competitor.name ?? "Competitor"}`,
              summary: "Key themes mentioned in recent reviews.",
              confidence: "medium",
              severity: "info",
              evidence: {
                themes: llmResponse.reviewThemes,
                sampleReviews: reviewSnippets,
                sentimentCounts,
                llm_model: "gemini-3-pro-preview",
                llm_prompt: prompt,
                llm_input: promptInput,
              },
              recommendations: [],
              status: "new",
            })
          }
        } catch {
          // Ignore LLM failures for now.
        }
      }

      continue
    }

    const previousKey = getPreviousDateKey(currentSnapshot.date_key, 1)
    const weeklyKey = getPreviousDateKey(currentSnapshot.date_key, 7)

    const { data: previousSnapshot } = await supabase
      .from("snapshots")
      .select("raw_data")
      .eq("competitor_id", competitor.id)
      .eq("date_key", previousKey)
      .maybeSingle()

    const { data: weeklySnapshot } = await supabase
      .from("snapshots")
      .select("raw_data")
      .eq("competitor_id", competitor.id)
      .eq("date_key", weeklyKey)
      .maybeSingle()

    const diff = diffSnapshots(
      (previousSnapshot?.raw_data as NormalizedSnapshot | null) ?? null,
      currentSnapshot.raw_data as NormalizedSnapshot
    )
    const weeklyDiff = diffSnapshots(
      (weeklySnapshot?.raw_data as NormalizedSnapshot | null) ?? null,
      currentSnapshot.raw_data as NormalizedSnapshot
    )

    const baseInsights = buildInsights(diff)
    const weeklyInsights = buildWeeklyInsights(weeklyDiff)
    const combinedInsights = [...baseInsights, ...weeklyInsights]

    if (!previousSnapshot) {
      insightsPayload.push({
        location_id: locationId,
        competitor_id: competitor.id,
        date_key: currentSnapshot.date_key ?? todayKey,
        insight_type: "baseline_snapshot",
        title: `Baseline snapshot captured for ${competitor.name ?? "competitor"}`,
        summary:
          "This is the first snapshot for this competitor. Future runs will compare against this baseline.",
        confidence: "low",
        severity: "info",
        evidence: {
          field: "baseline",
          date_key: currentSnapshot.date_key ?? todayKey,
        },
        recommendations: [],
        status: "new",
      })
    }

    for (const insight of combinedInsights) {
      insightsPayload.push({
        location_id: locationId,
        competitor_id: competitor.id,
        date_key: currentSnapshot.date_key ?? todayKey,
        ...insight,
        status: "new",
      })
    }

    if (combinedInsights.length === 0 && previousSnapshot) {
      insightsPayload.push({
        location_id: locationId,
        competitor_id: competitor.id,
        date_key: currentSnapshot.date_key ?? todayKey,
        insight_type: "no_significant_change",
        title: `No significant changes for ${competitor.name ?? "competitor"}`,
        summary: "No meaningful changes detected compared to the last snapshot.",
        confidence: "low",
        severity: "info",
        evidence: {
          field: "snapshot",
          date_key: currentSnapshot.date_key ?? todayKey,
        },
        recommendations: [],
        status: "new",
      })
    }

    if (locationSnapshot || reviewSnippets.length) {
      try {
        const promptInput = {
          location: {
            name: location.name ?? undefined,
            rating: locationSnapshot?.profile?.rating ?? null,
            reviewCount: locationSnapshot?.profile?.reviewCount ?? null,
            priceLevel: locationSnapshot?.profile?.priceLevel ?? null,
            hours: locationSnapshot?.hours ?? null,
          },
          competitor: {
            name: competitor.name ?? undefined,
            rating:
              (currentSnapshot.raw_data as NormalizedSnapshot)?.profile?.rating ?? null,
            reviewCount:
              (currentSnapshot.raw_data as NormalizedSnapshot)?.profile?.reviewCount ?? null,
            priceLevel:
              (currentSnapshot.raw_data as NormalizedSnapshot)?.profile?.priceLevel ?? null,
            hours: (currentSnapshot.raw_data as NormalizedSnapshot)?.hours ?? null,
          },
          deltas: {
            ratingDelta: diff.ratingDelta ?? null,
            reviewCountDelta: diff.reviewCountDelta ?? null,
            hoursChanged: diff.hoursChanged ?? null,
          },
          reviewSnippets,
        }
        const prompt = buildInsightNarrativePrompt(promptInput)

        const llmResponse = (await generateGeminiJson(prompt)) as
          | {
              summary?: string
              recommendations?: Array<{ title?: string; rationale?: string }>
              reviewThemes?: Array<{
                theme?: string
                sentiment?: string
                examples?: string[]
              }>
            }
          | null

        const fallbackSummary = buildDeterministicSummary(promptInput)
        const fallbackRecommendations = buildDeterministicRecommendations(promptInput)
        const summaryText =
          llmResponse?.summary && llmResponse.summary.length > 40
            ? llmResponse.summary
            : fallbackSummary
        const recommendations =
          llmResponse?.recommendations?.length ? llmResponse.recommendations : fallbackRecommendations

        if (summaryText) {
          insightsPayload.push({
            location_id: locationId,
            competitor_id: competitor.id,
            date_key: currentSnapshot.date_key ?? todayKey,
            insight_type: "competitive_summary",
            title: `Competitive summary: ${competitor.name ?? "Competitor"}`,
            summary: summaryText,
            confidence: "medium",
            severity: "info",
            evidence: {
              field: "summary",
              location: locationSnapshot?.profile ?? null,
              competitor: (currentSnapshot.raw_data as NormalizedSnapshot)?.profile ?? null,
              llm_model: "gemini-3-pro-preview",
              llm_prompt: prompt,
              llm_input: promptInput,
            },
            recommendations: recommendations.map((rec) => ({
              title: rec.title ?? "Action",
              rationale: rec.rationale ?? "",
            })),
            status: "new",
          })
        }

        if (llmResponse?.reviewThemes?.length) {
          const sentimentCounts = llmResponse.reviewThemes.reduce(
            (acc, theme) => {
              const sentiment = theme.sentiment ?? "mixed"
              if (sentiment === "positive") acc.positive += 1
              else if (sentiment === "negative") acc.negative += 1
              else acc.mixed += 1
              return acc
            },
            { positive: 0, negative: 0, mixed: 0 }
          )
          insightsPayload.push({
            location_id: locationId,
            competitor_id: competitor.id,
            date_key: currentSnapshot.date_key ?? todayKey,
            insight_type: "review_themes",
            title: `Review themes: ${competitor.name ?? "Competitor"}`,
            summary: "Key themes mentioned in recent reviews.",
            confidence: "medium",
            severity: "info",
            evidence: {
              themes: llmResponse.reviewThemes,
              sampleReviews: reviewSnippets,
              sentimentCounts,
              llm_model: "gemini-3-pro-preview",
              llm_prompt: prompt,
              llm_input: promptInput,
            },
            recommendations: [],
            status: "new",
          })
        }
      } catch {
        // Ignore LLM failures for now.
      }
    }
  }

  // =======================================================================
  // Cross-source insight generation
  // Correlate SEO, competitor, and event data for deeper insights
  // =======================================================================
  try {
    // Fetch SEO snapshots for this location
    const { data: seoSnaps } = await supabase
      .from("location_snapshots")
      .select("provider, raw_data")
      .eq("location_id", locationId)
      .in("provider", [
        "seo_domain_rank_overview",
        "seo_backlinks_summary",
        "seo_historical_rank",
        "seo_ranked_keywords",
      ])
      .order("date_key", { ascending: false })
      .limit(4)

    const seoDataMap = new Map<string, Record<string, unknown>>()
    for (const snap of seoSnaps ?? []) {
      if (!seoDataMap.has(snap.provider)) {
        seoDataMap.set(snap.provider, snap.raw_data as Record<string, unknown>)
      }
    }

    const backlinksSummary = seoDataMap.get("seo_backlinks_summary") as { domainTrust?: number; referringDomains?: number; backlinks?: number } | undefined
    const historicalData = ((seoDataMap.get("seo_historical_rank") as Record<string, unknown>)?.history ?? []) as Array<{ date: string; organicEtv: number }>

    // Fetch event data
    const { data: eventSnaps } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "events_google")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()

    const eventsData = eventSnaps?.raw_data as { events?: Array<{ title?: string; date?: string }> } | null

    // Cross-source: Event + SEO Traffic Correlation
    if (eventsData?.events?.length && historicalData.length >= 2) {
      const lastMonth = historicalData[historicalData.length - 1]
      const prevMonth = historicalData[historicalData.length - 2]
      if (lastMonth && prevMonth && lastMonth.organicEtv > prevMonth.organicEtv) {
        const pctGrowth = ((lastMonth.organicEtv - prevMonth.organicEtv) / (prevMonth.organicEtv || 1)) * 100
        if (pctGrowth >= 5) {
          insightsPayload.push({
            location_id: locationId,
            competitor_id: null,
            date_key: todayKey,
            insight_type: "cross_event_seo_opportunity",
            title: `Event-driven traffic opportunity detected`,
            summary: `Organic traffic grew ${Math.round(pctGrowth)}% last month while ${eventsData.events.length} local events are upcoming. Capitalize on event-related search demand by creating timely content.`,
            confidence: "medium",
            severity: "info",
            evidence: {
              traffic_growth_pct: Math.round(pctGrowth),
              upcoming_events: eventsData.events.slice(0, 3).map((e) => e.title),
              last_month_etv: lastMonth.organicEtv,
              prev_month_etv: prevMonth.organicEtv,
            },
            recommendations: [
              {
                title: "Create event-related content",
                rationale: `With ${eventsData.events.length} upcoming events and rising organic traffic, publish landing pages or blog posts about these events to capture search demand.`,
              },
            ],
            status: "new",
          })
        }
      }
    }

    // Cross-source: Backlinks declining + Traffic declining
    if (backlinksSummary && historicalData.length >= 3) {
      const recent3 = historicalData.slice(-3)
      const isTrafficDecline = recent3.every((p, i) => i === 0 || p.organicEtv < recent3[i - 1].organicEtv)

      // Check if we have previous backlinks data to compare
      const { data: prevBlSnap } = await supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", locationId)
        .eq("provider", "seo_backlinks_summary")
        .order("date_key", { ascending: false })
        .range(1, 1)

      const prevBacklinks = prevBlSnap?.[0]?.raw_data as { referringDomains?: number } | null
      const backlinkDecline = prevBacklinks && backlinksSummary.referringDomains
        ? (backlinksSummary.referringDomains < (prevBacklinks.referringDomains ?? 0))
        : false

      if (isTrafficDecline && backlinkDecline) {
        insightsPayload.push({
          location_id: locationId,
          competitor_id: null,
          date_key: todayKey,
          insight_type: "cross_authority_risk",
          title: "Domain authority at risk",
          summary: `Both referring domains and organic traffic have been declining. This compound effect can accelerate ranking losses. Immediate action on link building and content freshness is recommended.`,
          confidence: "high",
          severity: "critical",
          evidence: {
            current_referring_domains: backlinksSummary.referringDomains,
            previous_referring_domains: prevBacklinks?.referringDomains,
            traffic_trend: recent3.map((p) => ({ date: p.date, etv: p.organicEtv })),
          },
          recommendations: [
            {
              title: "Launch a backlink recovery campaign",
              rationale: "Identify and attempt to recover lost backlinks while pursuing new link building opportunities to reverse the domain authority decline.",
            },
            {
              title: "Refresh your highest-traffic content",
              rationale: "Update publication dates, add new information, and improve on-page SEO for your top pages to signal freshness to search engines.",
            },
          ],
          status: "new",
        })
      }
    }

    // Cross-source: Competitor review velocity + keyword growth
    for (const competitor of approvedCompetitors) {
      const compMeta = competitor.metadata as Record<string, unknown> | null
      const compPlaceDetails = compMeta?.placeDetails as Record<string, unknown> | null
      if (!compPlaceDetails) continue

      // Check if competitor has high review growth
      const { data: compSnapPrev } = await supabase
        .from("snapshots")
        .select("raw_data")
        .eq("competitor_id", competitor.id)
        .eq("snapshot_type", "seo_domain_rank_overview_weekly")
        .order("date_key", { ascending: false })
        .limit(2)

      const compSeoSnaps = compSnapPrev ?? []
      if (compSeoSnaps.length >= 2) {
        const curCompSeo = compSeoSnaps[0].raw_data as { organic?: { rankedKeywords?: number } } | null
        const prevCompSeo = compSeoSnaps[1].raw_data as { organic?: { rankedKeywords?: number } } | null
        const curKw = curCompSeo?.organic?.rankedKeywords ?? 0
        const prevKw = prevCompSeo?.organic?.rankedKeywords ?? 0

        if (curKw > prevKw && curKw - prevKw >= 10) {
          const compReviewCount = typeof compPlaceDetails.userRatingCount === "number" ? compPlaceDetails.userRatingCount : 0
          if (compReviewCount >= 50) {
            insightsPayload.push({
              location_id: locationId,
              competitor_id: competitor.id,
              date_key: todayKey,
              insight_type: "cross_competitor_momentum",
              title: `${competitor.name ?? "Competitor"} is gaining ground on multiple fronts`,
              summary: `${competitor.name ?? "This competitor"} gained ${curKw - prevKw} organic keywords and has ${compReviewCount} reviews. Their combined SEO and review velocity suggests growing market presence.`,
              confidence: "high",
              severity: "warning",
              evidence: {
                competitor_name: competitor.name,
                keyword_gain: curKw - prevKw,
                current_keywords: curKw,
                review_count: compReviewCount,
              },
              recommendations: [
                {
                  title: `Counter ${competitor.name ?? "competitor"}'s momentum`,
                  rationale: "Focus on both content/SEO growth and review acquisition to prevent this competitor from widening their competitive advantage.",
                },
              ],
              status: "new",
            })
          }
        }
      }
    }
  } catch (crossErr) {
    console.warn("Cross-source insight generation error:", crossErr)
    // Non-fatal: continue with whatever insights we have
  }

  // =======================================================================
  // Enriched Competitor SEO Insights (uses competitor-level snapshot data)
  // =======================================================================
  try {
    // Read location domain from the location's website or seo snapshot
    const { data: locObj } = await supabase
      .from("locations")
      .select("website")
      .eq("id", locationId)
      .maybeSingle()
    const locationWebsite = locObj?.website as string | null
    const locationDomain = locationWebsite
      ? (() => {
          try {
            return new URL(locationWebsite.startsWith("http") ? locationWebsite : `https://${locationWebsite}`).hostname.replace(/^www\./, "")
          } catch { return null }
        })()
      : null

    // Fetch location's latest ranked keywords
    const { data: locKwSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_ranked_keywords")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    const locationKeywords = ((locKwSnap?.raw_data as Record<string, unknown>)?.keywords ?? []) as NormalizedRankedKeyword[]

    // Fetch location's rank overview (current and previous)
    const { data: locRankSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_domain_rank_overview")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    const currentRank = locRankSnap?.raw_data as DomainRankSnapshot | null

    // Fetch location's relevant pages
    const { data: locPagesSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_relevant_pages")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    const currentPages = ((locPagesSnap?.raw_data as Record<string, unknown>)?.pages ?? []) as NormalizedRelevantPage[]

    // Fetch location's historical rank
    const { data: locHistSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_historical_rank")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    const historicalTraffic = ((locHistSnap?.raw_data as Record<string, unknown>)?.history ?? []) as HistoricalTrafficPoint[]

    // Fetch location's SERP entries
    const { data: locSerpSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_serp_keywords")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    const serpEntries = ((locSerpSnap?.raw_data as Record<string, unknown>)?.entries ?? []) as SerpRankEntry[]

    // Fetch location's ads
    const { data: locAdsSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_ads_search")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    const adCreatives = ((locAdsSnap?.raw_data as Record<string, unknown>)?.creatives ?? []) as NormalizedAdCreative[]

    // Build competitor data maps
    const competitorRankedKeywords = new Map<string, NormalizedRankedKeyword[]>()
    const competitorRelevantPages = new Map<string, NormalizedRelevantPage[]>()
    const competitorHistoricalTraffic = new Map<string, HistoricalTrafficPoint[]>()
    const allIntersectionRows: NormalizedIntersectionRow[] = []

    for (const comp of approvedCompetitors) {
      // Competitor Ranked Keywords
      try {
        const { data: compKwSnap } = await supabase
          .from("snapshots")
          .select("raw_data")
          .eq("competitor_id", comp.id)
          .eq("snapshot_type", SEO_SNAPSHOT_TYPES.rankedKeywords)
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (compKwSnap) {
          const keywords = ((compKwSnap.raw_data as Record<string, unknown>)?.keywords ?? []) as NormalizedRankedKeyword[]
          if (keywords.length > 0) {
            competitorRankedKeywords.set(comp.id, keywords)
          }
        }
      } catch { /* ignore */ }

      // Competitor Relevant Pages
      try {
        const { data: compPagesSnap } = await supabase
          .from("snapshots")
          .select("raw_data")
          .eq("competitor_id", comp.id)
          .eq("snapshot_type", SEO_SNAPSHOT_TYPES.relevantPages)
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (compPagesSnap) {
          const pages = ((compPagesSnap.raw_data as Record<string, unknown>)?.pages ?? []) as NormalizedRelevantPage[]
          if (pages.length > 0) {
            competitorRelevantPages.set(comp.id, pages)
          }
        }
      } catch { /* ignore */ }

      // Competitor Historical Rank
      try {
        const { data: compHistSnap } = await supabase
          .from("snapshots")
          .select("raw_data")
          .eq("competitor_id", comp.id)
          .eq("snapshot_type", SEO_SNAPSHOT_TYPES.historicalRank)
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (compHistSnap) {
          const history = ((compHistSnap.raw_data as Record<string, unknown>)?.history ?? []) as HistoricalTrafficPoint[]
          if (history.length > 0) {
            competitorHistoricalTraffic.set(comp.id, history)
          }
        }
      } catch { /* ignore */ }

      // Competitor Domain Intersection
      try {
        const { data: compDiSnap } = await supabase
          .from("snapshots")
          .select("raw_data")
          .eq("competitor_id", comp.id)
          .eq("snapshot_type", SEO_SNAPSHOT_TYPES.domainIntersection)
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (compDiSnap) {
          const rows = ((compDiSnap.raw_data as Record<string, unknown>)?.rows ?? []) as NormalizedIntersectionRow[]
          allIntersectionRows.push(...rows)
        }
      } catch { /* ignore */ }
    }

    // Build context for SEO insight generator
    const compMetas = approvedCompetitors.map((c) => {
      const meta = c.metadata as Record<string, unknown> | null
      const pd = meta?.placeDetails as Record<string, unknown> | null
      const compWeb = (meta?.website as string) ?? (pd?.websiteUri as string) ?? null
      let compDomain: string | null = null
      if (compWeb) {
        try {
          compDomain = new URL(compWeb.startsWith("http") ? compWeb : `https://${compWeb}`).hostname.replace(/^www\./, "")
        } catch { /* ignore */ }
      }
      return { id: c.id, name: c.name ?? null, domain: compDomain }
    })

    const seoInsightContext: SeoInsightContext = {
      locationName: location.name ?? "Your location",
      locationDomain,
      competitors: compMetas,
    }

    const seoInsights = generateSeoInsights({
      currentRank,
      previousRank: null, // Previous rank would require another query; skip for now
      currentKeywords: locationKeywords,
      previousKeywords: [], // Skip previous comparison in this pass
      serpEntries,
      previousSerpEntries: [],
      intersectionRows: allIntersectionRows,
      previousIntersectionRows: [],
      adCreatives,
      previousAdCreatives: [],
      currentPages,
      previousPages: [],
      historicalTraffic,
      competitorRankedKeywords,
      competitorRelevantPages,
      competitorHistoricalTraffic,
      context: seoInsightContext,
    })

    for (const insight of seoInsights) {
      insightsPayload.push({
        location_id: locationId,
        competitor_id: insight.evidence?.competitor_id
          ? String(insight.evidence.competitor_id)
          : null,
        date_key: todayKey,
        ...insight,
        status: "new",
      })
    }

    console.log(`[Insights] Generated ${seoInsights.length} enriched SEO insights from competitor data`)
  } catch (seoEnrichedErr) {
    console.warn("Enriched competitor SEO insight generation error:", seoEnrichedErr)
  }

  // =======================================================================
  // Content & Menu insight pipeline
  // =======================================================================
  try {
    // Fetch location menu + site content snapshots
    const { data: locMenuSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "firecrawl_menu")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: locSiteSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "firecrawl_site_content")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()

    const locMenu = locMenuSnap?.raw_data as MenuSnapshot | null
    const locSiteContent = locSiteSnap?.raw_data as SiteContentSnapshot | null

    if (locMenu || locSiteContent) {
      // Fetch previous menu for change detection
      const { data: prevMenuSnaps } = await supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", locationId)
        .eq("provider", "firecrawl_menu")
        .order("date_key", { ascending: false })
        .range(1, 1)

      const previousMenu = prevMenuSnaps?.[0]?.raw_data as MenuSnapshot | null

      // Fetch competitor menu snapshots
      type CompMenuForInsights = {
        competitorId: string
        competitorName: string
        menu: MenuSnapshot
        siteContent?: SiteContentSnapshot | null
      }
      const compMenusForInsights: CompMenuForInsights[] = []

      for (const comp of approvedCompetitors) {
        const { data: compMenuSnap } = await supabase
          .from("snapshots")
          .select("raw_data")
          .eq("competitor_id", comp.id)
          .eq("snapshot_type", "web_menu_weekly")
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (compMenuSnap) {
          compMenusForInsights.push({
            competitorId: comp.id,
            competitorName: comp.name ?? "Competitor",
            menu: compMenuSnap.raw_data as MenuSnapshot,
            siteContent: null,
          })
        }
      }

      const contentInsights = generateContentInsights(
        locMenu,
        compMenusForInsights,
        locSiteContent,
        previousMenu
      )

      for (const insight of contentInsights) {
        const evidence = insight.evidence as Record<string, unknown>
        const compName = evidence?.competitor as string | undefined
        let matchedCompId: string | null = null
        if (compName) {
          const match = compMenusForInsights.find((c) => c.competitorName === compName)
          if (match) matchedCompId = match.competitorId
        }

        insightsPayload.push({
          location_id: locationId,
          competitor_id: matchedCompId,
          date_key: todayKey,
          ...insight,
          status: "new",
        })
      }
    }
  } catch (contentErr) {
    console.warn("Content & Menu insight generation error:", contentErr)
  }

  if (insightsPayload.length) {
    const { error } = await supabase.from("insights").upsert(insightsPayload, {
      onConflict: "location_id,competitor_id,date_key,insight_type",
    })
    if (error) {
      redirect(`/insights?location_id=${locationId}&error=${encodeURIComponent(error.message)}`)
    }
  }

  redirect(`/insights?location_id=${locationId}`)
}

// Note: dismissInsightAction is now defined at the top of this file with
// proper feedback recording and search param preservation.
