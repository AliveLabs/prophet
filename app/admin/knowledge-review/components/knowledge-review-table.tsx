"use client"

import { useMemo, useState, useTransition } from "react"
import { reviewKnowledgeRow } from "@/app/actions/knowledge-review"
import type { KnowledgeAction } from "@/lib/skills/knowledge-admin"

export interface KnowledgeRow {
  id: string
  skillId: string
  scope: "global" | "org" | "location"
  scopeId: string | null
  learningKind: "external_trend" | "feedback_pattern" | "question_demand" | "editorial"
  title: string
  snippet: string
  confidence: number
  supportN: number
  status: "candidate" | "shadow" | "active" | "retired"
  knowledgeVersion: string
  streams: string[]
  demandType: string | null
  updatedAt: string
}

const KIND_LABEL: Record<KnowledgeRow["learningKind"], string> = {
  external_trend: "External trend",
  feedback_pattern: "Feedback pattern",
  question_demand: "Question demand",
  editorial: "Framing",
}

function KindBadge({ kind }: { kind: KnowledgeRow["learningKind"] }) {
  const styles: Record<KnowledgeRow["learningKind"], string> = {
    external_trend: "bg-vatic-indigo/15 text-vatic-indigo",
    feedback_pattern: "bg-precision-teal/15 text-precision-teal",
    question_demand: "bg-signal-gold/15 text-signal-gold",
    editorial: "bg-signal-gold/15 text-signal-gold",
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles[kind]}`}>
      {KIND_LABEL[kind]}
    </span>
  )
}

function StatusBadge({ status }: { status: KnowledgeRow["status"] }) {
  const styles: Record<string, string> = {
    candidate: "bg-signal-gold/15 text-signal-gold",
    shadow: "bg-secondary text-muted-foreground",
    active: "bg-precision-teal/15 text-precision-teal",
    retired: "bg-destructive/15 text-destructive",
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles[status] ?? "bg-secondary text-muted-foreground"}`}>
      {status}
    </span>
  )
}

export function KnowledgeReviewTable({ rows, canManage }: { rows: KnowledgeRow[]; canManage: boolean }) {
  const [kindFilter, setKindFilter] = useState<string>("all")
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  const filtered = useMemo(
    () => rows.filter((r) => kindFilter === "all" || r.learningKind === kindFilter),
    [rows, kindFilter],
  )

  function act(id: string, action: KnowledgeAction) {
    setActing(`${id}:${action}`)
    startTransition(async () => {
      const result = await reviewKnowledgeRow(id, action)
      setFeedback(result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error })
      setActing(null)
      setTimeout(() => setFeedback(null), 4000)
    })
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-sm ${
            feedback.ok
              ? "border-precision-teal/30 bg-precision-teal/10 text-precision-teal"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded-lg border border-input bg-background px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All kinds</option>
          <option value="external_trend">External trend</option>
          <option value="feedback_pattern">Feedback pattern</option>
          <option value="question_demand">Question demand</option>
          <option value="editorial">Framing</option>
        </select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} in queue
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Skill / scope</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Snippet</th>
                <th className="px-4 py-3">Conf</th>
                <th className="px-4 py-3">Support</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    Nothing awaiting review. Learnings appear here as the pipelines distill them.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="align-top transition-colors hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{row.skillId}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.scope}
                        {row.scopeId ? ` · ${row.scopeId.slice(0, 8)}` : ""}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">{row.knowledgeVersion}</div>
                    </td>
                    <td className="px-4 py-3">
                      <KindBadge kind={row.learningKind} />
                      {row.demandType && (
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {row.demandType.replace("_", " ")}
                        </div>
                      )}
                    </td>
                    <td className="max-w-md px-4 py-3">
                      <div className="font-medium text-foreground">{row.title}</div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.snippet}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.confidence}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.supportN}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => act(row.id, "promote")}
                            disabled={isPending}
                            className="rounded-md bg-precision-teal/15 px-2.5 py-1 text-xs font-semibold text-precision-teal hover:bg-precision-teal/25 disabled:opacity-50"
                          >
                            {acting === `${row.id}:promote` ? "…" : "Promote"}
                          </button>
                          {row.status !== "shadow" && (
                            <button
                              onClick={() => act(row.id, "shadow")}
                              disabled={isPending}
                              className="rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-secondary/70 disabled:opacity-50"
                            >
                              {acting === `${row.id}:shadow` ? "…" : "Shadow"}
                            </button>
                          )}
                          <button
                            onClick={() => act(row.id, "retire")}
                            disabled={isPending}
                            className="rounded-md bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive/25 disabled:opacity-50"
                          >
                            {acting === `${row.id}:retire` ? "…" : "Retire"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Read-only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
