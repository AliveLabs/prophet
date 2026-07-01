// The Pass — resolve the best REAL photo for a play's hero slot, WITH its focal point.
//
// Honors the operator's chosen cascade (Bryan, 2026-07-01):
//   1. subject-matched      — social play → the competitor post the play is built on;
//                             competitive play → the subject competitor's listing cover
//   2. category-matched own — an own-listing photo whose CATEGORY fits the insight
//                             (menu → food_dish, reputation → interior/atmosphere, …), so
//                             cards vary + stay relevant instead of all showing one cover
//   (3. the brand gradient canvas is the caller's fallback when this returns null.)
//
// Each resolved photo carries a normalized focal point so the caller can anchor the crop
// on the subject instead of dead-centering it. Pure + server-safe (no JSX, no fetching) so
// both the server BriefView and the play-detail page share ONE resolution rule.

import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { TkFamily } from "@/components/ticket"
import { normalizeFocal, type PhotoCategory, type FocalPoint } from "@/lib/providers/photos"
import { pickInsightPhotoWithFocal, type PhotoRow, type PickedPhoto } from "@/lib/places/listing-audit"
import { playFamily } from "./pass-map"

// Case- and punctuation-insensitive name key — mirrors listing-audit#normalizeName so
// a play's cited competitor name matches the competitor's stored name.
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// Which own-listing photo categories best represent each insight family, best→worst.
// Different families prefer different categories, so the fallback VARIES per card (fixing
// the "every card shows the same chicken-finger cover" problem) while staying on-topic.
const FAMILY_CATEGORIES: Record<TkFamily, PhotoCategory[]> = {
  menu: ["food_dish", "menu_board"],
  reputation: ["customer_atmosphere", "interior", "staff_team", "food_dish"],
  social: ["food_dish", "exterior", "interior", "event_promotion"],
  grassroots: ["event_promotion", "customer_atmosphere", "staff_team", "exterior"],
  competitive: ["exterior", "signage", "interior", "food_dish"],
}

/** The competitor a play is ABOUT, read from the presentation block — the only
 *  competitor identity that rides on the play object at render time. Null when the
 *  play names no competitor (→ falls back to the operator's own photo). */
export function subjectCompetitorName(play: EnrichedRecommendation): string | null {
  const p = play.presentation
  if (!p) return null
  if (p.exemplarSocialPost?.competitor) return p.exemplarSocialPost.competitor
  const quoted = p.breakoutQuotes?.find((b) => b.competitor)?.competitor
  if (quoted) return quoted
  const h2h = p.headToHead?.find((x) => x.lead === "them" && x.setOrCompetitor)?.setOrCompetitor
  if (h2h) return h2h
  return null
}

export type HeroPhotoSources = {
  /** the operator's own-listing photo rows — the resolver category-matches within these */
  ownPhotos?: PhotoRow[]
  /** normalized competitor name → their listing cover (url + focal) */
  competitorCovers?: Map<string, PickedPhoto>
}

export type ResolvedHeroPhoto = {
  url: string
  /** honest label for the photo chip — the competitor's name for a matched competitor/
   *  social image, else the operator's own location name. */
  label: string
  /** normalized focal point for crop anchoring (defaults to center pre-backfill). */
  focal: FocalPoint
}

/**
 * Resolve a play's hero photo. `ownLabel` is the operator's location name, used as the
 * label whenever the resolved image is one of the operator's own photos. Returns null when
 * no real photo is available (caller renders the brand gradient canvas).
 */
export function resolvePlayHeroPhoto(
  play: EnrichedRecommendation,
  sources: HeroPhotoSources,
  ownLabel: string,
): ResolvedHeroPhoto | null {
  const family = playFamily(play)

  // A social play carries the actual competitor post image it's built on (the presenter
  // resolved + safe-to-embed gated it). That IS the subject image.
  if (family === "social") {
    const ex = play.presentation?.exemplarSocialPost
    if (ex?.mediaUrl) return { url: ex.mediaUrl, label: ex.competitor ?? ownLabel, focal: normalizeFocal(ex.focalPoint) }
  }

  // A competitive play → the subject competitor's listing cover, when we can name + match one.
  if (family === "competitive" && sources.competitorCovers?.size) {
    const name = subjectCompetitorName(play)
    if (name) {
      const picked = sources.competitorCovers.get(normalizeName(name))
      if (picked) return { url: picked.url, label: name, focal: picked.focal }
    }
  }

  // Otherwise a category-matched own photo (varies per family) + the universal fallback.
  // Null ⇒ the caller shows the gradient canvas.
  const own = pickInsightPhotoWithFocal(sources.ownPhotos ?? [], FAMILY_CATEGORIES[family])
  return own ? { url: own.url, label: ownLabel, focal: own.focal } : null
}

/** Build the normalized name→cover lookup the resolver expects from a plain list
 *  (a competitor's picked cover, one entry each). Keeps normalization in one place. */
export function buildCompetitorCoverMap(entries: Array<{ name: string; url: string; focal: FocalPoint }>): Map<string, PickedPhoto> {
  const m = new Map<string, PickedPhoto>()
  for (const e of entries) {
    if (e.url) m.set(normalizeName(e.name), { url: e.url, focal: e.focal })
  }
  return m
}
