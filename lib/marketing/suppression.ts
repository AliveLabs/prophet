import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { normalizeUnsubscribeEmail } from "@/lib/marketing/unsubscribe-token"

// D7 unsubscribe: the marketing opt-out flag, and NOTHING else.
//
// SCOPE INVARIANT (Bryan's hard requirement): this flag governs MARKETING
// email only. It lives on `marketing.contacts` (Chris's schema) and is read
// exclusively by marketing send paths (today: Chris's n8n workflows, which
// must filter `WHERE unsubscribed_at IS NULL`). The app's transactional
// senders (lib/email/*: magic links, billing, receipts, security notices)
// must NEVER import this module or read this column -- transactional email is
// exempt from marketing opt-out BY CONSTRUCTION, not by a runtime check.
// tests/unit/email/transactional-exemption.test.ts enforces both directions.
//
// COLUMN CONTRACT: Chris owns the `marketing` schema
// (app/docs/stream1-supabase-schema.sql). This module writes exactly one
// column, `unsubscribed_at timestamptz`, which does NOT exist in his v1.3
// schema yet -- it is added by the (deliberately unapplied) migration
// supabase/migrations/20260813090000_marketing_contacts_unsubscribed_at.sql,
// which needs his sign-off. Until that lands, PostgREST rejects the write,
// this returns ok:false, and the /unsubscribe page shows its neutral retry
// state. That is intentional: a compliance write must fail loudly rather
// than no-op behind a flag.

export interface SetMarketingOptOutResult {
  ok: boolean
  error?: unknown
}

// Minimal structural type for the admin client narrowed to the `marketing`
// schema (the generated Database type only models `public`). Mirrors the
// pattern in lib/marketing/contacts.ts.
type MarketingSchemaClient = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: unknown }>
    }
  }
}

function getMarketingSchema(): MarketingSchemaClient {
  const supabase = createAdminSupabaseClient()
  // `marketing` must be listed in Supabase Settings -> API -> Exposed schemas
  // (part of Chris's deploy checklist; see lib/marketing/contacts.ts).
  return (
    supabase as unknown as { schema: (name: string) => MarketingSchemaClient }
  ).schema("marketing")
}

/**
 * Set or clear the marketing opt-out for one contact.
 *
 * optOut=true stamps `unsubscribed_at = now()`; optOut=false clears it
 * (resubscribe through the same signed link).
 *
 * NON-ENUMERATION: this is an UPDATE keyed on email with no prior SELECT and
 * no row-count check. An email with no contact row updates zero rows and
 * still returns ok:true, so the caller's response is identical for known and
 * unknown addresses. Do not "improve" this into a read-then-write.
 */
export async function setMarketingEmailOptOut(
  email: string,
  optOut: boolean
): Promise<SetMarketingOptOutResult> {
  const normalized = normalizeUnsubscribeEmail(email)
  if (!normalized) return { ok: false, error: new Error("email is required") }

  try {
    const { error } = await getMarketingSchema()
      .from("contacts")
      .update({ unsubscribed_at: optOut ? new Date().toISOString() : null })
      .eq("email", normalized)

    if (error) {
      console.error("marketing opt-out write failed:", error)
      return { ok: false, error }
    }
    return { ok: true }
  } catch (error) {
    console.error("marketing opt-out write threw:", error)
    return { ok: false, error }
  }
}
