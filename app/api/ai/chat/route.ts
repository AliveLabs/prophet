import { createServerSupabaseClient } from "@/lib/supabase/server"
import { buildProphetPrompt } from "@/lib/ai/prompts/prophet-chat"

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) {
    return new Response(JSON.stringify({ ok: false, message: "Organization not set" }), {
      status: 400,
    })
  }

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

  const { data: snapshots } = await supabase
    .from("snapshots")
    .select("date_key, raw_data")
    .order("date_key", { ascending: false })
    .limit(20)

  const prompt = buildProphetPrompt({
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
