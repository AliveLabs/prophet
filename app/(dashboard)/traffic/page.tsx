import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import {
  RevealOnView,
  TkChip,
  TkConfidence,
  TkHero,
  TkSectionHead,
  TkWidgetGrid,
  TkWidget,
  TkWindowViz,
  TkWhy,
  TkEmptyState,
  TkStillLearning,
  TkTooltipLayer,
} from "@/components/ticket"
import { buildPeakData } from "@/lib/traffic/peak-data"
import { fetchTrafficPageData } from "@/lib/cache/traffic"
import type { TrafficData } from "./traffic-types"
import TrafficControls from "./traffic-controls"
import TrafficBars from "./traffic-bars"
import TrafficHeatmapGrid from "./traffic-heatmap-grid"
import TrafficRanks from "./traffic-ranks"
import TrafficIntel, { generateTrafficInsights } from "./traffic-intel"
import { TrafficHeroCanvas } from "./traffic-hero-canvas"
import "./traffic.css"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function formatHour(h: number): string {
  if (h === 0) return "12am"
  if (h === 12) return "12pm"
  return h < 12 ? `${h}am` : `${h - 12}pm`
}
function hourShort(h: number): string {
  if (h === 0) return "12a"
  if (h === 12) return "12p"
  return h < 12 ? `${h}a` : `${h - 12}p`
}

type TrafficPageProps = {
  searchParams?: Promise<{ location_id?: string; error?: string }>
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
  const requestedLocationId = resolvedParams?.location_id ?? null
  const selectedLocationId = (requestedLocationId && locations?.some((l: { id: string }) => l.id === requestedLocationId))
    ? requestedLocationId
    : locations?.[0]?.id ?? null

  const { data: competitors } = selectedLocationId
    ? await supabase
        .from("competitors")
        .select("id, name")
        .eq("location_id", selectedLocationId)
        .eq("is_active", true)
    : { data: [] }

  const competitorIds = (competitors ?? []).map((c) => c.id)
  const competitorNameMap = new Map((competitors ?? []).map((c) => [c.id, c.name ?? "Competitor"]))

  // Fetch busy times (cached, 7-day TTL)
  const cached = await fetchTrafficPageData(competitorIds)
  const busyTimesRaw = cached.busyTimes

  // Group by competitor
  const byCompetitor = new Map<string, TrafficData["days"]>()
  const currentPopMap = new Map<string, number | null>()

  for (const bt of busyTimesRaw) {
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

  const trafficData: TrafficData[] = [...byCompetitor.entries()].map(([compId, days]) => ({
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

  // Most popular day across all competitors
  const dayTotals = Array(7).fill(0) as number[]
  for (const comp of trafficData) {
    for (const day of comp.days) {
      dayTotals[day.day_of_week] += day.peak_score
    }
  }
  const mostPopularDow = dayTotals.indexOf(Math.max(...dayTotals))

  // Best time to compete (lowest combined traffic during business hours)
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

  const hasData = trackedCount > 0
  const trafficInsights = generateTrafficInsights(trafficData)

  // ── Build the hero "open window" viz from the best-compete day ──
  // Axis spans business hours (10a–9p). The lead window is the contiguous
  // low-competition block (combined set traffic in the bottom third) that
  // contains the single best-compete hour; the competitor surge is the hour the
  // set peaks that same day. Honest framing: this is *competitor* traffic.
  const AX_START = 10
  const AX_END = 21
  const AX_SPAN = AX_END - AX_START
  const pos = (h: number) => `${Math.round(((h - AX_START) / AX_SPAN) * 100)}%`

  let windowStart = bestCompeteHour
  let windowEnd = bestCompeteHour + 1
  let surgeHour = 18
  if (hasData) {
    const combinedByHour: number[] = []
    for (let h = AX_START; h < AX_END; h++) {
      let c = 0
      for (const comp of trafficData) {
        const d = comp.days.find((x) => x.day_of_week === bestCompeteDay)
        c += d?.hourly_scores[h] ?? 0
      }
      combinedByHour[h] = c
    }
    const vals = combinedByHour.slice(AX_START, AX_END).filter((v) => v > 0)
    const lowBand = vals.length ? Math.max(...vals) * 0.45 : Infinity
    // expand around the best-compete hour while combined stays in the low band
    windowStart = bestCompeteHour
    windowEnd = bestCompeteHour + 1
    while (windowStart - 1 >= AX_START && combinedByHour[windowStart - 1] <= lowBand) windowStart--
    while (windowEnd < AX_END && combinedByHour[windowEnd] <= lowBand) windowEnd++
    // surge = the set's busiest hour that day
    let maxC = -1
    for (let h = AX_START; h < AX_END; h++) {
      if (combinedByHour[h] > maxC) {
        maxC = combinedByHour[h]
        surgeHour = h
      }
    }
  }

  const axisLabels = [formatHour(AX_START), formatHour(13), formatHour(17), formatHour(AX_END - 1)]
  const heroConfidence = trackedCount >= 3 ? "high" : trackedCount === 2 ? "medium" : "directional"

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Foot traffic</span>
        <h1 className="pv-h1">When the block fills up</h1>
        <p className="pv-sub">
          How busy your competitors get, hour by hour — pulled from Google Maps popular times. Scores
          are <b>% of each spot&apos;s own typical peak</b>, so you can read the rhythm of the
          neighborhood and find the openings.
        </p>
      </div>
      <hr className="pv-rule" />

      <div className="tk-kit" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
        <TkTooltipLayer />

        {selectedLocationId && (
          <RevealOnView>
            <TrafficControls
              locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
              selectedLocationId={selectedLocationId}
              trackedCount={trackedCount}
            />
          </RevealOnView>
        )}

        {!hasData ? (
          /* ── EMPTY / FIRST-RUN STATE ── */
          <RevealOnView style={{ marginTop: 22 }}>
            {selectedLocationId ? (
              <TkStillLearning
                days={1}
                target={7}
                title="Still reading the neighborhood's rhythm"
                description="Hit “Fetch busy times” to pull popular hours from Google Maps. Once a few competitors land, you'll see when the block fills up and where your openings are."
              />
            ) : (
              <TkEmptyState
                icon={
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.1c0-.6.5-1.1 1.1-1.1h2.3c.6 0 1.1.5 1.1 1.1v6.8c0 .6-.5 1.1-1.1 1.1H4.1A1.1 1.1 0 013 19.9v-6.8zM9.8 8.6c0-.6.5-1.1 1.1-1.1h2.3c.6 0 1.1.5 1.1 1.1v11.3c0 .6-.5 1.1-1.1 1.1h-2.3a1.1 1.1 0 01-1.1-1.1V8.6zM16.5 4.1c0-.6.5-1.1 1.1-1.1h2.3c.6 0 1.1.5 1.1 1.1v15.8c0 .6-.5 1.1-1.1 1.1h-2.3a1.1 1.1 0 01-1.1-1.1V4.1z" />
                  </svg>
                }
                title="No location to read yet"
                description="Add a location to start pulling competitor busy times for your block."
              />
            )}
          </RevealOnView>
        ) : (
          <>
            {/* ── HERO: the lead read — your best window to compete ── */}
            <RevealOnView style={{ marginTop: 22 }}>
              <TkHero
                titleId="trf-hero-title"
                photo={<TrafficHeroCanvas label="Daily rhythm" />}
                venueChip={
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M12 21s-7-4.5-9-9a9 9 0 1118 0c-2 4.5-9 9-9 9z" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>
                    Your block
                  </>
                }
                chips={
                  <>
                    <TkChip family="competitive">Competitive read</TkChip>
                    <TkConfidence level={heroConfidence} />
                  </>
                }
                title="Your clearest window to compete"
                lede={
                  <>
                    Across the set, <b>{DAY_NAMES[bestCompeteDay]}</b> around{" "}
                    <b>{formatHour(bestCompeteHour)}</b> is when competitors are quietest — the
                    moment your block has the least pull elsewhere.
                  </>
                }
              >
                <TkWindowViz
                  headLabel={`${DAY_SHORT[bestCompeteDay]} · competitor traffic`}
                  headValue={`Open window ${hourShort(windowStart)}–${hourShort(windowEnd)}`}
                  axisLabels={axisLabels}
                  segments={[
                    {
                      kind: "you-open",
                      left: pos(windowStart),
                      width: `${Math.round(((windowEnd - windowStart) / AX_SPAN) * 100)}%`,
                      tip: "Competitors are quietest here — your room to draw the crowd",
                      tipValue: `${hourShort(windowStart)}–${hourShort(windowEnd)}`,
                    },
                    {
                      kind: "surge",
                      left: pos(surgeHour),
                      width: `${Math.round((1 / AX_SPAN) * 100)}%`,
                      tip: "The set's busiest hour — diners are likely facing waits",
                      tipValue: `${hourShort(surgeHour)} peak`,
                    },
                  ]}
                  legend={
                    <>
                      <span>
                        <i style={{ background: "color-mix(in srgb, var(--teal) 38%, transparent)" }} /> Your open window
                      </span>
                      <span>
                        <i style={{ background: "color-mix(in srgb, var(--rust) 40%, transparent)" }} /> Competitor surge
                      </span>
                    </>
                  }
                />
                <TkWhy
                  label="Why this window"
                  points={[
                    <>
                      We summed every tracked competitor&apos;s busy score for each hour of{" "}
                      <b>{DAY_NAMES[bestCompeteDay]}</b> and took the lowest contiguous stretch.
                    </>,
                    <>
                      Scores are <b>% of each spot&apos;s typical peak</b> from Google Maps popular
                      times — a relative read of the block&apos;s rhythm, not headcount or sales.
                    </>,
                    <>
                      The surge band marks <b>{hourShort(surgeHour)}</b>, when the set is busiest and
                      diners are most likely choosing between waits.
                    </>,
                  ]}
                  source={
                    <>
                      <b>Sources:</b> Google Maps popular times · {trackedCount} tracked competitor
                      {trackedCount === 1 ? "" : "s"}
                    </>
                  }
                />
              </TkHero>
            </RevealOnView>

            {/* ── KPI WIDGETS ── */}
            <TkSectionHead title="At a glance" sub="Across your tracked competitors" />
            <RevealOnView>
              <TkWidgetGrid>
                <TkWidget
                  tone="rust"
                  size="wide"
                  label="Competitors read"
                  value={String(trackedCount)}
                  sub={`with busy-times data · ${avgPeak}% avg peak across the set`}
                  data-tip="Competitors with Google Maps popular-times data pulled"
                  data-tipv={`${trackedCount} tracked`}
                  spark={
                    <svg viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true">
                      <path
                        d="M0 52 L20 48 L38 30 L52 40 L70 14 L88 26 L120 10"
                        fill="none"
                        stroke="rgba(255,255,255,.7)"
                        strokeWidth="3"
                      />
                    </svg>
                  }
                />
                <TkWidget
                  tone="gold"
                  label="Busiest day"
                  value={DAY_SHORT[mostPopularDow]}
                  sub={`${avgPeak}% avg peak`}
                  data-tip="The day the set runs busiest, by combined peak score"
                  data-tipv={DAY_NAMES[mostPopularDow]}
                />
                <TkWidget
                  tone="teal"
                  label="Best to compete"
                  value={hourShort(bestCompeteHour)}
                  sub={`${DAY_SHORT[bestCompeteDay]} · quietest set`}
                  data-tip="Lowest combined competitor traffic during business hours"
                  data-tipv={`${DAY_NAMES[bestCompeteDay]} ${formatHour(bestCompeteHour)}`}
                />
                <TkWidget
                  tone="slate"
                  label="Busiest competitor"
                  value={busiestComp?.competitor_name ?? "—"}
                  sub={busiestComp ? `peaks ${busiestComp.peak_score}% on ${busiestComp.busiest_day}` : "no peak yet"}
                  data-tip="Highest single-day peak across the set"
                  data-tipv={busiestComp ? `${busiestComp.peak_score}% peak` : "—"}
                />
              </TkWidgetGrid>
            </RevealOnView>

            {/* ── BUSY TIMES BY DAY ── */}
            <TkSectionHead title="Busy times by day" sub="Hour-by-hour, pick a day" />
            <RevealOnView>
              <div className="tk-trf-panel">
                <p className="tk-trf-panel-sub">
                  Each bar is how busy that competitor runs at that hour — % of their own typical peak.
                  Taller stacks mean the whole block is full at once.
                </p>
                <TrafficBars data={trafficData} />
              </div>
            </RevealOnView>

            {/* ── AVERAGE BUSY SCORE (ranks) ── */}
            <TkSectionHead title="How busy, on average" sub="Week-long average peak vs the set" />
            <RevealOnView>
              <div className="tk-trf-panel">
                <p className="tk-trf-panel-sub">
                  Average peak across all seven days — not just the single busiest hour. The marker on
                  each bar shows where the spot sits against the set average.
                </p>
                <TrafficRanks competitors={peakData} />
              </div>
            </RevealOnView>

            {/* ── WEEKLY HEATMAP ── */}
            <TkSectionHead title="The week, at a glance" sub="Pick a competitor's heatmap" />
            <RevealOnView>
              <div className="tk-trf-panel">
                <TrafficHeatmapGrid data={trafficData} />
              </div>
            </RevealOnView>

            {/* ── TRAFFIC INTELLIGENCE ── */}
            {trafficInsights.length > 0 ? (
              <>
                <TkSectionHead title="What to do with it" sub="Patterns worth acting on" />
                <RevealOnView>
                  <TrafficIntel insights={trafficInsights} />
                </RevealOnView>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
