// ALT-230 Action 1 — on-demand "Generate insight" from a data-viz card.
//
// The viz-card T-bubble routes the operator to /insights?generate=<json viz ctx>;
// the feed kit POSTs that context here, we run ONE grounded Gemini call, insert an
// honest, low-scored insight, and return it so the feed pins it to the top of the
// pool with a "Just generated" marker. It NEVER seizes the home hero: the type is
// `user_viz.*`, which the dossier query (lib/insights/dossier/build.ts) excludes
// from the brief, and home charts exclude too (lib/cache/home.ts).
//
// Auth + per-user rate limit + fail-soft mirror app/api/ai/quick-tip/route.ts.

import { getUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { generateGeminiJson } from "@/lib/ai/gemini"
import { computeRelevanceScore, getUrgencyLevel } from "@/lib/insights/scoring"
import { rateLimit, retryAfterSeconds } from "@/lib/http/rate-limit"
import { scrubTicket } from "@/lib/skills/voice"
import { updateTag } from "next/cache"
import {
  parseVizContext,
  buildGeneratedInsightPrompt,
  generatedInsightType,
  type ParsedViz,
} from "@/lib/ai/generated-insight"

// The Gemini call can take a while (retries + thinking); give the function real
// headroom so Vercel doesn't kill it mid-generation and return an HTML 504 that the
// client can't parse (ALT-294).
export const maxDuration = 120

const CONFIDENCES = new Set(["medium", "low"]) // NEVER "high" from a single data point
const SEVERITIES = new Set(["info", "warning"]) // NEVER "critical"

type LlmInsight = {
  title: string
  summary: string
  confidence: string
  severity: string
  recommendations: Array<{ title: string; rationale?: string }>
}

// Coerce the model's JSON into our honest, clamped shape. Caps confidence at
// "medium" and severity at "warning" so a user-triggered viz insight can never
// out-score a real critical/high engine signal.
function coerceLlmInsight(raw: unknown, viz: ParsedViz): LlmInsight {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const confidence = CONFIDENCES.has(String(o.confidence)) ? String(o.confidence) : "low"
  const severity = SEVERITIES.has(String(o.severity)) ? String(o.severity) : "info"
  const recs = Array.isArray(o.recommendations) ? o.recommendations : []
  const recommendations = recs
    .map((r) => {
      const rr = (r && typeof r === "object" ? r : {}) as Record<string, unknown>
      return {
        title: scrubTicket(String(rr.title ?? "").trim()),
        rationale: scrubTicket(String(rr.rationale ?? "").trim()),
      }
    })
    .filter((r) => r.title)
    .slice(0, 3)
  // scrubTicket guarantees brand voice (no em dashes, de-jargoned) on the model's
  // output — the same compliance floor the brief pipeline gets (lib/skills/voice).
  return {
    title: scrubTicket(String(o.title ?? "").trim()).slice(0, 120) || `About your ${viz.metric.toLowerCase()}`,
    summary: scrubTicket(String(o.summary ?? "").trim()).slice(0, 300),
    confidence,
    severity,
    recommendations,
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUser()
    if (!user) return Response.json({ insight: null }, { status: 401 })

    // Per-user rate limit: this spends GOOGLE_AI_API_KEY + writes a row.
    const rl = await rateLimit(user.id, { prefix: "generated-insight", limit: 10, windowSeconds: 60 })
    if (!rl.ok) {
      return Response.json({ insight: null }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } })
    }

    const body = await req.json().catch(() => ({}))
    const viz = parseVizContext(body?.vizContext)
    if (!viz) return Response.json({ insight: null }, { status: 400 })

    // Resolve the location the insight belongs to. RLS ("org members can read
    // locations") means this read only returns locations the user is a member of —
    // so it doubles as the membership check. We then write with the admin client
    // because INSERT on insights is org-admin-only under RLS.
    const supabase = await createServerSupabaseClient()
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", user.id)
      .maybeSingle()
    const orgId = profile?.current_organization_id
    if (!orgId) return Response.json({ insight: null }, { status: 403 })

    // We INSERT via the service-role admin client (insights INSERT is RLS-gated to
    // owner/admin). Mirror that policy in the app layer instead of silently bypassing
    // it — a member-role user can't create insights. (RLS "org members can read
    // membership" lets us read our own role here.)
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return Response.json({ insight: null }, { status: 403 })
    }

    const { data: locs } = await supabase
      .from("locations")
      .select("id")
      .eq("organization_id", orgId)
    const allowed = new Set((locs ?? []).map((l) => l.id))
    const locationId = viz.locationId && allowed.has(viz.locationId) ? viz.locationId : locs?.[0]?.id ?? null
    if (!locationId) return Response.json({ insight: null }, { status: 403 })

    // ── One grounded Gemini call (Pro, via the shared helper). Fail-soft: if it
    //    throws or returns garbage we DON'T persist a dud row — the client shows a
    //    "couldn't generate" notice and the operator can retry from the card. ──
    let llm: LlmInsight | null = null
    try {
      const parsed = await generateGeminiJson(buildGeneratedInsightPrompt(viz), {
        temperature: 0.4,
        // gemini-2.5-pro thinks by default and bills it against maxOutputTokens; 1024 was
        // too tight (thinking ate the budget → empty JSON → 502). Give the JSON real room
        // and bound thinking so both fit (ALT-294).
        maxOutputTokens: 4096,
        thinkingBudget: 1024,
      })
      if (parsed) llm = coerceLlmInsight(parsed, viz)
    } catch (err) {
      console.warn("[GeneratedInsight] Gemini call failed:", err)
    }
    if (!llm || !llm.summary) {
      console.warn("[GeneratedInsight] model returned no usable insight (empty/parse-fail)")
      return Response.json({ insight: null, reason: "model_failed" }, { status: 502 })
    }

    const dateKey = new Date().toISOString().slice(0, 10)
    const shortId = globalThis.crypto.randomUUID().slice(0, 8)
    const insightType = generatedInsightType(viz.domain, shortId)
    const evidence = { source: "user_viz", viz, generatedAt: new Date().toISOString() }

    const admin = createAdminSupabaseClient()
    const { data: inserted, error } = await admin
      .from("insights")
      .insert({
        location_id: locationId,
        competitor_id: null,
        date_key: dateKey,
        insight_type: insightType,
        title: llm.title,
        summary: llm.summary,
        confidence: llm.confidence,
        severity: llm.severity,
        status: "new",
        evidence,
        recommendations: llm.recommendations,
      })
      .select("id")
      .single()

    if (error || !inserted) {
      console.warn("[GeneratedInsight] insert failed:", error)
      return Response.json({ insight: null }, { status: 500 })
    }

    // Break the 7-day insights cache so the next /insights server render includes
    // this row (it then settles into its honest, low-scored rank in the pool).
    updateTag("insights-data")

    const relevanceScore = computeRelevanceScore(llm.severity, llm.confidence)
    const insight = {
      id: inserted.id,
      title: llm.title,
      summary: llm.summary,
      insightType,
      competitorId: null,
      confidence: llm.confidence,
      severity: llm.severity,
      status: "new",
      userFeedback: null,
      relevanceScore,
      urgencyLevel: getUrgencyLevel(relevanceScore),
      suppressed: false,
      evidence,
      recommendations: llm.recommendations,
      subjectLabel: viz.entityName ?? "Your location",
      dateKey,
      justGenerated: true,
    }

    return Response.json({ insight })
  } catch (err) {
    console.warn("[GeneratedInsight] unexpected error:", err)
    return Response.json({ insight: null }, { status: 500 })
  }
}
