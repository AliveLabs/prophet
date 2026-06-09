import Link from "next/link"
import { redirect } from "next/navigation"
import { sendMagicLinkAction, signInWithGoogleAction } from "../login/actions"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { HashTokenHandler } from "@/components/auth/hash-token-handler"
import "../../chrome.css"

type SignupPageProps = {
  searchParams?: Promise<{ error?: string; sent?: string }>
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  if (data.user) {
    redirect("/home")
  }

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const error = resolvedSearchParams?.error
  const sent = resolvedSearchParams?.sent

  return (
    <main className="ticket-chrome">
      <HashTokenHandler />
      <div className="chrome-card auth-card">
        <div className="auth-brand">TICKET</div>
        <span className="chrome-kicker">Get started</span>
        <h1 className="chrome-h">Set up in <em>minutes</em>.</h1>
        <p className="chrome-sub">Name your competitors and Ticket starts watching menus, pricing, reviews, and social from day one.</p>

        {error ? <p className="chrome-msg chrome-msg--error">{decodeURIComponent(error)}</p> : null}
        {sent ? <p className="chrome-msg chrome-msg--ok">Magic link sent. Check your email to continue.</p> : null}

        <form action={sendMagicLinkAction} className="auth-form">
          <input type="hidden" name="redirect_to" value="/signup" />
          <label className="chrome-label" htmlFor="email">Email</label>
          <input id="email" className="chrome-input" name="email" type="email" required placeholder="you@restaurant.com" />
          <button type="submit" className="chrome-btn auth-submit">Send magic link</button>
        </form>

        <div className="chrome-or"><span>or</span></div>

        <form action={signInWithGoogleAction}>
          <button type="submit" className="chrome-btn chrome-btn--ghost auth-google">Continue with Google</button>
        </form>

        <p className="auth-alt">Already have an account? <Link className="chrome-link" href="/login">Sign in</Link>.</p>
      </div>
    </main>
  )
}
