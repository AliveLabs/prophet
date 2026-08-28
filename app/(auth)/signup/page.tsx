import Link from "next/link"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { HashTokenHandler } from "@/components/auth/hash-token-handler"
import { PlanChoiceCapture } from "@/components/auth/plan-choice-capture"
import { AuthEmailForm } from "../auth-email-form"
import { GoogleSignIn } from "../google-signin"
import { AuthBrandMark } from "../login/auth-icons"
import "@/components/ticket/pass.css"
import "../login/auth.css"

type SignupPageProps = {
  // `plan` / `billing` arrive from the marketing pricing CTAs (ALT-645) and are read on the
  // client by PlanChoiceCapture, not here: this page cannot set a cookie, and the value has to
  // outlive a sign-in round trip through the emailed link.
  searchParams?: Promise<{ error?: string; plan?: string; billing?: string }>
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
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
      <PlanChoiceCapture />

      <div className="auth-split">
        {/* LEFT — pearlescent canvas + welcome lede (desktop/tablet) */}
        <section className="auth-canvas">
          <span className="auth-canvas__brand">
            <span className="auth-mark" aria-hidden="true"><AuthBrandMark /></span>
            Ticket
          </span>

          <div className="auth-lede">
            <span className="auth-kicker">Get started</span>
            <h1 className="auth-h">Create your <em>account</em>.</h1>
            <p className="auth-lede__sub">
              Confirm your competitors and Ticket starts watching menus,
              pricing, reviews, and social from day one.
            </p>
          </div>

          <div className="auth-badge">
            <span className="auth-badge__dot" aria-hidden="true" />
            <span className="auth-badge__txt">
              <span className="auth-badge__k">Setup</span>
              {/* Not "Live in minutes": no fixed setup or first-brief time is
                  promised anywhere (marketing dropped the same class of claim,
                  and the first brief genuinely takes a while to build). The
                  no-card fact is the reassurance that matters at signup. */}
              <span className="auth-badge__v">No card required</span>
            </span>
          </div>
        </section>

        {/* RIGHT — floating form panel */}
        <section className="auth-panelcol">
          <div className="auth-panel">
            {/* welcome message repeats inside the panel on mobile (canvas lede hides) */}
            <div className="auth-panel__lede">
              <span className="auth-kicker">Get started</span>
              <h2 className="auth-panel__h">Create your <em>account</em>.</h2>
              <p className="auth-panel__sub">
                Passwordless. We&apos;ll email you a one-time code to enter right here.
              </p>
            </div>

            <AuthEmailForm mode="signup" initialError={error} />

            <GoogleSignIn />

            <p className="auth-alt">
              Already have an account?{" "}
              <Link className="auth-link" href="/login">Sign in</Link>.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
