"use client"

// ALT-754 / ALT-689: buying capacity for another location, from the screen where someone is
// actually trying to add one.
//
// What used to be here: a card saying "upgrade your plan to manage up to N locations", gated on
// `nextTierWithMoreLocations(tier)`. Every tier now includes exactly ONE location, so that function
// returned null for all of them and the card never rendered. The only offer left on the page was
// "stand it up as its own separately-billed account", which for a Standard operator meant $299
// instead of a $275 add-on, two logins and two bills. That is ALT-754: "the product's only offer is
// a second account at above list price."
//
// On success this just refreshes. The page's own `canAddLocationHere` check then passes, so the
// place-picker form replaces this screen and the customer carries on with what they came to do.
// No redirect, no success page, no second click.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { TkButton } from "@/components/ticket"
import { classifyBillingMutation, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"

type Props = {
  /** Current billed location add-on quantity. The purchase target is this plus one. */
  locationsPurchased: number
  /** Unit price to show, already resolved for the org's plan and cadence. */
  unitPrice: number
  perLabel: string
}

export function BuyLocationCard({ locationsPurchased, unitPrice, perLabel }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = locationsPurchased + 1

  async function go(previewOnly: boolean) {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/stripe/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "location", quantity: target, preview: previewOnly }),
      })
      const payload = await res.json().catch(() => null)
      const outcome = classifyBillingMutation(res.ok, payload)
      if (outcome.kind === "error") {
        setError(outcome.message)
        setBusy(false)
        return
      }
      if (previewOnly) {
        setConfirming(true)
        setBusy(false)
        return
      }
      // The page re-reads the allowance and swaps this card for the place picker.
      router.refresh()
    } catch {
      setError(GENERIC_BILLING_ERROR)
      setBusy(false)
    }
  }

  return (
    <>
      <h2>Add it to this account</h2>
      <p>
        One more location on this plan, at <b>${unitPrice.toLocaleString()}{perLabel}</b>. One login,
        one bill, and it gets its own competitors, signals, and brief.
      </p>
      {confirming ? (
        <>
          <p className="tk-set-hint">
            Today&rsquo;s charge is prorated for the rest of your billing period, so it will be less
            than a full month. You can remove it again from billing at any time.
          </p>
          <div className="tk-set-row-actions">
            <TkButton variant="add" onClick={() => go(false)} disabled={busy}>
              {busy ? "Adding…" : "Confirm and add"}
            </TkButton>
            <TkButton variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </TkButton>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="loc-path-link"
          onClick={() => go(true)}
          disabled={busy}
        >
          {busy ? "Checking…" : "Add a location to this plan"}
        </button>
      )}
      {error && <span className="tk-set-status tk-set-status-err">{error}</span>}
    </>
  )
}
