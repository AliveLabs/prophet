import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { HashTokenHandler } from "@/components/auth/hash-token-handler"
import { AuthEmailForm } from "../auth-email-form"
import { GoogleSignIn } from "../google-signin"
import { TicketLogo } from "@/components/brand/ticket-logo"
import { TkSonar } from "@/components/ticket"
import "@/components/ticket/pass.css"
import "./auth.css"

type LoginPageProps = {
  searchParams?: Promise<{ error?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  if (data.user) {
    // Match the auth-callback rule: an authed user with no current org hasn't
    // finished onboarding — resume it instead of bouncing to a blank /home.
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", data.user.id)
      .maybeSingle()
    redirect(profile?.current_organization_id ? "/home" : "/onboarding")
  }

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const error = resolvedSearchParams?.error

  return (
    <main className="ticket-chrome auth-shell">
      <HashTokenHandler />

      <div className="auth-split">
        {/* LEFT — pearlescent canvas + welcome lede (desktop/tablet) */}
        <section className="auth-canvas">
          <span className="auth-canvas__brand">
            <span className="auth-mark" aria-hidden="true"><TicketLogo size={18} className="text-white" /></span>
            Ticket
          </span>

          <div className="auth-lede">
            <span className="auth-kicker">Welcome back</span>
            <h1 className="auth-h">Sign in to your <em>feed</em>.</h1>
            <p className="auth-lede__sub">
              Your competitive briefing is waiting: menus, pricing, reviews, and
              social, read for you overnight.
            </p>
          </div>

          <div className="auth-badge">
            <TkSonar size={46} className="auth-badge__sonar" label="Watching your competitors" />
            <span className="auth-badge__txt">
              <span className="auth-badge__k">Status</span>
              <span className="auth-badge__v">Watching your competitors</span>
            </span>
          </div>
        </section>

        {/* RIGHT — floating form panel */}
        <section className="auth-panelcol">
          <div className="auth-panel">
            {/* welcome message repeats inside the panel on mobile (canvas lede hides) */}
            <div className="auth-panel__lede">
              <span className="auth-kicker">Welcome back</span>
              <h2 className="auth-panel__h">Sign in to your <em>feed</em>.</h2>
              <p className="auth-panel__sub">
                Passwordless. We&apos;ll email you a one-time code to enter right here.
              </p>
            </div>

            <AuthEmailForm mode="signin" initialError={error} />

            <GoogleSignIn />

            {/* Signup lives on the marketing site (the real front door); the app
                subdomain only signs people in. The /signup route stays functional
                for invite links. */}
            <p className="auth-alt">
              New to Ticket?{" "}
              <a className="auth-link" href="https://www.getticket.ai">Get started at getticket.ai</a>.
            </p>
            {/* ALT-695 — the only door someone locked OUT has. This page is where they are stuck,
                so the link has to be here and visible, not buried in a footer somewhere else. */}
            <p className="auth-alt">
              Can&apos;t get in? <a className="auth-link" href="/support">Tell us what happened</a>.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
