// ---------------------------------------------------------------------------
// Content & Menu – deterministic insight rules
// 8 rules: 7 original + catering pricing gap
// ---------------------------------------------------------------------------

import type { GeneratedInsight } from "@/lib/insights/types"
import type { ReviewSentiment } from "@/lib/insights/dossier/types"
import type { MenuSnapshot, SiteContentSnapshot, MenuCategory, MenuType } from "./types"

type CompetitorMenu = {
  competitorId: string
  competitorName: string
  menu: MenuSnapshot
  siteContent?: SiteContentSnapshot | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterByMenuType(categories: MenuCategory[], menuType: MenuType): MenuCategory[] {
  return categories.filter((c) => (c.menuType ?? "dine_in") === menuType)
}

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

// A price/value TOPIC in a theme LABEL (gated by negative sentiment below) — so we never tell
// a premium spot to chase a cheaper rival on a lone competitor-is-cheaper signal (the Wagyu miss).
const PRICE_THEME = /\b(price|prices|pricing|pricey|pricy|expensive|overpriced|costly|costs?|value|worth)\b/i
// Inherently NEGATIVE price language — used to read example QUOTES, whose tone we cannot infer
// from the parent theme's sentiment. "great value" / "worth every penny" deliberately do NOT match.
const PRICE_COMPLAINT = /\b(overpriced|expensive|pricey|pricy|too\s+(?:much|expensive|pricey|steep)|not\s+worth|overcharged|rip[\s-]?off|ripoff|gouging|spendy)\b/i

/**
 * True when the location's OWN reviews corroborate a price complaint. Two ways to count:
 *  - a price/value THEME tagged negative (a clear "guests dislike our pricing" signal), or
 *  - an inherently-negative price phrase in an example QUOTE (overpriced/too much/not worth…).
 * Positive praise ("great value", "worth every penny") never counts; a merely "mixed" theme
 * needs a real negative quote, not just a price-word label. No reviews = no corroboration.
 */
export function canCorroboratePrice(reviews: ReviewSentiment | null | undefined): boolean {
  if (!reviews?.themes?.length) return false
  return reviews.themes.some((t) => {
    if (t.sentiment === "positive") return false // praise is the opposite of a price complaint
    const negativePriceTheme = t.sentiment === "negative" && PRICE_THEME.test(t.theme)
    const exampleComplains = t.examples.some((e) => PRICE_COMPLAINT.test(e))
    return negativePriceTheme || exampleComplains
  })
}

/**
 * P4 / P4.1 — corroborate "you look expensive" price plays against the location's OWN reviews.
 * Runs at WRITE time in the insights pipeline (so the persisted rows every surface reads — the
 * brief, the /insights Feed, /social — are already corrected) AND at READ time in build.ts (a
 * brief-time safety net for before the pipeline has re-run).
 *
 * For each menu.price_positioning_shift where WE are the more expensive one (competitor avg <
 * ours) the final framing is derived from the corroboration verdict + the evidence ALONE — never
 * the row's current text — so it is IDEMPOTENT: safe to re-run on a row a previous pass already
 * reframed. The insight_type NEVER changes (one price type avoids two coexisting in the 30-day
 * retention window); the verdict rides on evidence.corroboration for the positioning skill +
 * future scoring (P2/P10):
 *  - reviews corroborate a price complaint   → price-action framing, "strong"
 *  - reviews present but quiet on price       → positioning framing,  "weak"
 *  - no reviews yet (absence ≠ evidence)      → positioning framing,  "unknown" (don't claim happy)
 * The "we're cheaper, room to raise" direction is left exactly as the rule emitted it.
 */
export function corroboratePriceInsights(
  insights: GeneratedInsight[],
  locationReviews: ReviewSentiment | null,
): GeneratedInsight[] {
  const hasReviews = (locationReviews?.themes?.length ?? 0) > 0
  const corroborated = canCorroboratePrice(locationReviews)
  return insights.map((ins) => {
    if (ins.insight_type !== "menu.price_positioning_shift") return ins
    const ev = ins.evidence as Record<string, unknown>
    // isFinite rejects null/undefined AND NaN, so a garbage avg can't slip through and render
    // "$NaN" in customer copy. Past the guard both avgs are real finite numbers.
    const locAvg = Number.isFinite(ev.locationAvgPrice) ? (ev.locationAvgPrice as number) : null
    const compAvg = Number.isFinite(ev.competitorAvgPrice) ? (ev.competitorAvgPrice as number) : null
    // Only the "we're the more expensive one" direction needs corroboration; "room to raise"
    // (we're cheaper, or missing data) is left untouched.
    if (locAvg == null || compAvg == null || compAvg >= locAvg) return ins

    const pct = Number.isFinite(ev.priceDiffPct) ? (ev.priceDiffPct as number) : null
    const comp = typeof ev.competitor === "string" ? ev.competitor : "a nearby competitor"
    const by = pct != null ? ` by ${pct}%` : ""
    const above = `Your average dine-in price ($${locAvg.toFixed(2)}) sits above ${comp}'s ($${compAvg.toFixed(2)})${by}`

    if (corroborated) {
      return {
        ...ins,
        title: `You price above ${comp}, and guests are flagging it`,
        summary: `${above}, and your reviews mention price. Worth a deliberate look — check whether specific items are out of line, not the whole menu.`,
        confidence: "high",
        severity: pct != null && pct >= 30 ? "warning" : "info",
        evidence: { ...ev, corroboration: "strong" },
        recommendations: [
          {
            title: "Check pricing against real feedback",
            rationale: `${comp} is${pct != null ? ` ${pct}%` : ""} cheaper and your guests mention price. Review specific high-visibility items, not the whole menu.`,
          },
        ],
      }
    }

    // Uncorroborated → positioning, never a reflexive cut. reviews PRESENT but quiet = a real
    // "guests aren't price-sensitive" signal; reviews ABSENT = we don't know yet (don't over-claim).
    const title = hasReviews
      ? `You price above ${comp}, and guests aren't complaining`
      : `You price above ${comp} — position on value`
    const summary = hasReviews
      ? `${above}, but your reviews do not flag price as a problem. Compete on what makes you worth it (quality, sourcing, the room, service) instead of chasing their number. To pull price-shoppers, test one loss-leader, not an across-the-board cut.`
      : `${above}. You do not have enough reviews yet to know whether guests find that a problem, so do not cut prices on the gap alone — make the premium legible (quality, sourcing, the room, service). Revisit if price complaints start to appear.`
    return {
      ...ins,
      title,
      summary,
      confidence: "medium",
      severity: "info",
      evidence: { ...ev, corroboration: hasReviews ? "weak" : "unknown" },
      recommendations: [
        {
          title: "Lead with your value, not a lower price",
          rationale: hasReviews
            ? `${comp} is cheaper, but nothing in your reviews says guests find you overpriced. Make the premium obvious before touching price.`
            : `${comp} is cheaper, but you have no review signal that guests find you overpriced. Make the premium obvious; revisit price only if complaints appear.`,
        },
      ],
    }
  })
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

  // Use dine-in categories only for price/category/item comparisons
  const locDineIn = locationMenu ? filterByMenuType(locationMenu.categories, "dine_in") : []
  const locCatering = locationMenu ? filterByMenuType(locationMenu.categories, "catering") : []

  // -----------------------------------------------------------------------
  // 1. menu.price_positioning_shift (dine-in only)
  // -----------------------------------------------------------------------
  if (locDineIn.length > 0) {
    const locAvg = avgPrice(locDineIn)
    for (const comp of competitorMenus) {
      const compDineIn = filterByMenuType(comp.menu.categories, "dine_in")
      if (compDineIn.length === 0) continue
      const compAvg = avgPrice(compDineIn)
      if (locAvg == null || compAvg == null) continue
      const diff = compAvg - locAvg
      const pctDiff = Math.abs(diff) / locAvg

      if (pctDiff >= 0.15) {
        insights.push({
          insight_type: "menu.price_positioning_shift",
          title: diff > 0
            ? `${comp.competitorName} dine-in prices are ${Math.round(pctDiff * 100)}% higher`
            : `${comp.competitorName} dine-in prices are ${Math.round(pctDiff * 100)}% lower`,
          summary: `Your average dine-in price ($${locAvg.toFixed(2)}) ${diff > 0 ? "is lower than" : "exceeds"} ${comp.competitorName}'s ($${compAvg.toFixed(2)}). ${diff > 0 ? "You may have room to increase prices." : "Consider whether your pricing remains competitive."}`,
          confidence: "high",
          severity: Math.abs(pctDiff) >= 0.3 ? "warning" : "info",
          evidence: {
            locationAvgPrice: locAvg,
            competitorAvgPrice: compAvg,
            priceDiffPct: Math.round(pctDiff * 100),
            competitor: comp.competitorName,
            menuType: "dine_in",
          },
          recommendations: [
            {
              title: diff > 0 ? "Evaluate a price increase" : "Review your pricing strategy",
              rationale: diff > 0
                ? `${comp.competitorName} charges ${Math.round(pctDiff * 100)}% more for dine-in. Test raising prices on high-margin items.`
                : `${comp.competitorName} is ${Math.round(pctDiff * 100)}% cheaper for dine-in. Ensure your value proposition justifies the premium.`,
            },
          ],
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // 2. menu.category_gap (dine-in only)
  // -----------------------------------------------------------------------
  if (locDineIn.length > 0) {
    const locCats = categoryNames(locDineIn)
    for (const comp of competitorMenus) {
      const compDineIn = filterByMenuType(comp.menu.categories, "dine_in")
      if (compDineIn.length === 0) continue
      const compCats = categoryNames(compDineIn)
      const missing = [...compCats].filter((c) => !locCats.has(c))
      if (missing.length > 0) {
        insights.push({
          insight_type: "menu.category_gap",
          title: `${comp.competitorName} offers dine-in categories you don't`,
          summary: `${comp.competitorName} has dine-in menu categories that you lack: ${missing.join(", ")}. Consider whether adding similar offerings could attract more customers.`,
          confidence: "medium",
          severity: "info",
          evidence: {
            missingCategories: missing,
            competitor: comp.competitorName,
            locationCategories: [...locCats],
            menuType: "dine_in",
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
  // 3. menu.signature_item_missing (dine-in only)
  // -----------------------------------------------------------------------
  if (locDineIn.length > 0) {
    const locItems = allItemNames(locDineIn)
    for (const comp of competitorMenus) {
      const compDineIn = filterByMenuType(comp.menu.categories, "dine_in")
      if (compDineIn.length === 0) continue
      const compItems = allItemNames(compDineIn)
      const unique = [...compItems].filter((i) => !locItems.has(i))
      if (unique.length >= 3) {
        insights.push({
          insight_type: "menu.signature_item_missing",
          title: `${comp.competitorName} offers ${unique.length} dine-in items you don't`,
          summary: `${comp.competitorName} has ${unique.length} dine-in menu items not on your menu. Examples: ${unique.slice(0, 5).join(", ")}.`,
          confidence: "medium",
          severity: "info",
          evidence: {
            uniqueItems: unique.slice(0, 10),
            competitor: comp.competitorName,
            totalUniqueCount: unique.length,
            menuType: "dine_in",
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
        break
      }
    }
  }

  // -----------------------------------------------------------------------
  // 5. menu.menu_change_detected
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

  // -----------------------------------------------------------------------
  // 8. menu.catering_pricing_gap (catering menus only)
  // Compare catering prices between location and competitors
  // -----------------------------------------------------------------------
  if (locCatering.length > 0) {
    const locCatAvg = avgPrice(locCatering)
    for (const comp of competitorMenus) {
      const compCatering = filterByMenuType(comp.menu.categories, "catering")
      if (compCatering.length === 0) continue
      const compCatAvg = avgPrice(compCatering)
      if (locCatAvg == null || compCatAvg == null) continue
      const diff = compCatAvg - locCatAvg
      const pctDiff = Math.abs(diff) / locCatAvg

      if (pctDiff >= 0.10) {
        insights.push({
          insight_type: "menu.catering_pricing_gap",
          title: diff > 0
            ? `${comp.competitorName} catering prices are ${Math.round(pctDiff * 100)}% higher`
            : `${comp.competitorName} catering prices are ${Math.round(pctDiff * 100)}% lower`,
          summary: `Your average catering price ($${locCatAvg.toFixed(2)}) ${diff > 0 ? "is lower than" : "exceeds"} ${comp.competitorName}'s ($${compCatAvg.toFixed(2)}). Catering margins are typically high — pricing accurately matters.`,
          confidence: "high",
          severity: Math.abs(pctDiff) >= 0.25 ? "warning" : "info",
          evidence: {
            locationCateringAvgPrice: locCatAvg,
            competitorCateringAvgPrice: compCatAvg,
            priceDiffPct: Math.round(pctDiff * 100),
            competitor: comp.competitorName,
            menuType: "catering",
          },
          recommendations: [
            {
              title: diff > 0 ? "Review catering price opportunity" : "Audit catering pricing competitiveness",
              rationale: diff > 0
                ? `${comp.competitorName} charges ${Math.round(pctDiff * 100)}% more for catering. You may be leaving revenue on the table.`
                : `${comp.competitorName} undercuts your catering prices by ${Math.round(pctDiff * 100)}%. Evaluate your catering value proposition.`,
            },
          ],
        })
      }
    }
  }

  return insights
}
