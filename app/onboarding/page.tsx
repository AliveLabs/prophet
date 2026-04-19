import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import OnboardingWizard from "./onboarding-wizard"
import { getVerticalConfig } from "@/lib/verticals"
import { BrandProvider } from "@/components/brand-provider"

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const verticalParam = typeof params.vertical === "string" ? params.vertical : undefined
  const verticalConfig = getVerticalConfig(verticalParam)
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  if (profile?.current_organization_id) {
    redirect("/home")
  }

  // Resume logic: check if user is an owner of an org but current_organization_id is null
  // (happens when user refreshed at Step 2+ before completing onboarding)
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle()

  let existingOrgId: string | null = null
  let existingLocationId: string | null = null
  let existingCompetitors: Array<{
    id: string
    name: string | null
    category: string | null
    address: string | null
    metadata: Record<string, unknown>
    relevance_score: number | null
  }> = []

  if (membership?.organization_id) {
    existingOrgId = membership.organization_id

    const { data: loc } = await supabase
      .from("locations")
      .select("id")
      .eq("organization_id", existingOrgId)
      .limit(1)
      .maybeSingle()

    if (loc?.id) {
      existingLocationId = loc.id

      const { data: comps } = await supabase
        .from("competitors")
        .select("id, name, category, address, metadata, relevance_score")
        .eq("location_id", existingLocationId)
        .eq("is_active", false)
        .order("relevance_score", { ascending: false })

      existingCompetitors = (comps ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        address: c.address,
        metadata: (c.metadata as Record<string, unknown>) ?? {},
        relevance_score: c.relevance_score,
      }))
    }
  }

  const dataBrand =
    process.env.VERTICALIZATION_ENABLED === "true" && verticalParam
      ? verticalConfig.brand.dataBrand
      : "ticket"

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
