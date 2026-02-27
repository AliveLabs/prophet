import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { signOutAction } from "./actions"
import { Button } from "@/components/ui/button"
import ActiveJobBar from "@/components/ui/active-job-bar"
import { Toaster } from "sonner"

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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Toaster position="top-right" richColors closeButton />
      <ActiveJobBar />
      <div className="grid min-h-screen w-full grid-cols-[260px_1fr] gap-6 px-6 py-6">
        <aside className="flex h-[calc(100vh-48px)] flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <Link href="/home" className="text-lg font-semibold">
            Prophet
          </Link>
          <nav className="mt-8 space-y-1 text-sm text-slate-600">
            <Link className="block rounded-xl px-3 py-2 hover:bg-slate-100" href="/home">
              Home
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/insights"
            >
              Insights
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/competitors"
            >
              Competitors
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/events"
            >
              Events
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/visibility"
            >
              Visibility
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/content"
            >
              Content
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/photos"
            >
              Photos
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/traffic"
            >
              Busy Times
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/weather"
            >
              Weather
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/locations"
            >
              Locations
            </Link>
            <Link
              className="block rounded-xl px-3 py-2 hover:bg-slate-100"
              href="/settings"
            >
              Settings
            </Link>
          </nav>
          <form action={signOutAction} className="mt-auto pt-6">
            <Button variant="secondary" className="w-full">
              Sign out
            </Button>
          </form>
        </aside>

        <div className="space-y-6">
          <header className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
            <div>
              <p className="text-sm text-slate-500">Welcome back</p>
              <p className="text-lg font-semibold">Your competitive overview</p>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span className="rounded-full border border-slate-200 px-3 py-1">
                Daily monitoring
              </span>
            </div>
          </header>
          <main className="space-y-6">{children}</main>
        </div>
      </div>
    </div>
  )
}
