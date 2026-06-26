import Link from "next/link"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { loadPoolEntries } from "@/lib/insights/insight-pool"
import PoolFeed from "@/components/insights/pool-feed"

type LocRow = { id: string; name: string | null }

export default async function InsightPoolPage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/onboarding")

  const { data: locRow } = await (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => { maybeSingle: () => Promise<{ data: LocRow | null }> }
            }
          }
        }
      }
    }
  )
    .from("locations")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!locRow) redirect("/home")

  // loadPoolEntries is fail-soft (returns [] pre-migration / on any error). Reads via the default
  // admin client like getBrief — the page-level auth above already scopes this to the user's own org.
  const entries = await loadPoolEntries(locRow.id)

  return (
    <section className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <Link href="/home" className="text-xs text-muted-foreground hover:text-foreground">
          ← Back to your brief
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold text-foreground">All insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every insight from your recent briefs{locRow.name ? ` for ${locRow.name}` : ""}. The top few
          surface on your brief each day; the rest stay here, filterable by type.
        </p>
      </div>
      <PoolFeed entries={entries} />
    </section>
  )
}
