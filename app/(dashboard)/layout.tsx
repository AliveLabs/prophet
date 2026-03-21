import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { signOutAction } from "./actions"
import { Button } from "@/components/ui/button"
import ActiveJobBar from "@/components/ui/active-job-bar"
import SidebarNav from "@/components/ui/sidebar-nav"
import Topbar from "@/components/ui/topbar"
import TabBar from "@/components/ui/tab-bar"
import BottomNav from "@/components/ui/bottom-nav"
import { Toaster } from "sonner"

function VaticLogo() {
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
        stroke="#5A3FFF"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="22" r="2.6" fill="#F2A11E" />
    </svg>
  )
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
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
    .select("name")
    .eq("id", profile.current_organization_id)
    .maybeSingle()

  const userName = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User"
  const userOrg = orgRow?.name ?? "Vatic"

  return (
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
            <VaticLogo />
            <span className="sidebar-label text-[17px] font-semibold tracking-tight text-foreground">
              vatic
            </span>
          </Link>
        </div>

        <SidebarNav userName={userName} userOrg={userOrg} />

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

        <main className="flex-1 overflow-y-auto px-6 py-5 max-md:px-4 max-md:pb-[74px]">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ────────────────────────────────────── */}
      <BottomNav />
    </div>
  )
}
