import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false },
  })
}
