// DEV/REVIEW-ONLY editorial shell for the reworked experience (no auth, prod-guarded).
// Frames the brief + first-pass pages in the new 4-item nav so the whole thing can be
// reviewed locally before any of it moves into the real authed (dashboard) routes.

import type { ReactNode } from "react"
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

export default async function PreviewLayout({ children }: { children: ReactNode }) {
  // Hide on the PRODUCTION deployment only. NODE_ENV is "production" on every Vercel
  // build (incl. previews), so it must NOT be the discriminator — VERCEL_ENV is
  // "production" only on prod, "preview" on preview deploys, undefined on local dev.
  if (process.env.VERCEL_ENV === "production") notFound()
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
