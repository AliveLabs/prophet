"use client"

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react"
import { reviewKnowledgeRow } from "@/app/actions/knowledge-review"
import type { KnowledgeAction } from "@/lib/skills/knowledge-admin"
import { RevealOnView, TkButton, TkEmptyState } from "@/components/ticket"

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
const KIND_CLASS: Record<KnowledgeRow["learningKind"], string> = {
  external_trend: "kr-badge-trend",
  feedback_pattern: "kr-badge-feedback",
  question_demand: "kr-badge-demand",
  editorial: "kr-badge-editorial",
}

function KindBadge({ kind }: { kind: KnowledgeRow["learningKind"] }) {
  return <span className={`kr-badge ${KIND_CLASS[kind]}`}>{KIND_LABEL[kind]}</span>
}

function StatusBadge({ status }: { status: KnowledgeRow["status"] }) {
  // only candidate + shadow ever reach this queue, but stay defensive
  const cls = status === "shadow" ? "kr-status-shadow" : "kr-status-candidate"
  return (
    <span className={`kr-status ${cls}`}>
      <span className="kr-dot" aria-hidden="true" />
      {status}
    </span>
  )
}

/* a small animated 0→value meter (clamped to 0..1). Reveals on mount; under
   reduced-motion CSS collapses the transition so it lands instantly. */
function Meter({
  kind,
  label,
  value,
  pct,
}: {
  kind: "conf" | "supp"
  label: string
  value: string
  pct: number
}) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, pct))))
    return () => cancelAnimationFrame(id)
  }, [pct])
  return (
    <div className={`kr-meter kr-meter-${kind}`}>
      <div className="kr-ml">
        <span className="kr-mk">{label}</span>
        <span className="kr-mv">{value}</span>
      </div>
      <div className="kr-track" role="img" aria-label={`${label} ${value}`}>
        <i style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

const checkIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
)
const errIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5v.5" />
  </svg>
)
const inboxIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1.5 2.5h5L16 13h5" />
  </svg>
)

export function KnowledgeReviewTable({ rows, canManage }: { rows: KnowledgeRow[]; canManage: boolean }) {
  const [kindFilter, setKindFilter] = useState<string>("all")
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const liveRef = useRef<HTMLDivElement>(null)

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
    <div className="space-y-5">
      {/* polite live region for action results (screen readers) */}
      <div ref={liveRef} aria-live="polite" className="sr-only">
        {feedback?.message ?? ""}
      </div>

      {feedback && (
        <div className={`kr-banner ${feedback.ok ? "kr-ok" : "kr-err"}`} role="status">
          {feedback.ok ? checkIcon : errIcon}
          {feedback.message}
        </div>
      )}

      <div className="kr-toolbar">
        <label className="sr-only" htmlFor="kr-kind">Filter by kind</label>
        <select
          id="kr-kind"
          className="kr-select"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="all">All kinds</option>
          <option value="external_trend">External trend</option>
          <option value="feedback_pattern">Feedback pattern</option>
          <option value="question_demand">Question demand</option>
          <option value="editorial">Framing</option>
        </select>
        <span className="kr-count">
          {filtered.length} {filtered.length === 1 ? "snippet" : "snippets"} in queue
        </span>
      </div>

      {filtered.length === 0 ? (
        <TkEmptyState
          icon={inboxIcon}
          title="Nothing awaiting review"
          description="Learnings surface here as the pipelines distill them — external trends, feedback patterns, and operator-question demand. Nothing reaches a customer until you promote it."
        />
      ) : (
        <RevealOnView className="kr-queue" stagger>
          {filtered.map((row, i) => {
            const confPct = Math.round(Math.max(0, Math.min(1, row.confidence)) * 100)
            return (
              <article
                key={row.id}
                className="kr-row"
                style={{ ["--tk-i"]: i } as CSSProperties}
              >
                <div className="kr-row-top">
                  <div className="kr-badges">
                    <KindBadge kind={row.learningKind} />
                    {row.demandType && (
                      <span className="kr-badge kr-badge-demand">{row.demandType.replace(/_/g, " ")}</span>
                    )}
                  </div>
                  <StatusBadge status={row.status} />
                </div>

                <div className="space-y-1.5">
                  <h3>{row.title || "Untitled snippet"}</h3>
                  {row.snippet && <p className="kr-snippet">{row.snippet}</p>}
                </div>

                <div className="kr-meta">
                  <span className="kr-m">
                    skill <b>{row.skillId || "—"}</b>
                  </span>
                  <span className="kr-m">
                    {row.scope}
                    {row.scopeId ? ` · ${row.scopeId.slice(0, 8)}` : ""}
                  </span>
                  {row.knowledgeVersion && <span className="kr-ver">{row.knowledgeVersion}</span>}
                </div>

                <div className="kr-meters">
                  <Meter
                    kind="conf"
                    label="Confidence"
                    value={row.confidence <= 1 ? `${confPct}%` : String(row.confidence)}
                    pct={row.confidence <= 1 ? confPct : 100}
                  />
                  <Meter
                    kind="supp"
                    label="Support"
                    value={`n=${row.supportN}`}
                    // support has no natural ceiling; show a soft log-ish fill
                    pct={Math.min(100, row.supportN * 12)}
                  />
                </div>

                {canManage ? (
                  <div className="kr-acts">
                    <TkButton
                      variant="act"
                      onClick={() => act(row.id, "promote")}
                      disabled={isPending}
                      aria-label={`Promote ${row.title} to active`}
                    >
                      {acting === `${row.id}:promote` ? "Promoting…" : "Promote to active"}
                    </TkButton>
                    {row.status !== "shadow" && (
                      <TkButton
                        variant="keep"
                        className="kr-btn kr-btn-shadow"
                        onClick={() => act(row.id, "shadow")}
                        disabled={isPending}
                        aria-label={`Move ${row.title} to shadow`}
                      >
                        {acting === `${row.id}:shadow` ? "…" : "Shadow"}
                      </TkButton>
                    )}
                    <TkButton
                      variant="keep"
                      className="kr-btn kr-btn-retire"
                      onClick={() => act(row.id, "retire")}
                      disabled={isPending}
                      aria-label={`Retire ${row.title}`}
                    >
                      {acting === `${row.id}:retire` ? "…" : "Retire"}
                    </TkButton>
                  </div>
                ) : (
                  <p className="kr-readonly">Read-only · promotion is restricted to super admins.</p>
                )}
              </article>
            )
          })}
        </RevealOnView>
      )}
    </div>
  )
}
