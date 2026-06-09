import Link from "next/link"
import { redirect } from "next/navigation"
import { sendMagicLinkAction, signInWithGoogleAction } from "./actions"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { HashTokenHandler } from "@/components/auth/hash-token-handler"
import "../../chrome.css"

type LoginPageProps = {
  searchParams?: Promise<{ error?: string; sent?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
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
        <span className="chrome-kicker">Welcome back</span>
        <h1 className="chrome-h">Sign in to your <em>feed</em>.</h1>
        <p className="chrome-sub">Passwordless. We&apos;ll email you a secure magic link.</p>

        {error ? <p className="chrome-msg chrome-msg--error">{decodeURIComponent(error)}</p> : null}
        {sent ? <p className="chrome-msg chrome-msg--ok">Magic link sent. Check your email to continue.</p> : null}

        <form action={sendMagicLinkAction} className="auth-form">
          <input type="hidden" name="redirect_to" value="/login" />
          <label className="chrome-label" htmlFor="email">Email</label>
          <input id="email" className="chrome-input" name="email" type="email" required placeholder="you@restaurant.com" />
          <button type="submit" className="chrome-btn auth-submit">Send magic link</button>
        </form>

        <div className="chrome-or"><span>or</span></div>

        <form action={signInWithGoogleAction}>
          <button type="submit" className="chrome-btn chrome-btn--ghost auth-google">Continue with Google</button>
        </form>

        <p className="auth-alt">New to Ticket? <Link className="chrome-link" href="/signup">Create an account</Link>.</p>
      </div>
    </main>
  )
}
