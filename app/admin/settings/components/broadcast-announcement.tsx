"use client"

// Admin broadcast (ALT-229c) — the "reaches everyone" path. Surfaces the existing
// broadcastEmail server action so an admin can send an outage / announcement to ALL
// users at once. This path INTENTIONALLY ignores per-user communication preferences
// (it's for things every account must see), and the action bypasses the client-email
// pause flag — so an announcement always sends. Optional audience filter narrows to a
// tier / trial status when an announcement isn't for everyone.

import { useState, useTransition, type FormEvent } from "react"
import { broadcastEmail } from "@/app/actions/admin-email"
import { TkButton } from "@/components/ticket"

const AUDIENCE_OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "tier_entry", label: "Tier 1 only" },
  { value: "tier_mid", label: "Tier 2 only" },
  { value: "tier_top", label: "Tier 3 only" },
  { value: "trial_active", label: "Active trials" },
  { value: "trial_expired", label: "Expired trials" },
] as const

type Audience = (typeof AUDIENCE_OPTIONS)[number]["value"]

function audienceToFilter(a: Audience): { tier?: string; trialStatus?: "active" | "expired" } | undefined {
  switch (a) {
    case "all":
      return undefined
    case "tier_entry":
      return { tier: "entry" }
    case "tier_mid":
      return { tier: "mid" }
    case "tier_top":
      return { tier: "top" }
    case "trial_active":
      return { trialStatus: "active" }
    case "trial_expired":
      return { trialStatus: "expired" }
  }
}

export function BroadcastAnnouncement() {
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [audience, setAudience] = useState<Audience>("all")
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) return
    startTransition(async () => {
      const result = await broadcastEmail(subject, body, audienceToFilter(audience))
      setFeedback({ ok: result.ok, message: result.ok ? result.message : result.error })
      if (result.ok) {
        setSubject("")
        setBody("")
      }
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p className="tk-muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
        Send an announcement (e.g. an outage or service notice) by email. This reaches
        the selected audience <strong>regardless of their notification preferences</strong>,
        so reserve it for messages everyone needs to see.
      </p>

      {feedback && (
        <div className={`adm-flash ${feedback.ok ? "is-ok" : "is-err"}`} role="status">
          {feedback.message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="adm-form-grid">
          <input
            type="text"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="adm-input"
            style={{ flex: "2 1 240px" }}
          />
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
            aria-label="Audience"
            className="adm-select"
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your announcement…"
          className="adm-input"
          rows={5}
          style={{ resize: "vertical", minHeight: 100 }}
        />
        <div>
          <TkButton type="submit" variant="add" disabled={isPending}>
            {isPending ? "Sending…" : "Send announcement"}
          </TkButton>
        </div>
      </form>
    </div>
  )
}
