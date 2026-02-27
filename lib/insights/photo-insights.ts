import type { GeneratedInsight } from "./types"
import type { PhotoDiffResult, PhotoAnalysis } from "@/lib/providers/photos"

export type PhotoInsightInput = {
  competitorName: string
  competitorId: string
  diff: PhotoDiffResult
  currentPhotos: Array<{ hash: string; analysis: PhotoAnalysis | null }>
}

export function generatePhotoInsights(input: PhotoInsightInput): GeneratedInsight[] {
  const { competitorName, diff, currentPhotos } = input
  const insights: GeneratedInsight[] = []

  if (diff.added.length > 0) {
    const categories = diff.added
      .map(p => p.analysis?.category)
      .filter(Boolean)
    const uniqueCategories = [...new Set(categories)]

    insights.push({
      insight_type: "photo.new_content",
      title: `${competitorName} added ${diff.added.length} new photo${diff.added.length > 1 ? "s" : ""}`,
      summary: `New visual content detected: ${uniqueCategories.join(", ") || "general photos"}. This may indicate menu changes, renovations, or new promotions.`,
      confidence: diff.added.length >= 3 ? "high" : "medium",
      severity: "info",
      evidence: {
        competitor_name: competitorName,
        competitor_id: input.competitorId,
        added_count: diff.added.length,
        categories: uniqueCategories,
      },
      recommendations: [{
        title: "Review competitor's visual messaging",
        rationale: `${competitorName} is investing in new visual content. Consider refreshing your own photos to stay competitive.`,
      }],
    })
  }

  if (diff.removed.length >= 2) {
    insights.push({
      insight_type: "photo.content_removed",
      title: `${competitorName} removed ${diff.removed.length} photos`,
      summary: `Multiple photos were removed, which may indicate menu changes, seasonal updates, or operational shifts.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        competitor_name: competitorName,
        competitor_id: input.competitorId,
        removed_count: diff.removed.length,
      },
      recommendations: [],
    })
  }

  for (const promo of diff.newPromotions) {
    insights.push({
      insight_type: "photo.promotion_detected",
      title: `Promotion detected at ${competitorName}`,
      summary: promo.details || "New promotional content was detected in a photo. Check for specials or limited-time offers.",
      confidence: "medium",
      severity: "warning",
      evidence: {
        competitor_name: competitorName,
        competitor_id: input.competitorId,
        photo_hash: promo.hash,
        promotional_details: promo.details,
      },
      recommendations: [{
        title: "Monitor and consider a counter-promotion",
        rationale: `${competitorName} launched a promotion. Consider whether a competitive response is warranted.`,
      }],
    })
  }

  for (const ocr of diff.ocrChanges) {
    const priceMatch = ocr.text.match(/\$[\d,.]+/)
    if (priceMatch) {
      insights.push({
        insight_type: "photo.price_change",
        title: `Price change detected at ${competitorName}`,
        summary: `Text in a new photo includes pricing: "${ocr.text.slice(0, 100)}". This may indicate menu price updates.`,
        confidence: "high",
        severity: "warning",
        evidence: {
          competitor_name: competitorName,
          competitor_id: input.competitorId,
          extracted_text: ocr.text,
          detected_price: priceMatch[0],
        },
        recommendations: [{
          title: "Compare pricing with your menu",
          rationale: "Pricing changes from a competitor may affect your positioning. Review and adjust if needed.",
        }],
      })
    }
  }

  if (diff.categoryShift) {
    const topShifts = Object.entries(diff.categoryDelta)
      .filter(([, delta]) => Math.abs(delta) >= 0.1)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
      .slice(0, 3)

    if (topShifts.length > 0) {
      const shiftDesc = topShifts
        .map(([cat, delta]) => `${cat} ${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`)
        .join(", ")

      insights.push({
        insight_type: "visual.category_shift",
        title: `${competitorName} changed visual messaging`,
        summary: `Photo category distribution shifted significantly: ${shiftDesc}. This suggests a change in brand positioning or offerings.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor_name: competitorName,
          competitor_id: input.competitorId,
          category_delta: diff.categoryDelta,
        },
        recommendations: [{
          title: "Evaluate your visual brand alignment",
          rationale: "A competitor is shifting their visual messaging. Ensure your photos reflect your current positioning.",
        }],
      })
    }
  }

  const professionalUpgrade = currentPhotos.filter(
    p => p.analysis?.quality_signals.lighting === "professional" && p.analysis?.quality_signals.staging === "styled"
  ).length
  if (professionalUpgrade >= 5 && currentPhotos.length >= 8) {
    insights.push({
      insight_type: "visual.professional_upgrade",
      title: `${competitorName} invested in professional photography`,
      summary: `${professionalUpgrade} of ${currentPhotos.length} photos show professional lighting and styling. This suggests a deliberate brand investment.`,
      confidence: "high",
      severity: "info",
      evidence: {
        competitor_name: competitorName,
        competitor_id: input.competitorId,
        professional_count: professionalUpgrade,
        total_photos: currentPhotos.length,
      },
      recommendations: [{
        title: "Consider upgrading your own photos",
        rationale: "Professional imagery significantly impacts first impressions on Google. Budget for a professional photo shoot.",
      }],
    })
  }

  return insights
}
