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

// Menu-insight gate (ALT-363). Menu claims are built on scraped menus that are often
// partial or unstable run-to-run, so until real acquisition + coverage instrumentation
// land (Layer 2) we (a) keep menu.* insights OFF by default behind an opt-in flag, and
// (b) even when on, suppress claims whose underlying scrape looks untrustworthy. Set
// MENU_INSIGHTS=1 to re-enable — only once menu reads are actually trustworthy.
export function isMenuInsightsEnabled(): boolean {
  return process.env.MENU_INSIGHTS === "1"
}

// A scrape with fewer than this many items can't ground any menu claim. Deliberately low:
// with today's signals we can only catch NEAR-EMPTY scrapes. A confidently-incomplete read
// (a 40-item menu scraped as 11) looks fine to every signal we store and needs crawl-breadth
// instrumentation we don't have yet — that's the Layer 2 work, not this gate.
const MIN_MENU_ITEMS_FOR_CLAIMS = 5
// A run-to-run item-count swing beyond this fraction reads as a scrape artifact, not a real
// menu change — the "your menu shrank by 18 items" false positive. Gates menu_change_detected.
const MENU_STABILITY_MAX_SWING = 0.4

function menuHasCoverage(menu: MenuSnapshot | null): boolean {
  return !!menu && menu.parseMeta.itemsTotal >= MIN_MENU_ITEMS_FOR_CLAIMS
}

function menuCountUnstable(current: MenuSnapshot | null, previous: MenuSnapshot | null): boolean {
  if (!current || !previous) return false
  const a = current.parseMeta.itemsTotal
  const b = previous.parseMeta.itemsTotal
  const base = Math.max(a, b)
  return base > 0 && Math.abs(a - b) / base > MENU_STABILITY_MAX_SWING
}

function filterByMenuType(categories: MenuCategory[], menuType: MenuType): MenuCategory[] {
  return categories.filter((c) => (c.menuType ?? "dine_in") === menuType)
}

// A flat average of EVERY priced item in a menu-type bucket compares apples to oranges
// between a combo-driven concept (few, higher-priced bundled items) and an à la carte
// concept (many cheap standalone sides/drinks/sauces) — the average skews toward
// whichever structure has more cheap line items, not toward who's actually pricier for
// a comparable meal. This excludes items that are clearly NOT a stand-alone meal (drinks,
// sides, sauces/condiments, desserts sold alone) so both sides average closer to "what a
// meal costs," not "every line item on the menu." It's a heuristic, not true item-to-item
// matching — see PRICE_COMPARISON_LIMITATION below.
// Deliberately does NOT match "salad" — entree salads (Chicken Caesar, Cobb, etc.) are a
// common real meal on many dine-in menus; excluding them would hurt comparability, the
// opposite of this fix's goal. Same reasoning for not stripping every generic "side" —
// only the explicit "side(s)" keyword (a menu section/label) and named common sides.
const NON_MEAL_ITEM = /\b(drink|soda|pop|fountain|coke|coca-cola|pepsi|sprite|dr\.?\s*pepper|iced?\s*tea|lemonade|water|bottled|juice|shake|smoothie|coffee|sauce|dip|dressing|ketchup|mustard|mayo(?:nnaise)?|bbq\s*sauce|napkin|utensil|straw|extra|add-?on|sides?|fries|onion\s+rings|slaw|chips|cookie|pie\s+slice)\b/i

/** Priced items in a bucket, filtered to exclude standalone non-meal add-ons (see
 *  NON_MEAL_ITEM). Falls back to the UNFILTERED set if filtering would empty it (a menu
 *  that's genuinely all sides/drinks shouldn't be zeroed out by its own filter). */
export function comparableItems(categories: MenuCategory[]): number[] {
  const all: number[] = []
  const filtered: number[] = []
  for (const cat of categories) {
    for (const item of cat.items) {
      if (item.priceValue == null || item.priceValue <= 0) continue
      all.push(item.priceValue)
      if (!NON_MEAL_ITEM.test(item.name)) filtered.push(item.priceValue)
    }
  }
  return filtered.length > 0 ? filtered : all
}

// Below this many comparable items on either side, the average is dominated by whichever
// handful of items a scrape happened to capture that run (confirmed against live data —
// a competitor's catering bucket swung from 3 to 5 items run-to-run, swinging its reported
// "average price" by 60% with no real price change). A read this thin is worse than none —
// drop it rather than report it, matching the confidence-floor pattern used for photo
// analysis (lib/places/listing-audit.ts CONF_FLOOR).
const MIN_COMPARABLE_ITEMS = 6
// >= this many on the SMALLER side, confidence is "high"; between MIN and this, "medium" —
// confidence now reflects how much the average could shift from one more/fewer item, not a
// fixed literal. See PRICE_COMPARISON_LIMITATION.
const HIGH_CONFIDENCE_ITEMS = 12

type PriceStats = { avg: number; n: number; confidence: "high" | "medium" }

/** Comparable-price read for a bucket pair, or null when either side is too thin to trust
 *  (see MIN_COMPARABLE_ITEMS) — the caller should skip emitting an insight entirely, not
 *  fall back to a low-confidence guess. */
export function priceStatsPair(locCategories: MenuCategory[], compCategories: MenuCategory[]): { loc: PriceStats; comp: PriceStats } | null {
  const locItems = comparableItems(locCategories)
  const compItems = comparableItems(compCategories)
  const minN = Math.min(locItems.length, compItems.length)
  if (minN < MIN_COMPARABLE_ITEMS) return null
  const confidence = minN >= HIGH_CONFIDENCE_ITEMS ? "high" : "medium"
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  return {
    loc: { avg: avg(locItems), n: locItems.length, confidence },
    comp: { avg: avg(compItems), n: compItems.length, confidence },
  }
}

// PRICE_COMPARISON_LIMITATION: excluding non-meal add-ons + requiring a minimum sample
// narrows, but does not eliminate, the comparability gap — a combo-only concept's "meal"
// items (bundled: entree+side+drink) are still structurally different from an à la carte
// concept's individual entree prices. True fix is per-category / per-item-type matching,
// which needs menu-parse-time item classification we don't have yet (tracked as a
// follow-up). This is a bounded improvement: fewer wild swings, no insight from noise-level
// samples, confidence that reflects real data volume — not a claim of full comparability.

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
    for (const comp of competitorMenus) {
      const compDineIn = filterByMenuType(comp.menu.categories, "dine_in")
      if (compDineIn.length === 0) continue
      const stats = priceStatsPair(locDineIn, compDineIn)
      if (!stats) continue // too few comparable items on either side to trust the average
      const { loc, comp: compStats } = stats
      const diff = compStats.avg - loc.avg
      const pctDiff = Math.abs(diff) / loc.avg

      if (pctDiff >= 0.15) {
        insights.push({
          insight_type: "menu.price_positioning_shift",
          title: diff > 0
            ? `${comp.competitorName} dine-in prices are ${Math.round(pctDiff * 100)}% higher`
            : `${comp.competitorName} dine-in prices are ${Math.round(pctDiff * 100)}% lower`,
          summary: `Your average dine-in price ($${loc.avg.toFixed(2)}) ${diff > 0 ? "is lower than" : "exceeds"} ${comp.competitorName}'s ($${compStats.avg.toFixed(2)}), based on ${loc.n} of your comparable items vs ${compStats.n} of theirs. ${diff > 0 ? "You may have room to increase prices." : "Consider whether your pricing remains competitive."}`,
          confidence: loc.confidence,
          severity: Math.abs(pctDiff) >= 0.3 ? "warning" : "info",
          evidence: {
            locationAvgPrice: loc.avg,
            competitorAvgPrice: compStats.avg,
            locationSampleSize: loc.n,
            competitorSampleSize: compStats.n,
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
    for (const comp of competitorMenus) {
      const compCatering = filterByMenuType(comp.menu.categories, "catering")
      if (compCatering.length === 0) continue
      // Catering menus are inherently SMALL (a handful of tray/package options) — the
      // same minimum-sample gate applies, so a catering comparison built from 3-5 items
      // (confirmed unstable run-to-run against live data) is dropped rather than reported.
      const stats = priceStatsPair(locCatering, compCatering)
      if (!stats) continue
      const { loc, comp: compStats } = stats
      const diff = compStats.avg - loc.avg
      const pctDiff = Math.abs(diff) / loc.avg

      if (pctDiff >= 0.10) {
        insights.push({
          insight_type: "menu.catering_pricing_gap",
          title: diff > 0
            ? `${comp.competitorName} catering prices are ${Math.round(pctDiff * 100)}% higher`
            : `${comp.competitorName} catering prices are ${Math.round(pctDiff * 100)}% lower`,
          summary: `Your average catering price ($${loc.avg.toFixed(2)}) ${diff > 0 ? "is lower than" : "exceeds"} ${comp.competitorName}'s ($${compStats.avg.toFixed(2)}), based on ${loc.n} of your comparable items vs ${compStats.n} of theirs. Catering margins are typically high — pricing accurately matters.`,
          confidence: loc.confidence,
          severity: Math.abs(pctDiff) >= 0.25 ? "warning" : "info",
          evidence: {
            locationCateringAvgPrice: loc.avg,
            competitorCateringAvgPrice: compStats.avg,
            locationSampleSize: loc.n,
            competitorSampleSize: compStats.n,
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

  // Menu-insight gate (ALT-363) — single choke point for all menu.* claims. content.*
  // and non-menu rules pass through untouched. This also covers the skills, which only
  // narrate what this function emits, so a suppressed menu.* insight can't be re-surfaced
  // as a "positioning"-labeled play.
  return insights.filter((ins) => {
    if (!ins.insight_type.startsWith("menu.")) return true
    if (!isMenuInsightsEnabled()) return false
    if (!menuHasCoverage(locationMenu)) return false
    if (
      ins.insight_type === "menu.menu_change_detected" &&
      menuCountUnstable(locationMenu, previousLocationMenu)
    ) {
      return false
    }
    return true
  })
}
