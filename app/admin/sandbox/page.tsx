import { connection } from "next/server"
import Link from "next/link"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

function KindBadge({ kind }: { kind: string }) {
  const styles =
    kind === "demo"
      ? "bg-vatic-indigo/10 text-vatic-indigo"
      : "bg-signal-gold/10 text-signal-gold"
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase ${styles}`}>
      {kind}
    </span>
  )
}

export default async function SandboxPage() {
  await connection()
  const supabase = createAdminSupabaseClient()

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, slug, org_kind, industry_type, subscription_tier, created_at")
    .in("org_kind", ["demo", "test"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  const rows = orgs ?? []
  const demoCount = rows.filter((o) => o.org_kind === "demo").length
  const testCount = rows.filter((o) => o.org_kind === "test").length

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Demo &amp; Test
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin-owned, non-billable orgs · {demoCount} demo · {testCount} test.
            These never appear in real metrics and are the only orgs Maintenance
            may bulk-clear.
          </p>
        </div>
        <Link
          href="/admin/organizations/new"
          className="shrink-0 rounded-lg bg-vatic-indigo px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          + New Demo/Test Org
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Kind</th>
              <th className="px-4 py-3 font-medium">Industry</th>
              <th className="px-4 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No demo or test orgs yet.
                </td>
              </tr>
            ) : (
              rows.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{o.name}</td>
                  <td className="px-4 py-3">
                    <KindBadge kind={o.org_kind} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {o.industry_type === "liquor_store" ? "Liquor store" : "Restaurant"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{o.subscription_tier}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/organizations/${o.id}`}
                      className="text-vatic-indigo hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
