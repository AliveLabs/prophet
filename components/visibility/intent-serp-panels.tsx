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
  local: "bg-green-500",
  commercial: "bg-amber-500",
  navigational: "bg-purple-500",
  informational: "bg-blue-500",
  transactional: "bg-emerald-600",
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
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Keywords by Intent</h3>

        {/* Stacked bar */}
        {totalIntentKw > 0 && (
          <div className="mb-3 flex h-4 overflow-hidden rounded-full">
            {intentData.map((d) => (
              <div
                key={d.intent}
                className={`${INTENT_COLORS[d.intent] ?? "bg-slate-400"}`}
                style={{ width: `${d.percent}%` }}
                title={`${d.intent}: ${d.percent}%`}
              />
            ))}
          </div>
        )}

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-1.5 font-medium">Intent</th>
              <th className="py-1.5 font-medium text-right">Keywords</th>
              <th className="py-1.5 font-medium text-right">Percent</th>
              <th className="py-1.5 font-medium text-right">Traffic</th>
            </tr>
          </thead>
          <tbody>
            {intentData.map((d) => (
              <tr key={d.intent} className="border-b border-slate-50">
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${INTENT_COLORS[d.intent] ?? "bg-slate-400"}`} />
                    <span className="font-medium capitalize text-slate-700">{d.intent}</span>
                  </div>
                </td>
                <td className="py-1.5 text-right text-slate-600">{d.count.toLocaleString()}</td>
                <td className="py-1.5 text-right text-slate-500">{d.percent.toFixed(1)}%</td>
                <td className="py-1.5 text-right text-slate-500">{d.traffic.toLocaleString()}</td>
              </tr>
            ))}
            {intentData.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-slate-400">No intent data.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* SERP Features */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">SERP Features</h3>
        <p className="mb-3 text-xs text-slate-400">Features your domain appears in across tracked keywords.</p>

        {serpFeatures.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {serpFeatures.map((f) => (
              <div
                key={f.feature}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-slate-700">
                  {SERP_ICONS[f.feature] ?? f.feature.replace(/_/g, " ")}
                </span>
                <span className="text-slate-400">
                  Keywords: <strong className="text-slate-600">{f.count}</strong>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No SERP feature data available.</p>
        )}
      </div>
    </div>
  )
}
