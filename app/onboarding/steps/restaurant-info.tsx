"use client"

import LocationSearch, { type PlaceDetails } from "@/components/places/location-search"

const CUISINES = [
  "American",
  "Italian",
  "Mexican",
  "Asian",
  "Bar & Grill",
  "Café",
  "Seafood",
  "Pizza",
  "Other",
]

type RestaurantInfoStepProps = {
  restaurantName: string
  onNameChange: (name: string) => void
  selectedPlace: PlaceDetails | null
  onPlaceSelect: (place: PlaceDetails | null) => void
  cuisine: string | null
  onCuisineChange: (cuisine: string | null) => void
}

export default function RestaurantInfoStep({
  restaurantName,
  onNameChange,
  selectedPlace,
  onPlaceSelect,
  cuisine,
  onCuisineChange,
}: RestaurantInfoStepProps) {
  return (
    <section className="flex flex-col pt-10 pb-8 max-[540px]:pt-8">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-precision-teal mb-3">
        Your Restaurant
      </div>
      <h2 className="font-display text-[32px] font-medium leading-[1.15] text-foreground mb-3 max-[540px]:text-[27px]">
        Tell us about
        <br />
        <em className="text-vatic-indigo-soft italic">your place.</em>
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-6">
        We&apos;ll use this to find what&apos;s happening in your neighborhood.
      </p>

      <div className="flex flex-col gap-4 mb-6">
        {/* Restaurant name */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Restaurant Name
          </label>
          <input
            type="text"
            value={restaurantName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. The Rustic Fork"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-[10px] border border-border bg-card/40 px-4 py-[13px] text-[15px] text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-vatic-indigo/50 focus:ring-[3px] focus:ring-vatic-indigo/12 caret-vatic-indigo-soft"
          />
        </div>

        {/* Address */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Address
          </label>
          <LocationSearch
            onSelectPlace={onPlaceSelect}
            onClear={() => onPlaceSelect(null)}
            placeholder="Street address or neighborhood"
            className="rounded-[10px] border-border bg-card/40 py-[13px] text-[15px] placeholder:text-muted-foreground focus:border-vatic-indigo/50 focus:ring-[3px] focus:ring-vatic-indigo/12"
          />
        </div>

        {/* Cuisine type */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cuisine Type
          </label>
          <div className="flex flex-wrap gap-2 mt-1">
            {CUISINES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onCuisineChange(cuisine === c ? null : c)}
                className={`rounded-full px-3.5 py-2.5 text-[13px] border transition-all select-none ${
                  cuisine === c
                    ? "bg-vatic-indigo/14 border-vatic-indigo/45 text-vatic-indigo-soft font-medium"
                    : "bg-card/40 border-border text-muted-foreground hover:border-vatic-indigo/30 hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
