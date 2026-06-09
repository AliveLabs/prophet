import Link from "next/link"
import type { Metadata } from "next"
import "./chrome.css"

export const metadata: Metadata = {
  title: "Page not found · Ticket",
  description: "This page is off the Ticket. Head back home or into your dashboard.",
}

export default function NotFound() {
  return (
    <main className="ticket-chrome">
      <div className="chrome-card">
        <span className="chrome-kicker">404 · Off the Ticket</span>
        <h1 className="chrome-h">This page <em>wandered off</em>.</h1>
        <p className="chrome-sub">The link may be stale, or the route has moved. Let&apos;s get you back to something useful.</p>
        <div className="chrome-actions">
          <Link className="chrome-btn" href="/">Back to Ticket</Link>
          <Link className="chrome-btn chrome-btn--ghost" href="/home">Your dashboard</Link>
        </div>
        <p className="chrome-foot">Ticket · Competitive intelligence for restaurants</p>
      </div>
    </main>
  )
}
