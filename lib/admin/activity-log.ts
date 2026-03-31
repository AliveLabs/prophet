import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { Json } from "@/types/database.types"

interface LogActionParams {
  adminId: string
  adminEmail: string
  action: string
  targetType: string
  targetId: string
  details?: Record<string, unknown>
}

export async function logAdminAction({
  adminId,
  adminEmail,
  action,
  targetType,
  targetId,
  details,
}: LogActionParams) {
  const supabase = createAdminSupabaseClient()

  const { error } = await supabase.from("admin_activity_log").insert({
    admin_user_id: adminId,
    admin_email: adminEmail,
    action,
    target_type: targetType,
    target_id: targetId,
    details: (details ?? {}) as Json,
  })

  if (error) {
    console.error("Failed to log admin action:", error.message)
  }
}
