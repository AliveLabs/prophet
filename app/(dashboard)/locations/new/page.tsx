// Add a location (complete-picture · Batch 3) — editorial chrome around the existing
// place-picker + createLocationFromPlaceAction (tier-capped, membership-checked, queues
// the first data pull). Reached from the account flyout.

import { redirect } from "next/navigation"
import Link from "next/link"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isTrialing } from "@/lib/billing/trial"
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

  // Trials cover one location — show the honest upsell instead of a form
  // that would only fail at submit (trial-tier v2 · Batch 5).
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
  const trialBlocked =
    !!orgRow && (locationCount ?? 0) >= 1 && isTrialing(orgRow)

  if (trialBlocked) {
    return (
      <div className="pv-page pv-detail">
        <Link href="/home" className="pv-back">← Back to your brief</Link>
        <div className="pv-page-head">
          <span className="pv-kicker">Your account</span>
          <h1 className="pv-h1">Trials cover one location.</h1>
          <p className="pv-sub">
            Once you convert to a paid plan, you can add locations up to your
            tier&apos;s limit — each with its own competitors, signals, and
            morning brief.
          </p>
        </div>
        <hr className="pv-rule" />
        <div className="pv-section">
          <div className="pv-card">
            <div className="pv-field">
              <div className="pv-field__val">
                <Link className="pv-link" href="/settings/billing">
                  See plans &amp; convert →
                </Link>
              </div>
            </div>
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
