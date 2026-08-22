"use client"

// ALT-689 part 2: buy and remove add-on quantities without a support conversation.
//
// Two rules from the ticket drive the whole shape of this:
//
//   "Say what will be charged BEFORE confirming."   → nothing writes on the first click. A change
//                                                     previews first, and the preview states the
//                                                     recurring amount plus the fact that today is
//                                                     prorated. Deliberately NOT a to-the-cent
//                                                     figure: that would be a second source of
//                                                     truth for a number Stripe owns, and the
//                                                     customer's real question is "what does this
//                                                     cost me per month".
//   "Removing must be as easy as adding."           → the same stepper goes both ways, and going to
//                                                     zero is one control, not a hidden support path.
//                                                     If it is easy to add and hard to remove, we
//                                                     built a trap.
//
// Competitor slots are per LOCATION (ALT-756), so that half asks which location. Location slots are
// org-wide, so that half does not.

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { TkButton } from "@/components/ticket"
import { classifyBillingMutation, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"
import {
  ADD_ON_PRICING,
  addOnLocationPrice,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"

type LocationRow = { id: string; name: string; competitorsPurchased: number }

type Props = {
  tier: SubscriptionTier
  cadence: Cadence | null
  trialing: boolean
  locationsPurchased: number
  competitorsBilled: number
  locations: LocationRow[]
}

type Preview = {
  quantity: number
  delta: number
  unit: number
  total: number
  perLabel: string
}

const MONEY = (n: number) => `$${n.toLocaleString()}`

export function AddOnControlsPass({
  tier,
  cadence,
  trialing,
  locationsPurchased,
  competitorsBilled,
  locations,
}: Props) {
  const router = useRouter()

  // Which location gets competitor slots. Defaults to the first, and the picker only appears when
  // there is a choice to make.
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "")
  const selected = locations.find((l) => l.id === locationId) ?? locations[0] ?? null

  const [locationQty, setLocationQty] = useState(locationsPurchased)
  const [competitorQty, setCompetitorQty] = useState(selected?.competitorsPurchased ?? 0)

  const [pending, setPending] = useState<"location" | "competitor" | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const locationUnit =
    cadence === "annual"
      ? addOnLocationPrice(tier).annualEffectiveMonthly
      : addOnLocationPrice(tier).monthly
  const competitorUnit =
    cadence === "annual"
      ? ADD_ON_PRICING.competitor.annualEffectiveMonthly
      : ADD_ON_PRICING.competitor.monthly
  const perLabel = cadence === "annual" ? "/month, billed yearly" : "/month"

  // A trial has no add-ons by decision, so say so once and clearly rather than showing controls
  // that refuse on click.
  if (trialing) {
    return (
      <div className="tk-addon-panel">
        <p className="tk-set-hint">
          Add-ons are available once your plan starts. Your trial already includes everything in your
          plan, and nothing is charged while it runs.
        </p>
        <div className="tk-set-row-actions">
          <Link className="tk-set-linkbtn" href="/settings/billing#plan">
            See your plan
          </Link>
        </div>
      </div>
    )
  }

  function resetSelection(next: string) {
    setLocationId(next)
    const row = locations.find((l) => l.id === next)
    setCompetitorQty(row?.competitorsPurchased ?? 0)
    setPending(null)
    setPreview(null)
    setError(null)
  }

  async function call(kind: "location" | "competitor", quantity: number, previewOnly: boolean) {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/stripe/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          quantity,
          locationId: kind === "competitor" ? locationId : undefined,
          preview: previewOnly,
        }),
      })
      // Parse defensively so an HTML error page surfaces as a message rather than throwing into the
      // catch and hiding the route's own reason (ALT-551).
      const payload = await res.json().catch(() => null)
      const outcome = classifyBillingMutation(res.ok, payload)
      if (outcome.kind === "error") {
        setError(outcome.message)
        setBusy(false)
        return
      }
      if (previewOnly) {
        setPreview({
          quantity: payload?.quantity ?? quantity,
          delta: payload?.delta ?? 0,
          unit: payload?.unit ?? 0,
          total: payload?.total ?? 0,
          perLabel: payload?.perLabel ?? perLabel,
        })
        setPending(kind)
        setBusy(false)
        return
      }
      setPending(null)
      setPreview(null)
      router.refresh()
    } catch {
      setError(GENERIC_BILLING_ERROR)
      setBusy(false)
    }
  }

  const stepper = (
    value: number,
    setValue: (n: number) => void,
    disabled: boolean,
    label: string,
  ) => (
    <div className="tk-addon-stepper" role="group" aria-label={label}>
      <TkButton
        variant="ghost"
        onClick={() => setValue(Math.max(0, value - 1))}
        disabled={disabled || value <= 0}
        aria-label={`One fewer: ${label}`}
      >
        −
      </TkButton>
      <span className="tk-addon-qty" aria-live="polite">
        {value}
      </span>
      <TkButton
        variant="ghost"
        onClick={() => setValue(value + 1)}
        disabled={disabled}
        aria-label={`One more: ${label}`}
      >
        +
      </TkButton>
    </div>
  )

  const confirmRow = (kind: "location" | "competitor") => {
    if (pending !== kind || !preview) return null
    const goingUp = preview.delta > 0
    return (
      <div className="tk-addon-confirm">
        <p className="tk-set-hint">
          {goingUp ? "Adding" : "Removing"} {Math.abs(preview.delta)}
          {". "}
          {preview.total > 0 ? (
            <>
              This add-on becomes <b>{MONEY(preview.total)}{preview.perLabel}</b>.{" "}
              {goingUp
                ? "Today's charge is prorated for the rest of your billing period, so it will be less than a full month."
                : "Your next invoice is adjusted for the rest of your billing period."}
            </>
          ) : (
            <>
              This add-on comes off your plan. Your next invoice is adjusted for the rest of your
              billing period.
            </>
          )}
        </p>
        <div className="tk-set-row-actions">
          <TkButton
            variant="add"
            onClick={() => call(kind, preview.quantity, false)}
            disabled={busy}
          >
            {busy ? "Saving…" : goingUp ? "Confirm and pay" : "Confirm removal"}
          </TkButton>
          <TkButton
            variant="ghost"
            onClick={() => {
              setPending(null)
              setPreview(null)
              if (kind === "location") setLocationQty(locationsPurchased)
              else setCompetitorQty(selected?.competitorsPurchased ?? 0)
            }}
            disabled={busy}
          >
            Cancel
          </TkButton>
        </div>
      </div>
    )
  }

  return (
    <div className="tk-addon-panel">
      {/* ── Extra locations: org-wide, so no location picker ── */}
      <div className="tk-addon-row">
        <div className="tk-addon-copy">
          <span className="tk-addon-title">Extra locations</span>
          <span className="tk-set-hint">
            {MONEY(locationUnit)}
            {perLabel} each, on your plan&rsquo;s rate. Your plan includes one.
          </span>
        </div>
        {stepper(locationQty, setLocationQty, busy || pending === "competitor", "extra locations")}
        {locationQty !== locationsPurchased && pending !== "location" && (
          <TkButton
            variant="ghost"
            onClick={() => call("location", locationQty, true)}
            disabled={busy}
          >
            {busy ? "Checking…" : "Review change"}
          </TkButton>
        )}
      </div>
      {confirmRow("location")}

      {/* ── Extra competitors: allocated per location (ALT-756) ── */}
      <div className="tk-addon-row">
        <div className="tk-addon-copy">
          <span className="tk-addon-title">Extra competitors</span>
          <span className="tk-set-hint">
            {MONEY(competitorUnit)}
            {perLabel} each, added to one location.
          </span>
        </div>
        {locations.length > 1 && (
          <label className="tk-addon-loc">
            <span className="tk-set-hint">At</span>
            <select
              value={locationId}
              onChange={(e) => resetSelection(e.target.value)}
              disabled={busy || pending !== null}
              aria-label="Which location gets the extra competitors"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {stepper(
          competitorQty,
          setCompetitorQty,
          busy || pending === "location" || !selected,
          "extra competitors",
        )}
        {selected && competitorQty !== selected.competitorsPurchased && pending !== "competitor" && (
          <TkButton
            variant="ghost"
            onClick={() => {
              // The route takes the org-wide BILLED total, not this location's share, because that
              // is what the Stripe item quantity is. Other locations keep what they hold.
              const others = locations
                .filter((l) => l.id !== locationId)
                .reduce((sum, l) => sum + l.competitorsPurchased, 0)
              call("competitor", others + competitorQty, true)
            }}
            disabled={busy}
          >
            {busy ? "Checking…" : "Review change"}
          </TkButton>
        )}
      </div>
      {confirmRow("competitor")}

      {competitorsBilled > 0 && (
        <p className="tk-set-hint">
          You are paying for {competitorsBilled} extra competitor
          {competitorsBilled === 1 ? "" : "s"} across your locations.
        </p>
      )}

      {error && <span className="tk-set-status tk-set-status-err">{error}</span>}
    </div>
  )
}
