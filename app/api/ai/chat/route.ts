import { createServerSupabaseClient } from "@/lib/supabase/server"
import { resolveOrgActorWith } from "@/lib/auth/actor"
import { buildVaticPrompt } from "@/lib/ai/prompts/prophet-chat"

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData.user

  if (!user) {
    return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), {
      status: 401,
    })
  }

  const body = await req.json().catch(() => ({}))
  const question = String(body.question ?? "").trim()
  if (!question) {
    return new Response(JSON.stringify({ ok: false, message: "Missing question" }), {
      status: 400,
    })
  }

  // ALT-578: session → org actor via the shared resolver (lib/auth/actor.ts) — adds the
  // membership check this route never had (it leaned on locations RLS) plus the soft-delete
  // gate route handlers otherwise lack. Currently a stub (no model call below), but it reads
  // org data and the LLM wiring lands here, so it gets the same gate as its siblings.
  const actor = await resolveOrgActorWith(supabase, user.id)
  if (!actor) {
    return new Response(
      JSON.stringify({ ok: false, message: "This organization is no longer active." }),
      { status: 403 },
    )
  }
  const organizationId = actor.organizationId

  const { data: locations } = await supabase
    .from("locations")
    .select("id")
    .eq("organization_id", organizationId)

  const locationIds = locations?.map((location) => location.id) ?? []
  const { data: insights } = await supabase
    .from("insights")
    .select("title, summary, confidence, severity, date_key, evidence")
    .in("location_id", locationIds)
    .order("date_key", { ascending: false })
    .limit(50)

  const { data: competitors } = await supabase
    .from("competitors")
    .select("id")
    .in("location_id", locationIds.length > 0 ? locationIds : ["__none__"])
    .eq("is_active", true)

  const competitorIds = competitors?.map((c) => c.id) ?? []

  const { data: snapshots } = await supabase
    .from("snapshots")
    .select("date_key, raw_data")
    .in("competitor_id", competitorIds.length > 0 ? competitorIds : ["__none__"])
    .order("date_key", { ascending: false })
    .limit(20)

  const prompt = buildVaticPrompt({
    question,
    insights: insights ?? [],
    snapshots: snapshots ?? [],
  })

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "LLM not configured yet",
        data: {
          prompt,
          insightsCount: insights?.length ?? 0,
        },
      }),
      { status: 200 }
    )
  }

  return new Response(
    JSON.stringify({
      ok: true,
      message: "LLM integration pending",
      data: {
        prompt,
      },
    }),
    { status: 200 }
  )
}
