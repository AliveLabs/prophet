"use client"

import { useState, type FormEvent } from "react"

export function WaitlistForm() {
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
      <div className="rounded-xl border border-precision-teal/30 bg-card px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-precision-teal/10">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--precision-teal)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <h3 className="font-display text-2xl font-semibold text-foreground">
          You&rsquo;re on the list!
        </h3>
        <p className="mt-2 text-muted-foreground">
          Check your email for a confirmation. We&rsquo;ll reach out when your
          spot is ready.
        </p>
        <p className="mt-3 text-xs text-muted-foreground/70">
          Don&rsquo;t see the email? Check your spam folder.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="wl-first-name"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            First Name <span className="text-destructive">*</span>
          </label>
          <input
            id="wl-first-name"
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Jane"
            className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label
            htmlFor="wl-last-name"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Last Name <span className="text-destructive">*</span>
          </label>
          <input
            id="wl-last-name"
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Doe"
            className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="wl-email"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Email <span className="text-destructive">*</span>
        </label>
        <input
          id="wl-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@restaurant.com"
          className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {status === "error" && (
        <p className="text-sm text-destructive">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-lg bg-precision-teal px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {status === "loading" ? "Submitting..." : "Request Early Access"}
      </button>
    </form>
  )
}
