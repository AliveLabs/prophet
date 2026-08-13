import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  getOrganizationBillingEmail,
  isMarketingContactsEnabled,
  upsertMarketingContact,
  type MarketingIndustryType,
  type MarketingSource,
  type MarketingStatus,
} from "./contacts"

// ALT-591: card-less "skip for now" trials never touch Stripe, so the webhook
// mirror (app/api/stripe/webhook) never writes their marketing.contacts row and
// Chris's n8n trial drip cannot see them -- they got zero lifecycle email.
// This module is the product-side mirror for lifecycle transitions that happen
// WITHOUT a Stripe event:
//   - completeOnboardingAction  -> 'access_granted' (row exists before any
//     trial transition, so the later status change is an UPDATE and Chris's
//     BEFORE UPDATE OF status trigger fires; also hands n8n the name fields)
//   - startTrialWithoutCardAction -> 'trial' (the card-less trial start)
// Card-backed trials keep flowing through the Stripe webhook mirror
// (subscription status 'trialing' -> 'trial'); both paths converge on
// upsertMarketingContact, which is trigger-safe for fresh inserts too.
//
// Everything stays behind MARKETING_CONTACTS_ENABLED (checked first so the
// flag-off path costs zero queries) and NEVER throws: a marketing mirror
// failure must not break onboarding or a trial start.

/** The `source` value Chris's schema expects for a product-side signup,
 *  keyed by the org's vertical (contacts_source_chk allows both). */
export function marketingSourceForIndustry(
  industryType: string | null | undefined
): MarketingSource {
  return industryType === "liquor_store" ? "goneat.ai" : "getticket.ai"
}

export interface MirrorLifecycleInput {
  organizationId: string
  status: MarketingStatus
  /** Used when organizations.billing_email is empty (e.g. legacy rows). */
  fallbackEmail?: string | null
  firstName?: string | null
  lastName?: string | null
}

export async function mirrorLifecycleToMarketing(
  input: MirrorLifecycleInput
): Promise<void> {
  if (!isMarketingContactsEnabled()) return

  try {
    const admin = createAdminSupabaseClient()
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("industry_type, org_kind")
      .eq("id", input.organizationId)
      .maybeSingle()
    if (orgError || !org) {
      console.error("marketing lifecycle mirror: org lookup failed", orgError)
      return
    }

    // Demo/test showcases are admin-built; mirroring them would enroll the
    // admin's own address in Chris's nurture drip and pollute his list with
    // the exact test data the 2026-08 cleanup just purged.
    if (org.org_kind === "demo" || org.org_kind === "test") return

    const billingEmail = await getOrganizationBillingEmail(input.organizationId)
    const email = billingEmail ?? input.fallbackEmail?.toLowerCase().trim()
    if (!email) {
      console.warn(
        `marketing lifecycle mirror: no email for org ${input.organizationId}, skipping`
      )
      return
    }

    const industryType: MarketingIndustryType =
      org.industry_type === "liquor_store" ? "liquor_store" : "restaurant"

    const result = await upsertMarketingContact({
      email,
      industryType,
      status: input.status,
      source: marketingSourceForIndustry(org.industry_type),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    })
    if (!result.ok) {
      console.error(
        `marketing lifecycle mirror: upsert failed for org ${input.organizationId}`,
        result.error
      )
    }
  } catch (error) {
    console.error("marketing lifecycle mirror threw:", error)
  }
}
