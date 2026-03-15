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

function filterByMenuType(categories: MenuCategory[], menuType: MenuType): MenuCategory[] {
  return categories.filter((c) => (c.menuType ?? "dine_in") === menuType)
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

const COMPARE_TYPE_LABELS: Record<string, string> = {
  dine_in: "Dine-In",
  catering: "Catering",
  banquet: "Banquet",
  happy_hour: "Happy Hour",
  kids: "Kids",
  other: "Other",
}

export default function MenuCompare({
  locationName,
  locationCategories,
  locationAvgPrice,
  competitors,
}: MenuCompareProps) {
  const [selectedComp, setSelectedComp] = useState(0)

  const allMenuTypes = useMemo(() => {
    const types = new Set<MenuType>()
    for (const c of locationCategories) types.add(c.menuType ?? "dine_in")
    for (const comp of competitors) {
      for (const c of comp.categories) types.add(c.menuType ?? "dine_in")
    }
    return Array.from(types)
  }, [locationCategories, competitors])

  const [compareType, setCompareType] = useState<MenuType>("dine_in")

  if (competitors.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">No competitor menu data available for comparison.</p>
      </div>
    )
  }

  const comp = competitors[selectedComp] ?? competitors[0]

  const filteredLocCats = filterByMenuType(locationCategories, compareType)
  const filteredCompCats = filterByMenuType(comp.categories, compareType)

  const locAvg = computeAvgPrice(filteredLocCats) ?? locationAvgPrice
  const compAvg = computeAvgPrice(filteredCompCats) ?? comp.avgPrice
  const locItemCount = filteredLocCats.reduce((s, c) => s + c.items.length, 0)
  const compItemCount = filteredCompCats.reduce((s, c) => s + c.items.length, 0)

  const locCatNames = new Set(filteredLocCats.map((c) => c.name.toLowerCase().trim()))
  const compCatNames = new Set(filteredCompCats.map((c) => c.name.toLowerCase().trim()))
  const missingCats = [...compCatNames].filter((c) => !locCatNames.has(c))
  const compUniqueItems = uniqueItems(filteredCompCats, filteredLocCats)

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-foreground">Competitor Menu Compare</h3>
        <div className="flex items-center gap-2">
          {allMenuTypes.length > 1 && (
            <select
              value={compareType}
              onChange={(e) => setCompareType(e.target.value as MenuType)}
              className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground"
            >
              {allMenuTypes.map((mt) => (
                <option key={mt} value={mt}>{COMPARE_TYPE_LABELS[mt] ?? mt}</option>
              ))}
            </select>
          )}
          {competitors.length > 1 && (
            <select
              value={selectedComp}
              onChange={(e) => setSelectedComp(Number(e.target.value))}
              className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground"
            >
              {competitors.map((c, idx) => (
                <option key={idx} value={idx}>
                  {c.competitorName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Price comparison */}
      <div className="grid grid-cols-2 gap-4 border-b border-border p-5">
        <div className="rounded-xl bg-primary/10 p-3 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            {locationName}
          </p>
          <p className="mt-1 text-xl font-bold text-primary">
            {locAvg != null ? `$${locAvg.toFixed(2)}` : "N/A"}
          </p>
          <p className="text-[10px] text-primary">
            avg {COMPARE_TYPE_LABELS[compareType]?.toLowerCase() ?? ""} price · {locItemCount} items
          </p>
        </div>
        <div className="rounded-xl bg-secondary p-3 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {comp.competitorName}
          </p>
          <p className="mt-1 text-xl font-bold text-foreground">
            {compAvg != null ? `$${compAvg.toFixed(2)}` : "N/A"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            avg {COMPARE_TYPE_LABELS[compareType]?.toLowerCase() ?? ""} price · {compItemCount} items
          </p>
        </div>
      </div>

      {/* Category coverage */}
      {missingCats.length > 0 && (
        <div className="border-b border-border px-5 py-3">
          <p className="text-xs font-semibold text-foreground">Categories they have that you don&apos;t</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missingCats.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-signal-gold/15 px-2.5 py-0.5 text-[10px] font-medium text-signal-gold capitalize"
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
          <p className="text-xs font-semibold text-foreground">
            Items they offer that you don&apos;t ({compUniqueItems.length})
          </p>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {compUniqueItems.slice(0, 15).map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="h-1 w-1 shrink-0 rounded-full bg-muted" />
                {item}
              </div>
            ))}
            {compUniqueItems.length > 15 && (
              <p className="text-[10px] text-muted-foreground">
                +{compUniqueItems.length - 15} more
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
