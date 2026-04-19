import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Page not found · Ticket",
  description:
    "This page is off the Ticket. Head back to the homepage or jump into your dashboard.",
}

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-6 py-24 text-foreground">
      {/* Soft radial wash so the 404 doesn't feel like a flat error page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,var(--vatic-indigo)/10,transparent_55%)] opacity-60"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-xl flex-col items-center text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-vatic-indigo">
          404 — Off the Ticket
        </p>
        <h1 className="mt-5 font-display text-5xl leading-[1.05] text-foreground md:text-6xl">
          This page <em className="italic text-accent">wandered off</em>.
        </h1>
        <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
          The page you were looking for isn&rsquo;t here — maybe the link is stale, or the
          route has moved. Let&rsquo;s get you back to something useful.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-7 py-3.5 text-sm font-bold tracking-tight text-primary-foreground shadow-sm transition-transform hover:scale-[0.97] hover:bg-deep-indigo"
          >
            Back to Ticket home
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md border border-border/60 px-7 py-3.5 text-sm font-bold tracking-tight text-foreground transition-colors hover:bg-muted/40"
          >
            Sign in to your dashboard
          </Link>
        </div>

        <p className="mt-16 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Ticket · Competitive intelligence for local operators
        </p>
      </div>
    </main>
  )
}
