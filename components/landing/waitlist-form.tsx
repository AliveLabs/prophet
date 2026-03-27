"use client"

import { useState, type FormEvent } from "react"

export function WaitlistForm() {
  const [email, setEmail] = useState("")
  const [businessName, setBusinessName] = useState("")
  const [city, setCity] = useState("")
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
          email,
          business_name: businessName || undefined,
          city: city || undefined,
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
            <path d="M5 12l5 5L20 7" />
          </svg>
        </div>
        <h3 className="font-display text-2xl font-semibold text-foreground">
          You&rsquo;re in.
        </h3>
        <p className="mt-2 text-muted-foreground">
          We&rsquo;ll be in touch soon.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6"
    >
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

      <div>
        <label
          htmlFor="wl-business"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Business Name{" "}
          <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="wl-business"
          type="text"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Your Restaurant"
          className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label
          htmlFor="wl-city"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          City <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="wl-city"
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="San Francisco"
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
        {status === "loading" ? "Joining..." : "Join the Waitlist"}
      </button>
    </form>
  )
}
