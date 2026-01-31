import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Card } from "@/components/ui/card"
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
    <section className="space-y-6">
      <Card className="bg-white text-slate-900">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage your subscription and view plan limits.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-sm text-slate-500">Current tier</p>
            <p className="mt-2 text-xl font-semibold">
              {organization?.subscription_tier ?? "free"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-sm text-slate-500">Billing email</p>
            <p className="mt-2 text-xl font-semibold">
              {organization?.billing_email ?? "Not set"}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Badge variant="default" className="border-slate-200 text-slate-600">
            Stripe connected
          </Badge>
          <Badge variant="default" className="border-slate-200 text-slate-600">
            Webhooks enabled
          </Badge>
        </div>
      </Card>
    </section>
  )
}
