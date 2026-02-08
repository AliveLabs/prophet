"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Suspense, useCallback } from "react"

type Props = {
  locations: Array<{ id: string; name: string }>
  selectedLocationId: string
}

function LocationFilterInner({ locations, selectedLocationId }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleChange = useCallback(
    (locationId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      params.set("location_id", locationId)
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  if (locations.length <= 1) return null

  return (
    <select
      value={searchParams?.get("location_id") ?? selectedLocationId}
      onChange={(e) => handleChange(e.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
    >
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  )
}

export default function LocationFilter(props: Props) {
  return (
    <Suspense fallback={<div className="h-8" />}>
      <LocationFilterInner {...props} />
    </Suspense>
  )
}
