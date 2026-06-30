// DEV/REVIEW-ONLY harness for ALT-230 — the "Ask Ticket about this" T-bubble.
// Renders the real kit cards (TkWidget / TkCard) with a live <VizTBubble/> mounted,
// inside the preview layout's `.ticket-app` token surface, so the element can be
// reviewed (look + popover + dark mode) without an authed session or live data.
// Prod-guarded by the preview layout (VERCEL_ENV !== production).

import {
  TkSectionHead,
  TkWidgetGrid,
  TkWidget,
  TkCard,
  TkWeatherStrip,
  VizTBubble,
} from "@/components/ticket"
import "@/components/ticket/pass.css"

export default function TBubblePreview() {
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">ALT-230</span>
        <h1 className="pv-h1">Ask Ticket about this</h1>
        <p className="pv-sub">
          Every non-insight data-viz card gets a Ticket-T bubble. Open it for two moves: generate a
          live insight from this data, or ask Ticket a question you can edit. Hover a card to surface
          its bubble; click it to open the popover.
        </p>
      </div>
      <hr className="pv-rule" />

      <div className="tk-kit" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {/* ── A big viz card with the bubble (mirrors the weather lead) ── */}
        <div>
          <TkSectionHead title="On a viz card" sub="Top-right corner · opens over the card" />
          <TkCard
            tBubble={
              <VizTBubble
                viz={{
                  domain: "weather",
                  metric: "This week's outlook",
                  value: "72°",
                  timeframe: "12 days history + 1 day forecast",
                  source: "OpenWeatherMap",
                }}
              />
            }
          >
            <div className="tk-eyebrow">Right now · Wagyu Bar</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "10px 0 16px" }}>
              <span className="tk-mono" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>72°</span>
              <span style={{ color: "var(--ink-2)", fontSize: 14 }}>partly cloudy · low 58°</span>
            </div>
            <TkWeatherStrip
              caption="Next 7 · forecast & estimated walk-in demand"
              captionRight="vs a normal day"
              days={[
                { dow: "Mon", icon: "sun", hi: "74°", lo: "57°", demand: "up" },
                { dow: "Tue", icon: "sun", hi: "76°", lo: "59°", demand: "up" },
                { dow: "Wed", icon: "cloud", hi: "70°", lo: "55°", demand: "flat" },
                { dow: "Thu", icon: "rain", hi: "63°", lo: "52°", demand: "down" },
                { dow: "Fri", icon: "cloud", hi: "68°", lo: "54°", demand: "flat", event: "Concert" },
                { dow: "Sat", icon: "sun", hi: "75°", lo: "58°", demand: "up", event: "Game day" },
                { dow: "Sun", icon: "sun", hi: "73°", lo: "57°", demand: "up" },
              ]}
            />
          </TkCard>
        </div>

        {/* ── At-a-glance metric tiles with bubbles (mirrors weather "At a glance") ── */}
        <div>
          <TkSectionHead title="On metric tiles" sub="Clip-proof: the popover escapes the tile" />
          <TkWidgetGrid>
            <TkWidget
              tone="gold"
              size="wide"
              label="Avg high"
              value="72°F"
              sub="mean daily high in view"
              tBubble={
                <VizTBubble
                  viz={{ domain: "weather", metric: "Avg high", value: 72, unit: "°F", timeframe: "this week" }}
                />
              }
            />
            <TkWidget
              tone="slate"
              label="Total precip"
              value={`0.40"`}
              sub="rain + snow in view"
              tBubble={
                <VizTBubble
                  viz={{ domain: "weather", metric: "Total precip", value: "0.40", unit: '"', timeframe: "this week" }}
                />
              }
            />
            <TkWidget
              tone="teal"
              label="Severe days"
              value="0"
              sub="no disruptions"
              tBubble={
                <VizTBubble viz={{ domain: "weather", metric: "Severe days", value: 0, timeframe: "this week" }} />
              }
            />
            <TkWidget tone="slate" label="Locations" value="3" sub="tracked in your set" />
          </TkWidgetGrid>
        </div>
      </div>
    </div>
  )
}
