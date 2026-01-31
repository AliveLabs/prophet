"use client"

import { useEffect, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"

type Prediction = {
  description: string
  place_id: string
}

type PlaceDetails = {
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
}

type LocationSearchProps = {
  onSelectPlace?: (place: PlaceDetails) => void
  onClear?: () => void
}

export default function LocationSearch({ onSelectPlace, onClear }: LocationSearchProps) {
  const [query, setQuery] = useState("")
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [selected, setSelected] = useState<PlaceDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSearch = useMemo(() => query.trim().length > 2, [query])

  useEffect(() => {
    let active = true
    if (!canSearch) {
      setPredictions([])
      return
    }

    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(query)}`)
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
        placeholder="Search by business name"
        className="bg-white text-slate-900"
      />
      {loading ? (
        <p className="mt-2 text-xs text-slate-500">Searching...</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-rose-600">{error}</p>
      ) : null}
      {predictions.length > 0 ? (
        <div className="absolute z-10 mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-700 shadow-lg">
          {predictions.map((prediction) => (
            <button
              key={prediction.place_id}
              type="button"
              onClick={() => handleSelect(prediction)}
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
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
        </>
      ) : null}
    </div>
  )
}
