import InsightCard from "@/components/insight-card"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { dismissInsightAction, markInsightReadAction } from "./actions"

type InsightsPageProps = {
  searchParams?: Promise<{
    confidence?: string
    severity?: string
    range?: string
    error?: string
  }>
}

function getStartDate(range: string | undefined) {
  const days = range === "30" ? 30 : 7
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) {
    return null
  }

  const { data: locations } = await supabase
    .from("locations")
    .select("id")
    .eq("organization_id", organizationId)

  const locationIds = locations?.map((location) => location.id) ?? []
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const startDate = getStartDate(resolvedSearchParams?.range)

  let query = supabase
    .from("insights")
    .select("id, title, summary, confidence, severity, status, evidence, recommendations, date_key")
    .in("location_id", locationIds)
    .gte("date_key", startDate)
    .order("date_key", { ascending: false })

  if (resolvedSearchParams?.confidence) {
    query = query.eq("confidence", resolvedSearchParams.confidence)
  }
  if (resolvedSearchParams?.severity) {
    query = query.eq("severity", resolvedSearchParams.severity)
  }

  const { data: insights } = await query
  const error = resolvedSearchParams?.error

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm">
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="mt-2 text-sm text-slate-600">
          Review daily changes across your approved competitors.
        </p>
        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {decodeURIComponent(error)}
          </p>
        ) : null}
        <form className="mt-4 flex flex-wrap gap-3" method="get">
          <select
            name="range"
            defaultValue={resolvedSearchParams?.range ?? "7"}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <select
            name="confidence"
            defaultValue={resolvedSearchParams?.confidence ?? ""}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">All confidence</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            name="severity"
            defaultValue={resolvedSearchParams?.severity ?? ""}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">All severity</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <button
            type="submit"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Apply filters
          </button>
        </form>
      </div>

      <div className="space-y-4">
        {insights && insights.length > 0 ? (
          insights.map((insight) => (
            <InsightCard
              key={insight.id}
              title={insight.title}
              summary={insight.summary}
              confidence={insight.confidence}
              severity={insight.severity}
              status={insight.status}
              evidence={insight.evidence as Record<string, unknown>}
              recommendations={insight.recommendations as Array<Record<string, unknown>>}
              actions={
                <>
                  <form action={markInsightReadAction}>
                    <input type="hidden" name="insight_id" value={insight.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs"
                    >
                      Mark read
                    </button>
                  </form>
                  <form action={dismissInsightAction}>
                    <input type="hidden" name="insight_id" value={insight.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs"
                    >
                      Dismiss
                    </button>
                  </form>
                </>
              }
            />
          ))
        ) : (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            No insights yet. Once snapshots run, changes will appear here.
          </p>
        )}
      </div>
    </section>
  )
}
