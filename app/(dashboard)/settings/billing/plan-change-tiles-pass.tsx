"use client"

// ALT-228: in-app plan change for an EXISTING subscriber. Same tile styling as
// UpgradeTilesPass (upgrade-tiles-pass.tsx), but tiles call /api/stripe/change-plan
// in place instead of redirecting through Stripe Checkout, and the current
// tier+cadence renders as a locked "Current plan" tile instead of a CTA.

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  SELF_SERVE_TIERS,
  TIER_PRICING,
  ANNUAL_SAVINGS_LABEL,
  ANNUAL_SAVINGS_INLINE,
  getTierDisplayName,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"
import { tierFeatureList } from "@/lib/billing/limits"
import { classifyBillingMutation, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"
import { ICON_CHECK } from "../settings-icons"

type PaidTier = Exclude<SubscriptionTier, "suspended">

/** What the route hands back when a downgrade would leave a location over its competitor cap. */
type TrimSelection = {
  locationId: string
  locationName: string
  cap: number
  mustRemove: number
  suggestedKeepIds: string[]
  competitors: { id: string; name: string }[]
}
type PendingTrim = {
  tier: PaidTier
  cadence: Cadence
  newTierName: string
  selection: TrimSelection[]
}

export function PlanChangeTilesPass({
  industry,
  currentTier,
  currentCadence,
}: {
  industry: IndustryType
  currentTier: PaidTier
  /** Null when we couldn't resolve a cadence from the stored price ID — the
   *  current tile still locks correctly, just without a cadence toggle default. */
  currentCadence: Cadence | null
}) {
  const router = useRouter()
  // Keeps the customer's CURRENT cadence. Unlike the sell surfaces this is a change screen, and
  // pre-selecting a switch nobody asked for is a different thing from showing the better offer.
  const [cadence, setCadence] = useState<Cadence>(currentCadence ?? "annual")
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set when the route answers 409: the downgrade is paused until the customer says what to keep.
  const [trim, setTrim] = useState<PendingTrim | null>(null)
  const [keepIds, setKeepIds] = useState<Set<string>>(new Set())

  // ALT-551: a non-JSON error response (an HTML 500 page) used to throw inside
  // res.json(), land in the bare catch, and show "Failed to change plan" with no
  // detail. Parse defensively and pass the route's own message through.
  async function handleChange(tier: PaidTier, keep?: string[]) {
    setError(null)
    setLoading(tier)
    try {
      const res = await fetch("/api/stripe/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence, keepCompetitorIds: keep }),
      })
      const payload = await res.json().catch(() => null)

      // Checked BEFORE classifyBillingMutation, which would render this as a red error. It is not
      // an error: the downgrade is legal and simply needs a decision first.
      if (payload?.reason === "needs_competitor_selection" && Array.isArray(payload.selection)) {
        const selection = payload.selection as TrimSelection[]
        setTrim({
          tier,
          cadence,
          newTierName: String(payload.newTierName ?? ""),
          selection,
        })
        setKeepIds(new Set(selection.flatMap((s) => s.suggestedKeepIds)))
        return
      }

      const outcome = classifyBillingMutation(res.ok, payload)
      if (outcome.kind === "error") {
        setError(outcome.message)
        return
      }
      // The plan changed but the trim did not, which the Competitors page will surface.
      if (typeof payload?.warning === "string") setError(payload.warning)
      setTrim(null)
      router.refresh()
    } catch {
      setError(GENERIC_BILLING_ERROR)
    } finally {
      setLoading(null)
    }
  }

  // ── The deselect screen ──────────────────────────────────────────────────────────────────────
  // Shown instead of the tiles, because this is now a single decision rather than a menu. Pre-ticked
  // with what the customer is ALREADY getting (the oldest, matching what the nightly brief uses), so
  // confirming without changing anything is a no-op rather than a surprise.
  if (trim) {
    const totalRemoved = trim.selection.reduce(
      (n, s) => n + (s.competitors.length - s.competitors.filter((c) => keepIds.has(c.id)).length),
      0,
    )
    const overAnywhere = trim.selection.some(
      (s) => s.competitors.filter((c) => keepIds.has(c.id)).length > s.cap,
    )
    return (
      <div className="tk-trim">
        <p className="tk-trim-lede">
          {trim.newTierName} covers fewer competitors than your current plan. Choose the ones to keep
          watching. The rest stop being watched, and their history is kept if you add them back.
        </p>

        {trim.selection.map((s) => {
          const keptHere = s.competitors.filter((c) => keepIds.has(c.id)).length
          return (
            <div className="tk-trim-loc" key={s.locationId}>
              <div className="tk-trim-loc-head">
                <span className="tk-trim-loc-name">{s.locationName}</span>
                <span className={`tk-trim-count${keptHere > s.cap ? " tk-trim-count-over" : ""}`}>
                  Keeping {keptHere} of {s.cap}
                </span>
              </div>
              <ul className="tk-trim-list">
                {s.competitors.map((c) => {
                  const kept = keepIds.has(c.id)
                  // At the cap, the only moves left are untick something. Disabling the rest makes
                  // that obvious without an error message.
                  const blocked = !kept && keptHere >= s.cap
                  return (
                    <li key={c.id}>
                      <label className={blocked ? "tk-trim-blocked" : undefined}>
                        <input
                          type="checkbox"
                          checked={kept}
                          disabled={blocked || loading !== null}
                          onChange={() => {
                            const next = new Set(keepIds)
                            if (kept) next.delete(c.id)
                            else next.add(c.id)
                            setKeepIds(next)
                          }}
                        />
                        <span>{c.name}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}

        <p className="tk-set-hint">
          {totalRemoved === 0
            ? "Nothing will stop being watched."
            : `${totalRemoved} competitor${totalRemoved === 1 ? "" : "s"} will stop being watched.`}
        </p>

        {error && <span className="tk-set-status tk-set-status-err">{error}</span>}

        <div className="tk-set-row-actions">
          <button
            type="button"
            className="tk-set-linkbtn"
            disabled={loading !== null || overAnywhere}
            onClick={() => handleChange(trim.tier, [...keepIds])}
          >
            {loading !== null ? "Changing…" : `Confirm and switch to ${trim.newTierName}`}
          </button>
          <button
            type="button"
            className="tk-set-linkbtn"
            disabled={loading !== null}
            onClick={() => {
              setTrim(null)
              setKeepIds(new Set())
              setError(null)
            }}
          >
            Keep my current plan
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="tk-set-cadence">
        <div className="tk-set-cadence-seg" role="tablist" aria-label="Billing cadence">
          <button
            type="button"
            role="tab"
            aria-selected={cadence === "monthly"}
            onClick={() => setCadence("monthly")}
            className={cadence === "monthly" ? "tk-on" : ""}
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={cadence === "annual"}
            onClick={() => setCadence("annual")}
            className={cadence === "annual" ? "tk-on" : ""}
          >
            Annual
          </button>
        </div>
        {cadence === "annual" && <span className="tk-set-save-note">{ANNUAL_SAVINGS_LABEL}</span>}
      </div>

      {error && <span className="tk-set-status tk-set-status-err">{error}</span>}

      <div className="tk-set-tiers">
        {SELF_SERVE_TIERS.map((tier) => {
          const t = tier as PaidTier
          const pricing = TIER_PRICING[t]
          const displayName = getTierDisplayName(t, industry)
          const isCurrent = t === currentTier && cadence === (currentCadence ?? cadence)
          const priceMain =
            cadence === "monthly" ? `$${pricing.monthly}` : `$${pricing.annualEffectiveMonthly}`
          const priceSub =
            cadence === "annual"
              ? `/mo · $${pricing.annual.toLocaleString()} billed annually · ${ANNUAL_SAVINGS_INLINE}`
              : "/mo · billed monthly"

          return (
            <button
              key={t}
              type="button"
              onClick={() => handleChange(t)}
              disabled={loading !== null || isCurrent}
              className={`tk-set-tier${t === currentTier ? " tk-set-tier-reco" : ""}`}
            >
              {t === currentTier && <span className="tk-set-tier-flag">Current tier</span>}
              <div className="tk-set-tier-head">
                <span className="tk-set-tier-name">{displayName}</span>
              </div>
              <div className="tk-set-tier-price">{priceMain}</div>
              <div className="tk-set-tier-sub">{priceSub}</div>
              <div className="tk-set-tier-feats">
                {tierFeatureList(t).map((f) => (
                  <span className="tk-set-tier-feat" key={f}>
                    {ICON_CHECK}
                    {f}
                  </span>
                ))}
              </div>
              <span className="tk-set-tier-cta">
                {isCurrent
                  ? "Current plan"
                  : loading === t
                    ? "Changing…"
                    : t === currentTier
                      ? cadence === "annual"
                        ? "Switch to annual →"
                        : "Switch to monthly →"
                      : SELF_SERVE_TIERS.indexOf(t) > SELF_SERVE_TIERS.indexOf(currentTier)
                        ? "Upgrade →"
                        : "Downgrade →"}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
