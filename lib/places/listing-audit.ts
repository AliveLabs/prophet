// Listing imagery audit (ALT-160)
// ---------------------------------------------------------------------------
// Pure, server-safe aggregation that turns a set of Google-listing PhotoAnalysis
// rows into the read the Listing Check + Shelf modules render. No fabricated
// numbers: every output is a count, a percentage, or a coverage state derived
// straight from the vision analysis. Strictly descriptive — it never claims a
// photo CAUSED anything.
//
// Deliberately NOT included in v1 (would require data Google doesn't give us
// honestly): photo "freshness/staleness" (no upload date is exposed; first_seen_at
// is just when WE first saw it) and a "first five lead photos" claim (Google's
// returned order is not a reliable stand-in for the live lead order a stranger
// sees). We lead with the full-set owner-vs-customer split instead.

import type { PhotoAnalysis, PhotoCategory } from "@/lib/providers/photos"

// ── Listing slots — the storefront essentials a Google listing should cover ──
export type ListingSlot =
  | "exterior" | "signage" | "interior" | "menu_board"
  | "food_dish" | "staff_team" | "bar_drinks" | "patio_outdoor"

export const SLOT_LABEL: Record<ListingSlot, string> = {
  exterior: "Exterior",
  signage: "Signage",
  interior: "Interior",
  menu_board: "Menu board",
  food_dish: "Signature dishes",
  staff_team: "Team",
  bar_drinks: "Bar / drinks",
  patio_outdoor: "Patio",
}

const SLOT_WHY: Record<ListingSlot, string> = {
  exterior: "so people recognize the door from the street",
  signage: "so your name reads at a glance",
  interior: "so people can picture sitting down",
  menu_board: "so people see what you serve before they arrive",
  food_dish: "the shots people actually decide on",
  staff_team: "the faces behind the counter",
  bar_drinks: "what's on tap and in the glass",
  patio_outdoor: "the outdoor seating people look for",
}

// The six every restaurant should have; bar/drinks + patio are CONDITIONAL — only
// treated as essentials when the place clearly has them (evidence in its own photos),
// so we never scold a place for missing a patio it doesn't have.
const ALWAYS_ESSENTIAL: ListingSlot[] = ["exterior", "signage", "interior", "menu_board", "food_dish", "staff_team"]
const CONDITIONAL: ListingSlot[] = ["bar_drinks", "patio_outdoor"]
const ALL_SLOTS: ListingSlot[] = [...ALWAYS_ESSENTIAL, ...CONDITIONAL]

const CAT_TO_SLOT: Partial<Record<PhotoCategory, ListingSlot>> = {
  exterior: "exterior",
  signage: "signage",
  interior: "interior",
  menu_board: "menu_board",
  food_dish: "food_dish",
  staff_team: "staff_team",
  bar_drinks: "bar_drinks",
  patio_outdoor: "patio_outdoor",
}

// A read below this confidence is worse than none — drop it from the aggregate.
const CONF_FLOOR = 0.5
// Owner-vs-customer attribution is a best-estimate (Google has no clean owner flag),
// so we only surface the split once there's enough volume to trust the shape.
const SPLIT_MIN_N = 6

export type PhotoRow = {
  analysis_result: unknown
  author_attribution?: unknown
  /** Public URL of the stored photo — present for own-listing rows; drives the gallery. */
  image_url?: string | null
}

function parseAnalysis(raw: unknown): PhotoAnalysis | null {
  if (!raw || typeof raw !== "object") return null
  const a = raw as Partial<PhotoAnalysis>
  if (!a.category || !a.quality_signals) return null
  if (typeof a.confidence === "number" && a.confidence < CONF_FLOOR) return null
  return a as PhotoAnalysis
}

// Normalize a name for comparison — case- and punctuation-insensitive.
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// The first non-empty attribution displayName on a photo, if any.
function attributionName(author: unknown): string | null {
  if (!Array.isArray(author)) return null
  for (const a of author) {
    const n = a && typeof a === "object" ? (a as { displayName?: string }).displayName : undefined
    if (typeof n === "string" && n.trim()) return n.trim()
  }
  return null
}

// Owner photos are attributed to the BUSINESS's own Google profile — the attribution
// displayName IS the business name (a stable contributor). Everything else is a
// customer/reviewer upload. (Our first cut keyed off ABSENCE of attribution, which
// never happens — Google attributes every photo — so it read all as customer and the
// split never fired.) With no ownerName we can't tell them apart, so nothing is owner
// and the split self-suppresses.
export function isOwnerPhoto(author: unknown, ownerName?: string | null): boolean {
  if (!ownerName) return false
  const n = attributionName(author)
  return n != null && normalizeName(n) === normalizeName(ownerName)
}

// ── Per-entity profile — used for BOTH own listing and each competitor (the Shelf) ──
export type EntityPhotoProfile = {
  total: number
  analyzed: number
  slots: Set<ListingSlot>
  slotCounts: Record<ListingSlot, number>
  /** essential slots (always-on + conditionals the entity actually has) that have ≥1 photo */
  essentialCovered: number
  essentialTotal: number
  professionalShare: number
  styledShare: number
  promoShare: number
}

export function buildEntityPhotoProfile(rows: PhotoRow[]): EntityPhotoProfile {
  const slotCounts = Object.fromEntries(ALL_SLOTS.map((s) => [s, 0])) as Record<ListingSlot, number>
  let analyzed = 0
  let professional = 0
  let styled = 0
  let promo = 0
  for (const r of rows) {
    const a = parseAnalysis(r.analysis_result)
    if (!a) continue
    analyzed++
    const slot = CAT_TO_SLOT[a.category]
    if (slot) slotCounts[slot]++
    if (a.quality_signals.lighting === "professional") professional++
    if (a.quality_signals.staging === "styled") styled++
    if (a.promotional_content) promo++
  }
  const slots = new Set<ListingSlot>()
  for (const s of ALL_SLOTS) if (slotCounts[s] > 0) slots.add(s)
  const essentials = essentialSlotsFor(slots)
  const essentialCovered = essentials.filter((s) => slotCounts[s] > 0).length
  const pct = (n: number) => (analyzed > 0 ? Math.round((n / analyzed) * 100) : 0)
  return {
    total: rows.length,
    analyzed,
    slots,
    slotCounts,
    essentialCovered,
    essentialTotal: essentials.length,
    professionalShare: pct(professional),
    styledShare: pct(styled),
    promoShare: pct(promo),
  }
}

// Essentials for an entity = the always-on set + any conditional slot the entity
// clearly has (a bar/patio photo of its own is the evidence it exists).
function essentialSlotsFor(presentSlots: Set<ListingSlot>): ListingSlot[] {
  return [...ALWAYS_ESSENTIAL, ...CONDITIONAL.filter((s) => presentSlots.has(s))]
}

// ── Own-listing audit — the Listing Check module's full read ─────────────────
export type SlotState = "covered" | "thin" | "missing"

export type GalleryPhoto = { url: string; owner: boolean; category: string | null }

export type ListingAudit = {
  total: number
  analyzed: number
  // owner-vs-customer asymmetry (owner = attributed to the business; gated by showSplit)
  ownerCount: number
  customerCount: number
  showSplit: boolean
  // renderable photos, segmented owner vs customer (only rows with an image_url)
  ownerPhotos: GalleryPhoto[]
  customerPhotos: GalleryPhoto[]
  // coverage punch-list
  essentials: Array<{ slot: ListingSlot; label: string; why: string; state: SlotState; count: number }>
  coveredCount: number
  essentialTotal: number
  // quality
  professionalShare: number
  styledShare: number
  // top 3 plain-language to-dos
  fixNext: string[]
}

export function buildListingAudit(rows: PhotoRow[], opts: { ownerName?: string | null } = {}): ListingAudit {
  const profile = buildEntityPhotoProfile(rows)
  const ownerName = opts.ownerName ?? null

  // Owner/customer split (owner = attributed to the business) + the renderable,
  // segmented galleries. A row attributed to no one counts as neither, but still
  // shows in the customer gallery (it isn't the operator's own upload).
  let ownerCount = 0
  let customerCount = 0
  const ownerPhotos: GalleryPhoto[] = []
  const customerPhotos: GalleryPhoto[] = []
  for (const r of rows) {
    const owner = isOwnerPhoto(r.author_attribution, ownerName)
    if (owner) ownerCount++
    else if (attributionName(r.author_attribution) != null) customerCount++
    if (r.image_url) {
      const category = parseAnalysis(r.analysis_result)?.category ?? null
      ;(owner ? ownerPhotos : customerPhotos).push({ url: r.image_url, owner, category })
    }
  }

  const essentialSlots = essentialSlotsFor(profile.slots)
  const essentials = essentialSlots.map((slot) => {
    const count = profile.slotCounts[slot]
    const state: SlotState = count >= 2 ? "covered" : count === 1 ? "thin" : "missing"
    return { slot, label: SLOT_LABEL[slot], why: SLOT_WHY[slot], state, count }
  })
  const coveredCount = essentials.filter((e) => e.state === "covered").length

  // Fix-next: missing essentials first, then thin ones, then a quality nudge.
  const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a")
  const fixNext: string[] = []
  for (const e of essentials) {
    const l = e.label.toLowerCase()
    if (e.state === "missing") fixNext.push(`Add ${article(l)} ${l} photo — ${e.why}.`)
  }
  for (const e of essentials) {
    if (e.state === "thin") fixNext.push(`Add another ${e.label.toLowerCase()} shot — you only have one (${e.why}).`)
  }
  if (profile.analyzed >= 4 && profile.professionalShare < 40) {
    fixNext.push("Several of your photos read as casual lighting — reshoot your weakest in good daylight.")
  }

  return {
    total: rows.length,
    analyzed: profile.analyzed,
    ownerCount,
    customerCount,
    // Enough volume AND a genuine mix (both sides present) — so a location where we
    // can't identify the owner (name mismatch) falls back to a neutral count.
    showSplit: rows.length >= SPLIT_MIN_N && ownerCount > 0 && customerCount > 0,
    ownerPhotos,
    customerPhotos,
    essentials,
    coveredCount,
    essentialTotal: essentials.length,
    professionalShare: profile.professionalShare,
    styledShare: profile.styledShare,
    fixNext: fixNext.slice(0, 3),
  }
}

// ── The Shelf — own vs the single STRONGEST competitor (one basis, app-wide) ──
// "Strongest" = best essential-coverage, tie-broken by professional-shot share, then
// volume. Matches the existing social-standing-pass convention of measuring against
// the leader of the set (NOT a median), so the two pages never contradict each other.
export type CompetitorPhotoGroup = { id: string; name: string; rows: PhotoRow[] }

export type ShelfRow = {
  metric: string
  side: "you" | "them"
  /** 0–100 magnitude for the center-out bar */
  width: number
  verdict: string
  tip: string
  tipValue: string
}

export type ShelfData = {
  benchmarkName: string | null
  rows: ShelfRow[]
} | null

export function buildShelf(ownRows: PhotoRow[], competitors: CompetitorPhotoGroup[]): ShelfData {
  const own = buildEntityPhotoProfile(ownRows)
  const compProfiles = competitors
    .map((c) => ({ name: c.name, profile: buildEntityPhotoProfile(c.rows) }))
    .filter((c) => c.profile.analyzed > 0)
  if (own.analyzed === 0 || compProfiles.length === 0) return null

  // Pick the leader of the set.
  const leader = [...compProfiles].sort((a, b) => {
    const ca = a.profile.essentialCovered, cb = b.profile.essentialCovered
    if (cb !== ca) return cb - ca
    if (b.profile.professionalShare !== a.profile.professionalShare) return b.profile.professionalShare - a.profile.professionalShare
    return b.profile.analyzed - a.profile.analyzed
  })[0]
  const them = leader.profile

  // Coverage compared on a shared denominator (the always-on essentials), so the
  // two sides are measured the same way regardless of conditional slots.
  const ownCore = ALWAYS_ESSENTIAL.filter((s) => own.slots.has(s)).length
  const themCore = ALWAYS_ESSENTIAL.filter((s) => them.slots.has(s)).length
  const coreTotal = ALWAYS_ESSENTIAL.length

  const rows: ShelfRow[] = [
    mkRow(
      "Coverage",
      (ownCore / coreTotal) * 100,
      (themCore / coreTotal) * 100,
      `${ownCore}/${coreTotal} essentials`,
      `${themCore}/${coreTotal} essentials`,
      "Essential listing slots covered (exterior, signage, interior, menu, dishes, team)",
    ),
    mkRow(
      "Pro-shot share",
      own.professionalShare,
      them.professionalShare,
      `${own.professionalShare}%`,
      `${them.professionalShare}%`,
      "Share of analyzed photos shot with professional lighting",
    ),
    mkRow(
      "Photos on listing",
      own.total,
      them.total,
      `${own.total}`,
      `${them.total}`,
      "How many photos Google shows on the listing",
    ),
  ]

  return { benchmarkName: leader.name, rows }
}

// Bar magnitude follows the house convention (see social-standing-pass): a 30
// floor so even a near-tie shows a small bar, growing with the MARGIN up to 100,
// where margin = how far the loser trails the winner. youVal/themVal are passed
// raw (percentages OR counts) — the gap is scale-free.
function mkRow(metric: string, youVal: number, themVal: number, youLabel: string, themLabel: string, tip: string): ShelfRow {
  const youAhead = youVal >= themVal
  const hi = Math.max(youVal, themVal)
  const lo = Math.min(youVal, themVal)
  const gap = hi > 0 ? Math.round((1 - lo / hi) * 100) : 0
  const width = Math.min(100, 30 + gap)
  return {
    metric,
    side: youAhead ? "you" : "them",
    width,
    verdict: youAhead ? youLabel : themLabel,
    tip,
    tipValue: `You ${youLabel} · Them ${themLabel}`,
  }
}
