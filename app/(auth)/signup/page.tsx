import Link from "next/link"
import { redirect } from "next/navigation"
import { sendMagicLinkAction, signInWithGoogleAction } from "../login/actions"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { HashTokenHandler } from "@/components/auth/hash-token-handler"
import {
  AuthBrandMark,
  AuthGoogleIcon,
  AuthMailIcon,
  AuthErrorIcon,
  AuthOkIcon,
} from "../login/auth-icons"
import "@/components/ticket/pass.css"
import "../login/auth.css"

type SignupPageProps = {
  searchParams?: Promise<{ error?: string; sent?: string }>
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
  const sent = resolvedSearchParams?.sent

  return (
    <main className="ticket-chrome auth-shell">
      <HashTokenHandler />

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
              Name your competitors and Ticket starts watching menus, pricing,
              reviews, and social from day one.
            </p>
          </div>

          <div className="auth-badge">
            <span className="auth-badge__dot" aria-hidden="true" />
            <span className="auth-badge__txt">
              <span className="auth-badge__k">Setup</span>
              <span className="auth-badge__v">Live in minutes</span>
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
                Passwordless. We&apos;ll email you a secure magic link to finish setup.
              </p>
            </div>

            {error ? (
              <p className="auth-msg auth-msg--error" role="alert">
                <AuthErrorIcon />
                <span>{decodeURIComponent(error)}</span>
              </p>
            ) : null}
            {sent ? (
              <p className="auth-msg auth-msg--ok" role="status">
                <AuthOkIcon />
                <span>Magic link sent. Check your email to continue.</span>
              </p>
            ) : null}

            <form action={sendMagicLinkAction} className="auth-form">
              <input type="hidden" name="redirect_to" value="/signup" />
              <label className="auth-label" htmlFor="email">Email</label>
              <input
                id="email"
                className="auth-input"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@restaurant.com"
              />
              <button type="submit" className="auth-submit">
                <AuthMailIcon />
                Send magic link
              </button>
            </form>

            <div className="auth-or"><span>or</span></div>

            <form action={signInWithGoogleAction}>
              <button type="submit" className="auth-social">
                <AuthGoogleIcon />
                Continue with Google
              </button>
            </form>

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
