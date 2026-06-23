import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import OnboardingWizard from "./onboarding-wizard"
import { getVerticalConfig } from "@/lib/verticals"
import { BrandProvider } from "@/components/brand-provider"

type OnboardingCandidate = {
  id: string
  name: string | null
  category: string | null
  address: string | null
  metadata: Record<string, unknown>
  relevance_score: number | null
}

// Load an org's first location + its still-pending (is_active=false) competitor
// candidates so the wizard can resume/continue mid-setup. Shared by the normal
// resume path and admin setup mode.
async function loadLocationAndCompetitors(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  orgId: string
): Promise<{ locationId: string | null; competitors: OnboardingCandidate[] }> {
  const { data: loc } = await supabase
    .from("locations")
    .select("id")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!loc?.id) return { locationId: null, competitors: [] }

  const { data: comps } = await supabase
    .from("competitors")
    .select("id, name, category, address, metadata, relevance_score")
    .eq("location_id", loc.id)
    .eq("is_active", false)
    .order("relevance_score", { ascending: false })

  return {
    locationId: loc.id,
    competitors: (comps ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      address: c.address,
      metadata: (c.metadata as Record<string, unknown>) ?? {},
      relevance_score: c.relevance_score,
    })),
  }
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const verticalParam = typeof params.vertical === "string" ? params.vertical : undefined
  const verticalConfig = getVerticalConfig(verticalParam)
  const dataBrand =
    process.env.VERTICALIZATION_ENABLED === "true" && verticalParam
      ? verticalConfig.brand.dataBrand
      : "ticket"

  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  // ---- Admin setup mode: complete a specific demo/test org through the wizard.
  const setupOrgId = typeof params.org === "string" ? params.org : undefined
  if (setupOrgId) {
    // Must be a member of the target org (admins own the demo orgs they create).
    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", setupOrgId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!membership) redirect("/home")

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, org_kind")
      .eq("id", setupOrgId)
      .maybeSingle()
    if (!org) redirect("/home")

    // Guardrail: setup mode is ONLY for demo/test orgs. Never re-run onboarding
    // against a real customer org — it would re-approve competitors, reset
    // monitoring prefs, and re-enqueue the pipeline.
    if (org.org_kind !== "demo" && org.org_kind !== "test") {
      redirect(`/admin/organizations/${setupOrgId}`)
    }

    const { locationId, competitors } = await loadLocationAndCompetitors(
      supabase,
      setupOrgId
    )

    // Already set up (location + ≥1 ACTIVE competitor)? Don't re-render the
    // wizard — re-running completion would re-approve competitors, reset
    // monitoring prefs, and re-enqueue the pipeline. Send them to the org page,
    // where "Open demo" is the right action (matches DemoSetupBanner's "ready").
    if (locationId) {
      const { count: activeCompetitors } = await supabase
        .from("competitors")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("is_active", true)
      if ((activeCompetitors ?? 0) > 0) {
        redirect(`/admin/organizations/${setupOrgId}`)
      }
    }

    return (
      <BrandProvider brand={dataBrand}>
        <div className="min-h-dvh bg-background text-foreground">
          <OnboardingWizard
            existingOrgId={setupOrgId}
            existingLocationId={locationId}
            existingCompetitors={competitors}
            verticalConfig={verticalConfig}
            mode="setup"
            setupOrgName={org.name}
          />
        </div>
      </BrandProvider>
    )
  }

  // ---- Normal signup / resume path.
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  if (profile?.current_organization_id) {
    redirect("/home")
  }

  // Resume: user owns an org but current_organization_id is null (refreshed at
  // step 2+ before completing). Hydrate the wizard from the existing org.
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle()

  let existingOrgId: string | null = null
  let existingLocationId: string | null = null
  let existingCompetitors: OnboardingCandidate[] = []

  if (membership?.organization_id) {
    existingOrgId = membership.organization_id
    const loaded = await loadLocationAndCompetitors(supabase, membership.organization_id)
    existingLocationId = loaded.locationId
    existingCompetitors = loaded.competitors
  }

  return (
    <BrandProvider brand={dataBrand}>
      <div className="min-h-dvh bg-background text-foreground">
        <OnboardingWizard
          existingOrgId={existingOrgId}
          existingLocationId={existingLocationId}
          existingCompetitors={existingCompetitors}
          verticalConfig={verticalConfig}
        />
      </div>
    </BrandProvider>
  )
}
