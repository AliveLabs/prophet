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
import { getImpersonation } from "@/lib/auth/impersonation"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { isTrialActive, isTrialing, getTrialDaysRemaining } from "@/lib/billing/trial"
import { asSubscriptionTier, TIER_PRICING } from "@/lib/billing/tiers"
import { AccountHeldPanel } from "@/components/billing/account-held-panel"
import { TrialBanner } from "@/components/billing/trial-banner"
import { DunningBanner } from "@/components/billing/dunning-banner"
import { BrandProvider } from "@/components/brand-provider"
import { getVerticalConfig, isValidIndustryType } from "@/lib/verticals"
import { Toaster } from "sonner"
import ShellNav from "./shell-nav"
import AccountMenu from "./account-menu"
import MobileTabBar from "./mobile-tabbar"
import NewBriefNotice from "./new-brief-notice"
import ThemeToggle from "@/components/ui/theme-toggle"
import { loadOperatorAccount } from "./operator-data"
import "./home/brief.css"
import "./operator.css"
import "@/components/ticket/pass.css"

// Theme-adaptive ticket-stub mark: body inherits --ink (currentColor) so it stays visible
// in dark mode; the perforations punch through in the surface color (--paper).
function TicketMark() {
  return (
    <svg width="18" height="28" viewBox="0 0 72 114" aria-hidden="true" style={{ color: "var(--ink)" }}>
      <rect x="0" y="0" width="72" height="14" rx="1.5" fill="currentColor" />
      <rect x="18" y="14" width="36" height="100" fill="currentColor" />
      <circle cx="18" cy="16" r="3.5" style={{ fill: "var(--paper)" }} />
      <circle cx="54" cy="16" r="3.5" style={{ fill: "var(--paper)" }} />
      <line x1="21.5" y1="16" x2="50.5" y2="16" style={{ stroke: "var(--paper)" }} strokeWidth="1.6" strokeDasharray="2.5,2" />
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
        {/* Skeleton nav: bare <span> items styled by `.pv-nav > span` to hold the
            same box as the live nav (ALT-149) so the rail reserves its shape and
            doesn't jump when <ShellNav> swaps in. The .tick here is a sized spacer
            standing in for the real item's leading icon slot. */}
        <nav className="pv-nav" aria-hidden>
          {["Today", "Competitors", "Ask", "Weather", "Events"].map((label) => (
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
  const impersonation = await getImpersonation()
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
    .select("name, subscription_tier, trial_started_at, trial_ends_at, industry_type, payment_state, stripe_customer_id, deleted_at")
    .eq("id", profile.current_organization_id)
    .maybeSingle()

  const verticalConfig = getVerticalConfig(orgRow?.industry_type)
  const isVerticalActive = process.env.VERTICALIZATION_ENABLED === "true"
  const dataBrand = isVerticalActive ? verticalConfig.brand.dataBrand : "ticket"
  const industryForGate = isValidIndustryType(orgRow?.industry_type) ? orgRow.industry_type : "restaurant"
  const brandNameForGate = industryForGate === "liquor_store" ? "Neat" : "Ticket"
  const orgName = orgRow?.name ?? (isVerticalActive ? verticalConfig.brand.displayName : "Ticket")

  // ── Billing gate ──
  // Held accounts now render the SAME shell (sidebar + AccountMenu intact, so
  // sign-out and org-switching are always reachable) with the reactivation
  // panel in the content area — not the old chromeless full-page takeover that
  // trapped expired users (2026-06-16 Chris incident). The account flyout needs
  // `account`, so load it before branching.
  const gated =
    !!orgRow &&
    !isTrialActive({
      trial_ends_at: orgRow.trial_ends_at,
      subscription_tier: orgRow.subscription_tier,
      payment_state: orgRow.payment_state,
    })

  const account = await loadOperatorAccount()

  // A soft-deleted org (Phase 6c) is gone for its members too — show a terminal notice (sign-out
  // stays reachable via AccountMenu) instead of the dashboard. No redirect: current_organization_id
  // still points here, so bouncing to /onboarding would loop. Only fires when deleted_at is set,
  // so live orgs are unaffected.
  if (orgRow?.deleted_at) {
    return (
      <BrandProvider brand={dataBrand}>
        <Toaster position="top-right" richColors closeButton />
        <div className="ticket-app">
          <div className="bg-atmos" aria-hidden />
          <aside className="pv-sidebar">
            <div className="pv-brand"><TicketMark /> TICKET</div>
            <ShellNav locked />
            <div className="pv-spacer" />
            <div className="pv-foot">
              <AccountMenu userName={account.userName} locations={account.locations} currentRole={account.currentRole} isPlatformAdmin={account.isPlatformAdmin} locked />
              <ThemeToggle className="pv-theme-btn" />
            </div>
          </aside>
          <main className="pv-main">
            <header className="pv-mobilebar">
              <span className="pv-mobilebar__brand"><TicketMark /> TICKET</span>
              <div className="pv-mobilebar__actions">
                <ThemeToggle className="pv-theme-btn" />
                <AccountMenu userName={account.userName} locations={account.locations} currentRole={account.currentRole} isPlatformAdmin={account.isPlatformAdmin} locked />
              </div>
            </header>
            <div className="mx-auto mt-24 max-w-md rounded-xl border border-border bg-card p-8 text-center">
              <h2 className="text-lg font-semibold text-foreground">
                This organization is no longer active
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                It has been removed. If you believe this is a mistake, contact support.
              </p>
            </div>
          </main>
        </div>
      </BrandProvider>
    )
  }

  if (gated && orgRow) {
    const locIds =
      (
        await supabase
          .from("locations")
          .select("id")
          .eq("organization_id", profile.current_organization_id)
      ).data?.map((l) => l.id) ?? []

    const [{ count: insightCount }, { count: competitorCount }] = await Promise.all([
      supabase.from("insights").select("id", { count: "exact", head: true }).in("location_id", locIds),
      supabase
        .from("competitors")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .in("location_id", locIds),
    ])

    return (
      <BrandProvider brand={dataBrand}>
        <Toaster position="top-right" richColors closeButton />
        {impersonation && (
          <ImpersonationBanner
            actorEmail={impersonation.actorEmail}
            targetEmail={impersonation.targetEmail}
          />
        )}
        <div className="ticket-app">
          <div className="bg-atmos" aria-hidden />
          <aside className="pv-sidebar">
            <div className="pv-brand"><TicketMark /> TICKET</div>
            <ShellNav locked />
            <div className="pv-spacer" />
            <div className="pv-foot">
              <AccountMenu userName={account.userName} locations={account.locations} currentRole={account.currentRole} isPlatformAdmin={account.isPlatformAdmin} locked />
              <ThemeToggle className="pv-theme-btn" />
            </div>
          </aside>
          <main className="pv-main">
            <header className="pv-mobilebar">
              <span className="pv-mobilebar__brand"><TicketMark /> TICKET</span>
              <div className="pv-mobilebar__actions">
                <ThemeToggle className="pv-theme-btn" />
                <AccountMenu userName={account.userName} locations={account.locations} currentRole={account.currentRole} isPlatformAdmin={account.isPlatformAdmin} locked />
              </div>
            </header>
            <AccountHeldPanel
              orgName={orgName}
              userEmail={user.email ?? null}
              brandName={brandNameForGate as "Ticket" | "Neat"}
              industry={industryForGate}
              insightCount={insightCount ?? 0}
              competitorCount={competitorCount ?? 0}
              trialEndedLabel={
                orgRow.trial_ends_at
                  ? new Date(orgRow.trial_ends_at).toLocaleDateString("en-US", { month: "long", day: "numeric" })
                  : null
              }
              neverStarted={!orgRow.trial_started_at && orgRow.payment_state == null}
              hasStripeCustomer={!!orgRow.stripe_customer_id}
            />
          </main>
        </div>
      </BrandProvider>
    )
  }

  const daysRemaining = orgRow ? getTrialDaysRemaining({ trial_ends_at: orgRow.trial_ends_at }) : 0
  // Show for the WHOLE trial (the in-app side of the notification cadence);
  // the banner itself escalates tone at T-4 / T-1 to mirror the reminder emails.
  const showTrialBanner =
    daysRemaining > 0 &&
    !!orgRow &&
    isTrialing({
      trial_ends_at: orgRow.trial_ends_at,
      subscription_tier: orgRow.subscription_tier,
      payment_state: orgRow.payment_state,
    })
  const showDunningBanner = orgRow?.payment_state === "past_due"
  const bannerTier = asSubscriptionTier(orgRow?.subscription_tier)

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
      {impersonation && (
        <ImpersonationBanner
          actorEmail={impersonation.actorEmail}
          targetEmail={impersonation.targetEmail}
        />
      )}
      {currentLoc ? (
        <NewBriefNotice locationId={currentLoc.id} generatedAt={briefGeneratedAt} enabled={noticeEnabled} />
      ) : null}
      <div className="ticket-app">
        <div className="bg-atmos" aria-hidden />
        <aside className="pv-sidebar">
          <div className="pv-brand"><TicketMark /> TICKET</div>
          <ShellNav />
          <div className="pv-spacer" />
          <div className="pv-foot">
            <AccountMenu userName={account.userName} locations={account.locations} currentRole={account.currentRole} isPlatformAdmin={account.isPlatformAdmin} />
            <ThemeToggle className="pv-theme-btn" />
          </div>
        </aside>
        <main className="pv-main">
          <header className="pv-mobilebar">
            <span className="pv-mobilebar__brand"><TicketMark /> TICKET</span>
            <div className="pv-mobilebar__actions">
              <ThemeToggle className="pv-theme-btn" />
              <AccountMenu userName={account.userName} locations={account.locations} currentRole={account.currentRole} isPlatformAdmin={account.isPlatformAdmin} />
            </div>
          </header>
          {showDunningBanner && <DunningBanner brand={brandNameForGate as "Ticket" | "Neat"} />}
          {showTrialBanner && (
            <TrialBanner
              daysRemaining={daysRemaining}
              brandName={brandNameForGate}
              isPaidTrial={orgRow?.payment_state === "trialing"}
              monthlyPrice={
                bannerTier !== "suspended" ? TIER_PRICING[bannerTier].monthly : undefined
              }
              endsOnLabel={
                orgRow?.trial_ends_at
                  ? new Date(orgRow.trial_ends_at).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                    })
                  : undefined
              }
            />
          )}
          {children}
        </main>
        <MobileTabBar />
      </div>
    </BrandProvider>
  )
}
