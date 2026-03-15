"use client"

// ---------------------------------------------------------------------------
// Keywords by Intent + SERP Features panels (client component)
// ---------------------------------------------------------------------------

type IntentData = {
  intent: string
  count: number
  traffic: number
  percent: number
}

type SerpFeature = {
  feature: string
  count: number
}

type Props = {
  intentData: IntentData[]
  serpFeatures: SerpFeature[]
}

const INTENT_COLORS: Record<string, string> = {
  local: "bg-precision-teal",
  commercial: "bg-signal-gold",
  navigational: "bg-vatic-indigo-soft",
  informational: "bg-primary",
  transactional: "bg-precision-teal",
}

const SERP_ICONS: Record<string, string> = {
  organic: "Search",
  paid: "Ad",
  featured_snippet: "Featured",
  local_pack: "Local Pack",
  knowledge_graph: "Knowledge",
  people_also_ask: "People Ask",
  images: "Images",
  video: "Video",
  reviews: "Reviews",
  sitelinks: "Sitelinks",
  shopping: "Shopping",
  top_stories: "News",
  twitter: "Social",
  carousel: "Carousel",
  map: "Map",
  app: "App",
  ai_overview: "AI Overview",
  ai_overview_reference: "AI Ref",
}

export default function IntentSerpPanels({ intentData, serpFeatures }: Props) {
  const totalIntentKw = intentData.reduce((s, d) => s + d.count, 0)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Keywords by Intent */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Keywords by Intent</h3>

        {/* Stacked bar */}
        {totalIntentKw > 0 && (
          <div className="mb-3 flex h-4 overflow-hidden rounded-full">
            {intentData.map((d) => (
              <div
                key={d.intent}
                className={`${INTENT_COLORS[d.intent] ?? "bg-muted-foreground"}`}
                style={{ width: `${d.percent}%` }}
                title={`${d.intent}: ${d.percent}%`}
              />
            ))}
          </div>
        )}

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-1.5 font-medium">Intent</th>
              <th className="py-1.5 font-medium text-right">Keywords</th>
              <th className="py-1.5 font-medium text-right">Percent</th>
              <th className="py-1.5 font-medium text-right">Traffic</th>
            </tr>
          </thead>
          <tbody>
            {intentData.map((d) => (
              <tr key={d.intent} className="border-b border-border">
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${INTENT_COLORS[d.intent] ?? "bg-muted-foreground"}`} />
                    <span className="font-medium capitalize text-foreground">{d.intent}</span>
                  </div>
                </td>
                <td className="py-1.5 text-right text-muted-foreground">{d.count.toLocaleString()}</td>
                <td className="py-1.5 text-right text-muted-foreground">{d.percent.toFixed(1)}%</td>
                <td className="py-1.5 text-right text-muted-foreground">{d.traffic.toLocaleString()}</td>
              </tr>
            ))}
            {intentData.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-muted-foreground">No intent data.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* SERP Features */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-foreground">SERP Features</h3>
        <p className="mb-3 text-xs text-muted-foreground">Features your domain appears in across tracked keywords.</p>

        {serpFeatures.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {serpFeatures.map((f) => (
              <div
                key={f.feature}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-2 text-xs"
              >
                <span className="font-semibold text-foreground">
                  {SERP_ICONS[f.feature] ?? f.feature.replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground">
                  Keywords: <strong className="text-muted-foreground">{f.count}</strong>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No SERP feature data available.</p>
        )}
      </div>
    </div>
  )
}
