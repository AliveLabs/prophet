"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

type Prediction = {
  description: string
  place_id: string
}

export type PlaceDetails = {
  primary_place_id: string
  name: string
  category?: string | null
  types?: string[]
  address_line1: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  geo_lat: number | null
  geo_lng: number | null
  website?: string | null
}

type LocationSearchProps = {
  onSelectPlace?: (place: PlaceDetails) => void
  onClear?: () => void
  className?: string
  placeholder?: string
}

export default function LocationSearch({ onSelectPlace, onClear, className, placeholder }: LocationSearchProps) {
  const [query, setQuery] = useState("")
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [selected, setSelected] = useState<PlaceDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null)

  const canSearch = useMemo(() => query.trim().length > 2, [query])

  // Best-effort geolocation once on mount so autocomplete can bias results to the
  // user's region. Failure or denial is non-blocking — autocomplete still works,
  // just without the bias.
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) return
    let active = true
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!active) return
        const { latitude, longitude } = position.coords
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          coordsRef.current = { lat: latitude, lng: longitude }
        }
      },
      () => {
        // Permission denied or unavailable; stay unbiased.
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 5000 }
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!canSearch) {
      setPredictions([])
      return
    }

    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ input: query })
        const coords = coordsRef.current
        if (coords) {
          params.set("lat", String(coords.lat))
          params.set("lng", String(coords.lng))
        }
        const response = await fetch(`/api/places/autocomplete?${params.toString()}`)
        const data = await response.json()
        if (active) {
          setPredictions(data.predictions ?? [])
          setError(data.ok === false ? data.message ?? "Search failed" : null)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }, 300)

    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [query, canSearch])

  async function handleSelect(prediction: Prediction) {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(prediction.place_id)}`
      )
      const data = await response.json()
      if (data.place) {
        setSelected(data.place)
        setQuery(data.place.name)
        setPredictions([])
        onSelectPlace?.(data.place)
      } else {
        setError(data.message ?? "Unable to load place details")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelected(null)
          onClear?.()
        }}
        placeholder={placeholder ?? "Search by business name"}
        className={className ?? "bg-card text-foreground"}
      />
      {loading ? (
        <p className="mt-2 text-xs text-muted-foreground">Searching...</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : null}
      {predictions.length > 0 ? (
        <div className="absolute z-10 mt-2 w-full rounded-xl border border-border bg-card p-2 text-sm text-foreground shadow-lg">
          {predictions.map((prediction) => (
            <button
              key={prediction.place_id}
              type="button"
              onClick={() => handleSelect(prediction)}
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-secondary"
            >
              {prediction.description}
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <>
          <input type="hidden" name="primary_place_id" value={selected.primary_place_id} />
          <input type="hidden" name="location_name" value={selected.name} />
          <input type="hidden" name="category" value={selected.category ?? ""} />
          <input
            type="hidden"
            name="place_types"
            value={JSON.stringify(selected.types ?? [])}
          />
          <input type="hidden" name="address_line1" value={selected.address_line1 ?? ""} />
          <input type="hidden" name="city" value={selected.city ?? ""} />
          <input type="hidden" name="region" value={selected.region ?? ""} />
          <input type="hidden" name="postal_code" value={selected.postal_code ?? ""} />
          <input type="hidden" name="country" value={selected.country ?? ""} />
          <input type="hidden" name="geo_lat" value={selected.geo_lat ?? ""} />
          <input type="hidden" name="geo_lng" value={selected.geo_lng ?? ""} />
          <input type="hidden" name="website" value={selected.website ?? ""} />
        </>
      ) : null}
    </div>
  )
}
