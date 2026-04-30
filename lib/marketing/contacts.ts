import { createAdminSupabaseClient } from "@/lib/supabase/admin"

// Phase 3 marketing automation: shared client for the product-side mirror into
// `marketing.contacts`. Chris (marketing automation) owns the table definition
// (`app/docs/stream1-supabase-schema.sql`) and the n8n lifecycle workflows;
// the product app only writes rows here so those workflows have a stable view
// of lifecycle state.
//
// Always gated behind MARKETING_CONTACTS_ENABLED so this code can ship before
// Chris's schema migration lands. When the flag is off, all upserts no-op.
//
// COLUMN CONTRACT (must match stream1-supabase-schema.sql v1.2):
//   email citext UNIQUE, first_name, last_name, industry_type NOT NULL,
//   status marketing.contact_status, stripe_customer_id, posthog_distinct_id.
// Do NOT add columns here that don't exist in Chris's schema -- PostgREST
// will reject the write and the mirror silently drops the row.

export type MarketingIndustryType = "restaurant" | "liquor_store"

export type MarketingStatus =
  | "waitlist"
  | "access_granted"
  | "trial"
  | "paid"
  | "churned"

// Must match marketing.contacts.contacts_source_chk in
// supabase/migrations/20260424152231_marketing_stream1_schema.sql:65-67.
// Adding a new value here requires a CHECK-constraint migration on Chris's
// schema first or the INSERT will be rejected by Postgres.
export type MarketingSource =
  | "getticket.ai"
  | "goneat.ai"
  | "auricmobile.app"
  | "outbound"
  | "referral"
  | "import"
  | "manual"

export interface UpsertMarketingContactInput {
  email: string
  industryType?: MarketingIndustryType
  status?: MarketingStatus
  source?: MarketingSource
  stripeCustomerId?: string | null
  posthogDistinctId?: string | null
  firstName?: string | null
  lastName?: string | null
}

export interface UpsertMarketingContactResult {
  ok: boolean
  skipped?: boolean
  reason?: "flag_off" | "no_existing_row_and_no_industry"
  error?: unknown
}

export function isMarketingContactsEnabled(): boolean {
  return process.env.MARKETING_CONTACTS_ENABLED === "true"
}

// Minimal structural type for the Supabase admin client narrowed to the
// `marketing` schema. The generated `Database` type only models the public
// schema, so we hand-roll the shape of the handful of calls we make here.
type MarketingSchemaClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null
          error: unknown
        }>
      }
    }
    insert: (values: Record<string, unknown>) => Promise<{ error: unknown }>
    update: (values: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: unknown }>
    }
  }
}

function getMarketingSchema(): MarketingSchemaClient {
  const supabase = createAdminSupabaseClient()
  // `marketing` must be in Supabase Settings -> API -> Exposed schemas for
  // PostgREST to accept this. Chris confirms that's part of his deploy
  // checklist; BLUEPRINT Section 3 documents it as a deploy prerequisite.
  return (
    supabase as unknown as {
      schema: (name: string) => MarketingSchemaClient
    }
  ).schema("marketing")
}

export async function upsertMarketingContact(
  input: UpsertMarketingContactInput
): Promise<UpsertMarketingContactResult> {
  if (!isMarketingContactsEnabled()) {
    return { ok: true, skipped: true, reason: "flag_off" }
  }

  const normalizedEmail = input.email.toLowerCase().trim()
  if (!normalizedEmail) {
    return { ok: false, error: new Error("email is required") }
  }

  // Build payload of only the columns that exist in Chris's schema.
  const payload: Record<string, unknown> = {}
  if (input.industryType !== undefined) payload.industry_type = input.industryType
  if (input.status !== undefined) payload.status = input.status
  if (input.source !== undefined) payload.source = input.source
  if (input.stripeCustomerId !== undefined)
    payload.stripe_customer_id = input.stripeCustomerId
  if (input.posthogDistinctId !== undefined)
    payload.posthog_distinct_id = input.posthogDistinctId
  if (input.firstName !== undefined) payload.first_name = input.firstName
  if (input.lastName !== undefined) payload.last_name = input.lastName

  try {
    const marketingSchema = getMarketingSchema()

    // Read-then-write instead of upsert because `industry_type NOT NULL` (no
    // default) makes INSERTs from callers that don't know the vertical (auth
    // callback, posthog-bridge) unsafe. Policy: if row exists -> UPDATE only;
    // if row does not exist -> only INSERT when we have enough to satisfy the
    // NOT NULL constraints (industry_type), otherwise skip.
    const { data: existing, error: readError } = await marketingSchema
      .from("contacts")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle()

    if (readError) {
      console.error("marketing.contacts read failed:", readError)
      return { ok: false, error: readError }
    }

    if (existing) {
      const { error: updateError } = await marketingSchema
        .from("contacts")
        .update(payload)
        .eq("id", existing.id)
      if (updateError) {
        console.error("marketing.contacts update failed:", updateError)
        return { ok: false, error: updateError }
      }
      return { ok: true }
    }

    if (!input.industryType) {
      return {
        ok: true,
        skipped: true,
        reason: "no_existing_row_and_no_industry",
      }
    }

    const { error: insertError } = await marketingSchema
      .from("contacts")
      .insert({ ...payload, email: normalizedEmail })
    if (insertError) {
      console.error("marketing.contacts insert failed:", insertError)
      return { ok: false, error: insertError }
    }
    return { ok: true }
  } catch (error) {
    console.error("marketing.contacts upsert threw:", error)
    return { ok: false, error }
  }
}

// Look up the billing contact email for an organization. Chris's `marketing_ops`
// grant whitelists `organizations.billing_email` exactly for this use case, so
// we prefer it over profiles.email. Returns null and logs if the lookup fails
// or the column is empty, so the caller can skip the mirror without blowing up.
export async function getOrganizationBillingEmail(
  organizationId: string
): Promise<string | null> {
  try {
    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from("organizations")
      .select("billing_email")
      .eq("id", organizationId)
      .maybeSingle()

    if (error) {
      console.error("billing_email lookup failed:", error)
      return null
    }

    const email = (data as { billing_email?: string | null } | null)?.billing_email
    return email ? email.toLowerCase().trim() : null
  } catch (error) {
    console.error("billing_email lookup threw:", error)
    return null
  }
}
