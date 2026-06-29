"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { createDemoOrg, createTestOrg } from "@/app/actions/org-management"
import { TkButton } from "@/components/ticket"

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
    <form onSubmit={handleSubmit} className="tk-card ao-formcard">
      <div className="ao-form">
        {error && (
          <div className="ao-banner ao-banner-alert" role="alert">
            <div className="ao-bt">
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="ao-field">
          <span className="ao-flabel">Kind</span>
          <div className="ao-segs">
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
                aria-pressed={kind === opt.value}
                className={`ao-seg ${kind === opt.value ? "ao-seg-on" : ""}`}
              >
                <span className="ao-seg-t">{opt.label}</span>
                <span className="ao-seg-h">{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ao-field">
          <label htmlFor="org-name">Organization name</label>
          <input
            id="org-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Demo Diner"
            className="ao-input"
          />
        </div>

        <div className="ao-field">
          <label htmlFor="org-industry">Industry</label>
          <select
            id="org-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value as Industry)}
            className="ao-select"
            style={{ width: "100%" }}
          >
            <option value="restaurant">Restaurant</option>
            <option value="liquor_store">Liquor store</option>
          </select>
        </div>

        <p className="ao-hint">
          Owned by you (<b>{adminEmail}</b>) · non-expiring (1-year trial) · no
          billing · excluded from real metrics. Next, hit{" "}
          <b>Set up demo</b> on its page to pick the restaurant, choose
          competitors, and pull live data.
        </p>

        <div className="ao-form-foot">
          <TkButton
            variant="ghost"
            onClick={() => router.push("/admin/sandbox")}
          >
            Cancel
          </TkButton>
          <TkButton type="submit" variant="act" disabled={isPending}>
            {isPending ? "Creating…" : "Create org"}
          </TkButton>
        </div>
      </div>
    </form>
  )
}
