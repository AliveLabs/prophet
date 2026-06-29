// TICKET ADMIN — shell rebuilt to "The Pass".
//
// Admin lives OUTSIDE the dashboard, so this layout carries its OWN token surface
// (.ticket-admin root → defines --paper/--rust/... via editorial-tokens.css, which
// admin.css @imports through the kit's pass.css) and the .tk-kit scope on content.
// Structure (NOT a reskin of the old border-list rail): a frosted floating-glass
// left rail with a rust-gradient brand mark + active-tick nav + identity foot, a
// glass desktop topbar, and a native mobile chrome (glass top bar + fixed bottom
// tab dock). Auth gate (requirePlatformAdminContext), ThemeToggle, and the sync
// layout / async shell + Suspense pattern are all preserved.

import { Suspense } from "react"
import { requirePlatformAdminContext } from "@/lib/auth/platform-admin"
import ThemeToggle from "@/components/ui/theme-toggle"
import { AdminRailNav, AdminTabBar } from "./admin-nav"
import "./admin.css"

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  read_only: "Read-only",
}

// The rust-gradient brand-mark glyph (a clock-radar nod to the platform's "sweep").
function AdminMark() {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M14 6 L14 14 L19.5 17.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AdminSkeleton() {
  return (
    <div className="ticket-admin tk-kit">
      <div className="bg-atmos" aria-hidden />
      <aside className="adm-sidebar">
        <div className="adm-brand">
          <span className="adm-brand__mark"><AdminMark /></span>
          <span className="adm-brand__wm">
            <b>Ticket</b>
            <span>Admin</span>
          </span>
        </div>
      </aside>
      <main className="adm-main" />
    </div>
  )
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, role } = await requirePlatformAdminContext()
  const roleLabel = ROLE_LABEL[role] ?? role
  const initial = (user.email?.[0] ?? "?").toUpperCase()

  return (
    <div className="ticket-admin tk-kit">
      <div className="bg-atmos" aria-hidden />

      {/* ── Desktop frosted rail ── */}
      <aside className="adm-sidebar">
        <div className="adm-brand">
          <span className="adm-brand__mark"><AdminMark /></span>
          <span className="adm-brand__wm">
            <b>Ticket</b>
            <span>Admin</span>
          </span>
        </div>

        <AdminRailNav />

        <div className="adm-spacer" />

        <div className="adm-foot">
          <div className="adm-id">
            <span className="adm-id__avatar" aria-hidden="true">{initial}</span>
            <span className="adm-id__who">
              <b title={user.email ?? undefined}>{user.email}</b>
              <span>{roleLabel}</span>
            </span>
          </div>
          <div className="adm-foot__row">
            <a className="adm-back" href="/home">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M9.5 3.5 5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Dashboard
            </a>
            <ThemeToggle className="adm-theme-btn" />
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="adm-main">
        {/* desktop topbar */}
        <header className="adm-topbar">
          <span className="adm-topbar__label">
            <span className="adm-livedot" aria-hidden="true" />
            Platform Administration
          </span>
          <span className="adm-rolepill">{roleLabel}</span>
        </header>

        {/* mobile glass top bar */}
        <header className="adm-mobilebar">
          <span className="adm-mobilebar__brand">
            <span className="adm-brand__mark"><AdminMark /></span>
            <b>Ticket<small>Admin</small></b>
          </span>
          <div className="adm-mobilebar__actions">
            <ThemeToggle className="adm-theme-btn" />
            <a className="adm-back" href="/home" aria-label="Back to dashboard">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M9.5 3.5 5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </header>

        <div className="adm-content">
          <div className="adm-content__inner">{children}</div>
        </div>
      </main>

      {/* ── Mobile bottom tab dock ── */}
      <AdminTabBar />
    </div>
  )
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<AdminSkeleton />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  )
}
