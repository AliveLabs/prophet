"use client"

import { useState, useMemo } from "react"

type MenuItem = {
  name: string
  description: string | null
  price: string | null
  priceValue: number | null
  tags: string[]
}

type MenuType = "dine_in" | "catering" | "banquet" | "happy_hour" | "kids" | "other"

type MenuCategory = {
  name: string
  menuType?: MenuType
  items: MenuItem[]
}

type MenuSource = "firecrawl" | "gemini_google_search"

type MenuViewerProps = {
  categories: MenuCategory[]
  currency: string | null
  itemsTotal: number
  confidence: string
  sources?: MenuSource[]
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

const MENU_TYPE_LABELS: Record<MenuType, string> = {
  dine_in: "Dine-In",
  catering: "Catering",
  banquet: "Banquet",
  happy_hour: "Happy Hour",
  kids: "Kids",
  other: "Other",
}

const MENU_TYPE_COLORS: Record<MenuType, string> = {
  dine_in: "bg-indigo-100 text-indigo-700 border-indigo-200",
  catering: "bg-orange-100 text-orange-700 border-orange-200",
  banquet: "bg-purple-100 text-purple-700 border-purple-200",
  happy_hour: "bg-amber-100 text-amber-700 border-amber-200",
  kids: "bg-pink-100 text-pink-700 border-pink-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
}

function SourceBadge({ source }: { source: MenuSource }) {
  if (source === "firecrawl") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700 border border-cyan-200">
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        Firecrawl
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
      Google
    </span>
  )
}

export default function MenuViewer({
  categories,
  currency,
  itemsTotal,
  confidence,
  sources,
}: MenuViewerProps) {
  const menuTypes = useMemo(() => {
    const types = new Set<MenuType>()
    for (const cat of categories) {
      types.add(cat.menuType ?? "dine_in")
    }
    return Array.from(types)
  }, [categories])

  const [activeMenuType, setActiveMenuType] = useState<MenuType>("dine_in")
  const [activeCategory, setActiveCategory] = useState(0)

  const filteredCategories = useMemo(() => {
    if (menuTypes.length <= 1) return categories
    return categories.filter((c) => (c.menuType ?? "dine_in") === activeMenuType)
  }, [categories, activeMenuType, menuTypes.length])

  const filteredItemsTotal = filteredCategories.reduce((s, c) => s + c.items.length, 0)

  if (categories.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm text-slate-500">No menu items found.</p>
      </div>
    )
  }

  const active = filteredCategories[activeCategory] ?? filteredCategories[0]

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
        <div className="flex items-center gap-2">
          {sources && sources.length > 0 && (
            <div className="flex items-center gap-1">
              {sources.map((s) => (
                <SourceBadge key={s} source={s} />
              ))}
            </div>
          )}
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
      </div>

      {/* Menu type tabs (dine-in / catering / etc.) */}
      {menuTypes.length > 1 && (
        <div className="flex gap-2 border-b border-slate-100 px-4 py-2">
          {menuTypes.map((mt) => {
            const count = categories
              .filter((c) => (c.menuType ?? "dine_in") === mt)
              .reduce((s, c) => s + c.items.length, 0)
            return (
              <button
                key={mt}
                onClick={() => {
                  setActiveMenuType(mt)
                  setActiveCategory(0)
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mt === activeMenuType
                    ? MENU_TYPE_COLORS[mt]
                    : "border-slate-200 text-slate-400 hover:text-slate-600"
                }`}
              >
                {MENU_TYPE_LABELS[mt]}
                <span className="ml-1 text-[10px] opacity-70">({count})</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2">
        {filteredCategories.map((cat, idx) => (
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

      {/* Filtered totals */}
      {menuTypes.length > 1 && (
        <div className="px-5 pt-2 text-[10px] text-slate-400">
          Showing {filteredItemsTotal} {MENU_TYPE_LABELS[activeMenuType].toLowerCase()} items
        </div>
      )}

      {/* Items grid */}
      {active && (
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
      )}
    </div>
  )
}
