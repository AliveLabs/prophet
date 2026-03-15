import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { signOutAction } from "./actions"
import { Button } from "@/components/ui/button"
import ActiveJobBar from "@/components/ui/active-job-bar"
import ThemeToggle from "@/components/ui/theme-toggle"
import { Toaster } from "sonner"

function VaticLogo({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Vatic logo"
    >
      <path
        d="M10 14 L40 66 L70 14"
        stroke="#5A3FFF"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="40" cy="66" r="6" fill="#F2A11E" />
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

  return (
    <div className="min-h-screen bg-background text-foreground">
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
      <div className="grid min-h-screen w-full grid-cols-[260px_1fr] gap-6 px-6 py-6">
        <aside className="flex h-[calc(100vh-48px)] flex-col border-r border-border bg-card p-5 shadow-card-sm">
          <Link href="/home" className="flex items-center gap-2.5">
            <VaticLogo />
            <span className="font-display text-xl font-medium tracking-tight text-foreground">
              Vatic
            </span>
          </Link>
          <nav className="mt-8 space-y-1 text-sm text-muted-foreground">
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/home">
              Home
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/insights">
              Insights
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/competitors">
              Competitors
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/social">
              Social
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/events">
              Events
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/visibility">
              Visibility
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/content">
              Content
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/photos">
              Photos
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/traffic">
              Busy Times
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/weather">
              Weather
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/locations">
              Locations
            </Link>
            <Link className="block rounded-xl px-3 py-2 transition-colors hover:bg-secondary hover:text-foreground" href="/settings">
              Settings
            </Link>
          </nav>
          <div className="mt-auto flex items-center gap-2 pt-6">
            <ThemeToggle />
            <form action={signOutAction} className="flex-1">
              <Button variant="secondary" className="w-full">
                Sign out
              </Button>
            </form>
          </div>
        </aside>

        <div className="space-y-6">
          <header className="flex items-center justify-between rounded-lg border border-border bg-card px-6 py-4 shadow-card-sm">
            <div>
              <p className="text-sm text-muted-foreground">Welcome back</p>
              <p className="text-lg font-semibold text-foreground">Your competitive overview</p>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                Intelligence &middot; Live
              </span>
            </div>
          </header>
          <main className="space-y-6">{children}</main>
        </div>
      </div>
    </div>
  )
}
