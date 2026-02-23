"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useState, useRef, useEffect } from "react"

type Location = { id: string; name: string }

type Props = {
  locations: Location[]
  selectedLocationId: string | null
  activeTab: string
  venueFilter: string
  matchedOnly: boolean
}

function EventsFiltersInner({
  locations,
  selectedLocationId,
  activeTab,
  venueFilter,
  matchedOnly,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [venue, setVenue] = useState(venueFilter)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const navigate = useCallback(
    (overrides: Record<string, string>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      for (const [k, v] of Object.entries(overrides)) {
        if (v) params.set(k, v)
        else params.delete(k)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const handleVenueChange = useCallback(
    (value: string) => {
      setVenue(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        navigate({ venue: value })
      }, 400)
    },
    [navigate]
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-2">
      {locations.length > 1 && (
        <select
          value={searchParams?.get("location_id") ?? selectedLocationId ?? ""}
          onChange={(e) => navigate({ location_id: e.target.value })}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id} className="text-slate-900">
              {l.name}
            </option>
          ))}
        </select>
      )}

      <select
        value={searchParams?.get("tab") ?? activeTab}
        onChange={(e) => navigate({ tab: e.target.value })}
        className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30"
      >
        <option value="weekend" className="text-slate-900">This Weekend</option>
        <option value="week" className="text-slate-900">This Week</option>
      </select>

      <div className="relative">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={venue}
          onChange={(e) => handleVenueChange(e.target.value)}
          placeholder="Search venues..."
          className="w-40 rounded-lg border border-white/20 bg-white/10 py-1.5 pl-8 pr-3 text-xs font-medium text-white placeholder-white/40 backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
      </div>

      <button
        type="button"
        onClick={() => navigate({ matched: matchedOnly ? "" : "true" })}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition ${
          matchedOnly
            ? "border-emerald-300/40 bg-emerald-400/20 text-emerald-100"
            : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
        }`}
      >
        <span className="flex items-center gap-1.5">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          Matched only
        </span>
      </button>
    </div>
  )
}

export default function EventsFilters(props: Props) {
  return (
    <Suspense fallback={<div className="h-8" />}>
      <EventsFiltersInner {...props} />
    </Suspense>
  )
}
