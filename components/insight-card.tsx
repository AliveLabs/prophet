import type { ReactNode } from "react"

type InsightCardProps = {
  title: string
  summary: string
  confidence: string
  severity: string
  status: string
  evidence: Record<string, unknown>
  recommendations: Array<Record<string, unknown>>
  actions: ReactNode
}

export default function InsightCard({
  title,
  summary,
  confidence,
  severity,
  status,
  evidence,
  recommendations,
  actions,
}: InsightCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-zinc-600">{summary}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 px-2 py-1">
            {confidence}
          </span>
          <span className="rounded-full border border-slate-200 px-2 py-1">
            {severity}
          </span>
          <span className="rounded-full border border-slate-200 px-2 py-1">
            {status}
          </span>
        </div>
      </div>
      <details className="mt-4 rounded-xl border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          Evidence
        </summary>
        <pre className="mt-2 overflow-auto text-xs text-slate-600">
          {JSON.stringify(evidence, null, 2)}
        </pre>
      </details>
      {recommendations.length ? (
        <div className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600">
          <p className="font-medium text-slate-900">Recommendations</p>
          <ul className="mt-2 list-disc pl-4">
            {recommendations.map((item, index) => (
              <li key={index}>{JSON.stringify(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 flex gap-2">{actions}</div>
    </div>
  )
}
