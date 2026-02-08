"use client"

import { useState, useTransition } from "react"
import LocationSearch from "@/components/places/location-search"
import { Button } from "@/components/ui/button"

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
  website?: string | null
}

type LocationAddFormProps = {
  organizationId: string
  action: (formData: FormData) => void
  buttonLabel?: string
}

export default function LocationAddForm({
  organizationId,
  action,
  buttonLabel = "Add location",
}: LocationAddFormProps) {
  const [selected, setSelected] = useState<PlaceDetails | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <form
      action={(formData) => {
        startTransition(() => action(formData))
      }}
      className="grid gap-4"
    >
      <input type="hidden" name="organization_id" value={organizationId} />
      <LocationSearch
        onSelectPlace={(place) => setSelected(place)}
        onClear={() => setSelected(null)}
      />
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
      {selected ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">{selected.name}</p>
          <p>{selected.address_line1 ?? "Address unavailable"}</p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Select a suggestion to continue.
        </p>
      )}
      <Button type="submit" disabled={!selected || isPending}>
        {buttonLabel}
      </Button>
    </form>
  )
}
