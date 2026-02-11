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

type CompetitorMenuData = {
  competitorName: string
  categories: MenuCategory[]
  avgPrice: number | null
  itemCount: number
}

type MenuCompareProps = {
  locationName: string
  locationCategories: MenuCategory[]
  locationAvgPrice: number | null
  competitors: CompetitorMenuData[]
}

function computeAvgPrice(categories: MenuCategory[]): number | null {
  const prices: number[] = []
  for (const cat of categories) {
    for (const item of cat.items) {
      if (item.priceValue != null && item.priceValue > 0) {
        prices.push(item.priceValue)
      }
    }
  }
  if (prices.length === 0) return null
  return prices.reduce((a, b) => a + b, 0) / prices.length
}

function uniqueItems(
  compCategories: MenuCategory[],
  locCategories: MenuCategory[]
): string[] {
  const locNames = new Set(
    locCategories.flatMap((c) =>
      c.items.map((i) => i.name.toLowerCase().trim())
    )
  )
  const unique: string[] = []
  for (const cat of compCategories) {
    for (const item of cat.items) {
      if (!locNames.has(item.name.toLowerCase().trim())) {
        unique.push(item.name)
      }
    }
  }
  return unique
}

export default function MenuCompare({
  locationName,
  locationCategories,
  locationAvgPrice,
  competitors,
}: MenuCompareProps) {
  const [selectedComp, setSelectedComp] = useState(0)

  if (competitors.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm text-slate-500">No competitor menu data available for comparison.</p>
      </div>
    )
  }

  const locItemCount = locationCategories.reduce((s, c) => s + c.items.length, 0)
  const locCatNames = new Set(locationCategories.map((c) => c.name.toLowerCase().trim()))
  const comp = competitors[selectedComp] ?? competitors[0]
  const compAvg = comp.avgPrice ?? computeAvgPrice(comp.categories)
  const locAvg = locationAvgPrice ?? computeAvgPrice(locationCategories)
  const compCatNames = new Set(comp.categories.map((c) => c.name.toLowerCase().trim()))
  const missingCats = [...compCatNames].filter((c) => !locCatNames.has(c))
  const compUniqueItems = uniqueItems(comp.categories, locationCategories)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Competitor Menu Compare</h3>
        {competitors.length > 1 && (
          <select
            value={selectedComp}
            onChange={(e) => setSelectedComp(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
          >
            {competitors.map((c, idx) => (
              <option key={idx} value={idx}>
                {c.competitorName}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Price comparison */}
      <div className="grid grid-cols-2 gap-4 border-b border-slate-100 p-5">
        <div className="rounded-xl bg-indigo-50/60 p-3 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
            {locationName}
          </p>
          <p className="mt-1 text-xl font-bold text-indigo-700">
            {locAvg != null ? `$${locAvg.toFixed(2)}` : "N/A"}
          </p>
          <p className="text-[10px] text-indigo-500">avg price · {locItemCount} items</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {comp.competitorName}
          </p>
          <p className="mt-1 text-xl font-bold text-slate-700">
            {compAvg != null ? `$${compAvg.toFixed(2)}` : "N/A"}
          </p>
          <p className="text-[10px] text-slate-500">avg price · {comp.itemCount} items</p>
        </div>
      </div>

      {/* Category coverage */}
      {missingCats.length > 0 && (
        <div className="border-b border-slate-100 px-5 py-3">
          <p className="text-xs font-semibold text-slate-700">Categories they have that you don&apos;t</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missingCats.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-medium text-amber-700 capitalize"
              >
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Unique items */}
      {compUniqueItems.length > 0 && (
        <div className="px-5 py-3">
          <p className="text-xs font-semibold text-slate-700">
            Items they offer that you don&apos;t ({compUniqueItems.length})
          </p>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {compUniqueItems.slice(0, 15).map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 text-xs text-slate-600"
              >
                <span className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                {item}
              </div>
            ))}
            {compUniqueItems.length > 15 && (
              <p className="text-[10px] text-slate-400">
                +{compUniqueItems.length - 15} more
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
