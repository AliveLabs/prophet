"use client"

// ALT-695 — the logged-out support form. Deliberately small.
//
// Three subjects, not the full support list: if you cannot log in, your problem is one of three
// things, and offering "something in my brief looks wrong" to someone who cannot see their brief
// invites misrouted submissions and gives us worse data than no category at all.
//
// No page context is captured and none is faked. We know where they are: they are here.
//
// Styling reuses the auth shell's own classes (auth-form / auth-label / auth-input / auth-submit /
// auth-msg), which is what the login page uses. The dashboard's `pv-*` classes are NOT available
// here: operator.css is not loaded on the auth shell, so using them would render unstyled.

import { useState, useTransition } from "react"
import { submitSupportRequest } from "./actions"
import { SIGNIN_SUBJECTS, SIGNIN_SUBJECT_LABELS, type SigninSubject } from "@/lib/feedback/feedback"

export default function SupportForm() {
  const [email, setEmail] = useState("")
  const [businessName, setBusinessName] = useState("")
  const [subject, setSubject] = useState<SigninSubject | null>(null)
  const [message, setMessage] = useState("")
  const [website, setWebsite] = useState("") // honeypot
  const [reference, setReference] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const canSend =
    email.trim().length > 0 && businessName.trim().length > 0 && message.trim().length > 0 && !pending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSend) return
    setError(null)
    startTransition(async () => {
      const res = await submitSupportRequest({ email, businessName, subject, message, website })
      if (res.ok) setReference(res.reference)
      else setError(res.error)
    })
  }

  // The acknowledgement matters as much as the send. Without a reference, somebody unsure their
  // message arrived sends it again through another channel and the queue doubles for no reason.
  if (reference) {
    return (
      <div className="auth-msg auth-msg--ok" role="status">
        <span>
          We have your request. Your reference is <strong>{reference}</strong>, and we have emailed a
          copy to <strong>{email.trim().toLowerCase()}</strong>. If this is about getting in, we will
          usually reply with a fresh sign-in link.
        </span>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {error ? (
        <p className="auth-msg auth-msg--error" role="alert">
          <span>{error}</span>
        </p>
      ) : null}

      <label className="auth-label" htmlFor="sup-email">
        Your email
      </label>
      <input
        id="sup-email"
        className="auth-input"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@restaurant.com"
      />

      <label className="auth-label" htmlFor="sup-biz">
        Restaurant name
      </label>
      <input
        id="sup-biz"
        className="auth-input"
        type="text"
        autoComplete="organization"
        required
        value={businessName}
        onChange={(e) => setBusinessName(e.target.value)}
        placeholder="Your restaurant"
      />
      <p className="auth-fine">This is how we find your account when you cannot sign in to tell us.</p>

      <span className="auth-label">What is happening?</span>
      {SIGNIN_SUBJECTS.map((s) => (
        <label key={s} className="auth-fine" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="radio"
            name="subject"
            value={s}
            checked={subject === s}
            onChange={() => setSubject(s)}
          />
          <span>{SIGNIN_SUBJECT_LABELS[s]}</span>
        </label>
      ))}

      <label className="auth-label" htmlFor="sup-msg">
        Tell us a bit more
      </label>
      <textarea
        id="sup-msg"
        className="auth-input"
        rows={5}
        required
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What you tried, and what happened."
      />

      {/* Honeypot. Hidden from sight and from the tab order; a real person never fills it in. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
        <label htmlFor="sup-website">Website</label>
        <input
          id="sup-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <button type="submit" className="auth-submit" disabled={!canSend}>
        {pending ? "Sending..." : "Send"}
      </button>
    </form>
  )
}
