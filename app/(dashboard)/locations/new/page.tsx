// Add a location (complete-picture · Batch 3; multi-location · A2) — editorial chrome
// around the place-picker + createLocationFromPlaceAction (tier-capped, membership-
// checked, queues the first data pull). When the current plan is full it shows a
// two-path decision screen instead of a form that would only fail at submit.

import { redirect } from "next/navigation"
import Link from "next/link"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isTrialing } from "@/lib/billing/trial"
import { canAddLocationHere } from "@/lib/billing/limits"
import { nextTierWithMoreLocations, asSubscriptionTier, TIER_LIMITS } from "@/lib/billing/tiers"
import LocationAddForm from "@/components/places/location-add-form"
import { createLocationFromPlaceAction } from "../actions"

export default async function NewLocationPage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile?.current_organization_id) redirect("/onboarding")

  const [{ data: orgRow }, { count: locationCount }] = await Promise.all([
    supabase
      .from("organizations")
      .select("subscription_tier, trial_ends_at, payment_state")
      .eq("id", profile.current_organization_id)
      .maybeSingle(),
    supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", profile.current_organization_id),
  ])

  const count = locationCount ?? 0
  const canHere = !!orgRow && canAddLocationHere(orgRow, count)

  // Plan is full (or a trial caps to one location): don't render a form that
  // only fails at submit. Offer the two real paths — keep it on this bill
  // (upgrade), or stand it up as its own separately-billed account under the
  // same login (A2). The separate-account path is always available; the upgrade
  // path only when a higher tier actually fits more locations.
  if (!canHere) {
    const tier = asSubscriptionTier(orgRow?.subscription_tier)
    // A suspended org can't add anywhere (and the upgrade target would read
    // misleadingly) — send it to billing. Normally unreachable: the account-held
    // gate fires first, but this keeps the page self-safe.
    if (tier === "suspended") redirect("/settings/billing")
    const upgradeTarget = orgRow ? nextTierWithMoreLocations(tier) : null
    const onTrial = !!orgRow && isTrialing(orgRow)
    return (
      <div className="pv-page pv-detail">
        <Link href="/home" className="pv-back">← Back to your brief</Link>
        <div className="pv-page-head">
          <span className="pv-kicker">Add a location</span>
          <h1 className="pv-h1">
            {onTrial ? "Trials cover one location." : "You’re at this plan’s location limit."}
          </h1>
          <p className="pv-sub">
            Two ways to add the next one — keep it on this bill, or give it its own.
          </p>
        </div>
        <hr className="pv-rule" />
        <div className="pv-section" style={{ display: "grid", gap: "16px" }}>
          {upgradeTarget ? (
            <div className="pv-card">
              <h2 className="text-base font-semibold text-foreground">Add it to this account</h2>
              <p className="text-sm text-muted-foreground" style={{ margin: "6px 0 14px" }}>
                Upgrade your plan to manage up to{" "}
                {TIER_LIMITS[upgradeTarget].maxLocations} locations under one login
                and one bill — each with its own competitors, signals, and brief.
              </p>
              <Link className="pv-link" href="/settings/billing">
                See plans &amp; upgrade →
              </Link>
            </div>
          ) : null}
          <div className="pv-card">
            <h2 className="text-base font-semibold text-foreground">Give it its own account</h2>
            <p className="text-sm text-muted-foreground" style={{ margin: "6px 0 14px" }}>
              Set this location up on its own plan, under the same login — billed
              separately, so you can track costs per location and switch between
              them anytime.
            </p>
            <Link className="pv-link" href="/onboarding?new=1">
              Set up a separate location →
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pv-page pv-detail">
      <Link href="/home" className="pv-back">← Back to your brief</Link>
      <div className="pv-page-head">
        <span className="pv-kicker">Your account</span>
        <h1 className="pv-h1">Add a location.</h1>
        <p className="pv-sub">Each location gets its own competitors, signals, and morning brief. Find the place on Google and we take it from there — the first data pull starts immediately.</p>
      </div>
      <hr className="pv-rule" />

      <div className="pv-section">
        <div className="pv-card">
          <LocationAddForm
            organizationId={profile.current_organization_id}
            action={createLocationFromPlaceAction}
            buttonLabel="Add this location"
          />
        </div>
      </div>
    </div>
  )
}
