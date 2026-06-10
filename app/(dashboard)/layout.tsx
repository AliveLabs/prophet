// Authed shell — the reworked EDITORIAL experience (Stage A cutover port).
// 4-item nav (Today / Competitors / Ask + Settings in the account flyout) replaces the
// legacy 11-module sidebar/topbar/tabbar. Billing logic is preserved untouched:
// trial-expired gate, trial + dunning banners, brand provider.
//
// cacheComponents pattern (canonical for this repo): the exported layout is sync —
// a single <Suspense> whose fallback is 100% static — and the async Shell does ALL
// data access + chrome + children, so no uncached data renders outside the boundary.

import { redirect } from "next/navigation"
import { Suspense, type ReactNode } from "react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { isTrialActive, getTrialDaysRemaining } from "@/lib/billing/trial"
import { TrialExpiredGate } from "@/components/billing/trial-expired-gate"
import { TrialBanner } from "@/components/billing/trial-banner"
import { DunningBanner } from "@/components/billing/dunning-banner"
import { BrandProvider } from "@/components/brand-provider"
import { getVerticalConfig, isValidIndustryType } from "@/lib/verticals"
import { Toaster } from "sonner"
import ShellNav from "./shell-nav"
import AccountMenu from "./account-menu"
import NewBriefNotice from "./new-brief-notice"
import { loadOperatorAccount } from "./operator-data"
import "./home/brief.css"
import "./operator.css"

function TicketMark() {
  return (
    <svg width="17" height="27" viewBox="0 0 72 114" aria-hidden="true">
      <rect x="0" y="0" width="72" height="14" rx="1.5" fill="#1C1917" />
      <rect x="18" y="14" width="36" height="100" fill="#1C1917" />
      <circle cx="18" cy="16" r="3.5" fill="#F5F3EF" />
      <circle cx="54" cy="16" r="3.5" fill="#F5F3EF" />
      <line x1="21.5" y1="16" x2="50.5" y2="16" stroke="#F5F3EF" strokeWidth="1.6" strokeDasharray="2.5,2" />
    </svg>
  )
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <OperatorShell>{children}</OperatorShell>
    </Suspense>
  )
}

// Static fallback — must not touch request data (no usePathname / cookies).
function ShellSkeleton() {
  return (
    <div className="ticket-app">
      <aside className="pv-sidebar">
        <div className="pv-brand"><TicketMark /> TICKET</div>
        <nav className="pv-nav" aria-hidden>
          {["Today", "Competitors", "Ask"].map((label) => (
            <span key={label}><span className="tick" />{label}</span>
          ))}
        </nav>
      </aside>
      <main className="pv-main" />
    </div>
  )
}

async function OperatorShell({ children }: { children: ReactNode }) {
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
    .select("name, subscription_tier, trial_ends_at, industry_type, payment_state")
    .eq("id", profile.current_organization_id)
    .maybeSingle()

  const verticalConfig = getVerticalConfig(orgRow?.industry_type)
  const isVerticalActive = process.env.VERTICALIZATION_ENABLED === "true"
  const dataBrand = isVerticalActive ? verticalConfig.brand.dataBrand : "ticket"
  const industryForGate = isValidIndustryType(orgRow?.industry_type) ? orgRow.industry_type : "restaurant"
  const brandNameForGate = industryForGate === "liquor_store" ? "Neat" : "Ticket"
  const orgName = orgRow?.name ?? (isVerticalActive ? verticalConfig.brand.displayName : "Ticket")

  // ── Billing gate (unchanged from the legacy shell) ──
  if (
    orgRow &&
    !isTrialActive({
      trial_ends_at: orgRow.trial_ends_at,
      subscription_tier: orgRow.subscription_tier,
      payment_state: orgRow.payment_state,
    })
  ) {
    const locIds =
      (
        await supabase
          .from("locations")
          .select("id")
          .eq("organization_id", profile.current_organization_id)
      ).data?.map((l) => l.id) ?? []

    const { count: insightCount } = await supabase
      .from("insights")
      .select("id", { count: "exact", head: true })
      .in("location_id", locIds)

    const { count: competitorCount } = await supabase
      .from("competitors")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .in("location_id", locIds)

    return (
      <TrialExpiredGate
        orgName={orgName}
        insightCount={insightCount ?? 0}
        competitorCount={competitorCount ?? 0}
        brandName={brandNameForGate}
        industry={industryForGate}
      />
    )
  }

  const daysRemaining = orgRow ? getTrialDaysRemaining({ trial_ends_at: orgRow.trial_ends_at }) : 0
  const showTrialBanner =
    daysRemaining > 0 &&
    daysRemaining <= 7 &&
    (orgRow?.payment_state === "trialing" || orgRow?.subscription_tier === "free")
  const showDunningBanner = orgRow?.payment_state === "past_due"

  const account = await loadOperatorAccount()

  // New-brief notice inputs: the primary location's latest brief stamp + comms pref.
  const currentLoc = account.locations.find((l) => l.current) ?? account.locations[0]
  let briefGeneratedAt: string | null = null
  let noticeEnabled = true
  if (currentLoc) {
    const [{ data: latestBrief }, { data: locSettings }] = await Promise.all([
      supabase
        .from("daily_briefs")
        .select("generated_at")
        .eq("location_id", currentLoc.id)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("locations").select("settings").eq("id", currentLoc.id).maybeSingle(),
    ])
    briefGeneratedAt = latestBrief?.generated_at ?? null
    const comms = ((locSettings?.settings as Record<string, unknown> | null)?.communications ?? {}) as Record<string, boolean>
    noticeEnabled = comms.browser_notifications !== false
  }

  return (
    <BrandProvider brand={dataBrand}>
      {/* Toaster must stay OUTSIDE .ticket-app: its static wrapper would otherwise
          become a grid item and steal the 228px sidebar column (displacing the whole
          shell — sidebar to 1fr, main below the fold). */}
      <Toaster position="top-right" richColors closeButton />
      {currentLoc ? (
        <NewBriefNotice locationId={currentLoc.id} generatedAt={briefGeneratedAt} enabled={noticeEnabled} />
      ) : null}
      <div className="ticket-app">
        <aside className="pv-sidebar">
          <div className="pv-brand"><TicketMark /> TICKET</div>
          <ShellNav />
          <div className="pv-spacer" />
          <AccountMenu userName={account.userName} locations={account.locations} />
        </aside>
        <main className="pv-main">
          {showDunningBanner && <DunningBanner brand={brandNameForGate as "Ticket" | "Neat"} />}
          {showTrialBanner && (
            <TrialBanner
              daysRemaining={daysRemaining}
              brandName={brandNameForGate}
              isPaidTrial={orgRow?.payment_state === "trialing"}
            />
          )}
          {children}
        </main>
      </div>
    </BrandProvider>
  )
}
