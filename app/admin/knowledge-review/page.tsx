import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdminContext } from "@/lib/auth/platform-admin"
import { KnowledgeReviewTable, type KnowledgeRow } from "./components/knowledge-review-table"

// Learning Spine L3 (P17a) — the TicketAdmin knowledge-review queue. Lists CANDIDATE + SHADOW
// skill_knowledge rows (the rows NOT yet serving) so a super_admin can promote/retire/shadow them.
// This is the §2.3.3 HUMAN gate: the only path a question_demand or any global-scope change reaches
// `active`. RETIRE is instant + deploy-free (a status flip). FAIL-SOFT: if the table doesn't exist yet
// (pre-migration) the query errors and we render an empty queue rather than crash.
export default async function KnowledgeReviewPage() {
  await connection()
  const { role } = await requirePlatformAdminContext()
  // Promotion is governance-grade (knowledge.manage = super_admin). Lower roles see the queue
  // read-only; the server action enforces this independently — this just keeps the UI honest.
  const canManage = role === "super_admin"

  const supabase = createAdminSupabaseClient()
  // Loose read (skill_knowledge isn't in the generated types). Candidate + shadow = the review queue.
  let rows: KnowledgeRow[] = []
  try {
    const { data } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          in: (c: string, v: string[]) => {
            order: (c: string, o: { ascending: boolean }) => Promise<{ data: Record<string, unknown>[] | null }>
          }
        }
      }
    })
      .from("skill_knowledge")
      .select(
        "id, skill_id, scope, scope_id, learning_kind, title, snippet, confidence, support_n, status, knowledge_version, provenance, effective_from, effective_to, updated_at",
      )
      .in("status", ["candidate", "shadow"])
      .order("updated_at", { ascending: false })
    rows = (data ?? []).map(toRow)
  } catch {
    rows = [] // pre-migration / read error → empty queue (the brief path is unaffected).
  }

  const counts = {
    total: rows.length,
    candidate: rows.filter((r) => r.status === "candidate").length,
    shadow: rows.filter((r) => r.status === "shadow").length,
    questionDemand: rows.filter((r) => r.learningKind === "question_demand" || r.learningKind === "editorial").length,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Knowledge Review
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {canManage
            ? "Promote a learned snippet to active (it then informs the relevant skill's prompt), move it to shadow to observe only, or retire it. Operator-question demand is human-only — it never auto-promotes."
            : "Learned snippets awaiting review. Promotion is restricted to super admins."}
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Stat label="In queue" value={counts.total} />
        <Stat label="Candidate" value={counts.candidate} />
        <Stat label="Shadow" value={counts.shadow} />
        <Stat label="From questions" value={counts.questionDemand} />
      </div>

      <KnowledgeReviewTable rows={rows} canManage={canManage} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  )
}

function toRow(r: Record<string, unknown>): KnowledgeRow {
  const prov = (r.provenance ?? {}) as Record<string, unknown>
  const streams = Array.isArray(prov.streams) ? (prov.streams as unknown[]).map(String) : []
  return {
    id: String(r.id ?? ""),
    skillId: String(r.skill_id ?? ""),
    scope: String(r.scope ?? "global") as KnowledgeRow["scope"],
    scopeId: r.scope_id == null ? null : String(r.scope_id),
    learningKind: String(r.learning_kind ?? "") as KnowledgeRow["learningKind"],
    title: String(r.title ?? ""),
    snippet: String(r.snippet ?? ""),
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
    supportN: typeof r.support_n === "number" ? r.support_n : 0,
    status: String(r.status ?? "candidate") as KnowledgeRow["status"],
    knowledgeVersion: String(r.knowledge_version ?? ""),
    streams,
    demandType: typeof prov.demand_type === "string" ? prov.demand_type : null,
    updatedAt: String(r.updated_at ?? ""),
  }
}
