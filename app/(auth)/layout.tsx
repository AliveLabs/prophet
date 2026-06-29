import { Suspense, type ReactNode } from "react"
// The Pass kit (tk-* classes) + the auth-scoped pearlescent layout.
import "@/components/ticket/pass.css"
import "./login/auth.css"

// Fallback shown while the async auth server components resolve. Matches the
// pearlescent split shell so the first paint reads as the real auth screen,
// not a generic gray box. Lives inside `.ticket-chrome` so tokens (light +
// warm-dark) resolve for free.
function AuthSkeleton() {
  return (
    <main className="ticket-chrome auth-shell" aria-busy="true">
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
            <span className="auth-kicker">&nbsp;</span>
            <h1 className="auth-h" aria-hidden="true">&nbsp;</h1>
          </div>
          <span aria-hidden="true" />
        </section>
        <section className="auth-panelcol">
          <div className="auth-panel" aria-hidden="true">
            <div
              style={{
                height: 240,
                borderRadius: "var(--r-md)",
                background:
                  "linear-gradient(110deg, var(--card-2) 30%, var(--paper-2) 50%, var(--card-2) 70%)",
              }}
            />
          </div>
        </section>
      </div>
    </main>
  )
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AuthSkeleton />}>{children}</Suspense>
}
