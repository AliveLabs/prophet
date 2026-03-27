import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrialDaysRemaining } from "@/lib/billing/trial"
import { Badge } from "@/components/ui/badge"
import { UpgradeButtons } from "./upgrade-buttons"
import { UpgradeSuccessToast } from "./upgrade-success"

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<{ upgraded?: string }>
}) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const params = await Promise.resolve(searchParams)
  const upgraded = params?.upgraded === "true"

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  const { data: organization } = organizationId
    ? await supabase
        .from("organizations")
        .select(
          "subscription_tier, billing_email, trial_started_at, trial_ends_at"
        )
        .eq("id", organizationId)
        .single()
    : { data: null }

  const tier = organization?.subscription_tier ?? "free"
  const daysRemaining = organization
    ? getTrialDaysRemaining({ trial_ends_at: organization.trial_ends_at })
    : 0
  const isOnTrial = tier === "free" && daysRemaining > 0
  const isTrialExpired = tier === "free" && daysRemaining === 0

  return (
    <section className="space-y-5">
      {upgraded && <UpgradeSuccessToast />}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <span className="text-[12.5px] font-semibold text-foreground">
            Billing
          </span>
        </div>
        <div className="p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-secondary px-4 py-4">
              <p className="text-[11.5px] font-medium text-muted-foreground">
                Current tier
              </p>
              <p className="mt-2 font-display text-[28px] font-semibold leading-none tracking-tight text-foreground">
                {tier === "free" ? "Free" : tier.charAt(0).toUpperCase() + tier.slice(1)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-secondary px-4 py-4">
              <p className="text-[11.5px] font-medium text-muted-foreground">
                {isOnTrial ? "Trial status" : "Billing email"}
              </p>
              {isOnTrial ? (
                <p className="mt-2 text-[15px] font-semibold text-foreground">
                  {daysRemaining} {daysRemaining === 1 ? "day" : "days"}{" "}
                  remaining
                </p>
              ) : isTrialExpired ? (
                <p className="mt-2 text-[15px] font-semibold text-destructive">
                  Trial expired
                </p>
              ) : (
                <p className="mt-2 text-[15px] font-semibold text-foreground">
                  {organization?.billing_email ?? "Not set"}
                </p>
              )}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {tier !== "free" ? (
              <>
                <Badge
                  variant="default"
                  className="border-border text-muted-foreground"
                >
                  Stripe connected
                </Badge>
                <Badge
                  variant="default"
                  className="border-border text-muted-foreground"
                >
                  Webhooks enabled
                </Badge>
              </>
            ) : (
              <Badge
                variant="default"
                className="border-border text-muted-foreground"
              >
                Free tier
              </Badge>
            )}
          </div>
        </div>
      </div>

      {tier === "free" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <span className="text-[12.5px] font-semibold text-foreground">
              Upgrade your plan
            </span>
          </div>
          <div className="p-5">
            <p className="mb-5 text-sm text-muted-foreground">
              Unlock more locations, competitors, and daily intelligence
              refreshes.
            </p>
            <UpgradeButtons />
          </div>
        </div>
      )}
    </section>
  )
}
