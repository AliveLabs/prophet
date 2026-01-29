"use client"

import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type LocationOption = {
  id: string
  name: string | null
}

type DiscoverFormProps = {
  locations: LocationOption[]
  action: (formData: FormData) => void
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Discovering..." : "Discover competitors"}
    </Button>
  )
}

export default function DiscoverForm({ locations, action }: DiscoverFormProps) {
  return (
    <form action={action} className="mt-5 flex flex-wrap gap-3">
      <select
        name="location_id"
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
      <SubmitButton disabled={locations.length === 0} />
      <p className="w-full text-xs text-slate-500">
        This can take ~10-15 seconds while we search and enrich results.
      </p>
    </form>
  )
}
