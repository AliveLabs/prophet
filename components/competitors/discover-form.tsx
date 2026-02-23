"use client"

import { Input } from "@/components/ui/input"
import RefreshOverlay from "@/components/ui/refresh-overlay"

type DiscoverFormProps = {
  action: (formData: FormData) => void
  selectedLocationId?: string
  quickFacts?: string[]
}

export default function DiscoverForm({
  action,
  selectedLocationId,
  quickFacts = [],
}: DiscoverFormProps) {
  const geminiContext = selectedLocationId
    ? "Local business discovery. Looking to discover nearby competitors for competitive analysis."
    : ""

  return (
    <form action={action} className="mt-5 space-y-3">
      <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
      <Input
        name="query"
        placeholder="Optional category or keyword"
        className="max-w-sm bg-white text-slate-900"
      />

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
