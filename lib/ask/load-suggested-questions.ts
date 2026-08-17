// The read half of the Ask chip rule (ALT-634). Every decision about WHICH questions may be
// offered lives in ./suggested-questions, which is pure and unit-tested; this only counts rows.
//
// Four count-only queries (`head: true`, no rows returned), run together. Cheap enough to sit on
// /home and /ask, which matters: a rule that surfaces skip because it costs too much is not a
// rule.
//
// FAILS SAFE, not open. On any error it returns the questions that need nothing location-specific
// rather than the full list, because the failure this guards against is offering a question we
// cannot answer. A short chip row is a much smaller problem than a chip that dead-ends.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  askCapabilityFrom,
  suggestedAskQuestions,
  NO_ASK_CAPABILITY,
} from "./suggested-questions"

export async function loadSuggestedAskQuestions(
  locationId: string | null | undefined,
  limit = 3,
): Promise<string[]> {
  if (!locationId) return suggestedAskQuestions(NO_ASK_CAPABILITY, limit)
  try {
    const sb = createAdminSupabaseClient()
    const [insights, briefs, busy, competitors] = await Promise.all([
      sb.from("insights").select("id", { count: "exact", head: true }).eq("location_id", locationId),
      sb.from("daily_briefs").select("location_id", { count: "exact", head: true }).eq("location_id", locationId),
      sb.from("location_busy_times").select("location_id", { count: "exact", head: true }).eq("location_id", locationId),
      sb
        .from("competitors")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("is_active", true),
    ])
    return suggestedAskQuestions(
      askCapabilityFrom({
        insightCount: insights.count ?? 0,
        hasBrief: (briefs.count ?? 0) > 0,
        hasBusyTimes: (busy.count ?? 0) > 0,
        competitorCount: competitors.count ?? 0,
        // Deliberately omitted: menu and pricing data does not reach the Ask context, and menu
        // insights are default-off (ALT-363). See ./suggested-questions for why.
      }),
      limit,
    )
  } catch (err) {
    console.warn("[ask-suggestions] count read failed, offering nothing location-specific:", err)
    return suggestedAskQuestions(NO_ASK_CAPABILITY, limit)
  }
}
