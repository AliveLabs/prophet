"use client"

// The Pass — competitor photo gallery, REBUILT to Concept A's structure.
//
// Structure rebuild (not a reskin): filter chips + a segmented Grid / By-competitor
// view → a responsive grid of real-image photo TILES (TkCard, hover-lift, corner
// badges, hover caption) → a full-detail LIGHTBOX in a TkDrawer (right-slide desktop,
// bottom-sheet mobile) instead of an inline expand → a TkEmptyState when a filter
// matches nothing. Same PhotoGridItem data + honest confidence/quality framing.

import { useState } from "react"
import {
  TkCard,
  TkChip,
  TkDrawer,
  TkEmptyState,
  type TkFamily,
} from "@/components/ticket"

export type PhotoGridItem = {
  id: string
  image_url: string | null
  category: string
  subcategory: string
  tags: string[]
  extracted_text: string
  promotional_content: boolean
  promotional_details: string
  confidence: number
  competitor_name: string
  competitor_id: string
  quality_lighting: string
  quality_staging: string
  first_seen_at: string
}

type Props = {
  photos: PhotoGridItem[]
}

const CATEGORY_LABELS: Record<string, string> = {
  food_dish: "Food & Dishes",
  menu_board: "Menu Board",
  interior: "Interior",
  exterior: "Exterior",
  patio_outdoor: "Patio & Outdoor",
  bar_drinks: "Bar & Drinks",
  staff_team: "Staff & Team",
  event_promotion: "Event / Promo",
  signage: "Signage",
  renovation: "Renovation",
  seasonal_decor: "Seasonal",
  customer_atmosphere: "Atmosphere",
  other: "Other",
}

// Map each category to a Pass family hue (chips reuse the kit family palette).
const CATEGORY_FAMILY: Record<string, TkFamily> = {
  food_dish: "menu",
  menu_board: "menu",
  bar_drinks: "menu",
  interior: "reputation",
  customer_atmosphere: "reputation",
  exterior: "competitive",
  patio_outdoor: "competitive",
  signage: "competitive",
  renovation: "competitive",
  seasonal_decor: "social",
  event_promotion: "social",
  staff_team: "grassroots",
  other: "competitive",
}

// Badge tints for the always-visible corner category badge (frosted over the photo).
const CATEGORY_BADGE: Record<string, { bg: string; fg: string }> = {
  menu: { bg: "color-mix(in srgb, var(--teal) 86%, #fff 14%)", fg: "#07140f" },
  reputation: { bg: "color-mix(in srgb, var(--rust) 86%, #fff 14%)", fg: "#fff" },
  competitive: { bg: "color-mix(in srgb, var(--slate) 86%, #fff 14%)", fg: "#fff" },
  social: { bg: "color-mix(in srgb, var(--gold) 86%, #18120a 14%)", fg: "#18120a" },
  grassroots: { bg: "color-mix(in srgb, var(--slate) 86%, #fff 14%)", fg: "#fff" },
}

function catLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ")
}
function catFamily(cat: string): TkFamily {
  return CATEGORY_FAMILY[cat] ?? "competitive"
}

type ViewMode = "grid" | "competitor"

const IMG_PLACEHOLDER = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
    <path d="M2.25 15.75l5.16-5.16a2.25 2.25 0 0 1 3.18 0l5.16 5.16m-1.5-1.5l1.41-1.41a2.25 2.25 0 0 1 3.18 0l2.91 2.91M3.75 21h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v13.5a1.5 1.5 0 0 0 1.5 1.5z" />
  </svg>
)

export default function PhotoGrid({ photos }: Props) {
  const [selectedCategory, setSelectedCategory] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [activeId, setActiveId] = useState<string | null>(null)

  const categories = [...new Set(photos.map((p) => p.category))]
  const competitors = [...new Set(photos.map((p) => p.competitor_name))]
  const filtered = selectedCategory
    ? photos.filter((p) => p.category === selectedCategory)
    : photos

  const active = activeId ? (photos.find((p) => p.id === activeId) ?? null) : null

  const grouped = competitors.reduce<Record<string, PhotoGridItem[]>>((acc, name) => {
    acc[name] = filtered.filter((p) => p.competitor_name === name)
    return acc
  }, {})

  return (
    <div className="photos-gallery tk-kit">
      {/* Controls: category filter chips + segmented view toggle */}
      <div className="photos-controls">
        <div className="photos-filter-chips" role="group" aria-label="Filter photos by category">
          <button
            type="button"
            className={`photos-fchip${!selectedCategory ? " is-active" : ""}`}
            aria-pressed={!selectedCategory}
            onClick={() => setSelectedCategory("")}
          >
            All · {photos.length}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`photos-fchip${selectedCategory === cat ? " is-active" : ""}`}
              aria-pressed={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
            >
              {catLabel(cat)} · {photos.filter((p) => p.category === cat).length}
            </button>
          ))}
        </div>

        <div className="photos-seg" role="group" aria-label="View mode">
          <button
            type="button"
            className={viewMode === "grid" ? "is-active" : ""}
            aria-pressed={viewMode === "grid"}
            onClick={() => setViewMode("grid")}
          >
            Grid
          </button>
          <button
            type="button"
            className={viewMode === "competitor" ? "is-active" : ""}
            aria-pressed={viewMode === "competitor"}
            onClick={() => setViewMode("competitor")}
          >
            By competitor
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <TkEmptyState
          icon={IMG_PLACEHOLDER}
          title="No photos in this view"
          description="No analyzed photos match the selected category. Clear the filter to see everything we've read."
        />
      ) : viewMode === "grid" ? (
        <div className="photos-tilegrid">
          {filtered.map((photo) => (
            <PhotoTile key={photo.id} photo={photo} onOpen={() => setActiveId(photo.id)} />
          ))}
        </div>
      ) : (
        <div>
          {competitors.map((name) =>
            grouped[name]?.length ? (
              <div className="photos-comp-group" key={name}>
                <div className="photos-comp-grouphead">
                  <h5>{name}</h5>
                  <span className="photos-comp-count">{grouped[name].length} photos</span>
                </div>
                <div className="photos-tilegrid">
                  {grouped[name].map((photo) => (
                    <PhotoTile key={photo.id} photo={photo} onOpen={() => setActiveId(photo.id)} />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}

      {/* Lightbox detail — TkDrawer (bottom-sheet on mobile) */}
      <TkDrawer
        open={active != null}
        onClose={() => setActiveId(null)}
        chip={
          active ? (
            <TkChip family={catFamily(active.category)}>{catLabel(active.category)}</TkChip>
          ) : null
        }
        title={active ? active.competitor_name : undefined}
      >
        {active ? <Lightbox photo={active} /> : null}
      </TkDrawer>
    </div>
  )
}

/* ── A single photo tile ──────────────────────────────────────────────── */
function PhotoTile({ photo, onOpen }: { photo: PhotoGridItem; onOpen: () => void }) {
  const fam = catFamily(photo.category)
  const badge = CATEGORY_BADGE[fam]
  const isPro = photo.quality_lighting === "professional"
  return (
    <TkCard
      role="button"
      tabIndex={0}
      className="photos-tile"
      aria-label={`${catLabel(photo.category)} — ${photo.competitor_name}. Open detail.`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="photos-tile-img">
        {photo.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.image_url} alt={photo.subcategory || catLabel(photo.category)} loading="lazy" />
        ) : (
          <span className="photos-tile-noimg" aria-hidden="true">
            {IMG_PLACEHOLDER}
          </span>
        )}

        <span className="photos-tile-veil" aria-hidden="true" />

        {/* Always-visible corner badges */}
        <div className="photos-tile-badges">
          <span
            className="photos-cat-badge"
            style={{ background: badge.bg, color: badge.fg }}
          >
            {catLabel(photo.category)}
          </span>
          {photo.promotional_content && <span className="photos-promo-badge">Promo</span>}
        </div>

        {/* Hover caption */}
        <div className="photos-tile-cap">
          <div className="photos-tile-cap-chips">
            {isPro && <span className="photos-tile-cap-chip is-pro">Pro lighting</span>}
            {photo.quality_staging === "styled" && (
              <span className="photos-tile-cap-chip">Styled</span>
            )}
          </div>
          <span className="photos-tile-cap-comp">{photo.competitor_name}</span>
          {photo.subcategory && <span className="photos-tile-cap-sub">{photo.subcategory}</span>}
        </div>
      </div>
    </TkCard>
  )
}

/* ── Lightbox body ────────────────────────────────────────────────────── */
function Lightbox({ photo }: { photo: PhotoGridItem }) {
  const isPro = photo.quality_lighting === "professional"
  return (
    <div className="photos-lb-meta">
      <div className="photos-lb-img">
        {photo.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.image_url} alt={photo.subcategory || catLabel(photo.category)} />
        ) : (
          <div className="photos-lb-noimg" aria-hidden="true">
            {IMG_PLACEHOLDER}
          </div>
        )}
      </div>

      <div className="photos-lb-chips">
        <TkChip family={catFamily(photo.category)}>{catLabel(photo.category)}</TkChip>
        {isPro && <TkChip family="menu">Pro lighting</TkChip>}
        {photo.subcategory && <span className="photos-lb-block-lbl">{photo.subcategory}</span>}
      </div>

      {photo.promotional_details && (
        <div className="photos-lb-block is-promo">
          <span className="photos-lb-block-lbl">Promotion detected</span>
          <p className="photos-lb-block-body">{photo.promotional_details}</p>
        </div>
      )}

      {photo.extracted_text && (
        <div className="photos-lb-block">
          <span className="photos-lb-block-lbl">Text read from the photo</span>
          <p className="photos-lb-block-body photos-lb-q">“{photo.extracted_text}”</p>
        </div>
      )}

      {photo.tags.length > 0 && (
        <div>
          <span className="photos-lb-block-lbl">Tags</span>
          <div className="photos-lb-tags" style={{ marginTop: 7 }}>
            {photo.tags.map((t) => (
              <span className="photos-lb-tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="photos-lb-facts">
        <span>
          <b>Match confidence</b> {Math.round(photo.confidence * 100)}%
        </span>
        <span>
          <b>Lighting</b> {photo.quality_lighting}
        </span>
        <span>
          <b>Staging</b> {photo.quality_staging}
        </span>
      </div>
    </div>
  )
}
