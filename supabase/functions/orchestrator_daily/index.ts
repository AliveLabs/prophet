import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

type OrchestratorRequest = {
  location_id?: string
  date_key?: string
}

function getDateKey(input?: string) {
  if (input) {
    return input
  }
  return new Date().toISOString().slice(0, 10)
}

serve(async (req) => {
  try {
    const payload = (await req.json().catch(() => ({}))) as OrchestratorRequest
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceKey) {
      return new Response("Missing Supabase credentials", { status: 500 })
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    const query = supabase.from("competitors").select("id, location_id")
    if (payload.location_id) {
      query.eq("location_id", payload.location_id)
    }

    const { data: competitors, error } = await query
    if (error || !competitors) {
      throw error ?? new Error("No competitors found")
    }

    const dateKey = getDateKey(payload.date_key)
    const jobs = competitors.flatMap((competitor) => [
      {
        job_type: "fetch_snapshot",
        location_id: competitor.location_id,
        competitor_id: competitor.id,
        date_key: dateKey,
        attempt: 1,
      },
      {
        job_type: "generate_insights",
        location_id: competitor.location_id,
        competitor_id: competitor.id,
        date_key: dateKey,
        attempt: 1,
      },
    ])

    return new Response(JSON.stringify({ ok: true, jobs }), { status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
    })
  }
})
