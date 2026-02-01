"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { fetchPlaceDetails } from "@/lib/places/google"
import { diffSnapshots, buildInsights, buildWeeklyInsights } from "@/lib/insights"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import { generateGeminiJson } from "@/lib/ai/gemini"
import { buildInsightNarrativePrompt } from "@/lib/ai/prompts/insights"

export async function markInsightReadAction(formData: FormData) {
  await requireUser()
  const insightId = String(formData.get("insight_id") ?? "")
  if (!insightId) {
    redirect("/insights?error=Missing%20insight")
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("insights")
    .update({ status: "read" })
    .eq("id", insightId)

  if (error) {
    redirect(`/insights?error=${encodeURIComponent(error.message)}`)
  }

  redirect("/insights")
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
      text: typeof review.text?.text === "string" ? review.text.text : undefined,
      date:
        typeof review.relativePublishTimeDescription === "string"
          ? review.relativePublishTimeDescription
          : undefined,
      author:
        typeof review.authorAttribution?.displayName === "string"
          ? review.authorAttribution.displayName
          : undefined,
    }))
    .filter((review) => review.text)
    .slice(0, 6)
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
              rating: placeDetails?.rating ?? null,
              reviewCount: placeDetails?.reviewCount ?? null,
              priceLevel: placeDetails?.priceLevel ?? null,
              hours: placeDetails?.regularOpeningHours ?? null,
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

export async function dismissInsightAction(formData: FormData) {
  await requireUser()
  const insightId = String(formData.get("insight_id") ?? "")
  if (!insightId) {
    redirect("/insights?error=Missing%20insight")
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("insights")
    .update({ status: "dismissed" })
    .eq("id", insightId)

  if (error) {
    redirect(`/insights?error=${encodeURIComponent(error.message)}`)
  }

  redirect("/insights")
}
