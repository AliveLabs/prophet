// ---------------------------------------------------------------------------
// ONE operator-facing name per engine Category (ALT-554).
//
// Before this module the same nine categories carried three vocabularies at once:
// the settings sliders said "Social counter-strategy (vs rivals)", the feed and card
// chips said "Social", and `convergence` was "Cross-signal convergence" in settings
// against "Cross-domain" on the cards, sharing no words at all. The keys always lined
// up; only the words diverged, so an operator dragged a slider and could not tell
// which chips it moved.
//
// The rule now: the CARD's word wins. Settings follows the customer-facing surface,
// never the other way round. The scope a slider label used to carry in parentheses
// ("events & weather") lives in that category's tooltip instead (CATEGORY_TIPS in
// app/(dashboard)/settings/settings-category-priors.tsx), which already said the same
// thing in fuller language, so the label can match the chip exactly with no copy lost.
//
// Two things this map deliberately does NOT cover, because they are different objects:
//
//   · Detector rows (the /insights "Observations" section) are not plays and carry no
//     engine Category. Their chip names the SIGNAL the row was read from
//     (SOURCE_LABELS in lib/insights/scoring.ts): "Foot Traffic", "Local Events".
//     A foot-traffic observation is not the same claim as a "Demand" play, so folding
//     the two vocabularies together would put a word on a card the data does not
//     support. Two kinds of object, two maps, one map each.
//   · A legacy play that never got a stamped category falls back to its visual FAMILY
//     word (FAMILY_LABEL in app/(dashboard)/home/pass-map.ts) — a coarser label by
//     design, because an uncategorised play cannot honestly claim a category.
//
// Anything that renders a category name for an operator imports from here. Do not
// re-declare this map at a call site.
// ---------------------------------------------------------------------------

import type { Category } from "@/lib/skills/types"

export const CATEGORY_LABEL: Record<Category, string> = {
  demand: "Demand",
  marketing: "Marketing",
  social: "Social",
  menu: "Menu",
  grassroots: "Grassroots",
  positioning: "Positioning",
  reputation: "Reputation",
  operations: "Operations",
  convergence: "Cross-domain",
}
