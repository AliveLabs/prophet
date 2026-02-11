"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Suspense, useCallback } from "react"

type Props = {
  locations: Array<{ id: string; name: string }>
  selectedLocationId: string
  activeTab: string
}

function VisibilityFiltersInner({ locations, selectedLocationId, activeTab }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const navigate = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <select
        value={searchParams?.get("location_id") ?? selectedLocationId}
        onChange={(e) => navigate({ location_id: e.target.value })}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => navigate({ tab: "organic" })}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            activeTab === "organic"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Organic
        </button>
        <button
          type="button"
          onClick={() => navigate({ tab: "paid" })}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            activeTab === "paid"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Paid
        </button>
      </div>
    </div>
  )
}

export default function VisibilityFilters(props: Props) {
  return (
    <Suspense fallback={<div className="mt-4 h-8" />}>
      <VisibilityFiltersInner {...props} />
    </Suspense>
  )
}
