"use client"

import { useState } from "react"

type MenuItem = {
  name: string
  description: string | null
  price: string | null
  priceValue: number | null
  tags: string[]
}

type MenuCategory = {
  name: string
  items: MenuItem[]
}

type MenuViewerProps = {
  categories: MenuCategory[]
  currency: string | null
  itemsTotal: number
  confidence: string
}

const TAG_COLORS: Record<string, string> = {
  vegan: "bg-green-100 text-green-700",
  vegetarian: "bg-emerald-100 text-emerald-700",
  "gluten-free": "bg-amber-100 text-amber-700",
  spicy: "bg-red-100 text-red-700",
  organic: "bg-lime-100 text-lime-700",
  new: "bg-blue-100 text-blue-700",
  popular: "bg-purple-100 text-purple-700",
}

export default function MenuViewer({
  categories,
  currency,
  itemsTotal,
  confidence,
}: MenuViewerProps) {
  const [activeCategory, setActiveCategory] = useState(0)

  if (categories.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm text-slate-500">No menu items found.</p>
      </div>
    )
  }

  const active = categories[activeCategory] ?? categories[0]

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Menu</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {itemsTotal} items across {categories.length} categories
            {currency ? ` · ${currency}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            confidence === "high"
              ? "bg-green-100 text-green-700"
              : confidence === "medium"
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {confidence} confidence
        </span>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2">
        {categories.map((cat, idx) => (
          <button
            key={cat.name}
            onClick={() => setActiveCategory(idx)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              idx === activeCategory
                ? "bg-indigo-100 text-indigo-700"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            }`}
          >
            {cat.name}
            <span className="ml-1 text-[10px] opacity-60">({cat.items.length})</span>
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {active.items.map((item, idx) => (
          <div
            key={`${item.name}-${idx}`}
            className="group rounded-xl border border-slate-100 bg-gradient-to-br from-white to-slate-50/50 p-3.5 transition-shadow hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                {item.name}
              </h4>
              {item.price && (
                <span className="shrink-0 rounded-lg bg-indigo-50 px-2 py-0.5 text-sm font-bold text-indigo-700">
                  {item.price}
                </span>
              )}
            </div>
            {item.description && (
              <p className="mt-1 text-xs leading-relaxed text-slate-500 line-clamp-2">
                {item.description}
              </p>
            )}
            {item.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      TAG_COLORS[tag] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
