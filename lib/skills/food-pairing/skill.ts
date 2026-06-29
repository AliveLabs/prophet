// ---------------------------------------------------------------------------
// Food-Pairing / Kitchen skill (P6 expert roster) — the menu merchandising expert.
// Decides WHAT to feature/special and WHEN, matching the plate to weather + season +
// the dayparts served. Category "menu" (neutral prior). Feeds the SAME global pool as
// every other producer; the model-failure path falls back to deterministic grounded
// plays. Runs on the standard reasoning tier (NOT the Opus deep pass) — cost stays flat.
//
// GROUNDING REALITY: the dossier has no margin or prep-speed data, so those stay
// QUALITATIVE priors in the knowledge prose. Every play must still cite a real rule
// output — menu.* signals or the weather/seasonal signals below — or run.ts drops it.
// The raw menu is passed as CONTEXT (to pick which real item to feature), not as a
// citable ref.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { MenuSnapshot } from "@/lib/content/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { FOOD_PAIRING_KNOWLEDGE } from "@/lib/skills/food-pairing/knowledge"

// Menu signals the kitchen expert features on. Matched EXACTLY (not by `menu.` prefix) so we
// EXCLUDE the price signals — menu.price_positioning_shift + menu.catering_pricing_gap are the
// Positioning skill's territory (P4 price corroboration), a "how you're priced" move, not a
// "what to cook/feature" move. All four below are emitted by the live content pipeline.
const MENU_FEATURE_TYPES = new Set([
  "menu.signature_item_missing",
  "menu.category_gap",
  "menu.menu_change_detected",
  "menu.promo_signal_detected",
])

// Weather cues that TIME a feature — both LIVE (lib/insights/weather-context.ts via the weather
// pipeline): good-weather/patio -> light, outdoor-friendly items; weather-suppressed traffic ->
// warm comfort / delivery-friendly items. (The earlier social.cross_* "seasonal" types were
// dropped: generateCrossSignalInsights has NO production caller, so citing them is dead on
// arrival; social.seasonal_content_gap is Marketing's content signal, not a menu one. Seasonality
// is reasoned from the raw weatherForecast context below, not grounded on a citable ref.)
const WEATHER_CUE_TYPES = new Set(["visual.weather_patio", "traffic.weather_suppression"])

function isFoodPairingSignal(t: string): boolean {
  return MENU_FEATURE_TYPES.has(t) || WEATHER_CUE_TYPES.has(t)
}

/** Compact, NUMBER-FREE menu view: category -> item names (+ tags). Prices/descriptions are
 *  dropped on purpose — names guide WHICH item to feature; a raw menu price is not grounded
 *  evidence and must never be quoted as if it were. Capped for token discipline. */
function summarizeMenu(menu: MenuSnapshot | null | undefined) {
  if (!menu || menu.categories.length === 0) return null
  return menu.categories.slice(0, 8).map((c) => ({
    category: c.name,
    items: c.items.slice(0, 12).map((it) => ({
      name: it.name,
      tags: it.tags?.length ? it.tags : undefined,
    })),
  }))
}

function selectInput(d: Dossier) {
  return {
    menuSignals: d.ruleOutputs.filter((i) => MENU_FEATURE_TYPES.has(i.insight_type)),
    weatherCueSignals: d.ruleOutputs.filter((i) => WEATHER_CUE_TYPES.has(i.insight_type)),
    // Raw menu (names + tags only) so the model features a dish that actually exists.
    menu: summarizeMenu(d.location.menu),
    // The forecast is reasoning CONTEXT for timing the feature + judging seasonality; not a citable ref.
    weatherForecast: d.demandCalendar.weather.slice(0, 4),
    hoursServed: d.profile.hours ?? null,
    cuisine: d.profile.attributes.cuisine ?? null,
    priceTier: d.profile.attributes.priceTier ?? null,
  }
}

/** Deterministic, grounded, NUMBER-FREE fallback. Emits a feature play ONLY when a menu or
 *  weather-cue signal exists to ground it; otherwise nothing (no signal, no feature). The copy
 *  branches on the signal type so a menu-grounded play does NOT claim a weather rationale the
 *  evidence never established (honesty: don't imply grounding the play lacks). */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isFoodPairingSignal(i.insight_type)).slice(0, 2)
  return signals.map((ins) => {
    const isMenu = MENU_FEATURE_TYPES.has(ins.insight_type)
    return {
      title: isMenu ? "Put your standout item front and center" : "Feature the dish that fits this week's weather",
      rationale: isMenu
        ? `Grounded in ${ins.title}. Pick the item this points to and feature it on a daypart you actually serve.`
        : `Grounded in ${ins.title}. Put the item that suits this weather out front, on a daypart you actually serve.`,
      skillId: "food-pairing",
      ownerRole: "kitchen" as const,
      kind: "capitalize" as const,
      recipe: [
        {
          channel: "menu feature / specials board",
          platforms: [],
          audience: "guests deciding what to order this week",
          window: { note: isMenu ? "this week" : "this week, while the weather holds" },
          creativeDirection:
            "on your phone, take one clear photo of the featured dish as it leaves the kitchen, so your staff and your channels can show what to order",
          dependencies: ["the item is already on your menu", "the kitchen can fire it at volume"],
        },
      ],
      confidence: "medium" as const,
      leverage: { label: "medium" as const, basisInternal: "menu-fit feature sized ordinally; no margin/cost figures available" },
      evidenceRefs: [ins.insight_type],
      knowledgeVersion: "food-pairing@v1.1",
    }
  })
}

export const foodPairingSkill: ProducerSkill = {
  id: "food-pairing",
  displayName: "Food-pairing & menu expert (the kitchen)",
  ownerRole: "kitchen",
  kind: "capitalize",
  category: "menu",
  tier: "reasoning",
  temperature: 0.5,
  knowledgeVersion: "food-pairing@v1.1",
  knowledge: FOOD_PAIRING_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(foodPairingSkill, d, selectInput(d), k),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "food-pairing", knowledgeVersion: "food-pairing@v1.1", defaultKind: "capitalize", defaultOwner: "kitchen" }),
  fallback,
  // FUNDAMENTALS-ONLY by design (Bryan, 2026-06-26): the kitchen runs on its authored fundamentals
  // (FOOD_PAIRING_KNOWLEDGE v1.1 — weather/season/daypart + obvious pairing guardrails), NOT an external
  // FOOD-trend feed. The culinary trend sources were scrape-hostile (paywall/JS) and, more importantly,
  // food trends aren't where the leverage is for our target operators — "trends" belong to a FUTURE
  // engagement/social expert (SOCIAL trends, not food). So no `external` stream here. The skill still
  // learns from CLICK feedback (thumbs/Keep → rollup multiplier) + ASK demand — usage, not trends.
  learning: {
    streams: ["click", "ask"],
    playTypeLeadDomain: "menu",
    acceptedLearningKinds: ["editorial"],
  },
}
