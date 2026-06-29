"use client"

// Pass-styled waitlist CTA + form. The form re-implements the presentation of
// the shared waitlist-form with the IDENTICAL business logic: a POST to
// /api/waitlist with { first_name, last_name, email }, success/error states.

import { useState, type FormEvent } from "react"
import { LpReveal } from "./landing-shared"

function WaitlistForm() {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus("loading")
    setErrorMsg("")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
          email,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Something went wrong. Please try again.")
        setStatus("error")
        return
      }
      setStatus("success")
    } catch {
      setErrorMsg("Network error. Please try again.")
      setStatus("error")
    }
  }

  if (status === "success") {
    return (
      <div className="lp-success">
        <span className="lp-success-ring" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h2 className="lp-h2" style={{ fontSize: "clamp(24px,3vw,32px)" }}>
          You&rsquo;re on the list.
        </h2>
        <p className="lp-sub">
          Check your email for a confirmation — we&rsquo;ll reach out when your spot is ready.
        </p>
        <p className="lp-form-fine">Don&rsquo;t see it? Check your spam folder.</p>
      </div>
    )
  }

  return (
    <form className="lp-form" onSubmit={handleSubmit} noValidate>
      <div className="lp-form-row">
        <div className="lp-field">
          <label className="lp-label" htmlFor="lp-first">
            First name <span className="lp-req">*</span>
          </label>
          <input
            id="lp-first" className="lp-input" type="text" required autoComplete="given-name"
            value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane"
          />
        </div>
        <div className="lp-field">
          <label className="lp-label" htmlFor="lp-last">
            Last name <span className="lp-req">*</span>
          </label>
          <input
            id="lp-last" className="lp-input" type="text" required autoComplete="family-name"
            value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe"
          />
        </div>
      </div>

      <div className="lp-field">
        <label className="lp-label" htmlFor="lp-email">
          Email <span className="lp-req">*</span>
        </label>
        <input
          id="lp-email" className="lp-input" type="email" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com"
        />
      </div>

      {status === "error" && (
        <p className="lp-form-error" role="alert">{errorMsg}</p>
      )}

      <button type="submit" className="lp-form-submit" disabled={status === "loading"}>
        {status === "loading" ? "Submitting…" : "Request early access"}
      </button>
    </form>
  )
}

export function PassWaitlist() {
  return (
    <section id="waitlist" className="lp-section lp-waitlist">
      <div className="lp-wrap">
        <LpReveal className="lp-waitlist-panel" as="div" threshold={0.2}>
          <span className="lp-waitlist-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <path d="m2 7 10 6 10-6" />
            </svg>
          </span>
          <h2 className="lp-h2">
            Stop reacting. <span className="lp-flourish lp-em">Start anticipating.</span>
          </h2>
          <p className="lp-sub" style={{ maxWidth: "46ch" }}>
            Your competition moves faster than your current tools can track. Ticket closes
            the gap so you move first, not last.
          </p>
          <WaitlistForm />
        </LpReveal>
      </div>
    </section>
  )
}

export function PassFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-row">
        <div className="lp-brand">
          <span className="lp-brand-mark" aria-hidden="true" style={{ width: 28, height: 28 }}>
            <svg width="14" height="18" viewBox="0 0 22 28" fill="none" aria-hidden="true">
              <rect x="0" y="0" width="22" height="5" rx="0.6" fill="#fff" />
              <rect x="6.5" y="5" width="9" height="23" fill="#fff" />
            </svg>
          </span>
          <span className="lp-brand-word">Ticket</span>
        </div>
        <p className="lp-footer-fine">
          Ticket is competitive intelligence by Alive Labs.
          <br />© 2026 Alive Labs. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
