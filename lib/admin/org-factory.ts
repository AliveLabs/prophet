import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { TRIAL_DURATION_DAYS } from "@/lib/billing/trial"

type AdminClient = SupabaseClient<Database>
type OrgInsert = Database["public"]["Tables"]["organizations"]["Insert"]

export type OrgKind = "real" | "demo" | "test"

/** Canonical slug generator — shared by waitlist-approve and demo/test creation. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

export interface CreateOrgInput {
  /** The user who becomes the org owner (a new waitlist user, or the logged-in admin for demo/test). */
  ownerUserId: string
  orgName: string
  billingEmail?: string | null
  industryType?: "restaurant" | "liquor_store"
  /** 'real' (default, normal signup) | 'demo' | 'test'. */
  orgKind?: OrgKind
  /** Trial length in days. Default 14 (real). Demo/test pass 365 (overridable later via setTrialEndsAt). */
  trialDays?: number
  /** Set when this org is created from a waitlist signup, for dedupe + provenance. */
  waitlistSignupId?: string | null
}

export interface CreateOrgResult {
  orgId: string
}

/**
 * Create an organization and its owner membership.
 *
 * Extracted from approveWaitlistSignup so waitlist-approve and the demo/test
 * admin actions share one path (no copy-paste drift). Handles slug-collision
 * retry. Throws on failure — callers translate to their own result shape.
 *
 * Auth-user resolution is the CALLER's job (waitlist creates/reuses a user from
 * the signup email; demo/test pass the admin's own id), so this stays reusable.
 */
export async function createOrgWithOwner(
  admin: AdminClient,
  input: CreateOrgInput
): Promise<CreateOrgResult> {
  const {
    ownerUserId,
    orgName,
    billingEmail = null,
    industryType,
    orgKind = "real",
    trialDays = TRIAL_DURATION_DAYS,
    waitlistSignupId = null,
  } = input

  const baseSlug = slugify(orgName) || "org"
  const now = new Date()
  const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)

  let orgId: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const row: OrgInsert = {
      name: orgName,
      slug: attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`,
      billing_email: billingEmail,
      org_kind: orgKind,
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      waitlist_signup_id: waitlistSignupId,
    }
    if (industryType) row.industry_type = industryType

    const { data: org, error } = await admin
      .from("organizations")
      .insert(row)
      .select("id")
      .single()

    if (!error && org) {
      orgId = org.id
      break
    }
    // 23505 = unique_violation (slug collision) → try the next suffix.
    if (error?.code === "23505") continue
    throw new Error(error?.message ?? "Failed to create organization.")
  }

  if (!orgId) {
    throw new Error("Could not generate a unique organization slug.")
  }

  const { error: memberError } = await admin.from("organization_members").insert({
    organization_id: orgId,
    user_id: ownerUserId,
    role: "owner",
  })
  if (memberError) {
    throw new Error(memberError.message)
  }

  return { orgId }
}
