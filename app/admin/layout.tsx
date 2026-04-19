import { Suspense } from "react"
import Link from "next/link"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import ThemeToggle from "@/components/ui/theme-toggle"

function AdminSkeleton() {
  return (
    <div className="flex h-dvh animate-pulse bg-background">
      <div className="w-56 border-r border-border bg-card" />
      <div className="flex-1 p-8">
        <div className="h-8 w-48 rounded bg-secondary" />
      </div>
    </div>
  )
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin()

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 min-w-56 flex-col border-r border-border bg-card">
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <svg
            viewBox="0 0 28 28"
            fill="none"
            className="h-6 w-6 text-vatic-indigo"
          >
            <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2" />
            <path
              d="M14 6 L14 14 L20 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-base font-semibold tracking-tight text-foreground">
            Ticket Admin
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          <AdminNavItem href="/admin" label="Overview" icon={overviewIcon} />
          <AdminNavItem
            href="/admin/waitlist"
            label="Waitlist"
            icon={waitlistIcon}
          />
          <AdminNavItem
            href="/admin/users"
            label="Users"
            icon={usersIcon}
          />
          <AdminNavItem
            href="/admin/organizations"
            label="Organizations"
            icon={orgsIcon}
          />
          <AdminNavItem
            href="/admin/settings"
            label="Settings"
            icon={settingsIcon}
          />
        </nav>

        <div className="border-t border-border px-4 py-3">
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <Link
            href="/home"
            className="mt-1 block text-xs text-vatic-indigo hover:underline"
          >
            Back to Dashboard
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <span className="text-sm font-medium text-muted-foreground">
            Platform Administration
          </span>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  )
}

function AdminNavItem({
  href,
  label,
  icon,
}: {
  href: string
  label: string
  icon: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <span className="h-4 w-4">{icon}</span>
      {label}
    </Link>
  )
}

const overviewIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="1" y="1" width="6" height="6" rx="1" />
    <rect x="9" y="1" width="6" height="6" rx="1" />
    <rect x="1" y="9" width="6" height="6" rx="1" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </svg>
)

const waitlistIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M2 4h12M2 8h12M2 12h8" strokeLinecap="round" />
  </svg>
)

const usersIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <circle cx="8" cy="5" r="2.5" />
    <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" strokeLinecap="round" />
  </svg>
)

const orgsIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="3" y="2" width="10" height="12" rx="1" />
    <path d="M6 5h4M6 8h4M6 11h2" strokeLinecap="round" />
  </svg>
)

const settingsIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4" />
  </svg>
)

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
