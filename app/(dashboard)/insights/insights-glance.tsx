"use client"

// The Pass — the "At a glance" weighted widget grid for /insights.
//
// REPLACES the chart-heavy shared <InsightsDashboard/> + <WeatherBadge/> with
// Concept A's weighted TkWidgetGrid. Every tile is HONEST: %-share, counts, and
// "you vs competitor" ratings only — no invented POS / $ / covers. The numbers
// are computed server-side in page.tsx and passed in.

import {
  RevealOnView,
  TkWidgetGrid,
  TkWidget,
  TkWidgetRow,
} from "@/components/ticket"

export type GlanceData = {
  insightCount: number
  newCount: number
  competitorCount: number
  locationRating: number | null
  avgCompetitorRating: number | null
  reviewSharePct: number | null
  sentiment: { positive: number; negative: number; mixed: number } | null
  weather: { condition: string; hi: number; lo: number; severe: boolean } | null
  trafficPeak: { dayLabel: string; hour: number } | null
}

export default function InsightsGlance({ data }: { data: GlanceData }) {
  const {
    insightCount,
    newCount,
    competitorCount,
    locationRating,
    avgCompetitorRating,
    reviewSharePct,
    sentiment,
    weather,
    trafficPeak,
  } = data

  const ratingLead =
    locationRating != null && avgCompetitorRating != null
      ? Number((locationRating - avgCompetitorRating).toFixed(1))
      : null

  const sentTotal = sentiment
    ? sentiment.positive + sentiment.negative + sentiment.mixed
    : 0
  const posPct = sentiment && sentTotal > 0 ? Math.round((sentiment.positive / sentTotal) * 100) : null

  return (
    <RevealOnView>
      <TkWidgetGrid>
        {/* Lead tile: active insights (weighted/wide) */}
        <TkWidget
          tone="rust"
          size="wide"
          label="Active insights"
          value={String(insightCount)}
          sub={
            newCount > 0
              ? `${newCount} you haven't reviewed`
              : "across every signal we watch for you"
          }
          data-tip="Live insights across all sources in your current view"
          data-tipv={`${insightCount} insights`}
          spark={
            <svg viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M0 50 L28 44 L52 38 L74 22 L96 14 L120 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
            </svg>
          }
        />

        {/* You vs competitor rating */}
        <TkWidget
          tone={ratingLead != null && ratingLead >= 0 ? "teal" : "gold"}
          label="Your rating"
          value={locationRating != null ? `${locationRating.toFixed(1)}★` : "—"}
          sub={
            avgCompetitorRating != null
              ? `vs ${avgCompetitorRating.toFixed(1)}★ competitor avg${
                  ratingLead != null ? ` · ${ratingLead >= 0 ? "+" : ""}${ratingLead}` : ""
                }`
              : "Google rating"
          }
          data-tip="Your Google rating vs the average of your watched set"
          data-tipv={
            avgCompetitorRating != null
              ? `you ${locationRating?.toFixed(1)} · them ${avgCompetitorRating.toFixed(1)}`
              : "rating"
          }
        />

        {/* Review share of voice */}
        <TkWidget
          tone="slate"
          label="Review share"
          value={reviewSharePct != null ? `${reviewSharePct}%` : "—"}
          sub={reviewSharePct != null ? "of total reviews across your set" : "needs more competitor data"}
          data-tip="Your share of total Google reviews across you + competitors"
          data-tipv={reviewSharePct != null ? `${reviewSharePct}% share` : "no share yet"}
        />

        {/* Competitors tracked */}
        <TkWidget
          tone="gold"
          label="Competitors"
          value={String(competitorCount)}
          sub="watched in your market"
          data-tip="Competitors in your watched set"
          data-tipv={`${competitorCount} tracked`}
        />

        {/* Sentiment pulse — tall tile, real positive/mixed/negative counts */}
        {sentiment ? (
          <TkWidget tone="slate" size="tall" label="Review sentiment">
            <TkWidgetRow
              name="Positive"
              value={String(sentiment.positive)}
              valueColor="var(--teal)"
            />
            <TkWidgetRow name="Mixed" value={String(sentiment.mixed)} valueColor="var(--gold-deep)" />
            <TkWidgetRow
              name="Negative"
              value={String(sentiment.negative)}
              valueColor="var(--alert)"
            />
            {posPct != null ? (
              <div className="ins-glance-foot">{posPct}% positive of {sentTotal} read</div>
            ) : null}
          </TkWidget>
        ) : null}

        {/* Weather context (honest: condition + hi/lo, no demand claim) */}
        {weather ? (
          <TkWidget
            tone="teal"
            label={weather.severe ? "Weather · severe" : "Weather today"}
            value={`${Math.round(weather.hi)}°`}
            sub={`${weather.condition} · low ${Math.round(weather.lo)}°`}
            data-tip="Today's forecast for your trade area"
            data-tipv={`${weather.condition} ${Math.round(weather.hi)}°/${Math.round(weather.lo)}°`}
          />
        ) : null}

        {/* Foot-traffic peak (estimated, from busy-times curves) */}
        {trafficPeak ? (
          <TkWidget
            tone="gold"
            label="Estimated peak"
            value={`${trafficPeak.hour}:00`}
            sub={`busiest on ${trafficPeak.dayLabel} · estimated`}
            data-tip="Estimated busiest hour from foot-traffic curves"
            data-tipv={`${trafficPeak.dayLabel} ${trafficPeak.hour}:00`}
          />
        ) : null}
      </TkWidgetGrid>
    </RevealOnView>
  )
}
