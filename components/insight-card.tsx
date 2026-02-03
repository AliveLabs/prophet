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
  accent?: "location" | "competitor"
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
  accent = "competitor",
}: InsightCardProps) {
  const accentStyles =
    accent === "location"
      ? "border-indigo-200 bg-indigo-50/40"
      : "border-emerald-200 bg-emerald-50/40"
  const badgeStyles =
    accent === "location"
      ? "bg-indigo-100 text-indigo-700"
      : "bg-emerald-100 text-emerald-700"

  const summaryEvidence: Array<string> = []
  if (typeof evidence?.field === "string" && evidence.field === "rating") {
    const delta = evidence.delta as number | undefined
    if (typeof delta === "number") {
      summaryEvidence.push(`Rating change: ${delta > 0 ? "+" : ""}${delta}`)
    }
  }
  if (typeof evidence?.field === "string" && evidence.field === "reviewCount") {
    const delta = evidence.delta as number | undefined
    if (typeof delta === "number") {
      summaryEvidence.push(`Review delta: ${delta > 0 ? "+" : ""}${delta}`)
    }
  }
  if (typeof evidence?.field === "string" && evidence.field === "hours") {
    summaryEvidence.push("Hours updated")
  }
  if (typeof evidence?.field === "string" && evidence.field === "baseline") {
    summaryEvidence.push("Baseline created (first snapshot)")
  }
  if (typeof evidence?.field === "string" && evidence.field === "summary") {
    summaryEvidence.push("LLM comparative summary")
  }
  if (Array.isArray((evidence as Record<string, unknown>)?.themes)) {
    summaryEvidence.push("Review themes extracted")
  }

  const llmPrompt = evidence?.llm_prompt as string | undefined
  const llmInput = evidence?.llm_input as Record<string, unknown> | undefined
  const llmModel = evidence?.llm_model as string | undefined

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-zinc-600">{summary}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          <span className={`rounded-full px-2 py-1 ${badgeStyles}`}>
            {accent === "location" ? "Location" : "Competitor"}
          </span>
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
      <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${accentStyles}`}>
        <p className="font-medium text-slate-900">Evidence highlights</p>
        {summaryEvidence.length ? (
          <ul className="mt-2 list-disc pl-4 text-slate-700">
            {summaryEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-600">No structured changes detected.</p>
        )}
      </div>
      <details className="mt-4 rounded-xl border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          Full evidence (raw)
        </summary>
        <pre className="mt-2 overflow-auto text-xs text-slate-600">
          {JSON.stringify(evidence, null, 2)}
        </pre>
      </details>
      {llmPrompt ? (
        <details className="mt-4 rounded-xl border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            LLM prompt + inputs {llmModel ? `(${llmModel})` : ""}
          </summary>
          <pre className="mt-2 overflow-auto text-xs text-slate-600">{llmPrompt}</pre>
          {llmInput ? (
            <pre className="mt-2 overflow-auto text-xs text-slate-600">
              {JSON.stringify(llmInput, null, 2)}
            </pre>
          ) : null}
        </details>
      ) : null}
      {recommendations.length ? (
        <div className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600">
          <p className="font-medium text-slate-900">Recommendations</p>
          <ul className="mt-2 list-disc pl-4">
            {recommendations.map((item, index) => (
              <li key={index}>
                <span className="font-semibold text-slate-800">
                  {String((item as Record<string, unknown>)?.title ?? "Action")}
                </span>
                {String((item as Record<string, unknown>)?.rationale ?? "")
                  ? ` — ${String((item as Record<string, unknown>)?.rationale ?? "")}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 flex gap-2">{actions}</div>
    </div>
  )
}
