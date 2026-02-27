import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import LocationFilter from "@/components/ui/location-filter"
import TrafficHeatmap, { type HeatmapData } from "@/components/traffic/traffic-heatmap"
import PeakComparison from "@/components/traffic/peak-comparison"
import { buildPeakData } from "@/lib/traffic/peak-data"
import TrafficChart from "@/components/insights/traffic-chart"
import { Card } from "@/components/ui/card"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatHour(h: number): string {
  if (h === 0) return "12am"
  if (h === 12) return "12pm"
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

type TrafficPageProps = {
  searchParams?: Promise<{
    location_id?: string
    error?: string
  }>
}

export default async function TrafficPage({ searchParams }: TrafficPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedParams = await Promise.resolve(searchParams)
  const selectedLocationId = resolvedParams?.location_id ?? locations?.[0]?.id ?? null

  const { data: competitors } = selectedLocationId
    ? await supabase
        .from("competitors")
        .select("id, name")
        .eq("location_id", selectedLocationId)
        .eq("is_active", true)
    : { data: [] }

  const competitorIds = (competitors ?? []).map((c) => c.id)
  const competitorNameMap = new Map((competitors ?? []).map((c) => [c.id, c.name ?? "Competitor"]))

  const { data: busyTimesRaw } = competitorIds.length > 0
    ? await supabase
        .from("busy_times")
        .select("competitor_id, day_of_week, hourly_scores, peak_hour, peak_score, slow_hours, typical_time_spent, current_popularity")
        .in("competitor_id", competitorIds)
        .order("created_at", { ascending: false })
    : { data: [] }

  // Group by competitor
  const byCompetitor = new Map<string, Array<{
    day_of_week: number
    hourly_scores: number[]
    peak_hour: number
    peak_score: number
    typical_time_spent: string | null
  }>>()

  const currentPopMap = new Map<string, number | null>()

  for (const bt of busyTimesRaw ?? []) {
    const arr = byCompetitor.get(bt.competitor_id) ?? []
    arr.push({
      day_of_week: bt.day_of_week,
      hourly_scores: bt.hourly_scores,
      peak_hour: bt.peak_hour ?? 0,
      peak_score: bt.peak_score ?? 0,
      typical_time_spent: bt.typical_time_spent,
    })
    byCompetitor.set(bt.competitor_id, arr)
    if (bt.current_popularity != null) {
      currentPopMap.set(bt.competitor_id, bt.current_popularity)
    }
  }

  const trafficData: HeatmapData[] = [...byCompetitor.entries()].map(([compId, days]) => ({
    competitor_id: compId,
    competitor_name: competitorNameMap.get(compId) ?? "Competitor",
    days,
  }))

  const chartData = trafficData.map((d) => ({
    ...d,
    current_popularity: currentPopMap.get(d.competitor_id) ?? null,
  }))

  const peakData = buildPeakData(chartData)

  // KPIs
  const trackedCount = trafficData.length
  const busiestComp = peakData[0]
  const allPeaks = trafficData.flatMap((d) => d.days.map((day) => day.peak_score))
  const avgPeak = allPeaks.length > 0 ? Math.round(allPeaks.reduce((s, v) => s + v, 0) / allPeaks.length) : 0

  // Find most popular day across all competitors
  const dayTotals = Array(7).fill(0) as number[]
  for (const comp of trafficData) {
    for (const day of comp.days) {
      dayTotals[day.day_of_week] += day.peak_score
    }
  }
  const mostPopularDow = dayTotals.indexOf(Math.max(...dayTotals))

  // Find best time to compete (lowest combined traffic during business hours)
  let bestCompeteDay = 0
  let bestCompeteHour = 12
  let lowestCombined = Infinity
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 10; h < 21; h++) {
      let combined = 0
      for (const comp of trafficData) {
        const dayData = comp.days.find((d) => d.day_of_week === dow)
        combined += dayData?.hourly_scores[h] ?? 0
      }
      if (combined < lowestCombined && combined > 0) {
        lowestCombined = combined
        bestCompeteDay = dow
        bestCompeteHour = h
      }
    }
  }

  return (
    <section className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-600 via-amber-600 to-yellow-600 p-6 text-white shadow-xl shadow-orange-200/50">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/5" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Busy Times</h1>
            </div>
            <p className="max-w-md text-sm text-white/70">
              Hourly popularity and foot-traffic patterns for competitors near{" "}
              <span className="font-medium text-white/90">
                {locations?.find((l) => l.id === selectedLocationId)?.name ?? "your locations"}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {locations && locations.length > 1 && selectedLocationId && (
              <LocationFilter
                locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
                selectedLocationId={selectedLocationId}
              />
            )}
            {selectedLocationId && (
              <JobRefreshButton
                type="busy_times"
                locationId={selectedLocationId}
                label="Fetch Busy Times"
                pendingLabel="Fetching busy times data"
                className="!bg-white/15 !text-white backdrop-blur-sm hover:!bg-white/25"
              />
            )}
          </div>
        </div>
      </div>

      {trackedCount > 0 ? (
        <>
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-white">
              <p className="text-xs font-medium text-slate-500">Competitors Tracked</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{trackedCount}</p>
              <p className="mt-1 text-[11px] text-slate-400">with busy times data</p>
            </Card>
            <Card className="bg-white">
              <p className="text-xs font-medium text-slate-500">Busiest Competitor</p>
              <p className="mt-2 text-lg font-bold text-slate-900">{busiestComp?.competitor_name ?? "N/A"}</p>
              <p className="mt-1 text-[11px] text-slate-400">Peak: {busiestComp?.peak_score ?? 0}% on {busiestComp?.busiest_day ?? "N/A"}</p>
            </Card>
            <Card className="bg-white">
              <p className="text-xs font-medium text-slate-500">Most Popular Day</p>
              <p className="mt-2 text-lg font-bold text-orange-600">{DAY_NAMES[mostPopularDow]}</p>
              <p className="mt-1 text-[11px] text-slate-400">avg peak: {avgPeak}% across all competitors</p>
            </Card>
            <Card className="bg-white">
              <p className="text-xs font-medium text-slate-500">Best Time to Compete</p>
              <p className="mt-2 text-lg font-bold text-emerald-600">
                {DAY_NAMES[bestCompeteDay]} {formatHour(bestCompeteHour)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">lowest combined competitor traffic</p>
            </Card>
          </div>

          {/* Bar Chart */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <TrafficChart data={trafficData} />
          </div>

          {/* Heatmap */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <TrafficHeatmap data={trafficData} />
          </div>

          {/* Peak Comparison */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <PeakComparison competitors={peakData} />
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <svg className="mx-auto h-12 w-12 text-orange-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-slate-600">No busy times data yet</p>
          <p className="mt-1 text-xs text-slate-400">Click &quot;Fetch Busy Times&quot; to pull popular hours from Google Maps via Outscraper</p>
        </div>
      )}
    </section>
  )
}
