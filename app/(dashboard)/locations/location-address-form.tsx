"use client"

// ALT-224 — map-verified address editor for your OWN location. The operator searches Google
// Places and picks the verified address; on submit we write the address + coordinates and
// re-link primary_place_id to that place (keeps the data link correct when a business moves).
// Reuses the same <LocationSearch/> autocomplete the add-location flow uses. The name/website
// edits live in the sibling form; this one only touches the address.

import { useState, useTransition } from "react"
import LocationSearch from "@/components/places/location-search"
import { TkButton } from "@/components/ticket"

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

export default function LocationAddressForm({
  locationId,
  currentAddress,
  action,
}: {
  locationId: string
  currentAddress: string | null
  action: (formData: FormData) => void
}) {
  const [selected, setSelected] = useState<PlaceDetails | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <form
      action={(formData) => startTransition(() => action(formData))}
      className="loc-addr-form"
    >
      <input type="hidden" name="location_id" value={locationId} />
      <span className="loc-field-lbl">Address (map-verified)</span>
      {currentAddress ? (
        <p className="loc-field-hint">Current: <b>{currentAddress}</b></p>
      ) : null}
      <LocationSearch
        onSelectPlace={(place) => setSelected(place)}
        onClear={() => setSelected(null)}
      />
      {selected ? (
        <>
          <input type="hidden" name="primary_place_id" value={selected.primary_place_id} />
          <input type="hidden" name="address_line1" value={selected.address_line1 ?? ""} />
          <input type="hidden" name="city" value={selected.city ?? ""} />
          <input type="hidden" name="region" value={selected.region ?? ""} />
          <input type="hidden" name="postal_code" value={selected.postal_code ?? ""} />
          <input type="hidden" name="country" value={selected.country ?? ""} />
          <input type="hidden" name="geo_lat" value={selected.geo_lat ?? ""} />
          <input type="hidden" name="geo_lng" value={selected.geo_lng ?? ""} />
          <p className="loc-addr-picked">
            New address: <b>{selected.address_line1 ?? selected.name}</b>
          </p>
        </>
      ) : (
        <span className="loc-field-hint">
          Search and pick your location to update its verified address. We only do this for your
          own location — competitor addresses follow Google.
        </span>
      )}
      <TkButton variant="add" type="submit" disabled={!selected || isPending}>
        {isPending ? "Saving…" : "Update address"}
      </TkButton>
    </form>
  )
}
