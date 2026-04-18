"use client"

import LocationSearch, { type PlaceDetails } from "@/components/places/location-search"
import type { VerticalConfig } from "@/lib/verticals"

const DEFAULT_CUISINES = [
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

type BusinessInfoStepProps = {
  businessName: string
  onNameChange: (name: string) => void
  selectedPlace: PlaceDetails | null
  onPlaceSelect: (place: PlaceDetails | null) => void
  cuisine: string | null
  onCuisineChange: (cuisine: string | null) => void
  verticalConfig?: VerticalConfig
}

export default function BusinessInfoStep({
  businessName,
  onNameChange,
  selectedPlace: _selectedPlace,
  onPlaceSelect,
  cuisine,
  onCuisineChange,
  verticalConfig,
}: BusinessInfoStepProps) {
  void _selectedPlace

  const categories = verticalConfig?.businessCategories ?? DEFAULT_CUISINES
  const categoryLabel = verticalConfig?.onboarding.businessInfo.categoryLabel ?? "Cuisine Type"
  const namePlaceholder = verticalConfig?.onboarding.businessInfo.namePlaceholder ?? "e.g. The Rustic Fork"
  const sectionTitle = verticalConfig?.onboarding.businessInfo.title ?? "Your Restaurant"
  const nameLabel = `${verticalConfig?.labels.businessLabelCapitalized ?? "Restaurant"} Name`

  return (
    <section className="flex flex-col pt-10 pb-8 max-[540px]:pt-8">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-precision-teal mb-3">
        {sectionTitle}
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
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {nameLabel}
          </label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={namePlaceholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-[10px] border border-border bg-card/40 px-4 py-[13px] text-[15px] text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-vatic-indigo/50 focus:ring-[3px] focus:ring-vatic-indigo/12 caret-vatic-indigo-soft"
          />
        </div>

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

        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {categoryLabel}
          </label>
          <div className="flex flex-wrap gap-2 mt-1">
            {categories.map((c) => (
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
