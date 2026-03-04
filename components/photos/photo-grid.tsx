"use client"

import { useState } from "react"

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

const CATEGORY_COLORS: Record<string, string> = {
  food_dish: "bg-amber-100 text-amber-800 border-amber-200",
  menu_board: "bg-teal-100 text-teal-800 border-teal-200",
  interior: "bg-blue-100 text-blue-800 border-blue-200",
  exterior: "bg-green-100 text-green-800 border-green-200",
  patio_outdoor: "bg-lime-100 text-lime-800 border-lime-200",
  bar_drinks: "bg-purple-100 text-purple-800 border-purple-200",
  event_promotion: "bg-rose-100 text-rose-800 border-rose-200",
  signage: "bg-cyan-100 text-cyan-800 border-cyan-200",
  renovation: "bg-orange-100 text-orange-800 border-orange-200",
  seasonal_decor: "bg-pink-100 text-pink-800 border-pink-200",
  customer_atmosphere: "bg-indigo-100 text-indigo-800 border-indigo-200",
  staff_team: "bg-violet-100 text-violet-800 border-violet-200",
  other: "bg-slate-100 text-slate-700 border-slate-200",
}

type ViewMode = "grid" | "competitor"

export default function PhotoGrid({ photos }: Props) {
  const [selectedCategory, setSelectedCategory] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const categories = [...new Set(photos.map((p) => p.category))]
  const competitors = [...new Set(photos.map((p) => p.competitor_name))]
  const filtered = selectedCategory
    ? photos.filter((p) => p.category === selectedCategory)
    : photos

  const groupedByCompetitor = competitors.reduce<Record<string, PhotoGridItem[]>>((acc, name) => {
    acc[name] = filtered.filter((p) => p.competitor_name === name)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setSelectedCategory("")}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
              !selectedCategory
                ? "bg-pink-600 text-white shadow-sm"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            All ({photos.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                selectedCategory === cat
                  ? "bg-pink-600 text-white shadow-sm"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {CATEGORY_LABELS[cat] ?? cat} ({photos.filter((p) => p.category === cat).length})
            </button>
          ))}
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
          <button
            onClick={() => setViewMode("grid")}
            className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
              viewMode === "grid" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setViewMode("competitor")}
            className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
              viewMode === "competitor" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            By Competitor
          </button>
        </div>
      </div>

      {/* Grid view */}
      {viewMode === "grid" && (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              expanded={expandedId === photo.id}
              onToggle={() => setExpandedId(expandedId === photo.id ? null : photo.id)}
            />
          ))}
        </div>
      )}

      {/* Competitor grouped view */}
      {viewMode === "competitor" && (
        <div className="space-y-6">
          {Object.entries(groupedByCompetitor).map(([name, compPhotos]) =>
            compPhotos.length > 0 ? (
              <div key={name}>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">{name}</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    {compPhotos.length} photos
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {compPhotos.map((photo) => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      expanded={expandedId === photo.id}
                      onToggle={() => setExpandedId(expandedId === photo.id ? null : photo.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null
          )}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 py-12 text-center">
          <p className="text-sm text-slate-500">No photos match the selected filter</p>
        </div>
      )}
    </div>
  )
}

function PhotoCard({
  photo,
  expanded,
  onToggle,
}: {
  photo: PhotoGridItem
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-white shadow-sm transition hover:shadow-md ${
        expanded ? "col-span-2 row-span-2 border-pink-300" : "border-slate-200"
      }`}
      onClick={onToggle}
    >
      {photo.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.image_url}
          alt={photo.subcategory || photo.category}
          className={`w-full object-cover ${expanded ? "aspect-[4/3]" : "aspect-square"}`}
          loading="lazy"
        />
      ) : (
        <div className={`flex items-center justify-center bg-slate-100 ${expanded ? "aspect-[4/3]" : "aspect-square"}`}>
          <svg className="h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5a1.5 1.5 0 001.5 1.5z" />
          </svg>
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />

      {/* Bottom info on hover */}
      <div className="absolute bottom-0 left-0 right-0 space-y-1 p-2.5 opacity-0 transition group-hover:opacity-100">
        <div className="flex flex-wrap gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${CATEGORY_COLORS[photo.category] ?? CATEGORY_COLORS.other}`}>
            {CATEGORY_LABELS[photo.category] ?? photo.category}
          </span>
          {photo.quality_lighting === "professional" && (
            <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
              Pro
            </span>
          )}
        </div>
        <p className="text-[11px] font-medium text-white">{photo.competitor_name}</p>
        {photo.subcategory && (
          <p className="text-[10px] text-white/70">{photo.subcategory}</p>
        )}
      </div>

      {/* Promo badge */}
      {photo.promotional_content && (
        <div className="absolute right-2 top-2">
          <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[9px] font-bold text-white shadow-md">
            Promo
          </span>
        </div>
      )}

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-slate-200 bg-white p-3 text-xs">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {photo.tags.map((t) => (
                <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {t}
                </span>
              ))}
            </div>
            {photo.extracted_text && (
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-[10px] font-semibold text-slate-500">OCR Text</p>
                <p className="mt-0.5 text-[11px] text-slate-700">{photo.extracted_text}</p>
              </div>
            )}
            {photo.promotional_details && (
              <div className="rounded-lg bg-rose-50 p-2">
                <p className="text-[10px] font-semibold text-rose-600">Promotion</p>
                <p className="mt-0.5 text-[11px] text-rose-700">{photo.promotional_details}</p>
              </div>
            )}
            <div className="flex items-center gap-3 text-[10px] text-slate-400">
              <span>Confidence: {Math.round(photo.confidence * 100)}%</span>
              <span>Quality: {photo.quality_lighting} / {photo.quality_staging}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
