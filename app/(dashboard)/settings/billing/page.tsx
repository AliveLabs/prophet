import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"

export default async function BillingPage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  const { data: organization } = organizationId
    ? await supabase
        .from("organizations")
        .select("subscription_tier, billing_email")
        .eq("id", organizationId)
        .single()
    : { data: null }

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <span className="text-[12.5px] font-semibold text-foreground">Billing</span>
        </div>
        <div className="p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-secondary px-4 py-4">
              <p className="text-[11.5px] font-medium text-muted-foreground">Current tier</p>
              <p className="mt-2 font-display text-[28px] font-semibold leading-none tracking-tight text-foreground">
                {organization?.subscription_tier ?? "free"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-secondary px-4 py-4">
              <p className="text-[11.5px] font-medium text-muted-foreground">Billing email</p>
              <p className="mt-2 text-[15px] font-semibold text-foreground">
                {organization?.billing_email ?? "Not set"}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Badge variant="default" className="border-border text-muted-foreground">
              Stripe connected
            </Badge>
            <Badge variant="default" className="border-border text-muted-foreground">
              Webhooks enabled
            </Badge>
          </div>
        </div>
      </div>
    </section>
  )
}
