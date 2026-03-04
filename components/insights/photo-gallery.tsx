"use client"

import { useState } from "react"

type PhotoItem = {
  id: string
  image_url: string | null
  category: string
  subcategory: string
  tags: string[]
  extracted_text: string
  promotional_content: boolean
  confidence: number
  competitor_name: string
}

type Props = {
  photos: PhotoItem[]
}

const CATEGORY_LABELS: Record<string, string> = {
  food_dish: "Food",
  menu_board: "Menu Board",
  interior: "Interior",
  exterior: "Exterior",
  patio_outdoor: "Patio",
  bar_drinks: "Bar & Drinks",
  staff_team: "Staff",
  event_promotion: "Promotion",
  signage: "Signage",
  renovation: "Renovation",
  seasonal_decor: "Seasonal",
  customer_atmosphere: "Atmosphere",
  other: "Other",
}

const CATEGORY_COLORS: Record<string, string> = {
  food_dish: "bg-amber-100 text-amber-700",
  menu_board: "bg-teal-100 text-teal-700",
  interior: "bg-blue-100 text-blue-700",
  exterior: "bg-green-100 text-green-700",
  patio_outdoor: "bg-lime-100 text-lime-700",
  bar_drinks: "bg-purple-100 text-purple-700",
  event_promotion: "bg-rose-100 text-rose-700",
  signage: "bg-cyan-100 text-cyan-700",
}

export default function PhotoGallery({ photos }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string>("")

  if (photos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <svg className="mx-auto h-10 w-10 text-pink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
        </svg>
        <p className="mt-2 text-sm font-medium text-slate-600">No competitor photos analyzed yet</p>
        <p className="text-xs text-slate-400">Photos will appear after the next data refresh</p>
      </div>
    )
  }

  const categories = [...new Set(photos.map(p => p.category))]
  const filtered = selectedCategory
    ? photos.filter(p => p.category === selectedCategory)
    : photos

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <svg className="h-5 w-5 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
        </svg>
        <h3 className="text-sm font-bold text-slate-900">Visual Intelligence</h3>
        <span className="text-xs text-slate-400">{photos.length} photos analyzed</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setSelectedCategory("")}
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
            !selectedCategory ? "bg-pink-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          All ({photos.length})
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
              selectedCategory === cat ? "bg-pink-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {CATEGORY_LABELS[cat] ?? cat} ({photos.filter(p => p.category === cat).length})
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map(photo => (
          <div key={photo.id} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
            {photo.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.image_url}
                alt={photo.subcategory || photo.category}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex aspect-square items-center justify-center bg-slate-100">
                <svg className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5a1.5 1.5 0 001.5 1.5z" />
                </svg>
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />

            <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 transition group-hover:opacity-100">
              <div className="flex flex-wrap gap-1">
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${CATEGORY_COLORS[photo.category] ?? "bg-slate-100 text-slate-700"}`}>
                  {CATEGORY_LABELS[photo.category] ?? photo.category}
                </span>
                {photo.promotional_content && (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    Promo
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] font-medium text-white/90">{photo.competitor_name}</p>
            </div>

            {photo.promotional_content && (
              <div className="absolute right-1.5 top-1.5">
                <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
                  Promo
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
