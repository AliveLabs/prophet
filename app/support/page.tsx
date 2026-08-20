// ALT-695 — the logged-out support route.
//
// Reachable with NO session: excluded from the proxy matcher on purpose, because the person using
// it is locked out, which is what they are writing to tell us. On app.getticket.ai the root path
// redirects to /login, so without this route and the link on the login page a locked-out operator
// has no door at all.
//
// A signed-in visitor is sent to the in-app launcher instead, which captures their org, location
// and page automatically. Asking someone to retype an email address we already have reads as not
// paying attention.

import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { SUPPORT_EMAIL } from "@/lib/support/contact"
import SupportForm from "./support-form"
import "@/components/ticket/pass.css"
import "../(auth)/login/auth.css"

export const metadata: Metadata = {
  title: "Get help | Ticket",
  description: "Tell us what happened and we will get back to you.",
  robots: { index: false, follow: false },
}

// The session read goes behind a Suspense boundary rather than `export const dynamic`.
// `nextConfig.cacheComponents` rejects the route-segment config outright, so the shell stays
// prerenderable and only this part streams. Same shape as app/(auth)/layout.tsx, which /support
// cannot inherit because it is not in that route group.
async function SignedInRedirect() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  if (data.user) redirect("/home")
  return null
}

export default function SupportPage() {
  return (
    <main className="ticket-chrome auth-shell">
      <Suspense fallback={null}>
        <SignedInRedirect />
      </Suspense>
      <div className="auth-split">
        <section className="auth-canvas">
          <span className="auth-canvas__brand">
            <span className="auth-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M4 7h16M4 12h16M4 17h10" />
              </svg>
            </span>
            Ticket
          </span>
          <div className="auth-lede">
            <span className="auth-kicker">Support</span>
            <h1 className="auth-h">Can&apos;t get in?</h1>
            <p className="auth-lede__sub">
              Tell us what happened and we will reply by email. You do not need to be signed in.
            </p>
          </div>
          <span aria-hidden="true" />
        </section>

        <section className="auth-panelcol">
          <div className="auth-panel">
            <h2 className="auth-panel__h">Get help</h2>
            <p className="auth-panel__lede">
              We read every one of these. You will get a reference number you can quote back to us.
            </p>

            <SupportForm />

            <p className="auth-alt">
              Already signed in? <a className="auth-link" href="/home">Use Help inside the app</a>{" "}
              instead, so we can see what you are looking at.
            </p>
            <p className="auth-alt">
              You can also email{" "}
              <a className="auth-link" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              , though the form reaches us with more to go on.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
