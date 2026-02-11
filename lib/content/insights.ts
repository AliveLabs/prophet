// ---------------------------------------------------------------------------
// Content & Menu – deterministic insight rules
// 7 rules per PRD section 7
// ---------------------------------------------------------------------------

import type { GeneratedInsight } from "@/lib/insights/types"
import type { MenuSnapshot, SiteContentSnapshot, MenuCategory } from "./types"

type CompetitorMenu = {
  competitorId: string
  competitorName: string
  menu: MenuSnapshot
  siteContent?: SiteContentSnapshot | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avgPrice(categories: MenuCategory[]): number | null {
  const prices: number[] = []
  for (const cat of categories) {
    for (const item of cat.items) {
      if (item.priceValue != null && item.priceValue > 0) {
        prices.push(item.priceValue)
      }
    }
  }
  if (prices.length === 0) return null
  return prices.reduce((a, b) => a + b, 0) / prices.length
}

function categoryNames(categories: MenuCategory[]): Set<string> {
  return new Set(categories.map((c) => c.name.toLowerCase().trim()))
}

function allItemNames(categories: MenuCategory[]): Set<string> {
  const names = new Set<string>()
  for (const cat of categories) {
    for (const item of cat.items) {
      names.add(item.name.toLowerCase().trim())
    }
  }
  return names
}

const PROMO_KEYWORDS = [
  "happy hour",
  "weekday special",
  "kids eat free",
  "early bird",
  "lunch special",
  "brunch special",
  "prix fixe",
  "tasting menu",
  "all you can eat",
  "bottomless",
  "free dessert",
  "free appetizer",
]

// ---------------------------------------------------------------------------
// Main insight generator
// ---------------------------------------------------------------------------

export function generateContentInsights(
  locationMenu: MenuSnapshot | null,
  competitorMenus: CompetitorMenu[],
  locationSiteContent: SiteContentSnapshot | null,
  previousLocationMenu: MenuSnapshot | null
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  // -----------------------------------------------------------------------
  // 1. menu.price_positioning_shift
  // Compare location avg entree price vs competitor avg
  // -----------------------------------------------------------------------
  if (locationMenu && locationMenu.categories.length > 0) {
    const locAvg = avgPrice(locationMenu.categories)
    for (const comp of competitorMenus) {
      if (comp.menu.categories.length === 0) continue
      const compAvg = avgPrice(comp.menu.categories)
      if (locAvg == null || compAvg == null) continue
      const diff = compAvg - locAvg
      const pctDiff = Math.abs(diff) / locAvg

      if (pctDiff >= 0.15) {
        insights.push({
          insight_type: "menu.price_positioning_shift",
          title: diff > 0
            ? `${comp.competitorName} prices are ${Math.round(pctDiff * 100)}% higher`
            : `${comp.competitorName} prices are ${Math.round(pctDiff * 100)}% lower`,
          summary: `Your average menu price ($${locAvg.toFixed(2)}) ${diff > 0 ? "is lower than" : "exceeds"} ${comp.competitorName}'s ($${compAvg.toFixed(2)}). ${diff > 0 ? "You may have room to increase prices." : "Consider whether your pricing remains competitive."}`,
          confidence: "high",
          severity: Math.abs(pctDiff) >= 0.3 ? "warning" : "info",
          evidence: {
            locationAvgPrice: locAvg,
            competitorAvgPrice: compAvg,
            priceDiffPct: Math.round(pctDiff * 100),
            competitor: comp.competitorName,
          },
          recommendations: [
            {
              title: diff > 0 ? "Evaluate a price increase" : "Review your pricing strategy",
              rationale: diff > 0
                ? `${comp.competitorName} charges ${Math.round(pctDiff * 100)}% more. Test raising prices on high-margin items.`
                : `${comp.competitorName} is ${Math.round(pctDiff * 100)}% cheaper. Ensure your value proposition justifies the premium.`,
            },
          ],
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // 2. menu.category_gap
  // Competitor has a category the location doesn't
  // -----------------------------------------------------------------------
  if (locationMenu && locationMenu.categories.length > 0) {
    const locCats = categoryNames(locationMenu.categories)
    for (const comp of competitorMenus) {
      if (comp.menu.categories.length === 0) continue
      const compCats = categoryNames(comp.menu.categories)
      const missing = [...compCats].filter((c) => !locCats.has(c))
      if (missing.length > 0) {
        insights.push({
          insight_type: "menu.category_gap",
          title: `${comp.competitorName} offers categories you don't`,
          summary: `${comp.competitorName} has menu categories that you lack: ${missing.join(", ")}. Consider whether adding similar offerings could attract more customers.`,
          confidence: "medium",
          severity: "info",
          evidence: {
            missingCategories: missing,
            competitor: comp.competitorName,
            locationCategories: [...locCats],
          },
          recommendations: [
            {
              title: `Consider adding ${missing.slice(0, 2).join(" or ")}`,
              rationale: "Competitor menu analysis shows demand for these categories in your market.",
            },
          ],
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // 3. menu.signature_item_missing
  // Competitor has items (popular keywords) that location lacks
  // -----------------------------------------------------------------------
  if (locationMenu && locationMenu.categories.length > 0) {
    const locItems = allItemNames(locationMenu.categories)
    for (const comp of competitorMenus) {
      if (comp.menu.categories.length === 0) continue
      const compItems = allItemNames(comp.menu.categories)
      const unique = [...compItems].filter((i) => !locItems.has(i))
      if (unique.length >= 3) {
        insights.push({
          insight_type: "menu.signature_item_missing",
          title: `${comp.competitorName} offers ${unique.length} items you don't`,
          summary: `${comp.competitorName} has ${unique.length} menu items not on your menu. Examples: ${unique.slice(0, 5).join(", ")}.`,
          confidence: "medium",
          severity: "info",
          evidence: {
            uniqueItems: unique.slice(0, 10),
            competitor: comp.competitorName,
            totalUniqueCount: unique.length,
          },
          recommendations: [
            {
              title: "Explore adding popular competitor items",
              rationale: `Review whether items like ${unique.slice(0, 3).join(", ")} could be adapted for your menu.`,
            },
          ],
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. menu.promo_signal_detected
  // Detect promotional keywords in menu text
  // -----------------------------------------------------------------------
  const allText = (locationMenu?.categories ?? [])
    .flatMap((c) =>
      c.items.map((i) => `${i.name} ${i.description ?? ""}`.toLowerCase())
    )
    .join(" ")

  for (const comp of competitorMenus) {
    const compText = comp.menu.categories
      .flatMap((c) => c.items.map((i) => `${i.name} ${i.description ?? ""}`.toLowerCase()))
      .join(" ")

    for (const keyword of PROMO_KEYWORDS) {
      if (compText.includes(keyword) && !allText.includes(keyword)) {
        insights.push({
          insight_type: "menu.promo_signal_detected",
          title: `${comp.competitorName} promotes "${keyword}"`,
          summary: `${comp.competitorName}'s menu features "${keyword}" which isn't on your menu. Promotional offerings like this can drive foot traffic during slower periods.`,
          confidence: "medium",
          severity: "info",
          evidence: {
            keyword,
            competitor: comp.competitorName,
          },
          recommendations: [
            {
              title: `Consider adding a "${keyword}" offering`,
              rationale: `Competitors are leveraging "${keyword}" to attract customers. Evaluate if this fits your business model.`,
            },
          ],
        })
        break // one insight per competitor for promo signals
      }
    }
  }

  // -----------------------------------------------------------------------
  // 5. menu.menu_change_detected
  // Location's menu changed since last snapshot
  // -----------------------------------------------------------------------
  if (locationMenu && previousLocationMenu) {
    const currentItems = locationMenu.parseMeta.itemsTotal
    const previousItems = previousLocationMenu.parseMeta.itemsTotal
    const delta = currentItems - previousItems

    if (Math.abs(delta) >= 3) {
      insights.push({
        insight_type: "menu.menu_change_detected",
        title: delta > 0
          ? `Your menu grew by ${delta} items`
          : `Your menu shrank by ${Math.abs(delta)} items`,
        summary: `Your menu changed from ${previousItems} to ${currentItems} items. ${delta > 0 ? "New additions detected." : "Some items appear to have been removed."}`,
        confidence: "high",
        severity: "info",
        evidence: {
          previousItemCount: previousItems,
          currentItemCount: currentItems,
          delta,
        },
        recommendations: [
          {
            title: "Update your online presence",
            rationale: "Ensure your Google Business Profile, website, and delivery platform menus all reflect the latest changes.",
          },
        ],
      })
    }
  }

  // -----------------------------------------------------------------------
  // 6. content.conversion_feature_gap
  // Competitor has website features (reservations, ordering) that location lacks
  // -----------------------------------------------------------------------
  if (locationSiteContent) {
    const locFeatures = locationSiteContent.detected
    for (const comp of competitorMenus) {
      if (!comp.siteContent) continue
      const compFeatures = comp.siteContent.detected
      const gaps: string[] = []

      if (compFeatures.reservation && !locFeatures.reservation) gaps.push("online reservations")
      if (compFeatures.onlineOrdering && !locFeatures.onlineOrdering) gaps.push("online ordering")
      if (compFeatures.privateDining && !locFeatures.privateDining) gaps.push("private dining page")
      if (compFeatures.catering && !locFeatures.catering) gaps.push("catering services")

      if (gaps.length > 0) {
        insights.push({
          insight_type: "content.conversion_feature_gap",
          title: `${comp.competitorName} offers ${gaps.join(", ")} on their website`,
          summary: `${comp.competitorName}'s website includes ${gaps.join(", ")} which your site lacks. These features can convert visitors into customers.`,
          confidence: "high",
          severity: gaps.length >= 2 ? "warning" : "info",
          evidence: {
            missingFeatures: gaps,
            competitor: comp.competitorName,
            locationFeatures: locFeatures,
            competitorFeatures: compFeatures,
          },
          recommendations: gaps.map((gap) => ({
            title: `Add ${gap} to your website`,
            rationale: `${comp.competitorName} offers ${gap}. Adding this could improve your conversion rate.`,
          })),
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // 7. content.delivery_platform_gap
  // Competitor on delivery platforms location isn't
  // -----------------------------------------------------------------------
  if (locationSiteContent) {
    const locPlatforms = new Set(locationSiteContent.detected.deliveryPlatforms)
    for (const comp of competitorMenus) {
      if (!comp.siteContent) continue
      const compPlatforms = comp.siteContent.detected.deliveryPlatforms
      const missing = compPlatforms.filter((p) => !locPlatforms.has(p))

      if (missing.length > 0) {
        insights.push({
          insight_type: "content.delivery_platform_gap",
          title: `${comp.competitorName} is on ${missing.join(", ")}`,
          summary: `${comp.competitorName} is listed on delivery platforms (${missing.join(", ")}) where you're not present. This could mean lost delivery revenue.`,
          confidence: "medium",
          severity: "info",
          evidence: {
            missingPlatforms: missing,
            competitor: comp.competitorName,
            locationPlatforms: [...locPlatforms],
          },
          recommendations: [
            {
              title: `Consider joining ${missing.slice(0, 2).join(" and ")}`,
              rationale: `Competitors are capturing delivery orders on these platforms. Evaluate the commission structure and potential revenue.`,
            },
          ],
        })
      }
    }
  }

  return insights
}
