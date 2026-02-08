"use client"

import { Input } from "@/components/ui/input"
import RefreshOverlay from "@/components/ui/refresh-overlay"

type LocationOption = {
  id: string
  name: string | null
}

type DiscoverFormProps = {
  locations: LocationOption[]
  action: (formData: FormData) => void
  selectedLocationId?: string
  quickFacts?: string[]
}

export default function DiscoverForm({
  locations,
  action,
  selectedLocationId,
  quickFacts = [],
}: DiscoverFormProps) {
  const geminiContext = locations.length > 0
    ? `Local business discovery: ${locations.length} location(s). Looking to discover nearby competitors for competitive analysis.`
    : ""

  return (
    <form action={action} className="mt-5 space-y-3">
      <div className="flex flex-wrap gap-3">
        <select
          name="location_id"
          defaultValue={selectedLocationId ?? locations[0]?.id ?? ""}
          className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name ?? "Untitled location"}
            </option>
          ))}
        </select>
        <Input
          name="query"
          placeholder="Optional category or keyword"
          className="min-w-[220px] bg-white text-slate-900"
        />
      </div>

      <RefreshOverlay
        label="Discover competitors"
        pendingLabel="Discovering competitors"
        quickFacts={quickFacts}
        geminiContext={geminiContext}
        steps={[
          "Searching nearby businesses...",
          "Resolving Place IDs...",
          "Fetching Google Places details...",
          "Enriching competitor profiles...",
          "Calculating relevance scores...",
          "Saving results...",
        ]}
      />
      <p className="text-xs text-slate-500">
        This can take ~10-15 seconds while we search and enrich results.
      </p>
    </form>
  )
}
