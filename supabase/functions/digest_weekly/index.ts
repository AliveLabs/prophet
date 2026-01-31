import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    return new Response("Missing Supabase credentials", { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, billing_email")

  const summaries = organizations?.map((org) => ({
    organization_id: org.id,
    delivery: "pending",
    email: org.billing_email,
  }))

  return new Response(JSON.stringify({ ok: true, summaries }), { status: 200 })
})
