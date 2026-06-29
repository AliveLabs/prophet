// Add a location (complete-picture · Batch 3; multi-location · A2) — REBUILT to
// "The Pass". The place-picker + createLocationFromPlaceAction are unchanged
// (tier-capped, membership-checked, queues the first data pull). When the
// current plan is full it shows a two-path decision screen — re-authored into
// kit cards — instead of a form that would only fail at submit.
//
// Server component: keeps the same billing reads + redirects; only the
// presentation moves to the components/ticket kit (TkSoftPanel / TkCard /
// TkSectionHead) and the page-local locations.css.

import { redirect } from "next/navigation"
import Link from "next/link"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isTrialing } from "@/lib/billing/trial"
import { canAddLocationHere } from "@/lib/billing/limits"
import { nextTierWithMoreLocations, asSubscriptionTier, TIER_LIMITS } from "@/lib/billing/tiers"
import LocationAddForm from "@/components/places/location-add-form"
import { TkCard, TkSoftPanel } from "@/components/ticket"
import { createLocationFromPlaceAction } from "../actions"
import "../locations.css"

const IconArrow = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
const IconBack = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
)

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
      <div className="pv-page tk-kit">
        <Link href="/home" className="pv-back">
          <IconBack /> Back to your brief
        </Link>
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
        <div className="loc-paths">
          {upgradeTarget ? (
            <TkCard className="loc-path-card">
              <h2>Add it to this account</h2>
              <p>
                Upgrade your plan to manage up to{" "}
                {TIER_LIMITS[upgradeTarget].maxLocations} locations under one login and one
                bill — each with its own competitors, signals, and brief.
              </p>
              <Link className="loc-path-link" href="/settings/billing">
                See plans &amp; upgrade <IconArrow />
              </Link>
            </TkCard>
          ) : null}
          <TkCard className="loc-path-card">
            <h2>Give it its own account</h2>
            <p>
              Set this location up on its own plan, under the same login — billed separately, so
              you can track costs per location and switch between them anytime.
            </p>
            <Link className="loc-path-link" href="/onboarding?new=1">
              Set up a separate location <IconArrow />
            </Link>
          </TkCard>
        </div>
      </div>
    )
  }

  return (
    <div className="pv-page tk-kit">
      <Link href="/home" className="pv-back">
        <IconBack /> Back to your brief
      </Link>
      <div className="pv-page-head">
        <span className="pv-kicker">Your account</span>
        <h1 className="pv-h1">Add a location.</h1>
        <p className="pv-sub">
          Each location gets its own competitors, signals, and morning brief. Find the place on
          Google and we take it from there — the first data pull starts immediately.
        </p>
      </div>
      <hr className="pv-rule" />

      <div className="loc-newform">
        <TkSoftPanel className="loc-add-panel">
          <LocationAddForm
            organizationId={profile.current_organization_id}
            action={createLocationFromPlaceAction}
            buttonLabel="Add this location"
          />
        </TkSoftPanel>
      </div>
    </div>
  )
}
