import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default function HomePage() {
  return (
    <section className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {[
          { label: "Active locations", value: "1", delta: "+0" },
          { label: "Competitors tracked", value: "12", delta: "+3" },
          { label: "Insights generated", value: "24", delta: "+7" },
        ].map((metric) => (
          <Card key={metric.label} className="bg-white text-slate-900">
            <p className="text-sm text-slate-500">{metric.label}</p>
            <div className="mt-4 flex items-baseline justify-between">
              <p className="text-3xl font-semibold">{metric.value}</p>
              <Badge variant="success">{metric.delta} today</Badge>
            </div>
          </Card>
        ))}
      </div>

      <Card className="bg-white text-slate-900">
        <h2 className="text-lg font-semibold">Today’s highlights</h2>
        <p className="mt-2 text-sm text-slate-600">
          View the most impactful changes detected across your competitors.
        </p>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {[
            "Competitor A rating decreased by 0.2",
            "Competitor B added new menu items",
            "Competitor C updated hours",
            "Competitor D saw review velocity spike",
          ].map((item) => (
            <div
              key={item}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
            >
              {item}
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}
