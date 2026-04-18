import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense, type ReactNode } from "react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { isTrialActive, getTrialDaysRemaining } from "@/lib/billing/trial"
import { signOutAction } from "./actions"
import { Button } from "@/components/ui/button"
import ActiveJobBar from "@/components/ui/active-job-bar"
import SidebarNav from "@/components/ui/sidebar-nav"
import Topbar from "@/components/ui/topbar"
import TabBar from "@/components/ui/tab-bar"
import BottomNav from "@/components/ui/bottom-nav"
import { TrialExpiredGate } from "@/components/billing/trial-expired-gate"
import { TrialBanner } from "@/components/billing/trial-banner"
import { BrandProvider } from "@/components/brand-provider"
import { getVerticalConfig } from "@/lib/verticals"
import { Toaster } from "sonner"

function BrandLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      <path
        d="M4 6 L14 22 L24 6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="22" r="2.6" className="fill-accent" />
    </svg>
  )
}

function DashboardSkeleton() {
  return (
    <div className="app-shell flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="sidebar flex w-[236px] min-w-[236px] flex-col border-r border-border bg-card max-md:hidden max-lg:w-[60px] max-lg:min-w-[60px]">
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border px-5 max-lg:justify-center max-lg:px-0">
          <BrandLogo />
          <span className="sidebar-label text-[17px] font-semibold tracking-tight text-foreground text-wordmark">
            vatic
          </span>
        </div>
        <div className="flex-1 px-3 py-4">
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="h-[60px] shrink-0 border-b border-border bg-card" />
        <main className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto max-w-[1400px] space-y-4">
            <div className="h-10 w-48 animate-pulse rounded-lg bg-muted/50" />
            <div className="h-64 animate-pulse rounded-2xl bg-muted/30" />
          </div>
        </main>
      </div>
    </div>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  )
}

async function DashboardShell({ children }: { children: ReactNode }) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.current_organization_id) {
    redirect("/onboarding")
  }

  const { data: orgRow } = await supabase
    .from("organizations")
    .select("name, subscription_tier, trial_ends_at, industry_type")
    .eq("id", profile.current_organization_id)
    .maybeSingle()

  const { data: memberRows } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, subscription_tier)")
    .eq("user_id", user.id)

  const allOrgs = (memberRows ?? [])
    .filter((m) => m.organizations)
    .map((m) => {
      const org = m.organizations as unknown as { id: string; name: string; subscription_tier: string }
      return {
        id: org.id,
        name: org.name,
        tier: org.subscription_tier ?? "free",
        role: m.role,
      }
    })

  const verticalConfig = getVerticalConfig(orgRow?.industry_type)
  const dataBrand =
    process.env.VERTICALIZATION_ENABLED === "true"
      ? verticalConfig.brand.dataBrand
      : undefined

  const userName = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User"
  const brandFallback = dataBrand ? verticalConfig.brand.displayName : "Vatic"
  const userOrg = orgRow?.name ?? brandFallback
  const brandWordmark = dataBrand ? verticalConfig.brand.wordmark : "vatic"

  if (
    orgRow &&
    !isTrialActive({
      trial_ends_at: orgRow.trial_ends_at,
      subscription_tier: orgRow.subscription_tier,
    })
  ) {
    const { count: insightCount } = await supabase
      .from("insights")
      .select("id", { count: "exact", head: true })
      .in(
        "location_id",
        (
          await supabase
            .from("locations")
            .select("id")
            .eq("organization_id", profile.current_organization_id)
        ).data?.map((l) => l.id) ?? []
      )

    const { count: competitorCount } = await supabase
      .from("competitors")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .in(
        "location_id",
        (
          await supabase
            .from("locations")
            .select("id")
            .eq("organization_id", profile.current_organization_id)
        ).data?.map((l) => l.id) ?? []
      )

    return (
      <TrialExpiredGate
        orgName={userOrg}
        insightCount={insightCount ?? 0}
        competitorCount={competitorCount ?? 0}
        brandName={brandFallback}
      />
    )
  }

  const daysRemaining = orgRow
    ? getTrialDaysRemaining({ trial_ends_at: orgRow.trial_ends_at })
    : 0
  const showTrialBanner =
    orgRow?.subscription_tier === "free" && daysRemaining > 0 && daysRemaining <= 7

  return (
    <BrandProvider brand={dataBrand}>
    <div className="app-shell flex h-dvh overflow-hidden bg-background text-foreground">
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            success: "!border-l-4 !border-l-precision-teal",
            error: "!border-l-4 !border-l-destructive",
            info: "!border-l-4 !border-l-primary",
          },
        }}
      />
      <ActiveJobBar />

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside className="sidebar flex w-[236px] min-w-[236px] flex-col border-r border-border bg-card max-md:hidden max-lg:w-[60px] max-lg:min-w-[60px]">
        {/* Logo */}
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border px-5 max-lg:justify-center max-lg:px-0">
          <Link href="/home" className="flex items-center gap-3">
            <BrandLogo />
            <span className="sidebar-label text-[17px] font-semibold tracking-tight text-foreground text-wordmark">
              {brandWordmark}
            </span>
          </Link>
        </div>

        <SidebarNav userName={userName} userOrg={userOrg} orgs={allOrgs} currentOrgId={profile.current_organization_id} />

        {/* Sign out (collapsed into sidebar footer area) */}
        <div className="shrink-0 border-t border-border px-3 py-2 max-lg:px-1">
          <form action={signOutAction}>
            <Button variant="ghost" size="sm" className="sidebar-label w-full justify-start text-xs text-muted-foreground">
              Sign out
            </Button>
            <Button variant="ghost" size="sm" className="sidebar-icon-only hidden w-full max-lg:flex" aria-label="Sign out">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M5.5 1.5 L1.5 1.5 L1.5 13.5 L5.5 13.5M10.5 4 L13.5 7.5 L10.5 11M5 7.5 L13 7.5" />
              </svg>
            </Button>
          </form>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar userName={userName} />
        <TabBar />

        {showTrialBanner && <TrialBanner daysRemaining={daysRemaining} />}

        <main className="flex-1 overflow-y-auto px-6 py-5 max-md:px-4 max-md:pb-[74px]">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ────────────────────────────────────── */}
      <BottomNav />
    </div>
    </BrandProvider>
  )
}
