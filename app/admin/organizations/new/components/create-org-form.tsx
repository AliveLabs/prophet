"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { createDemoOrg, createTestOrg } from "@/app/actions/org-management"

type Kind = "demo" | "test"
type Industry = "restaurant" | "liquor_store"

export function CreateOrgForm({ adminEmail }: { adminEmail: string }) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>("demo")
  const [name, setName] = useState("")
  const [industry, setIndustry] = useState<Industry>("restaurant")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    startTransition(async () => {
      const fn = kind === "demo" ? createDemoOrg : createTestOrg
      const result = await fn({ name: name.trim(), industryType: industry })
      if (result.ok) {
        router.push(`/admin/organizations/${result.orgId}`)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-xl space-y-6 rounded-xl border border-border bg-card p-6"
    >
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div>
        <span className="mb-2 block text-sm font-medium text-foreground">Kind</span>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { value: "demo", label: "Demo", hint: "Polished — for showing prospects." },
              { value: "test", label: "Test", hint: "Throwaway — safe to bulk-clear." },
            ] as const
          ).map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => setKind(opt.value)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                kind === opt.value
                  ? "border-vatic-indigo bg-vatic-indigo/10"
                  : "border-input hover:bg-secondary"
              }`}
            >
              <span className="block text-sm font-semibold text-foreground">{opt.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="org-name" className="mb-2 block text-sm font-medium text-foreground">
          Organization name
        </label>
        <input
          id="org-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Demo Diner"
          className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label htmlFor="org-industry" className="mb-2 block text-sm font-medium text-foreground">
          Industry
        </label>
        <select
          id="org-industry"
          value={industry}
          onChange={(e) => setIndustry(e.target.value as Industry)}
          className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="restaurant">Restaurant</option>
          <option value="liquor_store">Liquor store</option>
        </select>
      </div>

      <p className="rounded-lg bg-secondary/50 px-3.5 py-2.5 text-xs text-muted-foreground">
        Owned by you ({adminEmail}) · non-expiring (1-year trial) · no billing ·
        excluded from real metrics. Add a location via onboarding to pull data.
      </p>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push("/admin/sandbox")}
          className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-vatic-indigo px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create Org"}
        </button>
      </div>
    </form>
  )
}
