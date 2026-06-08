// DEV/REVIEW-ONLY editorial shell for the reworked experience (no auth, prod-guarded
// via VERCEL_ENV). Frames the brief + first-pass pages in the new 4-item nav so the
// whole thing can be reviewed on a Vercel preview (or locally) before any of it moves
// into the real authed (dashboard) routes.
//
// cacheComponents pattern (matches app/(dashboard)/layout.tsx): the exported layout is
// sync — guard + a single <Suspense> — and a separate async Shell does ALL data access
// (loadAccountLocations) + chrome + children, so no uncached data renders outside the
// boundary during the production prerender.

import { Suspense, type ReactNode } from "react"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import PreviewNav from "./preview-nav"
import AccountMenu from "./account-menu"
import { loadAccountLocations, WAGYU_LOCATION_ID } from "./preview-data"
import "../(dashboard)/home/brief.css"
import "./preview.css"

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

export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.VERCEL_ENV === "production") notFound()
  return (
    <Suspense fallback={<PreviewSkeleton />}>
      <PreviewShell>{children}</PreviewShell>
    </Suspense>
  )
}

function PreviewSkeleton() {
  return (
    <div className="ticket-app">
      <aside className="pv-sidebar">
        <div className="pv-brand"><TicketMark /> TICKET</div>
        <PreviewNav />
      </aside>
      <main className="pv-main" />
    </div>
  )
}

async function PreviewShell({ children }: { children: ReactNode }) {
  await connection()
  const locations = await loadAccountLocations(WAGYU_LOCATION_ID)
  return (
    <div className="ticket-app">
      <aside className="pv-sidebar">
        <div className="pv-brand"><TicketMark /> TICKET</div>
        <PreviewNav />
        <div className="pv-spacer" />
        <AccountMenu userName="Anand" locations={locations} />
      </aside>
      <main className="pv-main">{children}</main>
    </div>
  )
}
